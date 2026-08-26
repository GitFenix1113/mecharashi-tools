import type { LoadoutIconName } from '../icons/LoadoutIcon'

// ─── 配裝模擬器視覺地基（PLAN-052-I A-1）─────────────────────────────────────
//
// 這一檔是**排版共用類的單一出處**，不含任何邏輯、不 import React。
//
// 為什麼要有它：052-B 交付的版面整頁字級擠在 10–12px（`text-[10px]` / `text-[11px]` /
// `text-[12px]` 幾乎是全部）。全部同樣重要 ＝ 全部都不重要 —— 玩家掃過去找不到
// 「總重是多少」這種一秒該答完的東西。修法不是逐處微調，而是先把**階**立起來，
// 再讓各元件從這裡取用；散在各檔的 `text-[11px]` 每被改一次就會漂移一次。
//
// ⚠ **一個新顏色都不加**（計畫書決策一）。這裡出現的 token 全部來自 `src/index.css`
//   的 `@theme`。改版不外溢成全站改色，其他頁面一行都不用動。

// ── 字級五階 ────────────────────────────────────────────────────────────────
//
//   10px  微標籤（Orbitron，全大寫寬字距）……… 區塊名、欄位名，只給「這是什麼」
//   12px  內文 …………………………………………… 說明、次要資訊
//   13px  內文（強調）……………………………… 裝備名這類要讀得出的短字串
//   15px  卡片標題 ………………………………… 面板／卡片的抬頭
//   20px  區塊標題 ………………………………… 頁面級標題、主視覺上的機師名
//   20/30px 數值（JetBrains Mono）……………… 帳本列的總重與可用出力
//
// 數值一律走等寬並開 `tabular-nums`：重量會隨換裝跳動，比例字寬會讓數字左右彈跳。
export const HUD = {
  /** 微標籤。Orbitron 全大寫 —— 站上既有慣例（ModuleInput / PlanResult 同一套寫法） */
  label: 'font-[Orbitron,sans-serif] text-[10px] font-bold uppercase tracking-[3px]',
  /** 微標籤的中文版：Orbitron 不含 CJK，中文字會落回本體字且字距會拉爆 */
  labelCjk: 'text-[10px] font-bold tracking-wide',
  /** 內文 */
  body: 'text-[12px] leading-relaxed',
  /** 內文（強調）——裝備名、機師名這類要讀得出來的短字串 */
  bodyStrong: 'text-[13px] font-semibold leading-snug',
  /** 卡片標題 */
  cardTitle: 'text-[15px] font-bold leading-snug',
  /** 區塊標題 */
  sectionTitle: 'text-[20px] font-extrabold tracking-wide leading-tight',

  /** 數值基底：等寬 ＋ 等寬數字。所有 `num*` 都已包含，單獨用於行內小數字 */
  num: 'font-[JetBrains_Mono,monospace] tabular-nums',
  /** 數值 · 小（12px）：列內重量 */
  numSm: 'font-[JetBrains_Mono,monospace] tabular-nums text-[12px]',
  /** 數值 · 中（20px）：卡片主數字、餘量卡 */
  numMd: 'font-[JetBrains_Mono,monospace] tabular-nums text-[20px] font-bold leading-none',
  /** 數值 · 大（30px）：帳本列的總重與可用出力，全頁唯一的 30px */
  numLg: 'font-[JetBrains_Mono,monospace] tabular-nums text-[30px] font-extrabold leading-none',
} as const

// ── 外框語彙 ────────────────────────────────────────────────────────────────
//
// `hud-cut` / `hud-cut-sm` 是 index.css 的 utility（clip-path 切角）。
// ⚠ 切角會裁掉溢出的子元素與 focus ring，掛浮窗／下拉的容器不要用 —— 詳見 index.css 的註解。

/** 大區塊外框（14px 切角）：面板、帳本列、立繪卡 */
export const HUD_PANEL = 'hud-cut bg-bg-card border border-border'
/** 大區塊外框 · 主結構（14px 切角 ＋ 亮一階的框線）：需要跟周圍分開的容器 */
export const HUD_PANEL_ACCENT = 'hud-cut bg-bg-card border border-border-accent'
/** 小元件外框（8px 切角）：徽章、槽位格、按鈕 */
export const HUD_CHIP = 'hud-cut-sm border'

/**
 * 帳本列的分段配色（PLAN-052-B 既有 `SEG_COLOR`，A-3 起改由本檔統一供應）。
 *
 * ⚠ 這四個顏色不只出現在分段條上：槽位格的重量數字要用**同一段的顏色**，
 *   玩家才看得出「這一格吃掉的是哪一段」（設計畫布 SlotStates 02）。
 *   兩處各留一份必然漂移，故收在這裡。
 */
export const SEG_COLOR = {
  chassis:  'bg-text-dim/60',
  hands:    'bg-accent-cyan',
  shoulder: 'bg-accent-purple',
  back:     'bg-accent-blue',
} as const

/** 分段對應的文字色（給槽位格的重量數字、圖例文字用） */
export const SEG_TEXT = {
  chassis:  'text-text-dim',
  hands:    'text-accent-cyan',
  shoulder: 'text-accent-purple',
  back:     'text-accent-blue',
} as const

export type SegKey = keyof typeof SEG_COLOR

export const SEG_LABEL: Record<SegKey, string> = {
  chassis: '機體', hands: '手部', shoulder: '肩部', back: '背部',
}

/**
 * 槽位型別 → 重量分段（PLAN-052-I D-3）。
 *
 * ⚠ 放在這裡而不是各元件自己寫一份 `segOf()`：槽位格、武器列、帳本列三處都要用
 *   **同一個**對照，否則同一把肩部武器會在一個地方是紫的、另一個地方是青的。
 *   （`chassis` 不由槽位產生 —— 那是機體自重，沒有對應的槽。）
 */
export function slotSegKey(slot: string): SegKey {
  if (slot === 'shoulder') return 'shoulder'
  if (slot === 'back') return 'back'
  return 'hands'
}

/**
 * 槽位型別 → icon 名（PLAN-052-I A-2）。左右手由 `side` 決定，沒給 side 的單手一律用右手版。
 *
 * ⚠ 放在這裡而不是 `LoadoutIcon.tsx`：那個檔只能匯出元件，多匯出一個函式會讓
 *   Vite 的 fast refresh 對整檔失效（`react-refresh/only-export-components`）。
 *
 * 參數收 `string` 而不是 `WeaponEquipSlot`：呼叫端拿到的常常是已經字串化的 `SlotRef.slot`，
 * 收窄型別只會逼出一堆 cast。未知值一律回 `plus`（空槽）——不認得的槽位當成「還沒裝東西」，
 * 比丟例外或畫成鎖頭安全。
 */
export function slotIconName(slot: string, side?: 'left' | 'right'): LoadoutIconName {
  switch (slot) {
    case 'singleHand': return side === 'left' ? 'handLeft' : 'handRight'
    case 'dualHand':   return 'dualHand'
    case 'shoulder':   return 'shoulder'
    case 'back':       return 'back'
    default:           return 'plus'
  }
}

/**
 * 分享碼裡「解不開的那一筆」是什麼種類（PLAN-052-C）。
 *
 * ⚠ 放在這裡而不是各對話框自己寫一份：貼碼對話框與本機書架都要把 `UnresolvedRef.kind`
 *   翻成中文，而兩份各寫的下場，就是同一個 `component` 在一個地方叫「元件」、
 *   另一個地方叫「改裝」。
 */
export const SHARE_KIND_LABEL: Record<'pilot' | 'mech' | 'weapon' | 'component' | 'backpack' | 'module', string> = {
  pilot: '機師', mech: '機甲', weapon: '武器',
  component: '元件', backpack: '背包', module: '模組',
}
