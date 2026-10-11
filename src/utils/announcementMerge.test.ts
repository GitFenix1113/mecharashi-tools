import test from 'node:test'
import assert from 'node:assert/strict'
import type { TimedActivity } from '../data/patchVersions/types'
import {
  applyActivityToList,
  canAutoRelease,
  inferOpenEndedDuration,
  toMergeableActivity,
  withInferred,
  DEFAULT_MISSING_WEEKS_NOTE,
  RERUN_BANNER_WEEKS,
  SELECTION_POOL_WEEKS,
  type VersionLike,
} from './announcementMerge.ts'

// 版本骨架取自正式資料（2026-10-11 的 patchVersions），新增名單只留推估會用到的
const VERSIONS: VersionLike[] = [
  { id: 'v3.0', upper: { twDate: '2026/05/28', pilots: ['海莉絲'], mechs: ['彌造者'] }, lower: { twDate: '2026/06/18', pilots: ['瑪阿特'], mechs: ['殉道士'] } },
  { id: 'v3.1', upper: { twDate: '2026/07/09', pilots: ['唐小葵'], mechs: ['奔霄'] }, lower: { twDate: '2026/07/30', pilots: ['哈達威'], mechs: ['螢石'] } },
  { id: 'v3.2', upper: { twDate: '2026/08/20', pilots: ['貝爾莎'], mechs: ['惡兆'] }, lower: { twDate: '2026/09/10', pilots: ['吉賽爾'], mechs: ['獵鬥士'] } },
  { id: 'v3.3', upper: { twDate: '2026/10/01', pilots: ['淬鋒·凱登'], mechs: ['莫比烏斯X'] }, lower: { twDate: '2026/10/22' } },
  { id: 'v3.4', upper: { twDate: '2026/11/12' }, lower: { twDate: '2026/12/03' } },
]

const up = (versionId: string) => ({ versionId, half: 'upper' as const })
const low = (versionId: string) => ({ versionId, half: 'lower' as const })

test('特遣／海運：慣例 2 週 —— 遊戲內 10/01 的角雕特遣「卡池結束於 2026/10/15」（站長截圖）', () => {
  for (const type of ['pilotMission', 'crossShipping']) {
    const r = inferOpenEndedDuration({ type, startDate: '2026/10/01' }, up('v3.3'), VERSIONS)
    assert.deepEqual(r, { weeks: SELECTION_POOL_WEEKS, rule: 'selectionPool', until: '2026/10/15' })
  }
})

test('版本新池：UP 的是該半版本新增的實體 → 開到版本結束（上半 6 週、下半 3 週）', () => {
  assert.deepEqual(
    inferOpenEndedDuration({ type: 'specificPilotBanner', startDate: '2026/05/28', pilots: ['海莉絲'] }, up('v3.0'), VERSIONS),
    { weeks: 6, rule: 'versionBanner', until: '2026/07/09' },
  )
  assert.deepEqual(
    inferOpenEndedDuration({ type: 'specificMechBanner', startDate: '2026/07/30', mechs: ['螢石'] }, low('v3.1'), VERSIONS),
    { weeks: 3, rule: 'versionBanner', until: '2026/08/20' },
  )
})

test('版本新池：官方中點寫法不一（「淬鋒．凱登」vs「淬鋒·凱登」）仍認得是新池', () => {
  const r = inferOpenEndedDuration({ type: 'specificPilotBanner', startDate: '2026/10/01', pilots: ['淬鋒．凱登'] }, up('v3.3'), VERSIONS)
  assert.equal(r?.rule, 'versionBanner')
  assert.equal(r?.weeks, 6)
})

test('復刻特選池：固定 2 週，不看下一個池什麼時候開', () => {
  const r = inferOpenEndedDuration({ type: 'specificPilotBanner', startDate: '2026/09/17', pilots: ['鄭樂萱'] }, low('v3.2'), VERSIONS)
  assert.deepEqual(r, { weeks: RERUN_BANNER_WEEKS, rule: 'rerunBanner', until: '2026/10/01' })
})

test('卡池抓不到 UP 實體 → 分不出新池或復刻，不推估', () => {
  assert.equal(inferOpenEndedDuration({ type: 'specificMechBanner', startDate: '2026/09/17' }, low('v3.2'), VERSIONS), null)
})

test('官方已寫明週數、非卡池型別、沒有目標版本 → 一律不推估', () => {
  assert.equal(inferOpenEndedDuration({ type: 'pilotMission', startDate: '2026/05/28', weeks: 3 }, up('v3.0'), VERSIONS), null)
  assert.equal(inferOpenEndedDuration({ type: 'limitedEvent', startDate: '2026/08/22' }, up('v3.2'), VERSIONS), null)
  assert.equal(inferOpenEndedDuration({ type: 'pilotMission', startDate: '2026/05/28' }, null, VERSIONS), null)
})

test('最後一個已知版本之後 → 推不出版本結束日，版本新池不推估（不拿慣例 3 週硬湊）', () => {
  const versions = [...VERSIONS, { id: 'v3.5', upper: { twDate: '2026/12/24', pilots: ['黑障'] } }]
  const r = inferOpenEndedDuration({ type: 'specificPilotBanner', startDate: '2026/12/24', pilots: ['黑障'] }, up('v3.5'), versions)
  assert.equal(r, null)
})

test('週六巡迴活動（預熱衝刺）：開到下個版本前的週一 —— 與官方寫明的兩期同為 37 天', () => {
  const r = inferOpenEndedDuration({ name: '預熱衝刺', type: 'limitedEvent', startDate: '2026/10/03' }, up('v3.3'), VERSIONS)
  assert.deepEqual(r, { weeks: 5.29, rule: 'weekendEvent', until: '2026/11/09' })
  const r2 = inferOpenEndedDuration({ name: '預熱衝刺', type: 'limitedEvent', startDate: '2026/08/22' }, up('v3.2'), VERSIONS)
  assert.equal(r2?.until, '2026/09/28')
  // 其他限時活動沒有穩定慣例，照舊交給人
  assert.equal(inferOpenEndedDuration({ name: '迷星所向', type: 'limitedEvent', startDate: '2026/07/30' }, low('v3.1'), VERSIONS), null)
})

test('canAutoRelease：只容許規則知道原因的 flag', () => {
  const inf = { weeks: 2, rule: 'rerunBanner' as const, until: '2026/10/01' }
  assert.equal(canAutoRelease([], '火線重燃', null), true, '零 flag')
  assert.equal(canAutoRelease(['openEnded'], '破陣驚鴻', inf), true, '推得出檔期的開放式卡池')
  assert.equal(canAutoRelease(['openEnded'], '破陣驚鴻', null), false, '推不出檔期就交給人')
  assert.equal(canAutoRelease(['nonWholeWeek', 'nonThursdayStart'], '預熱衝刺', null), true, '週六巡迴活動的常態')
  assert.equal(canAutoRelease(['openEnded', 'nonThursdayStart'], '預熱衝刺', inf), true)
  assert.equal(canAutoRelease(['nonThursdayStart'], '共慶二周年', null), false, '其他活動非週四開始仍要人看')
  assert.equal(canAutoRelease(['missingName', 'unknownActivityType'], undefined, inf), false)
})

test('withInferred：補 weeks、標 predicted、note 寫明規則；官方已有 weeks 時絕不覆蓋', () => {
  const inf = { weeks: 2, rule: 'rerunBanner' as const, until: '2026/10/01' }
  const out = withInferred({ name: '破陣驚鴻', type: 'specificPilotBanner', startDate: '2026/09/17' }, inf)
  assert.equal(out.weeks, 2)
  assert.equal(out.confidence, 'predicted')
  assert.match(out.note ?? '', /推估.*復刻特選池/)

  const official = { name: 'x', type: 'pilotMission', startDate: '2026/05/28', weeks: 6, confidence: 'confirmed' as const }
  assert.deepEqual(withInferred(official, inf), official)
})

test('推估過的活動正規化後不隱藏 —— 有長度就該上首頁（虛線）', () => {
  const inf = inferOpenEndedDuration({ type: 'pilotMission', startDate: '2026/10/01' }, up('v3.3'), VERSIONS)
  const a = toMergeableActivity(withInferred({ name: '角雕特遣', type: 'pilotMission', startDate: '2026/10/01' }, inf))
  assert.ok(a)
  assert.equal(a.hidden, undefined)
  assert.equal(a.weeks, 2)
  assert.equal(a.confidence, 'predicted')
})

test('toMergeableActivity：缺長度一律隱藏並留下預設待辦', () => {
  const a = toMergeableActivity({ name: ' 預熱衝刺 ', type: 'limitedEvent', startDate: '2026/08/22', description: '' })
  assert.ok(a)
  assert.equal(a.name, '預熱衝刺')
  assert.equal(a.hidden, true)
  assert.equal(a.note, DEFAULT_MISSING_WEEKS_NOTE)
  assert.equal('description' in a, false, '空字串不寫進去')
  assert.equal(toMergeableActivity({ name: 'x', type: 'limitedEvent' }), null, '缺起始日不可寫入')
})

test('applyActivityToList：同名同日視為衝突，不覆蓋；overwrite 時沿用既有 id', () => {
  const existing: TimedActivity = { id: 'act_old', name: '角雕特遣', startDate: '2026/10/01', type: 'pilotMission', weeks: 6 }
  const incoming: TimedActivity = { name: '角雕特遣', startDate: '2026/10/01', type: 'pilotMission', weeks: 6, confidence: 'predicted' }

  const r1 = applyActivityToList([existing], incoming)
  assert.equal(r1.ok, false)

  const r2 = applyActivityToList([existing], incoming, { overwrite: true })
  assert.ok(r2.ok)
  assert.equal(r2.list.length, 1)
  assert.equal(r2.list[0].id, 'act_old')
  assert.equal(r2.list[0].confidence, 'predicted')

  const r3 = applyActivityToList(undefined, { ...incoming, startDate: '2026/10/08' })
  assert.ok(r3.ok)
  assert.equal(r3.list.length, 1)
  assert.match(r3.written.id ?? '', /^act_/)
})
