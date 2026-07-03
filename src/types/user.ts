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

// ─── 配裝（Firestore userBuilds / 本地快取）───────────────────────────────────

export interface FloatingModSelection {
  stat: string
  condition: string | null
  value: number
}

export interface Build {
  buildName: string
  pilotId: string
  mechId: string
  weaponId: string
  backpackId: string
  modules: {
    slot4: string | null
    slot8: string | null
    fixed: string[]
  }
  weaponFixedMod: Record<string, number>
  weaponFloatingMod: FloatingModSelection[]
  triggerComponents: string[]
  effectComponents: string[]
  pilotResearch: Record<string, number>
  result?: Record<string, number>
  createdAt?: string | number
}

export interface UserBuild extends Build {
  id: string
  updatedAt: string
}
