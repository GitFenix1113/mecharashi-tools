// ─── 用戶系統（Phase 5）────────────────────────────────────────────────────────

import type { GameServer } from './enums'
import type { UserResearchLevels } from './research'

// ─── 圖鑑列表檢視偏好 ─────────────────────────────────────────────────────────
// compact = 極簡（頭像+名），detailed = 詳細卡片。分頁各自記憶。
export type ViewMode = 'compact' | 'detailed'
export type ViewPrefsKey = 'pilots' | 'mechs'
export type ViewPrefs = Partial<Record<ViewPrefsKey, ViewMode>>

export interface UserProfile {
  uid: string
  displayName: string
  email: string
  photoURL?: string
  role: 'USER' | 'ADMIN' | 'OWNER'
  researchLevels: UserResearchLevels
  createdAt: string
  updatedAt: string
  // PLAN-011 個人檔案管理
  avatarType?: 'upload' | 'pilot' | 'google' | null
  avatarUrl?: string | null
  avatarPilotId?: string | null
  gameNickname?: string | null
  gameServer?: GameServer | null
  guild?: string | null
  // 圖鑑列表檢視偏好（機師/機甲各自記憶，登入時同步至帳戶）
  viewPrefs?: ViewPrefs
}

// ─── 首頁維護團隊（PLAN-051）──────────────────────────────────────────────────
// 匿名訪客拿得到的 profile 子集。Firestore 沒有欄位級讀取授權，因此 profile 的讀取
// 已收回 isAdmin()，這份資料改由 Worker /api/site-team 以 Admin 憑證代讀後過濾供應。
// 型別在此收窄是刻意的：讓型別系統擋住「以為這裡拿得到 email」的誤用。
// ⚠ 對應 workers/src/index.ts 的 SITE_TEAM_FIELDS，兩邊要一起改。
export type SiteTeamMember = Pick<
  UserProfile,
  | 'uid'
  | 'displayName'
  | 'role'
  | 'photoURL'
  | 'avatarType'
  | 'avatarUrl'
  | 'avatarPilotId'
  | 'gameNickname'
  | 'gameServer'
  | 'guild'
>
