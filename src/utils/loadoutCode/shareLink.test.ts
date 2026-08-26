// shareLink 的測試 —— PLAN-052-C C-1

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readShareCode, buildShareUrl, cachedCollectionVersion, staleCacheKeys, SHARE_PARAM } from './shareLink.ts'

test('readShareCode：吃得下網址／參數／裸碼，貼到閒聊文字則回 null', () => {
  const code = 'ASEWNAEUAQAHZGVmYXVsdAIBEAqwAQGIjgZC'
  assert.equal(readShareCode(`https://mecharashi.wiki/simulator?b=${code}`), code)
  assert.equal(readShareCode(`?b=${code}`), code)
  assert.equal(readShareCode(`?b=${code}&x=1`), code)
  assert.equal(readShareCode(`https://x/simulator?y=1&b=${code}#frag`), code)
  assert.equal(readShareCode(code), code, '裸碼也要吃')
  assert.equal(readShareCode(`  ${code}  `), code)
  assert.equal(readShareCode(null), null)
  assert.equal(readShareCode(''), null)
  assert.equal(readShareCode('欸你看看我這套配裝'), null, '一段中文不該被當成壞碼')
  assert.equal(readShareCode('https://example.com/'), null)
})

test('buildShareUrl：帶得動 GitHub Pages 的子路徑，且不重複斜線', () => {
  assert.equal(
    buildShareUrl('ABC', 'https://mecharashi.wiki', '/'),
    `https://mecharashi.wiki/simulator?${SHARE_PARAM}=ABC`,
  )
  assert.equal(
    buildShareUrl('ABC', 'https://user.github.io/', '/mecharashi-tools/'),
    `https://user.github.io/mecharashi-tools/simulator?${SHARE_PARAM}=ABC`,
  )
  assert.equal(
    buildShareUrl('ABC', 'https://x', '/sub'),
    `https://x/sub/simulator?${SHARE_PARAM}=ABC`,
    'base 沒有結尾斜線時要自己補',
  )
})

test('cachedCollectionVersion：讀得出 { v, d } 的版本，壞資料一律回 null', () => {
  const store = new Map<string, string>([
    ['mecharashi_gd_weapons', JSON.stringify({ v: '2026-08-20T00:00:00Z', d: [] })],
    ['mecharashi_gd_mechs', '這不是 JSON'],
    ['mecharashi_gd_pilots', JSON.stringify({ d: [] })],
  ])
  const storage = { getItem: (k: string) => store.get(k) ?? null }
  assert.equal(cachedCollectionVersion('weapons', storage), '2026-08-20T00:00:00Z')
  assert.equal(cachedCollectionVersion('mechs', storage), null)
  assert.equal(cachedCollectionVersion('pilots', storage), null, '缺 v 欄位')
  assert.equal(cachedCollectionVersion('backpacks', storage), null, '沒有這一份')
})

test('cachedCollectionVersion 的前綴必須與 GameDataContext 一致（跨檔常數，會漂移）', () => {
  const ctx = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../contexts/GameDataContext.tsx'), 'utf8',
  )
  const m = /const CACHE_PREFIX = '([^']+)'/.exec(ctx)
  assert.ok(m, '在 GameDataContext 找不到 CACHE_PREFIX')
  const store = new Map([[`${m![1]}weapons`, JSON.stringify({ v: 'X', d: [] })]])
  assert.equal(
    cachedCollectionVersion('weapons', { getItem: (k: string) => store.get(k) ?? null }), 'X',
    `前綴漂移了：GameDataContext 用的是 ${m![1]}`,
  )
})

test('staleCacheKeys：本機版本與伺服器不同才算落後', () => {
  const server = { global: 'G1', byKey: { weapons: 'W2', mechs: 'M1' } }
  const cached: Record<string, string | null> = { weapons: 'W1', mechs: 'M1', pilots: 'G1', backpacks: 'G0' }
  const got = staleCacheKeys(server, ['weapons', 'mechs', 'pilots', 'backpacks'], (k) => cached[k] ?? null)
  assert.deepEqual(got, ['weapons', 'backpacks'])
})

test('staleCacheKeys：沒有本機快取不算落後 —— 那代表本 session 是直接抓的', () => {
  const server = { global: 'G1', byKey: {} }
  assert.deepEqual(staleCacheKeys(server, ['weapons'], () => null), [])
})

test('staleCacheKeys：伺服器沒有版本資訊時一律不算落後（快取層本來就退化成直接讀）', () => {
  const server = { global: null, byKey: {} }
  assert.deepEqual(staleCacheKeys(server, ['weapons'], () => 'W1'), [])
})

test('staleCacheKeys：byKey 缺項時退回 global —— 沒被單獨 bump 過的集合走全域版本', () => {
  const server = { global: 'G2', byKey: { weapons: 'W1' } }
  assert.deepEqual(staleCacheKeys(server, ['pilots'], () => 'G1'), ['pilots'])
  assert.deepEqual(staleCacheKeys(server, ['pilots'], () => 'G2'), [])
})
