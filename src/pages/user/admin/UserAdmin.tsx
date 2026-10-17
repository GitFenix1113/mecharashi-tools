import { useState, useEffect } from 'react'
import type { ProfileRole, UserProfile } from '../../../types'
import { getAllUsers, updateUserRole } from '../../../lib/userApi'
import { ASSIGNABLE_ROLES, ROLE_LABEL } from '../../../utils/userRole'

// 角色徽章配色。故事館協作編輯沿用編輯台的 cyan（後台首頁那張「機師故事館」卡片同色）。
const ROLE_BADGE: Record<ProfileRole, string> = {
  OWNER:       'text-amber-400 bg-amber-400/10 border-amber-400/30',
  ADMIN:       'text-accent-orange bg-accent-orange/10 border-accent-orange/30',
  LORE_EDITOR: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30',
  USER:        'text-text-dim bg-bg-card border-border',
}

export default function UserAdmin({ currentUid }: { currentUid: string }) {
  const [users, setUsers]           = useState<UserProfile[]>([])
  const [hasMore, setHasMore]       = useState(false)
  const [usersLoading, setUsersLoading] = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [updatingUid, setUpdatingUid] = useState<string | null>(null)

  useEffect(() => {
    getAllUsers()
      .then(({ users, hasMore }) => { setUsers(users); setHasMore(hasMore) })
      .catch((e: unknown) =>
        setError(
          e instanceof Error
            ? e.message
            : '載入用戶失敗（請確認 Firestore 規則允許管理者讀取 users 集合群組）'
        )
      )
      .finally(() => setUsersLoading(false))
  }, [])

  // 原本是 USER ⇄ ADMIN 的切換鈕；PLAN-042-H 多了 LORE_EDITOR，改成下拉選單。
  // 只有 OWNER 改得動別人的 role（rules 的 isOwnerRole()），OWNER 本身與自己不提供選單。
  async function handleChangeRole(uid: string, next: ProfileRole) {
    if (uid === currentUid) return
    setUpdatingUid(uid)
    try {
      await updateUserRole(uid, next)
      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, role: next } : u)))
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失敗')
    } finally {
      setUpdatingUid(null)
    }
  }

  if (usersLoading) return <p className="text-text-dim text-sm">載入用戶列表...</p>
  if (error) return <p className="text-accent-red text-sm">⚠ {error}</p>

  return (
    <div>
      <p className="text-text-dim text-xs mb-4">
        顯示 {users.length} 位用戶{hasMore && '（已達上限 200 筆，實際用戶數更多）'}
      </p>
      <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
        {users.map((u) => (
          <div
            key={u.uid}
            className="bg-bg-dark border border-border rounded-lg px-4 py-3 flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-full bg-accent-orange/20 border border-accent-orange/30 flex items-center justify-center text-sm font-bold text-accent-orange shrink-0">
              {(u.displayName?.[0] ?? u.email?.[0] ?? '?').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-text-primary truncate">
                  {u.displayName || '（未設定）'}
                </span>
                {u.uid === currentUid && (
                  <span className="text-[13px] px-1.5 py-0.5 rounded bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/30 shrink-0">
                    你
                  </span>
                )}
              </div>
              <p className="text-xs text-text-dim truncate">{u.email}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`text-[14px] px-2 py-0.5 rounded border font-medium ${ROLE_BADGE[u.role] ?? ROLE_BADGE.USER}`}
                title={ROLE_LABEL[u.role]}
              >
                {u.role}
              </span>
              {u.uid !== currentUid && u.role !== 'OWNER' && (
                <select
                  value={u.role}
                  onChange={(e) => void handleChangeRole(u.uid, e.target.value as ProfileRole)}
                  disabled={updatingUid === u.uid}
                  aria-label={`變更 ${u.displayName || u.email} 的角色`}
                  className="text-xs px-2 py-1 rounded border border-border bg-bg-dark text-text-secondary hover:border-border-accent transition-colors disabled:opacity-40"
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <p className="text-text-dim text-sm text-center py-8">找不到用戶資料</p>
        )}
      </div>
    </div>
  )
}
