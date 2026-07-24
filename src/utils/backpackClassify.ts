/**
 * PLAN-035 背包分類階層 — 純函式分類層。
 *
 * 兩件事，全部從既有資料 derive、零 Firestore 寫入：
 *   1. tierFromRarity：合成階層（素材/基礎/複合/特種）＝ rarity 的粗化（A/B 合併）。
 *   2. parseBackpackName：從名字拆出「強化/干擾」軸與變體——因為 type 欄位<b>不</b>編碼
 *      強化/干擾（出力強化背包 與 出力干擾背包 同 type=PowerAdd），此軸只存在於名字字串。
 *
 * ⚠ line 一律從 name 判斷，不可用 type。
 * ⚠ 名字文法 [基礎功能]?[強化|干擾]背包·[變體] 的 [基礎功能] 是<b>可選</b>的：
 *   base 階（S/A/B）的「強化背包·首攻」「干擾背包·攻擊」無功能前綴（type=Enhance/EMP），
 *   只有 S+ 複合階才有「出力/移動…」前綴。
 *
 * name-derive 是否對全部 180 個真實名字都乾淨可解析，由 scripts/audit-backpack-classify.mjs
 * 產出的 unresolved 報告佐證（純函式單元測試只覆蓋手挑名字，證明不了全集）。
 */

import type { Backpack } from '../types'

export type BackpackTier = 'material' | 'base' | 'composite' | 'special'
export type BackpackLine = '強化' | '干擾'

/** 階層中文標籤。 */
export const TIER_LABELS: Record<BackpackTier, string> = {
  material: '素材',
  base: '基礎',
  composite: '複合',
  special: '特種',
}

/** 階層顯示順序（高階在前，對齊圖鑑既有 SS→B 排序）。 */
export const TIER_ORDER: readonly BackpackTier[] = ['special', 'composite', 'base', 'material']

/** 落地預設顯示的階層（PLAN-037：預設只顯示特種 SS，查詢量小；其餘手動打開）。 */
export const DEFAULT_TIERS: readonly BackpackTier[] = ['special']

/** rarity → 合成階層（實測 1:1，A/B 皆為素材）。 */
const RARITY_TO_TIER: Record<string, BackpackTier> = {
  SS: 'special',
  'S+': 'composite',
  S: 'base',
  A: 'material',
  B: 'material',
}

/**
 * 合成階層 ＝ rarity 的純函式映射。未知 rarity 回 null（正常資料不會發生，
 * 由 audit 腳本把關；UI 對 null-tier 條目應寬鬆處理而非靜默清空）。
 */
export function tierFromRarity(rarity: string): BackpackTier | null {
  return RARITY_TO_TIER[rarity] ?? null
}

export interface BackpackNameParts {
  /** 基礎功能前綴（出力/移動…）；base 階線名與無線名皆為 null。type 欄位才是基礎功能的權威來源。 */
  baseFunction: string | null
  /** 強化 / 干擾 軸；純功能背包與 SS 特種背包為 null（優雅降級用）。 */
  line: BackpackLine | null
  /** 變體（首攻/攻擊…），取間隔號後段；無則 null。 */
  variant: string | null
}

/** 以「整個 token」為線標記，比裸『強化』穩——避開『強襲者背包』(SS) 被誤判為強化線。 */
const LINE_MARKERS: ReadonlyArray<{ marker: string; line: BackpackLine }> = [
  { marker: '強化背包', line: '強化' },
  { marker: '干擾背包', line: '干擾' },
]

/** 間隔號：遊戲資料可能用 middle dot(·, U+00B7) 或 katakana middle dot(・, U+30FB)。 */
const SEPARATOR = /[·・]/

/**
 * 從背包名字拆出 { baseFunction, line, variant }。
 * 純字串解析，不碰 rarity/type；對不含線/變體的名字（純功能背包、SS 特種）優雅回 null。
 */
export function parseBackpackName(name: string): BackpackNameParts {
  const sepIdx = name.search(SEPARATOR)
  const variant = sepIdx >= 0 ? name.slice(sepIdx + 1).trim() || null : null

  let line: BackpackLine | null = null
  let baseFunction: string | null = null
  for (const { marker, line: ln } of LINE_MARKERS) {
    const idx = name.indexOf(marker)
    if (idx >= 0) {
      line = ln
      // base 階「強化背包·首攻」前綴為空 → null；S+「出力強化背包」→「出力」
      baseFunction = name.slice(0, idx).trim() || null
      break
    }
  }

  return { baseFunction, line, variant }
}

// ── PLAN-036 特種背包前置關係 ────────────────────────────────────────────────
// 只存 craft.prereqBackpackId 一個事實；前置背包的種類與圖紙名皆 derive。

/**
 * 前置主背包的「種類」＝查 craft.prereqBackpackId 取其 type（出力/移動/誘導…）。
 * 無 craft、或查不到該 id（尚未輸入 / 資料不一致）→ null（前台優雅降級：此類 SS 在前置 facet 下不顯示）。
 */
export function prereqBackpackType(bp: Backpack, byId: Map<string, Backpack>): string | null {
  const id = bp.craft?.prereqBackpackId
  if (!id) return null
  return byId.get(id)?.type ?? null
}

/** 圖紙衍生名＝背包名 + 設計圖（如「征服者背包設計圖」）；材料來源另做，此處僅顯示用。 */
export function blueprintName(bp: Backpack): string {
  return `${bp.name}設計圖`
}

/**
 * 背包的「能力」＝循 craft 前置鏈找到的 S 變體背包（強化背包·X / 干擾背包·X）的 line + variant（PLAN-037）。
 *
 * 讓 SS/S+ 也能用「強化/干擾 + 能力」循線篩選：SS/S+ 自身名字可能無變體
 * （如 主宰者背包），沿 prereqBackpackId 鏈遞迴到第一個有 line+variant 的祖先。
 *   主宰者背包(SS) → 飛行強化背包·首攻(S+) → {強化, 首攻}
 * 功能背包（出力背包）、或鏈底為功能背包者 → { line:null, variant:null }（不被能力篩選命中）。
 */
export function backpackAbility(
  bp: Backpack,
  byId: Map<string, Backpack>,
  depth = 0,
): { line: BackpackLine | null; variant: string | null } {
  const { line, variant } = parseBackpackName(bp.name)
  if (line && variant) return { line, variant }
  const prereqId = bp.craft?.prereqBackpackId
  if (prereqId && depth < 6) {
    const prereq = byId.get(prereqId)
    if (prereq) return backpackAbility(prereq, byId, depth + 1)
  }
  return { line: null, variant: null }
}
