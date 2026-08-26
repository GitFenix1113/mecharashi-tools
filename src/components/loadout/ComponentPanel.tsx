import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Component } from '../../types'
import { ComponentIcon } from '../icons/ComponentIcon'
import { ComponentTypeBadge, RarityBadge } from '../badges/ComponentBadges'
import LoadoutIcon from '../icons/LoadoutIcon'
import { HUD, HUD_PANEL } from './loadoutTheme'
import type { WeaponRow } from '../../utils/loadoutRows'
import {
  componentChoices, mountedComponentIds, weaponSiteAt,
  REJECTION_LABEL, structuralCounts,
  type LoadoutContext, type PickerEntry, type Rejection, type ResolutionAction,
} from '../../utils/loadoutRules'

// ─── 元件面板（PLAN-052-I D-3 版面 ／ PLAN-052-D Phase C 行為）────────────────
//
// 右欄「情境欄」的第三種內容：從武器列鑽進來，配這一把武器的元件。
//
// ⚠ **版面沿用 052-I 已核可的那一份，本階段只把唯讀換成可操作**（總綱指定）。
//   抬頭那條「元件功能建置中」的告示已隨規則引擎落地而移除 —— 它從來不是佔位文案，
//   是規則不存在時唯一誠實的呈現方式。
//
// ⚠ **裝不上的元件留在清單裡並寫出原因，不直接濾掉**（設計畫布 ComponentPanel）：
//   「我的元件呢」比多幾列雜訊更難處理 —— 玩家找不到一個他知道存在的東西時，
//   會以為是站上缺資料，而不會想到是自己這把武器不相容。
//
// ⚠ 但 `structural` 走**摺疊 ＋ 計數 ＋ 可展開**，這一點與武器挑選器**刻意不同**
//   （PickerShell 在 052-I 驗收後改成一律不列）。差別來自數量與可行動性：
//   單手武器上 208 筆裡有 80 筆 W 型 ＋ 少數種類限定共約 4 成是結構性拒絕，
//   全部攤開會把清單長度變成兩倍多，而那些列玩家一個字都改不了；
//   摺疊成「僅雙手／背部 80」這一行，則同時回答了「我的元件呢」與「它們為什麼不在」。
//
// ⚠ `components` 集合（208 筆）自 052-D A-3 起由 **`equip` 階段載入**，本面板吃
//   `ctx.world.components`。規則層與 `reconcile()` 都要認得元件，不可能等面板掛載才有資料。

type Filter = 'all' | 'Condition' | 'Function'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'Condition', label: '觸元件' },
  { key: 'Function', label: '應元件' },
]

interface Props {
  ctx: LoadoutContext
  row: WeaponRow
  onBack: () => void
  /** 裝上一顆。UI 不自己組 action —— 與 `onResolve` 同一條理由 */
  onEquip: (comp: Component) => void
  /** 卸下一顆，以及拒絕訊息附的解法按鈕。動作由規則層給，UI 只負責派出去 */
  onResolve: (action: ResolutionAction) => void
}

export function ComponentPanel({ ctx, row, onBack, onEquip, onResolve }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [showBlocked, setShowBlocked] = useState(false)

  const weapon = row.weapon
  // 空 Map ＝還沒載入完（見 LoadoutWorld.components 的註解），不是「沒有元件」
  const loading = ctx.world.components.size === 0

  /** 這一把上已經裝了什麼。清單與計數都由它出，不另外數一次 */
  const mounted = useMemo(() => {
    const site = weaponSiteAt(ctx, row.ref)
    const { trigger, effect } = mountedComponentIds(site)
    const look = (id: string) => ctx.world.components.get(id) ?? null
    return {
      trigger: trigger.map((id) => ({ id, comp: look(id) })),
      effect: effect.map((id) => ({ id, comp: look(id) })),
    }
  }, [ctx, row.ref])

  const usedTrigger = mounted.trigger.length
  const usedEffect = mounted.effect.length
  const used = usedTrigger + usedEffect

  const entries = useMemo(() => componentChoices(ctx, row.ref), [ctx, row.ref])
  const mountedIds = useMemo(
    () => new Set([...mounted.trigger, ...mounted.effect].map((x) => x.id)),
    [mounted],
  )

  /** 尚未裝上的那些（已裝的另有專區，留在清單裡只會讓「可裝 n」這個數字說不清） */
  const available = useMemo(
    () => entries.filter((e) => !mountedIds.has(e.item.id) && (filter === 'all' || e.item.componentType === filter)),
    [entries, mountedIds, filter],
  )

  const fits = available.filter((e) => e.rejection === null)
  const situational = available.filter((e) => e.rejection?.tier === 'situational')
  const structural = available.filter((e) => e.rejection?.tier === 'structural')
  const counts = structuralCounts(available)

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
        <h2 className={`${HUD.cardTitle} text-text-primary min-w-0 truncate`}>{row.name}</h2>
        {weapon && <span className="shrink-0"><RarityBadge rarity={weapon.rarity} /></span>}
      </div>

      <p className={`${HUD.body} text-text-dim mt-1.5`}>
        {row.label}
        {weapon && <> · {weapon.type} · {weapon.kind}</>}
        {weapon && (
          <>
            {' · '}
            <Link to={`/weapons/${weapon.id}`} className="text-accent-orange no-underline">武器詳情</Link>
          </>
        )}
      </p>

      {/* 槽位呈現：觸／應各自的格數只是上限，真正的牆是 componentLimit（總數） */}
      <div className="grid grid-cols-3 mt-2.5" style={{ gap: 8 }}>
        <SlotStat label="觸元件" hint="什麼時候生效" value={`${usedTrigger} / ${weapon?.triggerSlots ?? 0}`} />
        <SlotStat label="應元件" hint="生效之後做什麼" value={`${usedEffect} / ${weapon?.effectSlots ?? 0}`} />
        <SlotStat label="合計上限" hint="真正的牆" value={`${used} / ${row.limit}`} accent />
      </div>

      <p className={`${HUD.body} text-text-dim mt-2`}>
        觸 ＋ 應 <strong className="text-text-secondary">合計不得超過 {row.limit}</strong>
        （SS／S+ 為 4、S 為 3、其餘不可裝）。兩種各自的格數只是上限，總數才是真正的牆。
      </p>

      {row.limit === 0 ? (
        <p className={`${HUD.body} text-text-dim mt-2.5 border-t border-border pt-2.5`}>
          這把武器<strong className="text-text-secondary">不可裝元件</strong>
          {row.locked === 'fixed' ? '（機甲固定武裝）' : row.locked === 'form' ? '（形態鎖定的武裝）' : ''}。
        </p>
      ) : (
        <>
          {/* ── 已裝上：卸下的唯一入口 ── */}
          {used > 0 && (
            <div className="mt-2.5 border-t border-border pt-2.5">
              <div className={`${HUD.labelCjk} text-text-dim mb-1.5`}>已裝上</div>
              <div className="flex flex-col" style={{ gap: 6 }}>
                {[...mounted.trigger, ...mounted.effect].map(({ id, comp }) => (
                  <div
                    key={id}
                    className="flex items-center bg-bg-dark border border-accent-orange/30"
                    style={{ gap: 9, padding: '7px 9px' }}
                  >
                    <span className="shrink-0">
                      {comp ? <ComponentIcon comp={comp} size={30} /> : <LoadoutIcon name="absent" className="w-[30px] h-[30px] text-accent-red/70" />}
                    </span>
                    <span className="flex flex-col min-w-0 grow" style={{ gap: 2 }}>
                      <span className={`${HUD.bodyStrong} text-text-primary truncate`}>
                        {/* 查無 ＝ 資料斷鏈，要看得見而不是靜默留白（同 weaponRows 的 fallback） */}
                        {comp?.name ?? id}
                      </span>
                      <span className={`${HUD.body} text-text-dim truncate`}>
                        {comp ? <>Lv{comp.probabilityLevel} · {comp.description}</> : '元件資料已不存在'}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onResolve({ type: 'unequipComponent', ref: row.ref, componentId: id })}
                      className="hud-cut-sm shrink-0 px-2 py-1 border border-border text-[12px] text-text-secondary hover:text-accent-red hover:border-accent-red/50 transition-colors cursor-pointer"
                    >
                      卸下
                    </button>
                  </div>
                ))}
              </div>

              <SynergyPreview
                trigger={mounted.trigger.map((x) => x.comp)}
                effect={mounted.effect.map((x) => x.comp)}
              />
            </div>
          )}

          {/* ── 可裝清單 ── */}
          <div className="mt-2.5 border-t border-border pt-2.5">
            <div className="flex flex-wrap items-center" style={{ gap: 6 }}>
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`hud-cut-sm px-2 py-0.5 text-[12px] border transition-colors cursor-pointer ${
                    filter === f.key
                      ? 'border-accent-orange text-accent-orange bg-accent-orange/10'
                      : 'border-border text-text-secondary hover:border-border-accent'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              <span className={`${HUD.body} text-text-dim ml-auto`}>
                {loading ? '載入元件中…' : <>可裝 <span className={HUD.num}>{fits.length}</span> / {available.length} 個</>}
              </span>
            </div>

            {/* ⚠ 208 筆全列出來會讓右欄長到需要捲三個螢幕。清單自己捲（沿用 PickerShell 的
                `max-h + overflow-y-auto`），而**不是**只列前 N 筆 —— 截斷會讓「裝不上的
                留在清單裡」這條原則名存實亡：被截掉的那幾筆一樣是「我的元件呢」。 */}
            <div className="flex flex-col mt-2 max-h-[52vh] overflow-y-auto pr-0.5" style={{ gap: 6 }}>
              {[...fits, ...situational].map((e) => (
                <ComponentRow key={e.item.id} entry={e} onEquip={onEquip} onResolve={onResolve} />
              ))}

              {/* 結構性拒絕：摺疊成一行計數，可展開。展開後照樣寫出每一筆的原因 */}
              {structural.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowBlocked((v) => !v)}
                    className="w-full text-left hud-cut-sm border border-border-subtle bg-bg-dark/40 px-2.5 py-1.5 text-[12px] text-text-dim hover:text-text-secondary hover:border-border transition-colors cursor-pointer"
                  >
                    {showBlocked ? '▾' : '▸'} 這把武器裝不了的 {structural.length} 個
                    {counts.length > 0 && (
                      <span className="text-text-dim">
                        {' '}（{counts.map(([code, n]) => `${REJECTION_LABEL[code]} ${n}`).join('・')}）
                      </span>
                    )}
                  </button>
                  {showBlocked && structural.map((e) => (
                    <ComponentRow key={e.item.id} entry={e} onEquip={onEquip} onResolve={onResolve} />
                  ))}
                </>
              )}

              {!loading && available.length === 0 && (
                <p className={`${HUD.body} text-text-dim`}>
                  {used > 0 ? '這個分類的元件都已經裝上了。' : '這個分類目前沒有元件。'}
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
 * 清單的一列。三種狀態沿用 `RejectionRow` 的語彙（本檔不直接用它 ——
 * 那一支綁死 `WeaponIcon` 與「重量」副標，而元件沒有重量）：
 *   可裝        → 正常可點
 *   situational → 灰掉 ＋ 原因 ＋ **解法按鈕**
 *   structural  → 灰掉 ＋ 原因，**沒有**解法按鈕（改別的也解不掉）
 */
function ComponentRow({ entry, onEquip, onResolve }: {
  entry: PickerEntry<Component>
  onEquip: (comp: Component) => void
  onResolve: (action: ResolutionAction) => void
}) {
  const { item: comp, rejection } = entry
  const blocked = rejection !== null

  return (
    <div
      className={`flex items-start border transition-colors ${
        blocked
          ? 'bg-bg-dark border-border-subtle opacity-60'
          : 'bg-bg-dark border-border hover:border-accent-orange/60 cursor-pointer'
      }`}
      style={{ gap: 9, padding: '7px 9px' }}
      onClick={blocked ? undefined : () => onEquip(comp)}
      role={blocked ? undefined : 'button'}
      tabIndex={blocked ? undefined : 0}
      onKeyDown={(e) => {
        if (!blocked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onEquip(comp) }
      }}
    >
      <span className="shrink-0"><ComponentIcon comp={comp} size={34} /></span>
      <span className="flex flex-col min-w-0 grow" style={{ gap: 3 }}>
        <span className="flex items-center" style={{ gap: 6 }}>
          <span className={`${HUD.bodyStrong} text-text-primary truncate`}>{comp.name}</span>
          <span className={`${HUD.num} text-[11px] text-text-dim shrink-0`}>Lv{comp.probabilityLevel}</span>
          <span className="shrink-0 ml-auto flex items-center" style={{ gap: 4 }}>
            <ComponentTypeBadge type={comp.componentType} />
            <RarityBadge rarity={comp.rarity} />
          </span>
        </span>

        {blocked ? (
          <RejectionLine rejection={rejection} onResolve={onResolve} />
        ) : (
          <span className={`${HUD.body} text-text-secondary`}>{comp.description}</span>
        )}
      </span>
    </div>
  )
}

/**
 * 拒絕原因的那一行。
 *
 * ⚠ 灰掉卻沒有解法按鈕的 situational 列，就是「玩家會來問客服」的那一種 ——
 *   型別層已經逼 `rejectSituational()` 填 resolution，這裡只負責把它畫出來。
 */
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

/**
 * 組合特性預覽（PLAN-052-D C-3）。
 *
 * 官方的「組合特性」面板會逐條印出每一對（觸, 應）的**最終觸發機率**。本站今天只知道
 * 各自的 Lv —— Lv 到 % 的對照表要靠樣本蒐集反推，屬傷害計算範疇（總綱 2026-08-25 再確認
 * 「以後再補」）。
 *
 * ⚠ **機率欄位標「待建檔」，不猜值。** 印一個推測值出去，玩家會拿它去做決定，
 *   而那個決定是站上編出來的。這與元件面板在規則引擎落地前保持唯讀是同一條理由。
 *
 * ⚠ 求值模型也一併寫在這裡（總綱決策五）：觸元件成立時**逐一個別判定每個應元件**，
 *   但同一個應元件被多個觸元件觸發**不疊加**。玩家看得到「2 觸 2 應 ＝ 4 條配對」時，
 *   最容易生出的誤解就是「機率相加」。
 */
function SynergyPreview({ trigger, effect }: { trigger: (Component | null)[]; effect: (Component | null)[] }) {
  const pairs = trigger.flatMap((t) => effect.map((f) => ({ t, f })))
  if (pairs.length === 0) {
    return (
      <p className={`${HUD.body} text-text-dim mt-2`}>
        {trigger.length === 0
          ? '還沒有觸元件 —— 應元件要有觸元件才會生效。'
          : '還沒有應元件 —— 觸元件成立之後沒有東西可以發動。'}
      </p>
    )
  }

  return (
    <div className="mt-2.5">
      <div className={`${HUD.labelCjk} text-text-dim mb-1.5`}>
        組合特性 <span className={`${HUD.num} text-text-secondary`}>{pairs.length}</span> 條
      </div>
      <div className="flex flex-col" style={{ gap: 4 }}>
        {pairs.map(({ t, f }, i) => (
          <div
            key={`${t?.id ?? i}-${f?.id ?? i}`}
            className="flex items-center bg-bg-dark/60 border border-border-subtle text-[12px]"
            style={{ gap: 6, padding: '5px 8px' }}
          >
            <span className="text-accent-cyan truncate">{t?.name ?? '—'}</span>
            <span className={`${HUD.num} text-[10px] text-text-dim shrink-0`}>Lv{t?.probabilityLevel ?? '—'}</span>
            <span className="text-text-dim shrink-0">→</span>
            <span className="text-accent-purple truncate">{f?.name ?? '—'}</span>
            <span className={`${HUD.num} text-[10px] text-text-dim shrink-0`}>Lv{f?.probabilityLevel ?? '—'}</span>
            <span className="ml-auto shrink-0 text-text-dim">機率待建檔</span>
          </div>
        ))}
      </div>
      <p className={`${HUD.body} text-text-dim mt-1.5`}>
        每一條配對<strong className="text-text-secondary">各自判定</strong>；同一個應元件被多個觸元件
        觸發<strong className="text-text-secondary">不疊加</strong>。實際機率由觸與應的 Lv 共同決定，
        本站尚未建檔<strong className="text-text-secondary">，因此不顯示推估值</strong>。
      </p>
    </div>
  )
}

function SlotStat({ label, hint, value, accent }: { label: string; hint: string; value: string; accent?: boolean }) {
  return (
    <div className={`hud-cut-sm border bg-bg-dark/40 ${accent ? 'border-accent-orange/40' : 'border-border'}`} style={{ padding: '6px 8px' }}>
      <div className={`${HUD.labelCjk} text-text-dim leading-tight truncate`}>{label}</div>
      <div className={`${HUD.num} text-[15px] leading-tight mt-0.5 ${accent ? 'text-accent-orange' : 'text-text-primary'}`}>{value}</div>
      <div className="text-[10px] text-text-dim leading-tight mt-0.5 truncate">{hint}</div>
    </div>
  )
}
