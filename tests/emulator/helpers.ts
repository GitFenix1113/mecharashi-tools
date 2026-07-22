// PLAN-030 模擬器整合測試：共用 helpers
//
// ── 架構 ─────────────────────────────────────────────────────────────────────
// 專用測試模擬器實例（firebase.emutest.json：Firestore 8181 / Auth 9299，
// 預設專案 demo-plan030），與開發用的 8080/9099 那組完全隔離。啟動指令見 README 段：
//   npx firebase emulators:start --only firestore,auth --project demo-plan030 --config firebase.emutest.json
//
// 所有套件共用同一個專案（多專案隔離在 client SDK + Auth 這條路上行不通——
// Auth public endpoint 一律落在預設專案、Firestore 拒收跨專案 token，實測 403）。
// 平行的多個測試程序改用**跨程序套件鎖**序列化：emuSuite() 進場先搶鎖、
// 清場、跑完釋放。套件執行是秒級，鎖競爭無感。
//
// ── 兩條資料通道，職責刻意分開 ───────────────────────────────────────────────
//   · admin SDK（adminDb / adminAuth）—— 對模擬器送 Bearer owner，**繞過所有安全規則**。
//     只用於「種資料」與「帶外驗證」（斷言資料庫真實狀態，不信任待測程式的回傳值）。
//   · client SDK（firebase-stub 的 db / auth，經 loader 注入待測模組）——
//     走完整規則路徑。待測的 cascadeDelete / logChangeOrThrow 全在這條路上。
//   ⚠ 千萬不要用 admin SDK 呼叫待測邏輯——規則永遠是綠的，測了等於沒測
//     （scripts/test-emulator-rules.mjs 檔頭同款警告）。

import fs from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, type TestContext } from 'node:test'
import admin from 'firebase-admin'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth } from './firebase-stub.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

const FS_PORT = process.env.EMU_FS_PORT ?? '8181'
const AUTH_PORT = process.env.EMU_AUTH_PORT ?? '9299'

// ── 硬性防呆：只准打本機模擬器（比照 scripts/seed-emulator.mjs）────────────────
process.env.FIRESTORE_EMULATOR_HOST ||= `127.0.0.1:${FS_PORT}`
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= `127.0.0.1:${AUTH_PORT}`

const isLocal = (host: string | undefined) => /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host ?? '')
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!isLocal(process.env[key])) {
    throw new Error(`[helpers] ${key}=${process.env[key]} 不是本機位址，拒絕執行破壞性測試。`)
  }
}

export const PROJECT_ID = process.env.EMU_PROJECT_ID ?? 'demo-plan030'
if (!PROJECT_ID.startsWith('demo-')) {
  throw new Error(`[helpers] EMU_PROJECT_ID=${PROJECT_ID} 必須以 demo- 開頭（離線專案命名空間）。`)
}

const app =
  admin.apps.find((a) => a?.name === PROJECT_ID) ??
  admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID)

/** 帶外通道：繞過規則。只用於種資料與驗證資料庫真實狀態。 */
export const adminDb = app.firestore()
export const adminAuth = app.auth()

// ── 跨程序套件鎖 ─────────────────────────────────────────────────────────────
// mkdir 是原子操作：成功 = 拿到鎖。持鎖程序若死掉，180 秒後可被搶佔。

const LOCK_DIR = resolve(__dirname, '.suite-lock')
const OWNER_FILE = resolve(LOCK_DIR, 'owner')

async function acquireLock(): Promise<void> {
  const start = Date.now()
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR)
      fs.writeFileSync(OWNER_FILE, `${process.pid} ${Date.now()}`)
      return
    } catch {
      try {
        const [, t] = fs.readFileSync(OWNER_FILE, 'utf8').split(' ')
        if (Date.now() - Number(t) > 180_000) {
          fs.rmSync(LOCK_DIR, { recursive: true, force: true })
          continue
        }
      } catch { /* owner 檔尚未寫入或已被清掉，照常重試 */ }
      if (Date.now() - start > 300_000) throw new Error('[helpers] 等待套件鎖逾時（300s）')
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

function releaseLock(): void {
  fs.rmSync(LOCK_DIR, { recursive: true, force: true })
}

/**
 * 套件進入點：搶鎖 → 清場 → 執行 → 釋放。
 *
 * 套件內用 `await t.test('案例名', ...)` 寫子測試（node:test 子測試須 await，
 * 否則父測試先結束會判 cancelled）。整個套件在鎖內執行，跨程序不互踩。
 */
export function emuSuite(name: string, fn: (t: TestContext) => Promise<void>): void {
  test(name, { timeout: 300_000 }, async (t) => {
    await acquireLock()
    try {
      await clearProject()
      await fn(t)
    } finally {
      releaseLock()
    }
  })
}

// ── 清場 ─────────────────────────────────────────────────────────────────────

/** 清空本專案的 Firestore 文件與 Auth 帳號。emuSuite 進場自動呼叫。 */
export async function clearProject(): Promise<void> {
  const fsRes = await fetch(
    `http://127.0.0.1:${FS_PORT}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
  if (!fsRes.ok) throw new Error(`[helpers] 清除 Firestore 失敗：${fsRes.status}（測試模擬器有在跑嗎？）`)
  const auRes = await fetch(
    `http://127.0.0.1:${AUTH_PORT}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: 'DELETE' },
  )
  if (!auRes.ok) throw new Error(`[helpers] 清除 Auth 帳號失敗：${auRes.status}`)
}

// ── 種資料（admin 通道，繞規則）──────────────────────────────────────────────

/** 依集合種入文件；每筆需含 id 欄位（作為文件 ID，不寫進內容）。 */
export async function seedDocs(
  byColl: Record<string, Array<Record<string, unknown> & { id: string }>>,
): Promise<void> {
  const batch = adminDb.batch()
  for (const [coll, docs] of Object.entries(byColl)) {
    for (const { id, ...data } of docs) {
      batch.set(adminDb.collection(coll).doc(id), data)
    }
  }
  await batch.commit()
}

// ── 測試帳號 ─────────────────────────────────────────────────────────────────

export const ADMIN_USER = { email: 'admin@test.local', password: 'admin-test', name: '測試管理員' }
export const PLAIN_USER = { email: 'plain@test.local', password: 'plain-test', name: '一般使用者' }

/**
 * 建立帳號並種入 users/{uid}/profile/main 的 role 文件。
 * role 存在 Firestore 文件而非 custom claim，isAdmin() 讀的正是這份 —— 一份文件
 * 同時滿足規則與 UI（比照 seed-emulator.mjs）。
 */
export async function seedUser(
  user: { email: string; password: string; name: string },
  role: 'OWNER' | 'ADMIN' | 'USER',
): Promise<string> {
  const created = await adminAuth.createUser({
    email: user.email,
    password: user.password,
    displayName: user.name,
    emailVerified: true,
  })
  await adminDb.doc(`users/${created.uid}/profile/main`).set({
    uid: created.uid,
    displayName: user.name,
    role,
    createdAt: new Date().toISOString(),
  })
  return created.uid
}

/** client 通道登入（之後 cascadeDelete 內的 auth.currentUser / 規則都以此身分執行）。 */
export async function signInAs(user: { email: string; password: string }): Promise<void> {
  await signInWithEmailAndPassword(auth, user.email, user.password)
}

export async function signOutClient(): Promise<void> {
  await signOut(auth)
}

// ── 帶外驗證（admin 通道，繞規則）────────────────────────────────────────────

/** 讀單一文件的真實狀態；不存在回 null。 */
export async function readDoc(coll: string, id: string): Promise<Record<string, unknown> | null> {
  const snap = await adminDb.doc(`${coll}/${id}`).get()
  return snap.exists ? (snap.data() as Record<string, unknown>) : null
}

/** 整個集合的文件（id → data）。 */
export async function listColl(coll: string): Promise<Map<string, Record<string, unknown>>> {
  const snap = await adminDb.collection(coll).get()
  return new Map(snap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]))
}

/** changeHistory 全部記錄（測試斷言用；正式路徑另有分頁查詢）。 */
export async function allLogs(): Promise<Array<Record<string, unknown> & { id: string }>> {
  const snap = await adminDb.collection('changeHistory').get()
  return snap.docs.map((d) => ({ ...(d.data() as Record<string, unknown>), id: d.id }))
}
