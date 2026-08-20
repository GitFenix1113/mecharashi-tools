import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import NavIcon, { type NavIconName } from '../icons/NavIcon'

export interface ContentNavItem {
  to: string
  label: string
  icon: NavIconName
  /** 展開條上的一行說明。只在「疏排」（3 項以內）顯示，密排放不下 */
  desc?: string
}

export interface NavGroup {
  key: string
  label: string
  /** 展開條左欄的副標，例如「3 個檢視」 */
  hint: string
  items: ContentNavItem[]
}

/**
 * 桌面版導覽列的群組觸發鈕（版本情報／資料圖鑑／攻略專區）。
 *
 * 自己不持有展開狀態 —— 全站同一時間只能有一個群組展開，而展開條是掛在 header
 * 下緣的**單一**元素（見 `NavExpandBar`），狀態只能放在共同祖先 `Layout`。
 *
 * `pinned`：這一群的常駐分頁列已經在 header 下方（見 `SubNavTabs`）。
 */
export function NavGroupTrigger({
  group,
  isOpen,
  pinned = false,
  onOpen,
  onToggle,
}: {
  group: NavGroup
  isOpen: boolean
  pinned?: boolean
  onOpen: () => void
  onToggle: () => void
}) {
  const location = useLocation()
  const isActive = group.items.some((item) => location.pathname.startsWith(item.to))

  // 常駐分頁列已經把同一組連結攤在下面一列了，再展開一次是同樣內容出現兩次。
  // 但「按了沒反應的按鈕」比不能按更糟，所以整顆降級成狀態標籤：沒有 ▾、不是
  // button、游標不變手指 —— 它現在的職責只剩「你在這一區」。
  if (pinned) {
    return (
      <span
        aria-current="true"
        className="px-3 py-2 rounded-lg text-sm whitespace-nowrap bg-accent-orange/10 text-accent-orange"
      >
        {group.label}
      </span>
    )
  }

  return (
    <button
      type="button"
      onMouseEnter={onOpen}
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-controls="nav-expand-bar"
      className={`px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap cursor-pointer ${
        isActive || isOpen
          ? 'bg-accent-orange/10 text-accent-orange'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
      }`}
    >
      {group.label}
      <span
        className={`ml-1 inline-block text-[10px] transition-transform duration-200 ${
          isOpen ? 'rotate-180' : ''
        }`}
        aria-hidden="true"
      >
        ▾
      </span>
    </button>
  )
}

/**
 * 導覽列群組的**橫向展開條**：貼在 header 下緣、與 header 同寬的一條，
 * 子項橫向鋪開。
 *
 * 為什麼不是原本的垂直浮層下拉：
 *
 * 1. **遮擋的位置**。垂直浮層蓋住的是內容區左上角，視覺上像一塊彈窗掉在資料上；
 *    橫向條蓋住的是頂端一整條，讀起來是 header 長出來的一段。
 * 2. **可用寬度**。一整條的寬度容得下每個子項配一行說明 ——「灰燼行動」這種站內
 *    術語對第一次進站的人不解釋就是天書，而垂直浮層塞說明會變成一坨。
 * 3. 導覽列本身**沒有變寬**：頂層仍然是「版本情報 ▾」一格，不是把三個檢視平鋪上去。
 *
 * ⚠ **刻意用「覆蓋」而不是「把內容往下推」**：`.viewport-shell`（src/index.css）
 * 把 header 高度硬編成 `3rem`，而版本情報三個檢視正是走那個外殼。展開條若撐高
 * header，那三頁就會多擠出一條文件捲軸 —— 時間線最缺的就是垂直空間。所以這裡是
 * `absolute`，header 的高度自始至終不變。
 */
export default function NavExpandBar({
  group,
  onClose,
}: {
  group: NavGroup | null
  onClose: () => void
}) {
  // 收合時保留最後一次的內容：直接吃 null 的話，動畫會先變成空白條再縮起來。
  // render 期間就地校正（React 官方的 adjusting-state-on-prop-change 寫法），
  // 用 effect 會晚一拍 —— 那一拍剛好是展開動畫的第一幀。
  const [rendered, setRendered] = useState<NavGroup | null>(group)
  if (group && group !== rendered) setRendered(group)

  if (!rendered) return null

  const isOpen = group !== null
  // 4 項以上（圖鑑有 6 個集合）改密排：拿掉說明文字，否則一條塞不下
  const dense = rendered.items.length > 3

  return (
    <div
      id="nav-expand-bar"
      aria-hidden={!isOpen}
      className={`hidden lg:grid absolute top-full inset-x-0 transition-[grid-template-rows,opacity] duration-200 ease-out ${
        isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
      }`}
    >
      {/* grid-rows 0fr→1fr 的高度動畫要靠這層 overflow-hidden 才裁得住 */}
      <div className="min-h-0 overflow-hidden bg-bg-dark border-b border-border-accent shadow-2xl">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-stretch gap-2">
          {/* 固定寬度（而非隨字數自適應）：切換群組時卡片的起始位置才不會左右跳 */}
          <div className="shrink-0 w-28 pr-3 border-r border-border flex flex-col justify-center">
            <span className="text-xs font-bold tracking-wider text-accent-orange whitespace-nowrap">
              {rendered.label}
            </span>
            <span className="text-[10px] text-text-dim">{rendered.hint}</span>
          </div>

          {/* 卡片吃 flex-1 但設上限：不設的話 1920px 寬螢幕上六張卡會被拉成一片空曠的橫幅 */}
          <div className="flex-1 min-w-0 flex gap-1.5">
            {rendered.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                tabIndex={isOpen ? undefined : -1}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex-1 min-w-0 ${dense ? 'max-w-[11rem]' : 'max-w-[18rem]'}
                   flex items-center gap-2.5 rounded-xl border px-3 py-1.5 no-underline transition-colors ${
                    isActive
                      ? 'border-accent-orange/50 bg-accent-orange/10'
                      : 'border-transparent bg-bg-card hover:border-accent-orange/40 hover:bg-bg-card-hover'
                  }`
                }
              >
                <span className="w-7 h-7 shrink-0 rounded-lg bg-accent-orange/10 text-accent-orange grid place-items-center">
                  <NavIcon name={item.icon} className="w-4 h-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-text-primary whitespace-nowrap">
                    {item.label}
                  </span>
                  {!dense && item.desc && (
                    <span className="block text-[11px] text-text-dim truncate">{item.desc}</span>
                  )}
                </span>
              </NavLink>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            tabIndex={isOpen ? undefined : -1}
            aria-label="關閉選單"
            className="shrink-0 self-center w-7 h-7 rounded-lg border border-border text-text-dim
                       hover:text-text-primary hover:border-border-accent transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
