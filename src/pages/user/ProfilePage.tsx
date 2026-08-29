import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useSimulatorEntryVisible } from '../../hooks/useSimulatorEntry'
import AvatarDisplay from '../../components/profile/AvatarDisplay'
import AvatarPicker from '../../components/profile/AvatarPicker'
import ProfileEditForm from '../../components/profile/ProfileEditForm'
import CloudBuildList from '../../components/profile/CloudBuildList'

type Tab = 'profile' | 'builds'

export default function ProfilePage() {
  const { user, userProfile, loading, signOut, openAuthModal, refreshProfile } = useAuth()
  // 模擬器內部測試期間收起入口（PLAN-052 總綱）
  const simulatorEntryVisible = useSimulatorEntryVisible()
  const [tab, setTab] = useState<Tab>('profile')
  const [pickerOpen, setPickerOpen] = useState(false)

  // ⚠ 「我的配裝」列的是**雲端書架**（PLAN-052-E C-6）。v1 `Build` 那條路徑
  //   （`userApi.getUserBuilds` ＋ `BuildCard` ＋ `navigate('/simulator', { state: { build } })`）
  //   已於 B-6 整條刪除 —— 集合實測 0 筆，沒有東西要遷。
  //   ⚠ 清單獨立成 `CloudBuildList` 並**只在分頁開啟時掛載**：它要載入六個遊戲資料集合
  //   才解得開代碼，寫在這裡會變成「只是開個人資料頁也把整個遊戲資料庫拉一次」。

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

          <CloudBuildList uid={user.uid} />
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
