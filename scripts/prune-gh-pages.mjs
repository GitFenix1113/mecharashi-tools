#!/usr/bin/env node
/**
 * gh-pages 退役檔清理（deploy.yml 用）——PLAN-054 D-4 ＋ 2026-10-04「gh-pages 舊 bundle 清理評估」
 *
 *   node scripts/prune-gh-pages.mjs --ghp /tmp/ghp --dist dist --dirs assets:30,images:14 \
 *     --ledger-out dist/.prune-ledger.json --delete-list /tmp/prune.txt [--now 2026-10-04T00:00:00Z]
 *
 * ── 為什麼需要 ──────────────────────────────────────────────────────────────
 * 部署用 peaceiris 的 `keep_files: true`（為了保住 preview/ 與開著舊分頁的人要的舊 chunk），
 * 代價是 gh-pages **只疊加、不刪除**：repo 刪掉或搬走的檔永遠留在線上（2026-10 實測 assets/ 258 MB
 * 只有 3 MB 在用、images/ 有 163 MB 孤兒），刪檔在線上等於沒做，Purge 也救不了（origin 還在送）。
 *
 * ── 怎麼算「可以刪」──────────────────────────────────────────────────────────
 * 維護一份 ledger，記錄每個檔案**被新版取代的時間**（＝第一個不再包含它的部署；不是最後一次包含它的
 * 部署——兩者之間它一直在線上服務），退役滿寬限天數才刪。所以「一天部署十幾次」「隔兩個月才部署」
 * 都不會誤刪：計時永遠從「這個檔案停止被線上版本引用」開始。
 * 第一次執行沒有 ledger → 所有不在本次 build 的檔案都從「今天」開始倒數（保守起算，等於內建一段 dry-run）。
 *
 * ── 範圍 ────────────────────────────────────────────────────────────────────
 * 只動 --dirs 列出的根目錄子資料夾（assets、images）。preview/、docs/（另有自己的清理步驟）、根目錄檔案一概不碰。
 * ledger 依目錄分區，各自的寬限天數由 --dirs 給。
 *
 * ⚠ 寬限期的另一半保險在前台：src/main.tsx 的 vite:preloadError 自動重新整理（舊分頁的 lazy chunk 被刪時）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DAY = 86_400_000

/**
 * 純函式：依「本次 build 有哪些檔」「線上有哪些檔」「ledger」算出下一份 ledger 與要刪的檔。
 * @param {{ built: Set<string>, onSite: string[], book: Record<string, number|null>, now: number, graceMs: number }} a
 * @returns {{ next: Record<string, number|null>, del: string[], grace: string[] }}
 */
export function plan({ built, onSite, book, now, graceMs }) {
  const next = {}, del = [], grace = []
  for (const f of onSite) {
    if (built.has(f)) { next[f] = null; continue }      // 新版仍包含（或被回滾帶回來）→ 在用
    const retiredAt = book[f] ?? now                     // 沒紀錄、或上一版還在用 → 從這次起算
    if (now - retiredAt >= graceMs) del.push(f)
    else { next[f] = retiredAt; grace.push(f) }
  }
  for (const f of built) next[f] = null                  // 這次新增的檔
  return { next, del, grace }                            // 線上已不存在的條目自然從 ledger 消失
}

/** dir 底下所有檔案的相對路徑（POSIX 斜線）；不存在回 [] */
export function listFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(d, e.name), r)
      else out.push(r)
    }
  }
  walk(dir, '')
  return out
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
    return acc
  }, []))
  for (const k of ['ghp', 'dist', 'dirs', 'ledger-out', 'delete-list']) {
    if (!args[k] || args[k] === true) { console.error(`❌ 缺少 --${k}`); process.exit(1) }
  }
  const now = args.now ? Date.parse(args.now) : Date.now()
  const ledgerIn = path.join(args.ghp, '.prune-ledger.json')
  const ledger = fs.existsSync(ledgerIn) ? JSON.parse(fs.readFileSync(ledgerIn, 'utf-8')) : {}
  const firstRun = !fs.existsSync(ledgerIn)
  const size = (root, rel) => { try { return fs.statSync(path.join(root, rel)).size } catch { return 0 } }
  const MB = (b) => (b / 1048576).toFixed(1)
  const deletions = []

  for (const spec of String(args.dirs).split(',')) {
    const [dir, days] = spec.split(':')
    const graceMs = Number(days) * DAY
    if (!dir || !(graceMs >= 0)) { console.error(`❌ --dirs 格式是 名稱:天數，例如 assets:30（拿到 ${spec}）`); process.exit(1) }
    const built = new Set(listFiles(path.join(args.dist, dir)))
    const onSite = listFiles(path.join(args.ghp, dir))
    const { next, del, grace } = plan({ built, onSite, book: ledger[dir] ?? {}, now, graceMs })
    ledger[dir] = next
    deletions.push(...del.map((f) => `${dir}/${f}`))
    const sum = (list) => MB(list.reduce((n, f) => n + size(path.join(args.ghp, dir), f), 0))
    console.log(`[prune] ${dir}/（寬限 ${days} 天）：在用 ${built.size} 檔、寬限中 ${grace.length} 檔 ${sum(grace)} MB、本次刪除 ${del.length} 檔 ${sum(del)} MB`)
  }
  if (firstRun) console.log('[prune] 第一次執行（沒有 ledger）：所有退役檔從今天開始倒數，這次不刪任何東西')

  fs.mkdirSync(path.dirname(args['ledger-out']), { recursive: true })
  fs.writeFileSync(args['ledger-out'], JSON.stringify(ledger))
  fs.writeFileSync(args['delete-list'], deletions.join('\n') + (deletions.length ? '\n' : ''))

  // 監控：發布體積接近 GitHub Pages 的 1 GB 上限時在 Actions 標黃（只算線上現有的、刪除前）
  const total = listFiles(args.ghp).filter((f) => !f.startsWith('.git/')).reduce((n, f) => n + size(args.ghp, f), 0)
  console.log(`[prune] gh-pages 發布體積（刪除前）：${MB(total)} MB`)
  if (total > 800 * 1048576) console.log(`::warning::gh-pages 已達 ${MB(total)} MB，GitHub Pages 上限 1 GB`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
