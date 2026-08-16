#!/usr/bin/env node
/**
 * PLAN-048 任務 2-1a／2-6：台版官方公告抓取 → 解析 → 寫入 staging
 *
 * 台版公告是「靜態 JSON 清單 + 伺服器端渲染詳情頁」，因此**不需要 Playwright**，
 * 一支 fetch 即可（無登入、無 Cloudflare、無 robots.txt）：
 *   清單 https://ma.tentree-games.com/jx/{type}/index.html（第 N 頁 index_N.html）
 *        └ 副檔名是 .html、Content-Type 也是 text/html，但內容是純 JSON
 *   詳情 https://ma.tentree-games.com/jx/{type}/YYYYMMDD/{id}.html
 *        └ 正文在 <div class="content"> 的 <p>
 *
 * 寫入兩個**後台專用**集合（前台完全不讀，見 src/types/announcementStaging.ts）：
 *   announcementDrafts   一則公告的原文草稿
 *   pendingActivities    解析出的待審活動，審核最小單位是「一個活動」
 *
 * ⚠ 本腳本**不寫 patchVersions，因此刻意不 bumpDataVersion**。
 *   patchVersions 走 Worker 邊緣快取（以集合版本號當 cache key、max-age=86400），
 *   沒改它卻 bump 等於平白讓所有使用者重抓一次。真正的寫入與 bump 在合併那一步
 *   （後台 /admin/announcements → src/lib/api/announcementStaging.ts 的 mergeIntoVersion）。
 *   **若日後有人在這裡加上直接寫 patchVersions 的路徑，就必須一併 bump** ——
 *   否則資料寫進去了、前台看不到、硬重整也沒用，最長 24 小時。
 *
 * 用法：
 *   node scripts/scrape-tw-announcements.mjs                  增量抓取（預設）
 *   node scripts/scrape-tw-announcements.mjs --dry-run        只解析並印報告，不寫 Firestore
 *   node scripts/scrape-tw-announcements.mjs --backfill=2026-07  回填該月（含）之後的公告
 *   node scripts/scrape-tw-announcements.mjs --reparse        不連外網，用既有 rawText 重新解析
 *   node scripts/scrape-tw-announcements.mjs --from-archive   讀本地歸檔而非連線（離線驗證用）
 *   node scripts/scrape-tw-announcements.mjs --limit=5        只處理前 N 篇
 *   node scripts/scrape-tw-announcements.mjs --fail-on-warn   結構性異常時 exit 1（排程用）
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import admin from 'firebase-admin'

import {
  parseAnnouncement,
  decodeEntities,
  PARSER_VERSION,
} from './lib/parseAnnouncement.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const HOST = 'https://ma.tentree-games.com'
const MIRROR = 'https://news.tentree-games.com'
const TYPES = ['maAffiche', 'maNews', 'maGuide', 'maOther']

/** 同人工具站，標明身分與聯絡方式；請求間隔 250ms，不造成負擔 */
const UA = 'mecharashi-tools/1.0 (fan wiki; contact: github.com/GitFenix1113/mecharashi-tools)'
const DELAY_MS = 250
const MAX_PAGES = 60           // 實測 maAffiche 26 頁，留足餘裕；連續空頁即停
const INCREMENTAL_PAGES = 3    // 增量模式只掃前幾頁；再舊的必然已在庫裡

const DRAFTS = 'announcementDrafts'
const PENDING = 'pendingActivities'
const RUN_META = 'meta/announcementScrape'
const TTL_MONTHS = 6
const MAX_RAW_TEXT_BYTES = 200_000
const ARCHIVE_DIR = resolve(ROOT, '_local-notes', '2026-08', 'tw-announcements-archive')

// ── 參數 ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const REPARSE = args.includes('--reparse')
const FROM_ARCHIVE = args.includes('--from-archive')
const BACKFILL = (args.find(a => a.startsWith('--backfill=')) || '').split('=')[1] || null
const LIMIT = Number((args.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity
const FAIL_ON_WARN = args.includes('--fail-on-warn')

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── Firebase ────────────────────────────────────────────────────────────────

function loadEnv(filename) {
  const envPath = resolve(ROOT, filename)
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const k = line.slice(0, eq).trim()
    const v = line.slice(eq + 1).trim()
    if (k && v && !k.startsWith('#')) process.env[k] = v
  }
}

function initFirebase() {
  loadEnv('.env')
  loadEnv('.env.migration')
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS 未設定')
  const abs = resolve(ROOT, credPath)
  if (!fs.existsSync(abs)) throw new Error(`找不到服務帳號金鑰：${abs}`)
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(abs, 'utf-8'))) })
  return admin.firestore()
}

// ── HTTP ────────────────────────────────────────────────────────────────────

/**
 * 帶重試與鏡像備援的 fetch。404 在 allow404 時回 null（用於分頁探底）。
 * 帶 etag 時送條件式請求，304 回 { notModified: true }。
 */
async function get(urlPath, { allow404 = false, etag = null } = {}) {
  const hosts = [HOST, MIRROR]
  let lastErr
  for (let attempt = 0; attempt < hosts.length * 2; attempt++) {
    const host = hosts[attempt % hosts.length]
    try {
      const headers = { 'User-Agent': UA }
      if (etag) headers['If-None-Match'] = etag
      const res = await fetch(host + urlPath, { headers })
      if (res.status === 304) return { notModified: true }
      if (res.status === 404) {
        if (allow404) return null
        throw new Error(`404 ${urlPath}`)
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${urlPath}`)
      return {
        body: await res.text(),
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
      }
    } catch (err) {
      lastErr = err
      if (allow404 && String(err.message).startsWith('404')) return null
      await sleep(400 * (attempt + 1))
    }
  }
  throw lastErr
}

// ── 清單 ────────────────────────────────────────────────────────────────────

async function fetchListPage(type, page) {
  const p = `/jx/${type}/index${page === 1 ? '' : '_' + page}.html`
  const res = await get(p, { allow404: true })
  if (!res || !res.body) return null
  try {
    const parsed = JSON.parse(res.body)
    return Array.isArray(parsed) ? parsed : (parsed.list ?? [])
  } catch {
    // 不是 JSON → 已到底（有些型別只有 1 頁，超出後回的是 HTML 錯誤頁）
    return null
  }
}

async function fetchList(maxPages) {
  const items = []
  for (const type of TYPES) {
    for (let page = 1; page <= maxPages; page++) {
      let rows
      try {
        rows = await fetchListPage(type, page)
      } catch (err) {
        console.error(`  ✗ ${type} p${page} 清單失敗：${err.message}`)
        break
      }
      if (rows == null || rows.length === 0) break
      items.push(...rows.map(r => ({ ...r, type: r.type ?? type })))
      await sleep(DELAY_MS)
    }
  }
  return items
}

function readArchiveList() {
  const p = path.join(ARCHIVE_DIR, 'index.json')
  if (!fs.existsSync(p)) throw new Error(`找不到本地歸檔：${p}`)
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

// ── 正文 ────────────────────────────────────────────────────────────────────

/**
 * 從詳情頁 HTML 取出正文純文字。
 * 抓不到 .content 就退回整頁去標籤（寧可多存也不要丟資訊），但回報 selectorMiss ——
 * 那是官網改版的徵兆，靜默降級才是最糟的處理方式。
 */
export function extractText(html) {
  const m = html.match(/<div[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<footer|<script|$)/i)
  const selectorMiss = !m
  const inner = m ? m[1] : html
  const text = decodeEntities(
    inner
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return { text, selectorMiss }
}

/** 清單的 time 是 'YYYY-MM.DD' 這種怪格式，正規化成全站慣例的 YYYY/MM/DD */
export function normalizePublishedAt(time) {
  const m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(String(time ?? ''))
  if (!m) return undefined
  const p = n => String(Number(n)).padStart(2, '0')
  return `${m[1]}/${p(m[2])}/${p(m[3])}`
}

const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex')

function truncateRaw(text) {
  if (Buffer.byteLength(text, 'utf8') <= MAX_RAW_TEXT_BYTES) return { text, truncated: false }
  return { text: Buffer.from(text, 'utf8').subarray(0, MAX_RAW_TEXT_BYTES).toString('utf8'), truncated: true }
}

function addMonths(date, n) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + n)
  return d
}

// ── 版本推測 ────────────────────────────────────────────────────────────────

/**
 * 依活動起始日推測該落在哪個版本的哪一半。**只是預填**，後台可改；
 * 推不出來就留 undefined 並讓該筆進 needsReview —— 猜錯版本比沒猜更難發現。
 */
export function guessTarget(startDate, versions) {
  if (!startDate) return {}
  const t = new Date(startDate.replace(/\//g, '-')).getTime()
  if (Number.isNaN(t)) return {}
  let best = null
  for (const v of versions) {
    for (const half of ['upper', 'lower']) {
      const d = v[half]?.twDate
      if (!d || v[half]?.twIsPredicted) continue
      const ts = new Date(String(d).replace(/^[^0-9]+/, '').replace(/\//g, '-')).getTime()
      if (Number.isNaN(ts) || ts > t) continue
      if (!best || ts > best.ts) best = { ts, versionId: v.id, half }
    }
  }
  return best ? { targetVersion: best.versionId, targetHalf: best.half } : {}
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function loadExistingDrafts(db) {
  const map = new Map()
  const snap = await db.collection(DRAFTS).get()
  snap.forEach(d => map.set(d.id, d.data()))
  return map
}

async function main() {
  // --dry-run 只保證「不寫」，不代表「不連線」：--reparse 的 rawText 就存在
  // Firestore 的草稿裡，沒有 db 就一篇都撈不到，整個預演空轉成 0 篇。
  // 真正能離線跑的只有 --from-archive（語料在本機）。
  const db = DRY_RUN && FROM_ARCHIVE ? null : initFirebase()

  // ① 取得公告清單
  let list
  if (FROM_ARCHIVE) {
    list = readArchiveList()
    console.log(`── 本地歸檔：${list.length} 篇 ──`)
  } else if (REPARSE) {
    list = []
  } else {
    const pages = BACKFILL ? MAX_PAGES : INCREMENTAL_PAGES
    console.log(`── 抓取清單（每型別最多 ${pages} 頁）──`)
    list = await fetchList(pages)
    console.log(`   共 ${list.length} 篇`)
    if (list.length === 0) {
      // 一篇都沒抓到 ＝ 網域收掉或改版，不是「這週沒公告」。中止而不是靜默成功。
      console.error('✗ 清單一篇都沒抓到 —— 網域可能已收掉或改版。中止。')
      process.exitCode = 1
      return
    }
  }

  const existing = db ? await loadExistingDrafts(db) : new Map()

  // ② 決定要處理哪些
  let targets
  if (REPARSE) {
    targets = [...existing.entries()]
      .filter(([, d]) => d.rawText)
      .map(([id, d]) => ({ id, fromDraft: d }))
    console.log(`── 重新解析既有草稿 ${targets.length} 篇（解析器 v${PARSER_VERSION}）──`)
  } else {
    targets = list
      .filter(it => !BACKFILL || String(it.time ?? '').replace('.', '-') >= BACKFILL)
      .map(it => ({ id: `tw_${it.id}`, item: it }))
  }
  targets = targets.slice(0, LIMIT)

  // 版本清單供 guessTarget 使用（推不出來就留白，不猜）
  let versions = []
  if (db) {
    const vs = await db.collection('patchVersions').get()
    versions = vs.docs.map(d => ({ id: d.id, ...d.data() }))
  }

  // ③ 逐篇抓取 → 解析
  const now = new Date()
  const expireAt = addMonths(now, TTL_MONTHS)
  const results = []
  let fetched = 0, skipped = 0, failed = 0

  for (const t of targets) {
    let title, publishedAt, sourceUrl, channel, officialId, rawText, selectorMiss = false, etag, lastModified

    if (t.fromDraft) {
      ({ title, publishedAt, sourceUrl, channel, officialId, rawText } = t.fromDraft)
    } else {
      const it = t.item
      channel = it.type
      officialId = String(it.id)
      title = decodeEntities(it.title ?? '')
      publishedAt = normalizePublishedAt(it.time)
      sourceUrl = HOST + it.url

      const prev = existing.get(t.id)
      let html
      if (FROM_ARCHIVE) {
        const p = path.join(ARCHIVE_DIR, 'raw', channel, `${officialId}.html`)
        if (!fs.existsSync(p)) { skipped++; continue }
        html = fs.readFileSync(p, 'utf8')
      } else {
        try {
          const res = await get(it.url, { etag: prev?.etag ?? null })
          if (res?.notModified) { skipped++; continue }
          html = res.body
          etag = res.etag ?? undefined
          lastModified = res.lastModified ?? undefined
        } catch (err) {
          failed++
          console.error(`  ✗ ${t.id} 抓取失敗：${err.message}`)
          continue
        }
        await sleep(DELAY_MS)
      }
      const ex = extractText(html)
      rawText = ex.text
      selectorMiss = ex.selectorMiss
      fetched++
    }

    const trunc = truncateRaw(rawText)
    const contentHash = sha256(trunc.text)
    const prev = existing.get(t.id)

    // contentHash 是冪等判斷的**唯一依據** —— 不比對 fetchedAt、不比對 ETag。
    // 重爬必然命中同一份文件，內容沒變就整篇跳過。
    if (!REPARSE && prev && prev.contentHash === contentHash && prev.parserVersion === PARSER_VERSION) {
      skipped++
      continue
    }

    const parsed = parseAnnouncement({ title, text: trunc.text, sourceUrl })
    if (selectorMiss) parsed.warnings.push('contentSelectorMiss')

    for (const a of parsed.activities) {
      a.target = guessTarget(a.extracted.startDate, versions)
      // 推不出版本就別讓它自動放行 —— 合併時沒有目標版本可寫，等於一定要人工經手
      if (!a.target.targetVersion) a.status = 'needsReview'
    }

    results.push({
      id: t.id,
      draft: {
        id: t.id,
        source: 'tw',
        channel,
        officialId,
        title,
        publishedAt,
        sourceUrl,
        rawText: trunc.text,
        rawTextTruncated: trunc.truncated || undefined,
        contentHash,
        status: parsed.activities.length > 0 ? 'parsed' : (parsed.warnings.length ? 'parseFailed' : 'parsed'),
        parserVersion: PARSER_VERSION,
        activityCount: parsed.activities.length,
        unmatched: parsed.unmatched,
        warnings: parsed.warnings,
        fetchedAt: prev?.fetchedAt ?? now,
        parsedAt: now,
        expireAt,
        etag,
        lastModified,
      },
      activities: parsed.activities,
      // 不收錄的數量要一路傳到 report —— 回歸偵測的分母靠它與我們的取捨脫鉤
      excluded: parsed.excluded ?? 0,
      supersede: Boolean(prev && prev.contentHash !== contentHash),
    })
  }

  // ④ 產出量監控（任務 2-6）—— 爬蟲失效時不報錯，只會靜默降低品質
  const report = buildReport(results)
  const prevRun = db ? (await db.doc(RUN_META).get()).data() : null
  const regressed = checkRegression(report, prevRun)
  printReport(report, regressed, { fetched, skipped, failed })

  const failures = structuralFailures(report, regressed, { fetched, skipped, failed })
  if (FAIL_ON_WARN && failures.length > 0) {
    console.error(`\n✗ 結構性異常：${failures.join('、')}`)
    process.exitCode = 1
  }

  if (results.length === 0) {
    console.log('\n沒有需要寫入的變更。')
    return
  }
  // --from-archive --dry-run 是**離線**模式，根本沒有 db 可查，到此為止
  if (!db) {
    console.log('\n（離線預演：未連線 Firestore，僅驗證解析結果）')
    return
  }
  // 其餘的 --dry-run 不在這裡 return —— 下面的既有活動查詢是唯讀的，跑完才能回答
  // 預演真正該回答的問題：「這次會覆寫掉什麼、有哪些已合併的東西解析結果變了」。
  // 只有 batch.commit() 與 RUN_META 被跳過（見迴圈末）。

  // ⑤ 寫入
  let written = 0
  let preserved = 0
  const restaled = []   // 已處理、但重跑後解析結果變了 —— 正式資料可能要人工回頭改
  const orphaned = []   // 規則改過後不再產生的既有待審 —— 標 superseded，退出待審清單
  for (const r of results) {
    const batch = db.batch()
    if (regressed) r.draft.warnings = [...new Set([...r.draft.warnings, 'yieldRegression'])]
    batch.set(db.collection(DRAFTS).doc(r.id), stripUndefined(r.draft))

    // 既有待審活動：supersede 與「保護已處理狀態」都要用，一次查完免得查兩輪
    const prevActivities = new Map()
    if (r.supersede || REPARSE) {
      const old = await db.collection(PENDING).where('draftId', '==', r.id).get()
      old.forEach(d => prevActivities.set(d.id, d.data()))
    }

    // 官方改稿：舊的待審活動若還沒被合併就標 superseded（已合併的保留收據，不動）
    if (r.supersede) {
      for (const [id, prevA] of prevActivities) {
        if (prevA.status !== 'merged' && prevA.status !== 'rejected') {
          batch.update(db.collection(PENDING).doc(id), { status: 'superseded' })
        }
      }
    }

    for (const a of r.activities) {
      const pendingId = `${r.id}_${a.seq}`
      const prevA = prevActivities.get(pendingId)

      // 已合併／已忽略的是**收據**，記的是「當時人工放行了什麼」——
      // 重跑不能把它覆寫回待審，否則使用者會重複合併，而且分不出哪些已經進正式資料。
      // 這與上面 supersede 的原則一致；先前只有 supersede 那半邊有保護，
      // 於是 --reparse（唯一會走到這裡的路徑）會把「已合併」整批打回「可直接放行」。
      if (prevA && (prevA.status === 'merged' || prevA.status === 'rejected')) {
        preserved++
        // 收據不動，但解析結果若真的變了要講出來 —— 正式資料現在可能是錯的，
        // 而使用者沒有別的管道會發現（收據長得跟合併當下一模一樣）。
        const before = prevA.extracted ?? {}
        const after = a.extracted
        const changed = ['name', 'type', 'startDate', 'weeks']
          .filter(k => (before[k] ?? null) !== (after[k] ?? null))
        if (changed.length) {
          restaled.push({
            id: pendingId,
            status: prevA.status,
            title: r.draft.title,
            changed: changed.map(k => `${k}: ${before[k] ?? '∅'} → ${after[k] ?? '∅'}`),
          })
        }
        continue
      }

      batch.set(db.collection(PENDING).doc(pendingId), stripUndefined({
        id: pendingId,
        draftId: r.id,
        source: 'tw',
        seq: a.seq,
        status: a.status,
        flags: a.flags,
        extracted: a.extracted,
        excerpt: a.excerpt,
        excerptStart: a.excerptStart,
        rawTypeLabel: a.rawTypeLabel,
        ...a.target,
        // 重跑不該偽造「首次出現時間」——同 draft.fetchedAt 的處理
        createdAt: prevA?.createdAt ?? now,
        expireAt,
      }))
    }
    // 規則改過之後「不再產生」的既有待審 —— 例如多爾沙龍改判為儲值促銷（不收錄），
    // 它原本那筆 pendingActivity 不會被上面的迴圈碰到，就這樣孤零零留在待審清單裡，
    // 每次審核都得手動忽略一次。標成 superseded：它不在後台任何分頁的篩選條件內，
    // 會安靜消失但痕跡還在（不刪，才查得出「當初為什麼有這筆」）。
    const producedIds = new Set(r.activities.map(a => `${r.id}_${a.seq}`))
    for (const [id, prevA] of prevActivities) {
      if (producedIds.has(id)) continue
      // 收據與已標記的不動 —— 同前面「已合併的保留收據」的原則
      if (['merged', 'rejected', 'superseded'].includes(prevA.status)) continue
      batch.update(db.collection(PENDING).doc(id), { status: 'superseded' })
      orphaned.push({ id, name: prevA.extracted?.name ?? '（無名）', type: prevA.extracted?.type ?? '—' })
    }

    if (!DRY_RUN) await batch.commit()
    written++
  }
  console.log(
    DRY_RUN
      ? `\n（--dry-run：未寫入）將寫入 ${written} 篇草稿、${report.activities} 筆待審活動`
      : `\n✔ 已寫入 ${written} 篇草稿、${report.activities} 筆待審活動`
  )
  if (preserved) {
    console.log(`   （保留 ${preserved} 筆已合併／已忽略的收據，未覆寫）`)
  }
  if (orphaned.length) {
    const byName = {}
    for (const o of orphaned) byName[o.name] = (byName[o.name] ?? 0) + 1
    const top = Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 8)
    console.log(`   （${orphaned.length} 筆待審因規則改變而不再產生，已標 superseded 退出清單）`)
    for (const [name, n] of top) console.log(`       ${n}× ${name}`)
  }
  if (restaled.length) {
    // 這是重跑後唯一需要人工介入的東西，所以印得刺眼一點：收據不會自己更新，
    // 正式資料裡那幾筆現在是舊解析器的產物。
    console.log(`\n⚠  ${restaled.length} 筆已處理的活動，解析結果已與收據不同 —— 正式資料可能要回頭改：`)
    for (const s of restaled) {
      console.log(`   · ${s.id}（${s.status}）${s.title}`)
      for (const c of s.changed) console.log(`       ${c}`)
    }
  }

  // ⚠ dry-run 絕不能寫這裡：RUN_META 是產出量監控的比較基準，
  // 一次預演就會把基準墊高，下次真跑的回歸偵測跟著失準（自己污染自己）。
  if (DRY_RUN) return
  await db.doc(RUN_META).set({
    at: admin.firestore.FieldValue.serverTimestamp(),
    parserVersion: PARSER_VERSION,
    announcements: report.announcements,
    activities: report.activities,
    excluded: report.excluded,
    perAnnouncement: report.perAnnouncement,
    parsedPerAnnouncement: report.parsedPerAnnouncement,
  }, { merge: true })
}

/** Firestore 不接受 undefined；遞迴清掉（同 firestoreCore.stripUndefined 的作用） */
function stripUndefined(obj) {
  if (Array.isArray(obj)) return obj.map(stripUndefined)
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue
      out[k] = stripUndefined(v)
    }
    return out
  }
  return obj
}

function buildReport(results) {
  const flags = {}, warnings = {}
  let activities = 0, clean = 0, noTarget = 0, excluded = 0
  for (const r of results) {
    activities += r.activities.length
    excluded += r.excluded ?? 0
    for (const a of r.activities) {
      if (a.flags.length === 0) clean++
      if (!a.target?.targetVersion) noTarget++
      for (const f of a.flags) flags[f] = (flags[f] ?? 0) + 1
    }
    for (const w of r.draft.warnings) warnings[w] = (warnings[w] ?? 0) + 1
  }
  return {
    announcements: results.length,
    activities,
    excluded,
    clean,
    noTarget,
    /** 收錄量（顯示用） */
    perAnnouncement: results.length ? Number((activities / results.length).toFixed(2)) : 0,
    /**
     * 解析量＝收錄 + 不收錄（**回歸偵測用**）。
     *
     * 為什麼不能拿收錄量去比：那會把「我們改了不收錄規則」誤判成「解析器瞎了」。
     * 實測踩過 —— topUpEvent 改為不收錄的那一次，收錄量從 2.23 掉到 1.56（-30%），
     * 直接觸發 yieldRegression 假警報，而解析器其實一個字都沒少讀。
     * 體檢報告的分母必須與我們自己的取捨脫鉤。
     */
    parsedPerAnnouncement: results.length
      ? Number(((activities + excluded) / results.length).toFixed(2))
      : 0,
    flags,
    warnings,
    lowYield: results.filter(r => r.draft.warnings.includes('lowYield')).map(r => r.draft.title),
  }
}

/**
 * 哪些狀況該讓排程「紅燈」。
 *
 * 刻意**只收結構性異常**，不收逐篇的 lowYield / pilotSectionNoName ——
 * 那三種在歷史語料上各有 6～7% 的自然發生率（真的就是只有預告沒有檔期的公告），
 * 拿來當 CI 紅燈等於每七週寄一封狼來了。**學會忽略的告警比沒有告警更糟。**
 * 它們仍然存在，只是出現在後台工作檯的 ⚠ 標籤上 —— 那裡才是能對它做事的地方。
 *
 * 而「解析器整個瞎掉」這個真正要防的情境，會被 yieldRegression 接住
 * （產出量掉到前次的八成以下），不需要 lowYield 重複把關。
 */
function structuralFailures(report, regressed, io) {
  const reasons = []
  if (io.failed > 0) reasons.push(`${io.failed} 篇抓取失敗`)
  if (regressed) reasons.push('解析率較前次下滑逾 20%')
  if (report.warnings.contentSelectorMiss) reasons.push('正文選擇器失效（官網可能改版）')
  return reasons
}

/**
 * 「本次執行的解析成功率低於前次 20%」。
 * 只看 HTTP 200 是看不出解析器已經瞎了的 —— 句型逐年漂移，
 * 網站好好的、請求都成功，產出卻悄悄掉到剩一半。
 */
export function checkRegression(report, prevRun) {
  // 舊執行記錄可能只有 perAnnouncement（v1 格式）；沒有 parsedPerAnnouncement 就退回它，
  // 但那一次比較可能因為改過收錄規則而失真，屬可接受的一次性誤差。
  const prev = prevRun?.parsedPerAnnouncement ?? prevRun?.perAnnouncement
  if (!prev || report.announcements === 0) return false
  return report.parsedPerAnnouncement < prev * 0.8
}

function printReport(report, regressed, io) {
  console.log('\n── 產出量報告 ──')
  console.log(`  抓取 ${io.fetched}／跳過 ${io.skipped}／失敗 ${io.failed}`)
  console.log(`  公告 ${report.announcements} 篇 → 活動 ${report.activities} 筆（${report.perAnnouncement}/篇）`)
  if (report.excluded) {
    console.log(`  另有 ${report.excluded} 筆解析得出但不收錄（儲值促銷）—— 已計入回歸偵測的分母`)
  }
  if (report.activities) {
    console.log(`  零 flag 可直接放行 ${report.clean}（${(100 * report.clean / report.activities).toFixed(0)}%）`)
    console.log(`  推不出目標版本 ${report.noTarget}（一律進 needsReview）`)
  }
  const f = Object.entries(report.flags).sort((a, b) => b[1] - a[1])
  if (f.length) console.log('  flag：' + f.map(([k, v]) => `${k}×${v}`).join('  '))
  const w = Object.entries(report.warnings).sort((a, b) => b[1] - a[1])
  if (w.length) console.log('  ⚠ 告警：' + w.map(([k, v]) => `${k}×${v}`).join('  '))
  for (const t of report.lowYield) console.log(`  ⚠ 產出過低：${t}`)
  if (regressed) console.log('  ⚠ 解析率較前次下滑逾 20% —— 官網句型可能已漂移，請查解析器規則')
}

main().catch(err => {
  console.error('✗ 未預期的錯誤：', err)
  process.exitCode = 1
})
