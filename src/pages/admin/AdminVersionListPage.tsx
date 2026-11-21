import { Link } from 'react-router-dom'
import { usePatchVersions } from '../../hooks/usePatchVersions'
import type { PatchVersion } from '../../data/patchVersions'
import { halvesOf, halfListOf } from '../../data/patchVersions/halves'

/** 每一段 × 兩服各算一格；三段版本（週年）就是 6 格 */
function activityProgress(v: PatchVersion) {
  const halves = halfListOf(v)
  const slots = halves.flatMap(h => [h.cnActivities, h.twActivities])
  const filled = slots.filter(list => (list?.length ?? 0) > 0).length
  const total = slots.length
  return {
    filled,
    total,
    pct: total ? Math.round((filled / total) * 100) : 0,
    cnCount: halves.reduce((n, h) => n + (h.cnActivities?.length ?? 0), 0),
    twCount: halves.reduce((n, h) => n + (h.twActivities?.length ?? 0), 0),
  }
}

export default function AdminVersionListPage() {
  const { data: versions, loading } = usePatchVersions()
  const sorted = [...versions].reverse()

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">

      {/* 麵包屑 */}
      <div className="flex items-center gap-2 text-xs text-text-dim mb-4">
        <Link to="/admin" className="hover:text-text-secondary transition-colors no-underline">後台管理</Link>
        <span>›</span>
        <span className="text-accent-purple">版本列表</span>
      </div>

      {/* 頁首 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-[10px] font-[Orbitron,sans-serif] tracking-[3px] text-accent-purple uppercase mb-1">
            Admin · Version Management
          </div>
          <h1 className="text-2xl font-bold text-text-primary">版本列表</h1>
          <p className="text-text-dim text-sm mt-1">{versions.length} 個版本</p>
        </div>
        <Link
          to="/admin/versions/new"
          className="px-4 py-2 bg-accent-purple text-white text-sm font-bold rounded-lg hover:opacity-90 transition-opacity no-underline"
        >
          + 建立新版本
        </Link>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-bg-card border border-border rounded-xl h-24 animate-pulse" />
          ))}
        </div>
      )}

      {/* 版本卡片列表 */}
      {!loading && (
        <div className="space-y-3">
          {sorted.map((v) => {
            const { filled, total, pct, cnCount, twCount } = activityProgress(v)
            const barColor = pct === 100 ? 'bg-accent-green' : pct >= 50 ? 'bg-accent-yellow' : 'bg-text-dim'
            const pctColor = pct === 100 ? 'text-accent-green' : pct >= 50 ? 'text-accent-yellow' : 'text-text-dim'

            return (
              <Link
                key={v.version}
                to={`/admin/versions/${v.version}`}
                className="block bg-bg-card border border-border rounded-xl px-5 py-4 hover:border-accent-purple/40 hover:bg-bg-card-hover transition-colors group no-underline"
              >
                <div className="flex items-start gap-4">
                  {/* 版本號 */}
                  <div className="shrink-0 w-24">
                    <span className="font-[Orbitron,sans-serif] text-lg font-bold text-accent-orange">
                      v{v.version}
                    </span>
                    {v.name && (
                      <div className="text-xs text-text-secondary mt-0.5">{v.name}</div>
                    )}
                  </div>

                  {/* 標籤 + 日期 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      {v.isTwCurrent && (
                        <span className="px-2 py-0.5 text-xs font-bold rounded bg-accent-green/15 text-accent-green border border-accent-green/30">
                          ★ 台服當前版本
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-0.5 text-xs text-text-dim">
                      {halvesOf(v).map(({ key, label, half }) => (
                        <span key={key}>
                          {label} 陸 {half.cnDate}{half.twDate ? ` / 台 ${half.twDate}${half.twIsPredicted ? ' ⌛' : ''}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* 活動填寫進度 */}
                  <div className="shrink-0 text-right min-w-[120px]">
                    <div className="text-[10px] text-text-dim mb-1 tracking-wider uppercase">活動填寫進度</div>
                    <div className="flex items-center justify-end gap-3 text-xs mb-1.5">
                      <span className="text-text-secondary">
                        陸 <span className={cnCount > 0 ? 'text-accent-cyan font-bold' : 'text-text-dim'}>{cnCount}</span>
                      </span>
                      <span className="text-text-secondary">
                        台 <span className={twCount > 0 ? 'text-accent-purple font-bold' : 'text-text-dim'}>{twCount}</span>
                      </span>
                      <span className={`font-bold text-sm ${pctColor}`}>{pct}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-bg-dark rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-text-dim mt-0.5">{filled} / {total} 區段已填</div>
                  </div>

                  {/* 箭頭 */}
                  <div className="shrink-0 self-center text-text-dim group-hover:text-accent-purple transition-colors text-lg">
                    ›
                  </div>
                </div>
              </Link>
            )
          })}

          {versions.length === 0 && (
            <div className="text-center py-16 text-text-dim">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-sm">尚無版本資料</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
