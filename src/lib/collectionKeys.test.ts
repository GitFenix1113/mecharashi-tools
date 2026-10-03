// 集合清單同步守衛（PLAN-043 事後補強）
//
// 為什麼需要這個檔案：PLAN-043 新增 backpackSkills 集合時，前端 10 處掛接、firestore.rules、
// 型別、測試、模擬器 e2e 全部補齊且全綠——唯獨漏了 Cloudflare Worker 的 ARRAY_COLLECTIONS。
// 症狀是**只在正式站出現**：該集合 404、後台整個分頁「載入失敗」，而本機開發完全正常
// （dev 不走 Worker 代理，是 Firestore 直連）。tsc、npm test、build、模擬器測試全部抓不到。
//
// 這裡以「讀原始碼文字」的方式比對——Worker 是獨立的 Cloudflare bundle，
// 沒辦法 import 前端模組，而它的測試又跑在另一個 vitest workspace、不會被 npm test 帶到。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARRAY_COLLECTION_KEYS, SINGLETON_COLLECTION_KEYS, ALL_COLLECTION_KEYS,
  NO_LOCAL_CACHE_KEYS, skipsLocalCache,
} from './collectionKeys.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** 從原始碼取出某個字串陣列/Set 字面量裡的所有單引號字串。 */
function literalStrings(src: string, marker: string): string[] {
  const start = src.indexOf(marker)
  assert.notEqual(start, -1, `找不到 ${marker}，該檔結構已變動，請更新此測試`)
  const end = src.indexOf('])', start) !== -1 && src.indexOf('])', start) < src.indexOf(']', start) + 2
    ? src.indexOf('])', start)
    : src.indexOf(']', start)
  return [...src.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1])
}

test('Worker 的 ARRAY_COLLECTIONS 涵蓋全部陣列型集合（漏了 → 正式站 404，本機全綠）', () => {
  const worker = literalStrings(read('workers/src/index.ts'), 'const ARRAY_COLLECTIONS')
  const missing = ARRAY_COLLECTION_KEYS.filter((k) => !worker.includes(k))
  assert.deepEqual(missing, [], `workers/src/index.ts 的 ARRAY_COLLECTIONS 缺少：${missing.join('、')}`)
})

test('Worker 額外代理的集合不得誤植為前端集合鍵（反向檢查，避免清單無聲膨脹）', () => {
  const worker = literalStrings(read('workers/src/index.ts'), 'const ARRAY_COLLECTIONS')
  // Worker 另代理兩個「前端不走 GameDataContext」的公開集合，屬預期差異
  const EXPECTED_EXTRA = ['pilotResearch', 'patchVersions']
  const extra = worker.filter((k) => !ARRAY_COLLECTION_KEYS.includes(k as never) && !EXPECTED_EXTRA.includes(k))
  assert.deepEqual(extra, [], `Worker 多出未預期的集合：${extra.join('、')}`)
})

test('bump-data-version.mjs 的 KNOWN_KEYS 涵蓋全部集合（漏了 → 整條指令 exit(1)、一個都沒 bump）', (t) => {
  // 此腳本在 .gitignore 內（本機工具），CI／全新 clone 沒有它 → 跳過而非失敗
  const p = path.join(ROOT, 'scripts/bump-data-version.mjs')
  if (!fs.existsSync(p)) return t.skip('scripts/bump-data-version.mjs 不存在（gitignored）')
  const known = literalStrings(fs.readFileSync(p, 'utf8'), 'const KNOWN_KEYS')
  const missing = ALL_COLLECTION_KEYS.filter((k) => !known.includes(k))
  assert.deepEqual(missing, [], `KNOWN_KEYS 缺少：${missing.join('、')}`)
})

test('firestore.rules 為每個陣列型集合都有 match 區塊', () => {
  const rules = read('firestore.rules')
  const missing = ARRAY_COLLECTION_KEYS.filter((k) => !rules.includes(`match /${k}/`))
  assert.deepEqual(missing, [], `firestore.rules 缺少 match 區塊：${missing.join('、')}`)
})

test('陣列型與 singleton 型集合不重疊，且合起來等於 ALL_COLLECTION_KEYS', () => {
  const overlap = ARRAY_COLLECTION_KEYS.filter((k) => (SINGLETON_COLLECTION_KEYS as readonly string[]).includes(k))
  assert.deepEqual(overlap, [])
  assert.equal(ALL_COLLECTION_KEYS.length, ARRAY_COLLECTION_KEYS.length + SINGLETON_COLLECTION_KEYS.length)
  assert.equal(new Set(ALL_COLLECTION_KEYS).size, ALL_COLLECTION_KEYS.length, '不可有重複鍵')
})

// ── GameDataContext 的三處 switch（PLAN-042-A A-2 補強）───────────────────────
//
// 「七處同步」裡最後一處是 GameDataContext 的 state ＋ switch ＋ 型別，而它是**唯一
// 沒有任何自動檢查**的一處：TypeScript 對 switch 不做窮舉強制（沒有 default 也照過），
// 漏掉 applyData 的一支 case 的症狀是「該集合永遠是空陣列」——沒有錯誤、沒有紅字，
// 只有一個看起來「還沒有資料」的頁面。
//
// 同樣走讀原始碼文字：這個檔案 import 進來就會拉 React 與 firebase，node --test 載不起來。

const CONTEXT_SRC = read('src/contexts/GameDataContext.tsx')

test('GameDataContext.applyData 對每個集合鍵都有 case（漏了 → 該集合永遠是空陣列、零錯誤）', () => {
  const missing = ALL_COLLECTION_KEYS.filter((k) => !CONTEXT_SRC.includes(`case '${k}':`))
  assert.deepEqual(missing, [], `GameDataContext 缺少 case：${missing.join('、')}`)
})

test('GameDataContext 為每個陣列型集合都持有 state（漏了 → context value 少一欄）', () => {
  const missing = ARRAY_COLLECTION_KEYS.filter((k) => {
    const setter = k.charAt(0).toUpperCase() + k.slice(1)
    return !CONTEXT_SRC.includes(`set${setter}`)
  })
  assert.deepEqual(missing, [], `GameDataContext 缺少 useState：${missing.join('、')}`)
})

// ── localStorage 豁免名單（PLAN-042-A A-2）──────────────────────────────────

test('NO_LOCAL_CACHE_KEYS 的每一項都是合法集合鍵（打錯字 → 名單靜默失效）', () => {
  const bogus = NO_LOCAL_CACHE_KEYS.filter((k) => !ALL_COLLECTION_KEYS.includes(k))
  assert.deepEqual(bogus, [], `不存在的集合鍵：${bogus.join('、')}`)
})

test('writeCache 真的有問過 skipsLocalCache（名單存在但沒接上 = 完全沒用）', () => {
  assert.ok(
    /function writeCache[\s\S]{0,400}skipsLocalCache\(/.test(CONTEXT_SRC),
    'GameDataContext 的 writeCache 沒有呼叫 skipsLocalCache——豁免名單沒有生效',
  )
  assert.equal(skipsLocalCache('pilotLore'), true)
  assert.equal(skipsLocalCache('pilots'), false)
})
