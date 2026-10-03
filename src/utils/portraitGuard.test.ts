// 守門：舊路徑欄位不得直接拿去當圖片來源 —— PLAN-054 C-7
//   npm test   →   node --test "src/**/*.test.ts"
//
// ── 守的是什麼 ──────────────────────────────────────────────────────────────
// PLAN-054 之後，機師／機甲的圖一律先走官方原檔（gameId 定位），DB 裡的 `portrait`／`halfPortrait`／
// 部件 `icon` 只是**後備**，而且清舊檔階段會把它們指向的名字資料夾整批刪掉。
// 任何一處還寫著 `imageCandidates(mech.portrait)`、`src={assetUrl(pilot.portrait)}`、
// `imageCandidates(part.icon)`，就是一張「現在看起來好好的、刪檔後才破」的圖——
// 而且是在別頁都正常的情況下，只壞在那一頁。
//
// 正確寫法是 src/utils/assets.ts 的 helper：pilotPortraitCandidates／pilotPortraitPath／
// mechPortraitCandidates／mechPortraitPath／mechPartCandidates／mechPartIconPath。
//
// ── 白名單 ──────────────────────────────────────────────────────────────────
// helper 本身（assets.ts、gameArt.ts）與後台表單（編輯 portrait 這個欄位本來就要讀它）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ALLOW = [
  'utils/assets.ts',
  'utils/gameArt.ts',
  'components/admin/',
  'pages/user/admin/',
]

/** 把舊路徑欄位直接交給圖片來源的寫法 */
const BAD = [
  /(?:imageCandidates|assetUrl|resolveIconSrc)\([^)]*\.(?:portrait|halfPortrait|portraitUrl)\b/,
  /\bsrc=\{[^}]*\.(?:portrait|halfPortrait)\b/,
  /(?:imageCandidates|assetUrl|resolveIconSrc)\([^)]*\b(?:part|parts\??\.[A-Za-z]+\??)\.icon\b/,
  /\bsrc=\{[^}]*\b(?:part|parts\??\.[A-Za-z]+\??)\.icon\b/,
]

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) yield p
  }
}

test('機師／機甲圖片一律經過官方原檔 helper，不直接讀 portrait／部件 icon', () => {
  const hits: string[] = []
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/')
    if (ALLOW.some((a) => rel.startsWith(a))) continue
    fs.readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return   // 註解裡的舉例不算
      if (BAD.some((re) => re.test(line))) hits.push(`${rel}:${i + 1}  ${line.trim()}`)
    })
  }
  assert.deepEqual(hits, [], '請改用 src/utils/assets.ts 的 pilotPortrait*／mechPortrait*／mechPart* helper')
})

test('守門規則本身抓得到典型的錯誤寫法（防止 regex 被改壞而變成永遠通過）', () => {
  const samples = [
    'candidates={imageCandidates(mech.portrait)}',
    'src={assetUrl(pilot.portrait)}',
    'candidates={imageCandidates(part.icon)}',
    'partIcon={assetUrl(selectedMech.parts.torso?.icon)}',
    'images: imageCandidates(m.halfPortrait, m.portrait),',
  ]
  for (const s of samples) assert.ok(BAD.some((re) => re.test(s)), s)
  assert.ok(!BAD.some((re) => re.test('candidates={mechPortraitCandidates(mech)}')))
})
