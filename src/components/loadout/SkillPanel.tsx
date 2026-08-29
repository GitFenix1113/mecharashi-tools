import { useMemo, useState } from 'react'
import type { Pilot, PilotSkillDoc } from '../../types'
import { carriableSkills } from '../../utils/carriedSkills'
import { SkillIcon } from '../icons/SkillIcon'
import { RefText } from '../refs/RefText'
import { HUD, HUD_ACTIONABLE, HUD_BTN, HUD_BTN_DANGER, HUD_INPUT, HUD_PANEL, HUD_READONLY } from './loadoutTheme'
import { ActionChevron } from './ActionChevron'

// ─── 技能挑選面板（PLAN-052-L D-4）──────────────────────────────────────────
//
// 右欄「情境欄」的第五種內容：從中欄的三格鑽進來，挑這一格要帶的技能。
//
// ⚠ **加進既有的切換鏈，不疊第二層彈窗**（沿用 052-G C-3 的既有裁決）：
//   右欄本來就是「挑選器 ＞ 元件面板 ＞ 模組面板 ＞ 武器與元件列」的切換式情境欄。
//   手機版它是 BottomSheet，疊兩層等於把返回鍵埋掉。
//
// ⚠ **版面照抄 `ModulePanel`**：兩者是同一件事的兩個實例（從一格鑽進去、配一個東西
//   上去），玩家在其中一邊學會的操作應該原封不動適用於另一邊。差異只有兩處，
//   而且都是資料造成的：技能**不佔重量也沒有接口限制**（沒有預算列、沒有拒絕態），
//   而且候選池小（6～9 筆）⇒ 篩選只留一個搜尋框，不做分類晶片。
//
// ⚠ **候選池一律問 `carriableSkills()`**，不在這裡自己濾一次：`reconcile()` 用的是
//   同一支。各查一次的下場是「面板讓你選、reconcile 又把它掃掉」，而畫面上看起來
//   就是點了沒反應。
//
// ⚠ **不解釋「為什麼職業單元不在清單裡」**（使用者裁決 2026-08-30）：那是玩過的人
//   本來就知道的事，寫出來只是替讀者複習規則。同一輪也把中欄那一列職業單元拿掉了。

interface Props {
  pilot: Pilot | null
  /** 技能庫。空 Map ＝ 還沒載入，不是「沒有技能」 */
  skillMap: ReadonlyMap<string, PilotSkillDoc>
  loading?: boolean
  /** 正在配第幾格（0-based） */
  index: number
  /** 目前三格的內容，用來標「已在第 N 格」 */
  carried: readonly string[]
  onBack: () => void
  onPick: (skillId: string) => void
  onClear: (skillId: string) => void
}

export function SkillPanel({
  pilot, skillMap, loading, index, carried, onBack, onPick, onClear,
}: Props) {
  const [query, setQuery] = useState('')

  const carriable = useMemo(() => carriableSkills(pilot, skillMap), [pilot, skillMap])
  const currentId = carried[index] ?? null
  const current = currentId ? skillMap.get(currentId) ?? null : null

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return carriable
    // 搜尋比對**名稱 ＋ 敘述**（同 ModulePanel）：玩家記得的常常是效果字眼而不是名字
    return carriable.filter((d) => `${d.name} ${d.description}`.toLowerCase().includes(q))
  }, [carriable, query])

  return (
    <section className={`${HUD_PANEL} p-3.5`}>
      <div className="flex items-center" style={{ gap: 8 }}>
        <button type="button" onClick={onBack} className={`${HUD_BTN} shrink-0 px-2 py-1 text-[13px]`}>
          ← 返回
        </button>
        <h2 className={`${HUD.cardTitle} text-text-primary min-w-0 truncate`}>
          攜帶技能 · 第 {index + 1} 格
        </h2>
      </div>

      {loading ? (
        <p className={`${HUD.body} text-text-dim mt-3`}>載入技能庫中…</p>
      ) : (
        <>
          {/* ── 已裝上：一顆卸下鍵 ──
              「我要讓這一格空著」與「換一個」是兩件事（沿用 ModulePanel 的既有裁決）。
              換一個直接點清單就好，不必先卸下。 */}
          {current && (
            <div className={`${HUD_READONLY} rounded mt-3 p-2 flex items-center`} style={{ gap: 8 }}>
              <SkillIcon iconLocal={current.iconLocal} name={current.name} size="sm" />
              <span className="flex flex-col min-w-0 grow">
                <span className={`${HUD.bodyStrong} text-text-primary truncate`}>{current.name}</span>
                <span className="text-[11px] text-text-dim">目前這一格</span>
              </span>
              <button
                type="button"
                onClick={() => onClear(current.id)}
                className={`${HUD_BTN_DANGER} shrink-0 px-2 py-1 text-[12px]`}
              >
                卸下
              </button>
            </div>
          )}

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋技能名稱或效果"
            className={`${HUD_INPUT} w-full mt-3 px-2 py-1 text-[13px]`}
          />

          <div className="flex flex-col mt-2" style={{ gap: 6 }}>
            {list.map((d) => {
              const at = carried.indexOf(d.id)
              const here = at === index
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onPick(d.id)}
                  disabled={here}
                  aria-label={`選擇 ${d.name}`}
                  className={`group hud-cut-sm border p-2 text-left flex items-start min-w-0 ${
                    here ? `${HUD_READONLY} cursor-default` : HUD_ACTIONABLE
                  }`}
                  style={{ gap: 8 }}
                >
                  <SkillIcon iconLocal={d.iconLocal} name={d.name} size="sm" />
                  <span className="flex flex-col min-w-0 grow" style={{ gap: 2 }}>
                    <span className="flex items-baseline flex-wrap min-w-0" style={{ gap: 6 }}>
                      <span className={`${HUD.bodyStrong} text-text-primary truncate`}>{d.name}</span>
                      <span className="text-[11px] text-text-dim shrink-0">{d.type}</span>
                      {/* ⚠ 已經在別格時要說出來，否則點下去會「憑空從那一格消失」——
                          reducer 的規則是對調（見 `withCarriedSkill`），先講清楚才不意外 */}
                      {at >= 0 && (
                        <span className={`text-[11px] shrink-0 ml-auto ${here ? 'text-text-dim' : 'text-accent-yellow'}`}>
                          {here ? '就在這一格' : `已在第 ${at + 1} 格 · 點此對調`}
                        </span>
                      )}
                    </span>
                    <span className={`${HUD.body} text-text-secondary`}>
                      <RefText text={d.description} refs={d.descriptionRefs} />
                    </span>
                  </span>
                  {!here && <ActionChevron className="mt-1" />}
                </button>
              )
            })}
            {list.length === 0 && (
              <p className={`${HUD.body} text-text-dim`}>
                {carriable.length === 0
                  ? '這位機師的技能資料還沒建到可以挑選的程度。'
                  : `沒有符合「${query.trim()}」的技能。`}
              </p>
            )}
          </div>

        </>
      )}
    </section>
  )
}
