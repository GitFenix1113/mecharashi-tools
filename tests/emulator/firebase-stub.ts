// PLAN-030 模擬器整合測試：src/lib/firebase.ts 的測試替身
//
// 由 loader.mjs 在模組解析層替換，匯出名與正式檔一致（db / auth / storage / USE_EMULATOR）。
// 與正式檔的差異：
//   · 連的是**專用測試模擬器實例**（預設 8181/9299，firebase.emutest.json），與開發用的
//     8080/9099 那組（npm run emu）完全隔離——破壞性測試不會弄髒開發模擬器的資料；
//   · projectId 固定 demo-* 前綴 —— Firebase 工具鏈保證 demo-* 永不對應真實專案，
//     即使模擬器沒開也連不到任何正式後端；
//   · 不啟用 persistentLocalCache（C-4 審查發現①的教訓：測試更不該有本機快取層）；
//   · 不初始化 App Check / Storage。
//
// ⚠ 專案 ID 必須用模擬器啟動時的預設專案（demo-plan030）：Auth 模擬器的 public
//   endpoint（client SDK 登入走的路）一律落在預設專案，Firestore 又拒收跨專案 token
//   ——多專案隔離在「client SDK + 規則」這條路上行不通（實測 403），
//   平行隔離改由 helpers 的跨程序套件鎖負責。
//
// ⚠ 測試專用。正式程式碼永遠不 import 這個檔案——替換發生在 loader，不在原始碼。

import { initializeApp } from 'firebase/app'
import { initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getAuth, connectAuthEmulator } from 'firebase/auth'

const projectId = process.env.EMU_PROJECT_ID ?? 'demo-plan030'
if (!projectId.startsWith('demo-')) {
  throw new Error(
    `[firebase-stub] EMU_PROJECT_ID=${projectId} 必須以 demo- 開頭。` +
    ' demo-* 是 Firebase 約定的離線專案命名空間，防止測試打到任何真實專案。',
  )
}

const FS_PORT = Number(process.env.EMU_FS_PORT ?? 8181)
const AUTH_PORT = Number(process.env.EMU_AUTH_PORT ?? 9299)

const app = initializeApp({ apiKey: 'fake-api-key', projectId, appId: 'demo-app' })

export const db = initializeFirestore(app, {})
connectFirestoreEmulator(db, '127.0.0.1', FS_PORT)

export const auth = getAuth(app)
connectAuthEmulator(auth, `http://127.0.0.1:${AUTH_PORT}`, { disableWarnings: true })

// 本測試面不觸及 Storage；佔位以滿足匯出形狀
export const storage = undefined as never

export const USE_EMULATOR = true
