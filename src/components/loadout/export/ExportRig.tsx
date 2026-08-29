import type { CSSProperties } from 'react'
import type { MechPartPosition } from '../../../types/enums'
import { imageCandidates } from '../../../utils/assets'
import { partLabel } from '../../../utils/moduleSlots'
import { interfaceState, moduleFamilyKey } from '../../../utils/moduleRules'
import type { LoadoutContext } from '../../../utils/loadoutRules'
import type { RigBlock, RigNode, RigSlot } from '../../../utils/rigLayout'
import { slotSegKey } from '../loadoutTheme'
import { FallbackImage } from '../../common/FallbackImage'
import { C, MONO, SEG_HEX, RIG_PAD, CARD_WIDTH } from './exportTheme'

// ─── 匯出圖的位置化槽位（PLAN-052-L B-2）────────────────────────────────────
//
// 團隊逐字：「遊戲中是有相對位置的，條列有點不好對」。改寫前這裡是一張
// 「部位／武器／類型／重量」的四欄條列表 —— 資訊全在，但玩家要在腦內把它排回機體上。
//
// 幾何（哪一列、哪一欄、哪個部位）一律問 `rigLayout()`，本檔只負責畫。
//
// ⚠ **絕不可改成塞一顆 `<LoadoutRig>` 進來**（計畫書決策一）：SVG 的 `var()` 在
//   html-to-image 裡解析不到、`ResizeObserver` 與「掛載即開拍」有競態、
//   `loading="lazy"` 的圖在離屏宿主裡永遠等不到 —— 三個都不會報錯。
//
// ⚠ **不畫引線**（計畫書決策二）：① SVG 顏色在匯出時解析不到 `var()`；
//   ② 中央的 `portrait.webp` 實測只有 560×340，塞進方框後上下留白，而 `ANCHOR`
//   的備用槽落點（`.84`）會掉在機體外的空白上。左右由**欄位置本身**表達，
//   底下一行說明「畫面左欄是機體右側」。
//
// ⚠ **六種槽位狀態一個都不能少**（計畫書決策三）。收成「已裝／空槽／無槽」三種
//   會靜默丟掉 `fixed`（機甲焊死）與 `formLocked`（形態鎖定）的黃字，
//   而那是圖上唯一在說「這一格你換不了」的訊號。
//
// ⚠ **所有數字都是 px 字面值**：本站 root 字級使用者可調（17／19／21px），
//   用 `rem` 或 Tailwind 類別會讓同一套配裝在不同人手上匯出成不同尺寸的圖。

/** 可用寬 ＝ 卡片寬 − 左右內距。 */
const CONTENT = CARD_WIDTH - RIG_PAD * 2   // 960
/** 主列三欄：300 ｜ 300 ｜ 300，兩道 gap 30 ⇒ 960。 */
const COL = 300
const GAP = 30
/**
 * 軀幹／腿部那兩張卡的寬度 ＝ **整寬的一半，置中**。
 *
 * ⚠ 不要拉成整寬（使用者回饋 2026-08-27，隨卡片一起搬過來的裁決）：整寬時卡片內容
 *   全靠左、右半邊一片空，看起來像沒排完 —— 而「十字」的形狀也因此讀不出來
 *   （整寬的兩條只是兩條橫線）。
 */
const HALF = CONTENT / 2
/** 一列與一列之間。與欄內節點的間距同值，十字才有一致的節奏。 */
const ROW_GAP = 10

const IFACE_NONE = '無模組接口'
const IFACE_UNKNOWN = '接口型別不明'

/**
 * 三種框：已裝＝實線＋深底、空槽＝橘色虛線、無槽＝灰虛線＋斜紋底。
 *
 * ⚠ 斜紋是**質地**不是顏色（同 A-6 超重那一段的理由）：它疊在任何底色上都還讀得出
 *   「這一格不是留白，是不存在」，而一個純灰的空框會被讀成「這張圖漏了」。
 *
 * 左框線用**重量分段色**（手部青／肩部紫／背部藍），與上方出力帶的圖例同一組色 ——
 * 「這一格的重量算在哪一段」因此不必再讀一次字。
 */
function cellFrame(slot: RigSlot): CSSProperties {
  if (slot.state === 'absent') {
    return {
      border: `1px dashed ${C.line}`,
      borderLeft: `3px solid ${C.line}`,
      background: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.03) 0 6px, transparent 6px 12px)',
    }
  }
  if (slot.state === 'empty') {
    return {
      border: '1px dashed rgba(255,107,43,0.45)',
      borderLeft: '3px solid rgba(255,107,43,0.45)',
      background: 'rgba(255,107,43,0.03)',
    }
  }
  return {
    border: `1px solid ${C.line}`,
    borderLeft: `3px solid ${SEG_HEX[slotSegKey(slot.slotType)]}`,
    background: C.panel,
  }
}

/**
 * 一格。`width` 省略 ＝ 吃滿容器（整寬列）。
 *
 * ⚠ `weight` 為 `null` 時整個不印，**不印「—」**：0 是「這件裝備真的不佔重量」
 *   （純封鎖型固定武裝就是），兩者都印成「—」會讓玩家以為那幾把也算進了總重。
 */
export function ExportSlotCell({ slot, width, grow }: { slot: RigSlot; width?: number; grow?: boolean }) {
  const locked = slot.state === 'fixed' || slot.state === 'formLocked'
  return (
    <div style={{
      width, flexGrow: grow ? 1 : undefined, boxSizing: 'border-box', padding: '9px 12px',
      display: 'flex', alignItems: 'center', gap: 10, ...cellFrame(slot),
    }}>
      {/* 裝備圖示（使用者回饋 2026-08-30：螢幕上每一格都有圖，匯出圖卻只有字）。
          ⚠ **只在有圖時才佔位**（同 `ExportPartCard` 的裁決）：空槽與無槽那幾格
            補一個空框，會被讀成「有一件我不認得的裝備」。
          ⚠ 尺寸與部位卡的 30px 同階：兩者在十字裡上下相鄰，差一階會看起來沒對齊。 */}
      {slot.icon && (
        <span style={{ width: 30, height: 30, flexShrink: 0 }}>
          <FallbackImage
            candidates={imageCandidates(slot.icon)}
            alt=""
            fallback={null}
            style={{ width: 30, height: 30, objectFit: 'contain', display: 'block' }}
          />
        </span>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flexGrow: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
          <span style={{ fontSize: 11, color: C.sub, letterSpacing: 1, flexShrink: 0 }}>{slot.label}</span>
          {/* 雙手武器：兩格都畫同一把，這個標記負責說明那是一把佔兩格、不是兩把 */}
          {slot.dual && (
            <span style={{
              fontSize: 10, color: C.dim, border: `1px solid ${C.line}`,
              padding: '0 5px', flexShrink: 0, lineHeight: 1.5,
            }}>雙手</span>
          )}
          {slot.weight !== null && (
            <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 13, color: C.text }}>
              {slot.weight.toLocaleString()}
            </span>
          )}
        </div>

        {slot.name ? (
          <span style={{
            fontSize: 14, fontWeight: 700, lineHeight: 1.35, wordBreak: 'break-word',
            // ⚠ 黃字是圖上唯一在說「這一格你換不了」的訊號（決策三）
            color: locked ? C.yellow : C.text,
          }}>{slot.name}</span>
        ) : (
          <span style={{ fontSize: 12, color: slot.state === 'empty' ? C.orange : C.dim, lineHeight: 1.45 }}>
            {slot.state === 'empty' ? '未裝備' : slot.note}
          </span>
        )}

        {slot.name && slot.note && (
          <span style={{ fontSize: 11, color: locked ? 'rgba(234,179,8,0.85)' : C.dim, lineHeight: 1.45 }}>
            {slot.note}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * 一張部位卡（模組接口）。畫的是**這一格裝了什麼**，效果全文由下方的模組帶負責 ——
 * 十字上塞得下的是名字與等級，塞不下 119 個字的官方敘述。
 *
 * ⚠ 左框線用**綠色**（與模組帶的抬頭同色）而不是重量分段色：部位卡與武器格會上下相鄰，
 *   而它們回答的是兩個不同的問題（這一格裝了什麼武器 ／ 這個部位裝了什麼模組）。
 * ⚠ 混搭來源 ◆ **非印不可**：換完部件之後這張卡長得和選定機甲一模一樣，
 *   而轉發到第三手的人手上只有這張圖。
 */
export function ExportPartCard({ ctx, position, width, grow }: {
  ctx: LoadoutContext
  position: MechPartPosition
  width?: number
  /** 撐滿容器（主列的 grid cell 用）——同一列的左右兩格因此等高 */
  grow?: boolean
}) {
  const chassis = ctx.chassis
  if (!chassis) return null

  const { part, sourceMechId } = chassis.parts[position]
  const iface = interfaceState(chassis.moduleSlots[position].iface)
  const usable = iface !== 'none' && iface !== 'unknown'
  const ifaceText = iface === 'none' ? IFACE_NONE : iface === 'unknown' ? IFACE_UNKNOWN : iface

  const modId = ctx.modules[position]
  const mod = modId ? ctx.world.modules.get(modId) ?? null : null
  const stack = mod ? ctx.stacks.get(moduleFamilyKey(mod)) ?? null : null
  const from = sourceMechId !== ctx.mech?.id
    ? ctx.world.mechs.get(sourceMechId)?.name ?? sourceMechId
    : null

  return (
    <div style={{
      width, flexGrow: grow ? 1 : undefined, boxSizing: 'border-box', padding: '9px 12px',
      display: 'flex', alignItems: 'center', gap: 10,
      border: `1px solid ${C.line}`, borderLeft: '3px solid rgba(34,197,94,0.55)',
      background: 'rgba(20,22,29,0.75)',
    }}>
      {/* 部件圖。缺圖留白**不畫框** —— 一個空框夾在三張正常卡中間會被讀成
          「有一個我不認得的部位」（A-1 的既有裁決，一併沿用到這裡） */}
      <span style={{ width: 30, height: 30, flexShrink: 0 }}>
        <FallbackImage
          candidates={imageCandidates(part.icon)}
          alt=""
          fallback={null}
          style={{ width: 30, height: 30, objectFit: 'contain', display: 'block' }}
        />
      </span>

      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexGrow: 1 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{partLabel(position)}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>{ifaceText}</span>
          {from && (
            <span style={{ fontSize: 11, color: C.orange, whiteSpace: 'nowrap' }}>◆{from}</span>
          )}
        </span>

        {/* 沒有接口（B 品質 10 台）時整行不畫：上一行的「無模組接口」已經把話說完了 */}
        {usable && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <span style={{ width: 22, height: 22, flexShrink: 0 }}>
              {mod?.icon && (
                <FallbackImage
                  candidates={imageCandidates(mod.icon)}
                  alt=""
                  fallback={null}
                  style={{ width: 22, height: 22, objectFit: 'contain', display: 'block' }}
                />
              )}
            </span>
            <span style={{ fontSize: 12, color: mod ? C.orange : C.dim, minWidth: 0, wordBreak: 'break-word' }}>
              {mod?.name ?? (modId ? '模組資料已不存在' : '未裝模組')}
            </span>
            {stack && (
              <span style={{
                marginLeft: 'auto', fontFamily: MONO, fontSize: 10, flexShrink: 0,
                color: stack.overflow > 0 ? C.yellow : C.dim,
              }}>Lv{stack.level}/{stack.cap}</span>
            )}
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * 十字中央的機體。
 *
 * ⚠ 用 `portrait.webp` 而不是 hero 那張 `art.webp`：hero 已經把原稿放到 530px 寬，
 *   同一張圖再出現一次只是把版面用掉。這裡要的是「這些格子長在誰身上」，
 *   3/4 特寫縮到 300px 反而銳利（原圖 560×340 ⇒ 是縮小）。
 * ⚠ 畫的是 `identityMech`（軀幹來源），與 hero 的抬頭同一個判準 ——
 *   兩邊各自決定「這是哪一台」的話，同一張圖會自己打自己的臉。
 */
function MechVisual({ ctx }: { ctx: LoadoutContext }) {
  const mech = ctx.identityMech ?? ctx.mech
  const candidates = imageCandidates(mech?.portrait)
  return (
    <div style={{
      position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 150,
    }}>
      <div aria-hidden style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(circle, rgba(255,107,43,0.16), transparent 68%)',
      }} />
      {candidates.length > 0 && (
        <FallbackImage
          candidates={candidates}
          alt=""
          fallback={null}
          style={{
            position: 'relative', maxWidth: COL, maxHeight: 236, objectFit: 'contain',
            filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.65))',
          }}
        />
      )}
    </div>
  )
}

function ColumnNode({ ctx, node }: { ctx: LoadoutContext; node: RigNode }) {
  if (node.kind === 'part') return <ExportPartCard ctx={ctx} position={node.position} grow />
  return <ExportSlotCell slot={node.slot} grow />
}

/**
 * 整張十字。由上而下：〔無肩槽〕→ 軀幹 → 主列 → 腿部 → 背部。
 *
 * ⚠ `blocks` 由**呼叫端**算好傳進來，不在這裡自己呼叫一次 `rigLayout()`：
 *   抬頭那句「已裝 N / M 格」也是從同一份 blocks 數出來的，
 *   各算一次會出現「圖上畫了 6 格、抬頭寫 5 格」——而那只有逐張圖數格子才看得出來。
 */
export function ExportRig({ ctx, blocks }: { ctx: LoadoutContext; blocks: RigBlock[] }) {
  return (
    <div style={{
      padding: `16px ${RIG_PAD}px 4px`, background: C.bg,
      display: 'flex', flexDirection: 'column', gap: ROW_GAP,
    }}>
      {blocks.map((b) => {
        // `half` 的列（背部）與軀幹／腿部同寬並置中 —— 十字的下端要對得齊上端
        if (b.kind === 'row') {
          return b.half
            ? (
              <div key={b.key} style={{ display: 'flex', justifyContent: 'center' }}>
                <ExportSlotCell slot={b.slot} width={HALF} />
              </div>
            )
            : <ExportSlotCell key={b.key} slot={b.slot} />
        }
        if (b.kind === 'part') {
          return (
            <div key={b.key} style={{ display: 'flex', justifyContent: 'center' }}>
              <ExportPartCard ctx={ctx} position={b.position} width={HALF} />
            </div>
          )
        }
        /**
         * 主列：**一個 grid、每一對佔同一個 grid row**，機體那一格跨滿整欄。
         *
         * ⚠ 不可寫成「左右各一個 flex column」（2026-08-29 瀏覽器實測後改）：那樣兩欄
         *   各自堆疊，只要某一格多一行註記（固定武裝的「機甲固定武裝」、雙手的
         *   「重量計一次」），同一列的左右兩格就會錯開幾 px，而且**越往下累積越多**。
         *   實測帕斯卡那張圖上「右肩」與「左肩」差了 5px —— 一張講相對位置的圖，
         *   左右不成對就失去了它存在的理由。放進同一個 grid row 之後，同列等高是
         *   排版保證的，不必靠內容剛好一樣長。
         */
        const rows = Math.max(b.left.length, b.right.length)
        return (
          <div key={b.key} style={{
            display: 'grid', gridTemplateColumns: `${COL}px ${COL}px ${COL}px`,
            columnGap: GAP, rowGap: ROW_GAP, alignItems: 'stretch',
          }}>
            {b.left.map((n, i) => (
              <div key={n.key} style={{ gridColumn: 1, gridRow: i + 1, minWidth: 0, display: 'flex' }}>
                <ColumnNode ctx={ctx} node={n} />
              </div>
            ))}
            {/* 機體跨滿整欄並垂直置中 —— 它不屬於任何一列 */}
            <div style={{ gridColumn: 2, gridRow: `1 / span ${rows}` }}>
              <MechVisual ctx={ctx} />
            </div>
            {b.right.map((n, i) => (
              <div key={n.key} style={{ gridColumn: 3, gridRow: i + 1, minWidth: 0, display: 'flex' }}>
                <ColumnNode ctx={ctx} node={n} />
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/**
 * 十字底下那一行圖例。
 *
 * ⚠ 「畫面左欄是機體右側」這一句**非印不可**（決策二）：不畫引線之後，左右只由欄位置
 *   表達，而看圖的人沒有第二個線索可以確認自己沒讀反。
 */
export function ExportRigLegend() {
  return (
    <div style={{
      padding: `8px ${RIG_PAD}px 12px`, background: C.bg,
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      fontSize: 11, color: C.dim, lineHeight: 1.6,
    }}>
      <span style={{ color: C.sub }}>畫面左欄是機體右側（正面視角，與遊戲整備畫面一致）</span>
      <LegendKey swatch={{ border: `1px solid ${C.line}`, background: C.panel }} text="已裝" />
      <LegendKey swatch={{ border: '1px dashed rgba(255,107,43,0.6)' }} text="空槽" />
      <LegendKey
        swatch={{
          border: `1px dashed ${C.line}`,
          background: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.14) 0 3px, transparent 3px 6px)',
        }}
        text="此機甲沒有這一格"
      />
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <i style={{ width: 11, height: 11, background: C.yellow, display: 'block' }} />
        不可更換（機甲固定武裝／形態鎖定）
      </span>
    </div>
  )
}

function LegendKey({ swatch, text }: { swatch: CSSProperties; text: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <i style={{ width: 16, height: 11, display: 'block', boxSizing: 'border-box', ...swatch }} />
      {text}
    </span>
  )
}
