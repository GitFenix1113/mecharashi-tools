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
  // 本機開發：啟用 debug token，讓 localhost 不必真的過 reCAPTCHA
  // token 會印在瀏覽器 Console，需到 Firebase Console > App Check 註冊該 token
  if (import.meta.env.DEV) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true
  }
  initializeAppCheck(app, {
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
export default app
