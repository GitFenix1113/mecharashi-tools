import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Component } from '../../types'
import type { ModuleSlotRef, SlotKey, WeaponSlotRef } from '../../types/slots'
import { slotKey } from '../../types/slots'
import { MechPartPosition, WeaponEquipSlot } from '../../types/enums'
import { MECH_PART_ORDER } from '../../utils/chassisStats'
import { slotLabel } from '../../utils/mechSlots'
import { rigColumnRefs } from '../../utils/rigLayout'
import { imageCandidates } from '../../utils/assets'
import { FallbackImage } from '../common/FallbackImage'
import {
  backpackHasCandidates, planWeaponUpgrade, slotExists, slotHasCandidates, slotOccupant,
  type LoadoutContext, type SlotOccupant,
} from '../../utils/loadoutRules'
import { SlotCell, type SlotCellPreview } from './SlotCell'
import { HUD, slotIconName, slotSegKey } from './loadoutTheme'
import { MechPartCard, PART_MIX_NOTE } from './MechPartStrip'

// ─── 槽位圖（PLAN-052-B B-2／PLAN-052-I B-2）──────────────────────────────────
//
// 改版前這裡是「4 列 × 2 欄的方格 grid ＋ 文字標籤」——功能正確，但沒有任何線索
// 讓玩家意識到自己在對一台機體動手。現在是一張 HUD：機甲立繪擺中央，槽位卡分列左右，
// SVG 引線把每一格連回機體。
//
// ⚠ 「一眼看到全部槽位」仍是整個設計的前提，所以**手機版也不縮成一欄清單**，
//   改壓縮格高與字級（`compact`）。縮成清單就退回成一份「要捲才看得完的表」，
//   而那正是 8 步驟精靈之所以沒人用第二次的同一個病。
//
// ⚠ 引線的座標**一律用量的，不用寫死的 viewBox**。設計階段踩過一次：
//   畫布上的 `viewBox="0 0 854 600" preserveAspectRatio="none"` 在容器不是那個尺寸時
//   會把線拉歪，而節點是用 px 定位的 —— 兩者不同步，線就接不到節點上。
//   這裡改成 ResizeObserver 量真實矩形、viewBox 直接等於容器像素尺寸，
//   於是任何寬度、任何節點高度（長武器名換行）都對得上。
//
// ⚠ **畫面左欄放的是機體的「右」側**（使用者裁決 2026-08-27）：本頁是從正面看機體，
//   所以機體的右臂出現在畫面左邊，與遊戲整備畫面一致。改版前是「左肩在畫面左」——
//   那讀起來直覺，但玩家對照遊戲時會發現兩邊左右相反，而槽位標籤仍寫著「左肩」，
//   於是每一次對照都要在腦內翻一次。下方四部位卡（MechPartStrip）同時翻面，
//   一頁裡只有一套左右。
//
// ⚠ 三種槽位刻意**不進左右兩欄**，而是自己佔一整列：
//     無肩槽    → 那是「整排不存在」，畫成左右兩個一樣的灰格只是把同一句話說兩遍
//     雙手武器  → 它同時佔住左右手，畫在其中一欄會讓對面憑空缺一格
//     背部      → 它不屬於左也不屬於右
//
// ── 四部位模組卡「歸位」（使用者要求 2026-08-28）────────────────────────────
// 在那之前四部位卡是掛在這張圖**下方**的一整塊十字（`MechPartStrip` 自己排）。
// 於是同一台機體被講了兩次：上面講武器掛在哪、下面講模組裝在哪，玩家要自己把
// 兩張圖疊起來。現在四張卡直接長在這張圖上，由上而下：
//
//     軀幹（整列置中半寬）
//     肩／臂／手／備用手  ｜ 機甲 ｜  肩／臂／手／備用手   ← 臂卡插在肩與手之間
//     腿部（整列置中半寬）
//     背部（整列）
//
// 於是「右肩 → 右臂 → 右手 → 右備用」是一路讀下來的**同一欄**，而那個順序就是
// 機體由上而下的解剖順序 —— 武器與模組相鄰，十字的形狀（軀幹在上、雙臂在中、
// 腿部在下）長在真正的機體上。
//
// ⚠ 容器窄到 `dense` 以下時雙臂**退回整寬兩欄**（見該處註解）：側欄在那個寬度
//   只剩約 120px，塞不下兩行內容的部位卡。那不是第二套版面，是同一個十字的窄版。
// ⚠ 部位卡**不接引線**：引線回答「這一格屬於機體哪一側」，而部位卡自己就是部位，
//   給它拉一條指回機體的線只是把同一句話說第二遍。
//
// ⚠ 官方把背包夾在兩個備用槽中間；本設計把**背包放在背部那一列**——背包不是手，
//   而它與背部武器共用同一格，擺在一起才看得出兩者互斥。

interface Props {
  ctx: LoadoutContext
  /** 挑選器正對著的那一格 */
  activeSlot: SlotKey | null
  /** hover 預覽：只在細指標裝置有值（決策一） */
  preview: { slot: SlotKey; content: SlotCellPreview } | null
  /** 剛被級聯移除的格（值是 `slotLabel()` 的字串，與 `RemovedItem.where` 同源） */
  flash: readonly string[]
  /** 目前餘量，畫在空槽上（「可用 320」）。機甲數值未公布時傳 undefined */
  available?: number
  compact?: boolean
  onOpenSlot: (ref: WeaponSlotRef) => void
  onClearSlot: (ref: WeaponSlotRef) => void
  /** 開這一格武器的元件面板（PLAN-052-D）。⚙ 徽章只出現在裝得了元件的武器格上 */
  onOpenComponents?: (ref: WeaponSlotRef) => void
  /**
   * 把這一格的武器換成它的進階版（使用者要求 2026-08-27）。
   * 未傳＝不畫升級列（匯出圖等唯讀情境）。
   */
  onUpgrade?: (ref: WeaponSlotRef, weaponId: string) => void
  /** 開某個部位的模組面板（PLAN-052-G C-2）。未傳＝四部位卡維持唯讀 */
  onOpenModule?: (ref: ModuleSlotRef) => void
  /** 模組面板正對著的那個部位，畫成選中狀態 */
  activeModule?: MechPartPosition | null
  /**
   * 四個部位一次全部換成同一台（使用者要求 2026-08-29）。
   * 未傳＝不畫那一列（匯出圖等唯讀情境）。
   */
  onApplyChassis?: (sourceMechId: string) => void
}

/**
 * 引線在機體上的落點，用**機甲圖框的比例**表示（不是 px）。
 *
 * 為什麼是比例：`portrait.webp` 是 3/4 特寫、每台機甲構圖不同，本來就沒有可靠的
 * 解剖學落點可算。引線在這裡是 HUD 語彙（「這一格屬於機體的哪一側」），不是解剖標註，
 * 因此固定比例即可，且機甲圖縮放時落點自動跟著走。
 */
const ANCHOR: Record<'shoulder' | 'hand' | 'backup', [number, number]> = {
  shoulder: [0.14, 0.24],
  hand:     [0.06, 0.55],
  backup:   [0.12, 0.84],
}

interface RigLine {
  key: string
  /** 節點邊緣 → 短水平段 → 機體落點 */
  d: string
  /** 機體上的落點，另外畫一顆小圓點 */
  ax: number
  ay: number
}

interface RigLines {
  w: number
  h: number
  items: RigLine[]
}

/** 量出來的值是連續的浮點數，取到 0.1px 才不會每一幀都判定成「變了」而重繪。 */
const round = (n: number) => Math.round(n * 10) / 10

function sameLines(a: RigLines, b: RigLines): boolean {
  return a.w === b.w && a.h === b.h && a.items.length === b.items.length
    && a.items.every((it, i) => it.d === b.items[i].d)
}

/** 引線從節點邊緣往外走的那一小段水平線長度（px）。 */
const LEAD = 10
/** 低於這個容器寬度就不畫引線：線太短反而變成噪點。 */
const LINE_MIN_WIDTH = 380
/**
 * 低於這個容器寬度，槽位格改用窄版（重量排到名稱下方）。
 *
 * 由 `(W − 內距 26 − 機甲 132 − 兩道 gap 56) / 2 ≥ 200` 反推。200px 是一格能同時放下
 * 圖示、武器名與右側重量的下限；再窄下去名稱欄會被壓成省略號。
 *
 * ⚠ **2026-08-27 由 570 上調到 610**：`SlotCell` 的名稱字級隨字階調整由 13px → 14px
 *   （使用者要求），一格放得下的下限因此從 190 變成 200。字級改了而這個門檻沒跟著改，
 *   症狀是「在 570–610 之間的寬度下，名稱被截斷但系統還認為自己是寬版」——
 *   而它不會有任何錯誤訊息。
 */
const DENSE_MAX_WIDTH = 610
/**
 * 這一格要不要 ⚙ 徽章，以及上面印幾個（PLAN-052-D）。
 *
 * ⚠ 判準是 **`componentLimit > 0`**，不是「這格有武器」：A／B 品質 39 把與 8 筆固定武裝
 *   實測 `componentLimit` 皆為 0，給它們一顆點開只會看到「不可裝元件」的徽章，
 *   等於在畫面上擺一個必然落空的入口。背包同理（沒有元件槽）。
 */
function componentBadge(
  ctx: LoadoutContext,
  occ: SlotOccupant,
  ref: WeaponSlotRef,
  onOpenComponents?: (ref: WeaponSlotRef) => void,
): {
  onComponents?: () => void
  componentUsed?: number
  componentLimit?: number
  componentIcons?: Component[]
} {
  if (!onOpenComponents) return {}
  const weapon = occ.kind === 'weapon' ? occ.weapon
    : occ.kind === 'fixed' ? occ.weapon
    : occ.kind === 'formLocked' ? occ.weapon
    : null
  if (!weapon || weapon.componentLimit <= 0) return {}
  const setup = occ.kind === 'weapon' ? occ.mount.setup : undefined
  const ids = [...(setup?.triggerComponentIds ?? []), ...(setup?.effectComponentIds ?? [])]
  return {
    onComponents: () => onOpenComponents(ref),
    componentUsed: ids.length,
    componentLimit: weapon.componentLimit,
    // 查不到的 id 濾掉：那一顆的資料斷鏈由元件面板印紅字，格子上的縮圖列不適合承載錯誤
    // —— 一枚空框在四枚圖示中間會被讀成「有一顆我不認得的元件」，而那是對的但幫不上忙。
    componentIcons: ids.map((id) => ctx.world.components.get(id)).filter((c): c is Component => !!c),
  }
}

/**
 * 低於這個容器寬度改用**極窄格**（`SlotCell` 的 `tight`）：手機直向時左右兩欄各只剩 ~120px。
 *
 * ⚠ 這個門檻**刻意與 `LINE_MIN_WIDTH` 同值**：低於它就不畫引線，而
 *   `gap-x-6`（實測 28.5px ×2）存在的唯一理由就是「引線的可見長度」。
 *   線不畫了，那 57px 的縫就是純粹的浪費 —— 而它正是把兩欄擠到放不下字的元凶。
 *   收到 `gap-x-2` ＋ 縮小機甲圖，兩欄才拿得回可讀的寬度。
 */
const TIGHT_MAX_WIDTH = LINE_MIN_WIDTH

/**
 * ── 寬容器的空間分配：**欄寬封頂，餘裕全給立繪**（使用者要求 2026-08-28）─────
 *
 * 使用者逐字：「裝備名稱似乎普遍沒有那麼長，我想是不是可以把中間的圖再放大、
 * 縮窄裝備欄位的寬度」。在那之前兩側是 `minmax(0,1fr)`，於是視窗每寬 100px 就有
 * 100px 被平均倒進兩欄的**右側留白**（實測：中欄 1050px 時單欄 365px，而一格真正
 * 用得到的是圖示 42 ＋ 六個字 90 ＋ 重量 30 ＋ 內距間隙 ≈ 200）。版面越寬，
 * 主視覺佔比反而越小 —— 而這一頁的主角就是那台機體。
 *
 * 現在改成：側欄 `minmax(0, SLOT_MAX_WIDTH)`、中欄 `minmax(MECH_MIN_WIDTH, 1fr)`。
 * grid 先把非彈性軌撐到上限（250），剩下的**全部**歸中欄，立繪再以 `max-w` 封頂。
 *
 * ⚠ 中欄那個 `min` 不可省：沒有它，兩側會在窄容器把中欄壓成幾十 px。
 *   值取 164 ＝ 改版前的固定立繪尺寸，於是 610–738 這一段的欄寬與改版前逐 px 相同。
 *
 * ⚠ `SLOT_MAX_WIDTH` 是**唯一**要調的數字：嫌欄位還太寬就往下調，
 *   發現某把武器名被截就往上調。250 的依據是上面那筆 200px 實測 ＋ 50px 餘裕。
 *   （名稱本來就有 `truncate`，調過頭的後果是省略號，不是破版。）
 */
const SLOT_MAX_WIDTH = 250
/** 中欄的下限 ＝ 改版前的固定立繪尺寸。見 `SLOT_MAX_WIDTH` 的第二條註解。 */
const MECH_MIN_WIDTH = 164
/**
 * ⚠ **class 一律寫成完整字面值，不可用樣板字串把常數插進去。**
 *   Tailwind v4 掃的是原始碼裡出現過的字串，`grid-cols-[minmax(0,${X}px)_…]`
 *   產不出任何 class —— 而它不會報錯，症狀是版面靜靜地退回瀏覽器預設的單軌 grid。
 *   下面兩個 grid 字串裡的數字必須與上面兩個常數一致（常數只給 JS 的門檻算式用）。
 */
const ROOMY_GRID_COLS = 'grid-cols-[minmax(0,250px)_minmax(164px,1fr)_minmax(0,250px)]'
const NARROW_GRID_COLS = 'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'
/**
 * 立繪方框：跟著中欄軌走，由 `max-w` 封頂，`aspect-square` 保證高度不靠圖片決定。
 *
 * 340 的理由：再大就變成「一張機甲圖，旁邊附了幾個槽」——而這張圖要回答的是
 * 「哪一格裝了什麼」，機甲長相有詳情頁。
 * 觸控版收到 240：那裡的格高與字級都已經為手指放大過，圖不必再搶版面。
 */
const MECH_BOX = 'w-full max-w-[340px] aspect-square'
const MECH_BOX_COMPACT = 'w-full max-w-[240px] aspect-square'

/**
 * 側欄**確定吃滿 `SLOT_MAX_WIDTH`** 的容器寬 ＝ 250×2 ＋ 164 ＋ 內距 26 ＋ 兩道 gap 48。
 *
 * 到了這個寬度才把格子放大（`SlotCell` 的 `roomy`：格高、圖示、元件縮圖全部升一階）。
 * ⚠ 判準是**欄位真的變寬了沒有**，不是容器寬本身：低於這個值時欄寬還在跟中欄搶，
 *   那時放大格子只會把武器名擠掉 —— 元件那排四枚 32px 縮圖尤其吃寬度。
 */
const ROOMY_CELL_MIN_WIDTH = SLOT_MAX_WIDTH * 2 + MECH_MIN_WIDTH + 26 + 48

export function LoadoutRig({
  ctx, activeSlot, preview, flash, available, compact, onOpenSlot, onClearSlot, onOpenComponents,
  onUpgrade, onOpenModule, activeModule, onApplyChassis,
}: Props) {
  const flashSet = useMemo(() => new Set(flash), [flash])
  const [tight, setTight] = useState(false)
  // ⚠ 存**布林**不是原始寬度：存寬度會讓拖曳視窗的每一幀都 setState 重繪整張圖。
  //   立繪的實際尺寸不進 state —— 它由 CSS（`w-full max-w-… aspect-square`）算，
  //   所以連續縮放也不會有任何一次多餘的 render。
  const [roomyCells, setRoomyCells] = useState(false)

  const hasShoulder = ctx.capacity.shoulder > 0

  /**
   * 左右兩欄各自的槽位座標，由上而下：肩 → 手 → 備用手。
   *
   * ⚠ **一律走 `rigColumnRefs()`（PLAN-052-L B-1），不在這裡自己排一次**：
   *   匯出長圖的十字用的是同一支，而「畫面左欄＝機體右側」這條翻面裁決各寫一份的
   *   漂移症狀是「同一台機體在畫面上與圖上左右相反」—— 兩邊都不會報錯。
   *
   * ⚠ 雙手武器**不另闢一列**，而是同時出現在左右兩格（比照遊戲整備畫面：
   *   「右手」「左手」兩張卡印的是同一把）。這靠的是 `slotOccupant()` ——
   *   它用 `mountCoverage()` 查詢，一筆 dualHand mount 從左右任一手都查得到。
   *   格內的「· 雙手」標記負責說明那是一把佔兩格，不是兩把（見 SlotCell）。
   *
   *   先前的做法是偵測到 dualHand 就把兩格收掉、改渲染一整列「雙手」——
   *   那讓版面在裝上／卸下雙手武器時整個重排（兩欄少一列、中間多一列），
   *   而且與遊戲畫面對不起來。
   */
  // ⚠ **變數名指的是畫面欄位，不是機體側**：畫面左欄裝的是機體右側的槽位（見檔頭）。
  //   引線的幾何（`measure()`）與機甲落點的鏡射也一律吃畫面側，兩者因此自動對齊。
  const left = useMemo(() => rigColumnRefs(ctx.capacity, 'right'), [ctx.capacity])
  const right = useMemo(() => rigColumnRefs(ctx.capacity, 'left'), [ctx.capacity])

  const renderCell = (ref: WeaponSlotRef) => {
    const key = slotKey(ref)
    const occ: SlotOccupant = slotOccupant(ctx, ref)
    // 這一格結構上有沒有東西可裝？
    //   手部：要一併看雙手武器（它們共用這兩格）
    //   背部：要一併看**背包** —— 22 把背部武器全是戰術類且限中甲，
    //           只問武器會把背槽畫成無槽，而 181 個背包全都裝在那一格
    const isHand = ref.slot === WeaponEquipSlot.SINGLE_HAND
    const hasAny = slotHasCandidates(ctx, ref)
      || (isHand && slotHasCandidates(ctx, { bank: ref.bank, slot: WeaponEquipSlot.DUAL_HAND }))
      || (ref.slot === WeaponEquipSlot.BACK && backpackHasCandidates(ctx))
    const previewHere = preview && preview.slot === key ? preview.content : null

    if (occ.kind === 'empty' && !hasAny && !previewHere) {
      return (
        <SlotCell
          label={slotLabel(ref)}
          occupant={null}
          absentReason={emptyReason(ctx, ref)}
          compact={compact}
          dense={dense}
          roomy={roomyCells}
        />
      )
    }
    return (
      <SlotCell
        label={slotLabel(ref)}
        occupant={occ}
        preview={previewHere}
        seg={slotSegKey(ref.slot)}
        slotIcon={slotIconName(ref.slot, ref.side)}
        available={occ.kind === 'empty' ? available : undefined}
        active={activeSlot === key}
        // 級聯閃橙的 flash 集合裝的是**異動當下那個座標**的標籤，而雙手武器的座標是
        // 「雙手」不是「左手」—— 只比對 slotLabel(ref) 的話，裝上／卸下雙手武器時兩格都不會閃。
        flash={flashSet.has(slotLabel(ref)) || (
          occ.kind === 'weapon' && flashSet.has(slotLabel({ bank: occ.mount.bank, slot: occ.mount.slot, side: occ.mount.side }))
        )}
        compact={compact}
        dense={dense}
        tight={tight}
        roomy={roomyCells}
        onOpen={() => onOpenSlot(ref)}
        onClear={occ.kind === 'weapon' || occ.kind === 'backpack' ? () => onClearSlot(ref) : undefined}
        // 升級列：`planWeaponUpgrade()` 自己會對「沒武器／沒進階版／焊死的武裝」回 null，
        // 所以這裡不必先判斷 `occ.kind` —— 那會是同一條規則的第二份
        upgrade={onUpgrade ? planWeaponUpgrade(ctx, ref) : null}
        onUpgrade={onUpgrade && (() => {
          const plan = planWeaponUpgrade(ctx, ref)
          if (plan && !plan.rejection) onUpgrade(plan.ref, plan.to.id)
        })}
        {...componentBadge(ctx, occ, ref, onOpenComponents)}
      />
    )
  }

  // ── 引線幾何：量真實 DOM，不寫死座標（見檔頭） ──
  const rigRef = useRef<HTMLDivElement>(null)
  const mechRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef(new Map<string, HTMLElement>())
  const [lines, setLines] = useState<RigLines | null>(null)
  // 節點放不放得下「名稱 ＋ 右側重量」由容器實際寬度決定，不由視窗斷點猜 ——
  // 這一欄的寬度在 Phase C／D 還會再變一次
  const [dense, setDense] = useState(false)

  // 節點集合換人（換機甲、裝上背包解鎖備用槽）時要重量一次
  const layoutKey = [...left, ...right].map(slotKey).join('|')

  useEffect(() => {
    const rig = rigRef.current
    if (!rig) return

    const measure = () => {
      const mech = mechRef.current
      const box = rig.getBoundingClientRect()
      setDense(box.width < DENSE_MAX_WIDTH)
      setTight(box.width < TIGHT_MAX_WIDTH)
      setRoomyCells(box.width >= ROOMY_CELL_MIN_WIDTH)
      if (!mech || box.width < LINE_MIN_WIDTH) { setLines(null); return }
      const m = mech.getBoundingClientRect()
      const anchor = (a: [number, number], side: 'left' | 'right'): [number, number] => {
        const fx = side === 'left' ? a[0] : 1 - a[0]
        return [m.left - box.left + m.width * fx, m.top - box.top + m.height * a[1]]
      }

      const out: RigLine[] = []
      for (const [side, refs] of [['left', left], ['right', right]] as const) {
        for (const ref of refs) {
          const el = nodeRefs.current.get(slotKey(ref))
          if (!el) continue
          const r = el.getBoundingClientRect()
          const y = r.top - box.top + r.height / 2
          const x = side === 'left' ? r.right - box.left : r.left - box.left
          const dir = side === 'left' ? 1 : -1
          const kind = ref.bank === 'backup' ? 'backup'
            : ref.slot === WeaponEquipSlot.SHOULDER ? 'shoulder' : 'hand'
          const [ax, ay] = anchor(ANCHOR[kind], side)
          // 落點若已經在節點內側（極窄容器）就不畫這一條 ——
          // 畫出來會是一段穿過卡片的線，比沒有線更糟
          if (dir === 1 ? ax <= x + LEAD : ax >= x - LEAD) continue
          out.push({
            key: slotKey(ref),
            d: `M${round(x)} ${round(y)}h${dir * LEAD}L${round(ax)} ${round(ay)}`,
            ax: round(ax),
            ay: round(ay),
          })
        }
      }
      setLines((prev) => {
        const next: RigLines = { w: round(box.width), h: round(box.height), items: out }
        return prev && sameLines(prev, next) ? prev : next
      })
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(rig)
    if (mechRef.current) ro.observe(mechRef.current)
    return () => ro.disconnect()
    // layoutKey 進依賴：節點集合換人時要重量（ResizeObserver 不會為此觸發）
  }, [left, right, layoutKey, compact])


  const bindNode = useCallback((key: string) => (el: HTMLDivElement | null) => {
    if (el) nodeRefs.current.set(key, el)
    else nodeRefs.current.delete(key)
  }, [])

  const backRef: WeaponSlotRef = { bank: 'main', slot: WeaponEquipSlot.BACK }

  /**
   * 四部位資料到齊了嗎。
   *
   * ⚠ 包住卡片的**容器**也要看這一條，不能只靠 `MechPartCard` 自己回 null：
   *   卡片回 null 之後那些 `<div>` 仍然在，而它們是 `flex flex-col gap-2` 的子元素 ——
   *   一個零高度的子元素照樣吃掉兩道 gap，於是機甲圖上下各多出一段沒來由的空白。
   */
  const hasParts = !!ctx.mech && !!ctx.chassis

  /** 一張部位卡（模組接口）。 */
  const partCard = (position: MechPartPosition) => (
    <MechPartCard
      ctx={ctx}
      position={position}
      onOpenModule={onOpenModule}
      activePosition={activeModule}
      roomy={roomyCells}
    />
  )

  /**
   * 一欄的內容：武器格由上而下（肩 → 手 → 備用手），**臂卡插在肩與手之間**
   * （使用者裁決 2026-08-28）。
   *
   * ⚠ 初版把臂卡接在整欄的最下面。那讀起來是「武器歸武器、模組收在下面」——
   *   又退回成兩個分開的清單，只是換了個位置擺。插在肩與手中間才是真的**歸位**：
   *   由上而下的順序就是機體由上而下的解剖順序（肩 → 臂 → 手），
   *   而「手上這把武器」與「這條手臂的模組」從此貼在一起。
   * ⚠ 無肩槽（輕型機）時插點是 index 0 ＝ 這一欄的最上面。那時整張圖最上方另有一條
   *   「肩部槽位只有中甲機甲才有」的整列，所以相對順序仍然是 肩區 → 臂 → 手。
   */
  const renderColumn = (refs: WeaponSlotRef[], arm: MechPartPosition) => {
    const cells: React.ReactNode[] = refs.map((ref) => (
      <div key={slotKey(ref)} ref={bindNode(slotKey(ref))}>{renderCell(ref)}</div>
    ))
    if (!dense && hasParts) {
      cells.splice(hasShoulder ? 1 : 0, 0, <div key={`arm-${arm}`}>{partCard(arm)}</div>)
    }
    return cells
  }

  /**
   * 十字的上下兩端（軀幹／腿部）：**置中且只佔半寬**。
   *
   * ⚠ 不要拉成整寬（使用者回饋 2026-08-27，該裁決隨卡片一起搬過來）：整寬時卡片內容
   *   全靠左、右半邊一片空，看起來像沒排完 —— 而「十字」的形狀也因此讀不出來
   *   （整寬的兩條只是兩條橫線）。半寬對齊的是雙臂那兩張卡的外緣。
   */
  const halfRow = (node: React.ReactNode) => (
    <div className="flex justify-center">
      <div className="w-[calc(50%-0.25rem)]">{node}</div>
    </div>
  )

  const partRow = (position: MechPartPosition) => hasParts && halfRow(partCard(position))

  return (
    <div className="space-y-3">
      <div
        ref={rigRef}
        className="hud-cut relative border border-border-subtle bg-bg-card/40 p-3"
      >
        {/* 掃描格線。純裝飾，壓在最底層 */}
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.022)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.022)_1px,transparent_1px)] bg-[length:34px_34px]"
        />

        {/* 引線。絕對定位覆蓋層，viewBox 直接等於容器像素尺寸（見檔頭） */}
        {lines && (
          <svg
            aria-hidden
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${lines.w} ${lines.h}`}
          >
            <g stroke="var(--color-border-accent)" strokeWidth={1} fill="none">
              {lines.items.map((l) => <path key={l.key} d={l.d} />)}
            </g>
            <g fill="var(--color-accent-orange)">
              {lines.items.map((l) => <circle key={l.key} cx={l.ax} cy={l.ay} r={2.4} />)}
            </g>
          </svg>
        )}

        <div className="relative flex flex-col gap-2">
          {/* ── 整列不存在：無肩槽 ── */}
          {!hasShoulder && (
            <SlotCell
              label="肩部"
              occupant={null}
              // 實測 90/90 無例外：25 把肩部武器 100% 限中甲，
              // 有肩部固定武裝的三台宿主也全是中甲
              absentReason="肩部槽位只有中甲機甲才有"
              compact={compact}
              dense={dense}
              tight={tight}
              roomy={roomyCells}
            />
          )}

          {/* ── 十字的上端：軀幹 ── */}
          {partRow(MechPartPosition.TORSO)}

          {/* ── 主體：左欄 ／ 機甲 ／ 右欄 ──
              （雙手武器不在這裡另闢一列，見 columnRefs 的註解） ── */}
          {/* ⚠ `gap-x-6` 不是留白品味問題：引線的**可見長度就是這道縫**
              （落點在機甲圖框內，縫以內的線段會被機甲蓋住）。縮回 gap-2 等於沒有引線。 */}
          {/* ⚠ 兩種軌道設定：窄容器（`dense`／`tight`）維持舊的 `1fr auto 1fr` ——
              那裡沒有餘裕可以分配，封頂只會把中欄壓垮。寬容器改成「側欄封頂、
              中欄吃下全部餘裕」，見 `SLOT_MAX_WIDTH` 的註解。 */}
          <div className={`grid gap-y-2 items-center ${
            tight ? 'gap-x-2' : 'gap-x-6'
          } ${
            dense || tight ? NARROW_GRID_COLS : ROOMY_GRID_COLS
          }`}>
            {/* ⚠ tight 時兩欄改 `self-start`：格內名稱折行後左右兩欄高度不同，
                `items-center` 會把矮的那一欄往下推，於是「左肩／右肩」不在同一條線上。
                只在 tight 覆寫、不動桌機版 —— 那裡兩欄等高，置中才讓機甲對齊兩欄的正中。 */}
            {/* 畫面左欄＝機體右側，所以這一欄插的是**右臂**（見檔頭那條左右裁決） */}
            <div className={`flex flex-col gap-2 min-w-0 ${tight ? 'self-start' : ''}`}>
              {renderColumn(left, MechPartPosition.RIGHT_ARM)}
            </div>

            <MechVisual ctx={ctx} ref={mechRef} compact={compact} dense={dense} tight={tight} />

            <div className={`flex flex-col gap-2 min-w-0 ${tight ? 'self-start' : ''}`}>
              {renderColumn(right, MechPartPosition.LEFT_ARM)}
            </div>
          </div>

          {/* ── 窄容器：雙臂退回整寬兩欄 ──
              ⚠ 這不是「兩套版面」，是同一個十字的**窄版**（代價是臂卡離開了肩與手
                之間那個插點）：`dense` 以下側欄只剩約
                120px（門檻的算式見 `DENSE_MAX_WIDTH`），而部位卡是兩行內容
                （部位名＋接口／模組縮圖＋名稱＋Lv），120px 會把模組名壓成一個字。
                退到整寬兩欄之後每張仍有約 200px —— 與歸位之前那個十字裡的寬度相同。
              ⚠ 判準用**量到的容器寬**（`dense`）而不是 Tailwind 斷點：這一欄的寬度
                同時受三欄版型與視窗寬影響，斷點答不出「這一欄現在多寬」。 */}
          {dense && hasParts && (
            <div className="grid grid-cols-2 gap-2">
              {partCard(MechPartPosition.RIGHT_ARM)}
              {partCard(MechPartPosition.LEFT_ARM)}
            </div>
          )}

          {/* ── 十字的下端：腿部 ──
              ⚠ 排在背部**之上**（使用者裁決 2026-08-28，翻掉了初版的排法）。
                初版的論證是「背部與肩、手同屬武器格，不該被一張部位卡從中切開」——
                那個一致性輸給了**解剖順序**：十字的四端要圍著機體長，而腿接在軀幹下面、
                不在背包下面。背部反而是這一疊裡唯一「掛上去」的東西，擺在最後
                讀起來是收尾，不是被插隊。 */}
          {partRow(MechPartPosition.LEGS)}

          {/* ── 背部（背包與背部武器共用這一格，互斥）──
              ⚠ **與腿部同寬**（使用者回饋 2026-08-30）：這一格是十字的下端，
                拉成整寬時它比正上方那張半寬的腿部卡寬了一倍，右半邊只有一個重量數字，
                十字的下端因此看起來是散的。半寬之後上下兩端對齊同一組外緣。 */}
          {slotExists(ctx.capacity, backRef) && halfRow(renderCell(backRef))}
        </div>
      </div>

      {/* ⏸ 「備用組與主手取較重者」已於 PLAN-052-I D-3 移到右欄武器列的 footer ——
             那裡是唯一能同時看到主手組與備用組兩排武器的地方，規則寫在看得到證據的位置
             才有用。槽位圖回答的是「哪一格裝了什麼」，不兼任重量規則的說明欄。 */}

      {/* 部位卡歸位後唯一剩下的整區級說明（見 `PART_MIX_NOTE`）。
          ⚠ 沒有機甲時不出聲：那時整張圖是空的，一句關於「部件混搭」的說明
            會是畫面上唯一的一行字。 */}
      {hasParts && (
        <div className="flex items-center justify-end flex-wrap" style={{ gap: 8 }}>
          <ApplyChassisAction ctx={ctx} onApply={onApplyChassis} />
          <p className="text-[11px] text-text-dim leading-tight text-right">{PART_MIX_NOTE}</p>
        </div>
      )}
    </div>
  )
}

/**
 * 「其餘部位也套用軀幹那台」（使用者要求 2026-08-29）。
 *
 * 換完軀幹之後想讓其餘三格跟著走是最常見的下一步，而逐格點要開四次面板、
 * 在四份 36 台的清單裡各找一次同一台。
 *
 * ⚠ **只在真的混搭時才出現**：沒得按的按鈕會讓人以為自己漏了什麼設定。
 * ⚠ 目標一律是**軀幹那台**（＝`identityMech`，也就是抬頭與立繪印的那台）——
 *   「跟畫面上那台一致」是這顆按鈕唯一講得清楚的語意。軀幹本來就是選定機甲時，
 *   它自然變成「整台還原為選定機甲」，同一顆按鈕、不必另外做一顆。
 *
 * ⚠ 用詞是**「選定機甲」**而不是「原廠」（使用者要求 2026-08-29）：
 *   「原廠」聽起來像在講這台機甲出廠時的樣子，而它實際指的是**上面那格選的那台**。
 */
function ApplyChassisAction({ ctx, onApply }: {
  ctx: LoadoutContext
  onApply?: (sourceMechId: string) => void
}) {
  const target = ctx.identityMech
  const chassis = ctx.chassis
  if (!onApply || !target || !chassis) return null
  // 有任何一格不是軀幹那台 ⇒ 這顆按鈕有事可做
  const mixed = MECH_PART_ORDER.some((pos) => chassis.parts[pos].sourceMechId !== target.id)
  if (!mixed) return null

  const isBase = target.id === ctx.mech?.id
  return (
    <button
      type="button"
      onClick={() => onApply(target.id)}
      className={`hud-cut-sm shrink-0 px-2 py-1 text-[11px] leading-tight border border-accent-orange/40
        text-accent-orange hover:bg-accent-orange/10 transition-colors`}
      title={isBase
        ? `四個部位全部還原成選定機甲 ${target.name} 的`
        : `四個部位全部換成 ${target.name} 的（目前只有軀幹來自它）`}
    >
      {isBase ? '其餘部位還原為選定機甲' : `其餘部位也套用 ${target.name}`}
    </button>
  )
}

/**
 * 中央機甲主視覺。
 *
 * ⚠ **畫的是 `ctx.identityMech`（軀幹的來源），不是基底機甲**（使用者要求 2026-08-29）：
 *   把帕斯卡的軀幹裝到彌造者上、立繪卻還是彌造者的話，這張圖與正上方那顆
 *   <b>◆帕斯卡</b> 當場打臉，而圖是這一區最先被看到的東西。
 *   未混搭時 `identityMech === mech`，行為與改寫前完全相同。
 *
 * ⚠ 用 `portrait.webp`（完整機體 3/4 特寫），**不拼四部位圖**（計畫書決策三）：
 *   `torso / leftArm / rightArm / legs` 是各自獨立的 3/4 渲染，視角、光源、比例都不一致，
 *   排成人形會很怪。素材庫日後補上站姿全身像時，直接換這裡的來源即可，版面結構不動。
 *
 * ⚠ 尺寸寫死在容器上（不是靠圖片自然寬度）：立繪是非同步載入的，
 *   讓圖決定高度會在它到位那一刻把左右兩欄的節點整個推位，引線也跟著跳。
 */
const MechVisual = ({
  ctx, ref, compact, dense, tight,
}: {
  ctx: LoadoutContext
  ref: React.Ref<HTMLDivElement>
  compact?: boolean
  dense?: boolean
  tight?: boolean
}) => {
  // ⚠ tight／dense 時是**寫死的方框**：那裡的中欄是 `auto` 軌，沒有可以撐開的餘裕，
  //   而在那個尺寸下「看得出裝了什麼」比「看得清機甲長相」重要（機甲長相有詳情頁）。
  //
  // ⚠ 寬容器改成 `w-full max-w-… aspect-square`：中欄軌已經吃下全部餘裕（見
  //   `SLOT_MAX_WIDTH`），這裡只要跟著軌走、再由 `max-w` 封頂即可。
  //   **必須維持正方形、而且尺寸就是圖的實際尺寸**：引線的落點是這個方框的
  //   比例座標（`ANCHOR`），方框一旦比圖寬，橘點就會飄到機體外面的空白上。
  //   `aspect-square` 讓高度由寬度算出來，所以立繪非同步載入也不會推位
  //   —— 那正是這裡當初寫死尺寸的原因，換法不同、保證相同。
  const size = tight ? 'w-[76px] h-[76px]'
    : dense ? (compact ? 'w-[96px] h-[96px]' : 'w-[120px] h-[120px]')
    : compact ? MECH_BOX_COMPACT
    : MECH_BOX
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div ref={ref} className={`relative ${size} flex items-center justify-center`}>
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,107,43,0.18),transparent_68%)]"
        />
        {(ctx.identityMech ?? ctx.mech) && (
          <FallbackImage
            // 立繪換人時要重新掛載，否則 FallbackImage 會沿用上一台已解析好的候選
            key={(ctx.identityMech ?? ctx.mech)!.id}
            candidates={imageCandidates((ctx.identityMech ?? ctx.mech)!.portrait)}
            alt={(ctx.identityMech ?? ctx.mech)!.name}
            loading="lazy"
            className="relative max-w-full max-h-full object-contain drop-shadow-[0_10px_22px_rgba(0,0,0,0.6)]"
            fallback={<span className="relative text-[10px] text-text-dim">尚無立繪</span>}
          />
        )}
      </div>
      {/* ⚠ tight 時整行不畫：`whitespace-nowrap` 的「Chassis 800」比 76px 的機甲圖還寬，
          它會把中間欄撐到 113px，而那 37px 正是左右兩欄放不下武器名的來源（實測）。
          機體重量在帳本列的圖例上已經寫過一次（「機體 800」），這裡是第二份。 */}
      {ctx.chassis && !tight && (
        <span className={`${HUD.label} text-text-dim whitespace-nowrap`}>
          Chassis {ctx.chassis.weight.toLocaleString()}
        </span>
      )}
    </div>
  )
}

/**
 * 「這一格明明存在，卻沒有任何東西裝得上」的說明。
 *
 * 這是玩家最容易當成 bug 的一種狀態 —— 官方的做法是給一個點得下去卻永遠空著的 `[+]`。
 */
function emptyReason(ctx: LoadoutContext, ref: WeaponSlotRef): string {
  if (ctx.form?.restrict.kind === 'weaponType') {
    return `${ctx.form.name}沒有可裝在${slotLabel(ref)}的武器`
  }
  return `目前沒有可裝在${slotLabel(ref)}的武器`
}
