import { useMemo, useState } from 'react'
import type { Module } from '../../types'
import type { ModuleSlotRef } from '../../types/slots'
import { ModuleSlotBadge, ModuleRarityBadge } from '../badges/ModuleBadges'
import { ModuleStatTags } from '../module/ModuleStatTags'
import { imageCandidates } from '../../utils/assets'
import { FallbackImage } from '../common/FallbackImage'
import LoadoutIcon from '../icons/LoadoutIcon'
import { HUD, HUD_PANEL } from './loadoutTheme'
import { CATALOG_SLOTS, SLOT_LABELS, partLabel } from '../../utils/moduleSlots'
import {
  interfaceState, moduleStatsAt, moduleStacks, moduleFamilyKey, moduleAddLevel, moduleMaxLevel,
} from '../../utils/moduleRules'
import {
  moduleChoices, canEquipModule, REJECTION_LABEL, structuralCounts,
  type LoadoutContext, type PickerEntry, type Rejection, type ResolutionAction,
} from '../../utils/loadoutRules'
import type { ModuleStack } from '../../utils/moduleRules'

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
//   **不佔重量**（沒有預算列）、**沒有同族互斥**（唯一的情境拒絕是「這格已裝別顆」）。
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
  `hud-cut-sm px-2 py-0.5 text-[12px] border transition-colors cursor-pointer ${
    on ? 'border-accent-orange text-accent-orange bg-accent-orange/10'
       : 'border-border text-text-secondary hover:border-border-accent'
  }`

interface Props {
  ctx: LoadoutContext
  /** 這一個接口。命名帶底線是因為 `ref` 在 React 裡是保留字 */
  ref_: ModuleSlotRef
  onBack: () => void
  /** 裝上一顆。UI 不自己組 action —— 與 `onResolve` 同一條理由 */
  onEquip: (mod: Module) => void
  /** 卸下，以及拒絕訊息附的解法按鈕。動作由規則層給，UI 只負責派出去 */
  onResolve: (action: ResolutionAction) => void
}

export function ModulePanel({ ctx, ref_, onBack, onEquip, onResolve }: Props) {
  const [slot, setSlot] = useState('')
  const [rarity, setRarity] = useState('')
  const [query, setQuery] = useState('')
  const [showBlocked, setShowBlocked] = useState(false)

  // 空 Map ＝還沒載入完（見 LoadoutWorld.modules 的註解），不是「沒有模組」
  const loading = ctx.world.modules.size === 0

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
  const situational = available.filter((e) => e.rejection?.tier === 'situational')
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
          className="hud-cut-sm shrink-0 px-2 py-1 border border-border text-[12px] text-text-secondary hover:text-text-primary hover:border-border-accent transition-colors cursor-pointer"
        >
          ← 返回
        </button>
        <h2 className={`${HUD.cardTitle} text-text-primary min-w-0 truncate`}>
          {partLabel(ref_.position)} 的模組
        </h2>
      </div>

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
                <ModuleIcon mod={equipped} size={30} />
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
                <button
                  type="button"
                  onClick={() => onResolve({ type: 'unequipModule', ref: ref_ })}
                  className="hud-cut-sm shrink-0 px-2 py-1 border border-border text-[12px] text-text-secondary hover:text-accent-red hover:border-accent-red/50 transition-colors cursor-pointer"
                >
                  卸下
                </button>
              </div>
              {equippedStack && (
                <>
                  <ModuleStatTags
                    stats={moduleStatsAt(equippedStack.mod, equippedStack.level)}
                    variant="chip"
                    className="flex flex-wrap gap-1.5 mt-1.5 text-[12px]"
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
              className="hud-cut-sm w-full bg-bg-dark border border-border px-2.5 py-1.5 text-[12px] text-text-primary placeholder:text-text-dim focus:border-accent-orange/60 focus:outline-none"
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
              {[...fits, ...situational].map((e) => (
                <ModuleRow key={e.item.id} entry={e} stacks={stacks} onEquip={onEquip} onResolve={onResolve} />
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
                    <ModuleRow key={e.item.id} entry={e} stacks={stacks} onEquip={onEquip} onResolve={onResolve} />
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

/** 圖示載不到時留一個框，而不是把 <img> 藏起來 —— 後者會讓每一列高度不一致。 */
function ModuleIcon({ mod, size }: { mod: Module | null; size: number }) {
  const box = { width: size, height: size }
  if (!mod?.icon) {
    return <span className="shrink-0 hud-cut-sm bg-bg-dark border border-border-subtle" style={box} />
  }
  return (
    <span className="shrink-0" style={box}>
      <FallbackImage
        candidates={imageCandidates(mod.icon)}
        alt=""
        loading="lazy"
        className="w-full h-full object-contain"
        fallback={<span className="block w-full h-full hud-cut-sm bg-bg-dark border border-border-subtle" />}
      />
    </span>
  )
}

/**
 * 清單的一列。三種狀態沿用元件面板的語彙：
 *   可裝        → 正常可點
 *   situational → 灰掉 ＋ 原因 ＋ **解法按鈕**（模組這一層只有「這格已裝別顆」）
 *   structural  → 灰掉 ＋ 原因，**沒有**解法按鈕（改別的也解不掉）
 */
function ModuleRow({ entry, stacks, onEquip, onResolve }: {
  entry: PickerEntry<Module>
  stacks: ReadonlyMap<string, ModuleStack>
  onEquip: (mod: Module) => void
  onResolve: (action: ResolutionAction) => void
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

  return (
    <div
      className={`flex items-start border transition-colors ${
        blocked
          ? 'bg-bg-dark border-border-subtle opacity-60'
          : 'bg-bg-dark border-border hover:border-accent-orange/60 cursor-pointer'
      }`}
      style={{ gap: 9, padding: '7px 9px' }}
      onClick={blocked ? undefined : () => onEquip(mod)}
      role={blocked ? undefined : 'button'}
      tabIndex={blocked ? undefined : 0}
      onKeyDown={(e) => {
        if (!blocked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onEquip(mod) }
      }}
    >
      <ModuleIcon mod={mod} size={34} />
      <span className="flex flex-col min-w-0 grow" style={{ gap: 3 }}>
        <span className="flex items-center" style={{ gap: 6 }}>
          <span className={`${HUD.bodyStrong} text-text-primary truncate`}>{mod.name}</span>
          {/* 印「這一顆貢獻幾級」而不是「它最高幾階」：等級是堆出來的，
              而挑選的當下要回答的是「裝下去會前進多少」（PLAN-052-G C-7） */}
          <span className={`${HUD.num} text-[11px] text-text-dim shrink-0`}>＋{add} 級</span>
          <span className="shrink-0 ml-auto flex items-center" style={{ gap: 4 }}>
            <ModuleSlotBadge slot={mod.slot} />
            <ModuleRarityBadge rarity={mod.rarity} />
          </span>
        </span>

        {blocked ? (
          <RejectionLine rejection={rejection} onResolve={onResolve} />
        ) : (
          <>
            <span className={`${HUD.body} text-text-secondary`}>{summaryOf(mod)}</span>
            {stack && (
              <span className={`text-[11px] ${wouldWaste ? 'text-accent-yellow/90' : 'text-text-dim'}`}>
                {wouldWaste
                  ? `已裝 ${stack.positions.length} 顆同族、Lv${stack.level} / ${stack.cap} 已滿 —— 再裝一顆不會再提升`
                  : `已裝 ${stack.positions.length} 顆同族、Lv${stack.level} / ${stack.cap}，再裝這顆 → Lv${Math.min(stack.sum + add, cap)}`}
              </span>
            )}
          </>
        )}
      </span>
    </div>
  )
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
      <p className="mt-1.5 text-[11px] leading-relaxed text-accent-yellow/90">
        ⚠ 這一族已裝 <strong>{stack.positions.length}</strong> 顆，合計
        <strong> {stack.sum} </strong>級，但它只有 <strong>{stack.cap}</strong> 階 ——
        超出的 <strong>{stack.overflow}</strong> 級<strong>不會生效</strong>，
        那 {Math.ceil(stack.overflow / Math.max(1, stack.sum / stack.positions.length))} 格可以換別的模組。
      </p>
    )
  }
  if (stack.level >= stack.cap) {
    return (
      <p className="mt-1.5 text-[11px] leading-relaxed text-text-dim">
        這一族已達上限 Lv{stack.cap}，再多裝不會提升。
      </p>
    )
  }
  return (
    <p className="mt-1.5 text-[11px] leading-relaxed text-text-dim">
      再裝一顆同族可再 ＋{moduleAddLevel(stack.mod)} 級（上限 Lv{stack.cap}）。
    </p>
  )
}

/** 拒絕原因那一行。型別層已逼 `rejectSituational()` 填 resolution，這裡只負責畫出來。 */
function RejectionLine({ rejection, onResolve }: {
  rejection: Rejection
  onResolve: (action: ResolutionAction) => void
}) {
  const resolution = rejection.tier === 'situational' ? rejection.resolution : null
  return (
    <span className="flex flex-wrap items-center text-[12px] text-accent-red/85 leading-relaxed" style={{ gap: 5 }}>
      <LoadoutIcon name="absent" className="w-[13px] h-[13px] shrink-0" />
      {rejection.reason}
      {resolution && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onResolve(resolution.action) }}
          className="hud-cut-sm px-2 py-0.5 border border-accent-orange/50 text-[11px] text-accent-orange hover:bg-accent-orange/10 transition-colors cursor-pointer"
        >
          {resolution.label}
        </button>
      )}
    </span>
  )
}
