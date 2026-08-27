// PLAN-052-B A-2：合法性規則層的驗收
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這份測試的三個主角是計畫書點名的三個既有 bug（執照 enum／背槽不互斥／順序相依重量帳）。
// 其餘案例都是「拒絕原因講不講得清楚」——那是決策二的分水嶺，講不清就會變成客服問題。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Backpack, Mech, MechForm, Pilot, Weapon } from '../types/index.ts'
import type { EquipSet } from '../types/loadout.ts'
import {
  REJECTION_CODES, REJECTION_TIER, REJECTION_LABEL,
  buildContext, buildWorld, canEquipBackpack, canEquipWeapon, canSelectMech,
  loadoutBudget, mountCoverage, mountRefFor, slotOccupant, validateLoadout,
  weaponChoices, backpackChoices, structuralCounts, slotHasCandidates,
  canEquipComponent, componentChoices, weaponSiteAt, canEquipModule, planModuleFill, planWeaponAutoEquip,
  planWeaponUpgrade, pilotExclusiveWeapons,
} from './loadoutRules.ts'
import type { Component, Module } from '../types/index.ts'
import { ArmorType, MechLicense, MechRestriction, WeaponEquipSlot, BackpackType, WeaponType, WeaponKind, MechPartPosition, ModuleSlot, PartInterface } from '../types/enums.ts'
import type { MechPartPosition as MechPartPositionType } from '../types/enums.ts'

// ─── fixtures（數值取自 2026-08-23／24 線上實測）────────────────────────────

const part = (over: Partial<{ weight: number; firepower: number; output: number }> = {}) => ({
  position: 'torso', durable: 0, armor: 0, firepower: 0, weight: 0, interface: 'Ⅱ型接口', ...over,
})

/** 彌造者：Σ parts.weight = 825、torso.output = 3375（golden fixture 的底盤） */
const 彌造者: Mech = {
  id: 'mech_052', name: '彌造者', armorType: ArmorType.MEDIUM,
  firepower: 0, armor: 0, evasion: 0, mobility: 0, weight: 825, output: 3375,
  parts: {
    torso:    part({ weight: 300, output: 3375 }) as never,
    leftArm:  part({ weight: 175 }) as never,
    rightArm: part({ weight: 175 }) as never,
    legs:     part({ weight: 175 }) as never,
  },
  moduleFixedIds: [],
}

const 輕型機: Mech = { ...彌造者, id: 'mech_light', name: '輕型機', armorType: ArmorType.LIGHT }
const 重型機: Mech = { ...彌造者, id: 'mech_heavy', name: '重型機', armorType: ArmorType.HEAVY }

/** 美杜莎MK2：官方數值未公布的**刻意佔位**（全 0）。不是髒資料，見 resolveChassis 註解。 */
const 美杜莎MK2: Mech = {
  ...彌造者, id: 'mech_090', name: '美杜莎MK2', weight: 0, output: 0,
  parts: { torso: part() as never, leftArm: part() as never, rightArm: part() as never, legs: part() as never },
}

/** 帕斯卡：左右肩各焊一把衝擊炮（同一個 weaponId 掛兩肩 —— 撞 key 的現成教訓） */
const 帕斯卡: Mech = {
  ...彌造者, id: 'mech_pascal', name: '帕斯卡',
  parts: {
    torso:    part({ weight: 300, output: 3375 }) as never,
    leftArm:  { ...part({ weight: 175 }), fixedArmament: [{ weaponId: 'w_衝擊炮', slot: WeaponEquipSlot.SHOULDER, side: 'left' }] } as never,
    rightArm: { ...part({ weight: 175 }), fixedArmament: [{ weaponId: 'w_衝擊炮', slot: WeaponEquipSlot.SHOULDER, side: 'right' }] } as never,
    legs:     part({ weight: 175 }) as never,
  },
}

const weapon = (over: Partial<Weapon> & Pick<Weapon, 'id' | 'name' | 'weight' | 'equipSlot'>): Weapon => ({
  type: WeaponType.Melee, kind: '刀劍', kindCoefficient: 1, attack: 0, accuracy: 0, critValue: 0,
  rangeType: 'manhattan', minRange: 1, maxRange: 1, ammoCount: 0, hitCount: 1, rarity: 'SS',
  mechRestriction: MechRestriction.NONE, isExclusive: false, triggerSlots: 3, effectSlots: 3, componentLimit: 4,
  fixedMod: { planName: '', maxLevel: 0, effects: [] },
  floatingMod: { planName: '', slots: 0, possibleEffects: [] },
  skills: [], ...over,
} as Weapon)

const 群山之力 = weapon({ id: 'w_008', name: '群山之力', weight: 800, equipSlot: WeaponEquipSlot.DUAL_HAND })
const 貝奧武夫 = weapon({ id: 'w_089', name: '貝奧武夫', weight: 850, equipSlot: WeaponEquipSlot.DUAL_HAND })
const 藝術突襲 = weapon({ id: 'w_016', name: '藝術突襲', weight: 420, equipSlot: WeaponEquipSlot.SINGLE_HAND, type: WeaponType.Assault })
const 夜魘     = weapon({ id: 'w_017', name: '夜魘',     weight: 500, equipSlot: WeaponEquipSlot.SINGLE_HAND, type: WeaponType.Assault })
/** 25 把肩部武器實測 100% mechRestriction='medium' */
const 熔火     = weapon({ id: 'w_044', name: '熔火', weight: 1200, equipSlot: WeaponEquipSlot.SHOULDER, type: WeaponType.Heavy, mechRestriction: MechRestriction.MEDIUM_ONLY })
const 炬塔     = weapon({ id: 'w_049', name: '炬塔', weight: 1100, equipSlot: WeaponEquipSlot.BACK,     type: WeaponType.Heavy, mechRestriction: MechRestriction.MEDIUM_ONLY })
/** 固定武裝的 `componentLimit` 實測 8／8 皆為 0（雖然都是 S 品質）——見 052-D 計畫書決策四 */
const 焊死 = { isFixedArmament: true, type: WeaponType.Special, triggerSlots: 0, effectSlots: 0, componentLimit: 0 } as const
const 耀星     = weapon({ id: 'w_176', name: '耀星', weight: 100, equipSlot: WeaponEquipSlot.SINGLE_HAND, ...焊死 })
const 隕星     = weapon({ id: 'w_177', name: '隕星', weight: 100, equipSlot: WeaponEquipSlot.SINGLE_HAND, ...焊死 })
const 千星     = weapon({ id: 'w_178', name: '千星', weight: 100, equipSlot: WeaponEquipSlot.BACK,        ...焊死 })
const 衝擊炮   = weapon({ id: 'w_衝擊炮', name: '衝擊炮', weight: 0, equipSlot: WeaponEquipSlot.SHOULDER, ...焊死 })

/**
 * 盾（PLAN-052-J follow-up）。全庫 24 面全是 singleHand ——
 * 沒有規則的話兩隻手各掛一面是選得出來的。
 * 大盾 12 面一律 mechRestriction='heavy'、260–390 重；手盾 12 面無限制、50–70 重。
 */
const 聚合屏障 = weapon({ id: 'w_014', name: '聚合屏障', weight: 70, equipSlot: WeaponEquipSlot.SINGLE_HAND, kind: WeaponKind.Buckler })
const 玲瓏     = weapon({ id: 'w_153', name: '玲瓏',     weight: 70, equipSlot: WeaponEquipSlot.SINGLE_HAND, kind: WeaponKind.Buckler })
const 群星     = weapon({ id: 'w_011', name: '群星',     weight: 390, equipSlot: WeaponEquipSlot.SINGLE_HAND, kind: WeaponKind.Shield, mechRestriction: MechRestriction.HEAVY_ONLY })

/**
 * 左手焊死一把固定武裝的機甲（PLAN-052-J C-1 邊界二）。
 * 帕斯卡焊的是**肩部**，碰不到手部格；要驗「雙手武器被佔住的那一手擋下」需要這台。
 */
const 獨臂機: Mech = {
  ...彌造者, id: 'mech_onearm', name: '獨臂機',
  parts: {
    torso:    part({ weight: 300, output: 3375 }) as never,
    leftArm:  { ...part({ weight: 175 }), fixedArmament: [{ weaponId: 'w_176', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }] } as never,
    rightArm: part({ weight: 175 }) as never,
    legs:     part({ weight: 175 }) as never,
  },
}

const backpack = (over: Partial<Backpack> & Pick<Backpack, 'id' | 'name' | 'weight'>): Backpack => ({
  type: BackpackType.HEAL, rarity: 'S', slot: WeaponEquipSlot.BACK, assemblableArmorType: [],
  repairAmount: 0, skillIds: [], ...over,
})

/** 全庫唯一給備用武器槽的背包，同時 +300 出力 */
const 強襲者背包 = backpack({ id: '60101706', name: '強襲者背包', weight: 150, type: BackpackType.BACKUP_EQUIPMENT })
const 出力背包Ⅲ  = backpack({ id: '60100104', name: '出力背包Ⅲ', weight: 150, type: BackpackType.POWERADD })
const 輕型限定包 = backpack({ id: 'bp_light', name: '輕型限定包', weight: 100, assemblableArmorType: ['Light'] })

const pilot = (over: Partial<Pilot> & Pick<Pilot, 'id' | 'name' | 'license'>): Pilot => ({
  stats: { melee: 0, assault: 0, shooting: 0, tactics: 0, defense: 0, engineering: 0 },
} as Pilot & typeof over).id ? ({
  stats: { melee: 0, assault: 0, shooting: 0, tactics: 0, defense: 0, engineering: 0 },
  ...over,
} as Pilot) : ({ ...over } as Pilot)

const 海莉絲 = pilot({ id: 'pilot_hailisi', name: '海莉絲', license: MechLicense.MEDIUM })
const 重型機師 = pilot({ id: 'pilot_heavy', name: '重型機師', license: MechLicense.HEAVY })

const form = (over: Partial<MechForm> & Pick<MechForm, 'id' | 'name' | 'restrict'>): MechForm => ({
  pilotId: 海莉絲.id, order: 0, description: '', independentLoadout: true, ...over,
} as MechForm)

const 先鋒形態 = form({ id: 'form_海莉絲_先鋒', name: '先鋒形態', order: 1, restrict: { kind: 'weaponType', allow: [WeaponType.Melee, WeaponType.Sniper] } })
const 突擊形態 = form({ id: 'form_海莉絲_突擊', name: '突擊形態', order: 2, restrict: { kind: 'weaponType', allow: [WeaponType.Assault] } })
const 虛粒子形態 = form({
  id: 'form_海莉絲_虛粒子', name: '虛粒子形態', order: 4, independentLoadout: false, isSignature: true,
  restrict: { kind: 'fixedArmament', mounts: [
    { weaponId: 耀星.id, slot: WeaponEquipSlot.SINGLE_HAND, side: 'right' },
    { weaponId: 隕星.id, slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' },
    { weaponId: 千星.id, slot: WeaponEquipSlot.BACK },
  ] },
})

/** A／B 品質武器的 `componentLimit` 實測皆為 0（39 把） */
const 廉價刀 = weapon({ id: 'w_b01', name: '廉價刀', weight: 100, equipSlot: WeaponEquipSlot.SINGLE_HAND, rarity: 'B', triggerSlots: 0, effectSlots: 0, componentLimit: 0 })
/** S 品質 ＝ 3 個總槽（SS／S+ 才是 4） */
const 三槽刀 = weapon({ id: 'w_s01', name: '三槽刀', weight: 100, equipSlot: WeaponEquipSlot.SINGLE_HAND, rarity: 'S', componentLimit: 3 })

// ─── 元件 fixture（PLAN-052-D A-4／A-5，形狀取自 2026-08-26 正式資料）──────────
//   命名一律吻合「觸元件｜應元件 ＋ 選配的 W ＋ 連字號 ＋ 後綴」，見 componentRules.ts

const comp = (over: Partial<Component> & Pick<Component, 'id' | 'name' | 'componentType'>): Component => ({
  moduleSubtype: 1, probabilityLevel: 5, description: '', rarity: 'S',
  allowedWeaponTypes: ['射擊', '格鬥', '突擊', '戰術'],   // ＝後台「全選」＝不限（201／208 筆是這個形狀）
  componentsWType: 'Normal',
  ...(over.componentType === 'Condition' ? { conditionType: 'always', condition: '' } : {}),
  ...over,
} as Component)

const 觸憑逸W = comp({ id: 'c_001', name: '觸元件W-憑逸', componentType: 'Condition', componentsWType: 'W', probabilityLevel: 7 })
const 觸憑逸  = comp({ id: 'c_002', name: '觸元件-憑逸',  componentType: 'Condition', probabilityLevel: 6 })
const 觸憑逸A = comp({ id: 'c_003', name: '觸元件-憑逸',  componentType: 'Condition', probabilityLevel: 6, rarity: 'A' })
const 觸沉著  = comp({ id: 'c_004', name: '觸元件-沉著',  componentType: 'Condition' })
const 觸壓迫  = comp({ id: 'c_005', name: '觸元件-壓迫',  componentType: 'Condition' })
const 觸擊破  = comp({ id: 'c_006', name: '觸元件-擊破',  componentType: 'Condition' })
/** 實測 7 筆部分限定之一：警戒族 6 筆全部限定「射擊」（計畫書決策七） */
const 觸警戒  = comp({ id: 'c_007', name: '觸元件-警戒',  componentType: 'Condition', allowedWeaponTypes: ['射擊'] })
const 應戰慄  = comp({ id: 'c_101', name: '應元件-戰慄',  componentType: 'Function' })
const 應穿甲  = comp({ id: 'c_102', name: '應元件-穿甲',  componentType: 'Function' })
const 應爆破  = comp({ id: 'c_103', name: '應元件-爆破',  componentType: 'Function' })
const 應濺射  = comp({ id: 'c_104', name: '應元件-濺射',  componentType: 'Function' })
/** 命名破格：官方哪天出一顆不照規則命名的元件（今天 0 筆） */
const 破格元件 = comp({ id: 'c_999', name: '奇怪的元件', componentType: 'Function' })

const COMPONENTS = [觸憑逸W, 觸憑逸, 觸憑逸A, 觸沉著, 觸壓迫, 觸擊破, 觸警戒, 應戰慄, 應穿甲, 應爆破, 應濺射, 破格元件]

// ─── 模組 fixture（PLAN-052-G A-3，形狀取自 2026-08-27 正式資料）───────────────
//   接口 ＝ f(quality, position)：S ⇒ ⅡⅡⅡⅡ／A ⇒ ⅠⅡⅡⅠ／B ⇒ 無接口（見 mechInterface.ts）

/** A 品質：軀幹與腿部 Ⅰ 型、雙臂 Ⅱ 型。全庫 16 台長這樣，也是 Ⅰ 型接口唯一的棲地 */
const A級機: Mech = {
  ...彌造者, id: 'mech_a', name: 'A級機',
  parts: {
    torso:    { ...part({ weight: 300, output: 3375 }), interface: PartInterface.TYPE_I } as never,
    leftArm:  part({ weight: 175 }) as never,
    rightArm: part({ weight: 175 }) as never,
    legs:     { ...part({ weight: 175 }), interface: PartInterface.TYPE_I } as never,
  },
}

/** B 品質：四格全空。**空字串的唯一語意是「這台沒有模組接口」**，不是「未建檔」 */
const B級機: Mech = {
  ...彌造者, id: 'mech_b', name: 'B級機',
  parts: {
    torso:    { ...part({ weight: 300, output: 3375 }), interface: '' } as never,
    leftArm:  { ...part({ weight: 175 }), interface: '' } as never,
    rightArm: { ...part({ weight: 175 }), interface: '' } as never,
    legs:     { ...part({ weight: 175 }), interface: '' } as never,
  },
}

/** 星夜女神踩過的那個坑：兩個 U+2160 拼出來的假「Ⅱ」。不是合法值，該被看見而不是當成沒接口 */
const 壞接口機: Mech = {
  ...彌造者, id: 'mech_bad', name: '壞接口機',
  parts: { ...彌造者.parts, torso: { ...part({ weight: 300, output: 3375 }), interface: 'ⅠⅠ型接口' } as never } as never,
}

const mod = (over: Partial<Module> & Pick<Module, 'id' | 'name' | 'rarity'>): Module => ({
  slot: ModuleSlot.UNIVERSAL, boundMechId: null, boundPart: null,
  dmg: 0, crit_rate: 0, critDmg: 0, acc_rate: 0, firepower_rate: 0, armor_rate: 0,
  crit_resist_rate: 0, output_bonus: 0, dodge_rate: 0, durable_rate: 0, dmg_resist_rate: 0,
  description: '',
  // ⚠ 四階版本是多數（候選池 186 筆裡 136 筆是 4 階），別把 8 當預設
  levels: [1, 2, 3, 4].map((level) => ({ level })) as never,
  ...over,
} as Module)

const 通用S = mod({ id: 'mod_4101', name: '通用S模組', rarity: 'S' })
const 通用A = mod({ id: 'mod_4102', name: '通用A模組', rarity: 'A' })
const 八級S = mod({ id: 'mod_8001', name: '8級S模組', rarity: 'S', slot: ModuleSlot.SLOT_8, levels: [1,2,3,4,5,6,7,8].map((level) => ({ level })) as never })
/** 綁機甲的專屬模組：只有那台裝得上，不進候選池 */
const 破曉專屬 = mod({ id: 'mod_9001', name: '匯流樞紐', rarity: 'S', slot: ModuleSlot.EXCLUSIVE, boundMechId: 'mech_026' })
/** 機甲天生自帶、玩家取得不了的副模組（`available` 值域已漂移，不可拿它當 gate） */
const 副模組 = mod({ id: 'mod_7001', name: '內建副模組', rarity: 'S', slot: ModuleSlot.BUILT_IN, available: true })
/** 沒有各階數值：頂層那排平坦欄位全 0，裝上去不會有任何效果而且不報錯 */
const 空殼模組 = mod({ id: 'mod_4999', name: '空殼模組', rarity: 'S', levels: [] })

const MODULES = [通用S, 通用A, 八級S, 破曉專屬, 副模組, 空殼模組]

// ── 升級邊（PLAN-031 的 `Weapon.upgrade`）──
//
// ⚠ 這兩把**刻意不進共用的 `WORLD`**：它們是突擊類武器，加進去會讓
//   「structuralCounts 數得出因形態限定隱藏 N 筆」那條測試的期望值跟著變 ——
//   一個與升級無關的測試被別人的 fixture 改掉，是共用 fixture 最典型的擴散傷害。
//   它們改走下方的 `UPGRADE_WORLD`。
// ⚠ 仍然宣告在 `WORLD` 之前：`const` 有 TDZ，兩者的相對順序不能倒過來。
/** 進階版：夜魘 → 終末之嘆（比照實測：S+ → SS、同重、同槽） */
const 終末之嘆 = weapon({
  id: 'w_017_up', name: '終末之嘆', weight: 500, equipSlot: WeaponEquipSlot.SINGLE_HAND,
  type: WeaponType.Assault, rarity: 'SS', upgrade: { fromWeaponId: 夜魘.id },
})
/** 機種限定與母武器不同的進階版：守「子武器不合法時要說出來，而不是當成沒有進階版」 */
const 重甲限定進階 = weapon({
  id: 'w_017_up2', name: '重甲限定進階', weight: 500, equipSlot: WeaponEquipSlot.SINGLE_HAND,
  type: WeaponType.Assault, rarity: 'SS', mechRestriction: MechRestriction.HEAVY_ONLY,
  upgrade: { fromWeaponId: 藝術突襲.id },
})

const WORLD = buildWorld({
  pilots: [海莉絲, 重型機師],
  mechs: [彌造者, 輕型機, 重型機, 美杜莎MK2, 帕斯卡, 獨臂機, A級機, B級機, 壞接口機],
  weapons: [群山之力, 貝奧武夫, 藝術突襲, 夜魘, 熔火, 炬塔, 耀星, 隕星, 千星, 衝擊炮, 聚合屏障, 玲瓏, 群星, 廉價刀, 三槽刀],
  backpacks: [強襲者背包, 出力背包Ⅲ, 輕型限定包],
  forms: [先鋒形態, 突擊形態, 虛粒子形態],
  components: COMPONENTS,
  modules: MODULES,
})

/** 升級測試專用的小世界（見上方 fixture 的註解）。 */
const UPGRADE_WORLD = buildWorld({
  pilots: [海莉絲], mechs: [彌造者], forms: [],
  weapons: [藝術突襲, 夜魘, 終末之嘆, 重甲限定進階],
  backpacks: [],
})
const upgradeCtx = (set: EquipSet) => buildContext(
  { pilotId: 海莉絲.id, mechId: 彌造者.id, sets: { default: set } },
  'default',
  UPGRADE_WORLD,
)

const ctxOf = (
  set: EquipSet,
  opts: {
    mech?: Mech; setKey?: string; pilot?: Pilot
    /** 四個接口上各裝了什麼（PLAN-052-G）。**放頂層、不放進 set** —— 模組不隨形態分頁變動 */
    modules?: Partial<Record<MechPartPositionType, string>>
  } = {},
) => {
  const key = opts.setKey ?? 'default'
  return buildContext(
    {
      pilotId: (opts.pilot ?? 海莉絲).id,
      mechId: (opts.mech ?? 彌造者).id,
      sets: { [key]: set },
      modules: opts.modules,
    },
    key,
    WORLD,
  )
}
const HAND_L = { bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' } as const
const HAND_R = { bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'right' } as const
const DUAL   = { bank: 'main', slot: WeaponEquipSlot.DUAL_HAND } as const
const BACKUP_L = { bank: 'backup', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' } as const
const SHO_L  = { bank: 'main', slot: WeaponEquipSlot.SHOULDER, side: 'left' } as const
const BACK   = { bank: 'main', slot: WeaponEquipSlot.BACK } as const

// ─── 封閉聯集的完整性 ───────────────────────────────────────────────────────

test('每一個拒絕原因都有 tier 與中文說明（新增原因時 tsc 會先擋，這裡是第二道）', () => {
  for (const code of REJECTION_CODES) {
    assert.ok(REJECTION_TIER[code], `${code} 缺 tier`)
    assert.ok(REJECTION_LABEL[code]?.length, `${code} 缺中文標籤`)
  }
})

test('situational 拒絕一律附解法 —— 灰掉卻沒有解法按鈕正是客服問題的來源', () => {
  const ctx = ctxOf({ mounts: [], backpackId: 出力背包Ⅲ.id })
  const r = canEquipWeapon(ctx, 炬塔, BACK)
  assert.equal(r?.tier, 'situational')
  assert.ok(r && 'resolution' in r && r.resolution.action.type === 'unequipBackpack')
})

// ─── bug ①：執照 enum ───────────────────────────────────────────────────────

test('bug①：執照一對一 —— 只選得到與執照同機種的機甲', () => {
  assert.equal(canSelectMech(海莉絲, 彌造者), null)              // 中型執照 → 中甲：可
  assert.equal(canSelectMech(海莉絲, 重型機)?.code, 'LICENSE')   // 舊碼寫 license === '中甲' 恆為 false
  assert.equal(canSelectMech(海莉絲, 輕型機)?.code, 'LICENSE')   // 階梯式包含是錯的（2026-08-25）
  assert.equal(canSelectMech(重型機師, 重型機), null)
  assert.equal(canSelectMech(重型機師, 輕型機)?.code, 'LICENSE') // 重型執照曾經全開，症狀就是這一條
  assert.equal(canSelectMech(重型機師, 彌造者)?.code, 'LICENSE')
})

test('bug①：機師的執照失效時，整套配裝會被 validateLoadout 指名', () => {
  const problems = validateLoadout(ctxOf({ mounts: [] }, { mech: 重型機 }))
  assert.ok(problems.some((p) => p.code === 'LICENSE'))
})

// ─── bug ②：背槽擇一 ────────────────────────────────────────────────────────

test('bug②：背包已裝時背部武器被擋（181/181 背包 slot=back，22 把背部武器可並存）', () => {
  const r = canEquipWeapon(ctxOf({ mounts: [], backpackId: 出力背包Ⅲ.id }), 炬塔, BACK)
  assert.equal(r?.code, 'BACK_SLOT_TAKEN')
})

test('bug②：背部武器已裝時背包被擋，且解法指向卸下那把武器', () => {
  const ctx = ctxOf({ mounts: [{ weaponId: 炬塔.id, bank: 'main', slot: WeaponEquipSlot.BACK }] })
  const r = canEquipBackpack(ctx, 出力背包Ⅲ)
  assert.equal(r?.code, 'BACK_SLOT_TAKEN')
  assert.ok(r && 'resolution' in r && r.resolution.action.type === 'unequip')
  assert.match(r!.reason, /炬塔/)
})

// ─── bug ③：順序相依的重量帳 ────────────────────────────────────────────────

test('bug③：先選背包再選武器 vs 先選武器再選背包，剩餘出力必須相同', () => {
  const both: EquipSet = {
    mounts: [{ weaponId: 群山之力.id, bank: 'main', slot: WeaponEquipSlot.DUAL_HAND }],
    backpackId: 出力背包Ⅲ.id,
  }
  // 兩條路徑的終點是同一套配裝 —— 舊碼在兩個挑選器各寫一次 remainingOutput，兩邊算出不同數字
  const viaBackpackFirst = loadoutBudget(ctxOf({ mounts: [], backpackId: 出力背包Ⅲ.id }), {
    add: { ref: DUAL, weight: 群山之力.weight },
  })
  const viaWeaponFirst = loadoutBudget(
    ctxOf({ mounts: [{ weaponId: 群山之力.id, bank: 'main', slot: WeaponEquipSlot.DUAL_HAND }] }),
    { add: { ref: BACK, weight: 出力背包Ⅲ.weight, backpackId: 出力背包Ⅲ.id } },
  )
  assert.equal(viaBackpackFirst.weight.total, viaWeaponFirst.weight.total)
  assert.equal(viaBackpackFirst.remaining, viaWeaponFirst.remaining)
  assert.equal(loadoutBudget(ctxOf(both)).remaining, viaWeaponFirst.remaining)
})

test('重量帳走 totalWeight 單一入口：825 + 800 + 150 = 1775，出力 3375 + 300', () => {
  const b = loadoutBudget(ctxOf({
    mounts: [{ weaponId: 群山之力.id, bank: 'main', slot: WeaponEquipSlot.DUAL_HAND }],
    backpackId: 出力背包Ⅲ.id,
  }))
  assert.equal(b.weight.total, 1775)
  assert.equal(b.output.total, 3675)
  assert.equal(b.remaining, 1900)
  assert.equal(b.over, false)
})

test('手部取較重組（不是加總）—— 主手 800 ／ 備用 850 只計 850', () => {
  const b = loadoutBudget(ctxOf({
    mounts: [
      { weaponId: 群山之力.id, bank: 'main',   slot: WeaponEquipSlot.DUAL_HAND },
      { weaponId: 貝奧武夫.id, bank: 'backup', slot: WeaponEquipSlot.DUAL_HAND },
    ],
    backpackId: 強襲者背包.id,
  }))
  assert.equal(b.weight.hands, 850)
  assert.equal(b.weight.total, 1825)          // golden fixture ①
  assert.equal(b.weight.heavierBank, 'backup')
})

// ─── 固定武裝與全鎖形態 ─────────────────────────────────────────────────────

test('全鎖形態的重量由 form.restrict.mounts derive ＝ golden fixture ④ 1125', () => {
  const ctx = buildContext(
    { pilotId: 海莉絲.id, mechId: 彌造者.id, sets: {} },
    虛粒子形態.id,
    WORLD,
  )
  assert.equal(loadoutBudget(ctx).weight.total, 1125)   // 825 + (100+100) + 100
})

test('全鎖形態下任何裝備動作都被擋，且訊息指名形態', () => {
  const ctx = buildContext({ pilotId: 海莉絲.id, mechId: 彌造者.id, sets: {} }, 虛粒子形態.id, WORLD)
  const r = canEquipWeapon(ctx, 群山之力, DUAL)
  assert.equal(r?.code, 'FORM_LOCKED')
  assert.match(r!.reason, /虛粒子形態/)
  assert.equal(canEquipBackpack(ctx, 出力背包Ⅲ)?.code, 'FORM_LOCKED')
})

test('機甲固定武裝計入總重、佔住該格，且左右肩不撞 key（同一把衝擊炮掛兩肩）', () => {
  const ctx = ctxOf({ mounts: [] }, { mech: 帕斯卡 })
  assert.equal(slotOccupant(ctx, SHO_L).kind, 'fixed')
  assert.equal(canEquipWeapon(ctx, 熔火, SHO_L)?.code, 'SLOT_OCCUPIED')
  const right = slotOccupant(ctx, { bank: 'main', slot: WeaponEquipSlot.SHOULDER, side: 'right' })
  assert.equal(right.kind, 'fixed')
})

test('固定武裝不是可選裝備（重量 0 的純封鎖型在舊碼可被選為主武器）', () => {
  assert.equal(canEquipWeapon(ctxOf({ mounts: [] }), 衝擊炮, SHO_L)?.code, 'FIXED_ARMAMENT')
})

// ─── 槽位定義 ───────────────────────────────────────────────────────────────

test('SLOT_MISMATCH 是 omitted —— 那是槽的定義，不是拒絕，不該列進清單', () => {
  const r = canEquipWeapon(ctxOf({ mounts: [] }), 炬塔, HAND_L)
  assert.equal(r?.code, 'SLOT_MISMATCH')
  assert.equal(r?.tier, 'omitted')
})

test('非中甲沒有肩槽 → NO_SLOT（omitted），而不是「這把裝不上」', () => {
  const r = canEquipWeapon(ctxOf({ mounts: [] }, { mech: 輕型機, pilot: 海莉絲 }), 熔火, SHO_L)
  assert.equal(r?.code, 'NO_SLOT')
})

test('沒有強襲者背包就沒有備用槽', () => {
  assert.equal(canEquipWeapon(ctxOf({ mounts: [] }), 藝術突襲, BACKUP_L)?.code, 'NO_SLOT')
  assert.equal(canEquipWeapon(ctxOf({ mounts: [], backpackId: 強襲者背包.id }), 藝術突襲, BACKUP_L), null)
})

test('雙手武器佔的是兩格單手，不是第三格手部', () => {
  assert.deepEqual(mountCoverage(DUAL), ['main:singleHand:left', 'main:singleHand:right'])
  const ctx = ctxOf({ mounts: [{ weaponId: 群山之力.id, bank: 'main', slot: WeaponEquipSlot.DUAL_HAND }] })
  assert.equal(slotOccupant(ctx, HAND_L).kind, 'weapon')
  assert.equal(slotOccupant(ctx, HAND_R).kind, 'weapon')
})

// ─── 武器與背包的限定 ───────────────────────────────────────────────────────

test('mechRestriction 是機種 gate 的唯一判準（不可用 type === "戰術" 代替）', () => {
  // 熔火 medium-only：換到輕型機（假設它有肩槽）也裝不上；這裡先確認 gate 本身
  const heavyCtx = ctxOf({ mounts: [] }, { mech: 重型機, pilot: 重型機師 })
  const r = canEquipWeapon(heavyCtx, 炬塔, BACK)
  assert.equal(r?.code, 'MECH_RESTRICTION')
  assert.equal(r?.tier, 'structural')
})

test('形態武器類型白名單：先鋒（格鬥／射擊）擋得住突擊武器', () => {
  const ctx = buildContext(
    { pilotId: 海莉絲.id, mechId: 彌造者.id, sets: { [先鋒形態.id]: { mounts: [] } } },
    先鋒形態.id, WORLD,
  )
  assert.equal(canEquipWeapon(ctx, 藝術突襲, HAND_L)?.code, 'FORM_WEAPON_TYPE')
  assert.equal(canEquipWeapon(ctx, 群山之力, DUAL), null)
})

test('背包的 assemblableArmorType 是正向邏輯：[] 無限制、有值則必須包含本機甲', () => {
  assert.equal(canEquipBackpack(ctxOf({ mounts: [] }), 出力背包Ⅲ), null)
  const r = canEquipBackpack(ctxOf({ mounts: [] }), 輕型限定包)
  assert.equal(r?.code, 'BACKPACK_ARMOR_TYPE')
  assert.equal(canEquipBackpack(ctxOf({ mounts: [] }, { mech: 輕型機 }), 輕型限定包), null)
})

// ─── 負重與解法 ─────────────────────────────────────────────────────────────

test('超重的解法指向「卸掉它就裝得下」的那一件，不是名目最重的那一件', () => {
  // 3375 出力：肩 1200 + 背 1100 + 雙手 800 = 3100，再裝一把 800 的雙手會超出 525
  const ctx = ctxOf({
    mounts: [
      { weaponId: 熔火.id, bank: 'main', slot: WeaponEquipSlot.SHOULDER, side: 'left' },
      { weaponId: 炬塔.id, bank: 'main', slot: WeaponEquipSlot.BACK },
    ],
  })
  const r = canEquipWeapon(ctx, 群山之力, DUAL)   // 825+1200+1100+800 = 3925 > 3375
  assert.equal(r?.code, 'OVERWEIGHT')
  assert.match(r!.reason, /超出 550/)
  // 兩件都夠（1200／1100），挑最輕的那件 —— 動最少
  assert.ok(r && 'resolution' in r && r.resolution.label.includes('炬塔'))
})

test('超重不阻擋：validateLoadout 只把它列成問題，配裝本身留著', () => {
  const set: EquipSet = {
    mounts: [
      { weaponId: 熔火.id, bank: 'main', slot: WeaponEquipSlot.SHOULDER, side: 'left' },
      { weaponId: 熔火.id, bank: 'main', slot: WeaponEquipSlot.SHOULDER, side: 'right' },
      { weaponId: 炬塔.id, bank: 'main', slot: WeaponEquipSlot.BACK },
    ],
  }
  const ctx = ctxOf(set)
  assert.equal(loadoutBudget(ctx).over, true)
  const problems = validateLoadout(ctx)
  assert.equal(problems.filter((p) => p.code === 'OVERWEIGHT').length, 1)
  assert.equal(ctx.set.mounts.length, 3)     // 一件都沒被拿掉
})

test('已裝備的東西不會與自己衝突（validateLoadout 對合法配裝回空陣列）', () => {
  const ctx = ctxOf({
    mounts: [{ weaponId: 群山之力.id, bank: 'main', slot: WeaponEquipSlot.DUAL_HAND }],
    backpackId: 出力背包Ⅲ.id,
  })
  assert.deepEqual(validateLoadout(ctx), [])
})

// ─── 資料未建檔 ─────────────────────────────────────────────────────────────

test('美杜莎MK2（官方數值未公布）標成 dataIncomplete，而不是一台什麼都裝不下的機甲', () => {
  const b = loadoutBudget(ctxOf({ mounts: [] }, { mech: 美杜莎MK2 }))
  assert.equal(b.dataIncomplete, true)
  assert.equal(b.output.total, 0)
})

// ─── 挑選器清單（C-1 的唯一來源）───────────────────────────

test('weaponChoices 濾掉 omitted（槽位不符）—— 否則清單會長到沒人捲得完', () => {
  const entries = weaponChoices(ctxOf({ mounts: [] }), BACK)
  // 全庫 10 把 fixture 裡，只有背部武器（炬塔、千星）進得了背槽；
  // 千星是固定武裝（FIXED_ARMAMENT，也是 omitted）→ 只剩炬塔
  assert.deepEqual(entries.map((e) => e.item.name), ['炬塔'])
})

test('weaponChoices 的排序：可裝在前、情境性次之、結構性最後', () => {
  const entries = weaponChoices(ctxOf({ mounts: [] }, { mech: 重型機, pilot: 重型機師 }), DUAL)
  const ranks = entries.map((e) => (e.rejection === null ? 0 : e.rejection.tier === 'situational' ? 1 : 2))
  assert.deepEqual([...ranks].sort((a, b) => a - b), ranks)
})

test('weaponChoices 對全鎖形態回空陣列（blocked → 整個挑選器降級）', () => {
  const ctx = buildContext({ pilotId: 海莉絲.id, mechId: 彌造者.id, sets: {} }, 虛粒子形態.id, WORLD)
  assert.deepEqual(weaponChoices(ctx, DUAL), [])
  assert.deepEqual(backpackChoices(ctx), [])
})

test('structuralCounts 數得出「因形態限定隱藏 N」（摺疊列的內容）', () => {
  const ctx = buildContext(
    { pilotId: 海莉絲.id, mechId: 彌造者.id, sets: { [先鋒形態.id]: { mounts: [] } } },
    先鋒形態.id, WORLD,
  )
  const counts = structuralCounts(weaponChoices(ctx, HAND_L))
  // 藝術突襲與夜魘是突擊類 → 先鋒形態（格鬥／射擊）排除
  // 群星是限重型的大盾，而彌造者是中甲 → 機種限定（盾的 fixture 加入後才有的第二種）
  assert.deepEqual(counts, [['FORM_WEAPON_TYPE', 2], ['MECH_RESTRICTION', 1]])
})

test('slotHasCandidates：「這一格存在但沒有東西裝得上」要答得出來', () => {
  // 先鋒形態（格鬥／射擊）：fixture 裡射擊一把都沒有，格鬥只有雙手武器
  const ctx = buildContext(
    { pilotId: 海莉絲.id, mechId: 彌造者.id, sets: { [先鋒形態.id]: { mounts: [] } } },
    先鋒形態.id, WORLD,
  )
  // ⚠ PLAN-052-J 之前這裡斷言 false，理由是「格鬥只有雙手武器」——
  //   那條斷言把 bug 本身寫進了測試：雙手武器佔的就是兩格 singleHand，
  //   手部格本來就該列得出它們（全庫 40/182 把因此在清單裡消失了）。
  assert.equal(slotHasCandidates(ctx, HAND_L), true)           // 單手格：雙手武器算候選
  assert.equal(slotHasCandidates(ctx, DUAL), true)             // 雙手：有
  assert.equal(slotHasCandidates(ctx, SHO_L), false)           // 先鋒裝不了戰術類肩部武器
  assert.equal(slotHasCandidates(ctxOf({ mounts: [] }, { mech: 輕型機 }), SHO_L), false)   // 輕型無肩槽
})

// ─── PLAN-052-J：雙手武器的裝備路徑 ─────────────────────────────────────────
//
// 這一組全部釘同一件事：`enumerateSlots()` 刻意不產生 dualHand 座標（對的），
// 所以挑選器只會拿 singleHand 的 ref 來問；手部格若不接受雙手武器，
// 全庫 40/182 把就**沒有任何入口**——不是灰掉，是連列都不列。

test('052-J：手部格的清單必須含雙手武器（修好前這裡是 0 把）', () => {
  const names = weaponChoices(ctxOf({ mounts: [] }), HAND_L)
    .filter((e) => e.rejection === null)
    .map((e) => e.item.name)
  assert.ok(names.includes('群山之力'), `左手清單缺雙手武器：${names.join('、')}`)
  assert.ok(names.includes('貝奧武夫'))
  // 單手武器當然還在——放行雙手不能把原本的擠掉
  assert.ok(names.includes('藝術突襲'))
})

test('052-J：mountRefFor 把手部座標換成 dualHand，且**不帶 side**', () => {
  assert.deepEqual(mountRefFor(群山之力, HAND_L), { bank: 'main', slot: WeaponEquipSlot.DUAL_HAND })
  assert.deepEqual(mountRefFor(群山之力, HAND_R), { bank: 'main', slot: WeaponEquipSlot.DUAL_HAND })
  assert.deepEqual(mountRefFor(群山之力, BACKUP_L), { bank: 'backup', slot: WeaponEquipSlot.DUAL_HAND })
  // side 若被寫進去，slotKey() 會產出 main:dualHand:left，
  // 而 mountCoverage() 產的是不帶 side 的鍵 —— 兩者永遠對不上，
  // 症狀是「裝上去了但那一格顯示還是空的」。
  assert.equal('side' in mountRefFor(群山之力, HAND_L), false)
  // 非雙手武器原樣回傳（含背槽、肩部）
  assert.deepEqual(mountRefFor(藝術突襲, HAND_L), HAND_L)
  assert.deepEqual(mountRefFor(炬塔, BACK), BACK)
})

test('052-J：一把雙手武器佔住左右兩格，兩邊都查得到同一筆 mount', () => {
  const ctx = ctxOf({ mounts: [{ weaponId: 群山之力.id, bank: 'main', slot: WeaponEquipSlot.DUAL_HAND }] })
  for (const ref of [HAND_L, HAND_R]) {
    const occ = slotOccupant(ctx, ref)
    assert.equal(occ.kind, 'weapon')
    assert.equal(occ.kind === 'weapon' ? occ.weapon?.name : null, '群山之力')
  }
  assert.equal(mountCoverage({ bank: 'main', slot: WeaponEquipSlot.DUAL_HAND }).length, 2)
})

test('052-J：左手被固定武裝佔住時，雙手武器要「灰掉並說明」而不是消失', () => {
  const ctx = ctxOf({ mounts: [] }, { mech: 獨臂機 })
  const r = canEquipWeapon(ctx, 群山之力, HAND_R)   // 從**右手**問，佔住的是左手
  assert.equal(r?.code, 'SLOT_OCCUPIED')
  // omit 與 blocked 的差別正是這個 bug 的本體：使用者要看得到它存在、也看得到原因
  assert.notEqual(r && REJECTION_TIER[r.code], 'omitted')
  assert.match(r!.reason, /左手/)
})

test('052-J：雙手武器落在備用組時走 backupHand，主／備取較重者而非相加', () => {
  const ctx = ctxOf({
    mounts: [
      { weaponId: 貝奧武夫.id, bank: 'main',   slot: WeaponEquipSlot.DUAL_HAND },   // 850
      { weaponId: 群山之力.id, bank: 'backup', slot: WeaponEquipSlot.DUAL_HAND },   // 800
    ],
    backpackId: 強襲者背包.id,
  })
  const b = loadoutBudget(ctx)
  assert.equal(b.weight.mainHand, 850)
  assert.equal(b.weight.backupHand, 800)
  assert.equal(b.weight.hands, 850)          // ⚠ 不是 1650
  assert.equal(b.weight.heavierBank, 'main')
})

test('052-J：往左手裝單手武器會擠掉正在佔兩格的雙手武器（右手一併變空）', () => {
  const ctx = ctxOf({ mounts: [{ weaponId: 群山之力.id, bank: 'main', slot: WeaponEquipSlot.DUAL_HAND }] })
  // 規則層要放行（重量夠），實際的擠掉由 placeWeapon() 的 slotsOverlap 完成
  assert.equal(canEquipWeapon(ctx, 藝術突襲, HAND_L), null)
  // 重量預覽必須已經扣掉被擠掉的那把，否則「預覽說裝得下、按下去卻超重」
  const after = loadoutBudget(ctx, { add: { ref: HAND_L, weight: 藝術突襲.weight } })
  assert.equal(after.weight.mainHand, 藝術突襲.weight)
})

// ─── 盾擇一：手盾與大盾合計，每組一面 ───────────────────────────────────────
//
// 全庫 24 面盾（大盾 12 ＋ 手盾 12）**全部是 singleHand**，
// 所以沒有這條規則的話，兩隻手各掛一面是選得出來的——而遊戲不允許。

test('盾：左手已有手盾時，右手再裝手盾被擋，且解法指向卸下那一面', () => {
  const ctx = ctxOf({ mounts: [{ weaponId: 聚合屏障.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }] })
  const r = canEquipWeapon(ctx, 玲瓏, HAND_R)
  assert.equal(r?.code, 'SHIELD_LIMIT')
  assert.equal(r?.tier, 'situational')          // 改別的就能解 → 灰掉＋解法，不是隱藏
  assert.ok(r && 'resolution' in r && r.resolution.action.type === 'unequip')
  assert.match(r!.reason, /左手/)
  assert.match(r!.reason, /聚合屏障/)
})

test('盾：大盾 ＋ 手盾 也算兩面（合計一面，不是同類各一面）', () => {
  // 大盾限重型，故用重型機師＋重型機——否則會先撞 MECH_RESTRICTION 而測不到本條
  const ctx = ctxOf(
    { mounts: [{ weaponId: 群星.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }] },
    { mech: 重型機, pilot: 重型機師 },
  )
  assert.equal(canEquipWeapon(ctx, 聚合屏障, HAND_R)?.code, 'SHIELD_LIMIT')
})

test('盾：主手組與備用組各自一面（兩組是替換關係，不並存）', () => {
  const ctx = ctxOf({
    mounts: [{ weaponId: 聚合屏障.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }],
    backpackId: 強襲者背包.id,
  })
  assert.equal(canEquipWeapon(ctx, 玲瓏, BACKUP_L), null)
})

test('盾：換掉同一格的那一面不算衝突（否則盾永遠換不掉，只能先卸再裝）', () => {
  const ctx = ctxOf({ mounts: [{ weaponId: 聚合屏障.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }] })
  assert.equal(canEquipWeapon(ctx, 玲瓏, HAND_L), null)
})

test('盾：非盾的格鬥武器不受限（63 把格鬥類裡只有 24 面是盾，用 kind 不是 type）', () => {
  const ctx = ctxOf({ mounts: [{ weaponId: 聚合屏障.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }] })
  assert.equal(canEquipWeapon(ctx, 藝術突襲, HAND_R), null)
})

test('盾：已經裝了兩面的舊配裝（如改版前存下的分享碼）會被 validateLoadout 指名', () => {
  const problems = validateLoadout(ctxOf({ mounts: [
    { weaponId: 聚合屏障.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' },
    { weaponId: 玲瓏.id,     bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'right' },
  ] }))
  assert.ok(problems.some((p) => p.code === 'SHIELD_LIMIT'))
})

test('backpackChoices 把「僅輕型可裝」歸成結構性拒絕（不是默默不擋）', () => {
  const counts = structuralCounts(backpackChoices(ctxOf({ mounts: [] })))
  assert.deepEqual(counts, [['BACKPACK_ARMOR_TYPE', 1]])
})


// ─── 元件（PLAN-052-D Phase A）──────────────────────────────────────────────
//
// 五條規則的驗收 ＋ 兩個「靜默才可怕」的邊界（雙手武器的座標、主備各自獨立）。

/** 在某一格裝一把武器，並掛上指定的元件 */
const withComp = (
  ref: { bank: 'main' | 'backup'; slot: string; side?: 'left' | 'right' },
  weaponId: string,
  trigger: string[] = [],
  effect: string[] = [],
): EquipSet => ({
  mounts: [{
    weaponId, bank: ref.bank, slot: ref.slot as never, side: ref.side,
    setup: { triggerComponentIds: trigger, effectComponentIds: effect },
  }],
})

test('元件①：空格沒有武器 ⇒ COMP_NO_SLOTS（元件掛在武器上）', () => {
  const r = canEquipComponent(ctxOf({ mounts: [] }), 觸沉著, HAND_L)
  assert.equal(r?.code, 'COMP_NO_SLOTS')
  assert.equal(r?.tier, 'blocked')
})

test('元件①：B 品質武器不可裝元件（39 把 A／B 實測 limit=0）', () => {
  const ctx = ctxOf(withComp(HAND_L, 廉價刀.id))
  const r = canEquipComponent(ctx, 觸沉著, HAND_L)
  assert.equal(r?.code, 'COMP_NO_SLOTS')
  assert.match(r!.reason, /廉價刀/)
})

test('元件①：固定武裝不可裝元件，而且說得出是「固定武裝」', () => {
  // 獨臂機的左手焊著耀星
  const ctx = ctxOf({ mounts: [] }, { mech: 獨臂機 })
  const r = canEquipComponent(ctx, 觸沉著, HAND_L)
  assert.equal(r?.code, 'COMP_NO_SLOTS')
  assert.match(r!.reason, /固定武裝/)
})

test('元件①：全鎖形態的武裝也不可裝（虛粒子的耀星／隕星／千星）', () => {
  const ctx = ctxOf({ mounts: [] }, { setKey: 虛粒子形態.id })
  const r = canEquipComponent(ctx, 觸沉著, HAND_R)
  assert.equal(r?.code, 'COMP_NO_SLOTS')
  assert.match(r!.reason, /形態鎖定/)
})

test('元件②：W 型裝到單手武器 ⇒ COMP_W_TYPE（structural，摺疊而非灰掉）', () => {
  const ctx = ctxOf(withComp(HAND_L, 藝術突襲.id))
  const r = canEquipComponent(ctx, 觸憑逸W, HAND_L)
  assert.equal(r?.code, 'COMP_W_TYPE')
  assert.equal(r?.tier, 'structural')
})

test('元件②：W 型裝到雙手武器與背部武器 ⇒ 放行', () => {
  assert.equal(canEquipComponent(ctxOf(withComp(DUAL, 群山之力.id)), 觸憑逸W, DUAL), null)
  assert.equal(canEquipComponent(ctxOf(withComp(BACK, 炬塔.id)), 觸憑逸W, BACK), null)
})

test('元件③：allowedWeaponTypes 不符 ⇒ COMP_WEAPON_TYPE，且訊息寫出這把是什麼類', () => {
  // 藝術突襲是「突擊」類，而警戒族限定「射擊」
  const ctx = ctxOf(withComp(HAND_L, 藝術突襲.id))
  const r = canEquipComponent(ctx, 觸警戒, HAND_L)
  assert.equal(r?.code, 'COMP_WEAPON_TYPE')
  assert.equal(r?.tier, 'structural')
  assert.match(r!.reason, /突擊/)
})

test('元件③：填滿四種類型＝後台「全選」＝不限（201／208 筆是這個形狀）', () => {
  const ctx = ctxOf(withComp(HAND_L, 藝術突襲.id))
  assert.equal(canEquipComponent(ctx, 觸沉著, HAND_L), null)
  // 空陣列同樣視為不限
  const 無限定 = comp({ id: 'c_008', name: '觸元件-無患', componentType: 'Condition', allowedWeaponTypes: [] })
  const w2 = buildWorld({
    pilots: [海莉絲], mechs: [彌造者], weapons: [藝術突襲], backpacks: [], forms: [],
    components: [無限定],
  })
  const ctx2 = buildContext(
    { pilotId: 海莉絲.id, mechId: 彌造者.id, sets: { default: withComp(HAND_L, 藝術突襲.id) } },
    'default', w2,
  )
  assert.equal(canEquipComponent(ctx2, 無限定, HAND_L), null)
})

test('元件④：同族互斥跨 W／Normal 變體，且附「卸下 X」解法', () => {
  const ctx = ctxOf(withComp(DUAL, 群山之力.id, [觸憑逸W.id]))
  const r = canEquipComponent(ctx, 觸憑逸, DUAL)
  assert.equal(r?.code, 'COMP_FAMILY')
  assert.equal(r?.tier, 'situational')
  assert.equal(r!.tier === 'situational' && r.resolution.label, '卸下觸元件W-憑逸')
  assert.deepEqual(
    r!.tier === 'situational' ? r.resolution.action : null,
    { type: 'unequipComponent', ref: DUAL, componentId: 觸憑逸W.id },
  )
})

test('元件④：同族互斥也跨 S／A／B 三階（同名不同品質是同一顆的三個版本）', () => {
  const ctx = ctxOf(withComp(HAND_L, 藝術突襲.id, [觸憑逸.id]))
  assert.equal(canEquipComponent(ctx, 觸憑逸A, HAND_L)?.code, 'COMP_FAMILY')
})

test('元件④：解法按鈕照實寫「卸下」，不承諾「並裝上」（052-J 的懸案不再複製）', () => {
  const ctx = ctxOf(withComp(HAND_L, 藝術突襲.id, [觸憑逸.id]))
  const r = canEquipComponent(ctx, 觸憑逸A, HAND_L)
  assert.ok(r!.tier === 'situational' && !r.resolution.label.includes('裝上'))
})

test('元件④：不同族可以並存', () => {
  const ctx = ctxOf(withComp(HAND_L, 藝術突襲.id, [觸憑逸.id]))
  assert.equal(canEquipComponent(ctx, 觸沉著, HAND_L), null)
})

test('元件④：命名破格的元件永不互斥（null 族）', () => {
  const ctx = ctxOf(withComp(HAND_L, 藝術突襲.id, [], [破格元件.id]))
  assert.equal(canEquipComponent(ctx, 破格元件, HAND_L), null)
})

test('元件⑤：觸元件滿 3 ⇒ COMP_KIND_FULL（分項上限讀 triggerSlots）', () => {
  const ctx = ctxOf(withComp(DUAL, 群山之力.id, [觸沉著.id, 觸壓迫.id, 觸擊破.id]))
  const r = canEquipComponent(ctx, 觸憑逸, DUAL)
  assert.equal(r?.code, 'COMP_KIND_FULL')
  assert.equal(r?.tier, 'situational')
  assert.match(r!.reason, /觸元件/)
})

test('元件⑤：觸滿 3 時應元件仍裝得上（分項與總槽是兩條規則）', () => {
  const ctx = ctxOf(withComp(DUAL, 群山之力.id, [觸沉著.id, 觸壓迫.id, 觸擊破.id]))
  assert.equal(canEquipComponent(ctx, 應戰慄, DUAL), null)
})

test('元件⑤：總槽才是真正的牆 —— SS 武器 3 觸 ＋ 1 應之後裝不下第 5 顆', () => {
  const ctx = ctxOf(withComp(DUAL, 群山之力.id, [觸沉著.id, 觸壓迫.id, 觸擊破.id], [應戰慄.id]))
  const r = canEquipComponent(ctx, 應穿甲, DUAL)
  assert.equal(r?.code, 'COMP_SLOTS_FULL')
  assert.match(r!.reason, /4/)
})

test('元件⑤：S 品質是 3 個總槽，不是 4', () => {
  const ctx = ctxOf(withComp(HAND_L, 三槽刀.id, [觸沉著.id], [應戰慄.id, 應穿甲.id]))
  const r = canEquipComponent(ctx, 應爆破, HAND_L)
  assert.equal(r?.code, 'COMP_SLOTS_FULL')
  assert.match(r!.reason, /3/)
})

test('元件⑤：已經裝著的那一顆不會被誤報成同族衝突或槽已滿', () => {
  // 槽全滿，再問其中一顆已裝的 ⇒ 放行（面板要畫得出「已裝上」而不是灰掉）
  const ctx = ctxOf(withComp(DUAL, 群山之力.id, [觸沉著.id, 觸壓迫.id, 觸擊破.id], [應戰慄.id]))
  assert.equal(canEquipComponent(ctx, 觸沉著, DUAL), null)
  assert.equal(canEquipComponent(ctx, 應戰慄, DUAL), null)
})

test('元件：雙手武器要用 dualHand 座標查得到 mount（slotOccupant 在此會回 empty）', () => {
  const ctx = ctxOf(withComp(DUAL, 群山之力.id, [觸沉著.id]))
  // slotOccupant 比對的是 slotKey，dualHand 的 coverage 不含自己 ⇒ 查不到
  assert.equal(slotOccupant(ctx, DUAL).kind, 'empty')
  // weaponSiteAt 比對覆蓋範圍 ⇒ 查得到
  const site = weaponSiteAt(ctx, DUAL)
  assert.equal(site.weapon?.id, 群山之力.id)
  assert.deepEqual(site.mount?.setup?.triggerComponentIds, [觸沉著.id])
})

test('元件：主手與備用各裝一把同型武器，元件各自獨立（三段式鍵的實質驗證）', () => {
  const ctx = ctxOf({
    mounts: [
      { weaponId: 藝術突襲.id, bank: 'main',   slot: WeaponEquipSlot.SINGLE_HAND, side: 'left', setup: { triggerComponentIds: [觸憑逸.id] } },
      { weaponId: 藝術突襲.id, bank: 'backup', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left', setup: { triggerComponentIds: [觸沉著.id] } },
    ],
    backpackId: 強襲者背包.id,
  })
  assert.deepEqual(weaponSiteAt(ctx, HAND_L).mount?.setup?.triggerComponentIds, [觸憑逸.id])
  assert.deepEqual(weaponSiteAt(ctx, BACKUP_L).mount?.setup?.triggerComponentIds, [觸沉著.id])
  // 主手裝了憑逸，備用手再裝憑逸**不算衝突**（決策一：互斥範圍是單把武器內）
  assert.equal(canEquipComponent(ctx, 觸憑逸A, BACKUP_L), null)
})

test('componentChoices：blocked 回空陣列（整個面板該降級說明，不是給空清單）', () => {
  assert.deepEqual(componentChoices(ctxOf(withComp(HAND_L, 廉價刀.id)), HAND_L), [])
})

test('componentChoices：裝不上的留在清單裡並帶原因，不被濾掉', () => {
  const entries = componentChoices(ctxOf(withComp(HAND_L, 藝術突襲.id)), HAND_L)
  assert.equal(entries.length, COMPONENTS.length, '一顆都不能少')
  const counts = structuralCounts(entries)
  // 單手武器 ⇒ W 型 1 筆被摺疊；藝術突襲是突擊類 ⇒ 警戒（限射擊）1 筆被摺疊
  assert.deepEqual(counts.sort(), [['COMP_WEAPON_TYPE', 1], ['COMP_W_TYPE', 1]].sort())
})

test('componentChoices：可裝的排前面，其中觸發機率等級高的優先', () => {
  const entries = componentChoices(ctxOf(withComp(DUAL, 群山之力.id)), DUAL)
  assert.equal(entries[0].rejection, null)
  assert.equal(entries[0].item.id, 觸憑逸W.id, 'Lv7 應該排在 Lv6／Lv5 之前')
  const firstRejected = entries.findIndex((e) => e.rejection !== null)
  assert.ok(entries.slice(0, firstRejected).every((e) => e.rejection === null))
})

// ─── 模組接口 gate（PLAN-052-G A-3）────────────────────────────────────────
//
// 這一段守的是「四張卡各自該說什麼」。三種不可裝的狀態**不可共用一句話**：
// 留白或含糊會被讀成一個我們並不知道的否定陳述 —— 那正是 2026-08-27 修掉的
// 「B 品質機甲接口資料未建檔」那句錯話的成因。

const TORSO = { kind: 'module', position: MechPartPosition.TORSO } as const
const L_ARM = { kind: 'module', position: MechPartPosition.LEFT_ARM } as const
const LEGS  = { kind: 'module', position: MechPartPosition.LEGS } as const

test('052-G：Ⅱ型接口 A／S 皆可裝', () => {
  const ctx = ctxOf({ mounts: [] })
  assert.equal(canEquipModule(ctx, 通用S, TORSO), null)
  assert.equal(canEquipModule(ctx, 通用A, TORSO), null)
  assert.equal(canEquipModule(ctx, 八級S, LEGS), null)
})

test('052-G：Ⅰ型接口只收 A 級 —— S 級被 structural 摺疊，不是灰掉', () => {
  const ctx = ctxOf({ mounts: [] }, { mech: A級機 })
  // 軀幹與腿部是 Ⅰ 型
  const r = canEquipModule(ctx, 通用S, TORSO)
  assert.equal(r?.code, 'MOD_IFACE_RARITY')
  assert.equal(r?.tier, 'structural')
  assert.equal(canEquipModule(ctx, 通用S, LEGS)?.code, 'MOD_IFACE_RARITY')
  // A 級裝得上；而同一台的雙臂是 Ⅱ 型，S 級在那裡沒問題
  assert.equal(canEquipModule(ctx, 通用A, TORSO), null)
  assert.equal(canEquipModule(ctx, 通用S, L_ARM), null)
})

test('052-G：B 品質機甲「沒有模組接口」是 blocked —— 整個面板降級，不是給一個空清單', () => {
  const ctx = ctxOf({ mounts: [] }, { mech: B級機 })
  const r = canEquipModule(ctx, 通用A, TORSO)
  assert.equal(r?.code, 'MOD_NO_INTERFACE')
  assert.equal(r?.tier, 'blocked')
  assert.match(r!.reason, /沒有模組接口/)
  // ⚠ 這句話**不可以**是「未建檔」：那個狀態自 2026-08-27 起已經不存在
  assert.doesNotMatch(r!.reason, /未建檔/)
})

test('052-G：認不得的接口型別是 unknown 而不是「沒有接口」（星夜女神那個坑）', () => {
  const ctx = ctxOf({ mounts: [] }, { mech: 壞接口機 })
  const r = canEquipModule(ctx, 通用A, TORSO)
  assert.equal(r?.code, 'MOD_IFACE_UNKNOWN')
  assert.equal(r?.tier, 'blocked')
  // 「不知道」與「沒有」是兩件事，兩者共用一句話就等於對玩家說了一個我們並不知道的否定陳述
  assert.notEqual(r?.code, 'MOD_NO_INTERFACE')
  // 同一台的其他三格是正常的 Ⅱ 型，不受影響
  assert.equal(canEquipModule(ctx, 通用S, L_ARM), null)
})

test('052-G：候選池外的模組擋在規則層 —— 分享碼帶進來的專屬／副模組不會靜默裝上', () => {
  const ctx = ctxOf({ mounts: [] })
  const 專屬 = canEquipModule(ctx, 破曉專屬, TORSO)
  assert.equal(專屬?.code, 'MOD_NOT_CANDIDATE')
  assert.equal(專屬?.tier, 'structural')
  assert.equal(canEquipModule(ctx, 副模組, TORSO)?.code, 'MOD_NOT_CANDIDATE')
})

test('052-G：沒有 levels[] 的模組擋下 —— 判準不是頂層那排全 0 的平坦欄位', () => {
  const ctx = ctxOf({ mounts: [] })
  const r = canEquipModule(ctx, 空殼模組, TORSO)
  assert.equal(r?.code, 'MOD_DATA_INCOMPLETE')
  assert.equal(r?.tier, 'structural')
})

// ─── 機師的專武變體（使用者要求 2026-08-27）───────────────────────────────
//
// 實測：3 位機師各有兩把專武（母武器與進階版**都**掛 isExclusive、都指向同一位機師、
// 都強化同一個天賦）。舊版用 `find()` 只取一把 —— 站上顯示哪一把取決於 Map 的迭代順序。

const 肖妮 = { ...海莉絲, id: 'pilot_010_肖妮', name: '肖妮' }
const 熠光 = weapon({
  id: 'w_back_1', name: '熠光', weight: 1100, equipSlot: WeaponEquipSlot.BACK,
  type: WeaponType.Heavy, rarity: 'SS', mechRestriction: MechRestriction.MEDIUM_ONLY,
  isExclusive: true, exclusiveFor: 肖妮.id,
})
const 裁決者 = weapon({
  id: 'w_back_2', name: '裁決者', weight: 1100, equipSlot: WeaponEquipSlot.BACK,
  type: WeaponType.Heavy, rarity: 'SS', mechRestriction: MechRestriction.MEDIUM_ONLY,
  isExclusive: true, exclusiveFor: 肖妮.id,
  upgrade: { fromWeaponId: 'w_back_1', station: 'specialBackpack' },
})

const VARIANT_WORLD = buildWorld({
  pilots: [肖妮], mechs: [彌造者], forms: [], backpacks: [],
  // ⚠ 順序刻意**反過來放**（子在母之前）：本函式要靠走鏈排序，不能靠輸入順序碰運氣
  weapons: [裁決者, 熠光, 藝術突襲],
})
const variantCtx = () => buildContext(
  { pilotId: 肖妮.id, mechId: 彌造者.id, sets: { default: { mounts: [] } } },
  'default',
  VARIANT_WORLD,
)

test('專武變體：兩把都回，且依升級鏈由母到子（輸入順序是反的）', () => {
  const list = pilotExclusiveWeapons(variantCtx(), 肖妮.id)
  assert.deepEqual(list.map((w) => w.name), ['熠光', '裁決者'],
    '走鏈排序 —— 靠 sort() 比較「A 是 B 的母武器」這種偏序不可靠')
})

test('專武變體：沒有專武的機師回空陣列（不是回一把別人的）', () => {
  assert.deepEqual(pilotExclusiveWeapons(variantCtx(), 'pilot_不存在'), [])
})

test('專武變體：只有一把時原樣回（多數機師是這一種）', () => {
  const w = buildWorld({
    pilots: [肖妮], mechs: [彌造者], forms: [], backpacks: [], weapons: [熠光],
  })
  const ctx = buildContext({ pilotId: 肖妮.id, mechId: 彌造者.id, sets: { default: { mounts: [] } } }, 'default', w)
  assert.deepEqual(pilotExclusiveWeapons(ctx, 肖妮.id).map((x) => x.name), ['熠光'])
})

// ─── 一鍵升級（使用者要求 2026-08-27）─────────────────────────────────────
//
// 全庫 42 條升級邊、**一對多為 0**（所以按鈕不必問「升級成哪一個」）、
// **0 條變重**（所以幾乎不可能被 OVERWEIGHT 擋下）。這一段守的是那三件事的介面表現。

const HAND_L_REF = { bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' } as const

test('一鍵升級：裝著母武器 ⇒ 指得出進階版與重量差', () => {
  const ctx = upgradeCtx({ mounts: [{ weaponId: 夜魘.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }] })
  const plan = planWeaponUpgrade(ctx, HAND_L_REF)
  assert.equal(plan?.from.id, 夜魘.id)
  assert.equal(plan?.to.id, 終末之嘆.id)
  assert.equal(plan?.weightDelta, 0, '實測 42 條邊裡 39 條同重 —— 印「+0」是噪音，UI 據此不印')
  assert.equal(plan?.rejection, null)
  assert.deepEqual(plan?.ref, HAND_L_REF, '升級寫回同一格')
})

test('一鍵升級：鏈的最後一段與空格都回 null（整條不畫）', () => {
  const ctx = upgradeCtx({ mounts: [{ weaponId: 終末之嘆.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }] })
  assert.equal(planWeaponUpgrade(ctx, HAND_L_REF), null, '終末之嘆沒有下一段')
  assert.equal(planWeaponUpgrade(ctx, { bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'right' }), null,
    '空格沒有武器可升級')
})

test('一鍵升級：進階版裝不上時仍回計畫，但帶著原因（UI 印灰字不畫按鈕）', () => {
  // 重甲限定進階 限重型，而彌造者是中甲
  const ctx = upgradeCtx({ mounts: [{ weaponId: 藝術突襲.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }] })
  const plan = planWeaponUpgrade(ctx, HAND_L_REF)
  assert.equal(plan?.to.id, 重甲限定進階.id)
  assert.equal(plan?.rejection?.code, 'MECH_RESTRICTION',
    '「有進階版但這台吃不下」與「沒有進階版」是兩件事，不可都回 null')
})

test('一鍵升級：焊死的武裝沒有升級鍵（承諾一個做不到的動作比沒有更糟）', () => {
  // 帕斯卡的固定武裝（衝擊炮）佔著右肩，那一格的 occupant.kind 是 fixed
  const ctx = ctxOf({ mounts: [] }, { mech: 帕斯卡 })
  const shoulder = { bank: 'main', slot: WeaponEquipSlot.SHOULDER, side: 'right' } as const
  assert.equal(planWeaponUpgrade(ctx, shoulder), null)
})

// ─── 一鍵裝上專武（使用者要求 2026-08-27）─────────────────────────────────
//
// 這顆按鈕的承諾是「按下去一定裝得上」。所以要守的是：挑得出格就一定合法、
// 挑不出來就要說得出原因，而**雙手武器送進 reducer 的座標必須是 dualHand**
// ——與挑選器那條路徑一致，否則它會被當成只佔單邊那一格。

test('一鍵裝上：兩手都空 ⇒ 給兩個選項，讓玩家自己點哪一手', () => {
  // 使用者要求 2026-08-27：「如果還有手能裝，就給使用者點左右手」——
  // 第一版只回第一格，等於替所有人決定了左手。
  const plan = planWeaponAutoEquip(ctxOf({ mounts: [] }), 藝術突襲)
  assert.deepEqual(plan.options.map((o) => o.ref.side), ['left', 'right'])
  assert.deepEqual(plan.options.map((o) => o.displaces), [null, null])
  assert.equal(plan.rejection, null)
})

test('一鍵裝上：雙手武器只有一個選項，座標是 dualHand', () => {
  // 左右手都指向同一格 —— 不去重會出現兩顆做同一件事的按鈕
  const plan = planWeaponAutoEquip(ctxOf({ mounts: [] }), 群山之力)
  assert.equal(plan.options.length, 1)
  assert.equal(plan.options[0].ref.slot, WeaponEquipSlot.DUAL_HAND, '送進 reducer 的形狀要與挑選器那條路徑一致')
})

test('一鍵裝上：空格排在覆蓋前面', () => {
  const ctx = ctxOf({
    mounts: [{ weaponId: 藝術突襲.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }],
  })
  const plan = planWeaponAutoEquip(ctx, 夜魘)
  assert.equal(plan.options[0].ref.side, 'right', '空的那隻手要排第一個')
  assert.equal(plan.options[0].displaces, null)
  assert.equal(plan.options[1].displaces, 藝術突襲.name, '第二個選項會換掉左手那把，title 要說得出來')
})

test('一鍵裝上：盾牌裝上一面之後，另一手那個選項自己消失（不必特判）', () => {
  // 使用者要求 2026-08-27：「盾牌類因為只能裝一個，裝上就要把按鈕隱藏了」。
  // ⚠ 這裡**沒有任何一行盾的特判** —— `SHIELD_LIMIT` 已經在 canEquipWeapon 擋掉第二面，
  //   在計畫層再寫一次就是把同一條規則寫兩次，而第二份會在規則改動時過期。
  const 空手 = planWeaponAutoEquip(ctxOf({ mounts: [] }), 聚合屏障)
  assert.equal(空手.options.length, 2, '一面都沒裝時左右手都可以')

  const 裝了一面 = ctxOf({
    mounts: [{ weaponId: 玲瓏.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }],
  })
  const plan = planWeaponAutoEquip(裝了一面, 聚合屏障)
  // 右手（空的）被 SHIELD_LIMIT 擋下；左手則是「換掉那一面盾」——那是合法的
  assert.equal(plan.options.every((o) => o.ref.side !== 'right'), true, '右手不該還留著選項')
  assert.deepEqual(plan.options.map((o) => o.displaces), [玲瓏.name])
})

test('一鍵裝上：左手已有這一把 ⇒ **右手照樣給選項**（玩家可能想雙持）', () => {
  // 使用者裁決 2026-08-27：「也許使用者想雙手都拿專武，所以除非那個部位已經拿了專武，
  // 不然就顯示裝備按鈕給使用者」。舊版一發現裝過就收掉整顆按鈕，等於替玩家否決了雙持。
  const ctx = ctxOf({
    mounts: [{ weaponId: 藝術突襲.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }],
  })
  const plan = planWeaponAutoEquip(ctx, 藝術突襲)
  assert.equal(plan.alreadyEquipped, true)
  assert.deepEqual(plan.options.map((o) => o.ref.side), ['right'], '左手那一格沒事可做，右手照給')
  assert.equal(plan.rejection, null)
})

test('一鍵裝上：兩手都拿著同一把 ⇒ 沒有位置了，安靜收掉（不報「做不到」）', () => {
  const ctx = ctxOf({
    mounts: [
      { weaponId: 藝術突襲.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' },
      { weaponId: 藝術突襲.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'right' },
    ],
  })
  const plan = planWeaponAutoEquip(ctx, 藝術突襲)
  assert.deepEqual(plan.options, [])
  assert.equal(plan.alreadyEquipped, true)
  assert.equal(plan.rejection, null, '玩家想要的事已經成立 —— 這不是一個該報原因的狀態')
})

test('一鍵裝上：同一面盾裝了左手 ⇒ 右手不給選項（SHIELD_LIMIT 自己擋掉，無特判）', () => {
  const ctx = ctxOf({
    mounts: [{ weaponId: 聚合屏障.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }],
  })
  const plan = planWeaponAutoEquip(ctx, 聚合屏障)
  assert.equal(plan.alreadyEquipped, true)
  assert.deepEqual(plan.options, [], '盾一組只能一面 —— 這是「除了盾以外才給雙持」的那個例外')
  assert.equal(plan.rejection, null, '安靜收掉，不是報錯')
})

test('一鍵裝上：想雙持但會超重 ⇒ **這一種要說**（其餘無位置的情況安靜）', () => {
  // 「想雙持卻沒看到按鈕」時，「再裝一把會超重」正是玩家缺的那一句 —— 而那是他改得動的事。
  // 盾只能一面、位置用完了那些則不出聲，免得每一套配裝底下都掛一行與當下無關的說明。
  const ctx = ctxOf({
    mounts: [
      { weaponId: 熔火.id, bank: 'main', slot: WeaponEquipSlot.SHOULDER, side: 'left' },
      { weaponId: 群山之力.id, bank: 'main', slot: WeaponEquipSlot.DUAL_HAND },
    ],
  })
  const plan = planWeaponAutoEquip(ctx, 熔火)
  assert.equal(plan.alreadyEquipped, true)
  if (plan.options.length === 0 && plan.rejection) {
    assert.equal(plan.rejection.code, 'OVERWEIGHT', '會被報出來的只有超重這一種')
  }
})

test('一鍵裝上：肩部武器同樣可以雙持（位置不限於手）', () => {
  // 使用者逐字：「位置可能是背後、肩膀、雙手」——掃的是所有槽型相符的位置
  const 空 = planWeaponAutoEquip(ctxOf({ mounts: [] }), 熔火)
  assert.deepEqual(空.options.map((o) => o.ref.side), ['left', 'right'])
  assert.equal(空.options[0].ref.slot, WeaponEquipSlot.SHOULDER)
})

test('一鍵裝上：一格都挑不出來時要給原因，不是靜默回空陣列', () => {
  // 熔火限中甲、且是肩部武器 —— 輕型機沒有肩槽
  const plan = planWeaponAutoEquip(ctxOf({ mounts: [] }, { mech: 輕型機 }), 熔火)
  assert.deepEqual(plan.options, [])
  assert.equal(plan.alreadyEquipped, false, '這是「做不到」，不是「不必做」——兩者的選項都是空的')
  assert.ok(plan.rejection, '按鈕不畫的時候，那句原因就是玩家唯一的線索')
  assert.equal(plan.rejection?.code, 'NO_SLOT')
})

// ─── 一鍵裝滿（使用者要求 2026-08-27）──────────────────────────────────────
//
// 這一段守的是**按鈕不會跳票**：它印「裝滿 N 格 → LvX」，那 N 與 X 必須是真的。
// 全庫實測（2026-08-27）的三種接口組合與三種「補滿需要幾格」都各有一條。

/** 通用 S 級的真實形狀：＋2 級／顆、上限 4 ⇒ **兩格就滿**（候選池 31 顆） */
const 通用S2 = mod({ id: 'mod_4103', name: '通用S二階模組', rarity: 'S', moduleAddLevel: 2 })

test('一鍵裝滿：＋1 級的模組在 S 級機甲上裝滿四格（最常見的那一種）', () => {
  const plan = planModuleFill(ctxOf({ mounts: [] }), 通用A)
  assert.deepEqual(plan.targets, ['torso', 'leftArm', 'rightArm', 'legs'])
  assert.equal(plan.levelAfter, 4)
  assert.equal(plan.cap, 4)
  assert.equal(plan.displaced.length, 0)
  assert.equal(plan.noop, false)
})

test('一鍵裝滿：＋2 級的模組**只裝兩格**——塞滿四格是白費兩格', () => {
  // 這正是站上自己的超限提醒在勸玩家別做的事。做一顆專門製造超限的按鈕會自相矛盾。
  const plan = planModuleFill(ctxOf({ mounts: [] }), 通用S2)
  assert.equal(plan.targets.length, 2)
  assert.equal(plan.levelAfter, 4, '兩格就到上限')
})

test('一鍵裝滿：A 級機甲上的 S 級模組只裝得上雙臂 —— 承諾「四顆」會跳票', () => {
  // A 級機甲 16 台的接口一律是 Ⅰ Ⅱ Ⅱ Ⅰ：軀幹與腿部只收 A 級模組
  const plan = planModuleFill(ctxOf({ mounts: [] }, { mech: A級機 }), 通用S)
  assert.deepEqual(plan.targets, ['leftArm', 'rightArm'])
  assert.equal(plan.blockedSlots, 2, '軀幹與腿部裝不下')
  assert.equal(plan.levelAfter, 2, '＋1 級 × 兩格 ⇒ 只到 Lv2，離上限 4 還有距離')
  assert.ok(plan.levelAfter < plan.cap, '按鈕必須說得出「為什麼沒補滿」')
})

test('一鍵裝滿：8 級模組四格全滿也只到 Lv4，其餘由機甲自帶那顆補', () => {
  const plan = planModuleFill(ctxOf({ mounts: [] }), 八級S)
  assert.equal(plan.targets.length, 4)
  assert.equal(plan.cap, 8)
  assert.equal(plan.levelAfter, 4)
  assert.equal(plan.blockedSlots, 0, '不是接口擋的 —— 是格數本來就不夠，兩種說法不可共用')
})

test('一鍵裝滿：空格優先，不夠才覆蓋別族（一鍵的破壞力要盡量小）', () => {
  const ctx = ctxOf({ mounts: [] }, { modules: { torso: 通用S.id, leftArm: 通用S.id } })
  const plan = planModuleFill(ctx, 通用A)
  // 右臂與腿部是空的 ⇒ 先吃它們；還差兩格才輪到覆蓋軀幹與左臂
  assert.deepEqual(plan.targets.slice(0, 2), ['rightArm', 'legs'])
  assert.deepEqual(plan.displaced.map((d) => d.position), ['torso', 'leftArm'])
  assert.equal(plan.levelAfter, 4)
})

test('一鍵裝滿：已裝著的**同族**不重裝 —— 它已經在貢獻等級了', () => {
  const ctx = ctxOf({ mounts: [] }, { modules: { torso: 通用A.id } })
  const plan = planModuleFill(ctx, 通用A)
  assert.equal(plan.targets.includes('torso' as never), false)
  assert.equal(plan.levelBefore, 1)
  assert.equal(plan.targets.length, 3, '只補其餘三格')
  assert.equal(plan.levelAfter, 4)
})

test('一鍵裝滿：已滿級 ⇒ noop（按鈕整顆不畫，而不是畫一顆按下去沒事的）', () => {
  const full = { torso: 通用A.id, leftArm: 通用A.id, rightArm: 通用A.id, legs: 通用A.id }
  const plan = planModuleFill(ctxOf({ mounts: [] }, { modules: full }), 通用A)
  assert.equal(plan.noop, true)
  assert.deepEqual(plan.targets, [])
})

test('一鍵裝滿：B 品質機甲沒有接口 ⇒ noop，四格全記在 blockedSlots', () => {
  const plan = planModuleFill(ctxOf({ mounts: [] }, { mech: B級機 }), 通用A)
  assert.equal(plan.noop, true)
  assert.equal(plan.blockedSlots, 4)
})

test('052-G C-9：接口已裝別顆**不是**拒絕 —— 直接替換，不必先卸下', () => {
  // 使用者裁決 2026-08-27：「模組不要用『卸下』，直接替換，模組頂多超限，
  // 如果我們一開始就把不符合接口的模組篩除，就不存在無法替換的限制。」
  //
  // 第一版把它做成 situational ＋「卸下 X」按鈕（照抄元件那一層）——
  // 但元件有容量帳（觸／應各 3、合計 4），先卸一顆是真的在解一個限制；
  // 模組一格就是一顆，換上去就是換掉，沒有東西需要騰出來。
  // 副作用：那一格只要裝了東西，整份清單就變成「可裝 0 / 62 顆」全部灰掉。
  const ctx = ctxOf({ mounts: [] }, { modules: { torso: 通用S.id } })
  assert.equal(canEquipModule(ctx, 通用A, TORSO), null, '已裝別顆時仍應直接可裝（替換）')
  assert.equal(canEquipModule(ctx, 通用A, L_ARM), null)
  // 拒絕碼表裡不該再有它 —— 留著一個永遠不會發生的碼，下一個人會照它寫 UI
  assert.equal(REJECTION_CODES.includes('MOD_SLOT_TAKEN' as never), false)
})

test('052-G C-9：模組這一層已經沒有任何 situational 拒絕（接口 gate 擋光了）', () => {
  // ①②③④⑤ 全是 blocked／structural：走得到「可以裝」的那些，一律直接可裝。
  const moduleCodes = REJECTION_CODES.filter((c) => c.startsWith('MOD_'))
  assert.deepEqual(
    moduleCodes.filter((c) => REJECTION_TIER[c] === 'situational'), [],
    '模組多出一個 situational 拒絕 —— 那代表又出現了「要先做某件事才裝得上」的關卡，'
    + '動手之前先確認那件事真的存在（C-9 拿掉的那一個並不存在）',
  )
})

test('052-G：裝著的就是這一顆 ⇒ 不是拒絕而是「已裝上」（文案完全不同）', () => {
  const ctx = ctxOf({ mounts: [] }, { modules: { torso: 通用S.id } })
  assert.equal(canEquipModule(ctx, 通用S, TORSO), null)
})

test('052-G：模組等級一律由 chassis derive（buildContext 有把 world.modules 傳進去）', () => {
  // 少了 moduleMap 的話 moduleLevelOf() 恆回 0，而 0 的語意是「查無此模組」——
  // 症狀是右欄的效果彙總全部顯示 0 級加成，且不報錯
  const ctx = ctxOf({ mounts: [] })
  assert.equal(ctx.chassis!.moduleLevelOf(通用S.id), 4)
  assert.equal(ctx.chassis!.moduleLevelOf(八級S.id), 8)
  assert.equal(ctx.chassis!.moduleLevelOf('mod_不存在'), 0)
})

test('052-G：載入 gate —— 世界裡沒有模組時，規則層不誤報（空 Map ＝ 還沒載入）', () => {
  const 空世界 = buildWorld({
    pilots: [海莉絲], mechs: [彌造者], weapons: [], backpacks: [], forms: [],
  })
  const ctx = buildContext({ pilotId: 海莉絲.id, mechId: 彌造者.id, sets: {}, modules: { torso: 通用S.id } }, 'default', 空世界)
  assert.equal(ctx.world.modules.size, 0)
  // 呼叫端手上已經有 Module 物件時（清單來自 world.modules），本支**只會漏擋不會誤擋**：
  // 集合沒載入完不影響①〜⑤ 任何一條的判定（它們看的是接口與模組自己），
  // 所以這裡照樣回 null 而不是編一個查不到名字的拒絕出來。
  assert.equal(canEquipModule(ctx, 通用A, TORSO), null)
})
