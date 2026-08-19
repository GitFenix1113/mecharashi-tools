import { usePatchVersions } from '../../hooks/usePatchVersions'
import VersionQuickTable from '../../components/versions/VersionQuickTable'

/**
 * 版本速覽（PLAN-050 A-4）。
 *
 * 置中 max-w-[1500px]：表格本身 `minWidth: 720px`，過去塞在首頁面板的
 * `min(96vw, max(48vw, 780px))` 裡幾乎永遠貼著下限、欄位擠成一團 ——
 * 十一個欄位（類別 ＋ 5 個版本 × 機師/機甲）在 780px 下每格只剩 60px。
 * 2026-08-19 站長定案首頁不再放資料之後，這裡是速覽表**唯一**的呈現位置，
 * 寬度就給到底，不必再跟背景立繪妥協。
 */
export default function VersionQuickPage() {
  const { data: versions, loading, error } = usePatchVersions()

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-2">
      <VersionQuickTable versions={versions} loading={loading} error={error} />
    </div>
  )
}
