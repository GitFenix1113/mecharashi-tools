import { revisionLabel, revOf } from '../../../utils/docRevision'
import type { LatestRevision } from '../../../hooks/useLatestRevision'

/** `2026-10-17T14:40:05.000Z` → `10-17 22:40`（本地時間）；沒有或格式不對就不顯示 */
function formatSavedAt(iso: unknown): string | null {
  if (typeof iso !== 'string') return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 故事館編輯面板的「有人比你先存」提示（PLAN-042-H 後續：存檔衝突檢查）。
 *
 * 表單的版本號（`baseRev`）和伺服器現況不一致時才出現：開面板時就發現（快取過期）、
 * 切回分頁時發現（另一個分頁剛存完），或存檔時被 saveWithRevision 擋下。
 * 三種情況都是同一件事——表單不是從現況改起的，直接存會整份蓋掉對方——所以只有一種提示。
 *
 * 只給「載入最新版」，**不給「仍要覆寫」**：協作者看不到稽核記錄（changeHistory 只開給管理者讀），
 * 一顆覆寫鍵等於讓人在不知道蓋掉什麼的情況下按下去。要保留的文字先複製出來、載入後再貼回去。
 */
export function LoreRevisionBanner({
  baseRev, latest, onReload,
}: {
  baseRev: number
  latest: LatestRevision
  onReload: () => void
}) {
  if (latest === undefined || revOf(latest) === baseRev) return null

  const savedAt = latest ? formatSavedAt(latest.updatedAt) : null
  return (
    <div role="alert" className="shrink-0 mb-3 rounded-lg border border-accent-yellow/50 bg-accent-yellow/10 px-3 py-2.5 text-xs">
      <p className="font-bold text-accent-yellow">⚠ 這份在你開啟之後被別人存過</p>
      <p className="mt-1 text-text-secondary leading-relaxed">
        {latest ? (
          <>
            你的表單是從<b className="text-text-primary">{revisionLabel(baseRev)}</b>改起的，
            伺服器上已經是<b className="text-text-primary">{revisionLabel(revOf(latest))}</b>
            {savedAt && <>（{savedAt} 存檔）</>}。
          </>
        ) : (
          <>伺服器上已經沒有這份文件（可能被管理者刪除）。</>
        )}
        直接存檔會被擋下——存檔是整份覆寫，會把對方的修改蓋掉。
      </p>
      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onReload}
          className="px-3 py-1 rounded-md font-bold bg-accent-yellow text-black hover:opacity-90 transition-opacity"
        >
          載入最新版
        </button>
        <span className="text-text-dim">會捨棄這個面板裡還沒存的修改；要保留的文字請先複製出來，載入後再貼回去。</span>
      </div>
    </div>
  )
}
