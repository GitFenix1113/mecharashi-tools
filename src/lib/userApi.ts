import {
  doc,
  getDoc,
  setDoc,
  collection,
  collectionGroup,
  getDocs,
  addDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  where,
} from 'firebase/firestore'
import { db } from './firebase'
import { WORKER_ENABLED, fetchWorkerSiteTeam } from './api/workerData'
import type { UserProfile, UserBuild, Build, UserResearchLevels, SiteTeamMember } from '../types'

const profileDoc = (uid: string) => doc(db, 'users', uid, 'profile', 'main')
const buildsCol = (uid: string) => collection(db, 'users', uid, 'builds')

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

export async function getUserBuilds(uid: string): Promise<UserBuild[]> {
  const q = query(buildsCol(uid), orderBy('updatedAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as UserBuild)
}

export async function saveBuild(uid: string, build: Build): Promise<string> {
  const now = new Date().toISOString()
  const ref = await addDoc(buildsCol(uid), {
    ...build,
    createdAt: build.createdAt ?? now,
    updatedAt: now,
  })
  return ref.id
}

export async function deleteBuild(uid: string, buildId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'builds', buildId))
}
