// 位置化槽位的幾何（PLAN-052-L B-1）
//
// 「哪一列、哪一欄、哪個部位」——**只有這一份**。螢幕版的 `<LoadoutRig>` 與匯出長圖
// 各自渲染（兩者的字級階、互動語彙、可用寬度都不同），但兩邊擺東西的空間語彙同源。
//
// ⚠ **絕不可把 `<LoadoutRig>` 元件本身塞進匯出卡**（計畫書決策一）。它一次帶進三個
//   靜默失效點：① SVG 的 `var()` 在 html-to-image 裡解析不到（它對 `<svg>` 直接深拷貝、
//   子元素不經 `cloneCSSStyle()`）；② `ResizeObserver` 與「掛載即開拍」的競態；
//   ③ `loading="lazy"` 的圖在 `left:-10000px` 的離屏宿主裡永遠等不到。
//   外加一堆點不動的假入口（✕ 卸下鍵、`›` chevron、「可用 1,870」）。
//
// ── 這裡承載的五條空間裁決（逐條沿用 `LoadoutRig` 既有的）────────────────────
//
//   ① **畫面左欄＝機體右側**（使用者裁決 2026-08-27）：本圖是從正面看機體，
//      機體的右臂因此出現在畫面左邊，與遊戲整備畫面一致。
//      ⚠ 這條是本檔存在的**主要**理由：兩邊各寫一次的漂移症狀是「同一台機體在畫面上
//        與圖上左右相反」，而兩者都不會報錯。
//   ② **臂卡插在肩與手之間**：由上而下的順序就是機體由上而下的解剖順序
//      （肩 → 臂 → 手），「手上這把武器」與「這條手臂的模組」因此貼在一起。
//   ③ **雙手武器左右兩格都畫**（比照遊戲整備畫面「右手」「左手」印同一把），
//      但**重量只印一次**——見 `RigSlot.dual`。
//   ④ **背包放在背部那一列**：官方把背包夾在兩個備用槽中間；本設計不跟，
//      因為背包與背部武器共用同一格，擺在一起才看得出兩者互斥。
//   ⑤ **「整排不存在」只出一列**：沒有肩槽時畫成左右兩個一樣的灰格，
//      等於把同一句話說兩遍。
//
// 純函式、無 React 依賴，可單測（npm test）。

import { MechPartPosition, WeaponEquipSlot } from '../types/enums.ts'
import type { SlotCapacity, SlotSide, WeaponSlotRef } from '../types/slots.ts'
import { slotKey } from '../types/slots.ts'
import { slotLabel } from './mechSlots.ts'
import { slotExists, slotOccupant, type LoadoutContext, type SlotOccupant } from './loadoutRules.ts'

/**
 * 一格的狀態。**六種一個都不能少**（計畫書決策三）。
 *
 * ⚠ 位置化時最自然的做法是收成「已裝／空槽／無槽」三種——那會靜默丟掉
 *   `fixed`（機甲焊死的武裝）與 `formLocked`（形態鎖定）的黃字，
 *   而那是圖上**唯一**在說「這一格你換不了」的訊號。
 */
export type RigSlotState = 'weapon' | 'backpack' | 'fixed' | 'formLocked' | 'empty' | 'absent'

export interface RigSlot {
  key: string
  /**
   * 這一格的座標。**整排不存在時為 null**（那一列講的是一整排，沒有單一座標）。
   *
   * ⚠ 雙手武器的兩格各自帶**自己那一格**的 `singleHand` 座標，不是 `dualHand` ——
   *   同 `slotType` 的理由。要問「這一格上的武器掛了什麼元件」照傳即可：
   *   `weaponSiteAt()` 比對的是覆蓋範圍（`slotsOverlap`），三種來源一視同仁。
   *
   * 純文字摘要（PLAN-052-L E-1）靠它接上 `slotComponentNames()`。**不要讓呼叫端自己
   * 重建座標**：那等於把本檔存在的理由（左右翻面只寫一次）再抄一份出去。
   */
  ref: WeaponSlotRef | null
  /** 部位名。整排不存在時是「肩部」／「備用槽」這種群組名，不是「左肩」 */
  label: string
  /**
   * 這一格屬於哪一類槽（`WeaponEquipSlot` 的值）。**整排不存在時也有值** ——
   * 渲染端拿它去查重量分段色（`slotSegKey()`），而一列灰掉的肩部仍然是肩部：
   * 顏色分段對不上會讓「這一列講的是哪裡」少掉一個線索。
   *
   * ⚠ 雙手武器記的是它**佔住的那一格**（`singleHand`）而不是 `dualHand`：
   *   分段色問的是「這個重量算在哪一段」，而雙手武器算在手部。
   */
  slotType: string
  state: RigSlotState
  /** 裝備名；空槽與無槽為 null。武器資料斷鏈時退回 doc id，讓斷鏈看得見 */
  name: string | null
  /**
   * 裝備圖示（武器／背包的 `icon`）。**沒有圖或空槽時為 null**。
   *
   * ⚠ 由本檔給而不是讓渲染端自己去 `world` 查一次（使用者回饋 2026-08-30：匯出圖漏了
   *   圖示）：這一格畫的是哪一件裝備，答案在 `slotAt()` 裡已經解過一次
   *   —— 固定武裝、形態鎖定、雙手武器的第二格各有各的來源，渲染端再解一次必然漏掉幾種。
   *   實測 182 把武器 100% 有 icon，缺圖是資料斷鏈而不是常態。
   */
  icon: string | null
  /** 這一格要多講的一句（無槽原因／不可更換的來源／背包解鎖了什麼／雙手佔兩格） */
  note: string | null
  /**
   * 印得出來的重量；**沒有數字可印**時為 null（無槽／空槽／資料斷鏈／雙手武器的第二格）。
   *
   * ⚠ `0` 與 `null` **不是同一件事**：純封鎖型固定武裝（嵐質儲能艙／多功能彈倉）
   *   的重量是真的 0，而不是「這一格沒有值」。兩者都印成「—」會讓玩家以為
   *   那兩把也算進總重了。渲染端一律**照印數字**、null 就整個不畫。
   */
  weight: number | null
  /**
   * 這一格畫的是一把**雙手武器**（同一把同時佔住左右兩格）。
   *
   * `'primary'` 印重量、`'echo'` 不印——同一把印兩次會讓讀者把 800 讀成 1600。
   * primary 一律落在**畫面左欄**（＝機體右側，見檔頭裁決①），於是重量恆在左邊那一格。
   */
  dual: 'primary' | 'echo' | null
}

/** 主列某一欄裡的一個節點：一格槽位，或一張部位卡（臂卡）。 */
export type RigNode =
  | { kind: 'slot'; key: string; slot: RigSlot }
  | { kind: 'part'; key: string; position: MechPartPosition }

/**
 * 由上而下的版面塊。
 *
 * `row`      橫跨一列的槽位格（背部／整排不存在的肩部）
 * `part`     置中半寬的部位卡（軀幹／腿部，＝十字的上下兩端）
 * `columns`  主列：左欄 ｜ 機體 ｜ 右欄
 */
export type RigBlock =
  /**
   * `half` ＝ 這一列與軀幹／腿部同寬並置中（使用者回饋 2026-08-30）。
   *
   * 背部就是這一種：它是十字的下端，拉成整寬時內容全靠左、右半邊一片空 ——
   * 與正上方那張半寬的腿部卡對不齊，十字的形狀因此讀不出來
   * （同 `ExportRig` 的 `HALF` 那條 2026-08-27 裁決，這裡是它的另一半）。
   * 「整排不存在」的肩部維持整寬：那一列講的是一整排、不是十字的一端。
   */
  | { kind: 'row'; key: string; slot: RigSlot; half?: boolean }
  | { kind: 'part'; key: string; position: MechPartPosition }
  | { kind: 'columns'; key: string; left: RigNode[]; right: RigNode[] }

/** 機體側 → 同側的手臂部位。臂卡插在該側的肩與手之間（裁決②）。 */
const ARM_OF: Record<SlotSide, MechPartPosition> = {
  left: MechPartPosition.LEFT_ARM,
  right: MechPartPosition.RIGHT_ARM,
}

/**
 * 一欄由上而下的槽位座標：肩 → 手 → 備用手。
 *
 * ⚠ 參數 `side` 是**機體側**，不是畫面側。呼叫端要自己翻面
 *   （畫面左欄 ＝ `rigColumnRefs(cap, 'right')`，見裁決①）。
 *
 * ⚠ 雙手武器**不另闢一列**，而是同時出現在左右兩格——這靠的是 `slotOccupant()`：
 *   它用 `mountCoverage()` 查詢，一筆 dualHand mount 從左右任一手都查得到。
 *   先前偵測到 dualHand 就把兩格收掉、改渲染一整列的做法，會讓版面在裝上／卸下時
 *   整個重排，而且與遊戲畫面對不起來。
 */
export function rigColumnRefs(capacity: SlotCapacity, side: SlotSide): WeaponSlotRef[] {
  const out: WeaponSlotRef[] = []
  if (capacity.shoulder > 0) out.push({ bank: 'main', slot: WeaponEquipSlot.SHOULDER, side })
  out.push({ bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side })
  if (capacity.backupHand > 0) out.push({ bank: 'backup', slot: WeaponEquipSlot.SINGLE_HAND, side })
  return out
}

/** 這位佔用者實際佔的是哪一類槽（雙手武器的判定就靠它）。空槽與背包回 null。 */
function occupantSlotType(occ: SlotOccupant): string | null {
  switch (occ.kind) {
    case 'weapon': return occ.mount.slot
    case 'fixed': return occ.occupied.mount.slot
    case 'formLocked': return occ.ref.slot
    default: return null
  }
}

function absentSlot(key: string, label: string, slotType: string, note: string): RigSlot {
  return { key, ref: null, label, slotType, state: 'absent', name: null, icon: null, note, weight: null, dual: null }
}

/**
 * 一格的內容。`side` 是機體側，用來判斷雙手武器的重量該落在哪一格（見 `RigSlot.dual`）。
 */
function slotAt(ctx: LoadoutContext, ref: WeaponSlotRef): RigSlot {
  const occ = slotOccupant(ctx, ref)
  const key = slotKey(ref)
  const label = slotLabel(ref)
  const slotType = ref.slot
  // 雙手武器：primary 落在機體右側（＝畫面左欄），echo 落在另一邊
  const isDual = occupantSlotType(occ) === WeaponEquipSlot.DUAL_HAND
  const dual: RigSlot['dual'] = isDual ? (ref.side === 'right' ? 'primary' : 'echo') : null
  const dualNote = dual === 'primary' ? '雙手武器，佔左右兩格' : '與另一手同一把，重量計一次'

  switch (occ.kind) {
    case 'weapon':
      return {
        key, ref, label, slotType, state: 'weapon',
        name: occ.weapon?.name ?? occ.mount.weaponId,
        icon: occ.weapon?.icon ?? null,
        note: dual ? dualNote : null,
        // echo 那一格不印重量；查無武器（斷鏈）也沒有數字可印
        weight: dual === 'echo' ? null : occ.weapon?.weight ?? null,
        dual,
      }
    case 'fixed':
      return {
        key, ref, label, slotType, state: 'fixed',
        name: occ.weapon?.name ?? occ.occupied.mount.weaponId,
        icon: occ.weapon?.icon ?? null,
        note: dual ? `機甲固定武裝・${dualNote}` : '機甲固定武裝',
        // ⚠ 固定武裝的 weight 常態是 0（純封鎖型），那是真的 0 不是「沒有值」
        weight: dual === 'echo' ? null : occ.weapon?.weight ?? null,
        dual,
      }
    case 'formLocked': {
      const lockName = `${ctx.form?.name ?? '形態'}鎖定`
      return {
        key, ref, label, slotType, state: 'formLocked',
        name: occ.weapon?.name ?? occ.weaponId,
        icon: occ.weapon?.icon ?? null,
        note: dual ? `${lockName}・${dualNote}` : lockName,
        weight: dual === 'echo' ? null : occ.weapon?.weight ?? null,
        dual,
      }
    }
    case 'backpack':
      return {
        key, ref, label, slotType, state: 'backpack',
        name: occ.backpack.name,
        icon: occ.backpack.icon ?? null,
        // 強襲者背包解鎖備用槽——那一列因此從「整排不存在」變成兩格，值得說一句
        note: ctx.capacity.backupHand > 0 ? '解鎖備用武器槽' : null,
        weight: occ.backpack.weight,
        dual: null,
      }
    default:
      return { key, ref, label, slotType, state: 'empty', name: null, icon: null, note: null, weight: null, dual: null }
  }
}

/** 一欄的節點：槽位由上而下，臂卡插在肩與手之間（無肩槽時插點就是最上面）。 */
function columnNodes(ctx: LoadoutContext, side: SlotSide, withParts: boolean): RigNode[] {
  const refs = rigColumnRefs(ctx.capacity, side)
  const nodes: RigNode[] = refs.map((ref) => ({ kind: 'slot', key: slotKey(ref), slot: slotAt(ctx, ref) }))
  if (withParts) {
    const at = ctx.capacity.shoulder > 0 ? 1 : 0
    nodes.splice(at, 0, { kind: 'part', key: `part:${ARM_OF[side]}`, position: ARM_OF[side] })
  }
  return nodes
}

/**
 * 整張十字，由上而下。
 *
 * 順序：〔無肩槽〕→ 軀幹 → 主列（左欄｜機體｜右欄）→ 腿部 → 背部。
 *
 * ⚠ 腿部排在背部**之上**（使用者裁決 2026-08-28）：十字的四端要圍著機體長，
 *   而腿接在軀幹下面、不在背包下面。背部是這一疊裡唯一「掛上去」的東西，
 *   擺在最後讀起來是收尾，不是被插隊。
 *
 * ⚠ 四部位卡在 `chassis` 未解析（四部位任一缺席）時**整批不出**，而不是補零值部位。
 *   實測 90/90 齊全，今天走不到這一條。
 */
export function rigLayout(ctx: LoadoutContext): RigBlock[] {
  const cap = ctx.capacity
  const hasParts = !!ctx.mech && !!ctx.chassis
  const out: RigBlock[] = []

  // ── 整排不存在：肩部（輕型／重型機甲）──
  //    實測 90/90 無例外：25 把肩部武器 100% 限中甲，有肩部固定武裝的三台宿主也全是中甲
  if (cap.shoulder <= 0) {
    out.push({ kind: 'row', key: 'absent:shoulder', slot: absentSlot('absent:shoulder', '肩部', WeaponEquipSlot.SHOULDER, '肩部槽位只有中甲機甲才有') })
  }

  if (hasParts) out.push({ kind: 'part', key: 'part:torso', position: MechPartPosition.TORSO })

  out.push({
    kind: 'columns',
    key: 'columns',
    // ⚠ 翻面就在這兩行（裁決①）：畫面左欄放的是機體**右**側
    left: columnNodes(ctx, 'right', hasParts),
    right: columnNodes(ctx, 'left', hasParts),
  })

  if (hasParts) out.push({ kind: 'part', key: 'part:legs', position: MechPartPosition.LEGS })

  // ── 背部（背包與背部武器共用這一格，互斥）──
  const backRef: WeaponSlotRef = { bank: 'main', slot: WeaponEquipSlot.BACK }
  out.push(slotExists(cap, backRef)
    ? { kind: 'row', key: slotKey(backRef), slot: slotAt(ctx, backRef), half: true }
    : { kind: 'row', key: 'absent:back', slot: absentSlot('absent:back', '背部', WeaponEquipSlot.BACK, '此機甲沒有背部槽'), half: true })

  // ⏸ 備用組**沒有這一列**（使用者裁決 2026-08-30）。
  //    這裡原本在沒解鎖時補一列「未裝強襲者背包 → 沒有備用武器槽」。但全庫 181 個背包
  //    只有 1 個（強襲者）解得開它 ⇒ 那一列在幾乎每一張圖上都會出現，去解釋一個
  //    **這張配裝裡根本不存在**的東西；看圖的人得先讀懂一個與這套配裝無關的機制，
  //    才能確認自己沒漏看什麼。解鎖時備用格本來就在兩欄裡（`rigColumnRefs`），
  //    看得見就不需要解釋，看不見的也不需要。
  //    （檔頭裁決⑤「整排不存在只出一列」仍適用於肩部——那是機甲本身的差異，
  //     不是某一件背包的效果。）

  return out
}

/**
 * 攤平出所有槽位格（含整寬列與兩欄裡的），供「N 個槽位 · 已裝 M」這類計數用。
 *
 * ⚠ 放在這裡而不是讓渲染端自己走一次 blocks：計數與版面必須是同一份資料算出來的，
 *   否則「圖上畫了 6 格、抬頭寫 5 個槽位」這種錯只有逐張圖數格子才看得出來。
 */
export function rigSlots(blocks: RigBlock[]): RigSlot[] {
  const out: RigSlot[] = []
  for (const b of blocks) {
    if (b.kind === 'row') out.push(b.slot)
    else if (b.kind === 'columns') {
      for (const n of [...b.left, ...b.right]) if (n.kind === 'slot') out.push(n.slot)
    }
  }
  return out
}
