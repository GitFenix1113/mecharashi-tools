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
  const db = DRY_RUN && (FROM_ARCHIVE || REPARSE) ? null : initFirebase()

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

  if (DRY_RUN) {
    console.log('\n（--dry-run：未寫入 Firestore）')
    return
  }
  if (results.length === 0) {
    console.log('\n沒有需要寫入的變更。')
    return
  }

  // ⑤ 寫入
  let written = 0
  for (const r of results) {
    const batch = db.batch()
    if (regressed) r.draft.warnings = [...new Set([...r.draft.warnings, 'yieldRegression'])]
    batch.set(db.collection(DRAFTS).doc(r.id), stripUndefined(r.draft))

    // 官方改稿：舊的待審活動若還沒被合併就標 superseded（已合併的保留收據，不動）
    if (r.supersede) {
      const old = await db.collection(PENDING).where('draftId', '==', r.id).get()
      old.forEach(d => {
        const st = d.data().status
        if (st !== 'merged' && st !== 'rejected') batch.update(d.ref, { status: 'superseded' })
      })
    }

    for (const a of r.activities) {
      batch.set(db.collection(PENDING).doc(`${r.id}_${a.seq}`), stripUndefined({
        id: `${r.id}_${a.seq}`,
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
        createdAt: now,
        expireAt,
      }))
    }
    await batch.commit()
    written++
  }
  console.log(`\n✔ 已寫入 ${written} 篇草稿、${report.activities} 筆待審活動`)

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
