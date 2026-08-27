import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModuleSlotRef, SlotKey, WeaponSlotRef } from '../../types/slots'
import { slotKey } from '../../types/slots'
import { WeaponEquipSlot } from '../../types/enums'
import type { MechPartPosition } from '../../types/enums'
import { slotLabel } from '../../utils/mechSlots'
import { imageCandidates } from '../../utils/assets'
import { FallbackImage } from '../common/FallbackImage'
import {
  backpackHasCandidates, slotExists, slotHasCandidates, slotOccupant,
  type LoadoutContext, type SlotOccupant,
} from '../../utils/loadoutRules'
import { SlotCell, type SlotCellPreview } from './SlotCell'
import { HUD, slotIconName, slotSegKey } from './loadoutTheme'
import { MechPartStrip } from './MechPartStrip'

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
// ⚠ 三種槽位刻意**不進左右兩欄**，而是自己佔一整列：
//     無肩槽    → 那是「整排不存在」，畫成左右兩個一樣的灰格只是把同一句話說兩遍
//     雙手武器  → 它同時佔住左右手，畫在其中一欄會讓對面憑空缺一格
//     背部      → 它不屬於左也不屬於右
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
  /** 開某個部位的模組面板（PLAN-052-G C-2）。未傳＝四部位卡維持唯讀 */
  onOpenModule?: (ref: ModuleSlotRef) => void
  /** 模組面板正對著的那個部位，畫成選中狀態 */
  activeModule?: MechPartPosition | null
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
 * 由 `(W − 內距 26 − 機甲 132 − 兩道 gap 56) / 2 ≥ 190` 反推。190px 是一格能同時放下
 * 圖示、武器名與右側重量的實測下限；再窄下去名稱欄會被壓成省略號。
 */
const DENSE_MAX_WIDTH = 570
/**
 * 這一格要不要 ⚙ 徽章，以及上面印幾個（PLAN-052-D）。
 *
 * ⚠ 判準是 **`componentLimit > 0`**，不是「這格有武器」：A／B 品質 39 把與 8 筆固定武裝
 *   實測 `componentLimit` 皆為 0，給它們一顆點開只會看到「不可裝元件」的徽章，
 *   等於在畫面上擺一個必然落空的入口。背包同理（沒有元件槽）。
 */
function componentBadge(
  occ: SlotOccupant,
  ref: WeaponSlotRef,
  onOpenComponents?: (ref: WeaponSlotRef) => void,
): { onComponents?: () => void; componentUsed?: number; componentLimit?: number } {
  if (!onOpenComponents) return {}
  const weapon = occ.kind === 'weapon' ? occ.weapon
    : occ.kind === 'fixed' ? occ.weapon
    : occ.kind === 'formLocked' ? occ.weapon
    : null
  if (!weapon || weapon.componentLimit <= 0) return {}
  const setup = occ.kind === 'weapon' ? occ.mount.setup : undefined
  return {
    onComponents: () => onOpenComponents(ref),
    componentUsed: (setup?.triggerComponentIds?.length ?? 0) + (setup?.effectComponentIds?.length ?? 0),
    componentLimit: weapon.componentLimit,
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

export function LoadoutRig({
  ctx, activeSlot, preview, flash, available, compact, onOpenSlot, onClearSlot, onOpenComponents,
  onOpenModule, activeModule,
}: Props) {
  const flashSet = useMemo(() => new Set(flash), [flash])
  const [tight, setTight] = useState(false)

  const hasShoulder = ctx.capacity.shoulder > 0
  const hasBackup = ctx.capacity.backupHand > 0

  /**
   * 左右兩欄各自的槽位座標，由上而下：肩 → 手 → 備用手。
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
  const columnRefs = useCallback((side: 'left' | 'right'): WeaponSlotRef[] => {
    const out: WeaponSlotRef[] = []
    if (hasShoulder) out.push({ bank: 'main', slot: WeaponEquipSlot.SHOULDER, side })
    out.push({ bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side })
    if (hasBackup) out.push({ bank: 'backup', slot: WeaponEquipSlot.SINGLE_HAND, side })
    return out
  }, [hasShoulder, hasBackup])

  const left = useMemo(() => columnRefs('left'), [columnRefs])
  const right = useMemo(() => columnRefs('right'), [columnRefs])

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
        onOpen={() => onOpenSlot(ref)}
        onClear={occ.kind === 'weapon' || occ.kind === 'backpack' ? () => onClearSlot(ref) : undefined}
        {...componentBadge(occ, ref, onOpenComponents)}
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
            />
          )}

          {/* ── 主體：左欄 ／ 機甲 ／ 右欄 ──
              （雙手武器不在這裡另闢一列，見 columnRefs 的註解） ── */}
          {/* ⚠ `gap-x-6` 不是留白品味問題：引線的**可見長度就是這道縫**
              （落點在機甲圖框內，縫以內的線段會被機甲蓋住）。縮回 gap-2 等於沒有引線。 */}
          <div className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-y-2 items-center ${
            tight ? 'gap-x-2' : 'gap-x-6'
          }`}>
            {/* ⚠ tight 時兩欄改 `self-start`：格內名稱折行後左右兩欄高度不同，
                `items-center` 會把矮的那一欄往下推，於是「左肩／右肩」不在同一條線上。
                只在 tight 覆寫、不動桌機版 —— 那裡兩欄等高，置中才讓機甲對齊兩欄的正中。 */}
            <div className={`flex flex-col gap-2 min-w-0 ${tight ? 'self-start' : ''}`}>
              {left.map((ref) => (
                <div key={slotKey(ref)} ref={bindNode(slotKey(ref))}>{renderCell(ref)}</div>
              ))}
            </div>

            <MechVisual ctx={ctx} ref={mechRef} compact={compact} dense={dense} tight={tight} />

            <div className={`flex flex-col gap-2 min-w-0 ${tight ? 'self-start' : ''}`}>
              {right.map((ref) => (
                <div key={slotKey(ref)} ref={bindNode(slotKey(ref))}>{renderCell(ref)}</div>
              ))}
            </div>
          </div>

          {/* ── 整列：背部（背包與背部武器共用這一格，互斥） ── */}
          {slotExists(ctx.capacity, backRef) && renderCell(backRef)}
        </div>
      </div>

      {/* ⏸ 「備用組與主手取較重者」已於 PLAN-052-I D-3 移到右欄武器列的 footer ——
             那裡是唯一能同時看到主手組與備用組兩排武器的地方，規則寫在看得到證據的位置
             才有用。槽位圖回答的是「哪一格裝了什麼」，不兼任重量規則的說明欄。 */}

      <MechPartStrip ctx={ctx} onOpenModule={onOpenModule} activePosition={activeModule} />
    </div>
  )
}

/**
 * 中央機甲主視覺。
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
  // ⚠ tight 時再縮一階：這張圖與左右兩欄搶的是同一份寬度，而在這個尺寸下
  //   「看得出裝了什麼」比「看得清機甲長相」重要（機甲長相有詳情頁）。
  const size = tight ? 'w-[76px] h-[76px]'
    : compact ? 'w-[96px] h-[96px]'
    : dense ? 'w-[120px] h-[120px]'
    : 'w-[164px] h-[164px]'
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div ref={ref} className={`relative ${size} flex items-center justify-center`}>
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,107,43,0.18),transparent_68%)]"
        />
        {ctx.mech && (
          <FallbackImage
            candidates={imageCandidates(ctx.mech.portrait)}
            alt={ctx.mech.name}
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
