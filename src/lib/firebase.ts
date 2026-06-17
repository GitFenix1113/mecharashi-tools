import { initializeApp, getApps } from 'firebase/app'
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { getStorage } from 'firebase/storage'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

// 避免 HMR 時重複初始化
const isNewApp = getApps().length === 0
const app = isNewApp ? initializeApp(firebaseConfig) : getApps()[0]

// ── App Check：擋下非授權網域的請求（防止他站盜用我的 Firestore）──
// 只在首次初始化時設定一次，避免 HMR 重複呼叫
if (isNewApp) {
  // 本機開發：使用固定的 debug token（值存在 .env.local，不進版控）
  // 釘死成固定值，避免「清除網站資料」後 SDK 重新產生隨機 token、與 Console 註冊的對不上
  // 未設環境變數時退回 true（SDK 自動產生隨機 token）
  if (import.meta.env.DEV) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true
  }
  initializeAppCheck(app, {
    // 金鑰雖由 Google Cloud (reCAPTCHA Enterprise) 建立，但搭配其「舊版 secret key」
    // 走 classic reCAPTCHA v3 流程（api.js），對應 Firebase App Check 的「reCAPTCHA」provider
    provider: new ReCaptchaV3Provider(import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  })
}

// initializeFirestore 只能呼叫一次；HMR reload 時改用 getFirestore 取已存在的實例
export const db = isNewApp
  ? initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    })
  : getFirestore(app)

export const auth = getAuth(app)
export const storage = getStorage(app)

// ── 申請持久化儲存,降低「用著用著就登出」──
// 裝置儲存空間吃緊時,瀏覽器(尤其 Android Chrome)會自動清除(evict)本站的 IndexedDB,
// 連帶清掉 Firebase Auth 的登入狀態與上方 Firestore 離線快取 → 使用者表現為「莫名登出」。
// navigator.storage.persist() 申請「持久化」級別,獲准後瀏覽器不會在空間壓力下清除本站資料。
// Chrome 依互動程度等啟發式自動決定是否核准,通常不跳提示;不支援或被拒也無副作用。
if (
  isNewApp &&
  typeof navigator !== 'undefined' &&
  navigator.storage &&
  typeof navigator.storage.persist === 'function'
) {
  navigator.storage
    .persisted()
    .then((alreadyPersisted) => {
      if (!alreadyPersisted) return navigator.storage.persist()
    })
    .catch(() => {
      /* 不支援或被拒,忽略即可 */
    })
}

export default app
