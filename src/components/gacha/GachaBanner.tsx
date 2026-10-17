import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Mech } from '../../types'
import type { PatchVersion } from '../../data/patchVersions/types'
import { mechCardArt } from '../../utils/gameArt'
import { assetUrl } from '../../utils/assets'
import { hasGachaFx, mechGachaFxKey } from '../lore/gacha/gachaFxRegistry'
import { clampCardFocus } from './cardFocus'
import { mechBannerStatus, mechBannerText, type MechBannerText } from './mechBannerStatus'
import KeyArtViewer from './KeyArtViewer'

/**
 * 機甲圖鑑的卡池橫條（PLAN-063）：頁首下方一條，招募插畫裁成帶狀＋池名＋狀態，點一下展開全景（有動態就播）。
 *
 *   · 插畫：mechCardArt（靜態索引＋gameId），61／93 台有；沒有的多半沒開過專屬卡池
 *   · 狀態：mechBannerStatus——資料取自站內活動時間線（台服的機甲池／跨域海運／戰令＋半版本新增名單），不新增任何狀態欄位
 *   · 焦點：Mech.cardFocus（寬橫條只露出約 20% 的畫面高度，每張構圖不同）
 *
 * ⚠ 不讀 mechLore（PLAN-042-B 決策 B-7）：池名取活動名，沒有紀錄就叫「招募插畫」——不用 mechLore.gachaTitle。
 * 退化（決策 8）：沒插畫但有紀錄 → 一行文字狀態；兩者皆無 → 不渲染。
 */
export interface GachaBannerProps {
  mech: Pick<Mech, 'name' | 'gameId' | 'cardFocus'>
  /** usePatchVersions() 的資料 */
  versions: readonly PatchVersion[]
  /** 活動資料到了沒：還沒到時先畫插畫，狀態列留位（不閃「尚無紀錄」） */
  statusReady?: boolean
  /** 後台預覽：用滑桿的值覆寫 mech.cardFocus */
  focus?: number
  className?: string
}

/** 狀態標籤（橫條、文字行、鑑賞標題共用） */
export function GachaStatusChip({ text, className = '' }: { text: MechBannerText; className?: string }) {
  return (
    <span className={`gacha-chip k-${text.kind}${text.predicted ? ' is-pred' : ''} ${className}`}>
      {text.label && <b>{text.label}</b>}
      {text.rerun && <i>復刻</i>}
      <span>{text.text}</span>
    </span>
  )
}

export default function GachaBanner({ mech, versions, statusReady = true, focus, className = '' }: GachaBannerProps) {
  const [origin, setOrigin] = useState<HTMLImageElement | null>(null)
  const card = mechCardArt(mech)
  const src = card ? assetUrl(card) : undefined
  const fxKey = mechGachaFxKey(mech.gameId)
  const live = hasGachaFx(fxKey)
  const status = useMemo(() => mechBannerStatus(mech.name, versions), [mech.name, versions])
  const text = mechBannerText(status)
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
        aria-label={`${mech.name}・${title}：${text.label ? `${text.label}，` : ''}${text.text}。看招募插畫全景`}
        onClick={(e) => setOrigin(e.currentTarget.querySelector('img'))}
      >
        {/* 首屏就看得到：不 lazy。一張約 200 KB（2600×1080 webp） */}
        <img src={src} alt="" decoding="async" style={{ objectPosition: `50% ${clampCardFocus(focus ?? mech.cardFocus)}%` }} />
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
          name={`${mech.name}・${title}`}
          status={statusReady ? <><GachaStatusChip text={text} />{timelineLink}</> : undefined}
          fxKey={live ? fxKey : undefined}
          origin={origin}
          onClosed={() => setOrigin(null)}
        />
      )}
    </div>
  )
}
