import { Outlet, Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import AvatarDisplay from './profile/AvatarDisplay'

type FontSize = 'sm' | 'md' | 'lg'
const FONT_SIZE_MAP: Record<FontSize, string> = { sm: '17px', md: '19px', lg: '21px' }
const FONT_SIZE_LABELS: Record<FontSize, string> = { sm: '小', md: '中', lg: '大' }

const navItems = [
  { to: '/', label: '首頁', icon: '🏠' },
  { to: '/pilots', label: '機師圖鑑', icon: '👤' },
  { to: '/mechs', label: '機甲圖鑑', icon: '🤖' },
  { to: '/weapons', label: '武器圖鑑', icon: '🔫' },
  { to: '/backpacks', label: '背包圖鑑', icon: '🎒' },
  { to: '/modules', label: '模組圖鑑', icon: '🧩' },
  { to: '/components', label: '元件圖鑑', icon: '⚙️' },
  { to: '/simulator', label: '配裝模擬器', icon: '⚔️' },
  { to: '/guides', label: '攻略專區', icon: '📚' },
]

const tabBarItems = [
  { to: '/', label: '首頁', icon: '🏠' },
  { to: '/pilots', label: '機師', icon: '👤' },
  { to: '/mechs', label: '機甲', icon: '🤖' },
  { to: '/weapons', label: '武器', icon: '🔫' },
  { to: '/modules', label: '模組', icon: '🧩' },
]

const tabBarPaths = new Set(tabBarItems.map((i) => i.to))
const moreNavItems = navItems.filter((item) => !tabBarPaths.has(item.to))

export default function Layout() {
  const [moreOpen, setMoreOpen] = useState(false)
  const [fontSize, setFontSize] = useState<FontSize>(
    () => (localStorage.getItem('fontSize') as FontSize) || 'md'
  )
  const { user, userProfile, loading, signOut, openAuthModal } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const isHome = location.pathname === '/'
  const isAdmin = userProfile?.role === 'ADMIN' || userProfile?.role === 'OWNER'
  const visibleNavItems = navItems.filter((item) => item.to !== '/simulator' || isAdmin)
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
            {visibleNavItems.map((item) => (
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
                  🔑
                </button>
              </>
            )}
          </div>
        </div>
      </header>

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
              <span className="text-2xl">{item.icon}</span>
              <span className="text-xs">{item.label}</span>
            </NavLink>
          ))}
        </div>

        {/* Admin 入口（手機版 More Panel） */}
        {(userProfile?.role === 'ADMIN' || userProfile?.role === 'OWNER') && (
          <div className="border-t border-border px-4 py-2">
            <NavLink
              to="/admin"
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                `block w-full py-2 text-sm text-center rounded-lg transition-colors no-underline ${
                  isActive
                    ? 'bg-accent-purple/15 text-accent-purple'
                    : 'text-accent-purple/70 hover:text-accent-purple hover:bg-accent-purple/10'
                }`
              }
            >
              🛠️ 後台管理
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
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-accent-orange/10 text-accent-orange border border-accent-orange/30 hover:bg-accent-orange/20 transition-colors cursor-pointer"
              >
                🔑 登入 / 註冊
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
              <span className="text-xl leading-none">{item.icon}</span>
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
            <span className="text-xl leading-none">≡</span>
            <span className="text-[10px] leading-none">更多</span>
          </button>
        </div>
      </nav>
    </div>
  )
}
