import { useMemo, useState } from 'react'
import type { Module } from '../../types'
import type { ModuleSlotRef } from '../../types/slots'
import { ModuleSlotBadge, ModuleRarityBadge } from '../badges/ModuleBadges'
import { ModuleStatTags } from '../module/ModuleStatTags'
import { ModuleIcon } from '../icons/ModuleIcon'
import LoadoutIcon from '../icons/LoadoutIcon'
import { HUD, HUD_ACTIONABLE, HUD_BTN, HUD_BTN_DANGER, HUD_INPUT, HUD_PANEL } from './loadoutTheme'
import { ActionChevron } from './ActionChevron'
import { CATALOG_SLOTS, SLOT_LABELS, partLabel } from '../../utils/moduleSlots'
import {
  interfaceState, moduleStatsAt, moduleStacks, moduleFamilyKey, moduleAddLevel, moduleMaxLevel,
} from '../../utils/moduleRules'
import {
  moduleChoices, canEquipModule, planModuleFill, REJECTION_LABEL, structuralCounts,
  type LoadoutContext, type ModuleFillPlan, type PickerEntry, type Rejection, type ResolutionAction,
} from '../../utils/loadoutRules'
import type { ModuleStack } from '../../utils/moduleRules'
import type { Mech } from '../../types'
import { PartSourceList } from './PartSourceList'

// ─── 模組面板（PLAN-052-G C-3）──────────────────────────────────────────────
//
// 右欄「情境欄」的第四種內容：從四部位卡鑽進來，配這一個接口的模組。
//
// ⚠ **加進既有的切換鏈，不疊第二層彈窗**（進度表 C-3）：右欄本來就是
//   「挑選器 ＞ 元件面板 ＞ 武器與元件列」的切換式情境欄（052-I D-3）。
//   手機版它是 BottomSheet，疊兩層等於把返回鍵埋掉。
//
// ⚠ **版面刻意照抄 `ComponentPanel`**：兩者是同一件事的兩個實例（從一格鑽進去、
//   配一個東西上去），玩家在其中一邊學會的操作應該原封不動適用於另一邊。
//   差異只有三處，而且都是資料造成的：模組**一格只有一顆**（沒有觸／應的容量帳）、
//   **不佔重量**（沒有預算列）、而且**一個情境拒絕都沒有**——
//   接口 gate 把裝不上的擋光了，列得出來的每一顆都直接可裝（C-9）。
//
// ⚠ **點一顆就換上去，不必先卸下**（使用者裁決 2026-08-27）：元件那邊的「卸下 X」
//   解的是容量帳（觸／應各 3、合計 4），而模組一格就是一顆，換上去就是換掉。
//   照抄的第一版讓「那一格裝了東西 ⇒ 整份清單灰掉」，兩步做一件事。
//   「已裝上」區塊仍留一顆卸下鍵 —— 那是「我要讓這一格空著」，與替換是兩件事。
//
// ⚠ **清單只列候選池的 186 筆**（見 `moduleChoices()`）：與元件面板「裝不上的也留在
//   清單裡」不同調 —— 那裡的拒絕是「這把武器」的限制，換一把就能裝，所以要看得見；
//   這裡被排除的那 55 筆是玩家倉庫裡根本沒有的東西（專屬／副模組／官方廢案）。
//
// ⚠ **三種不可裝的狀態各自寫清楚**，不共用一句話：留白或含糊會被讀成一個
//   我們並不知道的否定陳述 —— 那正是 2026-08-27 修掉的「B 品質接口資料未建檔」那句錯話。

/** 槽位分類晶片。候選池分佈：特性 74 ／ 8級 50 ／ 通用 62 */
const SLOT_FILTERS = [
  { key: '', label: '全部' },
  ...CATALOG_SLOTS.map((slot) => ({ key: slot as string, label: SLOT_LABELS[slot] ?? slot })),
]

/**
 * 品質晶片。候選池只有 S／A 兩級（S 144 ／ A 42）。
 * Ⅰ 型接口上 S 級全被擋，但晶片仍然留著 —— 它此時的用途是「只看我裝得上的那 42 顆」。
 */
const RARITIES = ['S', 'A'] as const

const chip = (on: boolean) =>
  `hud-cut-sm px-2 py-0.5 text-[13px] border transition-colors cursor-pointer ${
    on ? 'border-accent-orange text-accent-orange bg-accent-orange/10'
       : 'border-border text-text-secondary hover:border-border-accent'
  }`

/**
 * 清單列的縮圖尺寸（使用者要求 2026-08-28）。
 *
 * 使用者逐字：「右邊的 ICON 也可以大一點，使用者大多都是認 ICON」——
 * 這份清單一次要掃過上百筆，而玩家腦中的索引鍵是圖不是名字。
 *
 * ⚠ 34/30 是右欄裡**最小**的一組圖：武器挑選器是整片 `aspect-square` 的方塊、
 *   機甲是 78×52 的橫縮圖，只有這兩份清單停在 34。放大到 46/42 才是同一套語彙。
 * ⚠ 代價是名稱欄少 12px（列寬約 391，文字欄 330 → 318）。名稱本來就 `truncate`，
 *   而這一列真正不能犧牲的是名字 —— 再往上加就要先把徽章那組收窄。
 */
const ROW_ICON = 46
/** 「已裝上」那一列：右側多一顆卸下鍵，比候選列小一階 */
const MOUNTED_ICON = 42

interface Props {
  ctx: LoadoutContext
  /** 這一個接口。命名帶底線是因為 `ref` 在 React 裡是保留字 */
  ref_: ModuleSlotRef
  onBack: () => void
  /** 裝上一顆。UI 不自己組 action —— 與 `onResolve` 同一條理由 */
  onEquip: (mod: Module) => void
  /**
   * 一鍵裝滿（使用者要求 2026-08-27）：把這顆裝到這一族滿級為止。
   *
   * ⚠ 動幾格由 `planModuleFill()` 算，這裡只負責派出去。按鈕上的字也取自同一份計畫 ——
   *   「裝滿 4 格」印出來卻只裝 2 格，是這個功能最容易長出來的謊。
   */
  onFill: (mod: Module) => void
  /** 卸下，以及拒絕訊息附的解法按鈕。動作由規則層給，UI 只負責派出去 */
  onResolve: (action: ResolutionAction) => void
  /**
   * 把這一個部位換成 `source` 的同位部件（PLAN-052-G Phase D）。
   * 傳入基底機甲＝還原成原廠 —— reducer 會把那個鍵收掉（見 `swapPart` 的註解）。
   */
  onSwapPart: (source: Mech) => void
}

export function ModulePanel({ ctx, ref_, onBack, onEquip, onFill, onResolve, onSwapPart }: Props) {
  /**
   * 這個面板回答一個部位的**兩個**問題：「裝了什麼模組」與「這一格是誰的」（Phase D）。
   *
   * ⚠ 兩者收在同一個面板、共用同一顆返回鍵（使用者裁決 2026-08-28）。
   *   另一個做法是在部位卡上多一顆按鈕，但那會讓同一張卡有兩個點擊目標 ——
   *   而那張卡本來就已經是「整張可點」。
   *
   * ⚠ 切段**不重置模組那一段的篩選條件**：`slot`／`rarity`／`query` 的 state 留著。
   *   來回看一下部件再切回來，篩選被清空是「我剛剛打的字呢」那一種挫折。
   */
  const [tab, setTab] = useState<'module' | 'part'>('module')
  const [slot, setSlot] = useState('')
  const [rarity, setRarity] = useState('')
  const [query, setQuery] = useState('')
  const [showBlocked, setShowBlocked] = useState(false)

  // 空 Map ＝還沒載入完（見 LoadoutWorld.modules 的註解），不是「沒有模組」
  const loading = ctx.world.modules.size === 0

  /** 這一格換過部件沒有（★ 記號的判準）。`sourceMechId` 與基底不同就是換過 */
  const swapped = !!ctx.chassis && !!ctx.mech
    && ctx.chassis.parts[ref_.position].sourceMechId !== ctx.mech.id

  const iface = interfaceState(ctx.chassis?.moduleSlots[ref_.position]?.iface)
  const equippedId = ctx.modules[ref_.position]
  const equipped = equippedId ? ctx.world.modules.get(equippedId) ?? null : null

  const entries = useMemo(() => moduleChoices(ctx, ref_), [ctx, ref_])

  /**
   * 四個接口的同族堆疊（PLAN-052-G C-7）。**一格一格看是看不出超限的** ——
   * 「四顆刀劍模組Ⅱ 合計 8 級但上限 4」這件事只有把四格一起算才講得出來。
   */
  const stacks = useMemo(
    () => moduleStacks(ctx.modules, (id) => ctx.world.modules.get(id)),
    [ctx.modules, ctx.world.modules],
  )
  const equippedStack = equipped ? stacks.get(moduleFamilyKey(equipped)) ?? null : null
  /**
   * 已裝那一顆的「補滿」計畫（`null` ＝ 這一格是空的）。已滿級時 `FillButton` 自己不畫。
   *
   * ⚠ **刻意不包 `useMemo`**：包了會被 React Compiler 判成
   *   「Existing memoization could not be preserved」而**整個元件放棄最佳化** ——
   *   為了省一次四格的迴圈，賠掉整支面板的自動記憶化。編譯器自己會處理這一行。
   */
  const equippedFill = equipped ? planModuleFill(ctx, equipped) : null

  /**
   * ⚠ 搜尋比對**名稱 ＋ 滿階效果敘述**，不是只比名稱：玩家記得的通常是
   *   「暴擊」「出力」這類效果字眼，而不是「校準模組Ⅱ」這個型號式的名字。
   */
  const available = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      const m = e.item
      if (m.id === equippedId) return false          // 已裝的另有專區
      if (slot && m.slot !== slot) return false
      if (rarity && m.rarity !== rarity) return false
      if (!q) return true
      return `${m.name} ${summaryOf(m)}`.toLowerCase().includes(q)
    })
  }, [entries, equippedId, slot, rarity, query])

  /** 篩到零筆時要說得出是哪一種零：條件太窄，還是這個接口真的沒得裝 */
  const filtered = !!slot || !!rarity || !!query.trim()
  const fits = available.filter((e) => e.rejection === null)
  // situational 這一階**模組沒有**（C-9），所以清單只有「可裝」與「摺疊的結構性拒絕」兩段
  const structural = available.filter((e) => e.rejection?.tier === 'structural')
  const counts = structuralCounts(available)

  /**
   * 這一格為什麼整個不能用。`blocked` 的拒絕**不列清單而是降級說明** ——
   * 給一個空清單等於讓玩家自己猜是站上缺資料、還是他這台機甲不行。
   *
   * 拿池裡任一顆去問即可：blocked 的兩條（沒有接口／接口型別不明）都只看接口，
   * 與是哪一顆模組無關。
   */
  const blocked = useMemo(() => {
    if (loading || !ctx.chassis) return null
    const probe = entries[0]?.item ?? ctx.world.modules.values().next().value
    if (!probe) return null
    const r = canEquipModule(ctx, probe, ref_)
    return r?.tier === 'blocked' ? r.reason : null
  }, [loading, ctx, ref_, entries])

  return (
    <section className={`${HUD_PANEL} p-3.5`}>
      <div className="flex items-center" style={{ gap: 8 }}>
        <button
          type="button"
          onClick={onBack}
          className={`${HUD_BTN} shrink-0 px-2 py-1 text-[13px]`}
        >
          ← 返回
        </button>
        <h2 className={`${HUD.cardTitle} text-text-primary min-w-0 truncate`}>
          {partLabel(ref_.position)}
        </h2>
      </div>

      {/* ── 分段：一個部位的兩個問題 ──
          「裝了什麼模組」與「這一格是誰的」。

          ⚠ **第一版做成兩顆小晶片，使用者實測看不出來可以選**（2026-08-28，逐字：
            「按鈕跟之前一樣的問題，不太顯眼，沒仔細看，看不出來可以選」）。
            成因很具體：那兩顆與下方的篩選晶片**同尺寸、同形狀、同一組顏色**，
            於是被讀成「又一組篩選標籤」而不是「兩個模式擇一」——
            而且未選中那顆用 `text-text-dim`，看起來像停用。
            這是 052-F 分頁列那次的同一種病：元件本身沒錯，錯在它長得像旁邊那些不是它的東西。

          ⚠ 改法**不是把它變大就好**，而是給它一個「軌道」：
            外面一層底色框、兩顆各佔一半寬、選中那顆整塊填色 ——
            一個框裡兩個等寬的東西、其中一個被填滿，是「二擇一」最短的視覺說法。
            未選中那顆改用 `text-text-secondary`（不是 dim）並保留 hover，讓它看起來按得下去。

          ⚠ 兩顆**永遠都在**：只在混搭可用時才長出第二顆，會讓玩家在不同機甲上
            看到不一樣的面板骨架。 */}
      <div
        role="tablist"
        aria-label={`${partLabel(ref_.position)}要設定什麼`}
        className="grid grid-cols-2 mt-2 p-0.5 bg-bg-dark border border-border"
        style={{ gap: 2 }}
      >
        {([['module', '模組'], ['part', '部件來源']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-2 py-1.5 text-[14px] leading-tight transition-colors cursor-pointer ${
              tab === key
                ? 'bg-accent-orange/20 text-accent-orange font-bold'
                : 'text-text-secondary hover:bg-bg-card hover:text-text-primary'
            }`}
          >
            {label}
            {/* 換過的那一格在分段上就看得出來，不必切進去才知道（同 052-F 的形態標籤） */}
            {key === 'part' && swapped && <span className="ml-1 text-accent-orange">◆</span>}
          </button>
        ))}
      </div>

      {tab === 'part' ? (
        <PartSourceList ctx={ctx} position={ref_.position} onSwap={onSwapPart} />
      ) : (<>
      <p className={`${HUD.body} text-text-dim mt-1.5`}>
        {iface === 'none' ? '無模組接口'
          : iface === 'unknown' ? '接口型別不明'
          : <>{iface} · 一格一顆 · 不佔出力</>}
      </p>

      {blocked ? (
        <p className={`${HUD.body} text-text-dim mt-2.5 border-t border-border pt-2.5`}>{blocked}</p>
      ) : (
        <>
          {/* ── 已裝上：卸下的唯一入口 ── */}
          {equippedId && (
            <div className="mt-2.5 border-t border-border pt-2.5">
              <div className={`${HUD.labelCjk} text-text-dim mb-1.5`}>已裝上</div>
              <div
                className="flex items-center bg-bg-dark border border-accent-orange/30"
                style={{ gap: 9, padding: '7px 9px' }}
              >
                <ModuleIcon mod={equipped} size={MOUNTED_ICON} />
                <span className="flex flex-col min-w-0 grow" style={{ gap: 2 }}>
                  <span className={`${HUD.bodyStrong} text-text-primary truncate`}>
                    {/* 查無 ＝ 資料斷鏈，要看得見而不是靜默留白（同元件面板的 fallback） */}
                    {equipped?.name ?? equippedId}
                  </span>
                  <span className={`${HUD.body} text-text-dim truncate`}>
                    {equipped
                      ? equippedStack
                        ? `Lv${equippedStack.level} / ${equippedStack.cap} · ${summaryOf(equipped)}`
                        : summaryOf(equipped)
                      : '模組資料已不存在'}
                  </span>
                </span>
                {/* 補滿：裝了一顆看到「Lv1 / 4」的當下，正是想把它疊起來的時刻 ——
                    這顆鍵放在那行字旁邊，比放回清單裡更接近使用情境 */}
                <FillButton plan={equippedFill} onFill={onFill} />
                <button
                  type="button"
                  onClick={() => onResolve({ type: 'unequipModule', ref: ref_ })}
                  className={`${HUD_BTN_DANGER} shrink-0 px-2 py-1 text-[13px]`}
                >
                  卸下
                </button>
              </div>
              {equippedStack && (
                <>
                  <ModuleStatTags
                    stats={moduleStatsAt(equippedStack.mod, equippedStack.level)}
                    variant="chip"
                    className="flex flex-wrap gap-1.5 mt-1.5 text-[13px]"
                  />
                  <StackNote stack={equippedStack} />
                </>
              )}
            </div>
          )}

          {/* ── 可裝清單 ── */}
          <div className="mt-2.5 border-t border-border pt-2.5">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋名稱或效果（暴擊、出力、命中…）"
              className={`${HUD_INPUT} w-full px-2.5 py-1.5 text-[13px]`}
            />

            <div className="flex flex-wrap items-center mt-2" style={{ gap: 6 }}>
              {SLOT_FILTERS.map((f) => (
                <button key={f.key} type="button" onClick={() => setSlot(f.key)} className={chip(slot === f.key)}>
                  {f.label}
                </button>
              ))}
              <span className={`${HUD.body} text-text-dim ml-auto`}>
                {loading ? '載入模組中…' : <>可裝 <span className={HUD.num}>{fits.length}</span> / {available.length} 顆</>}
              </span>
            </div>

            <div className="flex flex-wrap items-center mt-1.5" style={{ gap: 6 }}>
              {RARITIES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRarity((v) => (v === r ? '' : r))}
                  className={chip(rarity === r)}
                >
                  {r}
                </button>
              ))}
              {filtered && (
                <button
                  type="button"
                  onClick={() => { setSlot(''); setRarity(''); setQuery('') }}
                  className="ml-auto text-[11px] text-text-dim hover:text-text-secondary underline underline-offset-2 cursor-pointer"
                >
                  清除條件
                </button>
              )}
            </div>

            {/* ⚠ 186 筆全列出來會讓右欄長到需要捲三個螢幕。清單自己捲（沿用元件面板的
                `max-h + overflow-y-auto`），而**不是**只列前 N 筆 —— 截斷會讓
                「我的模組呢」變成一個站上自己製造的問題。 */}
            <div className="flex flex-col mt-2 max-h-[52vh] overflow-y-auto pr-0.5" style={{ gap: 6 }}>
              {fits.map((e) => (
                <ModuleRow key={e.item.id} entry={e} ctx={ctx} stacks={stacks} onEquip={onEquip} onFill={onFill} />
              ))}

              {/* 結構性拒絕：摺疊成一行計數，可展開。展開後照樣寫出每一筆的原因 */}
              {structural.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowBlocked((v) => !v)}
                    className="w-full text-left hud-cut-sm border border-border-subtle bg-bg-dark/40 px-2.5 py-1.5 text-[12px] text-text-dim hover:text-text-secondary hover:border-border transition-colors cursor-pointer"
                  >
                    {showBlocked ? '▾' : '▸'} 這個接口裝不了的 {structural.length} 顆
                    {counts.length > 0 && (
                      <span className="text-text-dim">
                        {' '}（{counts.map(([code, n]) => `${REJECTION_LABEL[code]} ${n}`).join('・')}）
                      </span>
                    )}
                  </button>
                  {showBlocked && structural.map((e) => (
                    <ModuleRow key={e.item.id} entry={e} ctx={ctx} stacks={stacks} onEquip={onEquip} onFill={onFill} />
                  ))}
                </>
              )}

              {!loading && available.length === 0 && (
                <p className={`${HUD.body} text-text-dim`}>
                  {filtered ? '沒有符合條件的模組 —— 按上面的「清除條件」看全部。'
                    : equippedId ? '這個接口能裝的模組都在上面了。'
                    : '目前沒有可裝的模組。'}
                </p>
              )}
            </div>
          </div>
        </>
      )}
      </>)}
    </section>
  )
}

/**
 * 一行效果摘要（進度表 C-3 第三列）。
 *
 * **直接用滿階的 `description`，不自己組字串** —— 候選池 186 筆全都有（實測），
 * 而自己從數值欄位組出來的句子必然與官方用語漂移。
 *
 * 這一列原本是為了消模組同名的歧義；排除 `mod_2030` 之後池內已無同名（決策九），
 * 它現在純粹是可讀性工項 —— 只看「校準模組Ⅰ／Ⅱ」這種名字，玩家分不出差別。
 */
function summaryOf(mod: Module): string {
  const last = mod.levels?.[mod.levels.length - 1]
  return last?.description ?? mod.description ?? ''
}

/**
 * 清單的一列。**只有兩種狀態**（C-9 之後）：
 *   可裝       → 正常可點，點下去就裝上（那一格有東西的話就換掉它）
 *   structural → 灰掉 ＋ 原因，**沒有解法按鈕**（改別的也解不掉）
 *
 * ⚠ 沒有第三種：模組這一層一個 situational 拒絕都不剩，所以本列**不接** `onResolve` ——
 *   留一條永遠走不到的解法分支，下一個人會照它寫 UI。
 */
function ModuleRow({ entry, ctx, stacks, onEquip, onFill }: {
  entry: PickerEntry<Module>
  ctx: LoadoutContext
  stacks: ReadonlyMap<string, ModuleStack>
  onEquip: (mod: Module) => void
  onFill: (mod: Module) => void
}) {
  const { item: mod, rejection } = entry
  const blocked = rejection !== null
  const add = moduleAddLevel(mod)
  const cap = moduleMaxLevel(mod)
  /**
   * 這一族已經堆到哪了。**挑選的當下才是提醒的時機** ——
   * 等玩家裝完第四顆再說「其實兩顆就滿了」，那兩格已經被他花掉了。
   */
  const stack = stacks.get(moduleFamilyKey(mod)) ?? null
  const wouldWaste = stack !== null && stack.sum >= cap

  /**
   * 一鍵裝滿的計畫。**在這裡算而不是塞進按鈕裡**：footer 那一行要不要存在，
   * 取決於「有沒有堆疊現況」與「按鈕會不會出現」兩件事，而後者只有計畫答得出來。
   * 兩者都沒有卻畫一個空的 flex 行，會在每一列多出一道 gap。
   *
   * ⚠ `multiOnly` 的判準在這裡：清單列上只在**會動兩格以上**時才給按鈕 ——
   *   一格的話它與「點這一列」是同一件事，多一顆鍵只是把每一列變擠。
   */
  const fill = useMemo(() => {
    if (blocked) return null
    const plan = planModuleFill(ctx, mod)
    return plan.noop || plan.targets.length < 2 ? null : plan
  }, [blocked, ctx, mod])

  return (
    <div
      // `group` 讓 `ActionChevron` 的 hover 變色跟著整列走
      className={`group flex items-start border ${
        blocked ? 'bg-bg-dark border-border-subtle opacity-60' : HUD_ACTIONABLE
      }`}
      style={{ gap: 9, padding: '7px 9px' }}
      onClick={blocked ? undefined : () => onEquip(mod)}
      role={blocked ? undefined : 'button'}
      tabIndex={blocked ? undefined : 0}
      onKeyDown={(e) => {
        if (!blocked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onEquip(mod) }
      }}
    >
      <ModuleIcon mod={mod} size={ROW_ICON} />
      <span className="flex flex-col min-w-0 grow" style={{ gap: 3 }}>
        {/* ⚠ 第一行**只放名字與徽章**，一鍵裝滿那顆鍵不進來（2026-08-27 實測回報）：
            這一欄只有約 318px（縮圖放大到 46 之後，見 `ROW_ICON`），而那顆鍵最寬要 110px。它與兩顆 `shrink-0` 的徽章並排時，
            唯一還能縮的就是名字 —— 於是整份清單的模組名被 `truncate` 壓成一個字
            （「人 ·」「日 ·」「加 ·」）。名字是這份清單唯一不能犧牲的東西，
            按鈕改掛到最後一行的右端（見下方 footer）。 */}
        <span className="flex items-center" style={{ gap: 6 }}>
          <span className={`${HUD.bodyStrong} text-text-primary truncate`}>{mod.name}</span>
          {/* 印「這一顆貢獻幾級」而不是「它最高幾階」：等級是堆出來的，
              而挑選的當下要回答的是「裝下去會前進多少」（PLAN-052-G C-7） */}
          <span className={`${HUD.num} text-[12px] text-text-dim shrink-0`}>＋{add} 級</span>
          <span className="shrink-0 ml-auto flex items-center" style={{ gap: 4 }}>
            <ModuleSlotBadge slot={mod.slot} />
            <ModuleRarityBadge rarity={mod.rarity} />
            {/* 「這一列點得下去」的靜態記號；裝不上的那些沒有 */}
            {!blocked && <ActionChevron className="ml-0.5" />}
          </span>
        </span>

        {blocked ? (
          <RejectionLine rejection={rejection} />
        ) : (
          <>
            <span className={`${HUD.body} text-text-secondary`}>{summaryOf(mod)}</span>
            {/* footer：堆疊現況（左）＋ 一鍵裝滿（右）。兩者講的是同一件事的兩半 ——
                「現在幾級」與「一次補到幾級」，擺在同一行才對得起來。
                ⚠ 堆疊那句用 `min-w-0` 讓它自己被截斷，按鈕 `shrink-0`：
                  這一行沒有名字要保護，該讓的是說明文。 */}
            {(stack || fill) && (
              <span className="flex items-end" style={{ gap: 6 }}>
                {stack && (
                  <span className={`text-[12px] min-w-0 ${wouldWaste ? 'text-accent-yellow/90' : 'text-text-dim'}`}>
                    {wouldWaste
                      ? `已裝 ${stack.positions.length} 顆同族、Lv${stack.level} / ${stack.cap} 已滿 —— 再裝一顆不會再提升`
                      : `已裝 ${stack.positions.length} 顆同族、Lv${stack.level} / ${stack.cap}，再裝這顆 → Lv${Math.min(stack.sum + add, cap)}`}
                  </span>
                )}
                <span className="ml-auto shrink-0"><FillButton plan={fill} onFill={onFill} /></span>
              </span>
            )}
          </>
        )}
      </span>
    </div>
  )
}

/**
 * 一鍵裝滿（使用者要求 2026-08-27）。
 *
 * ⚠ **按鈕上的字是計畫算出來的，不是寫死的「四顆」**：同一顆按鈕在不同情況下
 *   要說不同的話，因為它真的會做不同的事 ——
 *
 *     通用 A 級（＋1／顆，上限 4）在 S 級機甲上 → 「裝滿 4 格」
 *     通用 S 級（＋2／顆，上限 4）             → 「裝滿 2 格」（塞四格是白費兩格）
 *     S 級模組在 A 級機甲上                     → 「裝滿 2 格」（軀幹與腿是 Ⅰ型接口，裝不上）
 *     已經滿級／沒有格可動                       → **整顆不畫**
 *
 *   寫死「四顆」的版本在後三種情況都會跳票，而跳票的方式是靜默的：按了、動了幾格、
 *   數字沒到玩家以為的位置。
 *
 * ⚠ **不自己算計畫**：呼叫端要靠同一份計畫決定整行要不要畫（見 `ModuleRow` 的 `fill`），
 *   兩邊各算一次就會出現「行畫了但按鈕沒出現」這種空行。`plan` 為 null ＝ 不畫。
 *
 * ── 為什麼是**實心**（使用者回饋 2026-08-27：「容易跟標籤搞混」）─────────────
 * 第一版用的是 `border-accent-orange/50 ＋ bg-accent-orange/10 ＋ text-accent-orange`
 * —— 那正是本站**徽章**的配方（`ModuleSlotBadge` / `ModuleRarityBadge` 是
 * `rounded border ＋ 同色淡底`）。同一列裡它與「特性模組」「S」並排，三者
 * 顏色不同但形狀與明度階完全一樣，於是它讀起來像第三顆標籤而不是一顆鍵。
 *
 * 差異化**不靠再加一個顏色**（052-I 決策一：一個新顏色都不加），靠三件既有語彙：
 *   ① **實心底 ＋ 深色字** —— 這一列裡唯一的實心色塊。徽章一律是淡底，
 *      整份清單掃過去，實心的那一塊自己會跳出來。
 *   ② **一顆 ＋ 圖示** —— 標籤不會有圖示。這是「這是動作」最短的一句話。
 *   ③ **hover 會變** —— 徽章不動，鍵會亮。滑到才發現的差異救不了第一眼，
 *      但它確認了第一眼的猜測。
 */
function FillButton({ plan, onFill }: {
  /** `planModuleFill()` 的結果。**由呼叫端算**——它同時要靠這份計畫決定整行要不要畫 */
  plan: ModuleFillPlan | null
  onFill: (mod: Module) => void
}) {
  if (!plan || plan.noop) return null

  const n = plan.targets.length
  const label = plan.levelBefore > 0 ? `再補 ${n} 格` : `裝滿 ${n} 格`

  return (
    <button
      type="button"
      // ⚠ 這顆鍵住在**整列可點**的容器裡（點列＝裝這一格），不擋下事件的話
      //   會同時觸發兩個動作，而其中一個是玩家沒要的
      onClick={(e) => { e.stopPropagation(); onFill(plan.mod) }}
      title={fillTitle(plan)}
      className="hud-cut-sm shrink-0 inline-flex items-center gap-1 px-2 py-[3px] text-[11px] font-bold
        bg-accent-orange text-bg-dark hover:bg-accent-yellow
        shadow-[0_1px_6px_rgba(255,107,43,0.35)] transition-colors cursor-pointer"
    >
      <LoadoutIcon name="plus" className="w-3 h-3 shrink-0" strokeWidth={3} />
      {label} → Lv{plan.levelAfter}
    </button>
  )
}

/** 按鈕的 `title`：把「會動哪幾格、會換掉誰、為什麼只有這幾格」一次講完。 */
function fillTitle(plan: ModuleFillPlan): string {
  const parts = [`裝到 ${plan.targets.map(partLabel).join('、')}，Lv${plan.levelBefore} → Lv${plan.levelAfter}/${plan.cap}`]
  if (plan.displaced.length > 0) {
    parts.push(`會換掉：${plan.displaced.map((d) => partLabel(d.position)).join('、')}（可復原）`)
  }
  if (plan.levelAfter < plan.cap) {
    // 沒補滿要說出是哪一種沒補滿：接口不收，還是格數本來就不夠（8 級模組）
    parts.push(plan.blockedSlots > 0
      ? `有 ${plan.blockedSlots} 格的接口裝不下這顆，所以只到 Lv${plan.levelAfter}`
      : `四個接口全滿也只到 Lv${plan.levelAfter}，其餘由機甲自帶的那顆補`)
  }
  return parts.join('\n')
}

/**
 * 超限提醒（使用者裁決 2026-08-27）。
 *
 * ⚠ **提醒而不是擋**：裝四顆同族是合法操作，只是其中兩顆白費 —— 那是玩家的選擇，
 *   不是非法配置。擋下來會讓「我就想這樣擺」變成一個做不到的事；不說則會讓他
 *   以為自己疊出了 8 級。
 */
function StackNote({ stack }: { stack: ModuleStack }) {
  if (stack.overflow > 0) {
    return (
      <p className="mt-1.5 text-[12px] leading-relaxed text-accent-yellow/90">
        ⚠ 這一族已裝 <strong>{stack.positions.length}</strong> 顆，合計
        <strong> {stack.sum} </strong>級，但它只有 <strong>{stack.cap}</strong> 階 ——
        超出的 <strong>{stack.overflow}</strong> 級<strong>不會生效</strong>，
        那 {Math.ceil(stack.overflow / Math.max(1, stack.sum / stack.positions.length))} 格可以換別的模組。
      </p>
    )
  }
  if (stack.level >= stack.cap) {
    return (
      <p className="mt-1.5 text-[12px] leading-relaxed text-text-dim">
        這一族已達上限 Lv{stack.cap}，再多裝不會提升。
      </p>
    )
  }
  return (
    <p className="mt-1.5 text-[12px] leading-relaxed text-text-dim">
      再裝一顆同族可再 ＋{moduleAddLevel(stack.mod)} 級（上限 Lv{stack.cap}）。
    </p>
  )
}

/**
 * 拒絕原因那一行。**不畫解法按鈕** —— 模組只剩 structural／blocked 兩種拒絕（C-9），
 * 而 structural 的定義就是「改別的也解不掉」，給它一顆按鈕等於承諾一個做不到的動作。
 */
function RejectionLine({ rejection }: { rejection: Rejection }) {
  return (
    <span className="flex flex-wrap items-center text-[13px] text-accent-red/85 leading-relaxed" style={{ gap: 5 }}>
      <LoadoutIcon name="absent" className="w-[13px] h-[13px] shrink-0" />
      {rejection.reason}
    </span>
  )
}
