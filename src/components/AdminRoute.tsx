import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'

/**
 * @param ownerOnly 只放行 OWNER（PLAN-045：系統日誌含維護者的裝置指紋，
 *                  不該讓其他 ADMIN 互看）。**這只是 UI 層的第一道門**，
 *                  真正的防線是 firestore.rules 的 isOwnerRole()。
 */
export default function AdminRoute({
  children,
  ownerOnly = false,
}: {
  children: ReactNode
  ownerOnly?: boolean
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
  const allowed = ownerOnly ? role === 'OWNER' : role === 'ADMIN' || role === 'OWNER'
  if (!user || !allowed) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
