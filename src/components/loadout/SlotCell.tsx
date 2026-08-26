import { WeaponIcon } from '../icons/WeaponIcon'
import { LoadoutIcon, type LoadoutIconName } from '../icons/LoadoutIcon'
import { HUD, SEG_TEXT, type SegKey } from './loadoutTheme'
import type { SlotOccupant } from '../../utils/loadoutRules'

// ─── 一格裝備位（PLAN-052-B B-2／PLAN-052-I B-1）──────────────────────────────
//
// 六種狀態，每一種都要「一眼看得出是什麼、為什麼」：
//   空 ／ 已裝 ／ 固定武裝（機甲自帶）／ 形態鎖定 ／ 無槽 ／ 預覽
//
// B-1 的改法：**六態共用同一個外框尺寸與 8px 斜切角**，差異只走三個維度 ——
//   ① 邊框樣式（實線／虛線）  ② 底色  ③ 圖示
// 版面一律是「圖示方塊 ／ 標籤＋名稱 ／ 重量」的橫列，於是六格疊在一起時
// 圖示、名稱、數字三條線是對齊的，眼睛掃一次就讀得完。改版前每一態各自排版，
// 六格擺在一起像六種不同的元件。
//
// ⚠ **重量用該部位的分段色**（手部青／肩部紫／背部藍，`SEG_TEXT`）——與帳本列的分段條
//   同一套顏色，玩家才看得出「這一格吃掉的是哪一段」。顏色來源只有 `loadoutTheme`
//   一份，不要在這裡另外寫死。
//
// ⚠ **無槽要整格說明原因**，不是一個點不下去的空 `[+]`。官方就是後者，
//   而玩家會以為是 bug —— 「這格為什麼點不動」是可預期的客服問題。
// ⚠ **固定武裝仍計入總重**，所以它必須畫在格上，不能只在說明裡提一句。
// ⚠ React key 一律由呼叫端用 `slotKey()` 給，**不可用 weaponId**：
//   帕斯卡的左右肩是同一把衝擊炮，用 weaponId 會撞 key（少畫一格）。
//
// ⚠ `hud-cut-sm` 會裁掉 `ring-*` 與 outline，所以可點的格子用**變色邊框**表示
//   active／flash，不用 focus ring（見 index.css 的切角說明）。

export interface SlotCellPreview {
  name: string
  icon?: string
  weight: number
  /** 換上去之後的餘量。負數 ＝ 換完會超重，整格要把這件事先講掉 */
  remainingAfter?: number
}

interface Props {
  /** 「左手」「右肩」「備用左手」——由 `slotLabel()` 產生 */
  label: string
  /** 這一格上是誰。`null` ＝ 這一格不存在（走 `absentReason`） */
  occupant: SlotOccupant | null
  /** 這一格不存在（或沒有任何東西裝得上）的原因，整格顯示 */
  absentReason?: string
  /** 這一格屬於哪一段重量 —— 決定重量數字的顏色 */
  seg?: SegKey
  /** 空態要畫的槽位型別圖示（由 `slotIconName()` 產生）。已裝態改用武器自己的圖 */
  slotIcon?: LoadoutIconName
  /** 空槽上顯示的「可用 N」。`undefined` ＝ 不顯示（例如機甲數值未公布） */
  available?: number
  /** 挑選器 hover 中的預覽內容（粗指標裝置不做 hover 預覽，見決策一） */
  preview?: SlotCellPreview | null
  /** 挑選器正對著這一格 */
  active?: boolean
  /** 剛被級聯移除 → 閃橙 600ms */
  flash?: boolean
  /** 手機版壓縮格高與字級（槽位圖**不**縮成一欄清單，「一眼看到全部槽位」是整個設計的前提） */
  compact?: boolean
  /**
   * 窄格：重量改排在名稱**下方**而不是右側。
   *
   * ⚠ 這不是美觀選項，是格子放不放得下字的問題。本站 root font-size 是 19px，
   *   Tailwind 的 `gap-2.5` / `px-2.5` 實測各是 11.9px —— 一格 152px 寬的節點光是
   *   內距 24 ＋ 三個間隙 36 ＋ 圖示 43 ＋ 重量 24 ＋ 卸下鍵 24 就吃掉 151px，
   *   名稱欄只剩 1px（實測過，整排武器名消失只剩省略號）。
   *   由 `LoadoutRig` 量容器寬度後決定，不要在這裡猜。
   */
  dense?: boolean
  /**
   * 極窄格（PLAN-052-I F-1）：手機直向時左右兩欄各只剩 ~120px。
   *
   * ⚠ 這是 `dense` 之下的第三階，不是「再小一點」的美觀選項：實測 390px 直向下
   *   兩欄各 63px，而一格光是內距 ＋ 圖示 ＋ 卸下鍵就要 82px —— 名稱欄是**負數**，
   *   整格橫向溢出並被面板的 clip-path 裁掉（畫面上是「左」「可用」被切一半）。
   *   本階把圖示縮到 24px、內距與間隙再收，讓名稱欄拿回可讀的寬度。
   */
  tight?: boolean
  onOpen?: () => void
  onClear?: () => void
}

export function SlotCell({
  label, occupant, absentReason, seg, slotIcon, available, preview,
  active, flash, compact, dense, tight, onOpen, onClear,
}: Props) {
  // ⚠ 內距與間隙一律寫 **px**，不用 Tailwind 的 spacing 單位。
  //   本站 root font-size 是 19px（Layout 的 FONT_SIZE_MAP），`gap-2.5` 實測 11.9px、
  //   `px-2.5` 也是 11.9px —— 一格 190px 的節點光是內距 ＋ 三道間隙 ＋ 圖示就吃掉 150px，
  //   剩下的寬度連「點擊裝備」四個字都放不下（實測會折成兩行）。
  const pad = tight ? 'px-[6px] py-[5px] gap-[6px]'
    : compact || dense ? 'px-[8px] py-[6px] gap-[8px]'
    : 'px-[10px] py-[8px] gap-[9px]'
  // ⚠ tight 的格高要**放得下兩行名稱**：不然折行的那一格會比隔壁高一截，
  //   左右兩欄的「左肩／右肩」就不在同一條線上，整張 HUD 看起來像沒對齊。
  const minH = tight ? 'min-h-[60px]' : compact ? 'min-h-[48px]' : 'min-h-[56px]'
  const base = `hud-cut-sm relative w-full flex items-center border transition-colors ${pad} ${minH}`
  // ⚠ flash 不能用 ring（會被切角裁掉），改用外框變色 ＋ 底色
  const flashOn = flash ? 'border-accent-orange bg-accent-orange/15' : ''
  const nameSize = tight ? 'text-[11.5px]' : compact ? 'text-[12px]' : 'text-[13px]'
  /**
   * 裝備名的溢出處理。
   *
   * ⚠ tight 時**改成折兩行而不是截斷**：名稱欄在 390px 直向下只剩 ~35px，`truncate`
   *   會把每一把武器都變成「夾心…」——一整排看不出裝了什麼。手機上垂直空間比水平便宜，
   *   拿高度換可讀性是對的方向（`break-all` 是必要的：中文字串沒有可斷點）。
   */
  const nameClip = tight ? 'line-clamp-2 break-all leading-tight' : 'truncate'
  const segText = seg ? SEG_TEXT[seg] : 'text-text-secondary'

  // ── 無槽 ──
  if (!occupant) {
    return (
      <div
        className={`${base} border-dashed border-border bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,rgba(255,255,255,0.028)_5px,rgba(255,255,255,0.028)_10px)] ${flashOn}`}
      >
        <IconBox compact={compact} dense={dense} tight={tight} dashed>
          <LoadoutIcon name="absent" className="w-4 h-4 text-text-dim" />
        </IconBox>
        <div className="flex flex-col min-w-0 flex-1">
          <span className={`${HUD.labelCjk} text-text-dim truncate`}>{label}</span>
          <span className="text-[12px] text-text-dim leading-snug">{absentReason ?? '無此槽位'}</span>
        </div>
      </div>
    )
  }

  // ── 預覽（hover 挑選器某一列）──
  // 蓋過空／已裝兩態，因為它問的是「換成它會長怎樣」；順帶把換完會不會超重先講掉。
  if (preview) {
    const over = preview.remainingAfter !== undefined && preview.remainingAfter < 0
    return (
      <div className={`${base} border-accent-orange bg-accent-orange/10`}>
        <IconBox compact={compact} dense={dense} tight={tight} tone="orange">
          <WeaponIcon icon={preview.icon} name={preview.name} size="sm" />
        </IconBox>
        <div className="flex flex-col min-w-0 flex-1">
          {/* 標籤刻意只有四個字：190px 的節點放不下「換成這把會變成」，
              截成「換成這把會…」反而更難讀 */}
          <span className={`${HUD.labelCjk} text-accent-orange truncate`}>換成這把</span>
          <span className={`${nameSize} font-semibold text-text-primary ${nameClip}`}>{preview.name}</span>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <span className={`${HUD.numSm} text-accent-orange`}>{preview.weight.toLocaleString()}</span>
          {preview.remainingAfter !== undefined && (
            <span className={`${HUD.num} text-[10px] ${over ? 'text-accent-red' : 'text-text-dim'}`}>
              餘 {preview.remainingAfter.toLocaleString()}
            </span>
          )}
        </div>
      </div>
    )
  }

  // ── 固定武裝（機甲自帶）／形態鎖定 ──
  // 兩態同色同框，差在**副標**：固定武裝永遠拆不掉，形態鎖定換個形態就解得開 ——
  // 後者是可行動的資訊，玩家需要分得出來。
  if (occupant.kind === 'fixed' || occupant.kind === 'formLocked') {
    const w = occupant.weapon
    const note = occupant.kind === 'fixed' ? '機甲固定武裝' : '形態鎖定'
    const name = w?.name ?? (occupant.kind === 'fixed' ? occupant.occupied.mount.weaponId : occupant.weaponId)
    return (
      <div className={`${base} border-accent-yellow/45 bg-accent-yellow/5 ${flashOn}`}>
        <IconBox compact={compact} dense={dense} tight={tight} tone="yellow">
          <LoadoutIcon
            name={occupant.kind === 'fixed' ? 'lock' : 'lockForm'}
            className="w-4 h-4 text-accent-yellow"
          />
        </IconBox>
        <div className="flex flex-col min-w-0 flex-1">
          <span className={`${HUD.labelCjk} text-text-dim truncate`}>{label} · {note}</span>
          <span className={`${nameSize} font-semibold text-accent-yellow ${nameClip}`}>{name}</span>
          {/* 重量刻意用 dim 而不是分段色：它計入總重，但玩家對它無能為力 */}
          {dense && (
            <span className={`${HUD.num} text-[11px] text-text-dim`}>{(w?.weight ?? 0).toLocaleString()}</span>
          )}
        </div>
        {!dense && (
          <span className={`${HUD.numSm} text-text-dim shrink-0`}>
            {(w?.weight ?? 0).toLocaleString()}
          </span>
        )}
      </div>
    )
  }

  // ── 空 ──
  if (occupant.kind === 'empty') {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`${base} text-left border-dashed cursor-pointer ${
          active
            ? 'border-accent-orange bg-accent-orange/10'
            : 'border-border-accent bg-bg-card/70 hover:border-accent-orange/60 hover:bg-bg-card-hover'
        } ${flashOn}`}
      >
        <IconBox compact={compact} dense={dense} tight={tight} dashed tone="orange">
          <LoadoutIcon name={slotIcon ?? 'plus'} className="w-4 h-4 text-accent-orange" />
        </IconBox>
        <div className="flex flex-col min-w-0 flex-1">
          <span className={`${HUD.labelCjk} text-text-dim truncate`}>{label}</span>
          <span className={`${nameSize} font-semibold text-accent-orange whitespace-nowrap`}>點擊裝備</span>
          {/* 「還剩多少出力」寫在格上，不必先點開才知道裝不裝得下。
              ⚠ tight 時不印：`whitespace-nowrap` 的「可用 1,870」要 62px，而名稱欄只有 56px，
                 字會溢出格外並被面板的切角裁掉。手機上帳本列的 REMAINING 卡就釘在畫面頂端
                 （sticky、20px 綠字），同一個數字在兩公分外已經看得到。 */}
          {dense && !tight && available !== undefined && (
            <span className={`${HUD.num} text-[11px] text-text-dim whitespace-nowrap`}>
              可用 {available.toLocaleString()}
            </span>
          )}
        </div>
        {!dense && available !== undefined && (
          <span className={`${HUD.num} text-[11px] text-text-dim shrink-0`}>
            可用 {available.toLocaleString()}
          </span>
        )}
      </button>
    )
  }

  // ── 已裝 ──
  const isBackpack = occupant.kind === 'backpack'
  const name = isBackpack ? occupant.backpack.name : (occupant.weapon?.name ?? occupant.mount.weaponId)
  const icon = isBackpack ? occupant.backpack.icon : occupant.weapon?.icon
  const weight = isBackpack ? occupant.backpack.weight : (occupant.weapon?.weight ?? 0)

  return (
    <div
      className={`${base} cursor-pointer ${
        active
          ? 'border-accent-orange bg-accent-orange/10'
          : 'border-border-accent bg-bg-card-hover hover:border-accent-orange/60'
      } ${flashOn}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.() } }}
    >
      <IconBox compact={compact} dense={dense} tight={tight}>
        <WeaponIcon icon={icon} name={name} size="sm" />
      </IconBox>
      <div className="flex flex-col min-w-0 flex-1">
        <span className={`${HUD.labelCjk} text-text-dim truncate`}>
          {label}{isBackpack ? ' · 背包' : ''}
        </span>
        <span className={`${nameSize} font-semibold text-text-primary ${nameClip}`}>{name}</span>
        {dense && <span className={`${HUD.num} text-[11px] ${segText}`}>{weight.toLocaleString()}</span>}
      </div>
      {!dense && (
        <span className={`${HUD.numSm} ${segText} shrink-0`}>{weight.toLocaleString()}</span>
      )}
      {onClear && (
        <button
          type="button"
          aria-label={`卸下 ${label} 的 ${name}`}
          onClick={(e) => { e.stopPropagation(); onClear() }}
          className={`hud-cut-sm shrink-0 ${tight ? 'w-[17px] h-[17px]' : 'w-[20px] h-[20px]'} flex items-center justify-center border border-border text-text-dim hover:text-accent-red hover:border-accent-red/60 cursor-pointer`}
        >
          <LoadoutIcon name="close" className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

/**
 * 圖示方塊。六態共用同一個尺寸，只換邊框樣式與描邊色 ——
 * 尺寸一致是「六格疊在一起時三條線對齊」的前提。
 */
function IconBox({
  children, compact, dense, tight, dashed, tone,
}: {
  children: React.ReactNode
  compact?: boolean
  dense?: boolean
  tight?: boolean
  dashed?: boolean
  tone?: 'orange' | 'yellow'
}) {
  const dim = tight ? 'w-[24px] h-[24px]' : compact || dense ? 'w-[30px] h-[30px]' : 'w-[34px] h-[34px]'
  const border =
    tone === 'orange' ? 'border-accent-orange/40'
    : tone === 'yellow' ? 'border-accent-yellow/35'
    : 'border-border'
  return (
    <span
      className={`hud-cut-sm shrink-0 ${dim} flex items-center justify-center border ${border} ${
        dashed ? 'border-dashed bg-transparent' : 'bg-bg-dark'
      }`}
    >
      {children}
    </span>
  )
}
