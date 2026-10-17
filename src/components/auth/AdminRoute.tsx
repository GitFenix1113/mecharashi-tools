import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { canEditLore, isAdminRole } from '../../utils/userRole'

/**
 * @param ownerOnly 只放行 OWNER（PLAN-045：系統日誌含維護者的裝置指紋，
 *                  不該讓其他 ADMIN 互看）。**這只是 UI 層的第一道門**，
 *                  真正的防線是 firestore.rules 的 isOwnerRole()。
 * @param lore      故事館編輯台：另外放行 LORE_EDITOR（PLAN-042-H）。
 *                  同樣只是 UI 層的門，防線是 rules 的 canEditLore()。
 */
export default function AdminRoute({
  children,
  ownerOnly = false,
  lore = false,
}: {
  children: ReactNode
  ownerOnly?: boolean
  lore?: boolean
}) {
  const { user, userProfile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="text-text-dim text-sm">驗證中...</p>
      </div>
    )
  }

  const role = userProfile?.role
  const allowed = ownerOnly ? role === 'OWNER' : lore ? canEditLore(role) : isAdminRole(role)
  if (!user || !allowed) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
