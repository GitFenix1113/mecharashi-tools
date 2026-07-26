// PLAN-034 Phase B：神經驅動算力 BUFF 階覆寫層單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { NeuralDrive, NeuralDriveAbility, GameBuff, EntityRef } from '../types'
import {
  pickLevel, buildNdBuffOverrides, effectiveLevel, defaultNdLevels,
  isSelfBuff, EMPTY_ND_OVERRIDES, checkBuffLevelName, codePointsOf, buildNumLevelOf,
  type NdOverrideRejection,
} from './ndOverrides.ts'

// ─── fixtures：以艾達（凝勢）與梅利莎（常效維護）的實測形狀為藍本 ──────────────

const buff = (over: Partial<GameBuff> & { id: string }): GameBuff => ({
  name: over.id.replace(/^buff_/, ''),
  description: '',
  buffType: 'statBoost',
  effects: [],
  ...over,
})

/** 艾達 γ2：Lv1/Lv4/Lv5/Lv6 的 minSum = 1/10/13/16（實測值） */
const adaDrive: NeuralDrive = {
  name: 'γ2',
  icon: '',
  slots: [],
  levels: [
    { level: 1, minSum: 1,  abilityId: 'nd_雙生星芒1', effect: '', skillName: '', skillIcon: '', iconLocal: '', effects: [], buffIds: [] },
    { level: 2, minSum: 4,  abilityId: 'nd_x2',        effect: '', skillName: '', skillIcon: '', iconLocal: '', effects: [], buffIds: [] },
    { level: 3, minSum: 7,  abilityId: 'nd_x3',        effect: '', skillName: '', skillIcon: '', iconLocal: '', effects: [], buffIds: [] },
    { level: 4, minSum: 10, abilityId: 'nd_雙生星芒2', effect: '', skillName: '', skillIcon: '', iconLocal: '', effects: [], buffIds: [] },
    { level: 5, minSum: 13, abilityId: 'nd_雙生星芒3', effect: '', skillName: '', skillIcon: '', iconLocal: '', effects: [], buffIds: [] },
    { level: 6, minSum: 16, abilityId: 'nd_雙生星芒4', effect: '', skillName: '', skillIcon: '', iconLocal: '', effects: [], buffIds: [] },
  ],
}

const ability = (id: string, buffUpgrades?: string[]): NeuralDriveAbility => ({
  id, name: id, description: '', effects: [], buffIds: [], ...(buffUpgrades ? { buffUpgrades } : {}),
})

const ADA_ABILITIES: Record<string, NeuralDriveAbility> = {
  nd_雙生星芒1: ability('nd_雙生星芒1'),                        // 只是條件引用，不升階
  nd_x2: ability('nd_x2'),
  nd_x3: ability('nd_x3'),
  nd_雙生星芒2: ability('nd_雙生星芒2', ['buff_凝勢@2']),
  nd_雙生星芒3: ability('nd_雙生星芒3', ['buff_凝勢@3']),
  nd_雙生星芒4: ability('nd_雙生星芒4'),                        // γ2≥16 是非等級性變更，走 ndVariants
}

const NING = buff({
  id: 'buff_凝勢',
  levels: [
    { level: 1, name: '凝勢Ⅰ', maxStack: 5 },
    { level: 2, name: '凝勢Ⅱ', maxStack: 7 },
    { level: 3, name: '凝勢Ⅲ', maxStack: 7 },
  ],
})

function build(opts: {
  levels: Record<string, number>
  drives?: NeuralDrive[]
  abilities?: Record<string, NeuralDriveAbility>
  buffs?: GameBuff[]
  rejections?: NdOverrideRejection[]
}) {
  const abilities = opts.abilities ?? ADA_ABILITIES
  const buffs = opts.buffs ?? [NING]
  return buildNdBuffOverrides({
    drives: opts.drives ?? [adaDrive],
    levels: opts.levels,
    abilityOf: (id) => abilities[id],
    buffOf: (id) => buffs.find(b => b.id === id),
    onReject: opts.rejections ? (r) => opts.rejections!.push(r) : undefined,
  })
}

// ─── pickLevel ────────────────────────────────────────────────────────────────

test('pickLevel：以 level 值比對，非連號／亂序都取得到（索引式取級在此會錯）', () => {
  // 實測正式資料：buff_迴避率提升 levels=[3,4]、buff_迴避率降低 levels=[2,3,5,4]
  const sparse = [{ level: 3, name: 'a' }, { level: 4, name: 'b' }]
  assert.equal(pickLevel(sparse, 3)?.name, 'a')      // levels[2] 會是 undefined
  assert.equal(pickLevel(sparse, 4)?.name, 'b')
  assert.equal(pickLevel(sparse, 1), undefined)

  const shuffled = [{ level: 2 }, { level: 3 }, { level: 5 }, { level: 4 }]
  assert.deepEqual(pickLevel(shuffled, 4), { level: 4 }) // levels[3] 會拿到 level:4，純屬巧合
  assert.deepEqual(pickLevel(shuffled, 5), { level: 5 }) // levels[4] 則是 undefined
})

test('pickLevel：空 / undefined 一律優雅降級', () => {
  assert.equal(pickLevel(undefined, 1), undefined)
  assert.equal(pickLevel([], 1), undefined)
  assert.equal(pickLevel([{ level: 1 }], undefined), undefined)
})

// ─── buildNdBuffOverrides：門檻與取最高 ────────────────────────────────────────

test('未達門檻 → 表為空（艾達 γ2 Lv1，算力 1）', () => {
  assert.equal(build({ levels: { 'γ2': 1 } }).size, 0)
})

test('達門檻 → 進表；跨門檻取最高（Lv4→2、Lv5→3、Lv6→3）', () => {
  assert.deepEqual(build({ levels: { 'γ2': 4 } }).get('buff_凝勢'), { level: 2, name: '凝勢Ⅱ', zone: 'γ2' })
  assert.deepEqual(build({ levels: { 'γ2': 5 } }).get('buff_凝勢'), { level: 3, name: '凝勢Ⅲ', zone: 'γ2' })
  assert.deepEqual(build({ levels: { 'γ2': 6 } }).get('buff_凝勢'), { level: 3, name: '凝勢Ⅲ', zone: 'γ2' })
})

test('梅利莎式：門檻 minSum=1 的升階在預設視圖即生效', () => {
  const drive: NeuralDrive = {
    ...adaDrive,
    levels: [{ ...adaDrive.levels[0], abilityId: 'nd_金絲雀1' }],
  }
  const out = build({
    levels: { 'γ2': 1 },
    drives: [drive],
    abilities: { nd_金絲雀1: ability('nd_金絲雀1', ['buff_常效維護@2']) },
    buffs: [buff({ id: 'buff_常效維護', levels: [{ level: 1, name: '常效維護Ⅰ' }, { level: 2, name: '常效維護Ⅱ' }] })],
  })
  assert.deepEqual(out.get('buff_常效維護'), { level: 2, name: '常效維護Ⅱ', zone: 'γ2' })
})

test('沒有任何 buffUpgrades → 表為空（今日全站狀態）', () => {
  const plain = Object.fromEntries(Object.keys(ADA_ABILITIES).map(k => [k, ability(k)]))
  assert.equal(build({ levels: { 'γ2': 6 }, abilities: plain }).size, 0)
})

test('abilityId 被洗掉（地雷七）→ 覆寫恆為空，不報錯', () => {
  const stripped: NeuralDrive = { ...adaDrive, levels: adaDrive.levels.map(l => ({ ...l, abilityId: undefined })) }
  assert.equal(build({ levels: { 'γ2': 6 }, drives: [stripped] }).size, 0)
})

// ─── 七道閘門：任一不過 → 整族退場 ────────────────────────────────────────────

test('閘門：該階沒填 name → 整族不進表（即使當前生效的是另一個合格階）', () => {
  const rejections: NdOverrideRejection[] = []
  const partial = buff({
    id: 'buff_凝勢',
    levels: [
      { level: 1, name: '凝勢Ⅰ' },
      { level: 2, name: '凝勢Ⅱ' },   // 當前算力生效的這階是好的
      { level: 3 },                   // 但 Lv5 才會用到的這階缺 name
    ],
  })
  // γ2 Lv4 只會用到 lv2，仍必須整族退場：否則使用者拉到 Lv5 會遇到「字突然不動了」
  const out = build({ levels: { 'γ2': 4 }, buffs: [partial], rejections })
  assert.equal(out.size, 0)
  assert.equal(rejections[0].reason, 'level-unnamed')
})

test('閘門：debuff 家族硬性排除（敵我混用無解）', () => {
  const rejections: NdOverrideRejection[] = []
  const debuff = buff({ id: 'buff_凝勢', buffType: 'debuff', levels: [{ level: 2, name: 'x' }, { level: 3, name: 'y' }] })
  assert.equal(build({ levels: { 'γ2': 6 }, buffs: [debuff], rejections }).size, 0)
  assert.equal(rejections[0].reason, 'not-self-buff')
})

test('閘門：該階不存在 → 整族退場', () => {
  const rejections: NdOverrideRejection[] = []
  const shallow = buff({ id: 'buff_凝勢', levels: [{ level: 1, name: '凝勢Ⅰ' }, { level: 2, name: '凝勢Ⅱ' }] })
  assert.equal(build({ levels: { 'γ2': 6 }, buffs: [shallow], rejections }).size, 0)
  assert.equal(rejections[0].reason, 'level-missing')
})

test('閘門：minSum=0（PilotAdmin 新增級預設值）視為未設定，不是零門檻恆真', () => {
  const rejections: NdOverrideRejection[] = []
  const zeroed: NeuralDrive = {
    ...adaDrive,
    levels: [{ ...adaDrive.levels[3], minSum: 0 }],
  }
  assert.equal(build({ levels: { 'γ2': 1 }, drives: [zeroed], rejections }).size, 0)
  assert.equal(rejections[0].reason, 'minsum-zero')
})

test('閘門：buffs 未載入 → 整族不進表（chip 維持原字面，無中間態閃爍）', () => {
  const rejections: NdOverrideRejection[] = []
  assert.equal(build({ levels: { 'γ2': 6 }, buffs: [], rejections }).size, 0)
  assert.equal(rejections[0].reason, 'buff-missing')
})

test('閘門：buffUpgrades 元素沒帶 @N → 整族退場', () => {
  const rejections: NdOverrideRejection[] = []
  const abilities = { ...ADA_ABILITIES, nd_雙生星芒2: ability('nd_雙生星芒2', ['buff_凝勢']) }
  assert.equal(build({ levels: { 'γ2': 6 }, abilities, rejections }).size, 0)
  assert.equal(rejections[0].reason, 'no-level')
})

test('閘門：目標不是階梯 buff → 整族退場', () => {
  const rejections: NdOverrideRejection[] = []
  assert.equal(build({ levels: { 'γ2': 6 }, buffs: [buff({ id: 'buff_凝勢' })], rejections }).size, 0)
  assert.equal(rejections[0].reason, 'not-tiered')
})

test('isSelfBuff：statBoost / resource / state 通過，debuff / control 不通過', () => {
  for (const t of ['statBoost', 'resource', 'state']) assert.equal(isSelfBuff(buff({ id: 'b', buffType: t })), true)
  for (const t of ['debuff', 'control']) assert.equal(isSelfBuff(buff({ id: 'b', buffType: t })), false)
})

// ─── effectiveLevel：最容易寫錯的一行 ─────────────────────────────────────────

const OV = { entryOf: (id: string) => (id === 'buff_凝勢' ? { level: 3, name: '凝勢Ⅲ', zone: 'γ2' } : undefined) }
const ref = (over: Partial<EntityRef> = {}): EntityRef => ({ refType: 'buff', refId: 'buff_凝勢', ...over })

test('effectiveLevel：確實抬升才 lifted，並回傳該階顯示名', () => {
  assert.deepEqual(effectiveLevel(ref({ level: 1 }), OV), { level: 3, lifted: true, name: '凝勢Ⅲ' })
  assert.deepEqual(effectiveLevel(ref(), OV), { level: 3, lifted: true, name: '凝勢Ⅲ' }) // 無 level = base 0
})

test('effectiveLevel：覆寫是下限不是等號 —— 靜態 level:3 不會被 lv3 判成抬升、更不會被降級', () => {
  assert.deepEqual(effectiveLevel(ref({ level: 3 }), OV), { level: 3, lifted: false })
  const lower = { entryOf: () => ({ level: 2, name: '凝勢Ⅱ', zone: 'γ2' }) }
  assert.deepEqual(effectiveLevel(ref({ level: 3 }), lower), { level: 3, lifted: false })
})

test('effectiveLevel：fixedLevel 釘死不受抬升（對敵 debuff／規則宣告句／官方不改寫處）', () => {
  assert.deepEqual(effectiveLevel(ref({ level: 1, fixedLevel: true }), OV), { level: 1, lifted: false })
})

test('effectiveLevel：非 buff 引用一律不動（term 與 buff 撞名時的防線）', () => {
  // 實測 skill 正文的 [失穩] 指向 term_失穩、[失穩Ⅲ] 才指向 buff_失穩，兩者同頁並存
  assert.deepEqual(effectiveLevel(ref({ refType: 'term', level: 1 }), OV), { level: 1, lifted: false })
  assert.deepEqual(effectiveLevel(ref({ refType: 'skill' }), OV), { level: undefined, lifted: false })
})

test('effectiveLevel：表中沒有該 buff、或整張表為空 → byte-identical 等於今日行為', () => {
  assert.deepEqual(effectiveLevel(ref({ refId: 'buff_其他', level: 2 }), OV), { level: 2, lifted: false })
  for (const r of [ref(), ref({ level: 1 }), ref({ refType: 'term', level: 9 })]) {
    assert.deepEqual(effectiveLevel(r, EMPTY_ND_OVERRIDES), { level: r.level, lifted: false })
  }
})

// ─── buildNumLevelOf：數值 token 的取級（PLAN-034 F-1）─────────────────────────

test('buildNumLevelOf：抬升時回新階與來源分區（title 要說得出是哪一區的算力）', () => {
  const levelOf = buildNumLevelOf({ 凝勢Ⅰ: { refType: 'buff', refId: 'buff_凝勢', level: 1 } }, OV)
  assert.deepEqual(levelOf('buff_凝勢', 1), { level: 3, lifted: true, zone: 'γ2' })
})

test('buildNumLevelOf：與 effectiveLevel 同源 —— 下限語意、非 buff、表中沒有一律不動', () => {
  const levelOf = buildNumLevelOf(undefined, OV)
  assert.deepEqual(levelOf('buff_凝勢', 3), { level: 3, lifted: false })   // 靜態 lv3 不被 lv3 判成抬升
  assert.deepEqual(levelOf('buff_其他', 2), { level: 2, lifted: false })   // 表中沒有
  assert.deepEqual(levelOf('buff_凝勢', undefined), { level: 3, lifted: true, zone: 'γ2' }) // 無 lv 段 = base 0
})

test('buildNumLevelOf：空表 → 恆等今日行為（19 個無 provider 的 RefText 站點）', () => {
  const levelOf = buildNumLevelOf({ 凝勢Ⅰ: { refType: 'buff', refId: 'buff_凝勢', level: 1 } }, EMPTY_ND_OVERRIDES)
  for (const n of [undefined, 1, 2, 3]) assert.deepEqual(levelOf('buff_凝勢', n), { level: n, lifted: false })
})

test('buildNumLevelOf：同段任一引用被 fixedLevel 釘死 → 該 buff 的數值 token 一併釘死', () => {
  // 決策四：絕不允許「不換字但數值照抬」。若只釘 chip 不釘 token，同一句會變成
  // 「獲得1層[凝勢Ⅰ]…可疊加7層」——字面與數字互相矛盾，比不改更難察覺。
  const levelOf = buildNumLevelOf({ 凝勢Ⅰ: { refType: 'buff', refId: 'buff_凝勢', level: 1, fixedLevel: true } }, OV)
  assert.deepEqual(levelOf('buff_凝勢', 1), { level: 1, lifted: false })
})

test('buildNumLevelOf：釘死只影響被釘的那個 buff，同段其他家族照常抬升', () => {
  const ov = {
    entryOf: (id: string) =>
      id === 'buff_凝勢' ? { level: 3, name: '凝勢Ⅲ', zone: 'γ2' }
      : id === 'buff_常效維護' ? { level: 2, name: '常效維護Ⅱ', zone: 'γ2' }
      : undefined,
  }
  const levelOf = buildNumLevelOf({
    凝勢Ⅰ: { refType: 'buff', refId: 'buff_凝勢', level: 1, fixedLevel: true },
    常效維護Ⅰ: { refType: 'buff', refId: 'buff_常效維護', level: 1 },
  }, ov)
  assert.deepEqual(levelOf('buff_凝勢', 1), { level: 1, lifted: false })
  assert.deepEqual(levelOf('buff_常效維護', 1), { level: 2, lifted: true, zone: 'γ2' })
})

test('buildNumLevelOf：非 buff 的 fixedLevel 不會誤鎖同名 buff', () => {
  // 實測艾達天賦同時有 [凝勢]→term_凝勢 與 [凝勢Ⅰ]→buff_凝勢@1。
  // 若 pinned 收集時不濾 refType，一個釘死的 term 會連帶鎖住整個 buff 家族的數值。
  const levelOf = buildNumLevelOf({ 凝勢: { refType: 'term', refId: 'buff_凝勢', fixedLevel: true } }, OV)
  assert.deepEqual(levelOf('buff_凝勢', 1), { level: 3, lifted: true, zone: 'γ2' })
})

// ─── defaultNdLevels ──────────────────────────────────────────────────────────

test('defaultNdLevels：未帶 abilityOf 時維持原行為（γ1=3、γ2=1、其餘滿級）', () => {
  const drives: NeuralDrive[] = [
    { ...adaDrive, name: 'α' },
    { ...adaDrive, name: 'γ1' },
    { ...adaDrive, name: 'γ2' },
  ]
  assert.deepEqual(defaultNdLevels(drives), { 'α': 6, 'γ1': 3, 'γ2': 1 })
})

test('defaultNdLevels：該區有能力帶 buffUpgrades → 預設 Lv1，避免覆寫在首屏就全開', () => {
  const drives: NeuralDrive[] = [{ ...adaDrive, name: 'α' }, { ...adaDrive, name: 'γ1' }]
  // α 區掛的是艾達那組（含 buffUpgrades）→ 應被壓到 Lv1；γ1 亦然（原本 3）
  assert.deepEqual(defaultNdLevels(drives, (id) => ADA_ABILITIES[id]), { 'α': 1, 'γ1': 1 })
  // 沒有任何升階宣告時不受影響
  const plain = Object.fromEntries(Object.keys(ADA_ABILITIES).map(k => [k, ability(k)]))
  assert.deepEqual(defaultNdLevels(drives, (id) => plain[id]), { 'α': 6, 'γ1': 3 })
})

test('defaultNdLevels：空 / undefined 不炸', () => {
  assert.deepEqual(defaultNdLevels(undefined), {})
  assert.deepEqual(defaultNdLevels([]), {})
})

// ─── checkBuffLevelName（E-2 後台軟驗證）──────────────────────────────────────

test('checkBuffLevelName：全形羅馬且與 level 相符 → 通過', () => {
  assert.equal(checkBuffLevelName('凝勢', 2, '凝勢Ⅱ').ok, true)
  assert.equal(checkBuffLevelName('常效維護', 5, '常效維護Ⅴ').ok, true)
})

test('checkBuffLevelName：與 buff.name 完全相同 → 通過（官方無階名的家族，如幹勁）', () => {
  const r = checkBuffLevelName('幹勁', 2, '幹勁')
  assert.equal(r.ok, true)
  assert.match(r.message, /顯示為原名/)
})

test('checkBuffLevelName：未填 → 不通過，並說明整族會退場', () => {
  const r = checkBuffLevelName('凝勢', 3, undefined)
  assert.equal(r.ok, false)
  assert.match(r.message, /閘門③/)
  assert.equal(r.suggestion, '凝勢Ⅲ')
})

test('checkBuffLevelName：半形羅馬不通過（Phase A 已把全站正規化為全形）', () => {
  const r = checkBuffLevelName('短路', 2, '短路II')
  assert.equal(r.ok, false)
  assert.equal(r.suggestion, '短路Ⅱ')
})

test('checkBuffLevelName：損毀的重複 U+2160 被抓出，且訊息印出 code point', () => {
  const r = checkBuffLevelName('失穩', 3, '失穩ⅠⅠⅠ')
  assert.equal(r.ok, false)
  assert.match(r.message, /U\+2160 U\+2160 U\+2160/)
  assert.equal(r.suggestion, '失穩Ⅲ')
})

test('checkBuffLevelName：階名與 level 不一致（填 Ⅱ 但這是第 3 級）', () => {
  const r = checkBuffLevelName('凝勢', 3, '凝勢Ⅱ')
  assert.equal(r.ok, false)
  assert.equal(r.suggestion, '凝勢Ⅲ')
})

test('checkBuffLevelName：前綴不符 → 不通過', () => {
  assert.equal(checkBuffLevelName('凝勢', 1, '星爆Ⅰ').ok, false)
})

test('codePointsOf：逐字印出，這是唯一能看見 ⅠⅠ vs Ⅱ 差異的方式', () => {
  assert.equal(codePointsOf('ⅠⅠ'), 'U+2160 U+2160')
  assert.equal(codePointsOf('Ⅱ'), 'U+2161')
})
