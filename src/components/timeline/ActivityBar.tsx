// PLAN-048 Phase 0（任務 0-1）：甘特長條 + 脫離裁切的詳情浮窗
import { useState } from 'react'
import {
  useFloating,
  useHover,
  useClick,
  useInteractions,
  useDismiss,
  useRole,
  offset,
  flip,
  shift,
  autoUpdate,
  FloatingPortal,
  safePolygon,
} from '@floating-ui/react'
import { useIsMobile } from '../../hooks/useIsMobile'
import { BottomSheet } from '../common/BottomSheet'
import { splitActivityName } from '../../data/patchVersions/activityText'
import { activityStatus } from './activityStatus'
import type { BarGeom } from './ganttGeometry'
import type { TimedActivity } from '../../data/patchVersions/types'

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六']

function fmt(d: Date): string {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WEEKDAY_ZH[d.getDay()]}）`
}

/** 長條與詳情共用的一組配色 class（來自 VersionGanttPanel 的 COLORS） */
export interface BarTone {
  dot: string
  chip: string
  text: string
  label: string
}

// ── 詳情內容：桌機浮窗與手機 BottomSheet 共用 ─────────────────────────────────

function ActivityDetail({ act, tone }: { act: TimedActivity; tone: BarTone }) {
  const { base, rewards } = splitActivityName(act)
  const st = activityStatus(act)
  const sub = act.pilots?.join('、') ?? act.mechs?.join('、') ?? ''

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className={`text-[12px] ${tone.text}`}>● {tone.label}</span>
        {st.phase === 'ongoing' && (
          <span className="text-[11px] text-text-secondary">
            第 {st.weekIndex}/{st.totalWeeks} 週
            {st.isFinalWeek && <span className="ml-1 text-accent-orange">⚠ 末週</span>}
          </span>
        )}
        {st.phase === 'upcoming' && <span className="text-[11px] text-text-dim">尚未開始</span>}
        {st.phase === 'ended' && <span className="text-[11px] text-text-dim">已結束</span>}
      </div>

      <div className="text-[15px] font-medium text-text-primary leading-snug">{base}</div>

      <div className="text-[12px] text-text-secondary">
        {fmt(st.start)} → {fmt(st.endExclusive)}
        {st.phase === 'ongoing' && (
          <span className="ml-1.5 text-accent-orange">剩 {st.daysLeft} 天</span>
        )}
      </div>

      {rewards.length > 0 && (
        <div>
          <div className="text-[11px] text-text-dim mb-1">獎勵</div>
          <div className="flex flex-wrap gap-1">
            {rewards.map((r, i) => (
              <span
                key={i}
                className="text-[11px] px-1.5 py-0.5 rounded border border-accent-yellow/30 bg-accent-yellow/10 text-accent-yellow"
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      )}

      {sub && (
        <div className="text-[12px] text-text-dim pt-1 border-t border-border/60">
          {act.pilots?.length ? '機師' : '機甲'}
          <span className="text-text-secondary">{sub}</span>
        </div>
      )}
    </div>
  )
}

// ── 長條本體 ──────────────────────────────────────────────────────────────────

export default function ActivityBar({
  act,
  geom,
  tone,
}: {
  act: TimedActivity
  geom: BarGeom
  tone: BarTone
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const { base, rewards } = splitActivityName(act)

  // 用專案既有的 @floating-ui/react（BossDropTooltip 已是同一套 pattern）。
  //
  // FloatingPortal 一次跳出全部 11 層裁切祖先 —— z-index 對 overflow 裁切無效，
  // 只有把節點移出 DOM 子樹才有效；flip/shift 取代手刻的「放不下才翻面 + 夾在
  // 視窗內」；autoUpdate 取代 scroll/resize 監聽。
  //
  // placement 從現況的「永遠往上長」（absolute bottom-full）改為 'bottom'：
  // 那才是「第一列必被切、第二列以後又蓋住上方週次表」的直接成因。
  const { refs, floatingStyles, context } = useFloating({
    open: open && !isMobile,
    onOpenChange: setOpen,
    placement: 'bottom',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  })

  const hover = useHover(context, {
    enabled: !isMobile,
    delay: { open: 120, close: 80 },
    handleClose: safePolygon(),
  })
  const click = useClick(context, { enabled: isMobile })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'dialog' })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, click, dismiss, role])

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        title={act.name}
        style={{ left: `${geom.leftPct}%`, width: `${geom.widthPct}%` }}
        className={`@container absolute top-1/2 -translate-y-1/2 h-6
                    flex items-center gap-1 px-2 rounded-full border text-left
                    overflow-hidden transition-[filter,box-shadow]
                    hover:brightness-125 focus:outline-none
                    focus-visible:ring-2 focus-visible:ring-accent-orange/60
                    ${tone.chip}
                    ${geom.clipStart ? 'rounded-l-none' : ''}
                    ${geom.clipEnd ? 'rounded-r-none' : ''}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`} />
        <span className="text-[12px] font-medium truncate">{base}</span>
        {/* Tailwind v4 內建容器查詢：條夠寬才擠獎勵，窄條自動只留名稱 */}
        {rewards[0] && (
          <span className="hidden @min-[168px]:inline text-[11px] opacity-70 truncate">
            {rewards[0]}
            {rewards.length > 1 ? ` +${rewards.length - 1}` : ''}
          </span>
        )}
      </button>

      {open && !isMobile && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, width: 320 }}
            {...getFloatingProps()}
            className="z-50 bg-bg-tooltip border border-border-accent rounded-xl p-3 shadow-2xl
                       max-h-[60vh] overflow-y-auto overscroll-contain"
          >
            <ActivityDetail act={act} tone={tone} />
          </div>
        </FloatingPortal>
      )}

      <BottomSheet open={open && isMobile} onClose={() => setOpen(false)}>
        <ActivityDetail act={act} tone={tone} />
      </BottomSheet>
    </>
  )
}
