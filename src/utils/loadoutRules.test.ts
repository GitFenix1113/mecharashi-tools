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
} from './loadoutRules.ts'
import { ArmorType, MechLicense, MechRestriction, WeaponEquipSlot, BackpackType, WeaponType } from '../types/enums.ts'

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
  mechRestriction: MechRestriction.NONE, isExclusive: false, triggerSlots: 0, effectSlots: 0, componentLimit: 4,
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
const 耀星     = weapon({ id: 'w_176', name: '耀星', weight: 100, equipSlot: WeaponEquipSlot.SINGLE_HAND, type: WeaponType.Special, isFixedArmament: true })
const 隕星     = weapon({ id: 'w_177', name: '隕星', weight: 100, equipSlot: WeaponEquipSlot.SINGLE_HAND, type: WeaponType.Special, isFixedArmament: true })
const 千星     = weapon({ id: 'w_178', name: '千星', weight: 100, equipSlot: WeaponEquipSlot.BACK,        type: WeaponType.Special, isFixedArmament: true })
const 衝擊炮   = weapon({ id: 'w_衝擊炮', name: '衝擊炮', weight: 0, equipSlot: WeaponEquipSlot.SHOULDER, type: WeaponType.Special, isFixedArmament: true })

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

const WORLD = buildWorld({
  pilots: [海莉絲, 重型機師],
  mechs: [彌造者, 輕型機, 重型機, 美杜莎MK2, 帕斯卡, 獨臂機],
  weapons: [群山之力, 貝奧武夫, 藝術突襲, 夜魘, 熔火, 炬塔, 耀星, 隕星, 千星, 衝擊炮],
  backpacks: [強襲者背包, 出力背包Ⅲ, 輕型限定包],
  forms: [先鋒形態, 突擊形態, 虛粒子形態],
})

const ctxOf = (set: EquipSet, opts: { mech?: Mech; setKey?: string; pilot?: Pilot } = {}) => {
  const key = opts.setKey ?? 'default'
  return buildContext(
    { pilotId: (opts.pilot ?? 海莉絲).id, mechId: (opts.mech ?? 彌造者).id, sets: { [key]: set } },
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
  assert.deepEqual(counts, [['FORM_WEAPON_TYPE', 2]])
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

test('backpackChoices 把「僅輕型可裝」歸成結構性拒絕（不是默默不擋）', () => {
  const counts = structuralCounts(backpackChoices(ctxOf({ mounts: [] })))
  assert.deepEqual(counts, [['BACKPACK_ARMOR_TYPE', 1]])
})
