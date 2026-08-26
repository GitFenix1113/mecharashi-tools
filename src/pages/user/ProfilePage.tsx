import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useSimulatorEntryVisible } from '../../hooks/useSimulatorEntry'
import { getUserBuilds, deleteBuild } from '../../lib/userApi'
import type { UserBuild } from '../../types'
import AvatarDisplay from '../../components/profile/AvatarDisplay'
import AvatarPicker from '../../components/profile/AvatarPicker'
import ProfileEditForm from '../../components/profile/ProfileEditForm'

type Tab = 'profile' | 'builds'

export default function ProfilePage() {
  const { user, userProfile, loading, signOut, openAuthModal, refreshProfile } = useAuth()
  const navigate = useNavigate()
  // 模擬器內部測試期間收起入口；已存的配裝仍可載入（BuildCard 的 onLoad 不受影響）
  const simulatorEntryVisible = useSimulatorEntryVisible()
  const [tab, setTab] = useState<Tab>('profile')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [builds, setBuilds] = useState<UserBuild[]>([])
  const [buildsLoading, setBuildsLoading] = useState(false)
  const [buildsLoaded, setBuildsLoaded] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!user || tab !== 'builds' || buildsLoaded) return
    setBuildsLoading(true)
    getUserBuilds(user.uid)
      .then(setBuilds)
      .catch(console.error)
      .finally(() => {
        setBuildsLoading(false)
        setBuildsLoaded(true)
      })
  }, [user, tab, buildsLoaded])

  const handleDelete = async (buildId: string) => {
    if (!user || !confirm('確定要刪除此配裝？')) return
    setDeletingId(buildId)
    try {
      await deleteBuild(user.uid, buildId)
      setBuilds((prev) => prev.filter((b) => b.id !== buildId))
    } catch (e) {
      console.error(e)
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">
        <div className="text-center py-20 text-text-dim">載入中...</div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">
        <div className="mb-8">
          <span className="text-xs text-accent-orange tracking-[3px] uppercase font-[Orbitron,sans-serif]">User</span>
          <h1 className="text-3xl font-bold mt-2">個人中心</h1>
        </div>
        <div className="bg-bg-card border border-border rounded-xl p-10 text-center">
          <div className="text-5xl mb-4">🔐</div>
          <h2 className="text-xl font-bold mb-2">請先登入</h2>
          <p className="text-text-dim text-sm mb-6">
            登入後可儲存配裝紀錄，以及管理個人資料。
          </p>
          <button
            onClick={openAuthModal}
            className="px-6 py-3 bg-accent-orange text-white rounded-xl font-medium hover:bg-accent-orange/80 transition-colors cursor-pointer"
          >
            登入 / 註冊
          </button>
        </div>
      </div>
    )
  }

  // Google 用戶判斷：Firebase Auth 的 photoURL 存在（第三方登入）
  const googlePhotoUrl = user.photoURL ?? null

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">
      <div className="mb-6">
        <span className="text-xs text-accent-orange tracking-[3px] uppercase font-[Orbitron,sans-serif]">User</span>
        <h1 className="text-3xl font-bold mt-2">個人中心</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 mb-6 border-b border-border">
        {([['profile', '個人資料'], ['builds', '我的配裝']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer border-b-2 -mb-px ${
              tab === key
                ? 'border-accent-orange text-accent-orange'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── 個人資料 Tab ── */}
      {tab === 'profile' && userProfile && (
        <div className="flex flex-col gap-6">
          {/* Avatar section */}
          <div className="bg-bg-card border border-border rounded-xl p-6 flex flex-col items-center gap-4">
            <AvatarDisplay profile={userProfile} size="lg" />
            <button
              onClick={() => setPickerOpen(true)}
              className="px-4 py-2 text-sm bg-bg-dark border border-border rounded-lg text-text-secondary hover:text-text-primary hover:border-border-accent transition-colors cursor-pointer"
            >
              更換頭像
            </button>
            {/* Email 唯讀 */}
            <div className="text-xs text-text-dim">{user.email}</div>
          </div>

          {/* 登出按鈕 */}
          <div className="flex justify-end">
            <button
              onClick={signOut}
              className="px-4 py-2 text-sm bg-bg-dark text-text-dim border border-border rounded-lg hover:text-text-primary hover:border-border-accent transition-colors cursor-pointer"
            >
              登出
            </button>
          </div>

          {/* Profile form */}
          <div className="bg-bg-card border border-border rounded-xl p-6">
            <h2 className="text-sm font-bold text-text-secondary mb-4 uppercase tracking-[2px] font-[Orbitron,sans-serif]">
              個人資料
            </h2>
            <ProfileEditForm
              profile={userProfile}
              uid={user.uid}
              onSaved={refreshProfile}
            />
          </div>
        </div>
      )}

      {/* ── 我的配裝 Tab ── */}
      {tab === 'builds' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">我的配裝紀錄</h2>
            {simulatorEntryVisible && (
              <Link
                to="/simulator"
                className="text-sm text-accent-orange no-underline hover:text-accent-orange/80 transition-colors"
              >
                + 新增配裝
              </Link>
            )}
          </div>

          {buildsLoading ? (
            <div className="bg-bg-card border border-border rounded-xl p-8 text-center text-text-dim">
              載入配裝中...
            </div>
          ) : builds.length === 0 ? (
            <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
              <div className="text-3xl mb-3">📋</div>
              <p className="text-text-dim text-sm">尚無儲存的配裝</p>
              {simulatorEntryVisible && (
                <Link
                  to="/simulator"
                  className="inline-block mt-4 px-4 py-2 text-sm bg-accent-orange/10 text-accent-orange border border-accent-orange/30 rounded-lg hover:bg-accent-orange/20 transition-colors no-underline"
                >
                  前往配裝模擬器
                </Link>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {builds.map((build) => (
                <BuildCard
                  key={build.id}
                  build={build}
                  deleting={deletingId === build.id}
                  onDelete={() => handleDelete(build.id)}
                  onLoad={() => navigate('/simulator', { state: { build } })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Avatar Picker Modal */}
      {userProfile && (
        <AvatarPicker
          isOpen={pickerOpen}
          uid={user.uid}
          currentPilotId={userProfile.avatarPilotId}
          googlePhotoUrl={googlePhotoUrl}
          onSuccess={refreshProfile}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

function BuildCard({
  build,
  deleting,
  onDelete,
  onLoad,
}: {
  build: UserBuild
  deleting: boolean
  onDelete: () => void
  onLoad: () => void
}) {
  const date = build.updatedAt
    ? new Date(build.updatedAt).toLocaleDateString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—'

  const pilotName = build.pilotId?.replace(/^pilot_\d+_/, '') ?? null
  const mechName = build.mechId?.replace(/^mech_/, '') ?? null

  return (
    <div className="bg-bg-card border border-border rounded-xl p-4 flex items-start gap-4 hover:border-border-accent transition-colors">
      <div className="flex-1 min-w-0">
        <div className="font-bold text-base truncate">{build.buildName || '未命名配裝'}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
          {pilotName && (
            <span className="text-[13px] text-text-dim">
              機師: <span className="text-text-secondary">{pilotName}</span>
            </span>
          )}
          {mechName && (
            <span className="text-[13px] text-text-dim">
              機甲: <span className="text-text-secondary">{mechName}</span>
            </span>
          )}
          {build.weaponId && (
            <span className="text-[13px] text-text-dim">
              武器: <span className="text-text-secondary">{build.weaponId}</span>
            </span>
          )}
        </div>
        <div className="text-[13px] text-text-dim mt-1.5">更新：{date}</div>
      </div>
      <div className="shrink-0 flex flex-col gap-1 items-end">
        <button
          onClick={onLoad}
          className="px-3 py-1.5 text-xs font-medium bg-accent-orange/10 text-accent-orange border border-accent-orange/30 rounded-lg hover:bg-accent-orange/20 transition-colors cursor-pointer"
        >
          載入配裝
        </button>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="p-1.5 text-text-dim hover:text-accent-red transition-colors cursor-pointer disabled:opacity-40"
          title="刪除配裝"
        >
          {deleting ? '...' : '🗑️'}
        </button>
      </div>
    </div>
  )
}
