import { LoreRichText } from './LoreRichText'
import { inlineSource, isQuoteStyle, quoteDropCap } from './loreText'
import type { DescriptionRefs } from '../../types'

/**
 * 故事館正文（PLAN-042-D D-3）：明體、段首縮兩字；引文段**懸掛引號**（「 凸出行首、紅色），
 * 開頭段**首字放大**（`lead`）——引文開頭段放大的是引號後的第一個字（`quoteDropCap()`）。扉頁與章節共用。
 * `——` 開頭的獨立行是行內署名（`inlineSource()`），排成與章末署名同款的 `.lore-source`。
 *
 * 逐段 <p>，不依賴 whitespace-pre-line（042-A 的理由：引文段與一般段要能混排）。
 * 段落請先過 `readableParagraphs()`（OCR 斷行合併、半形標點）。
 * 有 refs 才走 LoreRichText（[xxx] 引用）；它刻意不套數字紅字（042-A 決策 A）。
 */
export default function LoreProse({ paragraphs, refs, lead = false }: {
  paragraphs: readonly string[]
  refs?: DescriptionRefs
  /** 第一段（非引文時）首字放大 */
  lead?: boolean
}) {
  return (
    <div className="lore-prose">
      {paragraphs.map((p, i) => {
        const source = inlineSource(p)
        if (source !== null) return <p key={i} className="lore-source">{source}</p>
        if (isQuoteStyle(p)) {
          const head = p.trimStart()
          const drop = lead && i === 0 ? quoteDropCap(head) : null
          if (drop) {
            return (
              <p key={i} className="is-quote has-drop">
                <span className="lore-hang" aria-hidden="false">{drop.open}</span>
                <span className="lore-drop">{drop.cap}</span>
                <LoreRichText text={drop.rest} refs={refs} />
              </p>
            )
          }
          return (
            <p key={i} className="is-quote">
              <span className="lore-hang" aria-hidden="false">{head[0]}</span>
              <LoreRichText text={head.slice(1)} refs={refs} />
            </p>
          )
        }
        return (
          <p key={i} className={lead && i === 0 ? 'is-lead' : undefined}>
            <LoreRichText text={p} refs={refs} />
          </p>
        )
      })}
    </div>
  )
}
