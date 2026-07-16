import type { ReactNode, SVGProps } from 'react'

/**
 * 站內導覽用的單色線性 icon 集。
 *
 * 設計取捨：
 * - `fill="none"` + `stroke="currentColor"`：icon 直接繼承外層 NavLink 的 text color，
 *   因此 active 態（text-accent-orange）會連同 icon 一起變橘。原本的 emoji 是圖片字形，
 *   永遠停在自己的顏色，這是換掉它最主要的理由。
 * - `strokeWidth={1.6}`：比 lucide 預設的 2 細一點，配 Noto Sans TC 的字重比較合。
 * - 不裝 icon library：全站只用到十來顆，自繪 = 0 依賴、0 bundle 成本，
 *   也和既有的 ViewModeToggle.tsx（inline SVG + currentColor）同一種寫法。
 *
 * 繪製規範：viewBox 24×24、視覺重心置中、四周留約 2px 淨空。
 * 機師（圓弧盔體）與機甲（稜角 + V 字額冠 + 側耳）刻意做出剪影區隔——
 * 兩者都是「頭」，若都畫成圓形加橫槓，在 17px 下會分不出來。
 */
export type NavIconName =
  | 'home'
  | 'pilot'
  | 'mech'
  | 'weapon'
  | 'backpack'
  | 'module'
  | 'component'
  | 'simulator'
  | 'guide'
  | 'tool'
  | 'doc'
  | 'admin'
  | 'key'
  | 'globe'
  | 'menu'

const PATHS: Record<NavIconName, ReactNode> = {
  // 首頁：屋頂 + 門
  home: (
    <>
      <path d="M4 10.6 12 4l8 6.6V19a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 19z" />
      <path d="M9.6 20.4v-6h4.8v6" />
    </>
  ),
  // 機師：飛行員頭盔（圓弧盔體 + 面罩 + 頂端天線）
  pilot: (
    <>
      <path d="M5 12.5a7 7 0 0 1 14 0v3.9a2.6 2.6 0 0 1-2.6 2.6H7.6A2.6 2.6 0 0 1 5 16.4z" />
      <path d="M7.6 11.2h8.8v2.6a1.8 1.8 0 0 1-1.8 1.8H9.4a1.8 1.8 0 0 1-1.8-1.8z" />
      <path d="M12 5.5V3.2" />
    </>
  ),
  // 機甲：稜角盔體 + V 字額冠 + 單眼掃描槽 + 兩側耳翼
  mech: (
    <>
      <path d="M8 6.6h8v6.2l-1.7 2.6H9.7L8 12.8z" />
      <path d="M12 6.6 10.1 3.4h3.8z" />
      <path d="M9.9 10.2h4.2" />
      <path d="M8 7.8H5.5v3.4H8M16 7.8h2.5v3.4H16" />
    </>
  ),
  // 武器：光束步槍側影（機匣 + 槍管 + 瞄具 + 握把）
  weapon: (
    <>
      <path d="M3.8 10.4h11.4v3.2H3.8z" />
      <path d="M15.2 11.4h5" />
      <path d="M7.2 10.4V8.6h3.6v1.8" />
      <path d="M6.4 13.6v2.2l-2 1.8" />
    </>
  ),
  // 背包：推進背包（本體 + 雙噴口 + 尾焰）
  backpack: (
    <>
      <rect x="7" y="4" width="10" height="8.6" rx="1" />
      <path d="M12 4v8.6" />
      <path d="M8.6 12.6h2.2l.8 3.8H7.8z" />
      <path d="M13.2 12.6h2.2l.8 3.8h-3.8z" />
      <path d="M9.4 18.2v2M14.6 18.2v2" />
    </>
  ),
  // 模組：晶片（本體 + 核心 + 八支針腳）
  module: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="1.6" />
      <rect x="10.4" y="10.4" width="3.2" height="3.2" rx="0.6" />
      <path d="M9.6 7V4.6M14.4 7V4.6M9.6 17v2.4M14.4 17v2.4" />
      <path d="M7 9.6H4.6M7 14.4H4.6M17 9.6h2.4M17 14.4h2.4" />
    </>
  ),
  // 元件：六角零件（外六角 + 內六角）
  component: (
    <>
      <path d="M12 3.4 20 8v8l-8 4.6L4 16V8z" />
      <path d="M12 8.6 15.6 10.6v3.8L12 16.4 8.4 14.4v-3.8z" />
    </>
  ),
  // 配裝模擬器：中央核心 + 四向插槽（裝配的意象）
  simulator: (
    <>
      <rect x="9" y="9" width="6" height="6" rx="1.2" />
      <rect x="9" y="2.6" width="6" height="3.6" rx="1" />
      <rect x="9" y="17.8" width="6" height="3.6" rx="1" />
      <rect x="2.6" y="9" width="3.6" height="6" rx="1" />
      <rect x="17.8" y="9" width="3.6" height="6" rx="1" />
      <path d="M12 6.2V9M12 15v2.8M6.2 12H9M15 12h2.8" />
    </>
  ),
  // 攻略：攤開的書
  guide: (
    <>
      <path d="M4 5.2h5.2A2.8 2.8 0 0 1 12 8v11a2.4 2.4 0 0 0-2.4-2.4H4z" />
      <path d="M20 5.2h-5.2A2.8 2.8 0 0 0 12 8v11a2.4 2.4 0 0 1 2.4-2.4H20z" />
    </>
  ),
  // 工具：扳手
  tool: (
    <>
      <path d="M14.8 6.6a3.8 3.8 0 0 0 4.9 4.9l-8 8a2.6 2.6 0 0 1-3.7-3.7z" />
      <path d="M17.4 4.2 19.8 6.6" />
    </>
  ),
  // 文件：帶摺角的頁面
  doc: (
    <>
      <path d="M6 3.6h7.6L18.4 8.4V20.4H6z" />
      <path d="M13.6 3.6v4.8h4.8" />
      <path d="M9 13h6.4M9 16.4h6.4" />
    </>
  ),
  // 後台管理：調節滑桿（與「工具」的扳手區隔開）
  admin: (
    <>
      <path d="M4 8h4.8M13.6 8H20M4 16h6.4M15.2 16H20" />
      <circle cx="11.2" cy="8" r="2.4" />
      <circle cx="12.8" cy="16" r="2.4" />
    </>
  ),
  // 登入：鑰匙
  key: (
    <>
      <circle cx="7.6" cy="16.4" r="3.6" />
      <path d="M10.2 13.8 20.4 3.6" />
      <path d="M17 7l2.4 2.4" />
      <path d="M14.6 9.4 17 11.8" />
    </>
  ),
  // 友站：地球
  globe: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M3.6 12h16.8" />
      <path d="M12 3.6a12.8 12.8 0 0 1 0 16.8 12.8 12.8 0 0 1 0-16.8z" />
    </>
  ),
  // 更多：三橫線（取代原本的純文字符號 ≡，避免不同字體下粗細不一）
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
}

export default function NavIcon({
  name,
  className = 'w-4 h-4',
  ...rest
}: { name: NavIconName } & SVGProps<SVGSVGElement>) {
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
