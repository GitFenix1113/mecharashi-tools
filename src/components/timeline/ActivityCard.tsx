// PLAN-048 Phase 1（任務 1-2）：活動卡片 —— 不必 hover 就看得到的內容層
import { splitActivityName } from '../../data/patchVersions/activityText'
import { activityStatus } from './activityStatus'
import { activityTone, shapeClass } from './activityTypeRegistry'
import type { VisibleActivity } from '../../data/patchVersions/types'

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六']

function fmt(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_ZH[d.getDay()]})`
}

export default function ActivityCard({
  act,
  actKey,
  carriedFrom,
  selected,
  onSelect,
  onHover,
  registerRef,
}: {
  act: VisibleActivity
  actKey: string
  /** 非空 ＝ 這筆是從該版本延續進來的（如戰令跨版），標出來源免得誤認為本版新增 */
  carriedFrom?: string
  selected: boolean
  onSelect: (key: string | null) => void
  onHover: (key: string | null) => void
  registerRef: (key: string, el: HTMLDivElement | null) => void
}) {
  const { base, rewards } = splitActivityName(act)
  const st = activityStatus(act)
  const tone = activityTone(act.type, act.typeLabel)
  // 機師與機甲都要列出（同 ActivityBar）—— 舊寫法用 ??，pilots 有值就永遠
  // 輪不到 mechs，戰令那種兩邊都有的活動會少掉機甲。這裡是單行摘要，
  // 故不換列而以全形空白分隔。
  const entityParts = [
    { label: '機師', items: act.pilots },
    { label: '機甲', items: act.mechs },
  ].filter(r => r.items?.length)
  const isPredicted = act.confidence === 'predicted'

  return (
    <div
      ref={el => registerRef(actKey, el)}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(selected ? null : actKey)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(selected ? null : actKey) }
      }}
      onMouseEnter={() => onHover(actKey)}
      onMouseLeave={() => onHover(null)}
      className={`rounded-lg border border-l-[3px] bg-bg-dark/60 px-2.5 py-2 cursor-pointer
                  transition-colors outline-none
                  focus-visible:ring-2 focus-visible:ring-accent-orange/60
                  ${tone.edge}
                  ${selected
                    ? 'border-y-accent-cyan/50 border-r-accent-cyan/50 bg-bg-dark/85 ring-1 ring-accent-cyan/35'
                    : 'border-y-border border-r-border hover:bg-bg-dark/80'}
                  ${st.phase === 'ended' ? 'opacity-60' : ''}`}
    >
      {/* 標頭：型別 + 進度（全部由 startDate + weeks 算出，維護者零輸入） */}
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className={`inline-flex items-center gap-1 text-[11px] ${tone.text}`}>
          <span className={`${shapeClass(tone.shape)} ${tone.dot} shrink-0`} />
          {tone.label}
        </span>
        {st.phase === 'ongoing' && (
          <span className="text-[11px] text-text-secondary">
            第 {st.weekIndex}/{st.totalWeeks} 週
          </span>
        )}
        {st.isFinalWeek && <span className="text-[11px] text-accent-orange">⚠ 末週</span>}
        {st.phase === 'upcoming' && <span className="text-[11px] text-text-dim">尚未開始</span>}
        {st.phase === 'ended' && <span className="text-[11px] text-text-dim">已結束</span>}
        {isPredicted && (
          <span className="text-[10px] border border-dashed border-accent-purple/50 text-accent-purple px-1 rounded">
            推估
          </span>
        )}
        {carriedFrom && (
          <span
            className="text-[10px] border border-accent-cyan/40 text-accent-cyan px-1 rounded"
            title={`這個活動登錄在 ${carriedFrom}，檔期延續到本版`}
          >
            ↩ {carriedFrom} 延續
          </span>
        )}
      </div>

      <div className="text-[13px] font-medium text-text-primary leading-snug mt-1">{base}</div>

      <div className="text-[11px] text-text-secondary mt-0.5">
        {fmt(st.start)} → {fmt(st.endExclusive)}
        {st.phase === 'ongoing' && (
          <span className="ml-1.5 text-accent-orange font-medium">剩 {st.daysLeft} 天</span>
        )}
      </div>

      {/* 進度條：只在進行中出現，結束/未開始畫它沒有資訊量 */}
      {st.phase === 'ongoing' && (
        <div className="mt-1.5 h-0.5 rounded-full bg-border overflow-hidden">
          <div
            className="h-full bg-accent-orange/70 rounded-full"
            style={{ width: `${Math.round(st.progress * 100)}%` }}
          />
        </div>
      )}

      {rewards.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {rewards.map((r, i) => (
            <span
              key={i}
              className="text-[10px] px-1.5 py-0.5 rounded border border-accent-yellow/30 bg-accent-yellow/10 text-accent-yellow"
            >
              {r}
            </span>
          ))}
        </div>
      )}

      {act.description && (
        <div className="text-[11px] text-text-secondary mt-1.5 leading-relaxed whitespace-pre-line line-clamp-3">
          {act.description}
        </div>
      )}

      {/* 站方備註：不 line-clamp —— 它通常只有一句，且正是讀者最該先看到的那句 */}
      {act.editorNote && (
        <div className="text-[11px] mt-1.5 leading-relaxed border-l-2 border-accent-cyan/50 pl-2">
          <span className="text-accent-cyan mr-1.5">備註</span>
          <span className="text-text-secondary whitespace-pre-line">{act.editorNote}</span>
        </div>
      )}

      {(entityParts.length > 0 || act.sourceUrl) && (
        <div className="flex items-center justify-between gap-2 mt-1.5 pt-1.5 border-t border-border/60">
          {entityParts.length > 0 ? (
            <span className="text-[11px] text-text-dim truncate">
              {entityParts.map((p, i) => (
                <span key={p.label}>
                  {i > 0 && '　'}
                  {/* 冒號不能省 —— 沒有的話會黏成「機師維羅妮卡、維娜」 */}
                  {p.label}：<span className="text-text-secondary">{p.items!.join('、')}</span>
                </span>
              ))}
            </span>
          ) : <span />}
          {act.sourceUrl && (
            <a
              href={act.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-[11px] text-accent-cyan hover:underline shrink-0"
            >
              官方公告 ↗
            </a>
          )}
        </div>
      )}
    </div>
  )
}
