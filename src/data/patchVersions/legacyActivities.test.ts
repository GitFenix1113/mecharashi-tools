import test from 'node:test'
import assert from 'node:assert/strict'
import { activitiesOfHalf, isVisibleActivity } from './legacyActivities.ts'
import type { PatchHalf, TimedActivity } from './types.ts'

// PLAN-048 Phase 2：前台顯示閘門
//
// 這道閘門是「半成品不上首頁」的唯一保證點。它壞掉的症狀不是報錯，
// 而是首頁多出一條長度是猜的甘特長條 —— 看起來完全正常，實際上是假資料。

const SPAN = { startDate: '2026/08/06', weeks: 2 }

function act(over: Partial<TimedActivity> = {}): TimedActivity {
  return { name: '活動', startDate: '2026/08/06', weeks: 1, type: 'limitedEvent', ...over }
}

test('isVisibleActivity：三種擋掉的情況', () => {
  assert.equal(isVisibleActivity(act()), true)
  assert.equal(isVisibleActivity(act({ hidden: true })), false, '明確標記隱藏')
  assert.equal(isVisibleActivity(act({ weeks: undefined })), false, '缺長度就畫不出長條')
  assert.equal(isVisibleActivity(act({ weeks: 0 })), false, '長度 0 等同沒有')
  // hidden: false 是明確的「要顯示」，不能被當成有值就擋掉
  assert.equal(isVisibleActivity(act({ hidden: false })), true)
})

test('缺 weeks 的活動即使沒標 hidden 也不會漏出去', () => {
  // 寫入端漏標 hidden 的後果不該是前台畫出一條猜的長條 ——
  // 閘門不倚賴寫入端自律，這是兩條獨立的防線
  const half: PatchHalf = {
    cnDate: '2026/08/06',
    twActivities: [act({ name: '完整' }), act({ name: '漏標的半成品', weeks: undefined })],
  }
  const out = activitiesOfHalf(half, 'tw', SPAN)
  assert.deepEqual(out.map(a => a.name), ['完整'])
})

test('隱藏的活動不出現在前台，但仍留在資料裡', () => {
  const twActivities = [
    act({ name: '上線中' }),
    act({ name: '待補', hidden: true, note: '公告只寫「10:00 起」，待確認結束日' }),
  ]
  const half: PatchHalf = { cnDate: '2026/08/06', twActivities }
  assert.deepEqual(activitiesOfHalf(half, 'tw', SPAN).map(a => a.name), ['上線中'])
  // 原陣列不可被就地修改——後台編輯器讀的是同一份
  assert.equal(twActivities.length, 2)
  assert.equal(twActivities[1].note, '公告只寫「10:00 起」，待確認結束日')
})

test('全部被藏起來時不退回 deprecated 舊欄位', () => {
  // 這是最容易寫錯的一格：若用「過濾後為空」判斷要不要 fallback，
  // 首頁會顯示早就被取代的舊資料，而且看起來像是正常內容
  const half: PatchHalf = {
    cnDate: '2026/08/06',
    twActivities: [act({ name: '待補', hidden: true })],
    skinGacha: '早就被取代的舊刮刮樂',
    specialEvents: ['舊限時活動'],
  }
  assert.deepEqual(activitiesOfHalf(half, 'tw', SPAN), [])
})

test('完全沒有新欄位時，legacy shim 照常運作（Phase 1 行為不變）', () => {
  const half: PatchHalf = {
    cnDate: '2026/08/06',
    skinGacha: '瑪汀妮外觀【喀耳刻之舞】',
    rouletteEvent: true,
    specialEvents: ['限時活動「寶匿奇遇記」'],
  }
  const out = activitiesOfHalf(half, 'tw', SPAN)
  assert.deepEqual(out.map(a => a.name), ['瑪汀妮外觀【喀耳刻之舞】', '角雕輪盤', '限時活動「寶匿奇遇記」'])
  // 舊欄位沒有起訖資訊，只能以本半版本整段近似 → 一律標 predicted
  for (const a of out) {
    assert.equal(a.confidence, 'predicted')
    assert.equal(a.weeks, 2)
  }
})

test('台版沒填不借用陸版（兩服檔期本來就不同）', () => {
  const half: PatchHalf = { cnDate: '2026/08/06', cnActivities: [act({ name: '陸版活動' })] }
  assert.deepEqual(activitiesOfHalf(half, 'tw', null), [])
  assert.deepEqual(activitiesOfHalf(half, 'cn', null).map(a => a.name), ['陸版活動'])
})
