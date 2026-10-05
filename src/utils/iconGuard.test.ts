// 守門：技能類圖示欄位不得繞過圖庫 helper 直接當圖片來源 —— PLAN-055 A-7
//   npm test   →   node --test "src/**/*.test.ts"
//
// ── 守的是什麼 ──────────────────────────────────────────────────────────────
// PLAN-055 之後，技能、天賦、神經驅動、模組、元件、背包技能、形態的圖示一律從扁平圖庫
// `game/icons/` 取（src/utils/gameIcons.ts 的 gameIconCandidates：檔名即 key）。
// DB 的 `iconLocal`／`skillIcon` 與各種舊路徑只是**後備**，而 E 階段會把 skills/、modules/、
// components/、backpacks_skills/、pilot_forms/ 這些舊資料夾整批刪掉。
// 任何一處還寫著 `assetUrl(sk.iconLocal)`、`imageCandidates(mod.icon)`，就是一張「現在看起來
// 好好的、刪檔後才破」的圖——而且只壞在那一頁。
//
// 正確寫法：<SkillIcon icon={…} iconLocal={…} />，或 gameIconCandidates(x.icon, x.iconLocal)。
//
// ── 白名單 ──────────────────────────────────────────────────────────────────
// helper 本身與後台（編輯這些欄位本來就要讀原值；後台的選圖器由 B 階段換成 GameIconPicker）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ALLOW = [
  'utils/assets.ts',
  'utils/gameIcons.ts',
  'components/admin/',
  'pages/user/admin/',
]

const SINK = String.raw`(?:imageCandidates|assetUrl|resolveIconSrc)\(`
/** 把技能類圖示欄位直接交給圖片來源的寫法 */
const BAD = [
  new RegExp(`${SINK}[^)]*\\b(?:iconLocal|skillIcon)\\b`),
  /\bsrc=\{[^}]*\b(?:iconLocal|skillIcon)\b/,
  // 這幾個名字的 .icon 一定是技能類（武器 w.icon、背包 b.icon、機甲 portrait 不在此列）
  new RegExp(`${SINK}[^)]*\\b(?:mod|module|form|talent|comp|ability)\\??\\.icon\\b`),
  /\bsrc=\{[^}]*\b(?:mod|module|form|talent|comp|ability)\??\.icon\b/,
]

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) yield p
  }
}

test('技能類圖示一律經過圖庫 helper，不直接讀 iconLocal／模組 icon', () => {
  const hits: string[] = []
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/')
    if (ALLOW.some((a) => rel.startsWith(a))) continue
    fs.readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return   // 註解裡的舉例不算
      if (BAD.some((re) => re.test(line))) hits.push(`${rel}:${i + 1}  ${line.trim()}`)
    })
  }
  assert.deepEqual(hits, [], '請改用 <SkillIcon icon iconLocal /> 或 src/utils/gameIcons.ts 的 gameIconCandidates')
})

test('守門規則本身抓得到典型的錯誤寫法（防止 regex 被改壞而變成永遠通過）', () => {
  const samples = [
    'src={assetUrl(iconLocal)}',
    'candidates={imageCandidates(sk.iconLocal)}',
    'images: imageCandidates(s.iconLocal, s.icon),',
    'candidates={imageCandidates(mod.icon)}',
    'src={resolveIconSrc(form.icon)}',
    'src={comp.iconLocal}',
  ]
  for (const s of samples) assert.ok(BAD.some((re) => re.test(s)), s)
  for (const ok of [
    'candidates={gameIconCandidates(mod.icon)}',
    'candidates={imageCandidates(w.icon)}',
    '<SkillIcon icon={sk.icon} iconLocal={sk.iconLocal} name={sk.name} />',
  ]) assert.ok(!BAD.some((re) => re.test(ok)), ok)
})
