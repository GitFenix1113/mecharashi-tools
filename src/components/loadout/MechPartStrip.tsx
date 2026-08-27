import { useMemo } from 'react'
import { MechPartPosition } from '../../types/enums'
import type { ModuleSlotRef } from '../../types/slots'
import { imageCandidates } from '../../utils/assets'
import { partLabel } from '../../utils/moduleSlots'
import { interfaceState, moduleStacks, moduleFamilyKey } from '../../utils/moduleRules'
import type { LoadoutContext } from '../../utils/loadoutRules'
import { FallbackImage } from '../common/FallbackImage'
import { ModuleIcon } from '../icons/ModuleIcon'
import { HUD } from './loadoutTheme'

// ─── 四部位卡（PLAN-052-I B-2 版面 ／ 052-G C-2 行為 ／ C-8 十字排版）──────────
//
// 槽位圖下方，顯示軀幹／左臂／右臂／腿部與各自的模組接口。**整張卡可點**，
// 點下去在右欄開該接口的模組面板。
//
// ── 為什麼排成十字而不是 2×2（C-8，使用者裁決 2026-08-27）──────────────────
// 遊戲的整備畫面就是「軀幹在上、雙臂並排、腿部在下」的人形排列，而 2×2 的方陣
// 讀不出哪一格對應機體的哪裡 —— 玩家得靠讀字才知道。十字排列讓位置自己說話，
// 與正上方那張槽位圖（左肩右肩／左手右手左右分欄）也是同一套空間語彙。
//
// ⚠ **左臂在左、右臂在右**，與遊戲畫面**相反**（它是從正面看機體，所以左右對調）。
//   刻意不跟：本頁正上方的槽位圖已經是「左肩在左」，兩者同時出現在一個畫面上，
//   一個跟機體、一個跟畫面會變成同一頁裡的兩套左右。以**畫面**為準是一致的那一邊。
//
// ⚠ **仍然固定兩欄**（雙臂那一列），不要用 `xl:grid-cols-4`：Tailwind 的斷點看的是
//   視窗寬，而這排卡片住在一個 520px 的欄裡 —— 視窗一寬就變成四張 ~120px 的卡。
//
// ── 為什麼卡上要有模組縮圖（C-8）────────────────────────────────────────────
// 使用者逐字：「模組和元件選擇後，介面是否能更直觀些？用縮圖或什麼方式讓玩家
// 看得出來裝了什麼。」在那之前這裡只有一行文字（「Ⅱ型接口 · 刀劍模組Ⅱ」）——
// 名字要讀完才知道裝了什麼，而四張卡疊在一起時那是四行要讀的字。
//
// ⚠ 接口空字串 ＝ **這台機甲沒有模組接口**（2026-08-27 起只有這一種語意）。
//   今天只有 B 品質機甲（10 台 40 格）屬於這一種。仍然要把它寫出來 ——
//   留白會被讀成「應該有但我們沒查到」，而事實正好相反。
//
// ⚠ 四部位任一缺席時 `resolveChassis()` 回 null → **整區不渲染**，不補零值部位。

/**
 * 三種不可裝的狀態，**各自一句話**。
 *
 * ⚠ 三者共用一句話或留白，會被讀成一個我們並不知道的否定陳述 ——
 *   2026-08-27 修掉的「B 品質接口資料未建檔」正是那種錯：它們是**真的沒有接口**。
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

  // 同族堆疊：卡片上的 Lv 是**那一族的合計**，不是這一格自己的（C-7）
  const stacks = useMemo(
    () => moduleStacks(ctx.modules, (id) => ctx.world.modules.get(id)),
    [ctx.modules, ctx.world.modules],
  )

  if (!mech || !chassis) return null

  const card = (position: MechPartPosition) => (
    <PartCard
      ctx={ctx}
      stacks={stacks}
      position={position}
      active={activePosition === position}
      onOpen={onOpenModule}
    />
  )

  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`${HUD.label} text-text-secondary`}>Parts · Modules</span>
        {/* 模組那半已經拆掉（C-6）；部件混搭還沒開放，那半句仍然是誠實的 */}
        <span className="text-[10px] text-text-dim leading-tight text-right">
          部件混搭開放後，每個部位可換成別台機甲的同位部件
        </span>
      </div>

      {/* 十字排列：軀幹 ／ 左臂 右臂 ／ 腿部 —— 位置自己說話，不必讀字。
          ⚠ 軀幹與腿部**置中且與手臂卡等寬**，不是整寬（使用者回饋 2026-08-27）：
            拉成整寬時那兩張卡的內容全靠左、右半邊一片空，看起來像沒排完 ——
            而「十字」的形狀也因此讀不出來（整寬的兩條只是兩條橫線）。
            寬度用 `calc(50% - 半個 gap)` 對齊手臂那一列，三層的邊緣才切齊。 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 flex justify-center">
          <div className="w-[calc(50%-0.25rem)]">{card(MechPartPosition.TORSO)}</div>
        </div>
        {card(MechPartPosition.LEFT_ARM)}
        {card(MechPartPosition.RIGHT_ARM)}
        <div className="col-span-2 flex justify-center">
          <div className="w-[calc(50%-0.25rem)]">{card(MechPartPosition.LEGS)}</div>
        </div>
      </div>
    </section>
  )
}

function PartCard({ ctx, stacks, position, active, onOpen }: {
  ctx: LoadoutContext
  stacks: ReturnType<typeof moduleStacks>
  position: MechPartPosition
  active: boolean
  onOpen?: (ref: ModuleSlotRef) => void
}) {
  const { part } = ctx.chassis!.parts[position]
  const iface = interfaceState(ctx.chassis!.moduleSlots[position].iface)
  const equippedId = ctx.modules[position]
  const equipped = equippedId ? ctx.world.modules.get(equippedId) ?? null : null
  const stack = equipped ? stacks.get(moduleFamilyKey(equipped)) ?? null : null

  // 沒有接口（B 品質）與型別不明都不該可點 —— 點開只會看到一個降級說明的空面板
  const usable = iface !== 'none' && iface !== 'unknown'
  const clickable = usable && !!onOpen

  const ifaceText = iface === 'none' ? IFACE_NONE : iface === 'unknown' ? IFACE_UNKNOWN : iface

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

      <span className="flex flex-col min-w-0 grow text-left" style={{ gap: 1 }}>
        <span className="flex items-baseline" style={{ gap: 5 }}>
          <span className="text-[12px] font-semibold text-text-primary leading-tight">
            {partLabel(position)}
          </span>
          <span className={`${HUD.num} text-[9px] leading-tight ${usable ? 'text-text-dim' : 'text-text-dim italic'}`}>
            {ifaceText}
          </span>
        </span>

        {/* 已裝：縮圖 ＋ 名稱 ＋ 該族合計等級。未裝：一句話，不留白 */}
        {usable && (
          equipped ? (
            <span className="flex items-center min-w-0" style={{ gap: 5 }}>
              <ModuleIcon mod={equipped} size={22} />
              <span className="text-[11px] text-accent-orange truncate leading-tight">{equipped.name}</span>
              {stack && (
                <span className={`${HUD.num} text-[10px] shrink-0 ml-auto ${
                  stack.overflow > 0 ? 'text-accent-yellow/90' : 'text-text-dim'
                }`}>
                  Lv{stack.level}/{stack.cap}
                </span>
              )}
            </span>
          ) : (
            <span className="flex items-center" style={{ gap: 5 }}>
              <ModuleIcon mod={null} size={22} className="border-dashed" />
              <span className="text-[11px] text-text-dim leading-tight">
                {equippedId ? '模組資料已不存在' : '未裝模組'}
              </span>
            </span>
          )
        )}
      </span>
    </>
  )

  const shell = 'hud-cut-sm flex items-center gap-2 px-2 py-1.5 border transition-colors w-full'

  if (!clickable) {
    return (
      <div className={`${shell} border-border-subtle bg-bg-card/70`} title={!usable ? ifaceText : undefined}>
        {body}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onOpen!({ kind: 'module', position })}
      className={`${shell} cursor-pointer ${
        active
          ? 'border-accent-orange bg-accent-orange/10'
          : 'border-border-subtle bg-bg-card/70 hover:border-accent-orange/60'
      }`}
    >
      {body}
    </button>
  )
}
