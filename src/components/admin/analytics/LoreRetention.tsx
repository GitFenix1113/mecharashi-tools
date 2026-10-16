// 章節留存（PLAN-062 Phase D）
//
// 每位機師（或每台機甲，PLAN-042-B H-2）「打開 → PART 1 → … → PART n」各有多少讀者。統計端只記得章節 key，
// 要對照 pilotLore／mechLore 才知道有哪些章、順序與標題；而兩者都不進 localStorage
// （NO_LOCAL_CACHE_KEYS，全部機師約 0.5 MB），所以**按一下才載入**——
// 不拖累儀表板的開頁成本，只有真的要看的人才付這筆讀取。
//
// 拆成兩層：LoreRetention 管「要不要載入」，RetentionList 只吃算好的結果負責排版
// （不碰 hook），所以能單獨渲染驗收。
import { useMemo, useState } from 'react'
import { useMechLore, usePilotLore } from '../../../hooks/useFirestore'
import { publishedChapters } from '../../lore/loreText'
import {
  RETENTION_MIN_OPENS,
  chapterRetention,
  type LoreHall,
  type RetentionResult,
} from '../../../lib/analytics/loreStats'
import type { AnalyticsEntityMonth } from '../../../types/analytics'

const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`)

const NOUN: Record<LoreHall, string> = { pilots: '機師', mechs: '機甲' }

export function LoreRetention({ entity, hall = 'pilots' }: { entity: AnalyticsEntityMonth | null; hall?: LoreHall }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setOpen(true)}
          className="px-3 py-1 rounded-lg text-xs font-medium border border-accent-purple/40 bg-accent-purple/10 text-accent-purple hover:bg-accent-purple/20 transition-colors"
        >
          載入章節留存
        </button>
        <span className="text-[11px] text-text-dim leading-snug">
          要讀取全部{NOUN[hall]}的故事資料{hall === 'pilots' ? '（約 0.5 MB）' : ''}才知道每{hall === 'pilots' ? '位' : '台'}有哪些章，所以按了才載入。
        </span>
      </div>
    )
  }
  return hall === 'mechs' ? <LoadedMechRetention entity={entity} /> : <LoadedRetention entity={entity} />
}

function LoadedRetention({ entity }: { entity: AnalyticsEntityMonth | null }) {
  const { data: docs, loading, error } = usePilotLore()
  return <RetentionBody opens={entity?.lorePilots} parts={entity?.loreParts} docs={docs} loading={loading} error={error} noun="機師" />
}

/** 機甲廳（PLAN-042-B H-2）：讀 mechLore、打開次數取 loreMechs；hook 分開寫，進機師廳的留存不會順便抓 mechLore */
function LoadedMechRetention({ entity }: { entity: AnalyticsEntityMonth | null }) {
  const { data: docs, loading, error } = useMechLore()
  return <RetentionBody opens={entity?.loreMechs} parts={entity?.loreParts} docs={docs} loading={loading} error={error} noun="機甲" />
}

function RetentionBody({ opens, parts, docs, loading, error, noun }: {
  opens: Record<string, number> | undefined
  parts: Record<string, number> | undefined
  docs: readonly { id: string; name?: string; chapters?: Parameters<typeof publishedChapters>[0] }[]
  loading: boolean
  error: Error | null
  noun: string
}) {
  const result = useMemo(
    () =>
      chapterRetention(
        opens,
        parts,
        // 草稿章讀者看不到，留存裡也不該出現；過濾一律走 publishedChapters（見 loreText.ts 的說明）
        docs.map((d) => ({ id: d.id, name: d.name, chapters: publishedChapters(d.chapters) })),
      ),
    [opens, parts, docs],
  )

  if (error) {
    return <div className="text-xs text-accent-red py-2">讀取故事資料失敗：{error.message}</div>
  }
  if (loading && docs.length === 0) {
    return <div className="text-xs text-text-dim py-3">載入故事資料中…</div>
  }
  return <RetentionList result={result} noun={noun} />
}

/** 章節留存的排版。每位機師（每台機甲）一列，每章一根直條（高度＝佔打開的比例），由左到右看得出在哪一章流失。 */
export function RetentionList({ result, noun = '機師' }: { result: RetentionResult; noun?: string }) {
  const { rows, belowMin } = result
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-text-dim leading-snug">
        百分比＝讀了這一章的造訪 ÷ 打開這{noun === '機甲' ? '台' : '位'}{noun}的造訪。只列打開 {RETENTION_MIN_OPENS} 次以上的{noun}
        {belowMin > 0 && `（另有 ${belowMin} ${noun === '機甲' ? '台' : '位'}未達門檻）`}；游標停在直條上可看章名與次數。
      </p>
      {rows.length === 0 ? (
        <div className="text-xs text-text-dim py-2">這個月還沒有{noun}的故事被打開 {RETENTION_MIN_OPENS} 次以上</div>
      ) : (
        rows.map((row) => (
          <div key={row.id}>
            <div className="flex items-baseline justify-between gap-2 text-xs mb-1.5">
              <span className="text-text-secondary truncate" title={row.id}>{row.name}</span>
              <span className="font-mono text-text-dim shrink-0">打開 {row.opens.toLocaleString()}</span>
            </div>
            {/* 欄寬設上限：只有一兩章時不讓直條撐滿整列，看起來像很多人讀 */}
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${row.chapters.length}, minmax(0, 5rem))` }}
            >
              {row.chapters.map((c) => (
                <div key={c.key} title={`${c.label}「${c.title}」：${c.readers} 次造訪讀過（${pct(c.rate)}）`}>
                  <div className="h-10 bg-bg-dark rounded flex items-end overflow-hidden">
                    <div
                      className="w-full bg-accent-purple/60 rounded-t transition-[height] duration-300"
                      style={{ height: `${Math.max((c.rate ?? 0) * 100, 2)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-[10px] leading-tight text-center">
                    <div className="text-text-dim truncate">{c.label}</div>
                    <div className="font-mono text-text-primary">{pct(c.rate)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
