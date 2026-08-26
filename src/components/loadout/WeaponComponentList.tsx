import { useMemo } from 'react'
import type { SlotKey } from '../../types/slots'
import { weaponRows, type WeaponRow } from '../../utils/loadoutRows'
import { mountedComponentIds, weaponSiteAt, type LoadoutBudget, type LoadoutContext } from '../../utils/loadoutRules'
import { HUD, SEG_TEXT, slotSegKey, type SegKey } from './loadoutTheme'
import LoadoutIcon from '../icons/LoadoutIcon'

// ─── 武器與元件列（PLAN-052-I D-3）───────────────────────────────────────────
//
// 右欄「情境欄」的預設內容：**每一把已裝武器一列**，列上直接寫出它掛了哪些元件、
// 以及 `n / componentLimit`。
//
// 為什麼是一份獨立的清單而不是靠槽位圖：槽位圖回答的是「哪一格裝了什麼」（幾何問題），
// 元件回答的是「這一把怎麼改」（配置問題）。把元件標籤塞回槽位格上，那一格就得同時
// 表達六種槽位狀態 ＋ 四顆元件標籤 ＋ 兩個計數，而它只有 190px 寬。
//
// ⚠ 列上**不放「＋ 加入元件」按鈕**（052-D Phase C 仍維持這一點）：整列本身就是入口，
//   點進去才是那把武器的元件面板。列寬只有 ~190px，塞一顆按鈕會把武器名擠成兩三個字，
//   而元件的實際操作需要看得到原因與解法 —— 那是面板的事，不是這一列的。
//
// ⚠ 內距與間隙一律寫 px（052-I B-2 踩過）：本站 root font-size 是 19px，
//   Tailwind spacing 的實測值比看起來大 19%。
//
// 清單本身（順序、去重、固定武裝與形態鎖定的納入）由 `src/utils/loadoutRows.ts` 供應。

interface Props {
  ctx: LoadoutContext
  budget: LoadoutBudget
  /** 目前開著元件面板的那一列 */
  activeRow: SlotKey | null
  onOpen: (row: WeaponRow) => void
}

export function WeaponComponentList({ ctx, budget, activeRow, onOpen }: Props) {
  const rows = useMemo(() => weaponRows(ctx), [ctx])
  const used = rows.reduce((n, r) => n + r.used, 0)
  const limit = rows.reduce((n, r) => n + r.limit, 0)

  if (rows.length === 0) {
    return (
      <p className={`${HUD.body} text-text-dim`}>
        還沒有裝上任何武器 —— 點左邊槽位圖上的空格開始配裝。元件掛在武器上，這裡會跟著一起長出來。
      </p>
    )
  }

  const w = budget.weight
  const hasBackup = ctx.capacity.backupHand > 0

  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <span className={`${HUD.body} text-text-dim`}>共 {rows.length} 把</span>
        <span className={`${HUD.numSm} text-text-dim`}>元件 {used} / {limit}</span>
      </div>

      <div className="flex flex-col" style={{ gap: 7 }}>
        {rows.map((r) => (
          <button
            key={r.rowKey}
            type="button"
            onClick={() => onOpen(r)}
            className={`w-full text-left bg-bg-dark border-l-2 transition-colors cursor-pointer ${
              activeRow === r.rowKey ? 'bg-accent-orange/10' : 'hover:bg-bg-card'
            } ${SEG_BORDER[slotSegKey(r.ref.slot)]}`}
            style={{ padding: '8px 10px' }}
          >
            <span className="flex items-baseline" style={{ gap: 8 }}>
              <span className={`${HUD.body} text-text-dim shrink-0`} style={{ width: 52 }}>{r.label}</span>
              <span className={`${HUD.bodyStrong} grow min-w-0 truncate ${
                r.locked ? 'text-accent-yellow' : 'text-text-primary'
              }`}>
                {r.name}
              </span>
              <span className={`${HUD.numSm} shrink-0 ${SEG_TEXT[slotSegKey(r.ref.slot)]}`}>{r.weight.toLocaleString()}</span>
            </span>

            <span className="flex items-center mt-1" style={{ gap: 5 }}>
              {/* ⚠ 固定武裝與形態鎖定的武裝**不可裝元件**（052-D 決策四：8／8 實測 limit=0）。
                  這裡原本寫「元件仍可換」，那是 052-I 當時的假設。 */}
              <span className={`${HUD.body} text-text-dim min-w-0 truncate`}>
                {r.limit === 0
                  ? (r.locked === 'fixed' ? '機甲固定武裝' : r.locked === 'form' ? '形態鎖定的武裝' : `${r.weapon?.rarity ?? ''} 品質`)
                  : r.used === 0 ? '尚未裝設元件'
                  : componentNames(ctx, r)}
              </span>
              {/* ⚠ 這一列本身就是入口，但整列可點**看不出來**（只有 hover 變色）——
                  站長實測時第一個問題就是「怎麼設定元件」。⚙ 是那顆看得見的記號，
                  與槽位圖武器格右下的徽章同一個圖示，兩處指向同一個面板。 */}
              <span className={`${HUD.num} text-[10px] ml-auto shrink-0 flex items-center gap-[3px] ${
                r.limit === 0 ? 'text-text-dim' : r.used > 0 ? 'text-accent-orange' : 'text-text-secondary'
              }`}>
                {r.limit > 0 && <LoadoutIcon name="gear" className="w-3 h-3" />}
                {r.limit > 0 ? `${r.used}/${r.limit}` : '不可裝元件'}
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* footer 兩句，順序固定：先講「這裡能做什麼」，再講「重量為什麼是那個數字」。
          ⚠ 手部「取較重者」這條**必須寫在這裡**（PLAN-052-I B-3）：它是最容易被誤判成
             系統少算的一條規則，而唯一能同時看到主手組與備用組兩排武器的地方就是這份清單。 */}
      <div className={`${HUD.body} text-text-dim border-t border-border pt-2 space-y-1`}>
        <p>
          點任一列、或槽位圖上武器格右下的 <LoadoutIcon name="gear" className="inline w-3 h-3 align-[-1px]" />
          ，<strong className="text-text-secondary">配它的元件</strong>：觸 ＋ 應合計 4 個槽（S 品質 3 個），同族只能裝一顆。
        </p>
        {hasBackup ? (
          <p>
            主手組 <span className={HUD.num}>{w.mainHand.toLocaleString()}</span>、
            備用組 <span className={HUD.num}>{w.backupHand.toLocaleString()}</span> —— 兩者
            <strong className="text-text-secondary">取較重者</strong>計入總重：目前採計
            {w.heavierBank === 'main' ? '主手組' : '備用組'}，較輕的那一組
            <strong className="text-text-secondary">不計入</strong>。
          </p>
        ) : (
          <p>
            裝上<strong className="text-text-secondary">強襲者背包</strong>可解鎖兩格備用武器槽
            （備用組與主手<strong className="text-text-secondary">取較重者</strong>計入總重）。
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * 列上那一行已裝元件的名稱。
 *
 * ⚠ 只印名字、不印 Lv 與描述：這一列寬約 190px，多一個字都會把後面的擠掉。
 *   詳細的（Lv、效果、組合特性）在面板裡，而整列本來就是通往面板的入口。
 *   查不到的元件印回 doc id —— 斷鏈要看得見（同 `weaponRows()` 的 name fallback）。
 */
function componentNames(ctx: LoadoutContext, r: WeaponRow): string {
  const site = weaponSiteAt(ctx, r.ref)
  const { trigger, effect } = mountedComponentIds(site)
  return [...trigger, ...effect]
    .map((id) => ctx.world.components.get(id)?.name ?? id)
    .join('・')
}

/**
 * 分段色的**左框線**版本。
 *
 * ⚠ 不可由 `SEG_TEXT` 字串替換成 `border-*`（Tailwind v4 掃描器只認原始碼裡出現過的
 *   完整類名，執行期拼出來的類名不會被產生 —— C-2 的職業色條已經栽過一次）。
 */
const SEG_BORDER: Record<SegKey, string> = {
  chassis:  'border-l-text-dim/60',
  hands:    'border-l-accent-cyan',
  shoulder: 'border-l-accent-purple',
  back:     'border-l-accent-blue',
}
