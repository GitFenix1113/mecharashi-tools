import { Outlet, Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { usePageTracking } from '../hooks/usePageTracking'
import SignedOutBanner from './SignedOutBanner'
import AvatarDisplay from './profile/AvatarDisplay'
import ContentNavDropdown, { type ContentNavItem } from './ContentNavDropdown'
import NavIcon from './icons/NavIcon'
import EmulatorBadge from './EmulatorBadge'

// 友站：英文版 Mecharashi Wiki（對稱其站內指回本站的連結）
const FRIEND_SITE_URL = 'https://mecharashi-wiki.cc/'

type FontSize = 'sm' | 'md' | 'lg'
const FONT_SIZE_MAP: Record<FontSize, string> = { sm: '17px', md: '19px', lg: '21px' }
const FONT_SIZE_LABELS: Record<FontSize, string> = { sm: '小', md: '中', lg: '大' }

// 桌面版直接平鋪的頂層項目（首頁）。桌機頂層只顯示文字，icon 供行動版共用。
const navItems: ContentNavItem[] = [
  { to: '/', label: '首頁', icon: 'home' },
]

// 「資料圖鑑」下拉的子項：桌面版以 ContentNavDropdown 懸停展開，行動版攤平進 More 面板
const catalogNavItems: ContentNavItem[] = [
  { to: '/pilots', label: '機師', icon: 'pilot' },
  { to: '/mechs', label: '機甲', icon: 'mech' },
  { to: '/weapons', label: '武器', icon: 'weapon' },
  { to: '/backpacks', label: '背包', icon: 'backpack' },
  { to: '/modules', label: '模組', icon: 'module' },
  { to: '/components', label: '元件', icon: 'component' },
]

// 配裝模擬器：頂層平鋪項，僅管理員可見
const simulatorItem: ContentNavItem = { to: '/simulator', label: '配裝模擬器', icon: 'simulator' }

// 「攻略專區」下拉的子項
const contentNavItems: ContentNavItem[] = [
  { to: '/guides', label: '攻略', icon: 'guide' },
  { to: '/tools', label: '工具', icon: 'tool' },
  { to: '/documents', label: '文件', icon: 'doc' },
]

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
  ...catalogNavItems.filter((item) => !tabBarPaths.has(item.to)),
  simulatorItem,
  ...contentNavItems,
]

export default function Layout() {
  const [moreOpen, setMoreOpen] = useState(false)
  const [fontSize, setFontSize] = useState<FontSize>(
    () => (localStorage.getItem('fontSize') as FontSize) || 'md'
  )
  const { user, userProfile, loading, signOut, openAuthModal } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // 使用統計埋點（PLAN-046）。掛在 Layout：它是所有前台頁面的共同外殼，
  // 一處呼叫即涵蓋全站，新增頁面不需要任何額外接線。
  usePageTracking()

  const isHome = location.pathname === '/'
  const isAdmin = userProfile?.role === 'ADMIN' || userProfile?.role === 'OWNER'
  const visibleMoreNavItems = moreNavItems.filter((item) => item.to !== '/simulator' || isAdmin)
  const isMoreActive = visibleMoreNavItems.some((item) =>
    item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
  )

  useEffect(() => {
    document.documentElement.style.fontSize = FONT_SIZE_MAP[fontSize]
    localStorage.setItem('fontSize', fontSize)
  }, [fontSize])

  useEffect(() => {
    setMoreOpen(false)
  }, [location.pathname])

  const handleSignOut = async () => {
    await signOut()
    navigate('/')
  }

  const initial = (user?.displayName?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()

  return (
    <div className="min-h-screen flex flex-col">
      {/* 本地模擬器環境標示（非模擬器模式不渲染任何東西） */}
      <EmulatorBadge />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-bg-dark/95 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 h-12 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 no-underline shrink-0">
            <span className="text-accent-orange font-bold text-xl tracking-wider font-[Orbitron,sans-serif]">
              米赫瑪超吉情豹站
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1 overflow-x-auto">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `px-3 py-2 rounded-lg text-sm no-underline transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-accent-orange/10 text-accent-orange'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <ContentNavDropdown label="資料圖鑑" items={catalogNavItems} />
            {isAdmin && (
              <NavLink
                to={simulatorItem.to}
                className={({ isActive }) =>
                  `px-3 py-2 rounded-lg text-sm no-underline transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-accent-orange/10 text-accent-orange'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
                  }`
                }
              >
                {simulatorItem.label}
              </NavLink>
            )}
            <ContentNavDropdown label="攻略/工具/文件" items={contentNavItems} />
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
      </header>

      {/* 非預期登出橫幅（PLAN-045）。放在 header 與 main 之間、不進 main 的
          overflow-hidden 容器——首頁的 snap 捲動會把它藏起來。 */}
      <SignedOutBanner />

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>

      {/* Footer — homepage manages its own footer inside snap container */}
      {!isHome && <footer className="border-t border-border py-8 text-center text-text-dim text-sm">
        <p>米赫瑪超吉情豹站 — Mecharashi Community Toolkit</p>
        <p className="mt-1">本站是氣吉敗壞的豹吉自己摸出來的，無營利，完全免費，與官方無關，但99%圖片資源都來源於官方WIKI</p>
      </footer>}

      {/* 手機底部 Tab Bar 佔位 — 防止 footer 被 fixed bar 遮住 */}
      {!isHome && (
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
          {visibleMoreNavItems.map((item) => (
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
