// ── /api/collect 的 payload 驗證與寫入組裝（PLAN-046 A-3）────────────────────
//
// 本檔是「匿名輸入」與「service account 寫入權限」之間唯一的一道牆，因此有兩條
// **不可妥協的鐵律**（見下方 buildWrites 的實作）：
//
//   鐵律① payload 絕不參與決定「寫哪一份文件」——文件 ID 由伺服器時間算出。
//   鐵律② 欄位路徑一律由程式碼組出，payload 只能提供**數字**。
//
// 只要這兩條成立，攻擊者能造成的最壞後果就被限縮成「統計數字變髒」——
// 不會碰到 pilots / mechs / users 任何一個集合，也不會影響網站運作。數字髒了，
// 把那天的文件刪掉重來即可。
//
// 另一個刻意的設計是 **Worker 端不放頁面白名單**（決策八）。若這裡持有一份「合法
// 頁面 key 清單」，就是原封不動重演 PLAN-043 的雙名單不同步事故（漏一個 key →
// 正式站壞、本機全綠），而且比它更難發現——不報 404，只是數字少了。
// 改用「格式正則 + 數量上限」：名單式防護問「這個 key 合法嗎」（需要知識 → 需要
// 同步 → 會腐化）；格式式防護問「這個 key 會不會造成傷害」（不需要知識 → 永遠不用改）。
// 代價只是報表可能多一列看得懂的雜訊，由後台顯示層過濾即可 ——
// 把不同步的後果從**資料遺失**降級成**顯示雜訊**。

import type { FieldTransform, IncrementWrite } from './firestoreRest'

/** 日界線時區偏移（UTC+8）。必須與前端 session.ts 的 dayKey 一致，否則日界線會錯開。 */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000

/** 伺服器端算出的日期字串（鐵律①：絕不採用 payload 提供的日期）。 */
export function todayKey(now: number = Date.now()): string {
  return new Date(now + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

/** 伺服器端算出的月份字串（entity 文件用月粒度，避免日文件被高基數資料撐爆）。 */
export function monthKey(now: number = Date.now()): string {
  return todayKey(now).slice(0, 7)
}

// ── 格式防護 ────────────────────────────────────────────────────────────────

/** 頁面／來源 key 的格式。與前端 toPageKey 的產出對齊，但這裡只驗格式、不驗名稱。 */
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/

const LANGS = new Set(['zh_tw', 'zh_cn', 'zh_other', 'en', 'ja', 'ko', 'other'])
const AUTHS = new Set(['guest', 'user'])
/** 允許的 entity 類別。這是**閉集合**（不隨頁面增減），故列舉不會有腐化問題。 */
const ENTITY_TYPES = new Set(['pilots', 'mechs', 'weapons', 'modules'])

const MAX_BODY_BYTES = 8 * 1024
const MAX_ROUTES = 50
const MAX_ENTITIES_PER_TYPE = 30
const MAX_PV = 200
const MAX_UPV = 50
const MAX_ENTITY_COUNT = 20

/**
 * entity id 是否可安全用作反引號包裹的欄位路徑片段。
 *
 * ⚠ 本專案的文件 ID **含中文**（src/utils/idSlug.ts 的 slugify 刻意保留 CJK），
 *   所以欄位路徑非得用反引號不可。既然要包裹，就必須確保 id 逃不出引號——
 *   這是鐵律②在 entity 這條路徑上的具體落實。
 *
 * 採**白名單字元類別**而非黑名單：只放行 slugify 會產出的範圍。反引號、反斜線、
 * 點、控制字元全部落在範圍外，逃逸在字面上就不可能發生。
 * （前端 routeKeys.ts 有一份同樣的判定。這是**格式**規則不是**名稱**清單，
 *   兩邊各留一份不會有 PLAN-043 那種不同步風險。）
 */
function isSafeEntityId(id: string): boolean {
  if (!id || id.length > 60) return false
  for (const ch of id) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) return false
    const ok =
      (cp >= 0x4e00 && cp <= 0x9fa5) ||
      (cp >= 0x30 && cp <= 0x39) ||
      (cp >= 0x41 && cp <= 0x5a) ||
      (cp >= 0x61 && cp <= 0x7a) ||
      cp === 0x5f ||
      cp === 0x2d
    if (!ok) return false
  }
  return true
}

/** 夾在合法範圍內的整數。非數字、負數、NaN 一律回 0。 */
function clampInt(v: unknown, max: number): number {
  const n = typeof v === 'number' ? Math.floor(v) : NaN
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(n, max)
}

export interface CollectInput {
  sessions: number
  visitors: number
  lang: string
  auth: string
  ref: string
  routes: Array<{ key: string; pv: number; upv: number }>
  entities: Array<{ type: string; id: string; n: number }>
}

/**
 * 解析並清洗 payload。**格式不合的個別項目丟掉，不丟整包** ——
 * 一個壞掉的 route key 不該讓整場 session 的資料消失。
 * 回 null 代表整包無效（過大、非 JSON、版本不符）。
 */
export function parseCollectBody(raw: string): CollectInput | null {
  if (raw.length > MAX_BODY_BYTES) return null
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (!body || typeof body !== 'object' || body.v !== 1) return null

  const routes: CollectInput['routes'] = []
  const rawRoutes = body.routes
  if (rawRoutes && typeof rawRoutes === 'object') {
    for (const [key, val] of Object.entries(rawRoutes as Record<string, unknown>)) {
      if (routes.length >= MAX_ROUTES) break
      if (!KEY_RE.test(key)) continue
      const v = val as { pv?: unknown; upv?: unknown }
      const pv = clampInt(v?.pv, MAX_PV)
      const upv = clampInt(v?.upv, MAX_UPV)
      if (pv === 0 && upv === 0) continue
      routes.push({ key, pv, upv })
    }
  }

  const entities: CollectInput['entities'] = []
  const rawEntities = body.entities
  if (rawEntities && typeof rawEntities === 'object') {
    for (const [type, ids] of Object.entries(rawEntities as Record<string, unknown>)) {
      if (!ENTITY_TYPES.has(type) || !ids || typeof ids !== 'object') continue
      let taken = 0
      for (const [id, n] of Object.entries(ids as Record<string, unknown>)) {
        if (taken >= MAX_ENTITIES_PER_TYPE) break
        if (!isSafeEntityId(id)) continue
        const count = clampInt(n, MAX_ENTITY_COUNT)
        if (count === 0) continue
        entities.push({ type, id, n: count })
        taken++
      }
    }
  }

  const lang = typeof body.lang === 'string' && LANGS.has(body.lang) ? body.lang : 'other'
  const auth = typeof body.auth === 'string' && AUTHS.has(body.auth) ? body.auth : 'guest'
  const ref = typeof body.ref === 'string' && KEY_RE.test(body.ref) ? body.ref : 'other'

  const input: CollectInput = {
    sessions: clampInt(body.sessions, 1),
    visitors: clampInt(body.visitors, 1),
    lang,
    auth,
    ref,
    routes,
    entities,
  }
  // 一包什麼都沒有就沒必要寫（也擋掉「送空包灌寫入次數」這種消耗手法）
  const empty =
    input.sessions === 0 && input.visitors === 0 && routes.length === 0 && entities.length === 0
  return empty ? null : input
}

// ── 維度補充（伺服器端資訊，payload 碰不到）──────────────────────────────────

/** 由 UA 判定裝置類別。粗分三類即可，統計用不著更細。 */
export function deviceBucket(ua: string): 'mobile' | 'tablet' | 'desktop' {
  const u = ua.toLowerCase()
  if (/ipad|tablet|playbook|silk/.test(u)) return 'tablet'
  if (/mobi|android|iphone|ipod/.test(u)) return 'mobile'
  return 'desktop'
}

/**
 * 由 request.cf.country 取國碼。
 *
 * 注意這量到的是**網路位置**，不是受眾語言：本站主客群是國際服（EN）與中國玩家，
 * 而 EN 服玩家散布各國、CN 玩家常走 VPN 顯示為 US／JP／HK。因此國家維度必須與
 * payload 帶來的 lang 維度**並存互補**——國家看「連線從哪來」（驗證 PLAN-029 的
 * 邊緣可達性），語言看「誰在讀」。
 */
export function countryBucket(country: unknown): string {
  return typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : 'XX'
}

// ── 寫入組裝 ────────────────────────────────────────────────────────────────

const inc = (fieldPath: string, n: number): FieldTransform => ({
  fieldPath,
  increment: { integerValue: String(n) },
})

/** 反引號包裹（entity id 含中文，無法作為未引用的欄位路徑片段）。 */
const quoted = (id: string) => `\`${id}\``

export interface BuildContext {
  dayKey: string
  monthKey: string
  device: string
  country: string
}

/**
 * 組出這次要送的所有寫入。
 *
 * **鐵律①**：`ctx.dayKey` / `ctx.monthKey` 由呼叫端以伺服器時間算出，payload 無從影響。
 * **鐵律②**：所有 fieldPath 都在本函式內以字面量組出，payload 只提供 `n` 這個數字，
 *            以及已經通過格式白名單的 key —— 它們永遠是 `[a-z][a-z0-9_]*` 或
 *            反引號包裹且字元受限的 entity id。
 */
export function buildWrites(input: CollectInput, ctx: BuildContext): IncrementWrite[] {
  const daily: FieldTransform[] = []
  let pv = 0
  let upv = 0
  for (const r of input.routes) {
    pv += r.pv
    upv += r.upv
    if (r.pv) daily.push(inc(`byRoute.${r.key}.pv`, r.pv))
    if (r.upv) daily.push(inc(`byRoute.${r.key}.upv`, r.upv))
  }
  if (pv) daily.push(inc('pv', pv))
  if (upv) daily.push(inc('upv', upv))
  if (input.sessions) {
    daily.push(inc('sessions', input.sessions))
    // 以下維度都以「造訪」為計數單位，故只在帶著新 session 的那一包累加，
    // 否則同一場 session 的多次 flush 會把語言／國家／裝置重複計好幾次。
    daily.push(inc(`byLang.${input.lang}`, input.sessions))
    daily.push(inc(`byAuth.${input.auth}`, input.sessions))
    daily.push(inc(`byRef.${input.ref}`, input.sessions))
    daily.push(inc(`byDevice.${ctx.device}`, input.sessions))
    daily.push(inc(`byCountry.${ctx.country}`, input.sessions))
  }
  if (input.visitors) daily.push(inc('visitors', input.visitors))

  const writes: IncrementWrite[] = []
  if (daily.length > 0) {
    writes.push({
      collection: 'analyticsDaily',
      docId: ctx.dayKey,
      seed: { date: ctx.dayKey },
      transforms: daily,
    })
  }

  if (input.entities.length > 0) {
    writes.push({
      collection: 'analyticsEntity',
      docId: ctx.monthKey,
      seed: { month: ctx.monthKey },
      transforms: input.entities.map((e) => inc(`${e.type}.${quoted(e.id)}`, e.n)),
    })
  }

  // `writes` 欄位是熔斷器的燃料表：值必須等於實際寫入的文件數，否則預算會失準。
  // 放在最後才知道總數，故此處回頭補進第一份寫入。
  if (writes.length > 0) {
    writes[0].transforms.push(inc('writes', writes.length))
    writes[0].transforms.push({ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' })
  }
  return writes
}

/** 熔斷時要寫的標記（只寫一次，之後完全停手）。 */
export function buildTruncatedMark(dayKey: string): IncrementWrite[] {
  return [
    {
      collection: 'analyticsDaily',
      docId: dayKey,
      seed: { date: dayKey, truncatedReason: 'writeBudget' },
      transforms: [{ fieldPath: 'truncatedAt', setToServerValue: 'REQUEST_TIME' }],
    },
  ]
}
