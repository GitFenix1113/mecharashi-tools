import { Link } from 'react-router-dom'
import { useRaidSeasons } from '../../hooks/useFirestore'
import { usePatchVersions } from '../../hooks/usePatchVersions'
import { RaidSeasonCard, RaidStatusChip } from '../../components/raids/RaidSeasonCard'
import { raidRewardsFromTimeline } from '../../utils/raidView'

// ─── /raids 武裝討伐期列表（PLAN-064 E-2）────────────────────────────────────
//
// 只載 raidSeasons（小）＋時間線（取獎勵）；期詳情才載 stages／bosses。
// 時間線有收錄的期（v2.8 起）畫成卡片；更早的期收成精簡列——台版都已開放，資訊密度低。

export default function RaidsPage() {
  const { data: seasons, loading, error } = useRaidSeasons()
  const { data: versions } = usePatchVersions()
  const featured = seasons.filter((s) => s.twVersion)
  const earlier = seasons.filter((s) => !s.twVersion)

  return (
    <div className="max-w-7xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">
      <div className="mb-6">
        <span className="text-xs text-accent-orange tracking-[3px] uppercase font-[Orbitron,sans-serif]">Armament Raid</span>
        <h1 className="text-3xl font-bold mt-2">武裝討伐</h1>
        <p className="text-text-secondary mt-2">
          每期 4 個關卡組、最多 4 種難度。首領、增援與懸賞依陸版遊戲資料整理，首領面板為推算值。
        </p>
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-3 text-[11.5px] text-text-dim">
          <span className="inline-flex items-center gap-1.5"><span className="px-1.5 py-px rounded border border-accent-green/40 text-accent-green">台版 日期</span>台版已開放</span>
          <span className="inline-flex items-center gap-1.5"><span className="px-1.5 py-px rounded border border-dashed border-accent-yellow/60 text-accent-yellow">台版預計 日期</span>依時間線推估、尚未開放</span>
          <span className="inline-flex items-center gap-1.5"><span className="border-b border-dashed border-text-dim/70">虛線底線</span>譯名待校</span>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-text-dim">載入中…</div>
      ) : error ? (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center text-text-dim">載入失敗：{error.message}</div>
      ) : seasons.length === 0 ? (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center text-text-dim">武裝討伐資料整理中，敬請期待。</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((s) => (
              <RaidSeasonCard key={s.id} season={s} rewards={raidRewardsFromTimeline(versions, s.name)} />
            ))}
          </div>
          {earlier.length > 0 && (
            <div className="mt-8">
              <h2 className="text-[15px] font-bold text-text-primary mb-2">更早的期數（台版皆已開放）</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {earlier.map((s) => (
                  <Link
                    key={s.id}
                    to={`/raids/${s.id}`}
                    className="flex items-center gap-2 rounded-lg border border-border bg-bg-card hover:bg-bg-card-hover hover:border-border-accent px-3 py-2 no-underline transition-colors"
                  >
                    <span className="text-[11px] text-text-dim font-[Orbitron,sans-serif] w-8">#{s.seq}</span>
                    <span className="text-[13.5px] font-bold text-text-primary truncate">{s.name}</span>
                    <span className="ml-auto text-[10.5px] text-text-dim truncate">{s.subtitleEn}</span>
                    {s.twStatus === 'planned' && <RaidStatusChip season={s} />}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
