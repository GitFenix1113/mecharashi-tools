import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useRaidSeason } from '../../hooks/useFirestore'
import { usePatchVersions } from '../../hooks/usePatchVersions'
import { usePageTitle } from '../../contexts/PageTitleContext'
import { RaidSeasonView } from '../../components/raids/RaidSeasonView'
import { raidRewardsFromTimeline } from '../../utils/raidView'
import { RAID_DIFFICULTY_ORDER, type RaidDifficulty } from '../../types/enums'

// ─── /raids/:seasonId 一期武裝討伐（PLAN-064 E-3）──────────────────────────────
// 難度記在網址參數 ?d=hell，方便分享「這一期的死境」。

export default function RaidSeasonPage() {
  const { seasonId } = useParams<{ seasonId: string }>()
  const [params, setParams] = useSearchParams()
  const { data, loading, error } = useRaidSeason(seasonId)
  const { data: versions } = usePatchVersions()
  usePageTitle(data ? `${data.season.name} 武裝討伐` : null)

  if (loading) {
    return <div className="max-w-6xl mx-auto px-4 py-16 text-center text-text-dim">載入中…</div>
  }
  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">
        <Link to="/raids" className="text-accent-cyan hover:underline text-sm">← 返回武裝討伐</Link>
        <div className="mt-8 bg-bg-card border border-border rounded-xl p-12 text-center text-text-dim">
          {error ? `載入失敗：${error.message}` : '找不到這一期武裝討伐'}
        </div>
      </div>
    )
  }

  const available = RAID_DIFFICULTY_ORDER.filter((d) => data.season.difficulties.includes(d))
  const asked = params.get('d') as RaidDifficulty | null
  const difficulty = asked && available.includes(asked) ? asked : available[0]

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">
      <Link to="/raids" className="text-accent-cyan hover:underline text-sm">← 武裝討伐</Link>
      <div className="mt-4">
        <RaidSeasonView
          season={data.season}
          stages={data.stages}
          bosses={data.bosses}
          related={data.related}
          rewards={raidRewardsFromTimeline(versions, data.season.name) ?? undefined}
          difficulty={difficulty}
          onDifficultyChange={(d) => setParams(d === available[0] ? {} : { d }, { replace: true })}
        />
      </div>
    </div>
  )
}
