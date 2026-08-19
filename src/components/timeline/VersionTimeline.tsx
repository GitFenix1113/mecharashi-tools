import type { PatchVersion } from '../../data/patchVersions'
import VersionDetailView from './VersionDetailView'

interface Props {
  versions: PatchVersion[]
  loading: boolean
  /** 網址上的版本號（`/versions/timeline/:version`）。沒有就落在台服當前版本。 */
  focusVersion?: string
  /** 選了別的版本 —— 由頁面寫進網址。 */
  onSelectVersion: (version: string) => void
}

/**
 * 版本時間線（PLAN-050 C-2 之後）。
 *
 * 這裡曾經是一個焦點輪播 ＋ clip-path 圓形展開的 modal：進站要先滾到目標版本、
 * 點中央項目、等動畫，才看得到甘特 —— 四步。而且 modal 讓「比較兩個版本」不可能。
 *
 * 現在它只做一件事：把「網址上的版本」翻譯成「要顯示哪一版」。
 * **網址是唯一真相**，元件內部不再持有 activeIndex ——
 * 這順帶消滅了原本那個「靜態 fallback 先到、didInit 燒掉、真資料到了也不重新對焦」
 * 的老 bug：純衍生值會跟著資料自動更新，沒有可以燒掉的旗標。
 */
export default function VersionTimeline({ versions, loading, focusVersion, onSelectVersion }: Props) {
  if (versions.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-dim text-sm">
        {loading ? '載入版本資料…' : '尚無版本資料'}
      </div>
    )
  }

  const paramIndex = focusVersion ? versions.findIndex(v => v.version === focusVersion) : -1
  const twCurrentIndex = versions.findIndex(v => v.isTwCurrent)
  // 網址指定 > 台服當前 > 第一個。網址指到不存在的版本時退回當前版本而不是空畫面：
  // 舊連結（版本號改名／資料被刪）仍然看得到東西。
  const activeIndex = paramIndex >= 0 ? paramIndex : Math.max(0, twCurrentIndex)

  return (
    <div className="h-full flex flex-col min-h-0 relative">
      {loading && (
        <div className="absolute top-0 left-0 right-0 h-0.5 z-30 overflow-hidden">
          <div className="h-full bg-accent-orange animate-pulse w-full opacity-60" />
        </div>
      )}
      <VersionDetailView
        versions={versions}
        activeIndex={activeIndex}
        onNavigate={(idx) => onSelectVersion(versions[idx].version)}
      />
    </div>
  )
}
