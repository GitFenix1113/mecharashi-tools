// PLAN-043 Phase D：背包技能解析層單元測試
//
// 這層的兩個易錯點都在此鎖住：
//   ① `@N` 的等級覆寫必須逐欄位 `?? 父層`，不是「有 level 就整包換掉」——
//      整包換掉會讓沒填該級描述的技能顯示成空白。
//   ② 查不到的 id 必須略過而非產出半殘條目，否則前台會渲染出 undefined。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveBackpackSkills, buildBackpackSkillMap, hasBackpackSkills, stripBaselineClause, composeBackpackSkills,
} from './backpackSkills.ts'
import type { BackpackSkillDoc } from '../types'

const SKILL = {
  id: 'bpskill_移動強化',
  name: '移動強化',
  skillType: '被動技能',
  description: '父層描述',
  descriptionRefs: { 過熱: { refType: 'buff', refId: 'buff_過熱' } },
  icon: '/images/skills/背包技能/base.png',
  effects: [{ stat: 'dmg', value: 5, scope: 'self', condition: null }],
  buffIds: ['buff_父'],
  levels: [
    // Lv1 只填階名 → 其餘全部沿用父層（最容易寫錯的一格）
    { level: 1, name: '移動強化Ⅰ' },
    {
      level: 2, name: '移動強化Ⅱ',
      description: '第二級描述',
      descriptionRefs: { 隱形: { refType: 'buff', refId: 'buff_隱形' } },
      icon: '/images/skills/背包技能/lv2.png',
      effects: [{ stat: 'dmg', value: 10, scope: 'self', condition: null }],
      buffIds: ['buff_二'],
    },
  ],
} as unknown as BackpackSkillDoc

const MAP = buildBackpackSkillMap([SKILL])

test('無 @N 時使用技能頂層欄位', () => {
  const [r] = resolveBackpackSkills({ skillIds: ['bpskill_移動強化'] }, MAP)
  assert.equal(r.level, undefined)
  assert.equal(r.name, '移動強化')
  assert.equal(r.description, '父層描述')
  assert.deepEqual(r.buffIds, ['buff_父'])
  assert.equal(r.origin, '背包技能:移動強化')
})

test('@1 只填階名 → 其餘欄位逐一沿用父層（不可整包換掉）', () => {
  const [r] = resolveBackpackSkills({ skillIds: ['bpskill_移動強化@1'] }, MAP)
  assert.equal(r.level, 1)
  assert.equal(r.name, '移動強化Ⅰ', '階名應取該級的')
  assert.equal(r.description, '父層描述', '該級未填 → 沿用父層，不可變空字串')
  assert.equal(r.icon, '/images/skills/背包技能/base.png')
  assert.deepEqual(r.effects, SKILL.effects)
  assert.deepEqual(r.buffIds, ['buff_父'])
  assert.deepEqual(r.descriptionRefs, SKILL.descriptionRefs)
  assert.equal(r.origin, '背包技能:移動強化 Lv1')
})

test('@2 全部填滿 → 每個欄位都取該級的', () => {
  const [r] = resolveBackpackSkills({ skillIds: ['bpskill_移動強化@2'] }, MAP)
  assert.equal(r.name, '移動強化Ⅱ')
  assert.equal(r.description, '第二級描述')
  assert.equal(r.icon, '/images/skills/背包技能/lv2.png')
  assert.deepEqual(r.effects, [{ stat: 'dmg', value: 10, scope: 'self', condition: null }])
  assert.deepEqual(r.buffIds, ['buff_二'])
  assert.deepEqual(r.descriptionRefs, { 隱形: { refType: 'buff', refId: 'buff_隱形' } })
})

test('指定了不存在的等級 → 退回頂層欄位，但保留 level 供除錯', () => {
  const [r] = resolveBackpackSkills({ skillIds: ['bpskill_移動強化@9'] }, MAP)
  assert.equal(r.level, 9)
  assert.equal(r.name, '移動強化', '查無該級 → 顯示技能原名而非空白')
  assert.equal(r.description, '父層描述')
})

test('查不到的 id 略過，不產出半殘條目', () => {
  const r = resolveBackpackSkills({ skillIds: ['bpskill_不存在', 'bpskill_移動強化@1'] }, MAP)
  assert.equal(r.length, 1)
  assert.equal(r[0].id, 'bpskill_移動強化')
})

test('raw 保留原始字串（含 @N），id 是拆解後的裸值', () => {
  const [r] = resolveBackpackSkills({ skillIds: ['bpskill_移動強化@2'] }, MAP)
  assert.equal(r.raw, 'bpskill_移動強化@2')
  assert.equal(r.id, 'bpskill_移動強化')
})

test('空 / undefined / 空字串元素皆安全', () => {
  assert.deepEqual(resolveBackpackSkills(null, MAP), [])
  assert.deepEqual(resolveBackpackSkills(undefined, MAP), [])
  assert.deepEqual(resolveBackpackSkills({ skillIds: [] }, MAP), [])
  assert.deepEqual(resolveBackpackSkills({ skillIds: ['', ''] as string[] }, MAP), [])
})

test('hasBackpackSkills 看的是「解析得到幾個」而非 skillIds.length', () => {
  // 全部斷鏈時長度仍 > 0；若 gate 用 length 判斷會開出一塊空白區
  assert.equal(hasBackpackSkills({ skillIds: ['bpskill_不存在'] }, MAP), false)
  assert.equal(hasBackpackSkills({ skillIds: ['bpskill_移動強化'] }, MAP), true)
  assert.equal(hasBackpackSkills({ skillIds: [] }, MAP), false)
})

test('多個技能保序', () => {
  const second = { ...SKILL, id: 'bpskill_第二', name: '第二', levels: undefined } as unknown as BackpackSkillDoc
  const map = buildBackpackSkillMap([SKILL, second])
  const r = resolveBackpackSkills({ skillIds: ['bpskill_第二', 'bpskill_移動強化@1'] }, map)
  assert.deepEqual(r.map((x) => x.name), ['第二', '移動強化Ⅰ'])
})

// ── PLAN-043 Phase F：S+ 複合背包（＝功能背包 ＋ 變體背包）───────────────────
//
// 官方文本實測（2026-08-30，97/98 逐字相符）：複合技能的「軀幹耐久值提升X%」
// **只出現一次、且來自功能側**。以下 fixture 是正式庫的真實描述，不要改成好記的假字串——
// 這條規則唯一會出錯的地方就是標點與句式，而假字串正好把那些差異洗掉。

const 出力增幅 = {
  id: 'bpskill_出力增幅', name: '出力增幅', skillType: '被動技能', description: '', effects: [], buffIds: [],
  levels: [{ level: 3, name: '出力增幅Ⅲ', description: '機兵獲得額外300出力;機兵軀幹耐久值提升10%,造成傷害提升5%' }],
} as unknown as BackpackSkillDoc

const 命中壓制 = {
  id: 'bpskill_命中壓制', name: '命中壓制', skillType: '被動技能', description: '', effects: [], buffIds: [],
  levels: [{ level: 3, name: '命中壓制Ⅲ', description: '對戰時，使敵人命中率降低10%；機甲軀幹耐久值提升10%' }],
} as unknown as BackpackSkillDoc

/** 修理裝置Ⅰ **自己沒有底線句** —— 9 筆修理系複合背包因此完全沒有軀幹加成。 */
const 修理裝置 = {
  id: 'bpskill_修理裝置', name: '修理裝置', skillType: '被動技能', description: '', effects: [], buffIds: [],
  levels: [{ level: 1, name: '修理裝置Ⅰ', description: '行動開始時對自己釋放1次0.6倍修理量的修理,不可修復破損的部位' }],
} as unknown as BackpackSkillDoc

const 複合MAP = buildBackpackSkillMap([出力增幅, 命中壓制, 修理裝置])

test('複合背包：本體側完整照登、材料側扣掉底線句', () => {
  // 出力干擾背包·命中 ＝ 出力背包 ＋ 干擾背包·命中
  const r = resolveBackpackSkills({ skillIds: ['bpskill_出力增幅@3', 'bpskill_命中壓制@3'] }, 複合MAP)
  assert.equal(r.length, 2)
  assert.deepEqual(r.map((x) => x.role), ['base', 'addon'])
  assert.equal(r[0].description, '機兵獲得額外300出力;機兵軀幹耐久值提升10%,造成傷害提升5%', '本體側原樣照登')
  assert.equal(r[1].description, '對戰時，使敵人命中率降低10%', '材料側扣掉底線句')
  // 兩框聯集 ＝ 官方合併文案的三行，且「軀幹耐久」只出現一次
  const 全文 = r.map((x) => x.description).join('')
  assert.equal(全文.match(/軀幹耐久值提升/g)?.length, 1)
})

test('修理系反例：本體側本來就沒有底線句 ⇒ 複合後完全沒有軀幹加成', () => {
  // 這 9 筆是「取最大 / 去重」寫法會算錯、只有「丟棄材料側那份」會算對的證據
  const r = resolveBackpackSkills({ skillIds: ['bpskill_修理裝置@1', 'bpskill_命中壓制@3'] }, 複合MAP)
  assert.equal(r[0].description, '行動開始時對自己釋放1次0.6倍修理量的修理,不可修復破損的部位')
  assert.equal(r[1].description, '對戰時，使敵人命中率降低10%')
  assert.ok(!r.some((x) => /軀幹耐久值提升/.test(x.description)), '整個複合背包不該出現任何軀幹加成')
})

test('單技能背包（A/B/S/SS）恆為本體側，底線句不動', () => {
  const [r] = resolveBackpackSkills({ skillIds: ['bpskill_命中壓制@3'] }, 複合MAP)
  assert.equal(r.role, 'base')
  assert.equal(r.description, '對戰時，使敵人命中率降低10%；機甲軀幹耐久值提升10%',
    'S 級干擾背包單獨使用時，底線加成是真的生效的')
})

test('本體側斷鏈時，材料側遞補為本體側（不可留下扣掉底線的殘缺顯示）', () => {
  const r = resolveBackpackSkills({ skillIds: ['bpskill_不存在@3', 'bpskill_命中壓制@3'] }, 複合MAP)
  assert.equal(r.length, 1)
  assert.equal(r[0].role, 'base')
  assert.equal(r[0].description, '對戰時，使敵人命中率降低10%；機甲軀幹耐久值提升10%')
})

test('stripBaselineClause：保留原分隔符、收掉尾端殘留、無底線句時原樣返回', () => {
  assert.equal(stripBaselineClause('甲；乙'), '甲；乙', '沒有底線句 → 一個字都不動')
  assert.equal(stripBaselineClause('對戰時，使敵人命中率降低10%；機甲軀幹耐久值提升10%'), '對戰時，使敵人命中率降低10%')
  assert.equal(stripBaselineClause('甲;機兵軀幹耐久值提升10%,造成傷害提升5%'), '甲', '半形分隔符與「造成傷害」尾巴一起走')
  assert.equal(stripBaselineClause('甲\n機甲軀幹耐久值提升8%\n乙'), '甲\n乙', '夾在中間時分隔符不能塌掉')
  assert.equal(stripBaselineClause('躯干耐久值提升10%'), '', '也認簡體（爬蟲若落官方原文）')
  assert.equal(stripBaselineClause(''), '')
})

// ── Phase F 後段：合成單張卡（形狀與遊戲內一致）─────────────────────────────

const 戰術彈量增加 = {
  id: 'bpskill_戰術彈量增加', name: '戰術彈量增加', skillType: '被動技能', description: '', effects: [], buffIds: [],
  levels: [{ level: 2, name: '戰術彈量增加Ⅱ', description: '戰術武器彈量+2；\n機甲軀幹耐久值提升10%，造成傷害提升5%' }],
} as unknown as BackpackSkillDoc

const 合成MAP = buildBackpackSkillMap([出力增幅, 命中壓制, 修理裝置, 戰術彈量增加])
const composeOf = (name: string, skillIds: string[]) =>
  composeBackpackSkills({ name, skillIds }, resolveBackpackSkills({ skillIds }, 合成MAP))

test('合成：一張卡、遊戲內的名字、本體側的圖示', () => {
  const r = composeOf('出力干擾背包·命中', ['bpskill_出力增幅@3', 'bpskill_命中壓制@3'])
  assert.equal(r.length, 1, '兩支併成一張卡')
  assert.equal(r[0].name, '出力增幅Ⅲ·命中', '尾碼取自**背包名**的變體，不是材料技能名（命中壓制Ⅲ）')
  assert.equal(r[0].icon, 出力增幅.levels?.[0].icon ?? 出力增幅.icon, '圖示沿用本體側')
  assert.equal(r[0].description,
    '機兵獲得額外300出力；\n對戰時，使敵人命中率降低10%；\n機兵軀幹耐久值提升10%,造成傷害提升5%',
    '本體特徵 → 材料特徵 → 底線，底線只留本體側那一份')
  assert.equal(r[0].description.match(/軀幹耐久值提升/g)?.length, 1)
})

test('合成：底線是「取本體側」而不是「取最強」——修理系會拆穿這兩者的差別', () => {
  // 修理裝置Ⅰ 沒有底線句；材料側的命中壓制Ⅲ 有「軀幹+10%」。
  // 「取最強」會把那 +10% 撿回來，但官方的修理系複合背包一點軀幹加成都沒有。
  const r = composeOf('修理干擾背包·命中', ['bpskill_修理裝置@1', 'bpskill_命中壓制@3'])
  assert.equal(r[0].name, '修理裝置Ⅰ·命中')
  assert.equal(r[0].description,
    '行動開始時對自己釋放1次0.6倍修理量的修理,不可修復破損的部位；\n對戰時，使敵人命中率降低10%')
  assert.ok(!/軀幹耐久值提升/.test(r[0].description), '一點軀幹加成都不該有')
})

test('合成：本體側是多行時，底線仍排到最後', () => {
  const r = composeOf('彈藥強化背包·首攻', ['bpskill_戰術彈量增加@2', 'bpskill_命中壓制@3'])
  assert.equal(r[0].description,
    '戰術武器彈量+2；\n對戰時，使敵人命中率降低10%；\n機甲軀幹耐久值提升10%，造成傷害提升5%')
})

test('合成：buffIds 取聯集去重，origin 保留兩支來源', () => {
  const a = { ...出力增幅, id: 'bpskill_A', levels: undefined, description: '甲', buffIds: ['b1', 'b2'] } as unknown as BackpackSkillDoc
  const b = { ...命中壓制, id: 'bpskill_B', levels: undefined, description: '乙', buffIds: ['b2', 'b3'] } as unknown as BackpackSkillDoc
  const map = buildBackpackSkillMap([a, b])
  const [r] = composeBackpackSkills({ name: 'X干擾背包·命中', skillIds: ['bpskill_A', 'bpskill_B'] },
    resolveBackpackSkills({ skillIds: ['bpskill_A', 'bpskill_B'] }, map))
  assert.deepEqual(r.buffIds, ['b1', 'b2', 'b3'])
  assert.ok(r.origin.includes('＋'), '合成名在技能庫查無此人，origin 要講得出 buff 是誰給的')
  assert.equal(r.composedFrom?.length, 2)
  assert.equal(r.id, 'bpskill_A', 'id/raw/doc 仍是本體側那一支')
})

test('合成：單技能背包（A/B/S/SS）原樣通過，一個字都不動', () => {
  const before = resolveBackpackSkills({ skillIds: ['bpskill_命中壓制@3'] }, 合成MAP)
  const after = composeBackpackSkills({ name: '干擾背包·命中', skillIds: ['bpskill_命中壓制@3'] }, before)
  assert.equal(after, before, '同一個陣列參照，連複製都不做')
  assert.equal(after[0].name, '命中壓制Ⅲ')
  assert.equal(after[0].description, '對戰時，使敵人命中率降低10%；機甲軀幹耐久值提升10%')
})

test('合成：背包名沒有變體尾碼時退回本體技能原名，不拼出 undefined', () => {
  const [r] = composeBackpackSkills({ name: '某個沒有間隔號的背包', skillIds: ['bpskill_出力增幅@3', 'bpskill_命中壓制@3'] },
    resolveBackpackSkills({ skillIds: ['bpskill_出力增幅@3', 'bpskill_命中壓制@3'] }, 合成MAP))
  assert.equal(r.name, '出力增幅Ⅲ')
})
