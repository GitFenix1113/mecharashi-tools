import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PatchVersion } from '../../data/patchVersions/types'
import { mechCard, pilotCardArt } from '../../utils/gameArt'
import { assetUrl } from '../../utils/assets'
import { hasGachaFx, mechGachaFxKey, pilotGachaFxKey } from '../lore/gacha/gachaFxRegistry'
import { clampCardFocus } from './cardFocus'
import { gachaBannerStatus, gachaBannerText, type GachaBannerText, type GachaSubjectKind } from './gachaBannerStatus'
import KeyArtViewer from './KeyArtViewer'

/**
 * 圖鑑的卡池橫條（PLAN-063；機甲 10-18 先做、機師同日比照）：頁首下方一條，招募插畫裁成帶狀＋池名＋狀態，點一下展開全景（有動態就播）。
 *
 *   · 插畫：mechCard／pilotCardArt（靜態索引＋gameId；機甲可在後台用 cardKey 改選），機甲 64／93 台、機師 62／92 位有；沒有的多半沒開過專屬卡池
 *   · 狀態：gachaBannerStatus——資料取自站內活動時間線（台服的專屬卡池／自選池＋半版本新增名單；戰令不算卡池），不新增任何狀態欄位
 *   · 焦點：cardFocus（寬橫條只露出約 20% 的畫面高度，每張構圖不同）
 *
 * ⚠ 不讀 mechLore／pilotLore（故事館的資料；PLAN-042-B 決策 B-7、042-E 決策二）：池名取活動名，沒有紀錄就叫「招募插畫」——不用 lore 的 gachaTitle。
 * 退化（決策 8）：沒插畫但有紀錄 → 一行文字狀態；兩者皆無 → 不渲染。
 */
export interface GachaBannerProps {
  kind: GachaSubjectKind
  /** 機甲或機師（只用到名字、遊戲 ID、焦點與機甲的招募插畫改選） */
  subject: { name: string; gameId?: string; cardFocus?: number; cardKey?: string }
  /** usePatchVersions() 的資料 */
  versions: readonly PatchVersion[]
  /** 活動資料到了沒：還沒到時先畫插畫，狀態列留位（不閃「尚無紀錄」） */
  statusReady?: boolean
  /** 後台預覽：用滑桿的值覆寫 subject.cardFocus */
  focus?: number
  className?: string
}

/** 狀態標籤（橫條、文字行、鑑賞標題共用） */
export function GachaStatusChip({ text, className = '' }: { text: GachaBannerText; className?: string }) {
  return (
    <span className={`gacha-chip k-${text.kind}${text.predicted ? ' is-pred' : ''} ${className}`}>
      {text.label && <b>{text.label}</b>}
      {text.rerun && <i>復刻</i>}
      <span>{text.text}</span>
    </span>
  )
}

export default function GachaBanner({ kind, subject, versions, statusReady = true, focus, className = '' }: GachaBannerProps) {
  const [origin, setOrigin] = useState<HTMLImageElement | null>(null)
  const mc = kind === 'mech' ? mechCard(subject) : undefined
  const card = kind === 'mech' ? mc?.src : pilotCardArt(subject)
  const src = card ? assetUrl(card) : undefined
  // 機甲的動態跟著卡池走（改選別台的卡池時，動態也是那組的），不是跟著這台的 gameId
  const fxKey = kind === 'mech' ? mechGachaFxKey(mc?.wap) : pilotGachaFxKey(subject.gameId)
  const live = hasGachaFx(fxKey)
  const status = useMemo(() => gachaBannerStatus(kind, subject.name, versions), [kind, subject.name, versions])
  const text = gachaBannerText(kind, status)
  const title = status.title ?? '招募插畫'
  // 時間線深連結：資料本來就取自時間線，要看完整檔期（同期還有什麼活動）就回那裡
  const timelineHref = status.timelineVersion ? `/versions/timeline/${encodeURIComponent(status.timelineVersion)}` : undefined
  const timelineLink = timelineHref && statusReady && (
    <Link to={timelineHref} className="gacha-tl" title={`在版本時間線看 v${status.timelineVersion}`}>時間線 ↗</Link>
  )

  if (!src) {
    if (!statusReady || status.kind === 'none') return null
    return (
      <div className={`gacha-line ${className}`}>
        <span className="gacha-line__lbl">卡池</span>
        {status.title && <b>{status.title}</b>}
        <GachaStatusChip text={text} />
        {text.sub && <small>{text.sub}</small>}
        {timelineLink}
      </div>
    )
  }

  return (
    <div className={`gacha-wrap ${className}`}>
      <button
        type="button"
        className="gacha-banner"
        aria-label={`${subject.name}・${title}：${text.label ? `${text.label}，` : ''}${text.text}。看招募插畫全景`}
        onClick={(e) => setOrigin(e.currentTarget.querySelector('img'))}
      >
        {/* 首屏就看得到：不 lazy。一張約 200 KB（2600×1080 webp） */}
        <img src={src} alt="" decoding="async" style={{ objectPosition: `50% ${clampCardFocus(focus ?? subject.cardFocus)}%` }} />
        <span className="gacha-banner__shade" aria-hidden="true" />
        {live && <span className="gacha-banner__live" title="有卡池動態" aria-hidden="true" />}
        <span className="gacha-banner__t" aria-hidden="true">
          <small>卡池 · KEY ART</small>
          <b>{statusReady ? title : '招募插畫'}</b>
          <span className="gacha-banner__row">
            {statusReady ? <GachaStatusChip text={text} /> : <span className="gacha-chip is-loading">讀取檔期…</span>}
            {statusReady && text.sub && <i>{text.sub}</i>}
          </span>
        </span>
        <span className="gacha-banner__hint" aria-hidden="true">{live ? '▶ 動態全景' : '看全景'}</span>
      </button>
      {/* 連結不能放進 button 裡：疊在橫條右上角、與 button 同層 */}
      {timelineLink}
      {origin && (
        <KeyArtViewer
          src={src}
          name={`${subject.name}・${title}`}
          status={statusReady ? <><GachaStatusChip text={text} />{timelineLink}</> : undefined}
          fxKey={live ? fxKey : undefined}
          origin={origin}
          onClosed={() => setOrigin(null)}
        />
      )}
    </div>
  )
}
