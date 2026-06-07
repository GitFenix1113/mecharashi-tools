/**
 * docs 最後更新時間戳記注入器。
 *
 * 為 docs/ 下每份 .html 在頁尾注入「最後更新：YYYY-MM-DD」，方便日後對照 git 紀錄判斷
 * 哪些文件需要重新同步。日期來源（比較時都會先剝除時間戳區塊，避免「蓋章」本身被當成改動）：
 *   - 內容相對 HEAD 有實質變動（或全新未追蹤檔）→ 用今天
 *   - 其餘 → 該檔案 git 最後提交日（git log -1 %cs）
 *
 * 可重複執行（idempotent）：以 <!--LAST-UPDATED-->…<!--/LAST-UPDATED--> 標記區塊定位，
 * 重跑時就地更新，不會重複堆疊；且因比較前會剝除時間戳，重跑不會把歷史檔案的日期改成今天。
 * docs 內容異動後重跑即可（建議提交前跑一次）。
 *
 * 使用：node scripts/stamp-docs.mjs   或   npm run docs:stamp
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DOCS_DIR = path.join(ROOT, 'docs')

const MARKER_START = '<!--LAST-UPDATED-->'
const MARKER_END = '<!--/LAST-UPDATED-->'

const today = (() => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})()

/** repo 相對、正斜線路徑（與 git 輸出對齊） */
const toRel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')

/** 遞迴收集 docs 下所有 .html */
function collectHtml(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) collectHtml(full, out)
    else if (ent.name.toLowerCase().endsWith('.html')) out.push(full)
  }
  return out
}

/** 各檔案 git 最後提交日（單次 log 掃描，最新者優先） */
function gitLastDates() {
  const map = new Map()
  let out = ''
  try {
    out = execFileSync(
      'git',
      ['-c', 'core.quotepath=false', 'log', '--format=COMMIT:%cs', '--name-only', '--', 'docs'],
      { cwd: ROOT, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }
    )
  } catch (e) {
    console.warn('⚠️  無法讀取 git 紀錄，所有日期將回退為今天：', e.message)
    return map
  }
  let cur = today
  for (const line of out.split('\n')) {
    if (line.startsWith('COMMIT:')) cur = line.slice('COMMIT:'.length).trim()
    else {
      const p = line.trim()
      if (p && !map.has(p)) map.set(p, cur)
    }
  }
  return map
}

/** 剝除時間戳標記區塊並正規化換行，讓比較只看「真正的內容」（忽略 CRLF/LF 差異） */
function normalizeForCompare(s) {
  return s
    .replace(new RegExp(`[ \\t]*${MARKER_START}[\\s\\S]*?${MARKER_END}\\r?\\n?`, 'g'), '')
    .replace(/\r\n/g, '\n')
}

/** 取 HEAD 版本的內容；檔案全新（未追蹤）時回傳 null */
function committedContent(rel) {
  try {
    return execFileSync('git', ['show', `HEAD:${rel}`], {
      cwd: ROOT,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

function buildBlock(date, eol) {
  return [
    MARKER_START,
    `<div class="doc-updated">最後更新：${date} · 依 git 紀錄自動產生</div>`,
    MARKER_END,
  ].join(eol)
}

function main() {
  if (!fs.existsSync(DOCS_DIR)) {
    console.error(`❌ 找不到文件目錄：${DOCS_DIR}`)
    process.exit(1)
  }

  const files = collectHtml(DOCS_DIR, [])
  const dates = gitLastDates()

  const blockRe = new RegExp(`[ \\t]*${MARKER_START}[\\s\\S]*?${MARKER_END}\\r?\\n?`, 'g')
  let updated = 0, fromToday = 0, fromGit = 0

  for (const file of files) {
    const rel = toRel(file)
    let content = fs.readFileSync(file, 'utf-8')
    const eol = content.includes('\r\n') ? '\r\n' : '\n'

    // 比較（剝除時間戳、忽略換行差異後）：相對 HEAD 有實質變動 / 全新檔 → 今天；否則用 git 最後提交日
    const committed = committedContent(rel)
    const isChanged = committed === null || normalizeForCompare(content) !== normalizeForCompare(committed)
    const date = isChanged ? today : (dates.get(rel) || today)
    if (isChanged) fromToday++; else fromGit++

    const block = buildBlock(date, eol)

    if (blockRe.test(content)) {
      // 就地更新既有標記區塊
      blockRe.lastIndex = 0
      content = content.replace(blockRe, block + eol)
    } else {
      const idx = content.lastIndexOf('</body>')
      if (idx >= 0) {
        content = content.slice(0, idx) + block + eol + content.slice(idx)
      } else {
        content = content.replace(/\s*$/, '') + eol + block + eol
      }
    }

    fs.writeFileSync(file, content, 'utf-8')
    updated++
  }

  console.log(
    `✅ 已標記 ${updated} 份文件（git 日期 ${fromGit}、今天 ${fromToday}）`
  )
}

main()
