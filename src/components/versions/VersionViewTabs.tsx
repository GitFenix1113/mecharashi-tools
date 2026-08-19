import { NavLink, useLocation } from 'react-router-dom'
import type { NavIconName } from '../icons/NavIcon'

/**
 * 版本情報三個檢視的分頁列（PLAN-050 A-2）。
 *
 * 這條 tab bar 從 PLAN-015 起就存在於首頁面板裡，原本由 `useState<TabId>` 驅動；
 * 現在是 **route 驅動**，每個 tab 是真正的連結（NavLink），指向
 * `/versions/quick｜grayops｜timeline`。外觀維持不變，但一次拿到深連結、上一頁、
 * Ctrl+F 與 PLAN-046 的分流統計（改動前三個檢視全部記成 `/`，
 * 「Gray Ops 到底有沒有人看」無從得知）。
 *
 * `VERSION_VIEWS` 同時供首頁的入口連結使用 —— 首頁自己不再放任何版本資料，
 * 但要有地方讓人點進來。
 *
 * ⚠ **分頁列本身目前沒有被渲染**（2026-08-19 站長指示隱藏）：導覽列的
 * 「版本情報 ▾」下拉已是三個檢視的入口，頁內再放一條等於同一組導覽出現兩次，
 * 而它吃掉的是 Timeline 最缺的垂直空間。元件保留是為了隨時能加回
 * `VersionsLayout` 一行就復原；`VERSION_VIEWS` 則仍在使用中。
 */

export type VersionViewId = 'quick' | 'grayops' | 'timeline'

export const VERSION_VIEWS: {
  id: VersionViewId
  /** 分頁列用的英文標籤（目前分頁列未渲染，留給日後恢復） */
  label: string
  zhLabel: string
  to: string
  icon: NavIconName
}[] = [
  { id: 'quick',    label: 'Quick Table', zhLabel: '版本速覽',   to: '/versions/quick',    icon: 'table' },
  { id: 'grayops',  label: 'Gray Ops',    zhLabel: '灰燼行動',   to: '/versions/grayops',  icon: 'target' },
  { id: 'timeline', label: 'Timeline',    zhLabel: '版本時間線', to: '/versions/timeline', icon: 'timeline' },
]

export default function VersionViewTabs() {
  const { pathname } = useLocation()
  const active = VERSION_VIEWS.find(v => pathname.startsWith(v.to))?.id

  return (
    <div className="flex items-stretch border-b border-border shrink-0">
      {VERSION_VIEWS.map(view => (
        <NavLink
          key={view.id}
          to={view.to}
          className={`px-5 py-1.5 text-lg font-[Orbitron,sans-serif] tracking-wider transition-colors cursor-pointer border-b-2 -mb-px no-underline ${
            active === view.id
              ? 'border-accent-orange text-text-primary'
              : 'border-transparent text-text-dim hover:text-text-primary'
          }`}
        >
          {view.label}
        </NavLink>
      ))}

    </div>
  )
}
