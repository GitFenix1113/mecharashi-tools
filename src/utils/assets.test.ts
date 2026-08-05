// PLAN-043 A-8：技能圖示路徑正規化
//
// 為什麼這個檔案存在：背包技能圖示沿用官方的 `Icon_skill_passive_*` 檔名，卻放在
// 獨立的「背包技能/」資料夾。原本的實作是「取檔名、忽略中間任何子資料夾、純靠前綴推導」，
// 那會把 背包技能/ 靜默改寫成 被動技能/ —— 症狀是圖片 404，或更糟：指到同名但不同來源
// 的被動技能圖，畫面看起來「有圖」卻是錯的，沒有任何錯誤訊息。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSkillPath } from './assets.ts'

const BP = 'Icon_skill_passive_1234.png'

// ─── PLAN-043 的核心迴歸 ─────────────────────────────────────────────────────

test('背包技能資料夾不被前綴推導洗成被動技能', () => {
  const p = `/images/skills/背包技能/${BP}`
  assert.equal(normalizeSkillPath(p), p)
})

test('背包技能路徑是冪等的（連續套用結果不變）', () => {
  const p = `/images/skills/背包技能/${BP}`
  assert.equal(normalizeSkillPath(normalizeSkillPath(p)), p)
})

// ─── 既有行為必須原封不動 ────────────────────────────────────────────────────

test('扁平路徑仍依檔名前綴推回子資料夾', () => {
  assert.equal(normalizeSkillPath(`/images/skills/${BP}`), `/images/skills/被動技能/${BP}`)
  assert.equal(
    normalizeSkillPath('/images/skills/Icon_skill_talent_9.png'),
    '/images/skills/天賦技能/Icon_skill_talent_9.png',
  )
  assert.equal(
    normalizeSkillPath('/images/skills/Icon_skill_main_7.png'),
    '/images/skills/主動技能/Icon_skill_main_7.png',
  )
})

test('已分類的既有路徑冪等', () => {
  const p = `/images/skills/被動技能/${BP}`
  assert.equal(normalizeSkillPath(p), p)
})

test('未知子資料夾仍會被前綴推導修正（舊資料自癒能力不可失去）', () => {
  assert.equal(normalizeSkillPath(`/images/skills/舊分類/${BP}`), `/images/skills/被動技能/${BP}`)
})

test('前綴不認識的檔名原樣返回，不亂塞資料夾', () => {
  const p = '/images/skills/Icon_weird_999.png'
  assert.equal(normalizeSkillPath(p), p)
})

test('非技能路徑原樣返回', () => {
  for (const p of ['/images/backpacks/Icon_backpack_1.png', '/images/pilots/曜/full.webp', 'https://cdn.example/x.png']) {
    assert.equal(normalizeSkillPath(p), p)
  }
})

test('相對路徑（無開頭斜線）保留原本的前綴形式', () => {
  assert.equal(normalizeSkillPath(`images/skills/${BP}`), `images/skills/被動技能/${BP}`)
  const p = `images/skills/背包技能/${BP}`
  assert.equal(normalizeSkillPath(p), p)
})
