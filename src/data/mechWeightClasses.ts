// 機甲類型（輕／中／重）＝機師駕照的單一來源 —— PLAN-059 B-3（計畫書決策九、決策十）
//
// 「執照是這位機師的機種」（utils/normalizeArmorType.ts）：輕型駕照只能開輕型機甲，一對一。
// 所以同一套官方圖示 Icon_wanzertype_001／002／003 同時是駕照、機甲類型、武器限定、背包可裝備的圖示。
//
// ── 同一個概念在資料裡有 5 種寫法（資料值不動，只統一畫面）────────────────────
//   mechs.armorType            輕型／中甲／重型
//   pilots.license             輕型／中型／重型
//   backpacks.assemblableArmorType   Light／Medium／Heavy
//   weapons.mechRestriction    light／medium／heavy／none
// mechWeightClassOf() 吃上面任何一種；比對規則仍以 normalizeArmorType.ts 為準，這裡只是先過它再查表。
//
// ── 顯示（決策十，站長 2026-10-13）────────────────────────────────────────────
//   畫面上用短名「輕型／中型／重型」，旁邊一定有 L／M／H 圖示，「機甲」兩字是重複資訊；
//   遊戲內的全名「輕型機甲」給詳情頁資訊列、滑鼠提示、aria-label。輕甲／中甲／重甲這組顯示字不再使用。
//   配色統一 青／綠／紅（模擬器原本的青／紫／橘已併入）。機師處的駕照圖示用中性色——類型色會和職業色撞。
// ⚠ 色類名逐字寫完整（Tailwind v4 只產生原始碼裡出現過的類名）。

import { ArmorType } from '../types/enums.ts'
import { fromAssemblableArmorType, toArmorType } from '../utils/normalizeArmorType.ts'

export interface MechWeightClassMeta {
  /** 機甲資料的值（mechs.armorType）——比對用，不是顯示字 */
  armorType: ArmorType
  /** 畫面短名 */
  short: string
  /** 遊戲內全名 */
  full: string
  /** 官方圖示編號：Icon_wanzertype_<icon>_{l,s} */
  icon: string
  text: string
  bg: string
  border: string
  bar: string
}

export const MECH_WEIGHT_CLASSES: readonly MechWeightClassMeta[] = [
  { armorType: ArmorType.LIGHT,  short: '輕型', full: '輕型機甲', icon: '001', text: 'text-accent-cyan',  bg: 'bg-accent-cyan/10',  border: 'border-accent-cyan/40',  bar: 'bg-accent-cyan' },
  { armorType: ArmorType.MEDIUM, short: '中型', full: '中型機甲', icon: '002', text: 'text-accent-green', bg: 'bg-accent-green/10', border: 'border-accent-green/40', bar: 'bg-accent-green' },
  { armorType: ArmorType.HEAVY,  short: '重型', full: '重型機甲', icon: '003', text: 'text-accent-red',   bg: 'bg-accent-red/10',   border: 'border-accent-red/40',   bar: 'bg-accent-red' },
]

/**
 * 「三種都可以」（武器 none、背包標了輕＋中＋重）：官方的三者合一圖示 004（決策十：只在裝備詳情頁用，清單不顯示）。
 * 站長原決定「匯入但先不用」是就機師而言——目前沒有全機型的機師。
 */
export const ALL_MECH_TYPES = { short: '全機型', full: '全機型可用', icon: '004' } as const

const BY_ARMOR = new Map<string, MechWeightClassMeta>(MECH_WEIGHT_CLASSES.map((m) => [m.armorType, m]))

/**
 * 任何一種寫法 → 對照；認不得的值回 undefined（不猜，呼叫端退回純文字）。
 * 武器的 none 不是一種類型（是「不限制」），也回 undefined。
 */
export function mechWeightClassOf(raw: string | null | undefined): MechWeightClassMeta | undefined {
  if (!raw) return undefined
  const s = raw.trim()
  const armor = toArmorType(s) ?? fromAssemblableArmorType(s) ?? fromAssemblableArmorType(s.charAt(0).toUpperCase() + s.slice(1))
  return armor ? BY_ARMOR.get(armor) : undefined
}

/** 顯示用短名；認不得就原樣（寧可顯示原字，不要空白） */
export function mechWeightShort(raw: string | null | undefined): string {
  return mechWeightClassOf(raw)?.short ?? raw ?? ''
}

/** 駕照／機甲類型圖示的官方檔名。'l'＝340² 有外框；'s'＝只有字形（共用圖集裡的小圖，給 ≤24px） */
export function mechWeightIconKey(raw: string | null | undefined, size: 'l' | 's'): string | undefined {
  const meta = mechWeightClassOf(raw)
  return meta ? `Icon_wanzertype_${meta.icon}_${size}` : undefined
}

/** 徽章用的「文字色 淡底 框線」三件一組；認不得的給中性樣式 */
export function mechWeightBadgeClass(raw: string | null | undefined): string {
  const meta = mechWeightClassOf(raw)
  return meta ? `${meta.text} ${meta.bg} ${meta.border}` : 'text-text-secondary bg-bg-card border-border'
}
