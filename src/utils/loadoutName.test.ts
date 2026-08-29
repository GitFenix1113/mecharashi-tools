// PLAN-052-I E-1 ／ PLAN-052-L C-1：方案名稱與備註的正規化
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這一組全部是「會在匯出圖上出事、但在輸入框裡看不出來」的輸入。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeLoadoutName, LOADOUT_NAME_MAX,
  sanitizeLoadoutNote, LOADOUT_NOTE_MAX, LOADOUT_NOTE_MAX_LINES,
} from './loadoutName.ts'

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

// ─── 方案備註（PLAN-052-L C-1）────────────────────────────────────────────────
//
// 備註與名稱的差別只有一個：**它保留換行**。所以這一組測的重點是
// 「哪些空白留著、哪些被折掉」，以及「一個只打了 Enter 的備註不會在公開圖上撐出一片空白」。

test('正常備註原樣保留，換行留著（那是它與名稱唯一的實質差別）', () => {
  assert.equal(sanitizeLoadoutNote('對空優先\n手部留 300 換備用'), '對空優先\n手部留 300 換備用')
})

test('未填一律回 undefined（同名稱：欄位不存在才是「未設定」）', () => {
  assert.equal(sanitizeLoadoutNote(undefined), undefined)
  assert.equal(sanitizeLoadoutNote(''), undefined)
  assert.equal(sanitizeLoadoutNote('   '), undefined)
  assert.equal(sanitizeLoadoutNote('\n\n\n'), undefined)
  assert.equal(sanitizeLoadoutNote('\n \t \n'), undefined)
})

test('行內 tab／全形空白折成單一半形空白，但換行不折', () => {
  assert.equal(sanitizeLoadoutNote('對空\t優先\n手部　　留 300'), '對空 優先\n手部 留 300')
})

test('去頭尾空行，連續空行壓成一行（三個 Enter 與十個 Enter 本意都是「這裡分段」）', () => {
  assert.equal(sanitizeLoadoutNote('\n\n甲\n\n\n\n乙\n\n'), '甲\n\n乙')
})

test('控制字元與零寬／雙向覆寫字元一律移除（與名稱共用同一條正規式）', () => {
  assert.equal(sanitizeLoadoutNote('對空‮優先'), '對空優先')
  assert.equal(sanitizeLoadoutNote('對​空'), '對空')
})

test('Windows 的 \\r\\n 要先正規化——否則每一行尾會多一個看不見的東西', () => {
  assert.equal(sanitizeLoadoutNote('甲\r\n乙\r丙'), '甲\n乙\n丙')
})

test(`超過 ${LOADOUT_NOTE_MAX_LINES} 行只留前面幾行（100 個 \\n 也只有 100 個碼點，卻是 100 行空白）`, () => {
  const many = Array.from({ length: 20 }, (_, i) => `第${i}行`).join('\n')
  const out = sanitizeLoadoutNote(many)!
  assert.equal(out.split('\n').length, LOADOUT_NOTE_MAX_LINES)
  assert.equal(out.split('\n')[0], '第0行')
})

test(`超長截到 ${LOADOUT_NOTE_MAX} 個碼點`, () => {
  const long = '甲'.repeat(LOADOUT_NOTE_MAX + 40)
  assert.equal([...sanitizeLoadoutNote(long)!].length, LOADOUT_NOTE_MAX)
})

test('截斷用碼點不用 slice —— emoji 不可被切成孤立代理字', () => {
  const robots = '🤖'.repeat(LOADOUT_NOTE_MAX + 5)
  const out = sanitizeLoadoutNote(robots)!
  assert.equal([...out].length, LOADOUT_NOTE_MAX)
  assert.equal([...out].every((c) => c.codePointAt(0)! > 0xdfff || c.codePointAt(0)! < 0xd800), true)
})

test('截斷剛好切在換行上時，尾端不留一個空行', () => {
  const s = '甲'.repeat(LOADOUT_NOTE_MAX - 1) + '\n乙'
  assert.equal(sanitizeLoadoutNote(s), '甲'.repeat(LOADOUT_NOTE_MAX - 1))
})

test('清洗是冪等的——reconcile 是第二道，跑第二次不可以再變一次', () => {
  const once = sanitizeLoadoutNote(' 甲\r\n\n\n乙\t丙 ')!
  assert.equal(sanitizeLoadoutNote(once), once)
})
