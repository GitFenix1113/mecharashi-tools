import type { Mech } from '../../types'
import { MECH_PART_ORDER, resolveChassis } from '../../utils/chassisStats'
import { imageCandidates } from '../../utils/assets'
import { FallbackImage } from '../common/FallbackImage'
import { HUD } from './loadoutTheme'

// ─── 四部位唯讀卡（PLAN-052-I B-2）──────────────────────────────────────────
//
// 槽位圖下方一排，顯示軀幹／左臂／右臂／腿部與各自的模組接口型別。
//
// **今天它是唯讀的，而且刻意講出來。** 部件混搭與模組槽是 052-G 的事；在那之前
// 這四張卡不能長得像可以點 —— 一個看起來能點卻沒有反應的卡片，比一張標明
// 「建置中」的卡片難處理得多（決策：整排底部寫出「開放後可換」，而不是靜默唯讀）。
//
// ⚠ 接口空字串 ＝ **這台機甲沒有模組接口**（2026-08-27 起只有這一種語意）。
//   今天只有 B 品質機甲（10 台 40 格）屬於這一種，官方基礎階與滿階皆空、已佐證。
//   仍然要把它寫出來 —— 留白會被讀成「應該有但我們沒查到」，而事實正好相反。
//
// ⚠ 四部位任一缺席時 `resolveChassis()` 回 null → **整區不渲染**，不補零值部位。
//   一排重量 0、火力 0 的假部件比「這台資料不完整」難查太多。

const PART_LABEL: Record<string, string> = {
  torso: '軀幹', leftArm: '左臂', rightArm: '右臂', legs: '腿部',
}

/** 沒有模組接口時的呈現。與機甲詳情頁（MechSlotPanel）同一句措辭。 */
const IFACE_NONE = '無模組接口'

export function MechPartStrip({ mech }: { mech: Mech | null }) {
  const chassis = resolveChassis(mech)
  if (!mech || !chassis) return null

  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`${HUD.label} text-text-secondary`}>Parts</span>
        <span className="text-[10px] text-text-dim leading-tight text-right">
          部件混搭開放後，每個部位可換成別台機甲的同位部件
        </span>
      </div>

      {/* ⚠ 固定兩欄，**不要**用 `xl:grid-cols-4`：Tailwind 的斷點看的是視窗寬，
          而這排卡片住在一個 520px 的欄裡 —— 視窗一寬就變成四張 ~120px 的卡，
          「軀幹」會被擠成直排。四張分兩列剛好。 */}
      <div className="grid grid-cols-2 gap-2">
        {MECH_PART_ORDER.map((pos) => {
          const { part } = chassis.parts[pos]
          const iface = chassis.moduleSlots[pos].iface
          return (
            <div
              key={pos}
              className="hud-cut-sm flex items-center gap-2 px-2 py-1.5 border border-border-subtle bg-bg-card/70"
            >
              <span className="shrink-0 w-9 h-9 flex items-center justify-center">
                <FallbackImage
                  candidates={imageCandidates(part.icon)}
                  alt=""
                  loading="lazy"
                  className="max-w-full max-h-full object-contain"
                  fallback={<span className="text-[9px] text-text-dim">無圖</span>}
                />
              </span>
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-semibold text-text-primary leading-tight">
                  {PART_LABEL[pos] ?? pos}
                </span>
                <span
                  className={`${HUD.num} text-[10px] leading-tight ${
                    iface ? 'text-text-dim' : 'text-text-dim italic'
                  }`}
                >
                  {iface ? `${iface} ×1` : IFACE_NONE}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
