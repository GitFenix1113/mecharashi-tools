import type { MechPartPosition } from '../../types/enums'
import type { ModuleSlotRef } from '../../types/slots'
import { MECH_PART_ORDER } from '../../utils/chassisStats'
import { imageCandidates } from '../../utils/assets'
import { partLabel } from '../../utils/moduleSlots'
import { interfaceState } from '../../utils/moduleRules'
import type { LoadoutContext } from '../../utils/loadoutRules'
import { FallbackImage } from '../common/FallbackImage'
import { HUD } from './loadoutTheme'

// ─── 四部位卡（PLAN-052-I B-2 版面 ／ PLAN-052-G C-2 行為）───────────────────
//
// 槽位圖下方一排，顯示軀幹／左臂／右臂／腿部與各自的模組接口。
//
// **052-G Phase C 起這一排可以點了** —— 點一張卡就在右欄開該接口的模組面板。
// 在那之前它刻意標明唯讀（「一個看起來能點卻沒有反應的卡片，比一張標明建置中的卡片
// 難處理得多」），那句告示已隨模組面板落地而拆掉模組那半；部件混搭仍是 Phase D。
//
// ⚠ **整卡可點，不再造第二種徽章語彙**（進度表 C-2）：052-D 的元件入口第一版做成
//   槽位圖上的 ⚙ 徽章，站長找不到，最後改成格子下方的窄列。這裡的四張卡本身就是格子。
//
// ⚠ 接口空字串 ＝ **這台機甲沒有模組接口**（2026-08-27 起只有這一種語意）。
//   今天只有 B 品質機甲（10 台 40 格）屬於這一種，官方基礎階與滿階皆空、已佐證。
//   仍然要把它寫出來 —— 留白會被讀成「應該有但我們沒查到」，而事實正好相反。
//
// ⚠ 四部位任一缺席時 `resolveChassis()` 回 null → **整區不渲染**，不補零值部位。
//   一排重量 0、火力 0 的假部件比「這台資料不完整」難查太多。

/**
 * 三種不可裝的狀態，**各自一句話**（進度表 C-2 第二列）。
 *
 * ⚠ 三者共用一句話或留白，會被讀成一個我們並不知道的否定陳述 ——
 *   2026-08-27 修掉的「B 品質接口資料未建檔」正是那種錯：它們是**真的沒有接口**，
 *   不是我們沒查到。原本列在計畫裡的第二種（美杜莎MK2「接口資料未建檔」）
 *   已經不存在（B-2 把那 4 格依 S 級規則補齊了），取而代之的是
 *   「接口型別不明」—— 認不得的值，那才是真正的「不知道」。
 */
const IFACE_NONE = '無模組接口'
const IFACE_UNKNOWN = '接口型別不明'

interface Props {
  ctx: LoadoutContext
  /** 開這一格的模組面板。未傳＝維持唯讀（匯出圖等唯讀情境） */
  onOpenModule?: (ref: ModuleSlotRef) => void
  /** 目前面板開著的那一格，畫成選中狀態 */
  activePosition?: MechPartPosition | null
}

export function MechPartStrip({ ctx, onOpenModule, activePosition }: Props) {
  const { mech, chassis } = ctx
  if (!mech || !chassis) return null

  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`${HUD.label} text-text-secondary`}>Parts · Modules</span>
        {/* C-6：模組那半已經拆掉；部件混搭還沒開放，那半句仍然是誠實的 */}
        <span className="text-[10px] text-text-dim leading-tight text-right">
          部件混搭開放後，每個部位可換成別台機甲的同位部件
        </span>
      </div>

      {/* ⚠ 固定兩欄，**不要**用 `xl:grid-cols-4`：Tailwind 的斷點看的是視窗寬，
          而這排卡片住在一個 520px 的欄裡 —— 視窗一寬就變成四張 ~120px 的卡，
          「軀幹」會被擠成直排。四張分兩列剛好。 */}
      <div className="grid grid-cols-2 gap-2">
        {MECH_PART_ORDER.map((pos) => (
          <PartCard
            key={pos}
            ctx={ctx}
            position={pos}
            active={activePosition === pos}
            onOpen={onOpenModule}
          />
        ))}
      </div>
    </section>
  )
}

function PartCard({ ctx, position, active, onOpen }: {
  ctx: LoadoutContext
  position: MechPartPosition
  active: boolean
  onOpen?: (ref: ModuleSlotRef) => void
}) {
  const { part } = ctx.chassis!.parts[position]
  const iface = interfaceState(ctx.chassis!.moduleSlots[position].iface)
  const equippedId = ctx.modules[position]
  const equipped = equippedId ? ctx.world.modules.get(equippedId) ?? null : null

  // 沒有接口（B 品質）與型別不明都不該可點 —— 點開只會看到一個降級說明的空面板
  const usable = iface !== 'none' && iface !== 'unknown'
  const clickable = usable && !!onOpen

  /**
   * 副標：**接口型別 · 已裝模組名／未裝**（進度表 C-2）。
   *
   * ⚠ 原本是「Ⅱ型接口 ×1」—— 那個 ×1 在四個部位上永遠是 1，等於一個不帶資訊的字。
   *   換成「已裝了什麼」之後，這一排才回答得出玩家真正會問的問題。
   */
  const sub = iface === 'none' ? IFACE_NONE
    : iface === 'unknown' ? IFACE_UNKNOWN
    : `${iface} · ${equipped?.name ?? (equippedId ? '模組資料已不存在' : '未裝')}`

  const body = (
    <>
      <span className="shrink-0 w-9 h-9 flex items-center justify-center">
        <FallbackImage
          candidates={imageCandidates(part.icon)}
          alt=""
          loading="lazy"
          className="max-w-full max-h-full object-contain"
          fallback={<span className="text-[9px] text-text-dim">無圖</span>}
        />
      </span>
      <div className="flex flex-col min-w-0 text-left">
        <span className="text-[12px] font-semibold text-text-primary leading-tight">
          {partLabel(position)}
        </span>
        <span
          className={`${HUD.num} text-[10px] leading-tight truncate ${
            !usable ? 'text-text-dim italic'
              : equipped ? 'text-accent-orange'
              : 'text-text-dim'
          }`}
        >
          {sub}
        </span>
      </div>
    </>
  )

  const shell = 'hud-cut-sm flex items-center gap-2 px-2 py-1.5 border transition-colors'

  if (!clickable) {
    return (
      <div className={`${shell} border-border-subtle bg-bg-card/70`} title={!usable ? sub : undefined}>
        {body}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onOpen!({ kind: 'module', position })}
      className={`${shell} cursor-pointer w-full ${
        active
          ? 'border-accent-orange bg-accent-orange/10'
          : 'border-border-subtle bg-bg-card/70 hover:border-accent-orange/60'
      }`}
    >
      {body}
    </button>
  )
}
