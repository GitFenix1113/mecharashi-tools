import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mechBannerRuns, mechBannerStatus, mechBannerText } from './mechBannerStatus.ts'
import type { PatchHalf, PatchVersion, TimedActivity } from '../../data/patchVersions/types.ts'

const act = (name: string, mechs: string[], startDate: string, weeks = 2, extra: Partial<TimedActivity> = {}): TimedActivity =>
  ({ name, mechs, startDate, weeks, type: 'specificMechBanner', ...extra } as TimedActivity)
const half = (tw: TimedActivity[] = [], extra: Partial<PatchHalf> = {}): PatchHalf => ({ cnDate: '', twActivities: tw, ...extra } as PatchHalf)
const ver = (version: string, upper: PatchHalf, lower: PatchHalf = half()): PatchVersion => ({ version, upper, lower } as PatchVersion)
const NOW = new Date(2026, 9, 17, 15, 30)   // 2026/10/17 下午：「今天」以日為單位，時刻不影響

test('開放中：剩幾天含今天、最後一天＝結束前一天', () => {
  const v = [ver('3.3', half([act('可能性的彼端', ['莫比烏斯X'], '2026/10/01', 6)], { mechs: ['莫比烏斯X'] }))]
  const s = mechBannerStatus('莫比烏斯X', v, NOW)
  assert.equal(s.kind, 'ongoing')
  assert.equal(s.title, '可能性的彼端')
  assert.equal(s.current?.daysLeft, 26)
  assert.deepEqual(mechBannerText(s, NOW), { kind: 'ongoing', label: '開放中', text: '剩 26 天（至 11/11）', predicted: false, rerun: false })
})

test('開放中但結束日是推估：寫「預計至」並附說明', () => {
  const v = [ver('3.3', half([act('鐵幕法典', ['君權'], '2026/10/15', 2, { confidence: 'predicted' })]))]
  const t = mechBannerText(mechBannerStatus('君權', v, NOW), NOW)
  assert.equal(t.text, '預計至 10/28')
  assert.equal(t.predicted, true)
  assert.ok(t.sub)
})

test('復刻：這期機甲不在該半版本新增名單裡', () => {
  const v = [ver('3.3', half([act('鐵幕法典', ['君權'], '2026/10/15')], { mechs: ['莫比烏斯X'] }))]
  assert.equal(mechBannerText(mechBannerStatus('君權', v, NOW), NOW).rerun, true)
})

test('即將開放：取最早的那期', () => {
  const v = [ver('3.4', half([act('後來那期', ['尼德霍格'], '2026/12/03'), act('先來那期', ['尼德霍格'], '2026/11/12', 3)]))]
  const s = mechBannerStatus('尼德霍格', v, NOW)
  assert.equal(s.kind, 'upcoming')
  assert.equal(s.title, '先來那期')
  assert.equal(mechBannerText(s, NOW).text, '11/12 開放・3 週')
})

test('新機甲：半版本新增名單＋未來的台版日期；14 天內寫幾天後', () => {
  const v = [ver('3.3', half(), half([], { mechs: ['奈芙蒂斯'], cnDate: '2026/05/14', twDate: '2026/10/22', twIsPredicted: true }))]
  const s = mechBannerStatus('奈芙蒂斯', v, NOW)
  assert.equal(s.kind, 'debut')
  assert.deepEqual(mechBannerText(s, NOW), {
    kind: 'debut', label: '新機甲', text: '預計 10/22 台版登場（5 天後・推估）', sub: '陸版 2026/05/14 已登場・v3.3 下半', predicted: true, rerun: false,
  })
})

test('新機甲：遠的寫完整日期；台版日期已過就不再是新機甲', () => {
  const far = [ver('3.6', half(), half([], { mechs: ['藍色魔鳥'], cnDate: '2026/09/17', twDate: '2027/02/25' }))]
  assert.equal(mechBannerText(mechBannerStatus('藍色魔鳥', far, NOW), NOW).text, '預計 2027/02/25 台版登場（推估）')
  const passed = [ver('3.2', half(), half([], { mechs: ['獵鬥士'], twDate: '2026/09/10' }))]
  assert.equal(mechBannerStatus('獵鬥士', passed, NOW).kind, 'none')
})

test('優先序：開放中勝過新機甲推估，新機甲勝過已結束', () => {
  const v = [
    ver('2.0', half([act('舊池', ['甲'], '2025/01/01')])),
    ver('3.4', half([act('現在', ['甲'], '2026/10/15')], { mechs: ['甲'], twDate: '2026/11/12' })),
  ]
  assert.equal(mechBannerStatus('甲', v, NOW).kind, 'ongoing')
  const v2 = [ver('2.0', half([act('舊池', ['乙'], '2025/01/01')])), ver('3.4', half([], { mechs: ['乙'], twDate: '2026/11/12' }))]
  assert.equal(mechBannerStatus('乙', v2, NOW).kind, 'debut')
})

test('已結束：最近一期的池名與日期、共幾次（新到舊）', () => {
  const v = [
    ver('2.0', half([act('燎燃的盛意', ['塔納託斯'], '2024/08/15')])),
    ver('2.5', half([act('燎燃的盛意', ['塔納託斯'], '2025/02/27')])),
  ]
  const s = mechBannerStatus('塔納託斯', v, NOW)
  assert.equal(s.kind, 'past')
  assert.equal(s.past.length, 2)
  assert.equal(mechBannerText(s, NOW).text, '最近一次 2025/02/27・機甲池')
  assert.equal(mechBannerText(s, NOW).sub, '時間線紀錄：機甲池 2 次')
})

test('跨域海運：看這一期的自選名單（selection），沒填時退回半版本的 mechSelection', () => {
  const ship = (selection?: string[]) => act('跨域海運', [], '2026/10/15', 2, { type: 'crossShipping', mechs: undefined, selection })
  const v = [ver('3.3', half([ship(['幻惑', '赫克托爾'])]))]
  const s = mechBannerStatus('赫克托爾', v, NOW)
  assert.equal(s.kind, 'ongoing')
  assert.equal(s.title, undefined, '海運不當標題：插畫屬於機甲池，沒有機甲池紀錄就退回「招募插畫」')
  assert.deepEqual(mechBannerText(s, NOW), { kind: 'ongoing', label: '可自選', text: '剩 12 天（至 10/28）', sub: '跨域海運・自選', predicted: false, rerun: false })
  const legacy = [ver('3.3', half([ship(undefined)], { mechSelection: ['赫克托爾'] }))]
  assert.equal(mechBannerStatus('赫克托爾', legacy, NOW).kind, 'ongoing')
  assert.equal(mechBannerStatus('巨像', v, NOW).kind, 'none')
})

test('戰令：mechs 列的獎勵機甲；與機甲池同時開放時機甲池優先', () => {
  const pass = act('謀海魅影', ['盜火者', '巨像'], '2026/10/08', 6, { type: 'battlePass' })
  const p = mechBannerText(mechBannerStatus('巨像', [ver('3.3', half([pass]))], NOW), NOW)
  assert.equal(p.label, '戰令中')
  assert.equal(p.sub, '戰令「謀海魅影」')
  const both = [ver('3.3', half([pass, act('十字線上的明光', ['盜火者'], '2026/10/15')]))]
  const s = mechBannerStatus('盜火者', both, NOW)
  assert.equal(s.current?.source, 'banner')
  assert.equal(s.title, '十字線上的明光')
})

test('已結束：最近一期可能是海運；次數依種類分開數', () => {
  const v = [
    ver('3.1', half([act('破陣強襲', ['赫克托爾'], '2026/08/06')])),
    ver('3.3', half([act('跨域海運', [], '2026/10/01', 2, { type: 'crossShipping', mechs: undefined, selection: ['赫克托爾'] })])),
  ]
  const st = mechBannerStatus('赫克托爾', v, NOW)
  assert.equal(st.title, '破陣強襲', '最近一期是海運，標題仍是池名')
  const t = mechBannerText(st, NOW)
  assert.equal(t.text, '最近一次 2026/10/01・跨域海運')
  assert.equal(t.sub, '時間線紀錄：機甲池 1 次・跨域海運 1 次')
  assert.equal(mechBannerStatus('赫克托爾', v, NOW).timelineVersion, '3.3')
})

test('顯示閘門：hidden 與沒有 weeks 的活動不算；別台、機師池、陸服也不算', () => {
  const v = [ver('3.3', {
    ...half([
      act('藏起來', ['丙'], '2026/10/15', 2, { hidden: true }),
      act('沒寫多久', ['丙'], '2026/10/15', 2, { weeks: undefined }),
      act('別台', ['丁'], '2026/10/15'),
      act('機師池', ['丙'], '2026/10/15', 2, { type: 'specificPilotBanner' }),
    ]),
    cnActivities: [act('陸服', ['丙'], '2026/10/15')],
  } as PatchHalf)]
  assert.deepEqual(mechBannerRuns('丙', v, NOW), [])
  assert.equal(mechBannerText(mechBannerStatus('丙', v, NOW), NOW).text, '尚無卡池紀錄')
})

test('名稱前後空白照樣比對；空名稱不比對', () => {
  const v = [ver('3.3', half([act(' 可能性的彼端 ', [' 莫比烏斯X'], '2026/10/01', 6)]))]
  assert.equal(mechBannerStatus('莫比烏斯X ', v, NOW).title, '可能性的彼端')
  assert.equal(mechBannerStatus(undefined, v, NOW).kind, 'none')
  assert.equal(mechBannerStatus('  ', v, NOW).kind, 'none')
})
