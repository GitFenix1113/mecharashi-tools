// PLAN-052-I E-1：方案名稱的正規化
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這一組全部是「會在匯出圖上出事、但在輸入框裡看不出來」的輸入。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeLoadoutName, LOADOUT_NAME_MAX } from './loadoutName.ts'

test('正常名稱原樣保留', () => {
  assert.equal(sanitizeLoadoutName('星芒雙持流'), '星芒雙持流')
})

test('未命名一律回 undefined（不是空字串——欄位不存在才是「未設定」）', () => {
  assert.equal(sanitizeLoadoutName(undefined), undefined)
  assert.equal(sanitizeLoadoutName(''), undefined)
  assert.equal(sanitizeLoadoutName('   '), undefined)
  assert.equal(sanitizeLoadoutName('\n\t  \n'), undefined)
})

test('換行與 tab 折成單一空白（圖上一個換行就是一整行版面）', () => {
  assert.equal(sanitizeLoadoutName('星芒\n雙持\t流'), '星芒 雙持 流')
  assert.equal(sanitizeLoadoutName('  前後空白  '), '前後空白')
  assert.equal(sanitizeLoadoutName('連續    空白'), '連續 空白')
})

test('控制字元與零寬／雙向覆寫字元一律移除', () => {
  // U+202E 會讓圖上的字反著印，但輸入框裡看起來完全正常
  assert.equal(sanitizeLoadoutName('星芒‮流派'), '星芒流派')
  // 零寬空白：兩個看起來一樣的名稱其實是不同字串
  assert.equal(sanitizeLoadoutName('星​芒'), '星芒')
  assert.equal(sanitizeLoadoutName('星芒'), '星芒')
  assert.equal(sanitizeLoadoutName('﻿星芒'), '星芒')
})

test(`超長截到 ${LOADOUT_NAME_MAX} 個碼點`, () => {
  const long = '甲'.repeat(LOADOUT_NAME_MAX + 10)
  assert.equal([...sanitizeLoadoutName(long)!].length, LOADOUT_NAME_MAX)
})

test('截斷用碼點不用 slice —— emoji 不可被切成孤立代理字', () => {
  // 每個 🤖 是一個碼點、兩個 UTF-16 單位。用 slice() 截 24 會切在第 12 個的中間。
  const robots = '🤖'.repeat(LOADOUT_NAME_MAX + 5)
  const out = sanitizeLoadoutName(robots)!
  assert.equal([...out].length, LOADOUT_NAME_MAX)
  // 孤立代理字（U+D800–U+DFFF）一個都不該出現
  assert.equal([...out].every((c) => c.codePointAt(0)! > 0xdfff || c.codePointAt(0)! < 0xd800), true)
})

test('截斷後若尾端只剩空白要再 trim 一次', () => {
  const s = '甲'.repeat(LOADOUT_NAME_MAX - 1) + ' 乙'
  assert.equal(sanitizeLoadoutName(s), '甲'.repeat(LOADOUT_NAME_MAX - 1))
})
