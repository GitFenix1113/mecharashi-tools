// PLAN-065-C B-2：配裝 → 傷害模擬請求
//   npm test   →   node --test "src/**/*.test.ts"
//
// 驗的是「查表有沒有查對」：槽位／武器組／混搭部件／元件／技能／形態對到哪個 gameRef，
// 查不到的有沒有列進 unmapped、該整套送不出去時是不是 null。
// 武裝討伐的 fixture 取自 2026-10-24 匯入草稿的實際值（第 18、15、11、3 期），
// 並與私有引擎資料的目標鍵（battleMapId:templateId、期數、關卡序、難度、首領序號）逐一對過。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Backpack, Boss, Component, Mech, MechForm, Module, Pilot, PilotSkillDoc, RaidSeason, Stage, Weapon } from '../../types/index.ts'
import type { EquipSet, LoadoutDraft } from '../../types/loadout.ts'
import { buildWorld } from '../../utils/loadoutRules.ts'
import {
  buildRaidTarget, buildSimLoadout, buildSingleRequest, defaultScenario, highestRaidDifficulty, simSlotOf, simWeaponKey,
  type GrowthAssumptions,
} from './requestBuilder.ts'

// ─── fixtures ────────────────────────────────────────────────────────────────

const part = (position: string, over: Record<string, unknown> = {}) => ({
  position, durable: 100, armor: 10, firepower: 10, weight: 100, interface: 'Ⅱ型接口', ...over,
})

const mech = (id: string, suitId: number | null, over: Partial<Mech> = {}): Mech => ({
  id, name: id, armorType: '中甲', firepower: 0, armor: 0, evasion: 0, mobility: 0, weight: 400, output: 3000,
  parts: {
    torso: part('torso', { output: 3000 }), leftArm: part('leftArm'), rightArm: part('rightArm'), legs: part('legs'),
  },
  moduleFixedIds: [],
  ...(suitId === null ? {} : { gameRef: { suitId } }),
  ...over,
} as unknown as Mech)

const pilot = (id: string, pilotInfoId: number | null, over: Partial<Pilot> = {}): Pilot => ({
  id, name: id,
  neuralDrive: [{ name: 'γ1', icon: '', slots: [], levels: [{ level: 1, minSum: 1 }] }],
  ...(pilotInfoId === null ? {} : { gameRef: { pilotInfoId } }),
  ...over,
} as unknown as Pilot)

const weapon = (id: string, equipSlot: string, weaponInfoId: number | null): Weapon => ({
  id, name: id, equipSlot, weight: 100,
  ...(weaponInfoId === null ? {} : { gameRef: { weaponInfoId } }),
} as unknown as Weapon)

const component = (id: string, weaponEntryId: number | null): Component => ({
  id, name: id, componentType: 'Condition',
  ...(weaponEntryId === null ? {} : { gameRef: { weaponEntryId } }),
} as unknown as Component)

const lv = (n: number) => Array.from({ length: n }, (_, i) => ({ level: i + 1, description: '' }))
const module = (id: string, name: string, gameRef: Module['gameRef'] | null, add = 1, levels = 4): Module => ({
  id, name, slot: '通用模組', boundMechId: null, boundPart: null, moduleAddLevel: add, levels: lv(levels),
  ...(gameRef === null ? {} : { gameRef }),
} as unknown as Module)

const skill = (id: string, gameRef: PilotSkillDoc['gameRef'] | null): PilotSkillDoc => ({
  id, name: id, type: '被動技能', description: '', icon: '', effects: [], buffIds: [],
  ...(gameRef === null ? {} : { gameRef }),
} as unknown as PilotSkillDoc)

const backpack = (id: string, backpackInfoId: number | null): Backpack => ({
  id, name: id, type: 'BackupEquipment', rarity: 'SS', weight: 100, slot: 'back',
  ...(backpackInfoId === null ? {} : { gameRef: { backpackInfoId } }),
} as unknown as Backpack)

const form = (id: string, pilotId: string, passiveSkillId: number | null, order = 1): MechForm => ({
  id, pilotId, name: id, order, description: '', independentLoadout: true,
  restrict: { kind: 'weaponType', allow: [] },
  ...(passiveSkillId === null ? {} : { gameRef: { passiveSkillId } }),
} as unknown as MechForm)

const WORLD = buildWorld({
  pilots: [
    pilot('pilot_a', 10103174),
    pilot('pilot_noref', null),
    pilot('pilot_form', 10103160),
    pilot('pilot_yao', 10103199),
  ],
  mechs: [
    mech('mech_a', 1011),
    mech('mech_b', 2022),
    mech('mech_noref', null),
    mech('mech_fixed', 3033, {
      parts: {
        torso: part('torso', { output: 3000 }),
        leftArm: part('leftArm', { fixedArmament: [{ weaponId: 'w_fixed', slot: 'shoulder' }] }),
        rightArm: part('rightArm'), legs: part('legs'),
      },
    } as Partial<Mech>),
  ],
  weapons: [
    weapon('w_lh', 'singleHand', 50101),
    weapon('w_rh', 'singleHand', 50102),
    weapon('w_dual', 'dualHand', 50103),
    weapon('w_ls', 'shoulder', 50104),
    weapon('w_rs', 'shoulder', 50105),
    weapon('w_back', 'back', 50106),
    weapon('w_noref', 'singleHand', null),
  ],
  backpacks: [backpack('bp_a', 60101706), backpack('bp_noref', null)],
  forms: [
    form('form_x_先鋒', 'pilot_form', 5223, 1),
    form('form_x_突擊', 'pilot_form', null, 2),
    { ...form('form_曜_巡航', 'pilot_yao', 7777), independentLoadout: false } as MechForm,
  ],
  components: [component('c_t1', 70001), component('c_e1', 70002), component('c_noref', null)],
  modules: [
    module('mod_2a', '刀劍模組Ⅱ', { entryId: 3001, itemId: 300102 }, 2, 4),
    module('mod_1b', '校準模組Ⅰ', { entryId: 3002 }, 1, 4),
    module('mod_noref', '未連結模組', null),
  ],
  pilotSkills: [
    skill('skill_main', { mainSkillIds: [202102, 202102], passiveSkillIds: [] }),
    skill('skill_passive', { passiveSkillIds: [202103] }),
    skill('skill_empty', { mainSkillIds: [] }),
    skill('skill_noref', null),
  ],
})

const RESEARCH_ONLY: GrowthAssumptions = { research: 'full' }

const draftOf = (over: Partial<LoadoutDraft> & { set?: EquipSet } = {}): LoadoutDraft => {
  const { set, ...rest } = over
  const key = rest.activeSetKey ?? 'default'
  return {
    pilotId: 'pilot_a',
    mechId: 'mech_a',
    activeSetKey: key,
    sets: { [key]: set ?? { mounts: [{ weaponId: 'w_rh', bank: 'main', slot: 'singleHand', side: 'right' }] } },
    ...rest,
  }
}

// ─── 槽位與武器組 ────────────────────────────────────────────────────────────

test('simSlotOf：六種槽位，缺左右時回 null', () => {
  assert.equal(simSlotOf({ slot: 'singleHand', side: 'left' }), 'lh')
  assert.equal(simSlotOf({ slot: 'singleHand', side: 'right' }), 'rh')
  assert.equal(simSlotOf({ slot: 'dualHand' }), 'dual')
  assert.equal(simSlotOf({ slot: 'shoulder', side: 'left' }), 'ls')
  assert.equal(simSlotOf({ slot: 'shoulder', side: 'right' }), 'rs')
  assert.equal(simSlotOf({ slot: 'back' }), 'back')
  assert.equal(simSlotOf({ slot: 'singleHand' }), null)
  assert.equal(simSlotOf({ slot: 'shoulder' }), null)
  assert.equal(simWeaponKey('main', 'rh'), 'm-rh')
  assert.equal(simWeaponKey('backup', 'ls'), 'b-ls')
})

test('武器：槽位、武器組、key 固定且依順序排列；weaponKeys 對回站上的格子', () => {
  const r = buildSimLoadout({
    world: WORLD, growth: RESEARCH_ONLY,
    draft: draftOf({
      set: {
        backpackId: 'bp_a',
        mounts: [
          // 刻意打亂順序：輸出應依 第一組→第二組、lh→rh→dual→ls→rs→back
          { weaponId: 'w_back', bank: 'main', slot: 'back' },
          { weaponId: 'w_rs', bank: 'main', slot: 'shoulder', side: 'right' },
          { weaponId: 'w_lh', bank: 'backup', slot: 'singleHand', side: 'left' },
          { weaponId: 'w_ls', bank: 'main', slot: 'shoulder', side: 'left' },
          { weaponId: 'w_dual', bank: 'main', slot: 'dualHand' },
        ],
      },
    }),
  })
  assert.ok(r.loadout)
  assert.deepEqual(
    r.loadout.weapons.map((w) => [w.key, w.slot, w.bank, w.weaponInfoId]),
    [
      ['m-dual', 'dual', 0, 50103],
      ['m-ls', 'ls', 0, 50104],
      ['m-rs', 'rs', 0, 50105],
      ['m-back', 'back', 0, 50106],
      ['b-lh', 'lh', 1, 50101],
    ],
  )
  assert.deepEqual(r.weaponKeys.find((k) => k.key === 'b-lh'),
    { key: 'b-lh', bank: 'backup', slot: 'singleHand', side: 'left', simSlot: 'lh', weaponDocId: 'w_lh' })
  assert.deepEqual(r.weaponKeys.find((k) => k.key === 'm-dual'),
    { key: 'm-dual', bank: 'main', slot: 'dualHand', simSlot: 'dual', weaponDocId: 'w_dual' })
  for (const w of r.loadout.weapons) assert.match(w.key, /^[A-Za-z0-9_-]{1,16}$/)
  assert.deepEqual(r.loadout.backpack, { backpackInfoId: 60101706 })
})

test('只轉目前分頁的武器與背包', () => {
  const r = buildSimLoadout({
    world: WORLD, growth: RESEARCH_ONLY,
    draft: {
      pilotId: 'pilot_form', mechId: 'mech_a', activeSetKey: 'form_x_先鋒',
      sets: {
        'form_x_先鋒': { mounts: [{ weaponId: 'w_rh', bank: 'main', slot: 'singleHand', side: 'right' }] },
        'form_x_突擊': { backpackId: 'bp_a', mounts: [{ weaponId: 'w_lh', bank: 'main', slot: 'singleHand', side: 'left' }] },
      },
    },
  })
  assert.ok(r.loadout)
  assert.deepEqual(r.loadout.weapons.map((w) => w.weaponInfoId), [50102])
  assert.equal(r.loadout.backpack, undefined)
})

// ─── 機甲：混搭部件與模組 ────────────────────────────────────────────────────

test('機甲：四部位預設同一套裝；混搭的部位換成來源機甲的 suitId；品質一律 SS', () => {
  const same = buildSimLoadout({ world: WORLD, growth: RESEARCH_ONLY, draft: draftOf() })
  assert.ok(same.loadout)
  assert.equal(same.loadout.mech.quality, 'SS')
  assert.deepEqual(same.loadout.mech.parts,
    { body: { suitId: 1011 }, larm: { suitId: 1011 }, rarm: { suitId: 1011 }, leg: { suitId: 1011 } })

  const mixed = buildSimLoadout({
    world: WORLD, growth: RESEARCH_ONLY, draft: draftOf({ parts: { leftArm: 'mech_b', legs: 'mech_b' } }),
  })
  assert.ok(mixed.loadout)
  assert.deepEqual(mixed.loadout.mech.parts,
    { body: { suitId: 1011 }, larm: { suitId: 2022 }, rarm: { suitId: 1011 }, leg: { suitId: 2022 } })
})

test('混搭部件的來源機甲沒有 gameRef → 整套送不出去，列一次 unmapped', () => {
  const r = buildSimLoadout({
    world: WORLD, growth: RESEARCH_ONLY, draft: draftOf({ parts: { leftArm: 'mech_noref', rightArm: 'mech_noref' } }),
  })
  assert.equal(r.loadout, null)
  assert.deepEqual(r.unmapped.filter((u) => u.collection === 'mechs').map((u) => [u.docId, u.reason]),
    [['mech_noref', 'noGameRef']])
})

test('模組：送 entryId／itemId 與站上模擬器的同族等級；沒有 gameRef 的列 unmapped', () => {
  const r = buildSimLoadout({
    world: WORLD, growth: RESEARCH_ONLY,
    draft: draftOf({ modules: { torso: 'mod_2a', leftArm: 'mod_2a', rightArm: 'mod_1b', legs: 'mod_noref' } }),
  })
  assert.ok(r.loadout)
  // 刀劍模組Ⅱ 每顆 +2、兩顆 = 4（上限 4）；校準模組Ⅰ 一顆 = 1
  assert.deepEqual(r.loadout.mech.modules, [
    { position: 'body', entryId: 3001, itemId: 300102, level: 4 },
    { position: 'larm', entryId: 3001, itemId: 300102, level: 4 },
    { position: 'rarm', entryId: 3002, level: 1 },
  ])
  assert.ok(r.loadout.mech.modules.every((m) => m.position !== 'innate'))
  assert.deepEqual(r.unmapped, [
    { collection: 'modules', docId: 'mod_noref', name: '未連結模組', reason: 'noGameRef', where: 'leg' },
  ])
})

test('部件上有固定武裝：不送、附註說明', () => {
  const r = buildSimLoadout({ world: WORLD, growth: RESEARCH_ONLY, draft: draftOf({ mechId: 'mech_fixed' }) })
  assert.ok(r.loadout)
  assert.deepEqual(r.loadout.weapons.map((w) => w.weaponInfoId), [50102])
  assert.ok(r.notes.some((n) => n.includes('固定武裝')))
})

// ─── 元件、改裝、技能、形態 ──────────────────────────────────────────────────

test('元件：觸／應各自轉 weaponEntryId；沒有 gameRef 的不送並標出在哪一把', () => {
  const r = buildSimLoadout({
    world: WORLD, growth: RESEARCH_ONLY,
    draft: draftOf({
      set: {
        mounts: [{
          weaponId: 'w_rh', bank: 'main', slot: 'singleHand', side: 'right',
          setup: { triggerComponentIds: ['c_t1', 'c_noref'], effectComponentIds: ['c_e1'] },
        }, { weaponId: 'w_lh', bank: 'main', slot: 'singleHand', side: 'left' }],
      },
    }),
  })
  assert.ok(r.loadout)
  const rh = r.loadout.weapons.find((w) => w.key === 'm-rh')
  assert.deepEqual(rh?.components, { trigger: [70001], effect: [70002] })
  assert.equal(r.loadout.weapons.find((w) => w.key === 'm-lh')?.components, undefined)
  assert.deepEqual(r.unmapped, [
    { collection: 'components', docId: 'c_noref', name: 'c_noref', reason: 'noGameRef', where: 'm-rh' },
  ])
})

test('改裝：省略＝不送；有 default 時每把都送，perWeapon 依 key 覆寫', () => {
  const mounts = [
    { weaponId: 'w_rh', bank: 'main' as const, slot: 'singleHand' as const, side: 'right' as const },
    { weaponId: 'w_lh', bank: 'main' as const, slot: 'singleHand' as const, side: 'left' as const },
  ]
  const none = buildSimLoadout({ world: WORLD, growth: RESEARCH_ONLY, draft: draftOf({ set: { mounts } }) })
  assert.ok(none.loadout)
  assert.ok(none.loadout.weapons.every((w) => !('refit' in w)))
  assert.deepEqual(none.loadout.growth, { research: 'full' })

  const some = buildSimLoadout({
    world: WORLD,
    growth: {
      research: 'none',
      refit: { default: { normal: 8, advanced: 4 }, perWeapon: { 'm-lh': { normal: 3, advanced: 0, advValue: 12 } } },
    },
    draft: draftOf({ set: { mounts } }),
  })
  assert.ok(some.loadout)
  assert.deepEqual(some.loadout.weapons.map((w) => [w.key, w.refit]), [
    ['m-lh', { normal: 3, advanced: 0, advValue: 12 }],
    ['m-rh', { normal: 8, advanced: 4 }],
  ])
  assert.deepEqual(some.loadout.growth, { research: 'none' })
})

test('機師：pilotInfoId、潛能預設滿潛、等級不送；攜帶技能取 gameRef（去掉空陣列與重複）', () => {
  const r = buildSimLoadout({
    world: WORLD, growth: RESEARCH_ONLY,
    draft: draftOf({ skills: { carried: ['skill_main', 'skill_noref', 'skill_passive', 'skill_empty', 'skill_gone'] } }),
  })
  assert.ok(r.loadout)
  const p = r.loadout.pilot
  assert.equal(p.pilotInfoId, 10103174)
  assert.equal(p.potential, 5)
  assert.equal('level' in p, false)
  assert.deepEqual(p.carried, [{ mainSkillIds: [202102] }, { passiveSkillIds: [202103] }])
  assert.deepEqual(r.unmapped.map((u) => [u.collection, u.docId, u.reason]), [
    ['pilotSkills', 'skill_noref', 'noGameRef'],
    ['pilotSkills', 'skill_empty', 'noGameRef'],
    ['pilotSkills', 'skill_gone', 'notFound'],
  ])
  // 神經驅動：送空陣列並附註
  assert.deepEqual(p.ndEffective, [])
  assert.ok(r.notes.some((n) => n.includes('神經驅動')))

  const lowered = buildSimLoadout({ world: WORLD, growth: RESEARCH_ONLY, draft: draftOf({ potential: 2 }) })
  assert.equal(lowered.loadout?.pilot.potential, 2)
})

test('形態：目前分頁是形態時送 passiveSkillId；形態沒有 gameRef 列 unmapped；default 分頁不送', () => {
  const mounts = [{ weaponId: 'w_rh', bank: 'main' as const, slot: 'singleHand' as const, side: 'right' as const }]
  const withForm = buildSimLoadout({
    world: WORLD, growth: RESEARCH_ONLY,
    draft: draftOf({ pilotId: 'pilot_form', activeSetKey: 'form_x_先鋒', set: { mounts } }),
  })
  assert.deepEqual(withForm.loadout?.pilot.form, { passiveSkillId: 5223 })

  const noRef = buildSimLoadout({
    world: WORLD, growth: RESEARCH_ONLY,
    draft: draftOf({ pilotId: 'pilot_form', activeSetKey: 'form_x_突擊', set: { mounts } }),
  })
  assert.ok(noRef.loadout)
  assert.equal(noRef.loadout.pilot.form, undefined)
  assert.deepEqual(noRef.unmapped.map((u) => [u.collection, u.docId, u.reason]), [['forms', 'form_x_突擊', 'noGameRef']])

  // 有形態、但沒有獨立配裝分頁的機師：不送形態並附註
  const yao = buildSimLoadout({ world: WORLD, growth: RESEARCH_ONLY, draft: draftOf({ pilotId: 'pilot_yao' }) })
  assert.ok(yao.loadout)
  assert.equal(yao.loadout.pilot.form, undefined)
  assert.ok(yao.notes.some((n) => n.includes('形態')))
})

// ─── 送不出去的情況 ──────────────────────────────────────────────────────────

test('機師沒有 gameRef → loadout null，其餘仍照常列出 unmapped', () => {
  const r = buildSimLoadout({
    world: WORLD, growth: RESEARCH_ONLY,
    draft: draftOf({ pilotId: 'pilot_noref', set: { mounts: [{ weaponId: 'w_noref', bank: 'main', slot: 'singleHand', side: 'right' }] } }),
  })
  assert.equal(r.loadout, null)
  assert.deepEqual(r.unmapped.map((u) => [u.collection, u.docId, u.reason]), [
    ['pilots', 'pilot_noref', 'noGameRef'],
    ['weapons', 'w_noref', 'noGameRef'],
  ])
})

test('機甲沒有 gameRef、查不到、集合還沒載入 → loadout null', () => {
  const noref = buildSimLoadout({ world: WORLD, growth: RESEARCH_ONLY, draft: draftOf({ mechId: 'mech_noref' }) })
  assert.equal(noref.loadout, null)
  assert.deepEqual(noref.unmapped.map((u) => [u.collection, u.docId, u.reason]), [['mechs', 'mech_noref', 'noGameRef']])

  const gone = buildSimLoadout({ world: WORLD, growth: RESEARCH_ONLY, draft: draftOf({ mechId: 'mech_gone' }) })
  assert.equal(gone.loadout, null)
  assert.deepEqual(gone.unmapped.map((u) => [u.docId, u.reason]), [['mech_gone', 'notFound']])

  const empty = buildWorld({ pilots: [], mechs: [], weapons: [], backpacks: [] })
  const notLoaded = buildSimLoadout({ world: empty, growth: RESEARCH_ONLY, draft: draftOf() })
  assert.equal(notLoaded.loadout, null)
  assert.deepEqual(notLoaded.unmapped.map((u) => [u.collection, u.reason]), [
    ['pilots', 'notLoaded'], ['mechs', 'notLoaded'], ['weapons', 'notLoaded'],
  ])
})

test('一把武器都送不出去 → loadout null（請求至少要一把）', () => {
  const r = buildSimLoadout({
    world: WORLD, growth: RESEARCH_ONLY,
    draft: draftOf({ set: { backpackId: 'bp_noref', mounts: [{ weaponId: 'w_noref', bank: 'main', slot: 'singleHand', side: 'left' }] } }),
  })
  assert.equal(r.loadout, null)
  assert.deepEqual(r.weaponKeys, [])
  assert.deepEqual(r.unmapped.map((u) => [u.collection, u.docId, u.where]), [['weapons', 'w_noref', 'm-lh'], ['backpacks', 'bp_noref', undefined]])
  assert.ok(r.notes.some((n) => n.includes('武器')))
})

// ─── 武裝討伐目標（實際值）───────────────────────────────────────────────────

const ALL4 = ['normal', 'hard', 'hell', 'd4'] as const

const season = (seq: number, difficulties: readonly string[] = ALL4): RaidSeason => ({
  id: `raid-${String(seq).padStart(2, '0')}`, seq, name: '', nameCn: '', difficulties: [...difficulties],
  difficultyNames: { normal: '初試', hard: '磨鍊', hell: '死境', d4: '煉獄' },
  twStatus: 'open', groups: [], weekBuffs: [], published: true, parserVersion: 1, sourceBuild: '',
} as unknown as RaidSeason)

/** variants：難度 → [battleId, bossIds] */
const stage = (seasonId: string, group: number, variants: Record<string, [number, string[]]>): Stage => ({
  id: `${seasonId}-g${group}`, name: '', category: '討伐', bossIds: [],
  raid: {
    kind: 'dungeon', seasonId, group, order: 5 - group, isFinal: group === 4, unitDict: {}, refDict: {},
    variants: Object.fromEntries(Object.entries(variants).map(([d, [battleId, bossIds]]) =>
      [d, { levelId: 0, battleId, name: '', turnLimit: 0, bossIds, units: [], reinforcements: [], bounties: [] }])),
  },
} as unknown as Stage)

/** variants：難度 → templateId */
const boss = (id: string, name: string, variants: Record<string, number>): Boss => ({
  id, name, skills: [],
  variants: Object.fromEntries(Object.entries(variants).map(([d, templateId]) =>
    [d, { templateId, level: 0, weapons: [], skills: [], estimated: false }])),
} as unknown as Boss)

const S18 = season(18)
const S18_G1 = stage('raid-18', 1, {
  normal: [8465, ['raid-18-g1-b1']], hard: [8466, ['raid-18-g1-b1']], hell: [8467, ['raid-18-g1-b1']], d4: [8468, ['raid-18-g1-b1']],
})
const S18_G2 = stage('raid-18', 2, { hell: [8471, ['raid-18-g2-b1']], d4: [8472, ['raid-18-g2-b1']] })
const S15 = season(15)
const S15_G2 = stage('raid-15', 2, { d4: [8420, ['raid-15-g2-b1']] })
const S11 = season(11)
const S11_G1 = stage('raid-11', 1, { d4: [8356, ['raid-11-g1-b1', 'raid-11-g1-b2']] })
const S03 = season(3, ['normal', 'hard', 'hell'])
const S03_G1 = stage('raid-03', 1, { hell: [8223, ['raid-03-g1-b1']] })
const BOSSES = [
  boss('raid-18-g1-b1', '黛博拉', { normal: 846599, hard: 846699, hell: 846799, d4: 846899 }),
  boss('raid-18-g2-b1', '汙泥', { hell: 847101, d4: 847201 }),
  boss('raid-15-g2-b1', '艾登', { d4: 842001 }),
  boss('raid-11-g1-b1', '隼人', { d4: 835601 }),
  boss('raid-11-g1-b2', '桑尼', { d4: 835602 }),
  boss('raid-03-g1-b1', '加西亞', { hell: 822301 }),
]

test('武裝討伐：預設最高難度（煉獄＝4），對到引擎目標鍵 battleMapId:templateId', () => {
  const key = (r: ReturnType<typeof buildRaidTarget>) =>
    r.target ? `${r.target.battleMapId}:${r.target.templateId} s${r.target.seasonNo} st${r.target.stageNo} d${r.target.difficulty} b${r.target.bossIndex}` : r.reason

  assert.deepEqual(buildRaidTarget({ season: S18, stage: S18_G1, bosses: BOSSES }).target, {
    kind: 'raid', seasonNo: 18, stageNo: 1, difficulty: 4, battleMapId: 8468, templateId: 846899, bossIndex: 0,
  })
  assert.equal(key(buildRaidTarget({ season: S18, stage: S18_G2, bosses: BOSSES })), '8472:847201 s18 st2 d4 b0')
  assert.equal(key(buildRaidTarget({ season: S15, stage: S15_G2, bosses: new Map(BOSSES.map((b) => [b.id, b])) })), '8420:842001 s15 st2 d4 b0')
  // 雙首領關：第二位的序號是 1
  assert.equal(key(buildRaidTarget({ season: S11, stage: S11_G1, bosses: BOSSES })), '8356:835601 s11 st1 d4 b0')
  assert.equal(key(buildRaidTarget({ season: S11, stage: S11_G1, bosses: BOSSES, bossId: 'raid-11-g1-b2' })), '8356:835602 s11 st1 d4 b1')
  // 沒有 d4 的早期：最高難度是 hell（3）
  assert.equal(highestRaidDifficulty(S03), 'hell')
  assert.equal(key(buildRaidTarget({ season: S03, stage: S03_G1, bosses: BOSSES })), '8223:822301 s3 st1 d3 b0')
  // 指定難度與瞄準部位
  assert.deepEqual(buildRaidTarget({ season: S18, stage: S18_G1, bosses: BOSSES, difficulty: 'hell', part: 'body' }).target, {
    kind: 'raid', seasonNo: 18, stageNo: 1, difficulty: 3, battleMapId: 8467, templateId: 846799, bossIndex: 0, part: 'body',
  })
})

test('武裝討伐：資料對不上時回 reason', () => {
  assert.equal(buildRaidTarget({ season: S15, stage: S18_G1, bosses: BOSSES }).target, null)
  assert.equal(buildRaidTarget({ season: S15, stage: S15_G2, bosses: BOSSES, difficulty: 'normal' }).target, null)
  assert.equal(buildRaidTarget({ season: S18, stage: S18_G1, bosses: BOSSES, bossId: 'raid-18-g2-b1' }).target, null)
  assert.equal(buildRaidTarget({ season: S18, stage: S18_G1, bosses: [] }).target, null)
  const plain = { id: 'stage_x', name: '', category: '危境', bossIds: [] } as unknown as Stage
  assert.equal(buildRaidTarget({ season: S18, stage: plain, bosses: BOSSES }).target, null)
  for (const r of [buildRaidTarget({ season: S18, stage: plain, bosses: BOSSES })]) assert.equal(typeof r.reason, 'string')
})

// ─── 請求組裝 ────────────────────────────────────────────────────────────────

test('buildSingleRequest：一套配裝 × 一個目標 × 預設情境，每個動作一個 job', () => {
  const built = buildSimLoadout({ world: WORLD, growth: RESEARCH_ONLY, draft: draftOf() })
  assert.ok(built.loadout)
  const target = buildRaidTarget({ season: S18, stage: S18_G1, bosses: BOSSES }).target
  assert.ok(target)
  const req = buildSingleRequest({
    loadout: built.loadout, target, level: 'L2', perHit: true,
    actions: [{ weaponKey: 'm-rh', skill: 'default' }, { weaponKey: 'm-rh', skill: 'equipment', aimPart: 'body' }],
  })
  assert.equal(req.v, 1)
  assert.equal(req.locale, 'zh-TW')
  assert.equal(req.mode, 'single')
  assert.deepEqual(req.output, { level: 'L2', perHit: true })
  assert.equal(req.loadouts.length, 1)
  assert.deepEqual(req.targets, [target])
  assert.deepEqual(req.scenarios, [{
    switchCatalog: '0.0.0', attack: { timing: 'auto' }, switches: {}, declared: {}, numeric: {},
    probability: 'expected', boss: { openingState: true },
  }])
  assert.deepEqual(req.scenarios[0], defaultScenario())
  assert.deepEqual(req.jobs, [
    { l: 0, t: 0, s: 0, action: { weaponKey: 'm-rh', skill: 'default' } },
    { l: 0, t: 0, s: 0, action: { weaponKey: 'm-rh', skill: 'equipment', aimPart: 'body' } },
  ])
  assert.equal('seed' in req, false)
  assert.equal('clientEngineVersion' in req, false)

  const l1 = buildSingleRequest({ loadout: built.loadout, target, level: 'L1', actions: [], clientEngineVersion: '0.2.0' })
  assert.deepEqual(l1.output, { level: 'L1' })
  assert.equal(l1.clientEngineVersion, '0.2.0')
  // JSON 化之後不留 undefined 欄位（Worker 的 schema 拒絕未知欄位）
  assert.deepEqual(JSON.parse(JSON.stringify(req)), req)
})
