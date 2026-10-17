import { Link } from 'react-router-dom'
import LoreProse from './LoreProse'
import LoreExitLink from './LoreExitLink'
import { firstSentence, normalizeLoreSource, readableParagraphs } from './loreText'
import { FactionLogo } from '../icons/FactionLogo'
import { MechTypeIcon } from '../icons/MechTypeIcon'
import { FallbackImage } from '../common/FallbackImage'
import { MAKER_UNKNOWN } from './loreSubject'
import { MECH_WEIGHT_CLASSES, mechWeightClassOf } from '../../data/mechWeightClasses'
import { mechGameArt, type MechGameArtKind } from '../../utils/gameArt'
import { assetUrl, mechPortraitCandidates } from '../../utils/assets'
import { pilotHeadCandidates } from './loreStageArt'
import type { LoreChapter, Mech, MechLoreDoc, MechMaker, MechRelationKind, Pilot } from '../../types'
import type { MechLineageItem } from './mechLineage'

export type { MechLineageItem }

/**
 * 機甲廳的卷宗（PLAN-042-B D-3）。卡片順序照站長 10-16 認可的模擬頁（決策 B-6）：
 *   標題區 → 技術檔案 → 逸聞目錄 → 構造（諸元＋四分件；四分件 10-17 先收起，見 SHOW_PARTS） → 系譜 → 搭乘者 → 卡池（招募插畫附件，F-2）
 * 卡片樣式沿用機師卷宗（.lore-panel／.lore-card／.lore-eyebrow…），只有四分件、系譜、搭乘者是機甲專屬。
 * 不加進 LoreDossier（決策 B-12）：兩館內容不同，硬塞分支只會讓兩邊都難改。
 *
 * ⚠ 不在這裡讀 hook 或網址（同 LoreDossier）：後台預覽日後也要能直接渲染。
 * ⚠ 系譜一律人工連（決策 B-10）：這裡只畫 mechLore.relations 與「別台連到這台」的反查，**不做任何文字比對**。
 */

export interface MechDossierProps {
  mech: Mech
  lore: MechLoreDoc | null
  maker: MechMaker | null
  /** mechLore 的狀態。loading＝調閱中；error＝明講載入失敗（介紹也住 mechLore）。預設 ready */
  status?: 'ready' | 'loading' | 'error'
  /** 前台看得到的章節（已濾掉草稿） */
  chapters: readonly LoreChapter[]
  chapterHref: (key: string) => string
  lineage: readonly MechLineageItem[]
  /** 系譜那台的故事館網址 */
  lineageHref: (mechId: string) => string
  /** 官配機師（從 pilots.pairedMechId 反查，決策 B-7） */
  pilot: Pilot | null
  pilotHref?: (pilotId: string) => string
  /** 圖鑑網址：名字旁蓋「機甲圖鑑」朱印。沒給（預覽）就不蓋 */
  codexHref?: string
  /** 點四分件放大（鑑賞模式）；沒給就只顯示不放大。招募插畫也走這裡（label＝CARD_LABEL） */
  onOpenPart?: (src: string, el: HTMLElement, label: string) => void
  /**
   * 招募插畫（2600×1080，已套 BASE_URL）。決策 B-5：不上舞台、只當卷宗最後的附件，點開才是全景。
   * 沒開過專屬卡池的機甲沒有（這張卡就不出現）
   */
  cardSrc?: string
  /** 這台的招募插畫有卡池動態（PLAN-042-B Phase J）：卡片提示改成「看動態全景」 */
  cardLive?: boolean
}

/** 招募插畫在鑑賞模式裡的名字；頁面拿它分辨「現在看的是不透明的插畫」 */
export const CARD_LABEL = '招募插畫'

/**
 * 四分件先收起來（站長 10-17）：部件圖解析度不夠，放大很難看。
 * 程式與樣式（.lore-parts）都留著，日後有高解析度來源再把這個開關打開。
 */
const SHOW_PARTS = false

/** 四分件：從正面看，右臂在畫面左邊（站長 10-16） */
const PARTS: { kind: MechGameArtKind; label: string; en: string }[] = [
  { kind: 'rightArm', label: '右臂', en: 'RIGHT ARM' },
  { kind: 'torso', label: '軀幹', en: 'TORSO' },
  { kind: 'leftArm', label: '左臂', en: 'LEFT ARM' },
  { kind: 'legs', label: '腿部', en: 'LEGS' },
]
const WEIGHT_EN = ['LIGHT', 'MEDIUM', 'HEAVY']

/** 系譜種類的顯示：[自己連出去時, 別台連到這台時]。改型＝原型的反方向 */
const KIND_LABEL: Record<MechRelationKind | 'mention', [string, string]> = {
  base: ['衍生自', '衍生出'],
  variant: ['衍生出', '衍生自'],
  rival: ['競品', '競品'],
  series: ['同系列', '同系列'],
  mention: ['提及', '被提及'],
}
const KIND_CLASS: Record<MechRelationKind | 'mention', string> = { base: 'k-base', variant: 'k-base', rival: 'k-rival', series: 'k-series', mention: 'k-mention' }

export default function MechDossier({
  mech, lore, maker, status = 'ready', chapters, chapterHref, lineage, lineageHref, pilot, pilotHref, codexHref, onOpenPart, cardSrc, cardLive,
}: MechDossierProps) {
  const serial = mech.id.match(/^mech_(\d+)/)?.[1] ?? '—'
  const weight = mechWeightClassOf(mech.armorType)
  const weightEn = weight ? WEIGHT_EN[MECH_WEIGHT_CLASSES.indexOf(weight)] : undefined
  const modelNo = lore?.modelNo?.trim()
  const nameEn = lore?.nameEn?.trim()
  const makerName = maker?.name?.trim()
  const intro = readableParagraphs(lore?.intro)
  const source = normalizeLoreSource(lore?.frontSource)
  const series = lore?.series?.trim()
  const parts = SHOW_PARTS ? PARTS.map((p) => ({ ...p, src: mechGameArt(mech, p.kind) })).filter((p) => p.src) : []
  let i = 0
  const nextI = () => ({ '--i': i++ } as React.CSSProperties)

  const rows: [string, string, string?][] = ([
    ['型號', modelNo ?? '', 'mono'],
    ['製造廠商', makerName || MAKER_UNKNOWN],
    ['類型', weight?.full ?? mech.armorType],
    ['品質', mech.quality ?? ''],
    ['登場版本', mech.debutVersion ? `v${mech.debutVersion}` : ''],
    ['系列', series ?? ''],
    ['英文名', nameEn ?? ''],
    ...(lore?.specs ?? []).map((f): [string, string] => [f.label, f.value]),
  ] as [string, string, string?][]).filter(([, v]) => v)

  return (
    <>
      <section className="lore-panel lore-titleblock" style={nextI()}>
        <p className="lore-eyebrow">
          <span className="lore-eyebrow__sq" />
          MECHA FILE · NO.{serial}{mech.debutVersion ? ` · v${mech.debutVersion}` : ''}
        </p>
        <div className="lore-tb__class">
          <MechTypeIcon type={mech.armorType} size={22} decorative />
          {weight?.full ?? mech.armorType}
          {weightEn && <span className="en">{weightEn}</span>}
        </div>
        <div className="lore-tb__namerow">
          <h1 className="lore-tb__name">{mech.name}</h1>
          {codexHref && (
            <LoreExitLink
              to={codexHref}
              className="lore-seal"
              title={`離館，查看${mech.name}的機甲圖鑑（數值・部件・模組）`}
              aria-label={`查看${mech.name}的機甲圖鑑`}
            >
              <span className="lore-seal__stamp" aria-hidden="true"><span className="lore-seal__txt">機甲圖鑑</span></span>
              <span className="lore-seal__cap" aria-hidden="true">查看圖鑑 ↗</span>
            </LoreExitLink>
          )}
        </div>
        <div className="lore-tb__sub">
          {modelNo && <span className="model">{modelNo}</span>}
          {nameEn && <span className="en">{nameEn}</span>}
        </div>
        <div className="lore-emblems">
          <div className="lore-emb">
            <div className="lore-emb__ring" style={maker?.logo ? { color: 'var(--lore-ink)' } : undefined}>
              {maker?.logo
                ? <FactionLogo logoKey={maker.logo} size={46} label={makerName} className="lore-emb__logo" />
                : (makerName || '未載')}
            </div>
            <span className="lore-emb__cap">{makerName || MAKER_UNKNOWN}</span>
          </div>
          <div className="lore-emb">
            <div className="lore-emb__ring" style={{ color: 'var(--lore-ink)' }}>
              <MechTypeIcon type={mech.armorType} size={34} decorative />
            </div>
            <span className="lore-emb__cap">{weight?.full ?? mech.armorType}</span>
          </div>
          <div className="lore-emb">
            <div className="lore-emb__ring"><span className="lore-emb__q">{mech.quality || '—'}</span></div>
            <span className="lore-emb__cap">品質</span>
          </div>
        </div>
      </section>

      {status !== 'ready' ? (
        <section className="lore-panel lore-card" style={nextI()}>
          <p className="lore-eyebrow"><span className="lore-eyebrow__sq" /><b>技術檔案</b>TECHNICAL BRIEF</p>
          {status === 'loading' ? (
            <p className="lore-empty-note">檔案<em>調閱中</em>……</p>
          ) : (
            <>
              <p className="lore-empty-note">故事資料<em>載入失敗</em>：介紹、型號、系譜與逸聞暫時讀不到——不是這台機甲沒有內容。請稍後重新整理。</p>
              <button type="button" className="lore-pill" style={{ marginTop: '0.75rem' }} onClick={() => window.location.reload()}>重新整理</button>
            </>
          )}
        </section>
      ) : (
        <>
          <section className="lore-panel lore-card" style={nextI()}>
            <p className="lore-eyebrow"><span className="lore-eyebrow__sq" /><b>技術檔案</b>TECHNICAL BRIEF</p>
            {intro.length ? (
              <>
                <LoreProse paragraphs={intro} />
                {source && <p className="lore-source">{source}</p>}
              </>
            ) : (
              // 新機甲先建檔、後補文本是本站的佔位慣例：明講「尚未建檔」，不留白
              <p className="lore-empty-note">這台機甲的官方介紹<em>尚未建檔</em>。</p>
            )}
          </section>

          <section className="lore-panel lore-card" style={nextI()}>
            <p className="lore-eyebrow">
              <span className="lore-eyebrow__sq" /><b>逸聞</b>ANECDOTES{chapters.length ? ` · ${chapters.length} PARTS` : ''}
            </p>
            {chapters.length ? (
              <ol className="lore-toc">
                {chapters.map((c, n) => (
                  <li key={c.key}>
                    <Link to={chapterHref(c.key)}>
                      <span className="lore-toc__num" aria-hidden="true">{String(n + 1).padStart(2, '0')}</span>
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
              <p className="lore-empty-note">這台機甲的逸聞<em>尚未收錄</em>。遊戲裡依解析等級解鎖，收錄後會依 PART 順序出現在這裡。</p>
            )}
          </section>
        </>
      )}

      <section className="lore-panel lore-card" style={nextI()}>
        {modelNo && <span className="lore-redtag">{modelNo}</span>}
        <p className="lore-eyebrow"><span className="lore-eyebrow__sq" /><b>構造</b>STRUCTURE</p>
        <dl className="lore-kv">
          {rows.map(([k, v, cls], n) => (
            <div key={n} className={v.length > 14 ? 'is-wide' : undefined}>
              <dt>{k}</dt>
              <dd className={cls}>{v}</dd>
            </div>
          ))}
        </dl>
        {parts.length > 0 && (
          <div className="lore-parts">
            {parts.map((p) => {
              const src = assetUrl(p.src!)
              return (
                <button
                  key={p.kind}
                  type="button"
                  className="lore-part"
                  disabled={!onOpenPart}
                  aria-label={`放大${p.label}`}
                  onClick={(e) => onOpenPart?.(src, e.currentTarget.querySelector('img') ?? e.currentTarget, p.label)}
                >
                  <img src={src} alt="" loading="lazy" decoding="async" />
                  <span>{p.label}</span>
                  <small>{p.en}</small>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {lineage.length > 0 && (
        <section className="lore-panel lore-card" style={nextI()}>
          <p className="lore-eyebrow"><span className="lore-eyebrow__sq" /><b>系譜</b>LINEAGE</p>
          <ul className="lore-rel">
            {lineage.map((r) => {
              const k = r.kind ?? 'mention'
              return (
                <li key={`${r.dir}-${r.mech.id}`}>
                  <Link to={lineageHref(r.mech.id)}>
                    <FallbackImage candidates={mechPortraitCandidates(r.mech)} alt="" loading="lazy" decoding="async" fallback={<span className="lore-rel__ph" />} />
                    <span className="lore-rel__t">
                      <span className={`lore-rel__k ${KIND_CLASS[k]}`}>{KIND_LABEL[k][r.dir]}</span>
                      {r.mech.name}
                      {r.modelNo && <small>{r.modelNo}</small>}
                    </span>
                    {r.note && <span className="lore-rel__q">{r.note}</span>}
                    <span className="lore-rel__go" aria-hidden="true">→</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {pilot && (
        <section className="lore-panel lore-card" style={nextI()}>
          <p className="lore-eyebrow"><span className="lore-eyebrow__sq" /><b>搭乘者</b>OFFICIAL PILOT</p>
          {pilotHref ? (
            <Link className="lore-pilotcard" to={pilotHref(pilot.id)}>
              <FallbackImage candidates={pilotHeadCandidates(pilot)} alt="" fallback={<span />} />
              <span className="lore-pilotcard__name"><small>官配機師</small><b>{pilot.name}</b></span>
              <span className="lore-pilotcard__go">進入機師故事館 →</span>
            </Link>
          ) : (
            <div className="lore-pilotcard">
              <FallbackImage candidates={pilotHeadCandidates(pilot)} alt="" fallback={<span />} />
              <span className="lore-pilotcard__name"><small>官配機師</small><b>{pilot.name}</b></span>
            </div>
          )}
        </section>
      )}

      {cardSrc && (
        <section className="lore-panel lore-card" style={nextI()}>
          {/* 標題是這台的卡池名稱（mechLore.gachaTitle，例「可能性的彼端」），沒填退回「卡池」；英文一律 KEY ART（宣傳主視覺的通稱） */}
          <p className="lore-eyebrow"><span className="lore-eyebrow__sq" /><b>{lore?.gachaTitle?.trim() || '卡池'}</b>KEY ART</p>
          <button
            type="button"
            className="lore-gacha"
            disabled={!onOpenPart}
            aria-label={`放大${CARD_LABEL}`}
            onClick={(e) => onOpenPart?.(cardSrc, e.currentTarget.querySelector('img') ?? e.currentTarget, CARD_LABEL)}
          >
            {/* 卷宗最後一張、首屏看不到：lazy。一張約 200 KB */}
            <img src={cardSrc} alt="" loading="lazy" decoding="async" />
            <span className="lore-gacha__cap">{CARD_LABEL}<small>{cardLive ? '點一下看動態全景' : '點一下看全景'}</small></span>
          </button>
        </section>
      )}
    </>
  )
}
