// /api/collect 的 payload 驗證與寫入組裝（PLAN-046 A-3；PLAN-062 Phase B 補測試）
//
// collect.ts 是「匿名輸入」與「service account 寫入權限」之間唯一的一道牆，
// 在這之前卻沒有任何測試（workers/test 只有 wrangler 範本的 Hello World）。
// 這裡釘住兩件事：
//   ① PLAN-062 新增的故事館類別真的會被收下 —— 漏了的話前端送出去的資料會被**靜默**丟掉，
//     統計又不回溯；
//   ② 收下之後，欄位路徑仍然只能由程式碼組出（鐵律②），id 逃不出反引號。
// 執行：node --test workers/src/collect.test.ts（已納入根目錄的 npm test）

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildWrites, parseCollectBody, type CollectInput } from './collect.ts'

const ctx = { dayKey: '2026-10-15', monthKey: '2026-10', device: 'mobile', country: 'TW' }

/**
 * 組一包合法的 payload。
 *
 * 預設帶一個 route：真實的前端只會在 trackPageView 裡記實體，而那裡一定同時記了頁面，
 * 所以 entities 永遠伴隨 routes 出現（analyticsDaily 那筆寫入因此排在第一位）。
 */
function payload(
  entities: Record<string, Record<string, number>>,
  routes: Record<string, { pv: number; upv: number }> = { lore_pilots_detail: { pv: 1, upv: 1 } },
): string {
  return JSON.stringify({ v: 1, sessions: 0, visitors: 0, lang: 'zh_tw', auth: 'guest', ref: 'direct', routes, entities })
}

/** 取出 analyticsEntity 那筆寫入的所有欄位路徑。 */
function entityPaths(input: CollectInput): string[] {
  const w = buildWrites(input, ctx).find((x) => x.collection === 'analyticsEntity')
  return w ? w.transforms.map((t) => t.fieldPath) : []
}

test('parseCollectBody：收下故事館的兩個新類別（lorePilots／loreParts）', () => {
  const input = parseCollectBody(payload({
    lorePilots: { 'pilot_049_海莉絲': 1 },
    loreParts: { 'pilot_049_海莉絲--part-2': 1 },
  }))
  assert.ok(input)
  assert.deepEqual(input.entities, [
    { type: 'lorePilots', id: 'pilot_049_海莉絲', n: 1 },
    { type: 'loreParts', id: 'pilot_049_海莉絲--part-2', n: 1 },
  ])
})

test('parseCollectBody：原有的四個類別照舊收下', () => {
  const input = parseCollectBody(payload({
    pilots: { a: 1 }, mechs: { b: 1 }, weapons: { c: 1 }, modules: { d: 1 },
  }))
  assert.deepEqual(input?.entities.map((e) => e.type), ['pilots', 'mechs', 'weapons', 'modules'])
})

test('parseCollectBody：不在閉集合裡的類別一律丟掉（含大小寫不同的近似名）', () => {
  const input = parseCollectBody(payload({
    lore: { x: 1 }, lorepilots: { x: 1 }, 'lorePilots.evil': { x: 1 }, pilots: { ok: 1 },
  }))
  assert.deepEqual(input?.entities, [{ type: 'pilots', id: 'ok', n: 1 }])
})

test('parseCollectBody：章節 id 若含反引號、點、斜線等字元就丟掉，逃不出欄位路徑', () => {
  const input = parseCollectBody(payload({
    loreParts: {
      'pilot_049_海莉絲--part-1': 1,
      'a`.b': 1,
      'pilot.x--part-1': 1,
      'pilot/x--part-1': 1,
      'pilot x--part-1': 1,
    },
  }))
  assert.deepEqual(input?.entities.map((e) => e.id), ['pilot_049_海莉絲--part-1'])
})

test('buildWrites：故事館類別寫進同一份 analyticsEntity 月文件，欄位路徑以反引號包住 id', () => {
  const input = parseCollectBody(payload({
    pilots: { 'pilot_049_海莉絲': 1 },
    lorePilots: { 'pilot_049_海莉絲': 1 },
    loreParts: { 'pilot_049_海莉絲--part-2': 3 },
  }))
  assert.ok(input)
  const writes = buildWrites(input, ctx)
  const entity = writes.filter((w) => w.collection === 'analyticsEntity')
  assert.equal(entity.length, 1, '新類別不該多開一份文件——寫入次數必須不變')
  assert.equal(entity[0].docId, '2026-10')
  assert.deepEqual(entityPaths(input), [
    'pilots.`pilot_049_海莉絲`',
    'lorePilots.`pilot_049_海莉絲`',
    'loreParts.`pilot_049_海莉絲--part-2`',
  ])
  const parts = entity[0].transforms.find((t) => t.fieldPath.startsWith('loreParts.'))
  assert.deepEqual(parts?.increment, { integerValue: '3' })
})

test('parseCollectBody：只帶故事館類別、沒有頁面的一包也不會被當成空包丟掉', () => {
  const input = parseCollectBody(payload({ lorePilots: { 'pilot_049_海莉絲': 1 } }, {}))
  assert.deepEqual(input?.entities, [{ type: 'lorePilots', id: 'pilot_049_海莉絲', n: 1 }])
})
