import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Component } from '../../types'
import { COMPONENT_WEAPON_TYPES } from '../../types/enums'
import { useComponents } from '../../hooks/useFirestore'
import { ComponentIcon } from '../icons/ComponentIcon'
import { ComponentTypeBadge, RarityBadge } from '../badges/ComponentBadges'
import LoadoutIcon from '../icons/LoadoutIcon'
import { HUD, HUD_PANEL } from './loadoutTheme'
import type { WeaponRow } from '../../utils/loadoutRows'

// ─── 元件面板（PLAN-052-I D-3）───────────────────────────────────────────────
//
// 右欄「情境欄」的第三種內容：從武器列鑽進來，看這一把武器的元件配置。
//
// ⚠ **本階段唯讀，而且明著說**。可裝／不可裝的規則引擎（觸應共用上限、W 型、
//   條件成不成立…）屬 052-D；在它落地之前給出「加入元件」的入口，玩家按下去
//   要嘛沒反應、要嘛得到一個之後會被推翻的結果。抬頭那條建置中告示不是佔位文案，
//   是這一版**唯一誠實**的呈現方式。
//
// ⚠ **裝不上的元件留在清單裡並寫出原因，不直接濾掉**（設計畫布 ComponentPanel）：
//   「我的元件呢」比多幾列雜訊更難處理 —— 玩家找不到一個他知道存在的東西時，
//   會以為是站上缺資料，而不會想到是自己這把武器不相容。
//
// ⚠ 本階段**只判資料層答得出來的那一條**：`allowedWeaponTypes` 有沒有包含這把武器的
//   `type`。其餘（W 型互斥、條件成不成立、觸應配對）一律不猜 —— 猜錯的規則會被
//   052-D 推翻，而使用者已經照它配過一輪了。
//
// ⚠ `components` 集合（208 筆）**只在本面板掛載時才載入**：`useComponents()` 寫在這裡
//   而不是 LoadoutPage，於是沒點進來的人一筆都不付。與 useLoadoutGameData 的分階段
//   載入是同一條原則。

type Filter = 'all' | 'Condition' | 'Function'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'Condition', label: '觸元件' },
  { key: 'Function', label: '應元件' },
]

/**
 * 這顆元件裝不上這把武器的原因；`null` ＝ 就資料層而言裝得上。
 *
 * 回中文完整句而不是代碼：這一行是直接印給玩家看的，而「為什麼裝不上」講不清楚，
 * 就會變成客服問題（與 loadoutRules 的 REJECTION_LABEL 同一條理由）。
 */
function componentBlockReason(comp: Component, weaponType: string | undefined): string | null {
  const allowed = comp.allowedWeaponTypes ?? []
  // 空陣列＝不限；填滿全部也是不限（後台的「全選」就是這個形狀）
  if (allowed.length === 0 || allowed.length >= COMPONENT_WEAPON_TYPES.length) return null
  if (!weaponType) return null
  if (allowed.includes(weaponType)) return null
  return `僅限${allowed.join('・')}武器 —— 這把是${weaponType}`
}

interface Props {
  row: WeaponRow
  onBack: () => void
}

export function ComponentPanel({ row, onBack }: Props) {
  const { data: components, loading } = useComponents()
  const [filter, setFilter] = useState<Filter>('all')

  const weapon = row.weapon
  const list = useMemo(() => {
    const typed = components.filter((c) => filter === 'all' || c.componentType === filter)
    return typed
      .map((c) => ({ comp: c, blocked: componentBlockReason(c, weapon?.type) }))
      // 裝得上的排前面；裝不上的沉底但**不消失**
      .sort((a, b) => (a.blocked ? 1 : 0) - (b.blocked ? 1 : 0) || a.comp.name.localeCompare(b.comp.name, 'zh-Hant'))
  }, [components, filter, weapon?.type])

  const fitCount = list.filter((x) => !x.blocked).length

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

      {/* ⚠ 常駐告示，不是暫時公告：面板長得像可以操作，就必須講清楚它現在不能。 */}
      <div className="hud-cut-sm mt-2.5 border border-accent-yellow/30 bg-accent-yellow/5 px-2.5 py-2">
        <p className={`${HUD.body} text-text-secondary`}>
          <strong className="text-accent-yellow">元件功能建置中</strong> ——
          本面板目前<strong className="text-text-primary">唯讀</strong>，先讓你看得到這把武器能放幾個、
          以及有哪些元件。裝上／卸下與觸應配對規則在後續階段開放。
        </p>
      </div>

      {/* 槽位呈現：觸／應各自的格數只是上限，真正的牆是 componentLimit（總數） */}
      <div className="grid grid-cols-3 mt-2.5" style={{ gap: 8 }}>
        <SlotStat label="觸元件" hint="什麼時候生效" value={`${row.used === 0 ? 0 : '—'} / ${weapon?.triggerSlots ?? 0}`} />
        <SlotStat label="應元件" hint="生效之後做什麼" value={`${row.used === 0 ? 0 : '—'} / ${weapon?.effectSlots ?? 0}`} />
        <SlotStat label="合計上限" hint="真正的牆" value={`${row.used} / ${row.limit}`} accent />
      </div>

      <p className={`${HUD.body} text-text-dim mt-2`}>
        觸 ＋ 應 <strong className="text-text-secondary">合計不得超過 {row.limit}</strong>
        （SS／S+ 為 4、S 為 3、其餘不可裝）。兩種各自的格數只是上限，總數才是真正的牆。
      </p>

      {row.limit === 0 ? (
        <p className={`${HUD.body} text-text-dim mt-2.5 border-t border-border pt-2.5`}>
          這把武器<strong className="text-text-secondary">不可裝元件</strong>
          {row.locked === 'fixed' && '（機甲固定武裝）'}。
        </p>
      ) : (
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
              {loading ? '載入元件中…' : <>可裝 <span className={HUD.num}>{fitCount}</span> / {list.length} 個</>}
            </span>
          </div>

          {/* ⚠ 208 筆全列出來會讓右欄長到需要捲三個螢幕。清單自己捲（沿用 PickerShell 的
              `max-h + overflow-y-auto`），而**不是**只列前 N 筆 —— 截斷會讓「裝不上的
              留在清單裡」這條原則名存實亡：被截掉的那幾筆一樣是「我的元件呢」。 */}
          <div className="flex flex-col mt-2 max-h-[52vh] overflow-y-auto pr-0.5" style={{ gap: 6 }}>
            {list.map(({ comp, blocked }) => (
              <div
                key={comp.id}
                className={`flex items-start bg-bg-dark border border-border ${blocked ? 'opacity-55' : ''}`}
                style={{ gap: 9, padding: '7px 9px' }}
              >
                <span className="shrink-0"><ComponentIcon comp={comp} size={34} /></span>
                <span className="flex flex-col min-w-0 grow" style={{ gap: 3 }}>
                  <span className="flex items-center" style={{ gap: 6 }}>
                    <span className={`${HUD.bodyStrong} text-text-primary truncate`}>{comp.name}</span>
                    <span className="shrink-0 ml-auto flex items-center" style={{ gap: 4 }}>
                      <ComponentTypeBadge type={comp.componentType} />
                      <RarityBadge rarity={comp.rarity} />
                    </span>
                  </span>
                  {blocked ? (
                    <span className="flex items-center text-[12px] text-accent-red/85 leading-relaxed" style={{ gap: 5 }}>
                      <LoadoutIcon name="absent" className="w-[13px] h-[13px] shrink-0" />
                      {blocked}
                    </span>
                  ) : (
                    <span className={`${HUD.body} text-text-secondary`}>{comp.description}</span>
                  )}
                </span>
              </div>
            ))}
            {!loading && list.length === 0 && (
              <p className={`${HUD.body} text-text-dim`}>這個分類目前沒有元件。</p>
            )}
          </div>

          <p className={`${HUD.body} text-text-dim mt-2`}>
            裝不上的元件<strong className="text-text-secondary">留在清單裡並寫出原因</strong>，不直接濾掉。
            目前只判「武器種類限定」這一條 —— 其餘規則等元件引擎落地後才會出現，本站不先猜。
          </p>
        </div>
      )}
    </section>
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
