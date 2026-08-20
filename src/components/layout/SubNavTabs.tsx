import { NavLink } from 'react-router-dom'
import NavIcon from '../icons/NavIcon'
import type { ContentNavItem } from './NavExpandBar'

/**
 * 群組內的常駐分頁列：人已經在版本情報區（或圖鑑、攻略區）時，切換同群組的其他頁面
 * 不必再把滑鼠移上導覽列、等橫向展開條出來、再從裡面挑一個。
 *
 * 與 `NavExpandBar` 的分工：**展開條管「怎麼進來」，這條管「進來之後怎麼換」**。
 * 兩者資料同源（`Layout` 的那幾份 `ContentNavItem[]`），不會有一邊漏改的問題。
 *
 * ⚠ 高度寫死 `h-9`（2.25rem），且與 `index.css` 的 `--subnav-h` **必須一致** ——
 * `.viewport-shell` 是 `100vh` 減掉固定外框算出來的，版本情報三個檢視都走那個外殼，
 * 這條列若沒被扣掉就會硬擠出一條文件捲軸。改高度時兩邊要一起改。
 */
export default function SubNavTabs({ items }: { items: ContentNavItem[] }) {
  return (
    <div className="h-9 shrink-0 border-b border-border bg-bg-dark/95">
      {/*
        overflow-y-hidden 是必要的，不是保險：`overflow-x: auto` 會把另一軸一併算成
        auto（CSS 規定），而下面每個 tab 的 `-mb-px` 讓內容比容器高 1px —— 那 1px
        足以在右側冒出一整條垂直捲軸（實測吃掉 15px 寬）。這裡要的正是把它裁掉：
        active 的橘色底線就該壓在容器的灰色下框線上。

        捲軸本身也藏起來（沿用 VersionRail 的做法）：窄視窗放不下六個 tab 時會出現
        水平捲軸，而它會從這條 43px 的列裡再吃掉 15px 高度，字就被切一半。
        捲動仍然可用，只是不畫出來。
      */}
      <div
        className="max-w-7xl mx-auto h-full px-4 flex items-stretch gap-0.5
                   overflow-x-auto overflow-y-hidden
                   [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-3 text-xs whitespace-nowrap no-underline
               border-b-2 -mb-px transition-colors ${
                 isActive
                   ? 'border-accent-orange text-text-primary'
                   : 'border-transparent text-text-dim hover:text-text-primary'
               }`
            }
          >
            <NavIcon name={item.icon} className="w-3.5 h-3.5 shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </div>
    </div>
  )
}
