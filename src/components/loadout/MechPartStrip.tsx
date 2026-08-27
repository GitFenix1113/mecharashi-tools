import { useMemo } from 'react'
import { MechPartPosition } from '../../types/enums'
import type { ModuleSlotRef } from '../../types/slots'
import { imageCandidates } from '../../utils/assets'
import { partLabel } from '../../utils/moduleSlots'
import { interfaceState, moduleStacks, moduleFamilyKey } from '../../utils/moduleRules'
import type { LoadoutContext } from '../../utils/loadoutRules'
import { FallbackImage } from '../common/FallbackImage'
import { ModuleIcon } from '../icons/ModuleIcon'
import { ActionChevron } from './ActionChevron'
import { HUD } from './loadoutTheme'

// ─── 四部位卡（PLAN-052-I B-2 版面 ／ 052-G C-2 行為 ／ C-8 十字排版）──────────
//
// 軀幹／左臂／右臂／腿部與各自的模組接口，一個部位一張。**整張卡可點**，
// 點下去在右欄開該接口的模組面板。
//
// ⚠ **這裡只出一張卡，排版由 `LoadoutRig` 決定**（使用者要求 2026-08-28）。
//   在那之前這支檔案自己排一個十字、整塊掛在槽位圖下方，於是同一台機體被講了兩次：
//   上半張圖講武器掛在哪、下半張圖講模組裝在哪，而玩家要在腦中把兩張圖疊起來。
//   現在四張卡直接歸位到槽位圖裡（軀幹在最上、雙臂插在同側的肩與手之間、腿部在下），
//   武器與模組因此在**同一側相鄰**——「右肩→右臂→右手→右備用」是一路讀下來的一欄，
//   而那個順序就是機體由上而下的解剖順序。
//
// ── 為什麼排成十字而不是 2×2（C-8，使用者裁決 2026-08-27）──────────────────
// 遊戲的整備畫面就是「軀幹在上、雙臂並排、腿部在下」的人形排列，而 2×2 的方陣
// 讀不出哪一格對應機體的哪裡 —— 玩家得靠讀字才知道。十字排列讓位置自己說話，
// 與槽位圖（左肩右肩／左手右手左右分欄）也是同一套空間語彙。
// **這條裁決在歸位之後仍然成立、而且更強**：現在那個十字是真的長在機體上的。
//
// ⚠ **右臂在畫面左、左臂在畫面右**（使用者裁決 2026-08-27，翻掉了原本的做法）。
//   理由是「從正面看機體」——遊戲整備畫面就是這樣擺，玩家一邊看站上一邊看遊戲時
//   不必在腦內翻面。上一版的論證是「以畫面為準才一致」，那個一致性仍然成立：
//   槽位圖（LoadoutRig）**在同一次改動裡一起翻**，一頁裡只有一套左右。
//   ⚠ 歸位之後這條變成硬約束：右臂卡就接在右手武器格底下，兩者要是各有一套左右，
//     那一整欄會同時寫著「右手」與「左臂」。
//
// ⚠ **雙臂那一列固定兩欄**，不要用 `xl:grid-cols-4`：Tailwind 的斷點看的是視窗寬，
//   而這些卡住在一個 ~520px 的欄裡 —— 視窗一寬就變成四張 ~120px 的卡。
//   同理，「雙臂要不要進側欄」也由 `LoadoutRig` 量到的**容器寬**決定，不看視窗寬。
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
// ⚠ 四部位任一缺席時 `resolveChassis()` 回 null → **卡片不渲染**，不補零值部位。

/**
 * 三種不可裝的狀態，**各自一句話**。
 *
 * ⚠ 三者共用一句話或留白，會被讀成一個我們並不知道的否定陳述 ——
 *   2026-08-27 修掉的「B 品質接口資料未建檔」正是那種錯：它們是**真的沒有接口**。
 */
const IFACE_NONE = '無模組接口'
const IFACE_UNKNOWN = '接口型別不明'

/**
 * 抬頭那句說明的去處（`Parts · Modules` 抬頭已隨歸位一起拆掉）。
 *
 * ⚠ 卡片散進槽位圖之後就**沒有一個叫做「四部位」的區塊**可以掛抬頭了 ——
 *   硬留一個抬頭會指向四張不相鄰的卡。這句話改由 `LoadoutRig` 掛在整張圖的最下緣。
 *   模組那半已經拆掉（C-6）；部件混搭還沒開放，那半句仍然是誠實的。
 */
export const PART_MIX_NOTE = '部件混搭開放後，每個部位可換成別台機甲的同位部件'

interface Props {
  ctx: LoadoutContext
  /** 要畫哪一個部位 */
  position: MechPartPosition
  /** 開這一格的模組面板。未傳＝維持唯讀（匯出圖等唯讀情境） */
  onOpenModule?: (ref: ModuleSlotRef) => void
  /** 目前面板開著的那一格，畫成選中狀態 */
  activePosition?: MechPartPosition | null
}

/**
 * 單一部位的模組卡。排在哪裡由呼叫端（`LoadoutRig`）決定，見檔頭。
 *
 * ⚠ 四部位任一缺席時 `resolveChassis()` 回 null → **這張卡自己不渲染**，不補零值部位。
 *   guard 留在卡身上而不是呼叫端：呼叫端散在槽位圖的四個位置，各寫一次
 *   就是同一條規則的四份副本，而它們會各自過期。
 */
export function MechPartCard({ ctx, position, onOpenModule, activePosition }: Props) {
  // 同族堆疊：卡片上的 Lv 是**那一族的合計**，不是這一格自己的（C-7）
  const stacks = useMemo(
    () => moduleStacks(ctx.modules, (id) => ctx.world.modules.get(id)),
    [ctx.modules, ctx.world.modules],
  )

  if (!ctx.mech || !ctx.chassis) return null

  return (
    <PartCard
      ctx={ctx}
      stacks={stacks}
      position={position}
      active={activePosition === position}
      onOpen={onOpenModule}
    />
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
          fallback={<span className="text-[10px] text-text-dim">無圖</span>}
        />
      </span>

      <span className="flex flex-col min-w-0 grow text-left" style={{ gap: 1 }}>
        <span className="flex items-baseline" style={{ gap: 5 }}>
          <span className="text-[13px] font-semibold text-text-primary leading-tight">
            {partLabel(position)}
          </span>
          <span className={`${HUD.num} text-[11px] leading-tight ${usable ? 'text-text-dim' : 'text-text-dim italic'}`}>
            {ifaceText}
          </span>
        </span>

        {/* 已裝：縮圖 ＋ 名稱 ＋ 該族合計等級。未裝：一句話，不留白 */}
        {usable && (
          equipped ? (
            <span className="flex items-center min-w-0" style={{ gap: 5 }}>
              <ModuleIcon mod={equipped} size={22} />
              <span className="text-[12px] text-accent-orange truncate leading-tight">{equipped.name}</span>
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
              <span className="text-[12px] text-text-dim leading-tight">
                {equippedId ? '模組資料已不存在' : '未裝模組'}
              </span>
            </span>
          )
        )}
      </span>
    </>
  )

  const shell = 'hud-cut-sm group flex items-center gap-2 px-2 py-1.5 border transition-colors w-full'

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
          // ⚠ 可點的卡用 `border-border`（亮一階），唯讀那條維持 `border-border-subtle` ——
          //   兩種卡會並排出現（B 品質機甲四格全無接口，S 品質四格全可點），
          //   框線階是它們唯一的靜態差別，加上右緣的 `›`
          : 'border-border bg-bg-card/70 hover:border-accent-orange/60'
      }`}
    >
      {body}
      <ActionChevron />
    </button>
  )
}
