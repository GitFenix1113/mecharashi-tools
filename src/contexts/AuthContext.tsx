import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
} from 'firebase/auth'
import { auth, USE_EMULATOR } from '../lib/firebase'
import { getUserProfile, initUserProfile, patchUserProfile } from '../lib/userApi'
import type { UserProfile } from '../types'
import AuthModal from '../components/AuthModal'

interface AuthContextValue {
  user: User | null
  userProfile: UserProfile | null
  loading: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  signUpWithEmail: (email: string, password: string, displayName: string) => Promise<void>
  signInWithEmail: (email: string, password: string) => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  openAuthModal: () => void
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// ── 模擬器模式自動登入 ────────────────────────────────────────────────────────
// 模擬器與正式站共用同一份 firestore.rules，遊戲資料一律 `read: if isAdmin()`，所以
// 未登入的本機開發會拿到 0 筆資料**而且完全不報錯**（畫面空空、console 乾淨），症狀
// 和「種子沒灌進去」一模一樣。每次重整都要手動登入一次，純屬摩擦，故在模擬器模式下
// 自動以 `npm run emu:seed` 建立的 OWNER 帳號登入。
//
// 安全性：只在 USE_EMULATOR 為 true 時執行，而該旗標來自 .env.emulator（僅
// `vite --mode emulator` 載入）。一般 dev 與所有 production build 恆為 false，
// 這段連同帳密字串都會被靜態消除，不可能在正式環境自動登入任何人。
//
// 帳密預設對齊 scripts/seed-emulator.mjs 的 DEFAULTS；若你用 `--email` / `--password`
// 自訂了 seed 帳號，在 .env.emulator 覆蓋即可（該檔不含機密、已進版控，因為這組帳號
// 只存在於本機模擬器）。
const EMU_ADMIN_EMAIL: string = import.meta.env.VITE_EMU_ADMIN_EMAIL ?? 'dev-admin@local.test'
const EMU_ADMIN_PASSWORD: string = import.meta.env.VITE_EMU_ADMIN_PASSWORD ?? 'devadmin'

// 一個 session 只自動登入一次：使用者若在模擬器裡主動登出（例如要測未登入的前台長相），
// 不該立刻被登回去。重整頁面才會再次自動登入。
let emuAutoSignInTried = false

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (cancelled) return
      setUser(u)
      if (u) {
        const profile = await initUserProfile(u.uid, {
          displayName: u.displayName ?? u.email ?? 'User',
          email: u.email ?? '',
          ...(u.photoURL ? { photoURL: u.photoURL } : {}),
        })
        if (!cancelled) {
          setUserProfile(profile)
          setLoading(false)
        }
      } else {
        // 模擬器模式：沒有登入狀態時自動登入 seed 帳號（見檔案上方說明）。
        if (USE_EMULATOR && !emuAutoSignInTried) {
          emuAutoSignInTried = true
          signInWithEmailAndPassword(auth, EMU_ADMIN_EMAIL, EMU_ADMIN_PASSWORD)
            .then(() => {
              console.log(
                `%c 🧪 EMULATOR %c 已自動登入 ${EMU_ADMIN_EMAIL}（OWNER） `,
                'background:#22c55e;color:#000;font-weight:bold;padding:3px 6px;border-radius:4px 0 0 4px',
                'background:#14532d;color:#bbf7d0;padding:3px 6px;border-radius:0 4px 4px 0',
              )
            })
            .catch((err) => {
              // 最常見原因是還沒跑 emu:seed（帳號不存在）——講清楚，別讓人對著空畫面猜。
              console.warn(
                '[AuthContext] 模擬器自動登入失敗，遊戲資料會是 0 筆。請先執行 `npm run emu:seed`。',
                err,
              )
              if (!cancelled) {
                setUserProfile(null)
                setLoading(false)
              }
            })
          // 登入成功時 onAuthStateChanged 會再觸發一次、由上面的 if (u) 分支收尾，
          // 所以這裡不能先把 loading 關掉，否則會閃一下未登入畫面。
          return
        }
        if (!cancelled) {
          setUserProfile(null)
          setLoading(false)
        }
      }
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const signIn = async () => {
    await signInWithPopup(auth, new GoogleAuthProvider())
  }

  const signOut = async () => {
    await fbSignOut(auth)
  }

  const signUpWithEmail = async (email: string, password: string, displayName: string) => {
    const credential = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(credential.user, { displayName })
    // 先確保 profile 文件存在（含 role: 'USER'），再 patch displayName
    // 若 onAuthStateChanged 搶先跑過 initUserProfile，這裡會直接跳過 create；
    // 後續 patchUserProfile 一律是 update（不觸發 create 規則的 role 檢查）
    await initUserProfile(credential.user.uid, {
      displayName,
      email: credential.user.email ?? '',
      ...(credential.user.photoURL ? { photoURL: credential.user.photoURL } : {}),
    })
    await patchUserProfile(credential.user.uid, { displayName })
    await sendEmailVerification(credential.user)
    // 寄出驗證信後登出，使用者必須點擊連結驗證後才能正式登入
    await fbSignOut(auth)
  }

  const signInWithEmail = async (email: string, password: string) => {
    const credential = await signInWithEmailAndPassword(auth, email, password)
    if (!credential.user.emailVerified) {
      await sendEmailVerification(credential.user)
      await fbSignOut(auth)
      throw Object.assign(new Error('auth/email-not-verified'), { code: 'auth/email-not-verified' })
    }
  }

  const sendPasswordReset = async (email: string) => {
    await sendPasswordResetEmail(auth, email)
  }

  const openAuthModal = () => setModalOpen(true)

  const refreshProfile = async () => {
    if (!user) return
    const profile = await getUserProfile(user.uid)
    setUserProfile(profile)
  }

  return (
    <AuthContext.Provider
      value={{ user, userProfile, loading, signIn, signOut, signUpWithEmail, signInWithEmail, sendPasswordReset, openAuthModal, refreshProfile }}
    >
      {children}
      <AuthModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
