// PLAN-052-L E-1：配裝摘要（純文字）
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這一組測的**不是排版好不好看**，而是三種「錯了不會報錯」的東西：
//   ① 摘要與匯出圖對不起來（同一套配裝、兩份輸出、不同內容）——一律共用同一支函式，
//      這裡釘的是「共用真的有生效」；
//   ② 靜默漏掉整段（固定武裝／形態鎖定／無此槽位／雙手武器的第二格）；
//   ③ 貼進 Discord ／ wiki 之後才發現的格式問題（markdown 記號、連結沒有獨佔一行）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Backpack, Mech, MechForm, Module, NeuralDriveAbility, Pilot, PilotSkillDoc, Weapon } from '../types/index.ts'
import {
  ArmorType, BackpackType, MechLicense, MechRestriction, ModuleSlot, WeaponEquipSlot, WeaponType,
} from '../types/enums.ts'
import { buildWorld, buildContext, loadoutBudget } from './loadoutRules.ts'
import { loadoutSummaryText, type LoadoutSummaryInput } from './loadoutSummaryText.ts'

// ─── fixtures ───────────────────────────────────────────────────────────────

const part = (weight: number, output?: number, iface = 'Ⅱ型接口', fixedArmament?: unknown[]) =>
  ({ position: 'torso', durable: 0, armor: 0, firepower: 0, weight, output, interface: iface, fixedArmament }) as never

const weapon = (over: Partial<Weapon> & Pick<Weapon, 'id' | 'name' | 'weight' | 'equipSlot'>): Weapon => ({
  type: WeaponType.Melee, kind: '刀劍', kindCoefficient: 1, attack: 0, accuracy: 0, critValue: 0,
  rangeType: 'manhattan', minRange: 1, maxRange: 1, ammoCount: 0, hitCount: 1, rarity: 'SS',
  mechRestriction: MechRestriction.NONE, isExclusive: false, triggerSlots: 0, effectSlots: 0, componentLimit: 4,
  fixedMod: { planName: '', maxLevel: 0, effects: [] },
  floatingMod: { planName: '', slots: 0, possibleEffects: [] }, skills: [], ...over,
} as Weapon)

const 雙手劍 = weapon({ id: 'w_dual', name: '雙手劍', weight: 800, equipSlot: WeaponEquipSlot.DUAL_HAND })
const 單手刀 = weapon({ id: 'w_one', name: '單手刀', weight: 300, equipSlot: WeaponEquipSlot.SINGLE_HAND })
/** 純封鎖型固定武裝：重量是**真的 0**，不是「沒有值」 */
const 儲能艙 = weapon({ id: 'w_fix', name: '嵐質儲能艙', weight: 0, equipSlot: WeaponEquipSlot.SHOULDER, type: WeaponType.Special, componentLimit: 0 })

const mod = (over: Partial<Module> & Pick<Module, 'id' | 'name' | 'rarity'>): Module => ({
  slot: ModuleSlot.UNIVERSAL, boundMechId: null, boundPart: null,
  dmg: 0, crit_rate: 0, critDmg: 0, acc_rate: 0, firepower_rate: 0, armor_rate: 0,
  crit_resist_rate: 0, output_bonus: 0, dodge_rate: 0, durable_rate: 0, dmg_resist_rate: 0,
  description: '', levels: [1, 2, 3, 4].map((level) => ({ level })) as never,
  ...over,
} as Module)

/** 敘述**含換行**（實測 186 顆有 33 顆這樣）—— 純文字裡要被壓成一行 */
const 猛擊裝置 = mod({
  id: 'mod_4101', name: '猛擊裝置', rarity: 'S',
  levels: [1, 2, 3, 4].map((level) => ({
    level, description: `使用格鬥武器攻擊時有 70% 的概率發動，\n傷害提升 ${level * 5}%`,
  })) as never,
})

const 中甲機: Mech = {
  id: 'mech_m', name: '中甲機', armorType: ArmorType.MEDIUM,
  firepower: 0, armor: 0, evasion: 0, mobility: 0, weight: 825, output: 5000,
  parts: { torso: part(300, 5000), leftArm: part(175), rightArm: part(175), legs: part(175) },
  moduleFixedIds: [],
} as unknown as Mech

/** 右臂焊死一具儲能艙 → 佔住右肩 */
const 固定武裝機: Mech = {
  ...中甲機, id: 'mech_fix', name: '固定武裝機',
  parts: {
    torso: part(300, 5000), leftArm: part(175),
    rightArm: part(175, undefined, 'Ⅱ型接口', [{ weaponId: 儲能艙.id, slot: WeaponEquipSlot.SHOULDER }]),
    legs: part(175),
  },
} as unknown as Mech

/** 輕甲：**沒有肩槽** ⇒ 摘要要出現一行「無此槽位」 */
const 輕甲機: Mech = { ...中甲機, id: 'mech_l', name: '輕甲機', armorType: ArmorType.LIGHT }

const 強襲者背包: Backpack = {
  id: 'bp_backup', name: '強襲者背包', type: BackpackType.BACKUP_EQUIPMENT, weight: 200,
} as unknown as Backpack

/** γ 一區 ＋ α 一區：α 維持預設就**不該**出現在摘要裡（B-3 的裁決） */
const 機師: Pilot = {
  id: 'p1', name: '阿中', license: MechLicense.MEDIUM, class: '突擊',
  neuralDrive: [
    { name: 'γ1', icon: '', slots: [], levels: [1, 2, 3].map((level) => ({ level, minSum: level * 4, skillName: `γ能力${level}`, effect: '' })) },
    { name: 'α', icon: '', slots: [], levels: [1, 2].map((level) => ({ level, minSum: level, skillName: `α能力${level}`, effect: '' })) },
  ],
} as unknown as Pilot

const 鎖形態機師: Pilot = { id: 'p2', name: '海莉絲', license: MechLicense.MEDIUM } as Pilot
const 虛粒子: MechForm = {
  id: 'form_虛粒子', pilotId: 鎖形態機師.id, name: '虛粒子', order: 1, description: '',
  independentLoadout: true,
  restrict: { kind: 'fixedArmament', mounts: [{ weaponId: 單手刀.id, slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }] },
} as unknown as MechForm

const WORLD = buildWorld({
  pilots: [機師, 鎖形態機師],
  mechs: [中甲機, 固定武裝機, 輕甲機],
  weapons: [雙手劍, 單手刀, 儲能艙],
  backpacks: [強襲者背包],
  forms: [虛粒子],
  modules: [猛擊裝置],
  components: [{ id: 'c_trig', name: '破防觸發' }, { id: 'c_eff', name: '增傷應用' }] as never,
})

const ctxOf = (draft: Parameters<typeof buildContext>[0], key = 'default') => buildContext(draft, key, WORLD)

/** 只給必填欄位的呼叫殼：每個測試只覆寫它關心的那幾個。 */
function summarize(
  draft: Parameters<typeof buildContext>[0],
  over: Partial<LoadoutSummaryInput> = {},
  key = 'default',
): string {
  const ctx = ctxOf(draft, key)
  return loadoutSummaryText({
    ctx,
    budget: loadoutBudget(ctx),
    ndLevels: {},
    ndAbilityMap: new Map<string, NeuralDriveAbility>(),
    generatedAt: '2026-08-30',
    ...over,
  })
}

const 基本 = { pilotId: 機師.id, mechId: 中甲機.id }

// ─── 身分與重量 ─────────────────────────────────────────────────────────────

test('未命名時把機師名升成主標，不印一行「未命名配裝」也不把機師名印兩次', () => {
  const text = summarize({ ...基本, sets: { default: { mounts: [] } } })
  assert.match(text, /^【阿中】\n中甲機 · 中甲\n/)
  assert.equal(text.includes('未命名配裝'), false)
  // 機師名只出現一次（主標那次）
  assert.equal(text.split('阿中').length - 1, 1)
})

test('有方案名時機師名降到第二行，與匯出圖同一套處置', () => {
  const text = summarize({ ...基本, sets: { default: { mounts: [] } } }, { name: '焰擊近戰特化' })
  assert.match(text, /^【焰擊近戰特化】\n阿中 · 中甲機 · 中甲\n/)
})

test('超重要印超重、不是負數的「餘」', () => {
  const text = summarize({
    ...基本,
    sets: { default: { mounts: [
      { weaponId: 雙手劍.id, bank: 'main', slot: WeaponEquipSlot.DUAL_HAND },
      { weaponId: 儲能艙.id, bank: 'main', slot: WeaponEquipSlot.SHOULDER, side: 'left' },
    ] } },
  })
  assert.match(text, /重量 [\d,]+ ／ 出力 [\d,]+・(餘|超重) /)
  assert.equal(text.includes('餘 -'), false)
})

// ─── 裝備段：六種狀態一個都不能少 ───────────────────────────────────────────

test('雙手武器兩格都印，但重量只印一次（印兩次會讓 800 被讀成 1600）', () => {
  const text = summarize({
    ...基本,
    sets: { default: { mounts: [{ weaponId: 雙手劍.id, bank: 'main', slot: WeaponEquipSlot.DUAL_HAND }] } },
  })
  assert.equal(text.split('雙手劍').length - 1, 2)
  assert.equal(text.split('重 800').length - 1, 1)
  assert.match(text, /· 左手：雙手劍（與另一手同一把，重量計一次）/)
})

test('固定武裝與「這台沒有這一排」都要講出來（唯一在說「你換不了／沒有」的訊號）', () => {
  const fixed = summarize({ pilotId: 機師.id, mechId: 固定武裝機.id, sets: { default: { mounts: [] } } })
  assert.match(fixed, /· 右肩：嵐質儲能艙（重 0｜機甲固定武裝）/)

  const light = summarize({ pilotId: 機師.id, mechId: 輕甲機.id, sets: { default: { mounts: [] } } })
  assert.match(light, /· 肩部：無此槽位 —— 肩部槽位只有中甲機甲才有/)
})

test('固定武裝的重量 0 照印數字，不印成「—」（那會被讀成沒算進總重）', () => {
  const text = summarize({ pilotId: 機師.id, mechId: 固定武裝機.id, sets: { default: { mounts: [] } } })
  assert.match(text, /嵐質儲能艙（重 0/)
})

test('形態鎖定的武裝要進清單，並標出是哪個形態鎖的', () => {
  const text = summarize(
    { pilotId: 鎖形態機師.id, mechId: 中甲機.id, sets: {} },
    {},
    'form_虛粒子',
  )
  assert.match(text, /· 左手：單手刀（重 300｜虛粒子鎖定）/)
})

test('空槽印「未裝備」而不是整格消失', () => {
  const text = summarize({ ...基本, sets: { default: { mounts: [] } } })
  assert.match(text, /· 右手：未裝備/)
  assert.match(text, /· 左手：未裝備/)
})

test('元件名跟著那一格印；雙手武器的第二格不重印一次', () => {
  const text = summarize({
    ...基本,
    sets: { default: { mounts: [{
      weaponId: 雙手劍.id, bank: 'main', slot: WeaponEquipSlot.DUAL_HAND,
      setup: { triggerComponentIds: ['c_trig'], effectComponentIds: ['c_eff'] },
    }] } },
  })
  assert.equal(text.split('元件：破防觸發・增傷應用').length - 1, 1)
})

test('背包印在背部那一列，並講出它解鎖了備用槽', () => {
  const text = summarize({ ...基本, sets: { default: { mounts: [], backpackId: 強襲者背包.id } } })
  assert.match(text, /· 背部：強襲者背包（重 200｜解鎖備用武器槽）/)
  assert.match(text, /· 備用右手：未裝備/)
  // 解鎖備用槽 ⇒ 手部「取較重者」那條規則要一起講
  assert.match(text, /手部取主手／備用較重者/)
})

// ─── 模組段 ─────────────────────────────────────────────────────────────────

test('模組印該等級的官方敘述，換行壓成一行（否則會打斷條列的階層）', () => {
  const text = summarize({ ...基本, sets: { default: { mounts: [] } }, modules: { torso: 猛擊裝置.id } })
  assert.match(text, /· 軀幹：猛擊裝置 Lv\d+ \/ 4/)
  assert.match(text, /使用格鬥武器攻擊時有 70% 的概率發動， 傷害提升/)
  assert.equal(/概率發動，\n/.test(text), false)
})

test('同族第二格只標「同族疊加」，不重印一次敘述（重印會被讀成兩份效果）', () => {
  const text = summarize({
    ...基本, sets: { default: { mounts: [] } },
    modules: { torso: 猛擊裝置.id, legs: 猛擊裝置.id },
  })
  assert.equal(text.split('概率發動').length - 1, 1)
  assert.match(text, /同族疊加，效果不重複計算/)
})

test('一顆模組都沒裝就整段不印（十字上的部位卡已經講完「未裝」）', () => {
  const text = summarize({ ...基本, sets: { default: { mounts: [] } } })
  assert.equal(text.includes('■ 模組'), false)
})

// ─── 神經驅動段 ─────────────────────────────────────────────────────────────

test('γ 恆印、維持預設的 α 不印，且一個分母都不印（23 是雙區共用預算）', () => {
  const text = summarize({ ...基本, sets: { default: { mounts: [] } } }, { ndLevels: { 'γ1': 2, 'α': 2 } })
  assert.match(text, /· γ1 Lv2（算力 8）：γ能力1、γ能力2/)
  // ⚠ 只能斷言「沒有 α 那一列」，不能斷言「整段文字不含 α」——
  //   footer 的「α／β 固定滿級」那句話本來就含 α（PLAN-052-M 起）
  assert.equal(text.split(/\r?\n/).some((l) => l.startsWith('· α')), false)
  assert.equal(text.includes('/ 23'), false)
  assert.match(text, /本摘要只列 γ 區/)
})

test('α 被玩家調離預設時要印出來（不可寫成「α／β 一律略」的靜態文案）', () => {
  const text = summarize({ ...基本, sets: { default: { mounts: [] } } }, { ndLevels: { 'γ1': 2, 'α': 1 } })
  assert.match(text, /· α Lv1（算力 1）：α能力1/)
})

// ─── 技能與備註 ─────────────────────────────────────────────────────────────

test('攜帶技能印名稱與型別，不印敘述、不印格數分母', () => {
  const skills = [
    { id: 's1', name: '高光時刻', type: '被動', description: '一段很長的官方敘述' },
    { id: 's2', name: '超距問候', type: '主動', description: '另一段' },
  ] as unknown as PilotSkillDoc[]
  const text = summarize({ ...基本, sets: { default: { mounts: [] } } }, { skills })
  assert.match(text, /· 高光時刻（被動）\n· 超距問候（主動）/)
  assert.equal(text.includes('一段很長的官方敘述'), false)
  assert.equal(text.includes('2 / 4'), false)
})

test('備註要標「由分享者填寫」，換行原樣保留（那是使用者刻意打的）', () => {
  const text = summarize({ ...基本, sets: { default: { mounts: [] } } }, { note: '第一行\n第二行' })
  assert.match(text, /■ 備註（由分享者填寫，非本站資料）\n第一行\n第二行/)
})

test('沒有備註就整段不印，不留一個空的標題', () => {
  const text = summarize({ ...基本, sets: { default: { mounts: [] } } })
  assert.equal(text.includes('■ 備註'), false)
})

// ─── 出處與格式 ─────────────────────────────────────────────────────────────

test('分享連結獨佔一行（Discord 會把黏在後面的字吃進連結）', () => {
  const url = 'https://mecharashi.wiki/simulator?b=AbC_1-2'
  const text = summarize({ ...基本, sets: { default: { mounts: [] } } }, { shareUrl: url })
  assert.ok(text.split('\n').includes(url))
})

test('多形態時要講出「連結帶的是整份」——收到文字的人手上只有這段文字', () => {
  const text = summarize({ ...基本, sets: { default: { mounts: [] } } }, {
    shareUrl: 'https://example.test/x', setCount: 3,
  })
  assert.match(text, /分享連結（含 3 個形態分頁）/)
})

test('編不出碼時整段連結不印，不留一個打不開的佔位字串', () => {
  const text = summarize({ ...基本, sets: { default: { mounts: [] } } })
  assert.equal(text.includes('分享連結'), false)
})

test('一個 markdown 記號都不能有（同一段文字會被貼進三種渲染器）', () => {
  const text = summarize({
    ...基本,
    sets: { default: { mounts: [{ weaponId: 雙手劍.id, bank: 'main', slot: WeaponEquipSlot.DUAL_HAND }] } },
    modules: { torso: 猛擊裝置.id },
  }, { name: '焰擊', note: '照這樣配', shareUrl: 'https://example.test/x' })
  // ⚠ 連結那一行豁免：base64url 本來就含 `_`，而網址被自動連結、不套 markdown
  for (const line of text.split('\n')) {
    if (line.startsWith('http')) continue
    assert.equal(/[*_#>`]/.test(line), false, `不該出現 markdown 記號：${line}`)
  }
})

test('取不到遊戲版本時該欄整個不印，不猜一個版本號', () => {
  const text = summarize({ ...基本, sets: { default: { mounts: [] } } })
  assert.match(text, /配裝模擬器 · 2026-08-30$/)
  assert.equal(text.includes('遊戲版本'), false)
})
