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
 * ⚠ **分頁列本身沒有被渲染，而且不要再加回來**（2026-08-19 站長指示隱藏）。
 * 這個角色在 2026-08-20 由 `components/layout/SubNavTabs` 接手：改貼在 header 下方，
 * 版本情報／圖鑑／攻略三群共用同一套，而且它的高度有被 `.viewport-shell` 的
 * `--subnav-h` 扣掉 —— 當初把頁內分頁列拿掉的理由（吃掉 Timeline 最缺的垂直空間、
 * 且會多擠出一條文件捲軸）在那邊已經解掉了，這裡再放一條就是同一組導覽出現兩次。
 * 元件本體留著只為了 `VERSION_VIEWS`（首頁入口與導覽列都讀它）。
 */

export type VersionViewId = 'quick' | 'grayops' | 'timeline'

export const VERSION_VIEWS: {
  id: VersionViewId
  /** 分頁列用的英文標籤（目前分頁列未渲染，留給日後恢復） */
  label: string
  zhLabel: string
  to: string
  icon: NavIconName
  /** 導覽列橫向展開條上的一行說明（見 NavExpandBar）；分頁列與首頁入口不使用 */
  desc: string
}[] = [
  { id: 'quick',    label: 'Quick Table', zhLabel: '版本速覽',   to: '/versions/quick',    icon: 'table',    desc: '各版本新增機師與機甲一覽' },
  { id: 'grayops',  label: 'Gray Ops',    zhLabel: '灰燼行動',   to: '/versions/grayops',  icon: 'target',   desc: '未來登場機甲的四公司名單' },
  { id: 'timeline', label: 'Timeline',    zhLabel: '版本時間線', to: '/versions/timeline', icon: 'timeline', desc: '卡池與活動檔期甘特圖' },
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
