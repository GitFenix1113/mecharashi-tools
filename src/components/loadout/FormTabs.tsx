import type { EquipSet, MechForm } from '../../types'
import { equipSetLabel } from '../../utils/forms'
import { HUD, HUD_TAG } from './loadoutTheme'

// ─── 形態配裝分頁列（PLAN-052-F B-1）─────────────────────────────────────────
//
// 海莉絲的先鋒／突擊／戰術三個形態**各有一套獨立配裝**，而模擬器在本計畫之前
// 只畫得出其中一套。地基（`draft.sets` / `activeSetKey` / `equipSetKeys()` /
// `buildContext(draft, key, world)`）從 052-A C-3 起就都在了 —— 缺的只是這一排分頁。
//
// ⚠ **一律 map over `equipSetKeys()` 的結果，不可 map over `Object.keys(draft.sets)`**
//   （`utils/forms.ts` 的註解已釘死，本元件是第一個真正遵守它的消費端）：
//   後者是「已經存過東西的分頁」—— 新建的配裝一個鍵都沒有，分頁會**整排消失**；
//   而且鍵的順序由寫入順序決定，換一台機甲就可能重排。
//   本元件因此把 `setKeys` 收成 prop（呼叫端已經算好），`sets` 只用來**數**每頁裝了幾件。
//
// ⚠ 分頁身分用 **formId**，不是 `order`：`order` 只影響顯示順序，
//   後台一次重排就會讓所有既存分享碼靜默指向另一個形態。
//
// ⚠ **只有一個分頁時整排不渲染**（`equipSetLabel()` 對 `default` 回 `null` 正是為此）：
//   一個叫「預設」的孤兒分頁對 88 位沒有形態的機師只是多一列噪音。
//   今天全站只有海莉絲一位會看到這一排 —— 這不是縮水，是驗收面積就只有兩種情況。
//
// ⚠ **位置：「裝備與模組」面板的抬頭列**（機甲名與裝甲徽章的右邊），不是 sticky 抬頭。
//   最初擺在 sticky 抬頭裡、緊貼重量／出力條上方，理由是「分頁與它統轄的數字一起 sticky」；
//   但**使用者實測回饋（2026-08-28）逐字：「這邊有點不顯眼，我找了一陣子才找到形態切換的操作」**——
//   那一排混在機師／機甲／方案名稱那幾顆同色卡片之間，看起來像又一個欄位。
//   面板抬頭是「這一套裝了什麼」的標題列，而分頁換的正是那個「這一套」；
//   它也就在槽位圖正上方，切完之後眼睛不必移動。
//   換位置的代價是「捲到下半部時 sticky 的數字失去歸屬」，由 `OutputBar` 的
//   `formName` 標籤補上（一個標籤，不是第二排可以點的分頁）。
//
// ⚠ 尾端的 `lockedForms` **不是分頁**（PLAN-052-F C-1）：鎖死整套配裝的形態
//   點進去什麼都不能改，做成分頁是一個假的互動 —— 那正是 `equipSetKeys()`
//   當初把它排除在外的理由。但完全不畫也不行：玩家在三個分頁之間切換、
//   卻找不到官方形態頁上明明有的第四格，會把它當成「站上漏了」。
//   於是這裡只放一個**唯讀標記**，說明本體在槽位圖下方那張 <LockedFormCard>。
//   兩者靠 052-I 已定的規則分辨：**切角（hud-cut）＝ 可互動，圓角（rounded）＝ 唯讀**。

interface Props {
  /** 一律來自 `equipSetKeys(pilotId, forms)`。長度 ≤ 1 時整個元件不渲染 */
  setKeys: readonly string[]
  activeKey: string
  forms: readonly MechForm[] | null | undefined
  /**
   * 只用來在分頁上印「這一頁裝了幾件」。
   *
   * ⚠ **不可**拿它決定要畫哪些分頁（見檔頭）。之所以還是收進來，是因為
   * 「哪幾頁我已經配過了」在三頁之間切換時是玩家最需要的一句話 ——
   * 沒有它，三個分頁看起來完全一樣，切過去才知道是空的。
   */
  sets: Readonly<Record<string, EquipSet>>
  onSelect: (key: string) => void
  /**
   * 鎖死整套配裝、因而**不佔分頁**的形態（海莉絲虛粒子）。一律來自
   * `lockedFormCards(pilotId, forms)` —— 判準是「這位機師有沒有分頁列」，
   * 本元件不自己判（曜有一個 fixedArmament 形態卻沒有分頁列）。
   *
   * 渲染成尾端的唯讀標記，**不是 tab、不可點、不進 roving focus**。
   */
  lockedForms?: readonly MechForm[]
}

export function FormTabs({ setKeys, activeKey, forms, sets, onSelect, lockedForms = [] }: Props) {
  // 沒有分頁列就整個不渲染 —— 連唯讀標記也不留。
  // `lockedFormCards()` 已保證這種情況下 lockedForms 是空的，這一行是把不變式寫出來：
  // 一個孤零零掛在空白處的「🔒 巡航形態」比不畫更糟。
  if (setKeys.length <= 1) return null

  return (
    <div
      role="tablist"
      aria-label="形態配裝分頁"
      // ⚠ `shrink-0` + `whitespace-nowrap` 必須跟 `overflow-x-auto` 一起下（PLAN-041 D-2 的教訓）：
      //   單獨加 `overflow-x-auto` 是 no-op —— 按鈕會先被壓扁，永遠不會產生可捲動的溢出，
      //   於是 360px 上分頁名被壓成折行、底線整條歪掉（桌機看不到）。
      className="flex items-stretch gap-1 overflow-x-auto"
    >
      {setKeys.map((key) => {
        const label = equipSetLabel(key, forms) ?? key
        const count = sets[key]?.mounts.length ?? 0
        const active = key === activeKey
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(key)}
            // 切角 ＝ 可互動（`loadoutTheme` 的規則），選中態沿用挑選器篩選晶片那組橘：
            // 本頁「目前選著的那一個」全部是這一組，不新增第二種選中語彙。
            className={`hud-cut-sm shrink-0 whitespace-nowrap flex items-center gap-1.5 px-2.5 py-1
              border text-[13px] transition-colors cursor-pointer ${
              active
                ? 'border-accent-orange bg-accent-orange/15 text-accent-orange font-bold'
                : 'border-border bg-bg-dark text-text-secondary hover:border-border-accent hover:text-text-primary'
            }`}
          >
            <span>{label}</span>
            {/* 件數用 10px 等寬：它是拉丁數字、而且刻意比分頁名次一階 —— 分頁名才是要讀的那個。
                0 件也印，不用「有裝才顯示」：那會讓「這頁是空的」與「這頁還沒算好」看起來一樣。 */}
            <span className={`${HUD.num} text-[10px] ${active ? 'text-accent-orange/70' : 'text-text-dim'}`}>
              {count}
            </span>
          </button>
        )
      })}

      {/* ── 尾端唯讀標記：不是分頁 ──
          · `<span>` 不是 `<button>`，也**不掛 role="tab"** —— 讀螢幕的人不該在
            分頁清單裡數到一個按不下去的分頁。
          · `rounded`（圓角）＋ 沒有 hover ＋ 沒有 cursor-pointer ＝ 本頁的「唯讀」語彙。
          · 帶一個鎖頭字元而不是 `★`：★ 在本站是「天賦專屬」的意思（形態卡上就有一個），
            這裡要講的是「改不了」。兩件事都成立，但這一排要回答的是後者。 */}
      {lockedForms.map((f) => (
        <span
          key={f.id}
          title={`${f.name}：武裝焊死，本形態下所有槽位皆不可調整 —— 詳見下方形態卡`}
          className={`${HUD_TAG} shrink-0 whitespace-nowrap flex items-center gap-1.5 px-2.5 py-1
            border-accent-yellow/35 text-accent-yellow/80 text-[13px] select-none`}
        >
          <span aria-hidden>🔒</span>
          <span>{f.name}</span>
          <span className="text-[10px] text-text-dim">固定</span>
        </span>
      ))}
    </div>
  )
}
