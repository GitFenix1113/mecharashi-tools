import { initializeApp, getApps } from 'firebase/app'
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from 'firebase/firestore'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getStorage, connectStorageEmulator } from 'firebase/storage'

// ── 本地模擬器模式（PLAN-030 Phase 0）───────────────────────────────────────────
// 只有 `npm run dev:emu`（= vite --mode emulator，載入 .env.emulator）時為 true；
// 一般 `npm run dev` 與所有 production build 一律 false。
//
// 旗標刻意放在 .env.emulator 這個「模式專屬」檔案，而非 .env.local：
//   · .env.local 在所有模式都會載入 → 一旦寫在那裡，很容易忘了關而讓正式操作打到模擬器；
//   · 模式檔只在明確指定 --mode emulator 時生效，切換是顯式的、不會殘留。
export const USE_EMULATOR = import.meta.env.VITE_USE_EMULATOR === 'true'

const EMULATOR_HOST = '127.0.0.1'
const EMULATOR_PORTS = { firestore: 8080, auth: 9099, storage: 9199 } as const

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

// ── App Check 已於 PLAN-029 Phase 3-3 退場 ────────────────────────────────────
// 原本用 App Check（reCAPTCHA v3）擋非授權網域直打 Firestore；PLAN-029 改由
// Cloudflare Worker 代讀公開資料 + Firestore 規則 read:if isAdmin() 真鎖直連取代
// （比 App Check 硬、且擺脫 reCAPTCHA 維運痛）。故此處不再 initializeAppCheck。

// initializeFirestore 只能呼叫一次；HMR reload 時改用 getFirestore 取已存在的實例
//
// 模擬器模式停用 persistentLocalCache：IndexedDB 內可能存有先前連「正式」資料庫時的快取，
// 不停用的話模擬器測試會讀到正式資料，測試結果完全不可信。
export const db = isNewApp
  ? initializeFirestore(
      app,
      USE_EMULATOR
        ? {}
        : { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) },
    )
  : getFirestore(app)

export const auth = getAuth(app)
export const storage = getStorage(app)

// ── 連上本地模擬器 ────────────────────────────────────────────────────────────
// 必須在任何讀寫操作之前呼叫；HMR 時 (isNewApp === false) 實例已連線，重複呼叫會拋錯。
if (USE_EMULATOR && isNewApp) {
  connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORTS.firestore)
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`, { disableWarnings: true })
  connectStorageEmulator(storage, EMULATOR_HOST, EMULATOR_PORTS.storage)
}

// ── 環境標示：務必「大聲」──────────────────────────────────────────────────────
// 最危險的失誤模式是「以為連著模擬器，其實打在正式資料庫」，所以兩種狀態都要印，
// 而且正式資料庫那一側要更醒目（紅色）。絕不做成靜默切換。
if (isNewApp && import.meta.env.DEV) {
  if (USE_EMULATOR) {
    console.log(
      `%c 🧪 EMULATOR %c 本地模擬器 ${EMULATOR_HOST}:${EMULATOR_PORTS.firestore} · 不會動到正式資料庫 `,
      'background:#22c55e;color:#000;font-weight:bold;padding:3px 6px;border-radius:4px 0 0 4px',
      'background:#14532d;color:#bbf7d0;padding:3px 6px;border-radius:0 4px 4px 0',
    )
  } else {
    console.log(
      `%c 🔴 PRODUCTION %c 開發伺服器連的是「正式」資料庫 · 要用模擬器請跑 npm run dev:emu `,
      'background:#ef4444;color:#fff;font-weight:bold;padding:3px 6px;border-radius:4px 0 0 4px',
      'background:#450a0a;color:#fecaca;padding:3px 6px;border-radius:0 4px 4px 0',
    )
  }
}

// ── 申請持久化儲存,降低「用著用著就登出」──
// 裝置儲存空間吃緊時,瀏覽器(尤其 Android Chrome)會自動清除(evict)本站的 IndexedDB,
// 連帶清掉 Firebase Auth 的登入狀態與上方 Firestore 離線快取 → 使用者表現為「莫名登出」。
// navigator.storage.persist() 申請「持久化」級別,獲准後瀏覽器不會在空間壓力下清除本站資料。
// Chrome 依互動程度等啟發式自動決定是否核准,通常不跳提示;不支援或被拒也無副作用。
// 模擬器模式不需要（資料本來就是拋棄式的）。
if (
  isNewApp &&
  !USE_EMULATOR &&
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
