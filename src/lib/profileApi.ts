import { doc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import { uploadImage } from './imageUpload'
import type { GameServer } from '../types/enums'

const profileDoc = (uid: string) => doc(db, 'users', uid, 'profile', 'main')

// ── 公開 API ──────────────────────────────────────────────────────────────────

/** 上傳頭像：壓縮為 WebP → Cloudinary → 更新 profile */
export async function uploadAvatar(uid: string, file: File): Promise<void> {
  const secureUrl = await uploadImage(file, 'avatars')

  await updateDoc(profileDoc(uid), {
    avatarType:    'upload',
    avatarUrl:     secureUrl,
    avatarPilotId: null,
  })
}

/** 選取機師頭像：更新 avatarType='pilot'，不儲存靜態 URL */
export async function setPilotAvatar(uid: string, pilotId: string): Promise<void> {
  await updateDoc(profileDoc(uid), {
    avatarType:    'pilot',
    avatarPilotId: pilotId,
    avatarUrl:     null,
  })
}

/** 使用 Google 帳號頭像（第三方登入用戶專屬） */
export async function setGoogleAvatar(uid: string): Promise<void> {
  await updateDoc(profileDoc(uid), {
    avatarType:    'google',
    avatarUrl:     null,
    avatarPilotId: null,
  })
}

export interface ProfileInfoUpdate {
  displayName?:  string
  gameNickname?: string | null
  gameServer?:   GameServer | null
  guild?:        string | null
}

/** 更新個人資料文字欄位，空字串轉為 null */
export async function updateProfileInfo(uid: string, data: ProfileInfoUpdate): Promise<void> {
  const payload: Record<string, unknown> = {}

  if (data.displayName !== undefined) {
    payload.displayName = data.displayName.trim() || null
  }
  if ('gameNickname' in data) {
    payload.gameNickname = data.gameNickname?.trim() || null
  }
  if ('gameServer' in data) {
    payload.gameServer = data.gameServer ?? null
  }
  if ('guild' in data) {
    payload.guild = data.guild?.trim() || null
  }

  payload.updatedAt = new Date().toISOString()
  await updateDoc(profileDoc(uid), payload)
}
