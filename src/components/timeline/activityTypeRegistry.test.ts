// PLAN-048 Phase 1（任務 1-5）：活動型別登錄表守衛測試
// 守的是「開放字串不能讓前台崩掉」與「五族群色 + 第二編碼通道」兩件事。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  activityTone, isKnownActivityType, shapeClass,
  ACTIVITY_TYPE_OPTIONS, bannerIsRerun } from './activityTypeRegistry.ts'
import { KNOWN_ACTIVITY_TYPES } from '../../data/patchVersions/types.ts'

test('每個已知型別都有登錄，且下拉選單與型別清單一一對應', () => {
  for (const t of KNOWN_ACTIVITY_TYPES) {
    assert.ok(isKnownActivityType(t), `${t} 未登錄`)
  }
  assert.equal(ACTIVITY_TYPE_OPTIONS.length, KNOWN_ACTIVITY_TYPES.length)
  assert.deepEqual(
    ACTIVITY_TYPE_OPTIONS.map(o => o.value),
    [...KNOWN_ACTIVITY_TYPES],
  )
})

test('登錄表欄位齊全（少一個就是前台某處渲染成 undefined）', () => {
  for (const t of KNOWN_ACTIVITY_TYPES) {
    const tone = activityTone(t)
    for (const k of ['dot', 'chip', 'text', 'edge', 'shape', 'label'] as const) {
      assert.ok(tone[k], `${t}.${k} 缺值`)
    }
  }
})

test('未登錄型別回中性色而非 undefined —— 開放字串的存在理由', () => {
  const tone = activityTone('starVoyage')
  assert.ok(tone.dot && tone.chip && tone.text)
  assert.equal(tone.label, '其他')
  assert.equal(isKnownActivityType('starVoyage'), false)
})

test('未登錄型別可用 typeLabel 覆寫顯示名（新玩法零部署上線）', () => {
  assert.equal(activityTone('starVoyage', '星海拓荒祭').label, '星海拓荒祭')
  assert.equal(activityTone('starVoyage', '   ').label, '其他', '空白不算有效顯示名')
})

test('已登錄型別的 label 不被 typeLabel 蓋過（補登錄後無需回頭清資料）', () => {
  assert.equal(activityTone('limitedEvent', '亂填的名字').label, '限時活動')
})

test('空字串型別不當成已登錄（後台切到「其他」的過渡狀態）', () => {
  assert.equal(isKnownActivityType(''), false)
  assert.equal(activityTone('').label, '其他')
})

test('顏色收斂：族群數為 5，且撞色的角色池／機甲池靠形狀分開', () => {
  const groups = new Set(KNOWN_ACTIVITY_TYPES.map(t => activityTone(t).dot))
  assert.equal(groups.size, 5, `族群色應為 5 個，實際 ${groups.size}`)

  const pilot = activityTone('specificPilotBanner')
  const mech = activityTone('specificMechBanner')
  assert.equal(pilot.dot, mech.dot, '兩者同族群色')
  assert.notEqual(pilot.shape, mech.shape, '必須靠第二編碼通道分辨')
  assert.notEqual(pilot.label, mech.label)
})

test('同族群內的型別形狀不重複（否則第二編碼通道失效）', () => {
  const byGroup = new Map<string, string[]>()
  for (const t of KNOWN_ACTIVITY_TYPES) {
    const tone = activityTone(t)
    const arr = byGroup.get(tone.dot) ?? []
    arr.push(tone.shape)
    byGroup.set(tone.dot, arr)
  }
  for (const [dot, shapes] of byGroup) {
    assert.equal(new Set(shapes).size, shapes.length, `族群 ${dot} 形狀重複：${shapes.join(',')}`)
  }
})

test('shapeClass 對每種形狀都給得出 class', () => {
  for (const s of ['circle', 'square', 'diamond', 'triangle', 'bar'] as const) {
    assert.ok(shapeClass(s).length > 0, `${s} 無 class`)
  }
})

// ── 版本池／復刻池（顯示層推導）────────────────────────────────────────────────

test('復刻判定：實體不在該半版本的新增名單裡 ＝ 復刻', () => {
  const half = { pilots: ['哈達威'], mechs: ['螢石'] }
  // 版本池：本半新增的機師／機甲
  assert.equal(bannerIsRerun({ type: 'specificPilotBanner', pilots: ['哈達威'] }, half), false)
  assert.equal(bannerIsRerun({ type: 'specificMechBanner', mechs: ['螢石'] }, half), false)
  // 復刻池：舊角色回歸（v3.1 下半實例）
  assert.equal(bannerIsRerun({ type: 'specificPilotBanner', pilots: ['佐伊'] }, half), true)
  assert.equal(bannerIsRerun({ type: 'specificMechBanner', mechs: ['赫克托爾'] }, half), true)
})

test('回歸：不能用「起始日晚於半版本開始」判斷復刻', () => {
  // v3.0 lower 的白夜凜鋒（維羅妮卡）起始日 == 半版本開始日 06/18，卻是復刻。
  // 這個反例是整條判準只能看名單、不能看日期的原因。
  const half = { pilots: ['瑪阿特'] }
  assert.equal(bannerIsRerun({ type: 'specificPilotBanner', pilots: ['維羅妮卡'] }, half), true)
})

test('回歸：機甲池不能拿去比機師名單（欄位配對錯了會整個反過來）', () => {
  // 該半版本新增機師「哈達威」、沒有新機甲。機甲池「巨像」應判為復刻；
  // 若呼叫端寫成 act.pilots ?? act.mechs 配 half.pilots ?? half.mechs，
  // 就會拿 ['巨像'] 去比 ['哈達威'] 之外的錯誤名單而得到相反結果。
  const half = { pilots: ['哈達威'] }               // mechs 缺席
  assert.equal(bannerIsRerun({ type: 'specificMechBanner', mechs: ['巨像'] }, half), false,
    '沒有新機甲名單就無從判定 —— 判不出來時當一般卡池，不要猜')
  assert.equal(bannerIsRerun({ type: 'specificMechBanner', mechs: ['巨像'] }, { mechs: ['螢石'] }), true)
})

test('復刻只影響標籤，不影響型別的顏色與形狀', () => {
  const base = activityTone('specificPilotBanner')
  const rerun = activityTone('specificPilotBanner', undefined, { rerun: true })
  assert.equal(rerun.label, '角色復刻')
  assert.equal(base.label, '角色池')
  assert.equal(rerun.dot, base.dot, '同族群同色')
  assert.equal(rerun.shape, base.shape, '同型別同形狀')
})

test('非卡池型別不受 rerun 影響（誤傳也不會改標籤）', () => {
  assert.equal(bannerIsRerun({ type: 'battlePass', pilots: ['佐伊'] }, { pilots: ['哈達威'] }), false)
  assert.equal(activityTone('battlePass', undefined, { rerun: true }).label, '戰令')
  assert.equal(activityTone('crossShipping', undefined, { rerun: true }).label, '海運')
})
