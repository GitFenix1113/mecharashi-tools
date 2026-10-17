import { Link } from 'react-router-dom'
import LoreProse from './LoreProse'
import LoreExitLink from './LoreExitLink'
import { firstSentence, normalizeLoreSource, readableParagraphs } from './loreText'
import { ClassIcon } from '../icons/ClassIcon'
import { FactionLogo } from '../icons/FactionLogo'
import { MechTypeIcon } from '../icons/MechTypeIcon'
import { FallbackImage } from '../common/FallbackImage'
import { pilotClassMeta } from '../../data/pilotClasses'
import { mechWeightShort } from '../../data/mechWeightClasses'
import { normalizeFactionLogos } from '../../utils/factionLogos'
import { gameIconCandidates } from '../../utils/gameIcons'
import { mechPortraitCandidates } from '../../utils/assets'
import { mechWeightClassOf } from '../../data/mechWeightClasses'
import { dossierRows } from '../../utils/loreDossier'
import type { LoreChapter, LoreDoc, Mech, Pilot } from '../../types'

/**
 * 卷宗（PLAN-042-D B-3）：檔案模式的四張卡——標題區、扉頁、個人資料、逸聞目錄；之後加上座機（042-B D-7）與卡池（042-A Phase J）。
 * 每張是一個 `.lore-panel`，`--i` 決定開場／換人時的進場順序（CSS 錯開 120ms／70ms）。
 *
 * 資料來源（PLAN-042-E）：標題區的身分欄位（名字、全名、職業、陣營、執照、天賦）讀 pilots；
 * 英文名、扉頁簡介與署名、個人資料、徽章、章節全部讀 pilotLore。簡介在搬遷時已切掉署名，這裡不再猜。
 *
 * ⚠ pilotLore 讀不到時**明講載入失敗**（`status="error"`）：搬遷後扉頁正文也住 pilotLore，
 *   不講的話讀者看到的是「只有名字、逸聞尚在整理」，會以為這位機師本來就沒有故事。
 * ⚠ 自訂欄位的標籤是完全自由的中文字串（含 ▇▇），只當顯示文字；React key 用索引（標籤不保證唯一，編輯台存檔前才擋同名）。
 * ⚠ 天賦圖示有空字串的（M-16）：gameIconCandidates 不產生空候選，沒有候選就不渲染 <img>。
 * ⚠ 後台預覽（D-4）也直接渲染本元件：不要在這裡讀 hook 或網址，所有資料都從 props 來。
 *   落款鈐印（PLAN-042-G）因此是選填的 `codexHref`：預覽不傳＝不出現，管理者在編輯台不會一點就被帶離。
 */
export interface LoreDossierProps {
  pilot: Pilot
  lore: LoreDoc | null
  /** pilotLore 的狀態。loading＝故事區塊顯示調閱中；error＝顯示載入失敗。預設 ready */
  status?: 'ready' | 'loading' | 'error'
  /** 前台看得到的章節（已濾掉草稿，見 publishedChapters） */
  chapters: readonly LoreChapter[]
  /** 章節的網址（呼叫端帶上目前的 ?skin=） */
  chapterHref: (key: string) => string
  /**
   * 徽章的名稱（PLAN-042-F：factionEmblems 的註記）：滑鼠提示與讀屏用。
   * 沒給、或這顆沒有名稱 → 退回機師的陣營文字（兩顆徽章時那是複合值，所以才需要各自的名稱）
   */
  logoLabel?: (logoKey: string) => string | undefined
  /**
   * 這位機師的圖鑑網址（PLAN-042-G B-2）：名字旁蓋一方「機師圖鑑」朱印，點了離館過去。
   * 圖鑑那邊的「故事館 ▸」也在名字旁——兩館的入口鏡像對稱。沒給（後台預覽）就不蓋印。
   */
  codexHref?: string
  /**
   * 官配機甲（PLAN-042-B D-7）：卷宗最後一張「座機」卡，跨廳連到機甲故事館。沒給（沒有官配、或後台預覽）就不出現。
   * 型號來自 mechLore（讀不到就不顯示型號，卡片照樣出現）
   */
  pairedMech?: { mech: Mech; modelNo?: string; href: string } | null
  /**
   * 招募插畫（PLAN-042-A Phase J，比照機甲卷宗）：卷宗最後一張「卡池」卡，標題是 pilotLore.gachaTitle（空＝「卡池」）。
   * 沒給（沒開過專屬卡池）就不出現。`cardLive`＝這位有卡池動態，說明文字改成「點一下看動態全景」
   */
  cardSrc?: string
  cardLive?: boolean
  /** 點卡池卡放大（鑑賞模式）；沒給（後台預覽）就只顯示、不能點 */
  onOpenCard?: (el: HTMLElement) => void
}

export default function LoreDossier({ pilot, lore, status = 'ready', chapters, chapterHref, logoLabel, codexHref, pairedMech, cardSrc, cardLive, onOpenCard }: LoreDossierProps) {
  const meta = pilotClassMeta(pilot.class)
  const tone = meta?.paper ?? 'var(--lore-ink-2)'
  const serial = pilot.id.match(/^pilot_(\d+)/)?.[1] ?? '—'
  const talent = pilot.talents[0]
  const talentIcons = talent ? gameIconCandidates(talent.icon) : []
  const logos = normalizeFactionLogos(lore?.factionLogos)
  const nameEn = lore?.nameEn?.trim()
  const intro = readableParagraphs(lore?.intro)
  const source = normalizeLoreSource(lore?.frontSource)
  const rows = dossierRows(lore, pilot.faction)
  const height = lore?.dossier?.height?.trim()
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
        <div className="lore-tb__namerow">
          <h1 className="lore-tb__name">{pilot.name}</h1>
          {codexHref && (
            // 印文橫排兩行（機師／圖鑑）：傳統印的右起直排會被讀成「圖機鑑師」，導覽元素要一眼讀對
            <LoreExitLink
              to={codexHref}
              className="lore-seal"
              title={`離館，查看${pilot.name}的機師圖鑑（天賦・技能・神經驅動）`}
              aria-label={`查看${pilot.name}的機師圖鑑`}
            >
              <span className="lore-seal__stamp" aria-hidden="true"><span className="lore-seal__txt">機師圖鑑</span></span>
              <span className="lore-seal__cap" aria-hidden="true">查看圖鑑 ↗</span>
            </LoreExitLink>
          )}
        </div>
        <div className="lore-tb__sub">
          {pilot.fullName && pilot.fullName !== pilot.name && <span>{pilot.fullName}</span>}
          {nameEn && <span className="en">{nameEn}</span>}
        </div>
        <div className="lore-emblems">
          {/* 陣營：有官方徽章（PLAN-059 D-3，管理者逐位挑）就蓋徽章、小字寫陣營名；沒有就把陣營名刻在圓環裡 */}
          <div className="lore-emb">
            <div className="lore-emb__ring" style={logos.length ? { color: 'var(--lore-ink)' } : undefined}>
              {logos.length ? logos.map((k) => (
                <FactionLogo key={k} logoKey={k} size={logos.length > 1 ? 30 : 46} label={logoLabel?.(k) ?? pilot.faction} className="lore-emb__logo" />
              )) : pilot.faction}
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

      {status !== 'ready' ? (
        <section className="lore-panel lore-card" style={{ '--i': 1 } as React.CSSProperties}>
          <p className="lore-eyebrow"><span className="lore-eyebrow__sq" /><b>扉頁</b>DOSSIER EXTRACT</p>
          {status === 'loading' ? (
            <p className="lore-empty-note">檔案<em>調閱中</em>……</p>
          ) : (
            <>
              <p className="lore-empty-note">
                故事資料<em>載入失敗</em>：簡介、個人資料與逸聞暫時讀不到——不是這份檔案沒有內容。請稍後重新整理。
              </p>
              <button type="button" className="lore-pill" style={{ marginTop: '0.75rem' }} onClick={() => window.location.reload()}>
                重新整理
              </button>
            </>
          )}
        </section>
      ) : (
        <>
          {intro.length > 0 && (
            <section className="lore-panel lore-card" style={{ '--i': 1 } as React.CSSProperties}>
              <p className="lore-eyebrow"><span className="lore-eyebrow__sq" /><b>扉頁</b>DOSSIER EXTRACT</p>
              <LoreProse paragraphs={intro} />
              {source && <p className="lore-source">{source}</p>}
            </section>
          )}

          {rows.length > 0 && (
            <section className="lore-panel lore-card" style={{ '--i': 2 } as React.CSSProperties}>
              {redTag && <span className="lore-redtag">{redTag}</span>}
              <p className="lore-eyebrow"><span className="lore-eyebrow__sq" /><b>個人資料</b>PROFILE</p>
              <dl className="lore-kv">
                {rows.map(([k, v], i) => (
                  <div key={i} className={v.length > 14 ? 'is-wide' : undefined}>
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
      )}

      {pairedMech && (
        <section className="lore-panel lore-card" style={{ '--i': 4 } as React.CSSProperties}>
          <p className="lore-eyebrow"><span className="lore-eyebrow__sq" /><b>座機</b>OFFICIAL MECHA</p>
          <Link className="lore-mechcard" to={pairedMech.href}>
            <FallbackImage candidates={mechPortraitCandidates(pairedMech.mech)} alt="" loading="lazy" decoding="async" fallback={<span className="lore-mechcard__ph" />} />
            <span className="lore-mechcard__name">
              <small>官配機甲{pairedMech.modelNo ? ` · ${pairedMech.modelNo}` : ''}</small>
              <b>{pairedMech.mech.name}</b>
              <em>{mechWeightClassOf(pairedMech.mech.armorType)?.full ?? pairedMech.mech.armorType}</em>
            </span>
            <span className="lore-mechcard__go">進入機甲故事館 →</span>
          </Link>
        </section>
      )}

      {cardSrc && (
        <section className="lore-panel lore-card" style={{ '--i': 5 } as React.CSSProperties}>
          {/* 標題是這位的卡池名稱（pilotLore.gachaTitle），沒填退回「卡池」；英文一律 KEY ART（同機甲卷宗） */}
          <p className="lore-eyebrow"><span className="lore-eyebrow__sq" /><b>{lore?.gachaTitle?.trim() || '卡池'}</b>KEY ART</p>
          <button
            type="button"
            className="lore-gacha"
            disabled={!onOpenCard}
            aria-label="放大招募插畫"
            onClick={(e) => onOpenCard?.(e.currentTarget.querySelector('img') ?? e.currentTarget)}
          >
            {/* 卷宗最後一張、首屏看不到：lazy。一張約 200 KB */}
            <img src={cardSrc} alt="" loading="lazy" decoding="async" />
            <span className="lore-gacha__cap">招募插畫<small>{cardLive ? '點一下看動態全景' : '點一下看全景'}</small></span>
          </button>
        </section>
      )}
    </>
  )
}
