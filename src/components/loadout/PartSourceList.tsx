import { useMemo, useState } from 'react'
import type { Mech } from '../../types'
import type { MechPartPosition } from '../../types/enums'
import { imageCandidates } from '../../utils/assets'
import { partLabel } from '../../utils/moduleSlots'
import { partOf } from '../../utils/chassisStats'
import { partChoices, type LoadoutContext } from '../../utils/loadoutRules'
import { FallbackImage } from '../common/FallbackImage'
import { ActionChevron } from './ActionChevron'
import { HUD, HUD_ACTIONABLE, HUD_INPUT } from './loadoutTheme'

// ─── 部件來源清單（PLAN-052-G Phase D / D-2）─────────────────────────────────
//
// 「這一格是誰的」——與同一個面板另一段的「這一格裝了什麼模組」是同一個部位的兩個問題，
// 所以它們共用一個面板、一顆返回鍵（使用者裁決 2026-08-28：面板內分成兩段）。
//
// ⚠ **池子是全庫同裝甲類型，不做擁有限制**（總綱 Open Question ④ 的預設答案）：
//   輕型 27 ／ 中甲 36 ／ 重型 27。模擬器的用途是「試配」，要求玩家先把倉庫輸入一遍
//   等於把它變成另一種資料錄入工具。
//
// ⚠ **基底機甲留在清單裡而且排第一** —— 它是「還原為選定機甲」的唯一入口。
//   把它濾掉的話，換錯之後就只剩「整台重選一次」這條路。
//   ⚠ 那一列的徽章寫**「選定機甲」**（使用者要求 2026-08-29，原本是「原廠」）：
//     「原廠」聽起來像在講這台機甲出廠時的樣子，而它實際指的是**上面「機甲」那格選的那台**。
//
// ⚠ **不列跨型與佔位機甲**（規則層標成 structural，`partChoices()` 已濾掉）。
//   被濾掉幾台由下面那句 hint 交代 —— 靜默消失會被讀成「站上漏了」，
//   而這正是 052-F B-3 學到的那一課：規則講得再清楚，掛在不會被渲染的列上就等於沒講。

interface Props {
  ctx: LoadoutContext
  position: MechPartPosition
  /** 換成這一台的同位部件。傳入基底機甲＝還原為選定機甲（reducer 會收掉那個鍵） */
  onSwap: (source: Mech) => void
}

const ICON = 34

export function PartSourceList({ ctx, position, onSwap }: Props) {
  const [query, setQuery] = useState('')

  // 空 Map ＝還沒載入完（與 world.modules 同一條語意），不是「這個世界沒有機甲」
  const loading = ctx.world.mechs.size === 0

  const entries = useMemo(() => partChoices(ctx, position), [ctx, position])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? entries.filter((e) => e.item.name.toLowerCase().includes(q)) : entries
  }, [entries, query])

  const baseId = ctx.mech?.id ?? null
  const currentId = ctx.chassis?.parts[position].sourceMechId ?? baseId

  /**
   * 被擋在池外的台數。**一定要說出來** —— 玩家看到 36 台裡沒有他想找的那台重甲時，
   * 第一個念頭是「站上漏了」而不是「那台跟我這台不同型」。
   */
  const excluded = ctx.world.mechs.size - entries.length

  if (loading) {
    return <p className={`${HUD.body} text-text-dim mt-2.5 border-t border-border pt-2.5`}>機甲資料載入中…</p>
  }
  if (!ctx.mech || !ctx.chassis) {
    return <p className={`${HUD.body} text-text-dim mt-2.5 border-t border-border pt-2.5`}>請先選擇機甲。</p>
  }

  return (
    <div className="mt-2.5 border-t border-border pt-2.5">
      <p className={`${HUD.body} text-text-secondary`}>
        每個部位可換成<strong className="text-text-primary">別台{ctx.mech.armorType}機甲</strong>的同位部件。
        重量與火力是<strong className="text-text-primary">四部位加總</strong>，出力只看軀幹。
      </p>
      {excluded > 0 && (
        <p className={`${HUD.body} text-text-dim mt-1`}>
          清單只列同為{ctx.mech.armorType}的 {entries.length} 台；
          另外 {excluded} 台因<strong className="text-text-secondary">裝甲類型不符或官方數值未公布</strong>不列入。
        </p>
      )}

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜尋機甲名稱"
        className={`${HUD_INPUT} w-full mt-2`}
      />

      {/* ⚠ **清單自己捲**（`max-h + overflow-y-auto`，與模組清單同一組數字）：
          36 台每台一列，不加高度上限的話右欄會被撐長，換一個部位就要把整頁捲回去
          —— 而挑選這件事應該在原地完成。使用者回報 2026-08-28。
          ⚠ `pr-0.5` 是留給捲軸的：不留的話捲軸會壓在列的右邊界上。 */}
      <div className="flex flex-col mt-2 max-h-[52vh] overflow-y-auto pr-0.5" style={{ gap: 6 }}>
        {filtered.map((e) => (
          <PartRow
            key={e.item.id}
            source={e.item}
            position={position}
            isBase={e.item.id === baseId}
            isCurrent={e.item.id === currentId}
            onSwap={onSwap}
          />
        ))}
        {filtered.length === 0 && (
          <p className={`${HUD.body} text-text-dim`}>沒有符合名稱的機甲。</p>
        )}
      </div>
    </div>
  )
}

function PartRow({ source, position, isBase, isCurrent, onSwap }: {
  source: Mech
  position: MechPartPosition
  isBase: boolean
  isCurrent: boolean
  onSwap: (source: Mech) => void
}) {
  const part = partOf(source.parts, position)
  if (!part) return null            // `partChoices()` 已擋掉，這裡是型別上的收尾

  const iface = part.interface?.trim()
  // 這個部位帶不帶固定武裝 —— 換過去會連同那幾格一起換掉，是玩家最容易被嚇到的一件事
  const fixed = part.fixedArmament ?? []

  return (
    <div
      className={`group flex items-start border ${
        isCurrent ? 'bg-bg-dark border-accent-orange/40' : HUD_ACTIONABLE
      }`}
      style={{ gap: 9, padding: '7px 9px' }}
      onClick={isCurrent ? undefined : () => onSwap(source)}
      role={isCurrent ? undefined : 'button'}
      tabIndex={isCurrent ? undefined : 0}
      onKeyDown={(ev) => {
        if (!isCurrent && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onSwap(source) }
      }}
    >
      <span className="shrink-0 flex items-center justify-center" style={{ width: ICON, height: ICON }}>
        <FallbackImage
          candidates={imageCandidates(part.icon)}
          alt=""
          loading="lazy"
          className="max-w-full max-h-full object-contain"
          fallback={<span className="text-[10px] text-text-dim">無圖</span>}
        />
      </span>

      <span className="flex flex-col min-w-0 grow" style={{ gap: 3 }}>
        <span className="flex items-center" style={{ gap: 6 }}>
          <span className={`${HUD.bodyStrong} text-text-primary truncate`}>{source.name}</span>
          {isBase && (
            <span className={`${HUD.body} text-text-dim shrink-0`}>選定機甲</span>
          )}
          <span className="shrink-0 ml-auto flex items-center" style={{ gap: 4 }}>
            {isCurrent
              ? <span className={`${HUD.body} text-accent-orange`}>目前使用</span>
              : <ActionChevron className="ml-0.5" />}
          </span>
        </span>

        <span className={`${HUD.body} text-text-secondary`}>
          {partLabel(position)} · 重量 <span className={HUD.num}>{part.weight.toLocaleString()}</span>
          {' · '}火力 <span className={HUD.num}>{part.firepower.toLocaleString()}</span>
          {/* 出力只有軀幹有（總綱決策七）—— 其餘三格印一個恆為 0 的欄位只是雜訊 */}
          {part.output ? <> · 出力 <span className={HUD.num}>{part.output.toLocaleString()}</span></> : null}
          {' · '}{iface || '無接口'}
        </span>

        {fixed.length > 0 && (
          // ⚠ 一定要講：固定武裝住在部件上，換過去會**連同它佔住的那幾格一起換掉**。
          //   不講的話玩家會看到自己的武器憑空消失，而畫面上只換了一個部位的名字。
          <span className={`${HUD.body} text-accent-yellow/90`}>
            附固定武裝 {fixed.length} 件 —— 換過來會佔住對應的槽位
          </span>
        )}
      </span>
    </div>
  )
}
