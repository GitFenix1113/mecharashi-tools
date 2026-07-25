// ── mecharashi-worker：公開遊戲資料代理（PLAN-029 Phase 2）─────────────────────
// 前端不再直連 Firestore 讀公開資料，改打本 Worker 的 /api/data/:collection。
// Worker 用 service account（Admin 憑證）走 Firestore REST 代讀 → 繞過安全規則，
// 因此 Phase 3 可把 Firestore 遊戲資料收成 read:if false、鎖死前端直連白嫖。
//
// 回應格式刻意對齊前端 fetchCollection 的 `{ ...doc.data(), id }`，前端接線零轉換。

import { parseServiceAccount, getAccessToken, type ServiceAccount } from './gcpAuth'
import { listCollection, getDocument } from './firestoreRest'
import { getDataVersions, effectiveVersion } from './versions'

export interface Env {
  /** service account JSON 字串（CF Secret；本機走 workers/.dev.vars）。 */
  FIREBASE_SA_KEY: string
  /** 允許的前端來源（逗號分隔）；未設時退回預設清單。 */
  ALLOWED_ORIGINS?: string
}

// 標準陣列集合：listCollection → `{ ...data, id }[]`（對應前端 fetchCollection）
const ARRAY_COLLECTIONS = new Set<string>([
  'pilots', 'mechs', 'modules', 'weapons', 'backpacks', 'components',
  'buffs', 'pilotSkills', 'neuralDriveAbilities', 'glossaryTerms',
  // PLAN-029 Phase 3-1：原本前台仍直讀的兩個公開集合，一併代理以便 Phase 3-2 收緊。
  'pilotResearch', 'patchVersions',
])

const DEFAULT_ALLOWED = ['https://mecharashi.wiki', 'https://www.mecharashi.wiki', 'http://localhost:5173']

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const cors = corsHeaders(request, env)

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })

    // 路由：GET /api/versions → 回 { global, byKey }（對應前端 meta/gameData 版本 gate）。
    // 前端據此決定 localStorage 三層快取命中；Phase 3 收緊 meta 後前端改由此代讀版本。
    if (url.pathname === '/api/versions') {
      if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors)
      try {
        const sa = parseServiceAccount(env.FIREBASE_SA_KEY)
        const token = await getAccessToken(sa)
        const versions = await getDataVersions(sa, token)
        // 不邊緣快取：版本本身即快取失效訊號，須夠新（versions.ts 已有 60s isolate 級快取）。
        return json(versions, 200, { ...cors, 'cache-control': 'no-store' })
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500, cors)
      }
    }

    // 路由：GET /api/data/:collection
    const m = url.pathname.match(/^\/api\/data\/([a-zA-Z]+)$/)
    if (!m) return json({ error: 'not found' }, 404, cors)
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors)

    const key = m[1]
    const isValid = ARRAY_COLLECTIONS.has(key) || key === 'globalResearch' || key === 'grayOpsRoster'
    if (!isValid) return json({ error: `unknown collection: ${key}` }, 404, cors)

    try {
      const sa = parseServiceAccount(env.FIREBASE_SA_KEY)
      const token = await getAccessToken(sa)

      // 版本號 → 邊緣快取 key（後台 bumpDataVersion 改版本號 → key 改變 → 舊快取自然失效）
      const versions = await getDataVersions(sa, token)
      const version = effectiveVersion(key, versions)
      const cache = caches.default
      const cacheKey = new Request(`${url.origin}/__cache/data/${key}?v=${encodeURIComponent(version)}`)

      // 命中邊緣快取 → 0 Firestore read
      const hit = await cache.match(cacheKey)
      if (hit) {
        return new Response(await hit.text(), {
          status: 200,
          headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'x-cache': 'HIT' },
        })
      }

      // miss → 讀 Firestore
      let data: unknown
      if (ARRAY_COLLECTIONS.has(key)) data = await listCollection(sa, token, key)
      else if (key === 'globalResearch') data = await getDocument(sa, token, 'globalResearch', 'global')
      else data = await assembleGrayOpsRoster(sa, token) // grayOpsRoster

      const body = JSON.stringify(data)
      // 寫入邊緣快取：純資料、不含隨請求變動的 CORS；版本號已在 key 裡，故可長 max-age
      const toCache = new Response(body, {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=86400' },
      })
      ctx.waitUntil(cache.put(cacheKey, toCache))

      return new Response(body, {
        status: 200,
        headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'x-cache': 'MISS' },
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return json({ error: msg }, 500, cors)
    }
  },
} satisfies ExportedHandler<Env>

// grayOpsRoster：讀 grayOps collection 組裝成 { companies }（對齊前端 getGrayOpsRoster）
async function assembleGrayOpsRoster(sa: ServiceAccount, token: string): Promise<unknown> {
  const docs = await listCollection(sa, token, 'grayOps')
  const companies: Record<string, unknown> = {}
  for (const d of docs) {
    if (d.id === 'roster') continue
    if (Array.isArray((d as { mechs?: unknown }).mechs)) companies[d.id as string] = (d as { mechs: unknown }).mechs
  }
  if (Object.keys(companies).length === 0) {
    // 舊格式 fallback：單一 grayOps/roster 文件
    return getDocument(sa, token, 'grayOps', 'roster')
  }
  return { companies }
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()) ?? DEFAULT_ALLOWED)
  const origin = request.headers.get('origin') ?? ''
  const allow = allowed.includes(origin) ? origin : allowed[0]
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'vary': 'origin',
  }
}

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
  })
}
