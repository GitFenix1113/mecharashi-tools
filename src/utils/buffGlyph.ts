import type { BuffIconTone, BuffLevel, GameBuff } from '../types'

// ─── BUFF 圖示（PLAN-055 D）────────────────────────────────────────────────
//
// 遊戲裡的 BUFF 圖示是「色塊底＋細米白框＋白色字形」（2026-10-11 站長提供的戰鬥截圖）：
//   藍＝增益、紅＝減益、紫＝特殊（狀態、資源、天賦專屬的機制 BUFF）、綠＝治療。
//   綠色沒有對應的 buffType，不從類型推，只走 iconTone 人工覆寫。
// 字形本身是白色單色圖（官方 bufftype_abs 圖集，圖庫 game/icons/buff/）；減益用的是**另一張**字形
// （多半帶一道斜線，例：Icon_debuff_remove），不是同一張換紅色。
// 左上角的層數、右下角的剩餘回合是戰鬥中的即時狀態，網站顯示的是 BUFF 定義，所以不畫。

/** 底色由 buffType 推：statBoost→藍、debuff／control→紅、其餘（state、resource）→紫 */
const TONE_BY_TYPE: Record<string, BuffIconTone> = {
  statBoost: 'buff',
  debuff: 'debuff',
  control: 'debuff',
  state: 'special',
  resource: 'special',
}

export const BUFF_TONE_LABEL: Record<BuffIconTone, string> = {
  buff: '增益（藍）',
  debuff: '減益（紅）',
  special: '特殊（紫）',
  heal: '治療（綠）',
}

/**
 * 圖示底色：有人工覆寫（iconTone）就用它，否則由 buffType 推。
 * 推不出來（未知 buffType）一律當特殊——紫色在遊戲裡本來就是「不屬於增減益」的那一類。
 */
export function buffIconTone(buff: Pick<GameBuff, 'buffType' | 'iconTone'>): BuffIconTone {
  return buff.iconTone ?? TONE_BY_TYPE[String(buff.buffType)] ?? 'special'
}

/** 要畫哪一張字形：該級專屬圖示優先，否則用 BUFF 本身的；都沒有回 undefined（呼叫端畫中性小點） */
export function buffGlyphKey(buff: Pick<GameBuff, 'icon'>, level?: Pick<BuffLevel, 'icon'> | null): string | undefined {
  const k = (level?.icon || buff.icon || '').trim()
  return k || undefined
}
