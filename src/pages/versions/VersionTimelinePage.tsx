import { useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePatchVersions } from '../../hooks/usePatchVersions'
import VersionTimeline from '../../components/timeline/VersionTimeline'

/**
 * 版本時間線（PLAN-050 A-4 / A-5）。
 *
 * 滿寬且不置中：內容是「甘特 55% ／ 活動卡片 45%」的左右主從分割（Phase C-1），
 * 兩欄各有自己的捲動軸。
 *
 * `/versions/timeline/:version` 是單一版本的深連結，而且**網址就是狀態** ——
 * Phase C-2 拆掉 clip-path modal 之後，畫面上顯示哪一版完全由網址決定，
 * 要比較兩個版本就開兩個分頁並排。
 */
export default function VersionTimelinePage() {
  const { data: versions, loading } = usePatchVersions()
  const { version } = useParams<{ version: string }>()
  const navigate = useNavigate()

  const handleSelectVersion = useCallback(
    (next: string) => {
      // 已經停在某個版本時用 replace：否則在版本選擇列上點五下，上一頁就要按五次
      // 才回得到進來之前的頁面。第一次選擇仍用 push，好讓上一頁能回到「當前版本」。
      navigate(`/versions/timeline/${encodeURIComponent(next)}`, { replace: Boolean(version) })
    },
    [navigate, version],
  )

  return (
    <div className="h-full w-full p-2">
      <VersionTimeline
        versions={versions}
        loading={loading}
        focusVersion={version}
        onSelectVersion={handleSelectVersion}
      />
    </div>
  )
}
