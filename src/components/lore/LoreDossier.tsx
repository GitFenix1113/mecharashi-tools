import { Link } from 'react-router-dom'
import LoreProse from './LoreProse'
import { firstSentence, normalizeLoreSource, readableParagraphs, stripTrailingSource } from './loreText'
import { ClassIcon } from '../icons/ClassIcon'
import { FactionLogo } from '../icons/FactionLogo'
import { MechTypeIcon } from '../icons/MechTypeIcon'
import { FallbackImage } from '../common/FallbackImage'
import { pilotClassMeta } from '../../data/pilotClasses'
import { mechWeightShort } from '../../data/mechWeightClasses'
import { normalizeFactionLogos } from '../../utils/factionLogos'
import { gameIconCandidates } from '../../utils/gameIcons'
import type { LoreChapter, LoreDoc, Pilot } from '../../types'

/**
 * 卷宗（PLAN-042-D B-3）：檔案模式的四張卡——標題區、扉頁、個人資料、逸聞目錄。
 * 每張是一個 `.lore-panel`，`--i` 決定開場／換人時的進場順序（CSS 錯開 120ms／70ms）。
 *
 * ⚠ 扉頁正文住 `pilots.lore`（不是 pilotLore，總綱決策二）；署名若還黏在正文尾端就切掉，
 *   改由 `.lore-source` 單獨排版。不可用 endsWith（地雷 M-17，見 stripTrailingSource）。
 * ⚠ profile.additionalInfo 的鍵名是完全自由的中文字串（含 ▇▇），只當顯示文字與 React key。
 * ⚠ 天賦圖示有空字串的（M-16）：gameIconCandidates 不產生空候選，沒有候選就不渲染 <img>。
 */
export interface LoreDossierProps {
  pilot: Pilot
  lore: LoreDoc | null
  chapters: readonly LoreChapter[]
  /** 章節的網址（呼叫端帶上目前的 ?skin=） */
  chapterHref: (key: string) => string
}

export default function LoreDossier({ pilot, lore, chapters, chapterHref }: LoreDossierProps) {
  const meta = pilotClassMeta(pilot.class)
  const tone = meta?.paper ?? 'var(--lore-ink-2)'
  const serial = pilot.id.match(/^pilot_(\d+)/)?.[1] ?? '—'
  const talent = pilot.talents[0]
  const talentIcons = talent ? gameIconCandidates(talent.icon) : []
  const logos = normalizeFactionLogos(lore?.factionLogos)
  const intro = readableParagraphs(stripTrailingSource(pilot.lore, lore?.frontSource))
  const source = normalizeLoreSource(lore?.frontSource)
  const profile = pilot.profile
  const rows: [string, string][] = [
    ['性別', profile.gender], ['身高', profile.height], ['血型', profile.bloodType], ['陣營', pilot.faction],
    ...Object.entries(profile.additionalInfo),
  ].filter((r): r is [string, string] => typeof r[1] === 'string' && r[1].trim() !== '')
  const height = profile.height?.trim()
  const redTag = height && height !== '不详' && height !== '不詳' ? height : mechWeightShort(pilot.license)

  return (
    <>
      <section className="lore-panel lore-titleblock" style={{ '--i': 0, '--tone': tone } as React.CSSProperties}>
        <p className="lore-eyebrow">
          <span className="lore-eyebrow__sq" />
          PILOT FILE · NO.{serial}{pilot.debutVersion ? ` · v${pilot.debutVersion}` : ''}
        </p>
        <div className="lore-tb__class">
          <ClassIcon pilotClass={pilot.class} size={22} decorative />
          {pilot.class}
          {meta && <span className="en">{meta.en}</span>}
        </div>
        <h1 className="lore-tb__name">{pilot.name}</h1>
        <div className="lore-tb__sub">
          {pilot.fullName && pilot.fullName !== pilot.name && <span>{pilot.fullName}</span>}
          {pilot.nameEn && <span className="en">{pilot.nameEn}</span>}
        </div>
        <div className="lore-emblems">
          {/* 陣營：有官方徽章（PLAN-059 D-3，管理者逐位挑）就蓋徽章、小字寫陣營名；沒有就把陣營名刻在圓環裡 */}
          <div className="lore-emb">
            <div className="lore-emb__ring" style={logos.length ? { color: 'var(--lore-ink)' } : undefined}>
              {logos.length ? logos.map((k) => <FactionLogo key={k} logoKey={k} size={logos.length > 1 ? 30 : 46} label={pilot.faction} />) : pilot.faction}
            </div>
            <span className="lore-emb__cap">{logos.length ? pilot.faction : '陣營'}</span>
          </div>
          <div className="lore-emb">
            <div className="lore-emb__ring">
              {talentIcons.length ? (
                <FallbackImage candidates={talentIcons} alt={talent?.name ?? ''} fallback={talent?.name ?? '—'} />
              ) : (talent?.name || '—')}
            </div>
            <span className="lore-emb__cap">{talent?.name || '天賦'}</span>
          </div>
          <div className="lore-emb">
            <div className="lore-emb__ring" style={{ color: 'var(--lore-ink)' }}>
              <MechTypeIcon type={pilot.license} size={34} decorative />
            </div>
            <span className="lore-emb__cap">{mechWeightShort(pilot.license)}執照</span>
          </div>
        </div>
      </section>

      {intro.length > 0 && (
        <section className="lore-panel lore-card" style={{ '--i': 1 } as React.CSSProperties}>
          <p className="lore-eyebrow"><span className="lore-eyebrow__sq" /><b>扉頁</b>DOSSIER EXTRACT</p>
          <LoreProse paragraphs={intro} lead />
          {source && <p className="lore-source">{source}</p>}
        </section>
      )}

      {rows.length > 0 && (
        <section className="lore-panel lore-card" style={{ '--i': 2 } as React.CSSProperties}>
          {redTag && <span className="lore-redtag">{redTag}</span>}
          <p className="lore-eyebrow"><span className="lore-eyebrow__sq" /><b>個人資料</b>PROFILE</p>
          <dl className="lore-kv">
            {rows.map(([k, v]) => (
              <div key={k} className={v.length > 14 ? 'is-wide' : undefined}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="lore-panel lore-card" style={{ '--i': 3 } as React.CSSProperties}>
        <p className="lore-eyebrow">
          <span className="lore-eyebrow__sq" /><b>逸聞</b>ANECDOTES{chapters.length ? ` · ${chapters.length} PARTS` : ''}
        </p>
        {chapters.length ? (
          <ol className="lore-toc">
            {chapters.map((c, i) => (
              <li key={c.key}>
                {/* 扉頁 → 章節用 push（上一頁要能退回扉頁）；章節之間的切換在 LoreChapterPager 用 replace */}
                <Link to={chapterHref(c.key)}>
                  <span className="lore-toc__num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <span className="lore-toc__t">
                    {c.title}
                    <small>{firstSentence(readableParagraphs(c.body).join('').replace(/^[「『]/, ''))}</small>
                  </span>
                  <span className="lore-toc__go" aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          // 多數機師還沒有章節——這是常態不是錯誤，不放空框也不放「載入失敗」
          <p className="lore-empty-note">這份檔案的逸聞章節<em>尚在整理</em>。官方逸聞收錄後，會依 PART 順序出現在這裡。</p>
        )}
      </section>
    </>
  )
}
