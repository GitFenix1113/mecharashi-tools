// PLAN-022 A-2：numRefs 數值引用層單元測試
// 以 Node 內建測試執行器跑（Node 24 原生 type stripping）：
//   npm test   →   node --test "src/**/*.test.ts"
// 本檔已從 tsconfig.app build 排除（exclude: src/**/*.test.ts），不影響 vite/tsc 打包。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NUM_ATTRS,
  hasNumRef,
  parseNumRefs,
  resolveNumValue,
  resolveNumRefs,
  orderRefsByFirstMention,
  compileSugar,
  detectLeftoverSugar,
} from './numRefs.ts'
import type { NumRefSource } from './numRefs.ts'

// 模擬 GameDataContext 的 buff 查詢
const BUFFS: Record<string, NumRefSource> = {
  buff_凝勢I: { maxStack: 5, duration: 2 },
  buff_凝勢II: { maxStack: 7, duration: 3 },
  buff_凝勢III: { maxStack: 7 }, // 無 duration
  buff_星爆: { maxStack: 3 },
}
const lookup = (refId: string) => BUFFS[refId]

// [xxx] → 引用對照（DescriptionRefs 形狀）
const refs = {
  凝勢I: { refType: 'buff', refId: 'buff_凝勢I' },
  星爆: { refType: 'buff', refId: 'buff_星爆' },
}

// ─── registry ────────────────────────────────────────────────────────────────

test('NUM_ATTRS：起步兩筆，sigil 不重複', () => {
  assert.equal(NUM_ATTRS.maxStack.sigil, '$')
  assert.equal(NUM_ATTRS.duration.sigil, '%')
  const sigils = Object.values(NUM_ATTRS).map((d) => d.sigil)
  assert.equal(new Set(sigils).size, sigils.length)
})

test('hasNumRef：偵測 <refId.attr> token，[xxx] / 純文字不誤判', () => {
  assert.equal(hasNumRef('可疊加<buff_凝勢I.maxStack>層'), true)
  assert.equal(hasNumRef('攜帶[凝勢I]觸發'), false)
  assert.equal(hasNumRef('可疊加5層'), false)
})

// ─── resolveNumValue / resolveNumRefs（顯示讀真值） ──────────────────────────────

test('resolveNumValue：取真值 / 查無 / 無值 / 未知屬性皆優雅降級', () => {
  assert.equal(resolveNumValue('buff_凝勢I', 'maxStack', lookup), 5)
  assert.equal(resolveNumValue('buff_凝勢I', 'duration', lookup), 2)
  assert.equal(resolveNumValue('buff_不存在', 'maxStack', lookup), undefined) // refId 失效
  assert.equal(resolveNumValue('buff_凝勢III', 'duration', lookup), undefined) // 屬性無值
  assert.equal(resolveNumValue('buff_凝勢I', 'cd', lookup), undefined) // 未在 registry
})

test('resolveNumRefs：token 換成真值，原文逐字還原', () => {
  assert.equal(resolveNumRefs('可疊加<buff_凝勢I.maxStack>層', lookup), '可疊加5層')
  assert.equal(
    resolveNumRefs('可疊加<buff_凝勢II.maxStack>層，持續<buff_凝勢II.duration>回合', lookup),
    '可疊加7層，持續3回合',
  )
})

test('resolveNumRefs：同一 token 不限出現次數', () => {
  assert.equal(resolveNumRefs('<buff_凝勢I.maxStack>+<buff_凝勢I.maxStack>', lookup), '5+5')
})

test('resolveNumRefs：失效 token → fallback（預設 ?，可自訂）', () => {
  assert.equal(resolveNumRefs('上限<buff_不存在.maxStack>層', lookup), '上限?層')
  assert.equal(resolveNumRefs('<buff_凝勢III.duration>', lookup), '?') // 屬性無值
  assert.equal(resolveNumRefs('<buff_凝勢I.cd>', lookup), '?') // 未知屬性
  assert.equal(resolveNumRefs('<buff_不存在.maxStack>', lookup, '—'), '—') // 自訂 fallback
})

test('resolveNumRefs：純文字 / 無 token 原樣回傳', () => {
  assert.equal(resolveNumRefs('攜帶5層及以上時觸發', lookup), '攜帶5層及以上時觸發')
  assert.equal(resolveNumRefs('', lookup), '')
})

// ─── parseNumRefs（結構化片段，供 RefText） ────────────────────────────────────

test('parseNumRefs：text / numRef 片段交錯，refId 含中文+底線、attr 為 ASCII', () => {
  assert.deepEqual(parseNumRefs('可疊加<buff_凝勢I.maxStack>層'), [
    { type: 'text', value: '可疊加' },
    { type: 'numRef', raw: '<buff_凝勢I.maxStack>', refId: 'buff_凝勢I', attr: 'maxStack' },
    { type: 'text', value: '層' },
  ])
})

test('parseNumRefs：連續 token / 開頭即 token / refId 含羅馬數字', () => {
  assert.deepEqual(parseNumRefs('<buff_凝勢III.maxStack>'), [
    { type: 'numRef', raw: '<buff_凝勢III.maxStack>', refId: 'buff_凝勢III', attr: 'maxStack' },
  ])
  assert.equal(parseNumRefs('純文字').length, 1)
})

// ─── orderRefsByFirstMention（編號 = [xxx] 首次出現順序） ─────────────────────────

test('orderRefsByFirstMention：依首次出現排序、去重、略過無引用者', () => {
  assert.deepEqual(orderRefsByFirstMention('攜帶[凝勢I]再引爆[星爆]', refs), [
    'buff_凝勢I',
    'buff_星爆',
  ])
  // 反序出現 → 依文字順序
  assert.deepEqual(orderRefsByFirstMention('[星爆]與[凝勢I]', refs), ['buff_星爆', 'buff_凝勢I'])
  // 同一個 [xxx] 多次 → 只算一次
  assert.deepEqual(orderRefsByFirstMention('[凝勢I]…[凝勢I]…[凝勢I]', refs), ['buff_凝勢I'])
  // refs 查無的 [xxx] 略過（不佔編號）
  assert.deepEqual(orderRefsByFirstMention('[未知詞][凝勢I]', refs), ['buff_凝勢I'])
})

// ─── compileSugar（語法糖 → 正式 token，編輯期一次性） ──────────────────────────

test('compileSugar：$n → maxStack、%n → duration token', () => {
  assert.equal(compileSugar('可疊加$1層', ['buff_凝勢I']), '可疊加<buff_凝勢I.maxStack>層')
  assert.equal(compileSugar('持續%1回合', ['buff_凝勢I']), '持續<buff_凝勢I.duration>回合')
  assert.equal(
    compileSugar('可疊加$1層，持續%1回合', ['buff_凝勢I']),
    '可疊加<buff_凝勢I.maxStack>層，持續<buff_凝勢I.duration>回合',
  )
})

test('compileSugar：$n 指向第 n 個引用', () => {
  assert.equal(compileSugar('$1與$2', ['buff_凝勢I', 'buff_星爆']), '<buff_凝勢I.maxStack>與<buff_星爆.maxStack>')
})

test('compileSugar：n 超出範圍 → 原樣保留（交給殘留偵測）', () => {
  assert.equal(compileSugar('可疊加$3層', ['buff_凝勢I']), '可疊加$3層')
})

test('compileSugar：%n 編譯、百分比 15% 不誤判', () => {
  assert.equal(
    compileSugar('造成15%傷害，最多疊$1層持續%1回合', ['buff_凝勢I']),
    '造成15%傷害，最多疊<buff_凝勢I.maxStack>層持續<buff_凝勢I.duration>回合',
  )
})

test('compileSugar → resolveNumRefs round-trip：原文一份、數字讀 buff（5 vs 7 漂移消失）', () => {
  // 同一句語法糖，綁不同階 buff → 顯示各自真值，正文不需重抄
  const sugar = '可疊加$1層'
  assert.equal(resolveNumRefs(compileSugar(sugar, ['buff_凝勢I']), lookup), '可疊加5層')
  assert.equal(resolveNumRefs(compileSugar(sugar, ['buff_凝勢II']), lookup), '可疊加7層')
})

// ─── detectLeftoverSugar（儲存前防呆） ──────────────────────────────────────────

test('detectLeftoverSugar：偵測未代入的 $n / %n', () => {
  assert.deepEqual(detectLeftoverSugar('可疊加$1層持續%2回合'), ['$1', '%2'])
})

test('detectLeftoverSugar：百分比 50% / 15% 不誤報', () => {
  assert.deepEqual(detectLeftoverSugar('造成50%傷害，再提升15%'), [])
})

test('detectLeftoverSugar：已編譯成 token 的正文無殘留', () => {
  assert.deepEqual(detectLeftoverSugar('可疊加<buff_凝勢I.maxStack>層'), [])
  assert.deepEqual(detectLeftoverSugar(compileSugar('可疊加$1層', ['buff_凝勢I'])), [])
})

test('detectLeftoverSugar：引用不足時，未代入者仍被抓出', () => {
  assert.deepEqual(detectLeftoverSugar(compileSugar('$1與$2', ['buff_凝勢I'])), ['$2'])
})
