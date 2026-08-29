import {
  doc,
  getDoc,
  setDoc,
  collectionGroup,
  getDocs,
  query,
  limit,
  where,
} from 'firebase/firestore'
import { db } from './firebase'
import { WORKER_ENABLED, fetchWorkerSiteTeam } from './api/workerData'
import type { UserProfile, UserResearchLevels, SiteTeamMember } from '../types'

const profileDoc = (uid: string) => doc(db, 'users', uid, 'profile', 'main')

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(profileDoc(uid))
  return snap.exists() ? (snap.data() as UserProfile) : null
}

export async function initUserProfile(
  uid: string,
  data: Pick<UserProfile, 'displayName' | 'email' | 'photoURL'>
): Promise<UserProfile> {
  const ref = profileDoc(uid)
  const snap = await getDoc(ref)
  if (snap.exists()) {
    return snap.data() as UserProfile
  }
  const now = new Date().toISOString()
  const newProfile: UserProfile = {
    uid,
    ...data,
    role: 'USER',
    researchLevels: { pilotByClass: {}, mechByType: {}, weaponByType: {} },
    createdAt: now,
    updatedAt: now,
  }
  await setDoc(ref, newProfile)
  return newProfile
}

export async function patchUserProfile(uid: string, data: Partial<UserProfile>): Promise<void> {
  await setDoc(profileDoc(uid), { ...data, updatedAt: new Date().toISOString() }, { merge: true })
}

const USERS_FETCH_LIMIT = 200

export async function getAllUsers(): Promise<{ users: UserProfile[]; hasMore: boolean }> {
  // 需要 Firestore 規則允許管理者讀取所有 users/{uid}/profile 子集合
  const snap = await getDocs(query(collectionGroup(db, 'profile'), limit(USERS_FETCH_LIMIT + 1)))
  const docs = snap.docs.slice(0, USERS_FETCH_LIMIT)
  return {
    users: docs.map((d) => d.data() as UserProfile),
    hasMore: snap.docs.length > USERS_FETCH_LIMIT,
  }
}

/** UserProfile → 公開子集。本機直連的回退路徑用，確保兩條路徑回傳形狀一致。 */
function toSiteTeamMember(p: UserProfile): SiteTeamMember {
  return {
    uid: p.uid,
    displayName: p.displayName,
    role: p.role,
    photoURL: p.photoURL,
    avatarType: p.avatarType,
    avatarUrl: p.avatarUrl,
    avatarPilotId: p.avatarPilotId,
    gameNickname: p.gameNickname,
    gameServer: p.gameServer,
    guild: p.guild,
  }
}

/**
 * 首頁維護團隊名單（PLAN-051）。
 *
 * 原本是 client 直查 collectionGroup('profile')，靠 firestore.rules 開一條
 * 「role 是 ADMIN/OWNER 就人人可讀」的分支撐著——而 Firestore 只能整份文件授權，
 * 那條分支等於把管理員 email 送進每一位匿名訪客的瀏覽器。現在規則已收回 isAdmin()，
 * 名單改由 Worker 代讀並過濾欄位。
 *
 * Worker 未設定時（純本機直連）退回直查：收緊後只有管理者讀得到，一般訪客會拿到
 * permission denied，由 useSiteTeam 的降級處理（首頁少一塊而不是壞掉）。
 */
export async function getSiteTeamProfiles(): Promise<SiteTeamMember[]> {
  if (WORKER_ENABLED) return fetchWorkerSiteTeam()
  const snap = await getDocs(
    query(collectionGroup(db, 'profile'), where('role', 'in', ['ADMIN', 'OWNER']))
  )
  return snap.docs.map(d => toSiteTeamMember(d.data() as UserProfile))
}

export async function updateUserRole(uid: string, role: 'USER' | 'ADMIN' | 'OWNER'): Promise<void> {
  await setDoc(profileDoc(uid), { role, updatedAt: new Date().toISOString() }, { merge: true })
}

export async function saveResearchLevels(
  uid: string,
  levels: UserResearchLevels
): Promise<void> {
  await setDoc(
    profileDoc(uid),
    { researchLevels: levels, updatedAt: new Date().toISOString() },
    { merge: true }
  )
}

// ── 配裝存檔已移出本檔（PLAN-052-E B-6，2026-08-29）─────────────────────────
//
// 原本這裡有 `getUserBuilds` / `saveBuild` / `deleteBuild` 三支，寫的是 v1 `Build`
// （單一 `weaponId` ＋ `backpackId`，沒有槽位概念）。總綱判死了那個模型，而 A-1 直讀
// 正式 Firestore 復驗 `builds` **實測 0 筆**，所以是刪除而不是遷移 —— 零遷移成本。
//
// 現行的雲端書架在 **`src/lib/buildsApi.ts`**：`users/{uid}/builds/{pilotId}`，
// 一位機師一份文件、五格，每格是一串分享代碼。
//
// ⚠ 刪掉這三支還有一個實際理由：`userApi.saveBuild` 與 `localBuilds.saveBuild`
//   **同名**。兩份都在的時候，搜尋 `saveBuild` 會撈到三個不同的東西，
//   而其中一個已經沒有人呼叫、卻看起來一樣可用。
