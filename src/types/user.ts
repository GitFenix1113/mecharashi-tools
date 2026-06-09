// ─── 用戶系統（Phase 5）────────────────────────────────────────────────────────

import type { GameServer } from './enums'
import type { UserResearchLevels } from './research'

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
