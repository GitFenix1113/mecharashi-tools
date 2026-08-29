import type { ShareIdKind } from '../../utils/loadoutCode/shareId'
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
//   13px  內文 …………………………………………… 說明、次要資訊
//   14px  內文（強調）……………………………… 裝備名這類要讀得出的短字串
//   16px  卡片標題 ………………………………… 面板／卡片的抬頭
//   20px  區塊標題 ………………………………… 頁面級標題、主視覺上的機師名
//   20/30px 數值（JetBrains Mono）……………… 帳本列的總重與可用出力
//
// ⚠ 內文三階在 2026-08-27 各 ＋1px（12/13/15 → 13/14/16，使用者要求）。
//   原本那組是為 `max-w-[1600px]` ＋ 380px 情境欄訂的；版面放寬到 1920 之後，
//   同一組字級在更大的留白裡看起來偏小。**只動內文三階與 `numSm`**：
//   微標籤與大數值不動，否則整頁只是等比放大，字級階要表達的主次關係原地踏步。
//
// 數值一律走等寬並開 `tabular-nums`：重量會隨換裝跳動，比例字寬會讓數字左右彈跳。
//
// ── 10px 的用法規則（使用者要求 2026-08-27 的字級調整）────────────────────
//
//   **10px 只給拉丁字母與數字**：`label`（Orbitron 全大寫）、角標上的 `Lv2/4`、
//   `×3` 這類上標。它們是短的、有輪廓的、而且多半有數字形狀可辨。
//
//   **中文句子一律 ≥ 11px。** 本站 root font-size 是 19px，10px 的漢字在這個
//   字級比例下已經開始糊成一團 —— 一句「這一族已達上限」在 10px 要瞇眼才讀得完，
//   而它出現的位置正是玩家需要它的時候。
//
//   ⚠ 這條**不是「全部放大一號」**：把角標的 `Lv2/4` 一起放大會讓它與旁邊的
//     模組名搶注意力，而它本來就該是次要的。字級階的用途是分主次，不是比大小。
export const HUD = {
  /** 微標籤。Orbitron 全大寫 —— 站上既有慣例（ModuleInput / PlanResult 同一套寫法） */
  label: 'font-[Orbitron,sans-serif] text-[10px] font-bold uppercase tracking-[3px]',
  /**
   * 微標籤的中文版：Orbitron 不含 CJK，中文字會落回本體字且字距會拉爆。
   *
   * ⚠ **11px 而不是 10px**（使用者要求 2026-08-27 的字級調整）：拉丁字母全大寫在 10px
   *   仍然辨識得出輪廓，中文在 10px 已經開始糊 —— 同一個「階」對兩種文字不是同一個字級。
   *   `label`（Orbitron）維持 10px 正是因為它只放拉丁字。
   */
  labelCjk: 'text-[11px] font-bold tracking-wide',
  /** 內文 */
  body: 'text-[13px] leading-relaxed',
  /** 內文（強調）——裝備名、機師名這類要讀得出來的短字串 */
  bodyStrong: 'text-[14px] font-semibold leading-snug',
  /** 卡片標題 */
  cardTitle: 'text-[16px] font-bold leading-snug',
  /** 區塊標題 */
  sectionTitle: 'text-[20px] font-extrabold tracking-wide leading-tight',

  /** 數值基底：等寬 ＋ 等寬數字。所有 `num*` 都已包含，單獨用於行內小數字 */
  num: 'font-[JetBrains_Mono,monospace] tabular-nums',
  /** 數值 · 小（13px）：列內重量 */
  numSm: 'font-[JetBrains_Mono,monospace] tabular-nums text-[13px]',
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

// ── 可點 ／ 唯讀（使用者要求 2026-08-27：「能點選的功能，外框做出一些差異化」）──
//
// 配裝器裡有兩種長得很像的容器：**點下去會做事的**（槽位格、四部位卡、模組列、武器列）
// 與**純粹在報告狀態的**（效果彙總的每一列）。改版前兩者的差別只有 hover 變色與
// `cursor-pointer` —— 都要先把滑鼠移上去才知道，而手機上根本沒有 hover。
//
// 差異化用**兩件既有語彙**，不加新顏色（052-I 決策一）：
//   ① 框線階：可點用 `border-border`（亮一階）＋ 橘色 hover；唯讀用 `border-border-subtle`、沒有 hover。
//   ② **右緣一個 `›`**（`ActionChevron`）：一個靜態的、不必互動就看得到的記號。
//      這是 hover 補不上的那一半 —— 第一眼就要能分辨。
//
// ⚠ 角標不放右下角：`hud-cut` 系列的切角正好切掉左上與**右下**，放在那裡會被裁掉。

/** 可點的容器。與 `ActionChevron` 一起用 */
export const HUD_ACTIONABLE =
  'border-border bg-bg-dark hover:border-accent-orange/60 hover:bg-bg-card transition-colors cursor-pointer'
/** 唯讀的容器：暗一階的框，且**不要**掛任何 hover —— 會動的東西看起來就像可以點 */
export const HUD_READONLY = 'border-border-subtle bg-bg-dark'

// ── 按鈕 ／ 輸入 ／ 標籤：三種語彙，一條規則（使用者要求 2026-08-27）─────────────
//
// 「請把能輸入資料、能操作按下的功能按鈕樣式，和一般說明做出區別 ——
//   我截圖的部分（機師卡）就看不出哪裡可以按。」
//
// 那張卡上「戰術家 / S / 中型執照」三個**標籤**與「更換機師」這顆**按鈕**，
// 用的是同一套視覺：切角 ＋ 框線 ＋ 深底。四個框排在一起，沒有任何線索指出
// 哪一個按得下去。
//
// ── 規則：**切角 ＝ 可互動，圓角 ＝ 唯讀** ──────────────────────────────────
//
//   `hud-cut-sm`（切角）    按鈕、篩選晶片、輸入框 —— 手指／滑鼠會碰的東西
//   `rounded`（圓角）        標籤、徽章、狀態 chip —— 只負責報告事實
//
// 這條規則之所以可靠，是因為切角本來就是本站 HUD 的**主動語彙**（按鈕、槽位格、
// 面板都用它），而站上既有的徽章元件（`ModuleSlotBadge` / `ModuleRarityBadge`）
// **本來就是 `rounded`** —— 規則不是新發明的，是把已經存在的分野講清楚並補上例外。
//
// 三者另外各有一件只屬於自己的事：
//   按鈕 → **hover 會變**（框線轉橘）＋ `cursor-pointer`
//   輸入 → **底線**（`border-b-2`）＋ focus 時整條轉橘；那是表單欄位的通用語彙
//   標籤 → 什麼都不會動
//
// ⚠ **實心橘**（`HUD_BTN_SOLID`）在本頁只保留給一種東西：**替玩家一次做完好幾步的捷徑**
//   （裝滿 N 格／裝上專武／升級為 X）。一般按鈕不可以用它，否則那個「這是捷徑」的
//   訊號會被稀釋成「這是按鈕」。

/** 一般按鈕（次要動作）：切角 ＋ 亮一階的框 ＋ 比卡片亮的底 ＋ 橘色 hover。 */
export const HUD_BTN =
  'hud-cut-sm border border-border-accent bg-bg-card-hover text-text-primary '
  + 'hover:border-accent-orange/60 hover:text-accent-orange transition-colors cursor-pointer '
  + 'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border-accent disabled:hover:text-text-primary'

/**
 * 主要按鈕（捷徑）：實心橘 ＋ 深色字。**本頁只給「一次做完好幾步」的動作**，見上方 ⚠。
 * 一律搭一顆圖示（`LoadoutIcon name="plus"`）——標籤不會有圖示，那是最短的一句「這是動作」。
 */
export const HUD_BTN_SOLID =
  'hud-cut-sm bg-accent-orange text-bg-dark hover:bg-accent-yellow font-bold '
  + 'shadow-[0_1px_6px_rgba(255,107,43,0.35)] transition-colors cursor-pointer'

/**
 * 破壞性按鈕（卸下／清空）：與 `HUD_BTN` 同一個骨架，只把 hover 換成紅色。
 *
 * ⚠ **不要寫成 `HUD_BTN` ＋ `hover:!text-accent-red`**：Tailwind 的兩條 hover 規則
 *   特異性相同，勝負取決於**產生出來的 CSS 順序**而不是 class 字串的順序 ——
 *   那是一個會隨著別處新增類名而改變結果的賭注。而 v4 的 important 是後綴（`text-red!`），
 *   v3 的前綴寫法在這裡是無效的（站上另一處的 `!px-1.5` 同樣可疑）。
 */
export const HUD_BTN_DANGER =
  'hud-cut-sm border border-border-accent bg-bg-card-hover text-text-secondary '
  + 'hover:border-accent-red/60 hover:text-accent-red transition-colors cursor-pointer'

/**
 * 文字輸入框：切角 ＋ 最深的底 ＋ **2px 底線**，focus 時底線轉橘。
 *
 * ⚠ 底線是它與按鈕唯一的差別（兩者都有切角與框）。少了它，「方案名稱」那一格
 *   看起來就是一顆長按鈕 —— 玩家不會想到可以在裡面打字。
 */
export const HUD_INPUT =
  'hud-cut-sm bg-bg-dark border border-border border-b-2 border-b-border-accent '
  + 'text-text-primary placeholder:text-text-dim '
  + 'focus:border-accent-orange/60 focus:border-b-accent-orange focus:outline-none transition-colors'

/**
 * 唯讀標籤／徽章：**圓角**、不會 hover、沒有游標變化。
 *
 * ⚠ 這一條是本次規則的重點 —— 標籤把切角讓出來，按鈕才有辨識度。
 */
export const HUD_TAG = 'rounded border bg-bg-dark/70'

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
 * 參數收 `string` 而不是 `WeaponEquipSlot`：呼叫端拿到的常常是已經字串化的 `WeaponSlotRef.slot`，
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
export const SHARE_KIND_LABEL: Record<ShareIdKind, string> = {
  pilot: '機師', mech: '機甲', weapon: '武器',
  component: '元件', backpack: '背包', module: '模組',
  // PLAN-052-L D-3。⚠ 型別刻意用 `ShareIdKind` 而不是就地列舉那六個字串：
  //   codec 加第七種實體時，漏翻的症狀是對話框上印出一個 `undefined`。
  pilotSkill: '技能',
}
