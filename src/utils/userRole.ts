// ─── 使用者角色判斷（PLAN-042-H 故事館協作編輯）─────────────────────────────────
//
// 角色的判斷原本散在各處、一律手寫 `role === 'ADMIN' || role === 'OWNER'`。多了
// LORE_EDITOR 之後，「誰能進後台」與「誰能編故事館」不再是同一群人，再手寫下去
// 遲早有一處漏改——這裡收成兩支 helper，新寫的判斷一律走這裡。
//
// ⚠ 這些都只是 **UI 層**的門（藏入口、擋路由）。真正的防線是 firestore.rules 的
//   isAdmin()／canEditLore()，兩邊的角色清單要一起改。

import type { ProfileRole } from '../types'

type MaybeRole = ProfileRole | null | undefined

/** 後台全區（遊戲資料、使用統計、公告審核…）：ADMIN／OWNER。 */
export const isAdminRole = (role: MaybeRole): boolean =>
  role === 'ADMIN' || role === 'OWNER'

/** 故事館編輯台（/admin/lore）：管理者之外，再加故事館協作編輯。 */
export const canEditLore = (role: MaybeRole): boolean =>
  isAdminRole(role) || role === 'LORE_EDITOR'

/** 使用者管理的顯示名稱。 */
export const ROLE_LABEL: Record<ProfileRole, string> = {
  USER:        '一般用戶',
  LORE_EDITOR: '故事館協作編輯',
  ADMIN:       '管理者',
  OWNER:       '網站擁有者',
}

/**
 * OWNER 在使用者管理能指派的角色。刻意不含 OWNER：
 * 擁有者的移轉不該是下拉選單裡的一個選項（rules 雖然允許，UI 不提供）。
 */
export const ASSIGNABLE_ROLES: readonly ProfileRole[] = ['USER', 'LORE_EDITOR', 'ADMIN']
