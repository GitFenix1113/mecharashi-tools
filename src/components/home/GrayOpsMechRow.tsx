import { useReference } from '../../contexts/ReferenceContext'
import { FallbackImage } from '../common/FallbackImage'
import { imageCandidates } from '../../utils/assets'
import type { GrayOpsMechEntry } from '../../types'

/** 無圖（或候選全數失敗）時的等寬佔位，讓有圖無圖混排時名稱左緣仍對齊 */
const placeholder = (
  <span aria-hidden="true" className="w-6 h-6 shrink-0 rounded border border-dashed border-border/40" />
)

/**
 * 灰燼行動名單的一列：圖示 + 機甲名 + 版本徽章。
 *
 * 與版本濃縮表的 RefThumbnail 是**刻意分開**的兩個元件，不是重複實作。那邊「有圖顯圖、
 * 無圖才顯文字」是二選一（表格窄，圖與名稱只能擇一佔位）；這裡圖示是可選前綴、名稱與版本
 * 永遠都在。共用同一個元件就得把兩種版面塞進同一組 props，反而更難改。
 *
 * 共用的是**判斷規則**——「可不可點」與「顯不顯示圖」是兩條獨立的軸：
 *
 *   有圖 + 有 ID → 圖 + 名稱，可點        無圖 + 有 ID → 佔位 + 名稱，仍可點
 *   有圖 + 無 ID → 圖 + 名稱，不可點      無圖 + 無 ID → 佔位 + 名稱（未來機甲的常態）
 *
 * 圖走 FallbackImage + imageCandidates 而非裸 <img>：entry.icon 是後台同步當下從
 * mechs 集合複製的**快照**，會與圖庫各自漂移（爬蟲至今仍把 portrait 寫成 .png，實體檔案
 * 早已是 .webp）。少了逐層退回，這裡會變成全站唯一一處「機甲圖在別頁都好、只有這張表沒圖」
 * 的地方，而後台狀態燈還顯示綠色。候選用盡才退回佔位，破圖不破版，也不影響該列還能不能點。
 */
export default function GrayOpsMechRow({ entry }: { entry: GrayOpsMechEntry }) {
  const { hoverRef, leaveRef, pinRef } = useReference()

  const clickable = !!entry.mechId

  const inner = (
    <>
      {entry.icon ? (
        <FallbackImage
          candidates={imageCandidates(entry.icon)}
          fallback={placeholder}
          alt=""
          aria-hidden="true"
          className="w-6 h-6 shrink-0 rounded border border-border/50 object-cover object-top group-hover:border-accent-orange transition-colors"
        />
      ) : placeholder}
      <span
        className={
          'text-[13px] leading-tight truncate text-text-secondary '
          + (clickable
            ? 'underline underline-offset-2 decoration-dotted decoration-border group-hover:text-text-primary transition-colors'
            : '')
        }
      >
        {entry.name}
      </span>
      {entry.version && (
        <span className="text-[11px] text-accent-cyan border border-accent-cyan/30 px-1 rounded leading-tight shrink-0">
          {entry.version}
        </span>
      )}
    </>
  )

  if (!clickable) {
    return <div className="flex items-center gap-1.5 min-w-0">{inner}</div>
  }

  // 詳情不自己畫：交給 PLAN-019 的引用浮窗（EntityRefView），它已能解析 mech 並提供
  // 「查看完整詳情」導流。資料是點開才 ensureLoaded('mechs')，首頁掛載時不多讀任何集合。
  return (
    <button
      type="button"
      title={`查看「${entry.name}」`}
      onMouseEnter={e => hoverRef({ refType: 'mech', refId: entry.mechId! }, e.currentTarget)}
      onMouseLeave={leaveRef}
      onClick={e => { e.stopPropagation(); pinRef({ refType: 'mech', refId: entry.mechId! }, e.currentTarget) }}
      className="group flex items-center gap-1.5 min-w-0 w-full text-left bg-transparent border-0 p-0 cursor-pointer"
    >
      {inner}
    </button>
  )
}
