import type { Pilot, PilotSkillDoc } from '../../types'
import { CARRIED_SKILL_SLOTS } from '../../types/loadout'
import { carriableSkills } from '../../utils/carriedSkills'
import { SkillIcon } from '../icons/SkillIcon'
import { HUD, HUD_ACTIONABLE } from './loadoutTheme'
import { ActionChevron } from './ActionChevron'

// ─── 攜帶技能的三格（PLAN-052-L D-4，團隊回饋 3）─────────────────────────────
//
// 中欄的入口：三個格子。點任一格會在右欄開 `SkillPanel`（切換鏈的第五種內容），
// 不疊第二層彈窗 —— 手機版右欄是 BottomSheet。
//
// ⚠ **只畫三格，不畫第四格**。遊戲的技能列是「三格自由替換 ＋ 一格『改』技能」，
//   而站上沒有「改」技能的資料（見 `LoadoutSkills.mod`）。畫一個永遠點不動的第四格
//   等於在畫面上留一個我們答不出來的問題；欄位先開、格子隱藏是使用者的裁決。
//
// ⚠ **職業單元不畫**（使用者裁決 2026-08-30 逐字：「這個不用顯示，這遊戲但凡有點腦子的、
//   真的有玩的玩家不會不知道」）。曾經在三格下方列一行「職業單元 ／ 天生自帶，不佔上面
//   的三格」—— 那是在替玩家解釋一件他本來就知道的事，而且它與上面三格長得夠像，
//   反而要多花一眼才確認得出「這個點不動」。過濾本身留在 `carriableSkills()`，
//   只是不再有顯示端。
//
// ⚠ 空 Map ＝ 技能庫還沒載入，不是「這位機師沒有技能」—— 兩者都會渲染成空清單，
//   但意思相反，故一律連 `loading` 一起傳下來（同 `WeaponSkillPanel` 的既有規矩）。

interface Props {
  pilot: Pilot | null
  /** 技能庫（`pilotSkills`）。空 Map ＝ 還沒載入，見 `loading` */
  skillMap: ReadonlyMap<string, PilotSkillDoc>
  loading?: boolean
  /** 目前帶著的技能 doc id，緊湊、長度 ≤ 3 */
  carried: readonly string[]
  /** 目前正在挑第幾格（右欄開著 `SkillPanel` 時）。`null` ＝ 沒開 */
  activeIndex: number | null
  onOpenSlot: (index: number) => void
}

export function CarriedSkillRow({ pilot, skillMap, loading, carried, activeIndex, onOpenSlot }: Props) {
  if (!pilot) return null
  // ⚠ **空 Map 也算載入中**，不只看 `loading` 這個 prop（D-4 瀏覽器實測抓到）：
  //   呼叫端的 `skillsLoading` 有可能因為「還沒開始載」而是 false，而那時 map 同樣是空的。
  //   兩者分開判斷的話，下面那句「資料還沒建到可以挑選的程度」會去指控資料有缺，
  //   而真相只是集合還沒去拿 —— 一句錯得很有說服力的話。
  if (loading || skillMap.size === 0) {
    return <p className={`${HUD.body} text-text-dim`}>載入技能庫中…</p>
  }

  // 候選池是空的：今天 89／89 機師都有 6～9 個（見 `carriableSkills()` 的實測），
  // 所以走到這裡代表資料真的缺了一段 —— 說出來，不要畫三個點不動的空格
  if (carriableSkills(pilot, skillMap).length === 0) {
    return (
      <p className={`${HUD.body} text-text-dim`}>
        這位機師的技能資料還沒建到可以挑選的程度。
      </p>
    )
  }

  const slots = Array.from({ length: CARRIED_SKILL_SLOTS }, (_, i) => ({
    i,
    doc: carried[i] ? skillMap.get(carried[i]) ?? null : null,
    /** 有 id 卻查不到 ＝ 資料斷鏈，要看得見而不是靜默留白 */
    brokenId: carried[i] && !skillMap.get(carried[i]) ? carried[i] : null,
  }))

  return (
    <div className="grid grid-cols-3" style={{ gap: 8 }}>
      {slots.map(({ i, doc, brokenId }) => (
        <button
          key={i}
          type="button"
          onClick={() => onOpenSlot(i)}
          aria-label={doc ? `第 ${i + 1} 格：${doc.name}，點擊更換` : `第 ${i + 1} 格：空的，點擊選擇技能`}
          // ⚠ 選中態用**底色**而不是覆寫 `border-accent-orange`：後者與 `HUD_ACTIONABLE`
          //   裡的 `border-border` 特異性相同，勝負取決於產生出來的 CSS 順序 ——
          //   那是一個會隨著別處新增類名而改變結果的賭注（loadoutTheme 的
          //   `HUD_BTN_DANGER` 註解逐字警告過同一件事）。底色與框線不衝突。
          //   `group` 是 `ActionChevron` 的 `group-hover:` 要的鉤子，少了它那個 › 不會轉橘。
          className={`group ${HUD_ACTIONABLE} hud-cut-sm border p-2 text-left flex flex-col min-w-0 ${
            activeIndex === i ? 'bg-accent-orange/10' : ''
          }`}
          style={{ gap: 6 }}
        >
          <span className="flex items-center min-w-0" style={{ gap: 6 }}>
            {doc
              ? <SkillIcon iconLocal={doc.iconLocal} name={doc.name} size="sm" />
              : (
                // 空格用虛線方塊而不是實心「＋」：它與已裝那一格必須一眼分得出來，
                // 而虛線在這一頁已經是「這裡還沒有東西」的既有語彙（槽位圖的空槽）
                <span className="w-7 h-7 shrink-0 rounded-lg border border-dashed border-border-accent flex items-center justify-center text-text-dim text-xs">
                  ＋
                </span>
              )}
            <ActionChevron className="ml-auto shrink-0" />
          </span>
          <span className="min-w-0">
            <span className={`${HUD.body} block truncate ${doc ? 'text-text-primary' : 'text-text-dim'}`}>
              {doc?.name ?? brokenId ?? '未選擇'}
            </span>
            <span className="block text-[11px] text-text-dim truncate">
              {doc ? doc.type : `第 ${i + 1} 格`}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
