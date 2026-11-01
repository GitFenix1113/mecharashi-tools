// /api 反爬守門的來源判斷（origin.ts）。
// 釘住：Referer 取 origin 後完全比對——相似網域、帶帳密的 URL、白名單混進空字串都不能放行。
// 執行：node --test workers/src/origin.test.ts（已納入根目錄的 npm test）

import test from 'node:test'
import assert from 'node:assert/strict'

import { isAllowedSource, originOf } from './origin.ts'

const ALLOWED = ['https://mecharashi.wiki', 'https://www.mecharashi.wiki', 'http://localhost:5173']

test('originOf：取 scheme＋host＋port；空字串與壞 URL 視為沒有', () => {
  assert.equal(originOf('https://mecharashi.wiki/pilots/x?y=1#z'), 'https://mecharashi.wiki')
  assert.equal(originOf('http://localhost:5173/'), 'http://localhost:5173')
  assert.equal(originOf(''), null)
  assert.equal(originOf('not a url'), null)
})

test('正常來源放行：Origin 相同，或 Referer 是白名單網域底下的頁面', () => {
  assert.equal(isAllowedSource(ALLOWED, 'https://mecharashi.wiki', ''), true)
  assert.equal(isAllowedSource(ALLOWED, '', 'https://mecharashi.wiki/'), true)
  assert.equal(isAllowedSource(ALLOWED, '', 'https://www.mecharashi.wiki/mechs/x'), true)
  assert.equal(isAllowedSource(ALLOWED, '', 'http://localhost:5173/simulator'), true)
})

test('相似網域、帶帳密、別的 port 都擋（舊的前綴比對會放過前兩種）', () => {
  assert.equal(isAllowedSource(ALLOWED, '', 'https://mecharashi.wiki.evil.example/'), false)
  assert.equal(isAllowedSource(ALLOWED, '', 'https://mecharashi.wiki@evil.example/'), false)
  assert.equal(isAllowedSource(ALLOWED, '', 'http://localhost:51730/'), false)
  assert.equal(isAllowedSource(ALLOWED, 'https://mecharashi.wiki.evil.example', ''), false)
})

test('沒有 Origin 也沒有 Referer → 擋；白名單混進空字串也不會因此放行', () => {
  assert.equal(isAllowedSource(ALLOWED, '', ''), false)
  assert.equal(isAllowedSource([...ALLOWED, ''], '', ''), false)
  assert.equal(isAllowedSource([''], '', ''), false)
})
