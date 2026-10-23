import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  convertTags, tokenRefs, statLines, isDifficultyBuff, isBossRef, unitKey,
  createBattleContext, whenOf, whenText, deriveTimeline,
  parseCnOpen, twStatusOf, matchTimeline, classifyBossMismatch,
} from './raidRender.mjs'

test('isBossRef：BOSS／編號／# 前綴都算，其他不算', () => {
  for (const r of ['BOSS', 'BOSS1', '#BOSS2']) assert.ok(isBossRef(r), r)
  for (const r of ['BOSS-helper1', 'Boss', 'Enemy1', '', null]) assert.ok(!isBossRef(r), String(r))
})

test('unitKey：載具加 v 前綴避免與戰術單位撞號', () => {
  assert.equal(unitKey('unit', 853501), '853501')
  assert.equal(unitKey('vehicle', 840901), 'v840901')
})

test('convertTags：五種遊戲標籤', () => {
  const { text, unknownTags } = convertTags(
    '携带<buf ID=98305013>[加能防固]</buf>时，周围<color=#F74848>3</color>格；<buf ID=1></buf>；' +
    '<range type=1>面前2×5格</range>；<skill mainSkill=8820522></skill>；清除<terrian ID=88329010 />',
  )
  assert.equal(text, '携带⟦buf:98305013|加能防固⟧时，周围⟦em:3⟧格；⟦buf:1⟧；面前2×5格；⟦main:8820522⟧；清除⟦terrain:88329010⟧')
  assert.deepEqual(unknownTags, [])
  assert.deepEqual(tokenRefs(text).sort(), ['buf:1', 'buf:98305013', 'main:8820522', 'terrain:88329010'])
})

test('convertTags：標籤帶屬性（click=false）也認得', () => {
  assert.equal(convertTags('无法进行<buf ID=900022 click=false>[援护防御]</buf>').text, '无法进行⟦buf:900022|援护防御⟧')
  assert.equal(convertTags('施加<buf ID=21144011 click=false></buf>').text, '施加⟦buf:21144011⟧')
})

test('convertTags：顏色包著其他標籤時只拿掉顏色；不認得的標籤回報', () => {
  const { text, unknownTags } = convertTags('<color=#F00><buf ID=5>[x]</buf></color><b>粗</b>')
  assert.equal(text, '⟦buf:5|x⟧粗')
  assert.deepEqual(unknownTags, ['b', 'b'])
})

test('statLines：四部位＋整機同值合併成一行，其餘逐行、沒收的列 unknown', () => {
  const hp = ['WapBodyHPMaxMulti', 'WapLArmHPMaxMulti', 'WapRArmHPMaxMulti', 'WapLegHPMaxMulti', 'WapEntiretyHPMaxMulti']
  const props = [
    ...hp.map((key) => ({ key, value: 0.297 })),
    { key: 'ActorAttackMulti', value: 0.14 },
    { key: 'DefenderActorCriticalAppendValue', value: 217 },
    { key: 'SawAttackAdd', value: 30 },
    { key: 'SomethingNew', value: 1 },
  ]
  const { lines, unknown } = statLines(props)
  assert.deepEqual(lines, ['耐久 +29.7%', '攻擊 +14%', '抗暴 +217', '電鋸攻擊 +30'])
  assert.deepEqual(unknown, ['SomethingNew'])
})

test('statLines：部位不齊就逐部位列；負值用全形減號', () => {
  const { lines } = statLines([{ key: 'WapBodyHPMaxMulti', value: -0.3 }, { key: 'WapLegHPMaxMulti', value: -0.4 }])
  assert.deepEqual(lines, ['軀幹耐久 −30%', '腿部耐久 −40%'])
})

test('isDifficultyBuff：不可見且名稱帶 Raid', () => {
  assert.ok(isDifficultyBuff({ visible: false, name: '回血版Raid强化新5（SS天花板）' }))
  assert.ok(!isDifficultyBuff({ visible: true, name: 'Raid强化' }))
  assert.ok(!isDifficultyBuff({ visible: false, name: '支援协议Ⅰ' }))
})

// 第 21 期第 1 關（戰場 8535）的觸發器精簡版：預警／回合增援／黑板變數／每回合事件
const battle8535 = {
  actors: [
    { kind: 'unit', configId: 853501, ref: 'BOSS' },
    { kind: 'unit', configId: 853502, ref: '#Tank' },
    { kind: 'unit', configId: 2203012, ref: 'Enemy1' },
  ],
  triggers: [
    { event: 'FormationSetupStart', repeat: false, conds: [], actions: [{ t: 'setVar', key: '副T', value: 0 }, { t: 'setVar', key: '阶段', value: 0 }] },
    { event: 'BattleTurnStart', repeat: true, conds: [], actions: [{ t: 'addBuff', buffId: 98409012, target: { ref: 'BOSS' } }] },
    { event: 'ActorDie', repeat: true, conds: [{ t: 'CurrDeadActorIsOneOf', s: '#Tank' }],
      actions: [{ t: 'setVar', key: '副T', value: 1 }, { t: 'marker', name: 'Tank', open: true }] },
    { event: 'BattleTurnEnd', repeat: true, conds: [{ t: 'BlackBoardKeyValueEqual', p1: 1, s: '副T' }, { t: 'BlackBoardKeyValueEqual', s: '阶段' }],
      actions: [{ t: 'summon', kind: 'unit', configId: 840902, as: '#Tank', at: 'Tank', team: 4, level: '96/96/96' }, { t: 'setVar', key: '副T', value: 0 }] },
    { event: 'OperationEnd', repeat: false, conds: [{ t: 'ActorBodyPartHpGreat', p1: 1, p2: 7500, s: 'BOSS', not: 1 }],
      actions: [{ t: 'setVar', key: '阶段', value: 1 }] },
    { event: 'BattleTurnStart', repeat: false, conds: [{ t: 'Round', p1: 2 }], actions: [{ t: 'marker', name: 'add2-1', open: true }] },
    { event: 'BattleTurnStart', repeat: false, conds: [{ t: 'Round', p1: 3 }],
      actions: [{ t: 'summon', kind: 'unit', configId: 2311012, as: 'add2-1', at: 'add2-1', team: 4, level: '96/96/96' },
                { t: 'summon', kind: 'unit', configId: 2311012, as: 'add2-2', at: 'add2-1', team: 4, level: '96/96/96' }] },
  ],
}
const names = { 853501: '卢克', 853502: '自律戴亚斯', 840902: '自律戴亚斯', 2203012: '老练佣兵', 2311012: '老练佣兵' }
const ctx8535 = () => createBattleContext(battle8535, { nameOf: (k) => names[k] || k })

test('whenOf：Round → 第 N 回合；或群組收集多個回合', () => {
  const ctx = ctx8535()
  assert.deepEqual(whenOf(battle8535.triggers[6], ctx).when, { kind: 'turn', turns: [3], timing: 'start' })
  const orGroup = { event: 'BattleTurnStart', repeat: true, actions: [],
    conds: [{ t: 'GroupBegin', p1: 1 }, { t: 'Round', p1: 7 }, { t: 'Round', p1: 2 }, { t: 'GroupEnd' }, { t: 'ActorAlreadyDead', s: 'Enemy1', not: 1 }] }
  const r = whenOf(orGroup, ctx)
  assert.deepEqual(r.when, { kind: 'turn', turns: [2, 7], timing: 'start' })
  assert.deepEqual(r.also, ['⟦unit:2203012⟧仍存活'])
})

test('whenOf：黑板變數由設定它的觸發器反推（之後／之前）', () => {
  const r = whenOf(battle8535.triggers[3], ctx8535())
  assert.deepEqual(r.when, { kind: 'everyTurn', timing: 'end' })
  assert.deepEqual(r.also, ['⟦unit:853502⟧被擊破之後', '⟦unit:853501⟧的軀幹耐久降到 75% 以下之前'])
  assert.deepEqual(r.unknown, [])
})

test('whenOf：對不到的條件型別 → unknown，不猜', () => {
  const r = whenOf({ event: 'BattleTurnStart', repeat: false, conds: [{ t: 'BrandNewCond' }], actions: [] }, ctx8535())
  assert.deepEqual(r.when, { kind: 'unknown' })
  assert.deepEqual(r.unknown, ['cond:BrandNewCond'])
})

test('whenText', () => {
  assert.equal(whenText({ kind: 'turn', turns: [2, 7], timing: 'start' }), '第 2、7 回合開始')
  assert.equal(whenText({ kind: 'everyTurn', timing: 'end', from: 3 }), '第 3 回合起每回合結束')
  assert.equal(whenText({ kind: 'unknown' }), null)
})

test('deriveTimeline：增援合併同模板、帶預警；每回合事件；同名單位只列一次', () => {
  const ctx = ctx8535()
  const tl = deriveTimeline(battle8535, ctx, { showBuff: (id) => id === 98409012 })
  assert.equal(tl.reinforcements.length, 2)
  const [turn3, guard] = tl.reinforcements
  assert.deepEqual(turn3, {
    when: { kind: 'turn', turns: [3], timing: 'start' },
    warn: { kind: 'turn', turns: [2], timing: 'start' },
    units: [{ unit: '2311012', count: 2, level: 96 }],
  })
  assert.deepEqual(guard.when, { kind: 'everyTurn', timing: 'end' })
  assert.deepEqual(guard.warn, { kind: 'condition', text: '⟦unit:853502⟧被擊破時' })
  assert.deepEqual(tl.events, [{ when: { kind: 'everyTurn', timing: 'start' }, text: '⟦unit:853501⟧獲得⟦buf:98409012⟧' }])
  assert.deepEqual(tl.unknown, [])
})

test('parseCnOpen／twStatusOf', () => {
  assert.equal(parseCnOpen('2024/7/8  5:00:00'), '2024-07-08')
  assert.equal(parseCnOpen(''), undefined)
  assert.equal(twStatusOf('2026/08/20', '2026-10-24'), 'open')
  assert.equal(twStatusOf('2026/10/24', '2026-10-24'), 'open')
  assert.equal(twStatusOf('2026/11/12', '2026-10-24'), 'planned')
  assert.equal(twStatusOf('', '2026-10-24'), undefined)
})

test('matchTimeline：以台版期名比對（忽略空白）', () => {
  const raids = [{ name: '逐火之心', versionId: 'v3.2' }, { name: '重裝征伐', versionId: 'v3.5' }]
  assert.equal(matchTimeline('逐火之心', raids).versionId, 'v3.2')
  assert.equal(matchTimeline('逐火 之心', raids).versionId, 'v3.2')
  assert.equal(matchTimeline('伏影', raids), null)
})

test('classifyBossMismatch：疑似未強化／只是顯示用／正常', () => {
  // 第 10 期磨鍊 110202：戰場實際放初試模板、沒有任何強化來源
  assert.equal(classifyBossMismatch({ code: 'hard', bossIdField: 834201, actual: [834101], normalActual: [834101], enhanced: false }), 'notEnhanced')
  // 第 16 期：BossID 指向初試同名首領，實際模板不同
  assert.equal(classifyBossMismatch({ code: 'hard', bossIdField: 843301, actual: [843401], normalActual: [843301], enhanced: true }), 'displayOnly')
  // 第 21 期：四難度共用模板，但有關卡全域強化
  assert.equal(classifyBossMismatch({ code: 'd4', bossIdField: 853501, actual: [853501], normalActual: [853501], enhanced: true }), null)
})
