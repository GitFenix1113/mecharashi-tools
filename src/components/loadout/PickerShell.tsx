import { useMemo, useState } from 'react'
import { BottomSheet } from '../common/BottomSheet'
import { RejectionRow, type PickerRowItem } from './RejectionRow'
import { type PickerEntry, type ResolutionAction } from '../../utils/loadoutRules'
import { LoadoutIcon } from '../icons/LoadoutIcon'
import { MechPickerCard, PilotAvatarCard } from './PickerVariants'
import { HUD, HUD_BTN, HUD_INPUT } from './loadoutTheme'

// ─── 挑選器容器（PLAN-052-B C-1）─────────────────────────────────────────────
//
// **同一份清單邏輯，兩種容器**：桌機是就地面板、手機是 BottomSheet。
// 分叉成兩份元件的代價是每一條規則要改兩次，而漏改的那一次不會有任何錯誤訊息。
//
// ⚠ 手機版 sheet 的底部**必須**有常駐預算列：sheet 會蓋住 HUD 的重量條，
//   沒有它玩家在挑選時是瞎選（決策一逐字：「是必須不是加分」）。
//   桌機版就地面板同樣掛一條 sticky 的 —— 清單捲下去之後同樣看不到上方的條。

/**
 * 一組篩選晶片（PLAN-052-I C-2）。
 *
 * ⚠ `test` 由呼叫端提供，因為只有它認得 T ——「職業等於這個值」這種判斷不該
 *   靠字串比對 `row.meta`，那會在副標措辭改一個字的時候靜默失效。
 */
export interface PickerFilterGroup<T> {
  key: string
  /** 「職業」「執照」「品質」 */
  label: string
  options: readonly { value: string; label: string; tone?: string }[]
  test: (item: T, value: string) => boolean
  /**
   * **子篩選**（使用者要求 2026-08-27）：這一組隸屬於另一組（值是那一組的 `key`），
   * 只在父組**有選值時**才出現，且選項只列得出「符合父組當下選擇」的那些值。
   *
   * 為什麼不直接把所有值攤平成一排：武器的種類有 17 個，攤開來是一整片與當下無關的晶片
   * （選了格鬥還看得到「導彈」「浮游炮」）。父子兩層讓第二排永遠只有 3～7 顆，
   * 而且每一顆都是父組底下真的存在的。
   *
   * ⚠ **不需要維護一張「父值 → 子值」對照表**：子組的選項由目前這份清單實測算出來
   *   （見下方 `available` 的兩趟計算）。多一張表就是多一個會與資料失同步的地方 ——
   *   官方哪天新增一種格鬥武器，表沒改就會靜默少一顆晶片。
   */
  dependsOn?: string
}

// ⚠ **刻意沒有「預設篩選」**。曾經讓武器／背包預設只看 SS，但那要求「預設值在這份清單裡
//   真的存在」才套得上（否則一開挑選器就是零筆，玩家還看不出是自己沒選過的條件造成的）。
//   那個前置條件本身就是風險訊號 —— 一個要靠額外守則才安全的預設值，不如不要。
//   挑選器一律以「全部」開始；要收窄由玩家自己按。

/**
 * 清單項目的長相。
 *   `list`      武器、背包 —— 一行一件
 *   `pilotGrid` 機師 —— 頭像牆（C-2）
 *   `mechCard`  機甲 —— 帶 portrait 縮圖的橫向卡（C-3）
 */
export type PickerVariant = 'list' | 'pilotGrid' | 'mechCard'

interface Props<T> {
  open: boolean
  title: string
  variant?: PickerVariant
  /** 晶片篩選列。給了才渲染 —— 武器挑選器靠搜尋框就夠，不需要 */
  filters?: readonly PickerFilterGroup<T>[]
  /** 目前已選中的 id（機師／機甲是單選，要在牆上標出來） */
  selectedId?: string
  /**
   * 清單上方的一行提要。
   *
   * ⚠ 存在的理由是**密度**：頭像牆上有三分之二的機師執照與目前機甲不符，
   *   逐格印原因會把整面牆變成說明文。那句話只該講一次，講在這裡。
   */
  hint?: React.ReactNode
  /**
   * 整個挑選器不該開的原因（`blocked` tier）。有值時**降級並說明**，
   * 不是給一個空清單 —— 空清單只會讓玩家再點一次。
   */
  blockedReason?: string | null
  entries: readonly PickerEntry<T>[]
  toRow: (item: T) => PickerRowItem
  /** 裝上後的剩餘出力（可裝的列才有） */
  remainingAfter?: (item: T) => number | undefined
  /** 「裝上將取代 右手 麥克斯」 */
  replaceNote?: (item: T) => string | undefined
  /** 底部常駐預算列 */
  budgetLine: React.ReactNode
  /** 資料還在路上。要與「真的沒有東西可選」分得開 —— 兩者都是空清單，但意思相反 */
  loading?: boolean
  /**
   * 另一個選項的切換鍵（背槽專用）。背包與背部武器共用同一格，
   * 而它們是兩份完全不同的清單 —— 沒有這顆鍵，玩家得先關掉再找別的入口。
   */
  altAction?: { label: string; onClick: () => void }
  /** 用 BottomSheet 還是就地面板。由 `useIsMobile()`（粗指標）決定，**不是**視窗寬度 */
  useSheet: boolean
  onPick: (item: T) => void
  onResolve: (action: ResolutionAction) => void
  onHoverItem?: (item: T | null) => void
  onClose: () => void
}

export function PickerShell<T extends { id: string }>(props: Props<T>) {
  const { open, title, useSheet, onClose, budgetLine, altAction } = props
  const body = <PickerBody {...props} />

  if (!open) return null

  if (useSheet) {
    return (
      <BottomSheet
        open
        onClose={onClose}
        title={
          <span className="flex items-center gap-2">
            <span className="flex-1">{title}</span>
            {altAction && <AltButton {...altAction} />}
          </span>
        }
        footer={budgetLine}
      >
        {body}
      </BottomSheet>
    )
  }

  return (
    <div className="rounded-xl border border-border-accent bg-bg-card overflow-hidden flex flex-col max-h-[70vh]">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        <h3 className="text-[13px] font-bold text-text-primary flex-1">{title}</h3>
        {altAction && <AltButton {...altAction} />}
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉挑選器"
          className="text-text-dim hover:text-text-primary leading-none cursor-pointer p-1"
        >
          <LoadoutIcon name="close" className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5">{body}</div>
      <div className="border-t border-border px-3 py-2 bg-bg-card">{budgetLine}</div>
    </div>
  )
}

function AltButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${HUD_BTN} shrink-0 text-[12px] px-2 py-0.5`}
    >
      {label}
    </button>
  )
}

function PickerBody<T extends { id: string }>({
  blockedReason, entries, toRow, remainingAfter, replaceNote, onPick, onResolve, onHoverItem, loading,
  variant = 'list', filters, selectedId, hint,
}: Props<T>) {
  const [query, setQuery] = useState('')
  /** 分組鍵 → 玩家選的值。空字串／缺席 ＝ 該組不過濾 */
  const [chosen, setChosen] = useState<Record<string, string>>({})

  /**
   * `available` 每一組篩選在**這份清單裡實際存在**的選項值。
   * `active`    實際生效的篩選值（＝ `chosen` 濾掉那些「選了但這份清單沒有」的）。
   *
   * ⚠ **兩者必須一起算**：子篩選（`dependsOn`）的可用值取決於父組**已生效**的選擇，
   *   而父組的生效值又取決於它自己的可用值 —— 拆成兩個 `useMemo` 會互相依賴。
   *   這裡改成單一 memo、跑兩趟：先無依賴的組，再依賴組。
   *
   * `available` 的用途有三：
   *   ① 隱藏空選項 —— 背槽只有戰術類武器，就不該讓「格鬥／射擊／突擊」三顆晶片出現，
   *      那是按下去必然零筆的晶片。
   *   ② 讓**換一格之後殘留的選擇**自動退回「全部」。這條不是防禦性程式碼，是真的會發生：
   *      挑選器元件在切換槽位時不會重新掛載，於是「在手部選了格鬥 → 改點背槽」
   *      會留下一個背槽篩不出任何東西的條件。**子篩選靠同一條自動退位**：
   *      類型從格鬥改成戰術時，殘留的「刀劍」不在新的可用集合裡 → 自動回「全部」。
   *   ③ 子組的**空集合 ＝ 這一組現在不該出現**（父組還沒選）。
   *
   * 結構性拒絕的項目一律不算數（它們根本不會被列出來）。
   */
  const { available, active } = useMemo(() => {
    const groups = filters ?? []
    const pool = entries.filter((e) => e.rejection?.tier !== 'structural')
    const avail = new Map<string, Set<string>>()
    const act: Record<string, string> = {}

    // pass 0 ＝ 無依賴的組；pass 1 ＝ 子組（此時父組的 act 已經定案）
    for (const pass of [0, 1] as const) {
      for (const g of groups) {
        if ((pass === 0) !== !g.dependsOn) continue
        const parent = g.dependsOn ? groups.find((p) => p.key === g.dependsOn) : undefined
        const set = new Set<string>()
        // 父組沒選（或宣告了一個不存在的父鍵）→ 留空集合，這一組整組不畫
        if (!parent || act[parent.key]) {
          const scope = parent ? pool.filter((e) => parent.test(e.item, act[parent.key])) : pool
          for (const e of scope) {
            for (const o of g.options) if (g.test(e.item, o.value)) set.add(o.value)
          }
        }
        avail.set(g.key, set)
        const v = chosen[g.key]
        act[g.key] = v && set.has(v) ? v : ''
      }
    }
    return { available: avail, active: act }
  }, [entries, filters, chosen])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries
      .map((e) => ({ entry: e, row: toRow(e.item) }))
      .filter(({ entry, row }) => {
        // ⚠ 結構性拒絕**一律不列**（PLAN-052-I 驗收後）：那些是「改別的也解不掉」的項目，
        //   原本摺疊成一行計數可展開，但那一行對玩家沒有可行動的資訊。
        if (entry.rejection?.tier === 'structural') return false
        for (const g of filters ?? []) {
          const v = active[g.key]
          if (v && !g.test(entry.item, v)) return false
        }
        if (!q) return true
        return row.name.toLowerCase().includes(q) || row.meta.toLowerCase().includes(q)
      })
    // toRow 是呼叫端的 inline 箭頭函式，放進依賴會讓 useMemo 每次都失效；
    // 它只是純映射，內容變動一律由 entries 帶動
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, query, filters, active])

  if (loading) {
    return <p className="px-2.5 py-6 text-center text-[13px] text-text-dim">載入遊戲資料中…</p>
  }

  if (blockedReason) {
    return (
      <div className="px-2.5 py-6 text-center">
        <LoadoutIcon name="lock" className="w-7 h-7 mx-auto mb-2 text-text-dim" />
        <p className="text-[13px] text-text-secondary leading-relaxed">{blockedReason}</p>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <p className="px-2.5 py-6 text-center text-[13px] text-text-dim leading-relaxed">
        這一格沒有任何可裝的裝備。
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {/* ⚠ 搜尋列**凍結在頂端**：清單動輒 90 筆，捲到一半想改搜尋字串卻得先捲回頂，
          是這個面板最容易被抱怨的一件事。負外距抵銷捲動容器的左右內距，
          讓底色蓋滿整條、列從它底下捲過去。 */}
      {/* ⚠ 底色**必須是不透明的那一個**：`bg-bg-card` 帶 0.65 alpha，
          列會直接從它底下透出來，看起來像有一行卡在搜尋框上面（實測踩過）。
          `bg-bg-tooltip`（0.97）是站上既有的「近乎不透明」層，浮窗與 sheet footer 同一個。 */}
      <div className="sticky -top-2.5 z-20 -mx-3 px-3 pt-2.5 pb-2 bg-bg-tooltip border-b border-border">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋名稱或種類…"
          className={`${HUD_INPUT} w-full px-2.5 py-1.5 text-[13px]`}
        />
      </div>

      {filters && filters.length > 0 && (
        <div className="hud-cut-sm border border-border-subtle bg-bg-card/70 px-2.5 py-2 space-y-1.5">
          {filters.map((g) => {
            // 空選項不畫（見 `available` 的說明）。只剩一個選項時整組也不畫 ——
            // 一顆「全部」加一顆唯一值，兩者永遠篩出同一份清單。
            const has = available.get(g.key)
            const opts = g.options.filter((o) => has?.has(o.value))
            if (opts.length <= 1) return null
            return (
              <div
                key={g.key}
                // 子篩選縮排並掛一條左框線：讓「這一排是上一排的細分」用版面說，
                // 不必再多一句說明文。父組沒選時這一整排根本不存在（`available` 給空集合），
                // 所以不會出現一條指向空氣的縮排。
                className={`flex flex-wrap items-center gap-1.5 ${
                  g.dependsOn ? 'ml-2 pl-2 border-l border-border-accent/50' : ''
                }`}
              >
                <span className={`${HUD.labelCjk} text-text-dim w-8 shrink-0`}>{g.label}</span>
                <FilterChip
                  label="全部"
                  active={!active[g.key]}
                  onClick={() => setChosen((c) => ({ ...c, [g.key]: '' }))}
                />
                {opts.map((o) => (
                  <FilterChip
                    key={o.value}
                    label={o.label}
                    tone={o.tone}
                    active={active[g.key] === o.value}
                    onClick={() => setChosen((c) => ({ ...c, [g.key]: active[g.key] === o.value ? '' : o.value }))}
                  />
                ))}
              </div>
            )
          })}
          <p className="text-[11px] text-text-dim text-right">
            符合 <span className={HUD.num}>{rows.length}</span> / {entries.length}
          </p>
        </div>
      )}

      {hint && (
        <p className="hud-cut-sm border border-accent-yellow/25 bg-accent-yellow/5 px-2.5 py-1.5 text-[11px] text-text-secondary leading-relaxed">
          {hint}
        </p>
      )}

      {/* 空清單有三種，意思完全不同：搜尋沒中 ／ 被篩選篩掉 ／ 真的沒有可裝的。
          第二種最需要講清楚 —— 品質預設是 SS，玩家可能根本沒察覺自己開著一個條件 */}
      {rows.length === 0 && (
        <p className="px-2.5 py-4 text-center text-[12px] text-text-dim leading-relaxed">
          {query
            ? `沒有符合「${query}」的項目。`
            : Object.values(active).some(Boolean)
              ? '目前的篩選條件沒有符合的項目 —— 把上方的篩選改回「全部」。'
              : '這一格沒有任何可裝的裝備。'}
        </p>
      )}

      {/* 頭像牆是網格、另外兩種是縱向堆疊；`auto-fill` 讓欄數跟著容器走，
          這一欄的寬度在 Phase D／F 還會再變一次 */}
      <div
        className={
          variant === 'pilotGrid'
            ? 'grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2'
            : 'space-y-1.5'
        }
      >
        {rows.map(({ entry, row }) => {
          // 解法一律取自 rejection 本身 —— UI 不自己組動作，否則會出現
          // 「按鈕寫卸下左肩、實際卸右肩」這種只有玩家看得到的錯
          const resolution = entry.rejection?.tier === 'situational' ? entry.rejection.resolution : null
          const common = {
            item: row,
            rejection: entry.rejection,
            replaceNote: entry.rejection ? undefined : replaceNote?.(entry.item),
            selected: selectedId === entry.item.id,
            onPick: () => onPick(entry.item),
            onResolve: resolution ? () => onResolve(resolution.action) : undefined,
            onHover: (hovering: boolean) => onHoverItem?.(hovering ? entry.item : null),
          }
          if (variant === 'pilotGrid') return <PilotAvatarCard key={row.id} {...common} />
          if (variant === 'mechCard') return <MechPickerCard key={row.id} {...common} />
          return (
            <RejectionRow
              key={row.id}
              {...common}
              remainingAfter={entry.rejection ? undefined : remainingAfter?.(entry.item)}
            />
          )
        })}
      </div>
    </div>
  )
}

function FilterChip({
  label, active, tone, onClick,
}: {
  label: string
  active: boolean
  tone?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`hud-cut-sm px-2 py-0.5 text-[11px] border transition-colors cursor-pointer ${
        active
          ? 'border-accent-orange bg-accent-orange/15 text-accent-orange font-bold'
          : `border-border bg-bg-dark hover:border-border-accent ${tone ?? 'text-text-secondary'}`
      }`}
    >
      {label}
    </button>
  )
}
