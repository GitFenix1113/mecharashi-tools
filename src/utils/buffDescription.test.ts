// PLAN-058 決策四：分級 BUFF 的各級描述是正本、頂層是選填的通用說明
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GameBuff } from '../types/buff.ts'
import { buffDescriptionView, buffLevelRefs, generalTextHasNumber } from './buffDescription.ts'

const SELF = { 鋒勢: { refType: 'buff' as const, refId: 'buff_鋒勢' } }

// 取材自正式資料的 buff_鋒勢：頂層空白、兩級描述、各級沒有自己的引用表
const 鋒勢: Pick<GameBuff, 'name' | 'description' | 'descriptionRefs' | 'levels'> = {
  name: '鋒勢',
  description: '',
  descriptionRefs: SELF,
  levels: [
    { level: 2, name: '鋒勢', description: '可消耗5層[鋒勢]…可疊加20層' },
    { level: 1, name: '鋒勢', description: '可消耗5層[鋒勢]…可疊加15層' },
  ],
}

test('指定等級：只顯示該級，不列其他級', () => {
  const v = buffDescriptionView(鋒勢, 2, undefined)
  assert.equal(v.description, '可消耗5層[鋒勢]…可疊加20層')
  assert.deepEqual(v.levelLines, [])
})

test('沒帶等級＋頂層空白：不再是空白浮窗，改列各級（依 level 排序）', () => {
  const v = buffDescriptionView(鋒勢, undefined, undefined)
  assert.equal(v.description, '')
  assert.deepEqual(v.levelLines.map((l) => l.level), [1, 2])
})

test('階名與本名相同時省略（無階名家族不重複顯示「鋒勢」）', () => {
  const v = buffDescriptionView(鋒勢, undefined, undefined)
  assert.equal(v.levelLines[0].name, undefined)
  const 凝勢 = { ...鋒勢, name: '凝勢', levels: [{ level: 3, name: '凝勢Ⅲ', description: 'x' }] }
  assert.equal(buffDescriptionView(凝勢, undefined, undefined).levelLines[0].name, '凝勢Ⅲ')
})

test('等級引用表未自填 → 回退頂層（與模組 levelRefs 一致）；空物件也算未自填', () => {
  assert.equal(buffLevelRefs(鋒勢, 鋒勢.levels![0]), SELF)
  assert.equal(buffLevelRefs(鋒勢, { level: 1, descriptionRefs: {} }), SELF)
  const own = { X: { refType: 'term' as const, refId: 'term_x' } }
  assert.equal(buffLevelRefs(鋒勢, { level: 1, descriptionRefs: own }), own)
  assert.equal(buffDescriptionView(鋒勢, 1, undefined).descriptionRefs, SELF)
})

test('指到不存在或沒有描述的級 → 視同未指定（掠食 LV1 型）', () => {
  const 掠食 = { name: '掠食', description: '', levels: [{ level: 1 }, { level: 2, description: '命中率提升0.5%' }] }
  const v = buffDescriptionView(掠食, 1, undefined)
  assert.deepEqual(v.levelLines.map((l) => l.level), [2], '沒描述的級不列')
  assert.deepEqual(buffDescriptionView(掠食, 9, undefined).levelLines.map((l) => l.level), [2])
})

test('有詞條：主描述用詞條說明與詞條引用表，各級照列', () => {
  const termRefs = { 命中: { refType: 'stat' as const, refId: 'acc' } }
  const v = buffDescriptionView(鋒勢, undefined, { description: '詞條說明', descriptionRefs: termRefs })
  assert.equal(v.description, '詞條說明')
  assert.equal(v.descriptionRefs, termRefs)
  assert.equal(v.levelLines.length, 2)
})

test('詞條說明是空的：主描述退回頂層，引用表也退回頂層（不可把頂層正文配上詞條引用表）', () => {
  const b = { ...鋒勢, description: '通用說明' }
  const v = buffDescriptionView(b, undefined, { description: '', descriptionRefs: { 別的: { refType: 'term' as const, refId: 'y' } } })
  assert.equal(v.description, '通用說明')
  assert.equal(v.descriptionRefs, SELF)
})

test('無等級 BUFF：行為不變，就是頂層描述', () => {
  const v = buffDescriptionView({ name: '過熱', description: '無法行動', descriptionRefs: undefined }, undefined, undefined)
  assert.equal(v.description, '無法行動')
  assert.deepEqual(v.levelLines, [])
})

test('generalTextHasNumber：引用與數值 token 裡的字不算正文數字', () => {
  assert.equal(generalTextHasNumber('護甲值降低'), false)
  assert.equal(generalTextHasNumber('使[凝勢Ⅲ]生效，可疊加<buff_凝勢.lv3.maxStack>層'), false)
  assert.equal(generalTextHasNumber('每層使所有友軍傷害提升0.8%'), true)
  assert.equal(generalTextHasNumber('可疊加５層'), true)
  assert.equal(generalTextHasNumber(undefined), false)
})
