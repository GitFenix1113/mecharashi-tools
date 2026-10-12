// 機師職業的單一來源 —— PLAN-059 B-1
//
// 職業 → 官方圖示是固定對照，寫在程式、不進 DB（決策二）：職業是 enum、圖示由職業唯一決定，
// 官方資料零例外（pilots.biometicComputer[0].icon＝職業單元的圖示，82／82 位與 class 一致，010 只有海莉絲）。
//
// ⚠ 順序＝遊戲內篩選畫面的順序（站長 2026-10-13 截圖）：守護者在機械師**前面**，
//   和圖示編號（005 機械師、006 守護者）相反——以遊戲畫面為準，不要照編號重排。
// ⚠ 色類名逐字寫完整：Tailwind v4 只產生原始碼裡出現過的類名，`bg-accent-${c}` 這種拼接會靜默失效。
// ⚠ 圖示是白色字形，讀取端用 CSS mask 吃 currentColor（components/icons/ClassIcon.tsx），不要直接 <img>。
// ⚠ 新職業上線時：`import-game-assets.mjs --emblems` 只把圖放進圖庫，這裡要人補一列（哪個編號是哪個職業）。

import { PilotClass } from '../types/enums.ts'

export interface PilotClassMeta {
  /** DB 存的值（pilots.class） */
  name: PilotClass
  /** 全球版英文名（站長提供）。只在詳情頁 hero 當裝飾字 */
  en: string
  /** false＝全球版還沒有這個職業，英文是暫用的非官方譯名 */
  enOfficial: boolean
  /** 官方圖示編號：Icon_pilotclass_<icon>_{l,s} */
  icon: string
  /** 文字色（圖示也吃這個色） */
  text: string
  /** 淡底 */
  bg: string
  /** 框線 */
  border: string
  /** 較實的框線（圓章外圈：疊在立繪上要看得出職業色） */
  borderStrong: string
  /** 實心色條（清單左緣、分組標題） */
  bar: string
}

export const PILOT_CLASSES: readonly PilotClassMeta[] = [
  { name: PilotClass.FIGHTER,     en: 'Fighter',   enOfficial: true,  icon: '001', text: 'text-accent-red',    bg: 'bg-accent-red/10',    border: 'border-accent-red/40',    borderStrong: 'border-accent-red/70',       bar: 'bg-accent-red' },
  { name: PilotClass.ASSAULT,     en: 'Raider',    enOfficial: true,  icon: '002', text: 'text-accent-orange', bg: 'bg-accent-orange/10', border: 'border-accent-orange/40', borderStrong: 'border-accent-orange/70', bar: 'bg-accent-orange' },
  { name: PilotClass.SNIPER,      en: 'Sniper',    enOfficial: true,  icon: '003', text: 'text-accent-blue',   bg: 'bg-accent-blue/10',   border: 'border-accent-blue/40',   borderStrong: 'border-accent-blue/70',     bar: 'bg-accent-blue' },
  { name: PilotClass.TACTICIAN,   en: 'Tactician', enOfficial: true,  icon: '004', text: 'text-accent-purple', bg: 'bg-accent-purple/10', border: 'border-accent-purple/40', borderStrong: 'border-accent-purple/70', bar: 'bg-accent-purple' },
  { name: PilotClass.GUARDIAN,    en: 'Guardian',  enOfficial: true,  icon: '006', text: 'text-accent-green',  bg: 'bg-accent-green/10',  border: 'border-accent-green/40',  borderStrong: 'border-accent-green/70',   bar: 'bg-accent-green' },
  { name: PilotClass.ENGINEER,    en: 'Machinist', enOfficial: true,  icon: '005', text: 'text-accent-cyan',   bg: 'bg-accent-cyan/10',   border: 'border-accent-cyan/40',   borderStrong: 'border-accent-cyan/70',     bar: 'bg-accent-cyan' },
  // 全球版尚未推出調構師（2026-10），Shifter 是 EN Wiki 作者的譯名；全球版上線後換成官方名、enOfficial 改 true
  { name: PilotClass.CONSTRUCTOR, en: 'Shifter',   enOfficial: false, icon: '010', text: 'text-accent-yellow', bg: 'bg-accent-yellow/10', border: 'border-accent-yellow/40', borderStrong: 'border-accent-yellow/70', bar: 'bg-accent-yellow' },
]

/** 職業名，遊戲內順序（篩選列、分組、後台下拉） */
export const PILOT_CLASS_NAMES: readonly PilotClass[] = PILOT_CLASSES.map((c) => c.name)

const BY_NAME = new Map<string, PilotClassMeta>(PILOT_CLASSES.map((c) => [c.name, c]))

/** 職業名 → 對照；認不得（空值、日後的新職業還沒補）回 undefined，呼叫端自己退回中性樣式 */
export function pilotClassMeta(name: string | null | undefined): PilotClassMeta | undefined {
  return name ? BY_NAME.get(name) : undefined
}

/** 職業圖示的官方檔名。size：'l'＝340²（刮痕質感，給 ≥32px）、's'＝72×80（線條乾淨，給小圖） */
export function pilotClassIconKey(name: string | null | undefined, size: 'l' | 's'): string | undefined {
  const meta = pilotClassMeta(name)
  return meta ? `Icon_pilotclass_${meta.icon}_${size}` : undefined
}

/** 徽章用的「文字色 淡底 框線」三件一組；認不得的職業給中性樣式 */
export function pilotClassBadgeClass(name: string | null | undefined): string {
  const meta = pilotClassMeta(name)
  return meta ? `${meta.text} ${meta.bg} ${meta.border}` : 'text-text-secondary bg-bg-card border-border'
}
