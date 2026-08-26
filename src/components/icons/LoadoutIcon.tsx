import type { ReactNode, SVGProps } from 'react'

/**
 * 配裝模擬器專用的描邊 icon 集（PLAN-052-I A-2）。
 *
 * 換掉什麼：`SlotCell` 原本用 `🔒`（鎖定）、`▨`（無槽）、`＋`（空槽）、`✕`（卸下）
 * 四個**字符**當圖示。字符有三個治不好的毛病：
 *   1. 不同系統／字體的字形不一致 —— `▨` 在 Windows 上是實心方塊、macOS 上是斜線網格；
 *      `🔒` 更是彩色 emoji 字形，在深色 HUD 上是一顆突兀的黃色貼紙。
 *   2. **跟不上配色**。emoji 永遠停在自己的顏色，六態改版要求「圖示隨態變色」做不到。
 *   3. 調不了線寬，與 NavIcon 那組 1.6px 描邊擺在同一頁會粗細打架。
 *
 * 繪製規範（沿用 `NavIcon.tsx`，兩組要能擺在一起）：
 *   · viewBox 24×24、`fill="none"` ＋ `stroke="currentColor"` —— 顏色由外層 text color 決定。
 *   · `strokeWidth={1.6}`，四周留約 2px 淨空。
 *   · 實際渲染尺寸 16px（列內、徽章）或 20px（槽位格的圖示方塊）。
 *
 * ⚠ 左右手刻意畫成**兩份鏡像路徑**而不是 `scale(-1,1)` 翻轉：
 *   翻轉會連 `strokeLinecap` 的視覺重心一起翻，在 16px 下槍口那一端會看起來偏一格。
 *
 * ⚠ `absent`（無槽）與 `close`（卸下）是同一個 ✕ 字形，這是刻意的：
 *   兩者永遠不會出現在同一格上（無槽格沒有卸下鍵），而**態的差異走外框與底色**
 *   （計畫書決策五：六態只走邊框樣式／底色／圖示三個維度）。
 */
export type LoadoutIconName =
  | 'handLeft'
  | 'handRight'
  | 'dualHand'
  | 'shoulder'
  | 'back'
  | 'backpack'
  | 'lock'
  | 'lockForm'
  | 'absent'
  | 'close'
  | 'plus'
  | 'gear'

const PATHS: Record<LoadoutIconName, ReactNode> = {
  // 左手：槍身朝左的側影（機匣 ＋ 槍管 ＋ 下掛握把）
  handLeft: (
    <>
      <path d="M3 13h11l6-3-6-3H3z" />
      <path d="M3 17h8" />
    </>
  ),
  // 右手：handLeft 的鏡像（不是翻轉，見檔首說明）
  handRight: (
    <>
      <path d="M21 13H10l-6-3 6-3h11z" />
      <path d="M21 17h-8" />
    </>
  ),
  // 雙手：置中的重型機匣 ＋ 左右各一支握把（「兩隻手都佔住」）
  dualHand: (
    <>
      <path d="M6 8.5h12v5H6z" />
      <path d="M2.6 11h3.4M18 11h3.4" />
      <path d="M9 13.5v3.4M15 13.5v3.4" />
    </>
  ),
  // 肩部：肩掛發射器（本體 ＋ 前端錐 ＋ 兩支朝上的發射管）
  shoulder: (
    <>
      <path d="M5 8h9l5 4-5 4H5z" />
      <path d="M8 4v3M12 4v3" />
    </>
  ),
  // 背部武器：中央掛載本體 ＋ 左右外張的掛架板
  back: (
    <>
      <path d="M9.4 4.6h5.2v14.8H9.4z" />
      <path d="M9.4 8 5.8 10v5.6l3.6-2M14.6 8l3.6 2v5.6l-3.6-2" />
    </>
  ),
  // 背包：推進背包（本體 ＋ 雙噴口 ＋ 尾焰）—— 與 NavIcon 的 backpack 同一個剪影，
  // 站上「背包」到哪裡都長一樣
  backpack: (
    <>
      <rect x="7" y="4" width="10" height="8.6" rx="1" />
      <path d="M12 4v8.6" />
      <path d="M8.6 12.6h2.2l.8 3.8H7.8z" />
      <path d="M13.2 12.6h2.2l.8 3.8h-3.8z" />
      <path d="M9.4 18.2v2M14.6 18.2v2" />
    </>
  ),
  // 鎖定（機甲固定武裝）：閉合的掛鎖
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  // 形態鎖定：掛鎖 ＋ 鎖孔。與 `lock` 同色同形，差在鎖孔 ——
  // 形態鎖是「換個形態就解得開」的可行動資訊，跟永遠拆不掉的固定武裝不是同一件事
  lockForm: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <path d="M12 14.6v2.2" />
    </>
  ),
  // 無槽：✕（外框走虛線＋斜紋底，見檔首說明）
  absent: <path d="M6 6l12 12M18 6 6 18" />,
  // 卸下：同一個 ✕
  close: <path d="M6 6l12 12M18 6 6 18" />,
  // 空槽：加號
  plus: <path d="M12 5v14M5 12h14" />,
  // 元件：齒輪（PLAN-052-D）。總綱決策十二逐字「右下 ⚙ 徽章點＝開元件挑選器」——
  // 用描邊圖示而不是 ⚙ 字符：字符在不同系統上字形不一致，也沒辦法跟著配色走（052-I 的既定方向）
  gear: (
    <>
      <circle cx="12" cy="12" r="4.4" />
      <path d="M12 4.2v3.6M12 19.8v-3.6M4.2 12h3.6M19.8 12h-3.6M6.5 6.5l2.6 2.6M17.5 17.5l-2.6-2.6M17.5 6.5l-2.6 2.6M6.5 17.5l2.6-2.6" />
    </>
  ),
}

export default function LoadoutIcon({
  name,
  className = 'w-[18px] h-[18px]',
  ...rest
}: { name: LoadoutIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}

export { LoadoutIcon }
