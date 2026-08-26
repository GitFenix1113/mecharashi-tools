import { Outlet, Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { usePageTracking } from '../../hooks/usePageTracking'
import SignedOutBanner from './SignedOutBanner'
import AvatarDisplay from '../profile/AvatarDisplay'
import NavExpandBar, { NavGroupTrigger, type ContentNavItem, type NavGroup } from './NavExpandBar'
import SubNavTabs from './SubNavTabs'
import NavIcon from '../icons/NavIcon'
import EmulatorBadge from './EmulatorBadge'
import { VERSION_VIEWS } from '../versions/VersionViewTabs'

// 友站：英文版 Mecharashi Wiki（對稱其站內指回本站的連結）
const FRIEND_SITE_URL = 'https://mecharashi-wiki.cc/'

type FontSize = 'sm' | 'md' | 'lg'
const FONT_SIZE_MAP: Record<FontSize, string> = { sm: '17px', md: '19px', lg: '21px' }
const FONT_SIZE_LABELS: Record<FontSize, string> = { sm: '小', md: '中', lg: '大' }

// 桌機頂層項目共用的 class（首頁／版本三檢視／配裝模擬器）
const topNavClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-lg text-sm no-underline transition-colors whitespace-nowrap ${
    isActive
      ? 'bg-accent-orange/10 text-accent-orange'
      : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
  }`

// 桌面版直接平鋪的頂層項目（首頁）。桌機頂層只顯示文字，icon 供行動版共用。
const navItems: ContentNavItem[] = [
  { to: '/', label: '首頁', icon: 'home' },
]

// 「資料圖鑑」的子項：桌面版由 header 下緣的橫向展開條呈現，行動版攤平進 More 面板
const catalogNavItems: ContentNavItem[] = [
  { to: '/pilots', label: '機師', icon: 'pilot' },
  { to: '/mechs', label: '機甲', icon: 'mech' },
  { to: '/weapons', label: '武器', icon: 'weapon' },
  { to: '/backpacks', label: '背包', icon: 'backpack' },
  { to: '/modules', label: '模組', icon: 'module' },
  { to: '/components', label: '元件', icon: 'component' },
]

// 「版本情報」的子項（PLAN-050 A-3）。
// 為什麼是獨立群組而不是塞進「攻略/工具/文件 ▾」：版本情報是本站主打內容之一，
// 藏在攻略底下與它的實際份量不對稱；而三個檢視是一組，做成三個頂層項會讓導覽列 +3。
//
// 由 VERSION_VIEWS 推導而不是自己再寫一份：頁內分頁列隱藏之後，這個下拉是三個檢視的
// **唯一**導覽入口（首頁的入口按鈕也讀同一份），三處各寫一份遲早會有一處漏掉。
const versionNavItems: ContentNavItem[] = VERSION_VIEWS.map((v) => ({
  to: v.to,
  label: v.zhLabel,
  icon: v.icon,
  desc: v.desc,
}))

// 配裝模擬器：頂層平鋪項。
// PLAN-052-B E-2 起**全面公開（未登入也能用）**，不再有 ADMIN gate——
// 舊版的 gate 只擋得住導覽，App.tsx 的路由沒有 AdminRoute、ProfilePage 三處入口也對所有
// 登入者開放，實際上是一個只讓人找不到、並未真正限制的半開放狀態。
const simulatorItem: ContentNavItem = { to: '/simulator', label: '配裝模擬器', icon: 'simulator' }

// 「攻略專區」下拉的子項
const contentNavItems: ContentNavItem[] = [
  { to: '/guides', label: '攻略', icon: 'guide', desc: '元件掉落等資料型攻略' },
  { to: '/tools', label: '工具', icon: 'tool', desc: '彩甲規劃器等計算工具' },
  { to: '/documents', label: '文件', icon: 'doc', desc: '開發與資料庫設計文件' },
]

// 桌面版導覽列的三個群組。`hint` 由項目數推導而不是手寫，免得日後加減子項時忘了改。
const versionGroup: NavGroup = {
  key: 'versions', label: '版本情報',
  hint: `${versionNavItems.length} 個檢視`, items: versionNavItems,
}
const catalogGroup: NavGroup = {
  key: 'catalog', label: '資料圖鑑',
  hint: `${catalogNavItems.length} 個集合`, items: catalogNavItems,
}
const guidesGroup: NavGroup = {
  key: 'guides', label: '攻略/工具/文件',
  hint: `${contentNavItems.length} 個入口`, items: contentNavItems,
}
const NAV_GROUPS = [versionGroup, catalogGroup, guidesGroup]

// 常駐分頁列（SubNavTabs）的候選群組：人在哪一群裡，那一群的成員就固定列在 header 下方。
// 首頁與配裝模擬器不屬於任何群組，自然不會長出這條列。
const SUB_NAV_GROUPS: ContentNavItem[][] = [versionNavItems, catalogNavItems, contentNavItems]

const tabBarItems: ContentNavItem[] = [
  { to: '/', label: '首頁', icon: 'home' },
  { to: '/pilots', label: '機師', icon: 'pilot' },
  { to: '/mechs', label: '機甲', icon: 'mech' },
  { to: '/weapons', label: '武器', icon: 'weapon' },
  { to: '/modules', label: '模組', icon: 'module' },
]

const tabBarPaths = new Set(tabBarItems.map((i) => i.to))
// 行動版 More 面板：所有不在底部 Tab Bar 的項目（圖鑑剩餘 + 模擬器 + 攻略專區）
const moreNavItems = [
  ...versionNavItems,
  ...catalogNavItems.filter((item) => !tabBarPaths.has(item.to)),
  simulatorItem,
  ...contentNavItems,
]

export default function Layout() {
  const [moreOpen, setMoreOpen] = useState(false)
  // 桌面版導覽列展開條：同一時間只有一個群組能開，所以狀態在這裡而不在觸發鈕裡
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const closeTimer = useRef<number | null>(null)
  const [fontSize, setFontSize] = useState<FontSize>(
    () => (localStorage.getItem('fontSize') as FontSize) || 'md'
  )
  const { user, userProfile, loading, signOut, openAuthModal } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // 使用統計埋點（PLAN-046）。掛在 Layout：它是所有前台頁面的共同外殼，
  // 一處呼叫即涵蓋全站，新增頁面不需要任何額外接線。
  usePageTracking()

  // 版本情報三分頁是「視窗高度外殼」（.viewport-shell）：頁面自己撐滿可用高度並
  // 自帶捲動容器，再掛 footer 與底部佔位只會硬擠出一條文件捲軸。
  // 首頁在 2026-08-19 站長定案後不再放資料面板，已改回一般文件流，故不在此列。
  const isFullHeightPage = location.pathname.startsWith('/versions')
  // 比對用 `=== to` 或 `to + '/'`：直接 startsWith(to) 會讓 /modules 誤配到未來的
  // /modulesomething，也讓詳情頁（/pilots/xxx）正確落在圖鑑那一群。
  const subNavItems = SUB_NAV_GROUPS.find((items) =>
    items.some((i) => location.pathname === i.to || location.pathname.startsWith(`${i.to}/`))
  )
  const isMoreActive = moreNavItems.some((item) =>
    item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
  )

  useEffect(() => {
    document.documentElement.style.fontSize = FONT_SIZE_MAP[fontSize]
    localStorage.setItem('fontSize', fontSize)
  }, [fontSize])

  useEffect(() => {
    setMoreOpen(false)
    setOpenGroup(null)
  }, [location.pathname])

  // 展開條的滑鼠行為：進入任一觸發鈕就開，離開整個 header（含展開條本身）才關。
  // 延遲 150ms 是給「從按鈕斜著滑到下方卡片」的路徑留餘裕 —— 橫向條比原本的垂直
  // 浮層更遠，沒有這段寬容會一路關給你看。
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])
  const openNavGroup = useCallback((key: string) => {
    cancelClose()
    setOpenGroup(key)
  }, [cancelClose])
  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setOpenGroup(null), 150)
  }, [cancelClose])
  const closeNavGroup = useCallback(() => {
    cancelClose()
    setOpenGroup(null)
  }, [cancelClose])

  useEffect(() => cancelClose, [cancelClose])

  // Esc 關閉：鍵盤使用者沒有「把滑鼠移開」這個動作
  useEffect(() => {
    if (!openGroup) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenGroup(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openGroup])

  const handleSignOut = async () => {
    await signOut()
    navigate('/')
  }

  const initial = (user?.displayName?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()

  return (
    <div
      className="min-h-screen flex flex-col"
      // .viewport-shell 用 100vh 減固定外框算高度，多出來的這條列必須讓它知道
      style={{ '--subnav-h': subNavItems ? '2.25rem' : '0px' } as React.CSSProperties}
    >
      {/* 本地模擬器環境標示（非模擬器模式不渲染任何東西） */}
      <EmulatorBadge />

      {/* Header */}
      <header
        className="sticky top-0 z-50 bg-bg-dark/95 backdrop-blur border-b border-border"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className="max-w-7xl mx-auto px-4 h-12 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 no-underline shrink-0">
            <span className="text-accent-orange font-bold text-xl tracking-wider font-[Orbitron,sans-serif]">
              米赫瑪超吉情豹站
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1 overflow-x-auto">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className={topNavClass}>
                {item.label}
              </NavLink>
            ))}
            {[versionGroup, catalogGroup].map((group) => (
              <NavGroupTrigger
                key={group.key}
                group={group}
                isOpen={openGroup === group.key}
                pinned={subNavItems === group.items}
                onOpen={() => openNavGroup(group.key)}
                onToggle={() => (openGroup === group.key ? closeNavGroup() : openNavGroup(group.key))}
              />
            ))}
            <NavLink to={simulatorItem.to} className={topNavClass}>
              {simulatorItem.label}
            </NavLink>
            <NavGroupTrigger
              group={guidesGroup}
              isOpen={openGroup === guidesGroup.key}
              pinned={subNavItems === guidesGroup.items}
              onOpen={() => openNavGroup(guidesGroup.key)}
              onToggle={() => (openGroup === guidesGroup.key ? closeNavGroup() : openNavGroup(guidesGroup.key))}
            />
            {(userProfile?.role === 'ADMIN' || userProfile?.role === 'OWNER') && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `px-3 py-2 rounded-lg text-sm no-underline transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-accent-purple/15 text-accent-purple'
                      : 'text-accent-purple/70 hover:text-accent-purple hover:bg-accent-purple/10'
                  }`
                }
              >
                後台管理
              </NavLink>
            )}
          </nav>

          {/* User area */}
          <div className="flex items-center gap-2 shrink-0">
            {/* 友站：英文版 Wiki（桌機顯示） */}
            <a
              href={FRIEND_SITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden lg:inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-secondary hover:text-accent-orange border border-border hover:border-accent-orange/40 rounded-lg transition-colors no-underline whitespace-nowrap"
              title="Mecharashi Wiki（英文版友站）"
            >
              EN Wiki ↗
            </a>

            {/* Font size toggle */}
            <div className="flex items-center bg-bg-card border border-border rounded-lg overflow-hidden">
              {(['sm', 'md', 'lg'] as const).map((size) => (
                <button
                  key={size}
                  onClick={() => setFontSize(size)}
                  className={`px-2 py-1 text-xs transition-colors cursor-pointer ${
                    fontSize === size
                      ? 'bg-accent-orange/20 text-accent-orange'
                      : 'text-text-dim hover:text-text-secondary'
                  }`}
                >
                  {FONT_SIZE_LABELS[size]}
                </button>
              ))}
            </div>

            {/* Auth — loading 時用固定尺寸佔位，避免版面偏移 */}
            {loading ? (
              <div className="w-8 h-8 rounded-full bg-bg-card animate-pulse" />
            ) : user ? (
              <div className="flex items-center gap-2">
                <NavLink
                  to="/profile"
                  className={({ isActive }) =>
                    `w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border transition-colors no-underline ${
                      isActive
                        ? 'bg-accent-orange text-white border-accent-orange'
                        : 'bg-accent-orange/20 text-accent-orange border-accent-orange/40 hover:bg-accent-orange/30'
                    }`
                  }
                  title={user.displayName ?? user.email ?? '個人中心'}
                >
                  {userProfile ? (
                    <AvatarDisplay profile={userProfile} size="sm" />
                  ) : (
                    initial
                  )}
                </NavLink>
                <button
                  onClick={handleSignOut}
                  className="hidden lg:block text-xs text-text-dim hover:text-text-secondary transition-colors cursor-pointer"
                >
                  登出
                </button>
              </div>
            ) : (
              <>
                {/* Desktop: 完整按鈕 */}
                <button
                  onClick={openAuthModal}
                  className="hidden lg:inline-flex px-3 py-1.5 text-xs bg-accent-orange/10 text-accent-orange border border-accent-orange/30 rounded-lg hover:bg-accent-orange/20 transition-colors cursor-pointer whitespace-nowrap"
                >
                  登入 / 註冊
                </button>
                {/* Mobile: 圖示按鈕，寬度固定不會跳動 */}
                <button
                  onClick={openAuthModal}
                  className="lg:hidden w-8 h-8 rounded-full flex items-center justify-center bg-accent-orange/10 text-accent-orange border border-accent-orange/30 hover:bg-accent-orange/20 transition-colors cursor-pointer"
                  aria-label="登入 / 註冊"
                >
                  <NavIcon name="key" className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* 群組內的常駐分頁列：人已經在這一群裡，換頁不必再 hover 展開條 */}
        {subNavItems && <SubNavTabs items={subNavItems} />}

        {/* 群組展開條：absolute 掛在 header 下緣（含分頁列），header 高度不變 */}
        <NavExpandBar
          group={NAV_GROUPS.find((g) => g.key === openGroup) ?? null}
          onClose={closeNavGroup}
        />
      </header>

      {/* 非預期登出橫幅（PLAN-045）。放在 header 與 main 之間、不進 main 的
          overflow-hidden 容器——首頁的 snap 捲動會把它藏起來。 */}
      <SignedOutBanner />

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>

      {/* Footer — 版本情報三分頁自帶版面高度，不掛 footer */}
      {!isFullHeightPage && <footer className="border-t border-border py-6 text-center text-text-dim text-sm">
        <p>米赫瑪超吉情豹站 — Milkhama PawInfo Station</p>
        <p className="mt-1">本站是氣吉敗壞的豹吉自己摸出來的，無營利，完全免費，與官方無關，但99%圖片資源都來源於官方WIKI</p>
      </footer>}

      {/* 手機底部 Tab Bar 佔位 — 防止 footer 被 fixed bar 遮住 */}
      {!isFullHeightPage && (
        <div
          className="lg:hidden shrink-0"
          style={{ height: 'calc(3.5rem + env(safe-area-inset-bottom))' }}
          aria-hidden="true"
        />
      )}

      {/* More Panel 背景遮罩 */}
      {moreOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* More Panel（從底部 Tab Bar 上方滑出） */}
      <div
        className={`lg:hidden fixed inset-x-0 z-50 bg-bg-dark border-t border-border-accent rounded-t-2xl shadow-2xl transition-transform duration-300 ${
          moreOpen ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
        style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom))' }}
        aria-hidden={!moreOpen}
      >
        {/* 拖曳把手 */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-border-accent" />
        </div>

        {/* 導航格線 */}
        <div className="grid grid-cols-3 gap-2 px-4 pb-2">
          {moreNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1.5 py-3 rounded-xl text-center transition-colors no-underline ${
                  isActive
                    ? 'bg-accent-orange/10 text-accent-orange'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
                }`
              }
            >
              <NavIcon name={item.icon} className="w-6 h-6" />
              <span className="text-xs">{item.label}</span>
            </NavLink>
          ))}
        </div>

        {/* 友站：英文版 Wiki（手機版 More Panel） */}
        <div className="border-t border-border px-4 py-2">
          <a
            href={FRIEND_SITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMoreOpen(false)}
            className="flex items-center justify-center gap-2 w-full py-2 text-sm text-center rounded-lg transition-colors no-underline text-text-secondary hover:text-accent-orange hover:bg-bg-card"
          >
            <NavIcon name="globe" className="w-4 h-4" />
            EN Wiki（英文版友站）↗
          </a>
        </div>

        {/* Admin 入口（手機版 More Panel） */}
        {(userProfile?.role === 'ADMIN' || userProfile?.role === 'OWNER') && (
          <div className="border-t border-border px-4 py-2">
            <NavLink
              to="/admin"
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                `flex items-center justify-center gap-2 w-full py-2 text-sm text-center rounded-lg transition-colors no-underline ${
                  isActive
                    ? 'bg-accent-purple/15 text-accent-purple'
                    : 'text-accent-purple/70 hover:text-accent-purple hover:bg-accent-purple/10'
                }`
              }
            >
              <NavIcon name="admin" className="w-4 h-4" />
              後台管理
            </NavLink>
          </div>
        )}

        {/* 登入/登出區 */}
        <div className="border-t border-border px-4 py-3">
          {!loading && (
            user ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-text-secondary truncate flex-1">
                  {user.displayName ?? user.email}
                </span>
                <button
                  onClick={() => { setMoreOpen(false); handleSignOut() }}
                  className="text-xs px-3 py-1.5 rounded-lg border border-border text-text-dim hover:text-text-secondary cursor-pointer"
                >
                  登出
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setMoreOpen(false); openAuthModal() }}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium bg-accent-orange/10 text-accent-orange border border-accent-orange/30 hover:bg-accent-orange/20 transition-colors cursor-pointer"
              >
                <NavIcon name="key" className="w-4 h-4" />
                登入 / 註冊
              </button>
            )
          )}
        </div>
      </div>

      {/* 手機底部 Tab Bar */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-bg-dark/95 backdrop-blur border-t border-border"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-stretch h-14">
          {tabBarItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors no-underline ${
                  isActive ? 'text-accent-orange' : 'text-text-dim hover:text-text-primary'
                }`
              }
            >
              <NavIcon name={item.icon} className="w-5 h-5" />
              <span className="text-[10px] leading-none">{item.label}</span>
            </NavLink>
          ))}

          {/* 更多按鈕 */}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
              moreOpen || isMoreActive ? 'text-accent-orange' : 'text-text-dim hover:text-text-primary'
            }`}
          >
            <NavIcon name="menu" className="w-5 h-5" />
            <span className="text-[10px] leading-none">更多</span>
          </button>
        </div>
      </nav>
    </div>
  )
}
