import { LoreRichText } from './LoreRichText'
import { inlineSource, isQuoteStyle } from './loreText'
import type { DescriptionRefs } from '../../types'

/**
 * 故事館正文（PLAN-042-D D-3）：明體、段首縮兩字；引文段**懸掛引號**（「 凸出行首）。扉頁與章節共用。
 * `——` 開頭的獨立行是行內署名（`inlineSource()`），排成與章末署名同款的 `.lore-source`。
 *
 * ⚠ 開頭字不放大、也不上色（2026-10-16 站長定案「維持樸素」）：做過一輪首字放大，逸聞與簡介常以「⋯⋯、「『
 *   這類標點起頭、又有多出處，放大規則的例外比效果多；懸掛引號原本是紅色楷體，同日一併改回正文字色字體。
 *
 * 逐段 <p>，不依賴 whitespace-pre-line（042-A 的理由：引文段與一般段要能混排）。
 * 段落請先過 `readableParagraphs()`（OCR 斷行合併、半形標點）。
 * 有 refs 才走 LoreRichText（[xxx] 引用）；它刻意不套數字紅字（042-A 決策 A）。
 */
export default function LoreProse({ paragraphs, refs }: {
  paragraphs: readonly string[]
  refs?: DescriptionRefs
}) {
  return (
    <div className="lore-prose">
      {paragraphs.map((p, i) => {
        const source = inlineSource(p)
        if (source !== null) return <p key={i} className="lore-source">{source}</p>
        if (isQuoteStyle(p)) {
          const head = p.trimStart()
          return (
            <p key={i} className="is-quote">
              <span className="lore-hang" aria-hidden="false">{head[0]}</span>
              <LoreRichText text={head.slice(1)} refs={refs} />
            </p>
          )
        }
        return (
          <p key={i}>
            <LoreRichText text={p} refs={refs} />
          </p>
        )
      })}
    </div>
  )
}
