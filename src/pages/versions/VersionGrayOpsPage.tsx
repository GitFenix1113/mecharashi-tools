import GrayOpsPanel from '../../components/versions/GrayOpsPanel'

/**
 * 灰燼行動未來機甲一覽（PLAN-050 A-4）。
 *
 * 比 Quick Table 再寬一點（1400px）：內容是 `lg:grid-cols-4` 的四公司並排，
 * 每欄放的是機甲名 + 圖示，欄寬越窄越容易換行。資料自己會 `ensureLoaded`，
 * 本頁不需要傳任何 props。
 */
export default function VersionGrayOpsPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-2">
      <GrayOpsPanel />
    </div>
  )
}
