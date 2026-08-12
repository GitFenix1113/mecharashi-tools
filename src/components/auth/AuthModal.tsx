import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'

interface Props {
  isOpen: boolean
  onClose: () => void
}

function parseFirebaseError(e: unknown): string {
  if (!(e instanceof Error)) return '操作失敗，請重試'
  const code = (e as { code?: string }).code
  switch (code) {
    case 'auth/email-already-in-use': return '此 Email 已被註冊'
    case 'auth/weak-password': return '密碼至少需要 6 個字元'
    case 'auth/invalid-email': return 'Email 格式不正確'
    case 'auth/user-not-found': return '找不到此帳號'
    case 'auth/wrong-password': return '密碼錯誤'
    case 'auth/invalid-credential': return 'Email 或密碼錯誤'
    case 'auth/too-many-requests': return '嘗試次數過多，請稍後再試'
    case 'auth/email-not-verified': return 'Email 尚未驗證，已重新寄送驗證信，請查收後再登入'
    default: return e.message
  }
}

export default function AuthModal({ isOpen, onClose }: Props) {
  const { signIn, signInWithEmail, signUpWithEmail, sendPasswordReset } = useAuth()
  const [tab, setTab] = useState<'google' | 'email'>('google')
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [verifyPending, setVerifyPending] = useState(false)
  const [pendingEmail, setPendingEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)

  if (!isOpen) return null

  function resetForm() {
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setDisplayName('')
    setError(null)
    setVerifyPending(false)
    setPendingEmail('')
    setResetSent(false)
  }

  function switchTab(t: 'google' | 'email') {
    setTab(t)
    setError(null)
    setResetSent(false)
    if (mode === 'reset') setMode('login')
  }

  function switchMode(m: 'login' | 'register' | 'reset') {
    setMode(m)
    setError(null)
    setResetSent(false)
  }

  async function handleGoogle() {
    setSubmitting(true)
    setError(null)
    try {
      await signIn()
      onClose()
    } catch (e) {
      setError(parseFirebaseError(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePasswordReset() {
    setError(null)
    setResetSent(false)
    const targetEmail = email.trim()
    if (!targetEmail) {
      setError('請先輸入 Email')
      return
    }
    setSubmitting(true)
    try {
      await sendPasswordReset(targetEmail)
    } catch (e) {
      // 帳號不存在時不揭露（避免 email enumeration），其餘錯誤才提示
      const code = (e as { code?: string }).code
      if (code !== 'auth/user-not-found') {
        setError(parseFirebaseError(e))
        return
      }
    } finally {
      setSubmitting(false)
    }
    setResetSent(true)
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (mode === 'register') {
      if (!displayName.trim()) { setError('請輸入顯示名稱'); return }
      if (password !== confirmPassword) { setError('兩次密碼不一致'); return }
    }
    setSubmitting(true)
    try {
      if (mode === 'register') {
        await signUpWithEmail(email, password, displayName.trim())
        setPendingEmail(email)
        setVerifyPending(true)
      } else {
        await signInWithEmail(email, password)
        resetForm()
        onClose()
      }
    } catch (e) {
      setError(parseFirebaseError(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-card border border-border rounded-xl p-6 w-full max-w-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold">登入 / 註冊</h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text-primary transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* 驗證信已寄出畫面 */}
        {verifyPending && (
          <div className="text-center py-4">
            <div className="text-3xl mb-3">📬</div>
            <p className="text-sm font-medium text-text-primary mb-2">驗證信已寄出</p>
            <p className="text-xs text-text-dim mb-1">請前往信箱查收</p>
            <p className="text-xs text-accent-orange font-medium mb-5 break-all">{pendingEmail}</p>
            <p className="text-xs text-text-dim mb-5">點擊信中連結啟用帳號後，回到此頁用 Email 登入即可。</p>
            <button
              onClick={() => { resetForm(); switchTab('email'); switchMode('login') }}
              className="w-full py-2.5 bg-accent-orange text-black font-bold rounded-lg hover:opacity-90 transition-opacity text-sm"
            >
              前往登入
            </button>
          </div>
        )}

        {!verifyPending && (
          <>
            {/* Tabs */}
            <div className="flex gap-2 mb-5">
              <button
                onClick={() => switchTab('google')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === 'google'
                    ? 'bg-accent-orange text-black'
                    : 'bg-bg-dark border border-border text-text-secondary hover:text-text-primary'
                }`}
              >
                Google
              </button>
              <button
                onClick={() => switchTab('email')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === 'email'
                    ? 'bg-accent-orange text-black'
                    : 'bg-bg-dark border border-border text-text-secondary hover:text-text-primary'
                }`}
              >
                Email
              </button>
            </div>

            {/* Google */}
            {tab === 'google' && (
              <div>
                <p className="text-xs text-text-dim mb-4 text-center">使用 Google 帳號快速登入</p>
                <button
                  onClick={handleGoogle}
                  disabled={submitting}
                  className="w-full py-3 bg-white text-gray-800 rounded-lg font-medium hover:bg-gray-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                >
                  <span className="font-bold text-base leading-none" style={{ fontFamily: 'sans-serif' }}>G</span>
                  使用 Google 帳號登入
                </button>
                {error && <p className="text-xs text-accent-red mt-3">{error}</p>}
              </div>
            )}

            {/* Email */}
            {tab === 'email' && (
              <div>
                {mode !== 'reset' && (
                  <div className="flex gap-1 mb-4 border-b border-border pb-3">
                    <button
                      onClick={() => switchMode('login')}
                      className={`px-3 py-1 rounded-md text-xs transition-colors ${
                        mode === 'login'
                          ? 'text-accent-orange bg-accent-orange/10 font-medium'
                          : 'text-text-dim hover:text-text-secondary'
                      }`}
                    >
                      已有帳號，直接登入
                    </button>
                    <button
                      onClick={() => switchMode('register')}
                      className={`px-3 py-1 rounded-md text-xs transition-colors ${
                        mode === 'register'
                          ? 'text-accent-orange bg-accent-orange/10 font-medium'
                          : 'text-text-dim hover:text-text-secondary'
                      }`}
                    >
                      建立新帳號
                    </button>
                  </div>
                )}

                {mode === 'reset' && (
                  <div className="mb-4 border-b border-border pb-4">
                    <button
                      onClick={() => switchMode('login')}
                      className="text-xs text-text-dim hover:text-accent-orange transition-colors mb-3"
                    >
                      ← 返回登入
                    </button>
                    <h3 className="text-base font-bold text-text-primary mb-1">重設密碼</h3>
                    <p className="text-xs text-text-dim">
                      輸入註冊 Email，我們會寄送密碼重設連結到你的信箱。
                    </p>
                  </div>
                )}

                {mode === 'reset' ? (
                  <div className="space-y-3">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Email"
                      required
                      autoComplete="email"
                      className="w-full px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-orange placeholder:text-text-dim"
                    />

                    {error && <p className="text-xs text-accent-red">{error}</p>}
                    {resetSent && (
                      <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3">
                        <p className="text-sm font-medium text-green-400 mb-1">重設密碼信已寄出</p>
                        <p className="text-xs text-text-dim">
                          請前往信箱查收連結，完成後回來用新密碼登入。
                        </p>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handlePasswordReset}
                      disabled={submitting}
                      className="w-full py-2.5 bg-accent-orange text-black font-bold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 text-sm"
                    >
                      {submitting ? '寄送中...' : '寄送重設密碼信'}
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleEmailSubmit} className="space-y-3">
                  {mode === 'register' && (
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="顯示名稱"
                      required
                      autoComplete="nickname"
                      className="w-full px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-orange placeholder:text-text-dim"
                    />
                  )}
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email"
                    required
                    autoComplete="email"
                    className="w-full px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-orange placeholder:text-text-dim"
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'register' ? '密碼（至少 6 個字元）' : '密碼'}
                    required
                    minLength={6}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    className="w-full px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-orange placeholder:text-text-dim"
                  />
                  {mode === 'register' && (
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="確認密碼"
                      required
                      autoComplete="new-password"
                      className="w-full px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-orange placeholder:text-text-dim"
                    />
                  )}

                  {error && <p className="text-xs text-accent-red">{error}</p>}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2.5 bg-accent-orange text-black font-bold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 text-sm"
                  >
                    {submitting ? '處理中...' : mode === 'register' ? '建立帳號' : '登入'}
                  </button>
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => switchMode('reset')}
                      disabled={submitting}
                      className="w-full text-xs text-text-dim hover:text-accent-orange transition-colors disabled:opacity-50"
                    >
                      忘記密碼？
                    </button>
                  )}
                  </form>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
