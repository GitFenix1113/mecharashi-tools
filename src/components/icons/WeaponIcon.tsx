import { FallbackImage } from '../common/FallbackImage'
import { weaponIconCandidates } from '../../utils/gameIcons'
import type { SlotSide } from '../../types/slots'

interface WeaponIconProps {
  /** 官方圖示編號（PLAN-056）；有值就用官方圖 */
  gameId?: string
  /** 固定武裝左右肩的鏡像圖；搭配 side 使用 */
  sideGameIds?: { left?: string; right?: string }
  /** 掛在哪一側（只有固定武裝的左右肩會用到） */
  side?: SlotSide
  /** 自訂圖，或 PLAN-056 C-5 之前的舊路徑（過渡期後備） */
  icon?: string
  name: string
  size?: 'sm' | 'md' | 'lg'
  isExclusive?: boolean
}

/**
 * 武器圖示。候選鏈：左右肩圖 → gameId 圖庫 → icon（見 weaponIconCandidates）；全部失敗顯示「武」。
 * 呼叫端傳 gameId＋icon（固定武裝再加 sideGameIds＋side），不要自己拼路徑。
 */
export function WeaponIcon({ gameId, sideGameIds, side, icon, name, size = 'md', isExclusive = false }: WeaponIconProps) {
  const dim = size === 'lg' ? 'w-16 h-16' : size === 'md' ? 'w-10 h-10' : 'w-8 h-8'
  const candidates = weaponIconCandidates({ gameId, sideGameIds, icon }, side)

  if (isExclusive) {
    return (
      <div className={`${dim} relative flex-shrink-0`}>
        <div
          className="w-full h-full rounded-lg overflow-hidden flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #2e1065 0%, #1c1a2e 50%, #451a03 100%)',
            boxShadow: '0 0 0 2px #d97706cc, 0 0 8px 1px #d9770640',
          }}
        >
          <FallbackImage
            candidates={candidates}
            alt={name}
            className="w-full h-full object-contain"
            fallback={<span className="text-amber-200/60 text-[13px]">武</span>}
          />
        </div>
      </div>
    )
  }

  return (
    <FallbackImage
      candidates={candidates}
      alt={name}
      className={`${dim} rounded-lg object-contain bg-bg-dark border border-border flex-shrink-0`}
      fallback={
        <div className={`${dim} rounded-lg bg-bg-dark border border-border flex items-center justify-center flex-shrink-0`}>
          <span className="text-text-dim text-[13px]">武</span>
        </div>
      }
    />
  )
}
