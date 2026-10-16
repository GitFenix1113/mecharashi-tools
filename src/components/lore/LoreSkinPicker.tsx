import { FallbackImage } from '../common/FallbackImage'
import { assetUrl } from '../../utils/assets'
import type { PilotSkinArt } from '../../utils/gameArt'
import { preloadImages } from './loreStageArt'
import type { LoreSubject } from './loreSubject'

/**
 * 外觀列（PLAN-042-D F-3）：預設＋各套造型，用各自的官方頭像（`_head`）。
 * 外觀卡 `Icon_pilotSkin_*` 是「卡片裝在袋子裡」的商品圖，縮小後認不出臉，所以不用。
 * 舞台外側與鑑賞模式各放一份（同一個元件）。滑過就預載那套的大圖，點下去幾乎不必等。
 */
export interface LoreSkinPickerProps {
  /** 「預設」那顆用這位的頭像 */
  subject: Pick<LoreSubject, 'heads'>
  skins: readonly PilotSkinArt[]
  /** 目前選的外觀 key；'' ＝預設 */
  current: string
  onPick: (key: string) => void
  className?: string
}

export default function LoreSkinPicker({ subject, skins, current, onPick, className }: LoreSkinPickerProps) {
  if (!skins.length) return null
  const cur = skins.find((s) => s.key === current)
  return (
    <div className={className ?? 'lore-skins'} role="radiogroup" aria-label="外觀">
      <span className="lore-skins__lbl">
        外觀<b>{cur ? cur.label.replace(/^外觀 /, '') : '預設'}</b>
      </span>
      <button
        type="button"
        role="radio"
        className="lore-skin"
        aria-checked={!cur}
        aria-label="預設"
        title="預設"
        onClick={() => onPick('')}
      >
        <FallbackImage candidates={subject.heads()} alt="" fallback={null} />
      </button>
      {skins.map((s) => (
        <button
          key={s.key}
          type="button"
          role="radio"
          className="lore-skin"
          aria-checked={s.key === current}
          aria-label={s.label}
          title={s.scene ? `${s.label}・場景插畫` : s.label}
          onPointerEnter={() => { void preloadImages([assetUrl(s.raw)]) }}
          onClick={() => onPick(s.key)}
        >
          {s.head && <img src={assetUrl(s.head)} alt="" loading="lazy" decoding="async" />}
        </button>
      ))}
    </div>
  )
}
