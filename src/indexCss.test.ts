// index.css 的守門（PLAN-042-B，2026-10-17）
//
// 同名 @keyframes 後定義的會整個蓋掉前面的，而且**不報錯**：機甲廳的型號鋼印一度取名 lore-stamp-in，
// 把機師廳朱印的開場蓋章動畫換掉了。兩者播完的停格一樣，回歸截圖完全抓不到，只有看動畫才發現。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8')

test('index.css 的 @keyframes 名稱不重複（同名會靜默蓋掉前一個）', () => {
  const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])
  const dup = names.filter((n, i) => names.indexOf(n) !== i)
  assert.deepEqual([...new Set(dup)], [], `重複的 @keyframes：${[...new Set(dup)].join('、')}`)
  assert.ok(names.length > 10, '應該讀得到 keyframes（檔案結構變了就更新這條測試）')
})
