import { useAuth } from '../contexts/AuthContext'
import type { LogoutReason } from '../lib/diag/sentinel'

// ── 非預期登出橫幅（PLAN-045 Phase E-1）───────────────────────────────────────
//
// 為什麼一定要有這個：維護者不看主控台，也看不到 OWNER 限定的系統日誌頁。
// 若診斷成果只進得了後台記錄，對他們而言體驗毫無改善——仍然是「莫名其妙被登出」。
//
// 文案原則：講**現象與下一步**，不講機制。使用者不需要知道什麼是 IndexedDB，
// 他需要知道的是「這不是我的錯」「我的東西還在不在」「現在該做什麼」。

/** 各成因的白話說明與建議。刻意不出現任何技術術語。 */
const NOTICE: Record<LogoutReason, { title: string; detail: string } | null> = {
  storageCleared: {
    title: '瀏覽器清除了本站的儲存資料，所以登入狀態沒了',
    detail: '常見於裝置空間不足、或瀏覽器的隱私設定定期清理。重新登入即可繼續。',
  },
  idbEvicted: {
    title: '瀏覽器清掉了本站的登入資料',
    detail: '通常是裝置空間不足時自動清理造成的。重新登入即可繼續。',
  },
  tokenRevoked: {
    title: '登入憑證已失效',
    detail: '若你最近變更過密碼，這是正常現象。否則請重新登入一次。',
  },
  unknown: {
    title: '登入狀態中斷了',
    detail: '原因無法判定。重新登入即可繼續，若頻繁發生請告知網站管理者。',
  },
  // 這兩種不會走到橫幅（AuthContext 已擋掉），列出來只為型別完整
  explicit: null,
  neverSignedIn: null,
}

export default function SignedOutBanner() {
  const { logoutNotice, dismissLogoutNotice, openAuthModal } = useAuth()
  if (!logoutNotice) return null

  const notice = NOTICE[logoutNotice.reason]
  if (!notice) return null

  return (
    <div className="px-4 pt-3">
      <div className="max-w-5xl mx-auto px-4 py-3 rounded-xl border border-accent-yellow/40 bg-accent-yellow/10 flex items-start gap-3 flex-wrap">
        <span className="text-accent-yellow text-lg shrink-0 leading-6">⚠</span>
        <div className="flex-1 min-w-[240px]">
          <div className="text-sm text-text-primary font-bold">{notice.title}</div>
          <div className="text-xs text-text-secondary mt-1 leading-relaxed">{notice.detail}</div>
          {/* 只在真的有草稿時才提——沒草稿卻這樣寫，只會讓人去找一個不存在的還原入口 */}
          {logoutNotice.hadDraft && (
            <div className="text-xs text-accent-green mt-1.5">
              ✓ 你未儲存的編輯已暫存在這台裝置，重新登入後回到該編輯頁就能還原。
            </div>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={openAuthModal}
            className="px-4 py-1.5 rounded-lg text-xs font-bold bg-accent-yellow/20 text-accent-yellow border border-accent-yellow/40 hover:bg-accent-yellow/30 transition-colors"
          >
            重新登入
          </button>
          <button
            onClick={dismissLogoutNotice}
            className="px-3 py-1.5 rounded-lg text-xs border border-border text-text-secondary hover:bg-bg-dark transition-colors"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  )
}
