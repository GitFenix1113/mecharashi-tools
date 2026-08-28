import { useState, useEffect, useMemo } from 'react'
import type { Module, Mech, ConditionalEffect, ModuleLevel, DescriptionRefs, ModuleUnlock } from '../../../types'
import {
  ModuleRarity, ModuleSlot, ModuleSource, ModuleDataSource, ConditionalTrigger, MechPartPosition,
} from '../../../types/enums'
import {
  Field, AdminModal, useNewItemCreation, NewItemDialog, useClientPaged, LoadMoreButton,
  GRID_AUTO_FIELDS, GRID_TWO_PANE, AdminEditTabs, type AdminEditTabDef,
  DraftRestoreBar,
} from './shared'
import { useDraftWrite, useDraftRestore } from '../../../hooks/useDraftAutosave'
import { updateModule, docExists } from '../../../lib/firestoreApi'
import { makeEntityId, stripIdPrefix } from '../../../utils/idSlug'
import { markKeywords, extractKeywords } from '../../../utils/refKey'
import { useGameData } from '../../../contexts/GameDataContext'
import { RefPicker } from '../../../components/admin/RefPicker'
import { IconField } from '../../../components/admin/IconPicker'
import { SLOT_OPTIONS, SLOT_LABEL, PART_OPTIONS, TRIGGER_LABEL, STAT_OPTIONS } from './constants'

type ModuleFilters = {
  slot: string
  bound: 'all' | 'bound' | 'unbound'
  stats: 'all' | 'has' | 'none'
  source: string
}

// ─── 預設值與輔助 ──────────────────────────────────────────────────────────────
export function makeDefaultModule(id: string): Module {
  return {
    id,
    name: '',
    slot: ModuleSlot.SLOT_4,
    boundMechId: null,
    boundPart: null,
    dmg: 0, critDmg: 0, crit_rate: 0, acc_rate: 0,
    firepower_rate: 0, armor_rate: 0, crit_resist_rate: 0,
    output_bonus: 0, dodge_rate: 0, durable_rate: 0, dmg_resist_rate: 0,
    description: '',
    rarity: ModuleRarity.A,
    source: [ModuleSource.UNKNOWN],
    managedBy: ModuleDataSource.MANUAL,
    levels: [],
    conditionalEffects: [],
    moduleAddLevel: 1,
  }
}

/**
 * 機甲名轉 ID 片段：沿用爬蟲既有慣例保留原名（含 `-`，如 `破曉者-01`），
 * 僅去掉 Firestore 文件 ID 不接受 / 易歧異的字元。
 * 注意：不可改用 slugify()——它會把 `-` 也吃掉，導致與既有的
 * `mod_破曉者-01_fixed_1` 命名對不上，序號會從 1 重新開始。
 */
function mechIdSegment(name: string): string {
  return name.trim().replace(/[/\s]+/g, '')
}

/**
 * 機甲專屬模組 ID：`mod_<機甲名>_fixed_<n>`。
 * n 取該機甲現有專屬模組的最大序號 +1（不分大小寫比對，避免大小寫孿生）。
 * 機甲名無有效字元時回傳空字串，讓呼叫端擋下。
 */
function makeExclusiveModuleId(mechName: string, allModules: Module[]): string {
  const seg = mechIdSegment(mechName)
  if (!seg) return ''
  const esc = seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^mod_${esc}_fixed_(\\d+)$`, 'i')
  let max = 0
  for (const m of allModules) {
    const hit = re.exec(m.id)
    if (hit) max = Math.max(max, Number(hit[1]))
  }
  return `mod_${seg}_fixed_${max + 1}`
}

export function moduleHasStats(m: Module): boolean {
  return (
    m.dmg > 0 || m.critDmg > 0 || m.crit_rate > 0 || m.acc_rate > 0 ||
    m.firepower_rate > 0 || m.armor_rate > 0 || m.output_bonus > 0 ||
    m.crit_resist_rate > 0 || m.dodge_rate > 0 || m.durable_rate > 0 ||
    m.dmg_resist_rate > 0 ||
    (m.dmg_assault ?? 0) > 0 || (m.dmg_melee ?? 0) > 0 ||
    (m.dmg_shooting ?? 0) > 0 || (m.dmg_tactical ?? 0) > 0 ||
    (m.dmg_blade ?? 0) > 0 || (m.dmg_polearm ?? 0) > 0 ||
    (m.dmg_missile ?? 0) > 0 || (m.dmg_rocket ?? 0) > 0 ||
    (m.dmg_shotgun ?? 0) > 0 || (m.dmg_machinegun ?? 0) > 0 ||
    (m.dmg_heavy_machinegun ?? 0) > 0 || (m.dmg_railgun ?? 0) > 0 ||
    (m.dmg_funnel ?? 0) > 0 || (m.dmg_sniper_light ?? 0) > 0 ||
    (m.dmg_sniper ?? 0) > 0 || (m.dmg_fist ?? 0) > 0 ||
    (m.dmg_pile ?? 0) > 0 || (m.dmg_chainsaw ?? 0) > 0 ||
    (m.dmg_flamethrower ?? 0) > 0 || (m.dmg_counter ?? 0) > 0 ||
    (m.dmg_enemy_phase ?? 0) > 0
  )
}

// ─── 條件效果項目 ──────────────────────────────────────────────────────────────
function ConditionalEffectItem({
  effect,
  index,
  onChange,
  onRemove,
}: {
  effect: ConditionalEffect
  index: number
  onChange: (updated: ConditionalEffect) => void
  onRemove: () => void
}) {
  function upd<K extends keyof ConditionalEffect>(key: K, value: ConditionalEffect[K]) {
    onChange({ ...effect, [key]: value })
  }

  function toggleStat(stat: string) {
    const next = effect.stats.includes(stat)
      ? effect.stats.filter((s) => s !== stat)
      : [...effect.stats, stat]
    upd('stats', next)
  }

  return (
    <div className="border border-border/60 rounded-lg p-3 space-y-2.5 bg-bg-dark/50">
      <div className="flex items-center justify-between">
        <span className="text-[14px] text-text-dim font-medium">條件效果 #{index + 1}</span>
        <button
          onClick={onRemove}
          className="text-[13px] px-1.5 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10"
        >
          ✕ 移除
        </button>
      </div>

      <Field label="觸發類型 trigger">
        <select value={effect.trigger} onChange={(e) => upd('trigger', e.target.value)} className="input-field">
          {Object.values(ConditionalTrigger).map((v) => (
            <option key={v} value={v}>{TRIGGER_LABEL[v] ?? v}</option>
          ))}
        </select>
      </Field>

      {/* 7 個條件效果參數原本拆成 3 組（2/3/2 欄）；併為單一自動格線（PLAN-033 B-3） */}
      <div className={`${GRID_AUTO_FIELDS} gap-2`}>
        <Field label="觸發門檻 minCount（選填）">
          <input
            type="number"
            value={effect.minCount ?? ''}
            onChange={(e) => upd('minCount', e.target.value === '' ? undefined : Number(e.target.value))}
            className="input-field"
            placeholder="—"
          />
        </Field>
        <Field label="重置時機 resetOn">
          <select
            value={effect.resetOn ?? ''}
            onChange={(e) => upd('resetOn', (e.target.value || null) as ConditionalEffect['resetOn'])}
            className="input-field"
          >
            <option value="">不重置 (null)</option>
            <option value="attack">每次攻擊後 (attack)</option>
            <option value="turn">回合結束 (turn)</option>
          </select>
        </Field>
        <Field label="基礎加成 base（選填）">
          <input type="number" value={effect.base ?? ''} onChange={(e) => upd('base', e.target.value === '' ? undefined : Number(e.target.value))} className="input-field" placeholder="—" />
        </Field>
        <Field label="每單位追加 scale（選填）">
          <input type="number" value={effect.scale ?? ''} onChange={(e) => upd('scale', e.target.value === '' ? undefined : Number(e.target.value))} className="input-field" placeholder="—" />
        </Field>
        <Field label="總加成上限 max（選填）">
          <input type="number" value={effect.max ?? ''} onChange={(e) => upd('max', e.target.value === '' ? undefined : Number(e.target.value))} className="input-field" placeholder="—" />
        </Field>
        <Field label="最大疊加 maxStacks（選填）">
          <input type="number" value={effect.maxStacks ?? ''} onChange={(e) => upd('maxStacks', e.target.value === '' ? undefined : Number(e.target.value))} className="input-field" placeholder="—" />
        </Field>
        <Field label="持續回合 duration（選填，null=永久）">
          <input type="number" value={effect.duration ?? ''} onChange={(e) => upd('duration', e.target.value === '' ? undefined : Number(e.target.value))} className="input-field" placeholder="— (永久)" />
        </Field>
      </div>

      <Field label="影響屬性 stats">
        <div className="grid grid-cols-2 gap-y-1 gap-x-2 mt-1">
          {STAT_OPTIONS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-1.5 text-[14px] text-text-secondary cursor-pointer hover:text-text-primary">
              <input
                type="checkbox"
                checked={effect.stats.includes(key)}
                onChange={() => toggleStat(key)}
                className="accent-accent-orange w-3 h-3"
              />
              {label}
            </label>
          ))}
        </div>
      </Field>
    </div>
  )
}

// ─── 模組等級項目 ──────────────────────────────────────────────────────────────
function ModuleLevelItem({
  levelData,
  index,
  onChange,
  onRemove,
  topDescription,
  topRefs,
}: {
  levelData: ModuleLevel
  index: number
  onChange: (updated: ModuleLevel) => void
  onRemove: () => void
  /** 基本資訊分頁的頂層正文與引用（本級標記落後於頂層時據以提示補齊） */
  topDescription?: string
  topRefs?: DescriptionRefs
}) {
  const [collapsed, setCollapsed] = useState(index > 0)
  // 子區塊預設收合：打開某個 LV 時，兩大串數值欄位先摺起，只先看描述 / 引用（需要時再展開）
  const [statsCollapsed, setStatsCollapsed] = useState(true)
  const [weaponCollapsed, setWeaponCollapsed] = useState(true)

  function upd<K extends keyof ModuleLevel>(key: K, value: ModuleLevel[K]) {
    onChange({ ...levelData, [key]: value })
  }

  /**
   * 前台 ModuleCard 顯示的是**這一級**的 description（頂層只是 refs 的退路），而 RefText
   * 只認 `[xxx]`。頂層標好了、本級還是爬蟲原文時，前台就會把引用顯示成純文字——
   * 沒有任何錯誤訊息，只有「本來該亮的字沒亮」。這塊提示就是為了讓它不再靜默。
   */
  const pending = useMemo(() => {
    const assigned = extractKeywords(topDescription ?? '').filter((k) => topRefs?.[k])
    if (!assigned.length) return null
    const r = markKeywords(levelData.description ?? '', assigned)
    const ambiguous = r.skipped.filter((s) => s.reason === 'ambiguous').map((s) => s.key)
    if (!r.marked.size && !ambiguous.length) return null
    return { ...r, ambiguous }
  }, [topDescription, topRefs, levelData.description])

  function applyTopMarks() {
    if (!pending?.marked.size) return
    const refs = { ...(levelData.descriptionRefs ?? {}) }
    // 只帶入本級正文真的用到的 key；既有指派一律保留（該級可能刻意指向不同階的 buff）
    for (const k of extractKeywords(pending.text)) if (!refs[k] && topRefs?.[k]) refs[k] = topRefs[k]
    onChange({ ...levelData, description: pending.text, descriptionRefs: refs })
  }

  return (
    <div className="border border-border/60 rounded-lg bg-bg-dark/50">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none" onClick={() => setCollapsed(!collapsed)}>
        <span className="text-[13px] text-text-dim w-3">{collapsed ? '▶' : '▼'}</span>
        <span className="text-[14px] text-text-dim font-medium flex-1 truncate">
          Lv.{levelData.level}
          {levelData.description && (
            <span className="ml-2 text-text-secondary font-normal">{levelData.description.slice(0, 40)}</span>
          )}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="text-[13px] px-1.5 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10 shrink-0"
        >
          ✕ 移除
        </button>
      </div>

      {!collapsed && (
        <div className="px-3 pb-3 border-t border-border/40 pt-2.5 space-y-2.5">
          <Field label="等級 level">
            <input type="number" value={levelData.level} onChange={(e) => upd('level', Number(e.target.value))} className="input-field w-24" />
          </Field>
          <Field label="效果描述 description">
            <textarea value={levelData.description} onChange={(e) => upd('description', e.target.value)} className="input-field min-h-[110px] resize-y" />
          </Field>

          {pending && (
            <div className="rounded-lg border border-accent-yellow/30 bg-accent-yellow/5 px-3 py-2.5 space-y-1.5">
              <div className="text-[12px] font-semibold text-accent-yellow">⚠ 本級標記落後於「基本資訊」</div>
              {pending.marked.size > 0 && (
                <>
                  <div className="text-[11px] text-text-dim leading-relaxed">
                    頂層已標成引用、本級正文仍是裸字：
                    <span className="text-text-secondary">
                      {[...pending.marked].map(([k, n]) => `[${k}]${n > 1 ? `×${n}` : ''}`).join('、')}
                    </span>
                    。前台模組卡顯示的是<strong className="text-text-secondary">本級</strong>的描述，
                    維持現狀的話這些字不會變成可點引用。
                  </div>
                  <div className="flex items-center gap-2 flex-wrap pt-0.5">
                    <button
                      type="button"
                      onClick={applyTopMarks}
                      className="text-[12px] px-2.5 py-1 rounded border border-accent-yellow/40 bg-accent-yellow/10 text-accent-yellow hover:bg-accent-yellow/20"
                    >從基本資訊套用標記（{[...pending.marked.values()].reduce((a, b) => a + b, 0)} 處）</button>
                    <span className="text-[11px] text-text-dim">
                      只加括號並帶入對應引用，既有指派不會被覆蓋
                    </span>
                  </div>
                </>
              )}
              {pending.ambiguous.length > 0 && (
                <div className="text-[11px] text-text-dim">
                  <span className="text-accent-orange">{pending.ambiguous.join('、')}</span>
                  {' '}有同名消歧鍵，無法自動判斷各處歸屬 → 請手動在正文加括號。
                </div>
              )}
            </div>
          )}

          <RefPicker
            text={levelData.description}
            value={levelData.descriptionRefs}
            onChange={(refs) => upd('descriptionRefs', refs)}
            onCompileText={(tf) => upd('description', tf(levelData.description))}
          />

          <div className="pt-2 border-t border-border/40">
            <button
              type="button"
              onClick={() => setStatsCollapsed(!statsCollapsed)}
              className="flex items-center gap-2 w-full text-left mb-2"
            >
              <span className="text-[13px] text-text-dim w-3">{statsCollapsed ? '▶' : '▼'}</span>
              <span className="text-[13px] text-text-dim font-medium tracking-wider uppercase">各項能力</span>
            </button>
            {!statsCollapsed && (
            <div className={`${GRID_AUTO_FIELDS} gap-2`}>
            <Field label="增傷 (%)"><input type="number" value={levelData.dmg} onChange={(e) => upd('dmg', Number(e.target.value))} className="input-field" /></Field>
            <Field label="暴擊率"><input type="number" value={levelData.crit_rate} onChange={(e) => upd('crit_rate', Number(e.target.value))} className="input-field" /></Field>
            <Field label="暴擊傷害 (%)"><input type="number" value={levelData.critDmg} onChange={(e) => upd('critDmg', Number(e.target.value))} className="input-field" /></Field>
            <Field label="命中率"><input type="number" value={levelData.acc_rate} onChange={(e) => upd('acc_rate', Number(e.target.value))} className="input-field" /></Field>
            <Field label="火力 (%)"><input type="number" value={levelData.firepower_rate} onChange={(e) => upd('firepower_rate', Number(e.target.value))} className="input-field" /></Field>
            <Field label="護甲 (%)"><input type="number" value={levelData.armor_rate} onChange={(e) => upd('armor_rate', Number(e.target.value))} className="input-field" /></Field>
            <Field label="機甲出力"><input type="number" value={levelData.output_bonus} onChange={(e) => upd('output_bonus', Number(e.target.value))} className="input-field" /></Field>
            <Field label="被暴擊降低"><input type="number" value={levelData.crit_resist_rate} onChange={(e) => upd('crit_resist_rate', Number(e.target.value))} className="input-field" /></Field>
            <Field label="回避率 (%)"><input type="number" value={levelData.dodge_rate} onChange={(e) => upd('dodge_rate', Number(e.target.value))} className="input-field" /></Field>
            <Field label="耐久 (%)"><input type="number" value={levelData.durable_rate} onChange={(e) => upd('durable_rate', Number(e.target.value))} className="input-field" /></Field>
            <Field label="傷害降低 (%)"><input type="number" value={levelData.dmg_resist_rate} onChange={(e) => upd('dmg_resist_rate', Number(e.target.value))} className="input-field" /></Field>
            </div>
            )}
          </div>
          <div className="pt-2 border-t border-border/40">
            <button
              type="button"
              onClick={() => setWeaponCollapsed(!weaponCollapsed)}
              className="flex items-center gap-2 w-full text-left mb-2"
            >
              <span className="text-[13px] text-text-dim w-3">{weaponCollapsed ? '▶' : '▼'}</span>
              <span className="text-[13px] text-text-dim font-medium tracking-wider uppercase">武器專屬增傷 (%)</span>
            </button>
            {!weaponCollapsed && (
            <div className={`${GRID_AUTO_FIELDS} gap-2`}>
              <Field label="突擊"><input type="number" value={levelData.dmg_assault ?? 0} onChange={(e) => upd('dmg_assault', Number(e.target.value))} className="input-field" /></Field>
              <Field label="格鬥"><input type="number" value={levelData.dmg_melee ?? 0} onChange={(e) => upd('dmg_melee', Number(e.target.value))} className="input-field" /></Field>
              <Field label="射擊"><input type="number" value={levelData.dmg_shooting ?? 0} onChange={(e) => upd('dmg_shooting', Number(e.target.value))} className="input-field" /></Field>
              <Field label="戰術"><input type="number" value={levelData.dmg_tactical ?? 0} onChange={(e) => upd('dmg_tactical', Number(e.target.value))} className="input-field" /></Field>
              <Field label="刀劍"><input type="number" value={levelData.dmg_blade ?? 0} onChange={(e) => upd('dmg_blade', Number(e.target.value))} className="input-field" /></Field>
              <Field label="長柄"><input type="number" value={levelData.dmg_polearm ?? 0} onChange={(e) => upd('dmg_polearm', Number(e.target.value))} className="input-field" /></Field>
              <Field label="導彈"><input type="number" value={levelData.dmg_missile ?? 0} onChange={(e) => upd('dmg_missile', Number(e.target.value))} className="input-field" /></Field>
              <Field label="火箭"><input type="number" value={levelData.dmg_rocket ?? 0} onChange={(e) => upd('dmg_rocket', Number(e.target.value))} className="input-field" /></Field>
              <Field label="霰彈"><input type="number" value={levelData.dmg_shotgun ?? 0} onChange={(e) => upd('dmg_shotgun', Number(e.target.value))} className="input-field" /></Field>
              <Field label="機槍"><input type="number" value={levelData.dmg_machinegun ?? 0} onChange={(e) => upd('dmg_machinegun', Number(e.target.value))} className="input-field" /></Field>
              <Field label="重機槍"><input type="number" value={levelData.dmg_heavy_machinegun ?? 0} onChange={(e) => upd('dmg_heavy_machinegun', Number(e.target.value))} className="input-field" /></Field>
              <Field label="電磁炮"><input type="number" value={levelData.dmg_railgun ?? 0} onChange={(e) => upd('dmg_railgun', Number(e.target.value))} className="input-field" /></Field>
              <Field label="浮游炮"><input type="number" value={levelData.dmg_funnel ?? 0} onChange={(e) => upd('dmg_funnel', Number(e.target.value))} className="input-field" /></Field>
              <Field label="輕狙"><input type="number" value={levelData.dmg_sniper_light ?? 0} onChange={(e) => upd('dmg_sniper_light', Number(e.target.value))} className="input-field" /></Field>
              <Field label="狙擊步槍"><input type="number" value={levelData.dmg_sniper ?? 0} onChange={(e) => upd('dmg_sniper', Number(e.target.value))} className="input-field" /></Field>
              <Field label="拳套"><input type="number" value={levelData.dmg_fist ?? 0} onChange={(e) => upd('dmg_fist', Number(e.target.value))} className="input-field" /></Field>
              <Field label="打樁機"><input type="number" value={levelData.dmg_pile ?? 0} onChange={(e) => upd('dmg_pile', Number(e.target.value))} className="input-field" /></Field>
              <Field label="電鋸"><input type="number" value={levelData.dmg_chainsaw ?? 0} onChange={(e) => upd('dmg_chainsaw', Number(e.target.value))} className="input-field" /></Field>
              <Field label="噴火器"><input type="number" value={levelData.dmg_flamethrower ?? 0} onChange={(e) => upd('dmg_flamethrower', Number(e.target.value))} className="input-field" /></Field>
              <Field label="反擊"><input type="number" value={levelData.dmg_counter ?? 0} onChange={(e) => upd('dmg_counter', Number(e.target.value))} className="input-field" /></Field>
              <Field label="敵方階段"><input type="number" value={levelData.dmg_enemy_phase ?? 0} onChange={(e) => upd('dmg_enemy_phase', Number(e.target.value))} className="input-field" /></Field>
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 模組編輯面板 ──────────────────────────────────────────────────────────────
// ─── PLAN-052-K C-1：部位倍率 ──────────────────────────────────────────────────
/**
 * `slotLevelMultiplier` 的部位多選。沿用緊鄰的 `boundPart` 同一組 checkbox 樣式 ——
 * 兩者都是「這顆模組跟哪些部位有關」，長得不一樣只會讓人以為語意也不一樣。
 *
 * ⚠ 空陣列一律收成 `undefined`：`[]` 與「沒有這個欄位」在這裡是同一件事
 *   （不像 `MechPart.innateModules` 那樣兩者有別），留著空陣列只是髒資料。
 */
function SlotLevelMultiplierField({ value, onChange }: {
  value?: MechPartPosition[]
  onChange: (v: MechPartPosition[] | undefined) => void
}) {
  const parts = value ?? []
  return (
    <Field label="部位倍率 slotLevelMultiplier（複選，空白=無）">
      <div className="flex flex-wrap gap-4 mt-1">
        {PART_OPTIONS.map(({ value: pos, label }) => {
          const checked = parts.includes(pos as MechPartPosition)
          return (
            <label key={pos} className="flex items-center gap-1.5 text-sm cursor-pointer hover:text-text-primary">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const next = checked
                    ? parts.filter((p) => p !== pos)
                    : [...parts, pos as MechPartPosition]
                  onChange(next.length > 0 ? next : undefined)
                }}
                className="accent-accent-orange w-3.5 h-3.5"
              />
              {label}
            </label>
          )
        })}
      </div>
      <p className="text-[14px] text-text-dim mt-1 leading-relaxed">
        勾選的部位，<span className="text-accent-cyan">該部位插槽中的模組等級翻倍</span>，
        <span className="text-accent-red">不含天生貢獻</span>（站長實測：該部位插一顆刀劍模組Ⅱ ⇒ 2×2＝4 直接滿級）。
        <br />
        今天全站只有破曉者-02 的兩顆〈匯流樞紐〉有值（軀幹一顆、腿部一顆）。
        兩顆<span className="text-accent-orange">同名而效果不同</span>，所以這裡要勾的是
        <span className="text-accent-orange">描述裡寫的那個部位</span>，不是這顆模組綁在哪個部位。
      </p>
    </Field>
  )
}

// ─── PLAN-052-K C-2：啟用條件 ─────────────────────────────────────────────────
type UnlockKind = '' | 'moduleAtMaxLevel' | 'pilotOnly'

/**
 * `unlockCondition` 的兩形狀編輯器：先選 kind，再依 kind 顯示對應輸入。
 *
 * ⚠ 觸發者的下拉列**全部模組**，不只本機甲的 —— 但把本機甲那些排在最前面的 optgroup。
 *   復仇女神四顆的觸發者〈迸發模組〉是同機甲的 8 級模組，不過規則上沒有「必須同機甲」這回事，
 *   寫死成只列同機甲的話，遇到跨機甲觸發就只能改程式。
 * ⚠ 條件不成立時模組**不會從畫面消失**，只會顯示成停用態（決策五）——
 *   這裡的說明必須講清楚，否則維護者會拿它當「隱藏這顆模組」的開關。
 */
function UnlockConditionField({ value, boundMechId, onChange }: {
  value?: ModuleUnlock
  boundMechId?: string | null
  onChange: (v: ModuleUnlock | undefined) => void
}) {
  const gd = useGameData()
  useEffect(() => { gd.ensureLoaded(['pilots']) }, [gd])

  const kind: UnlockKind = value?.kind ?? ''
  const [sameMech, otherMods] = useMemo(() => {
    const same: Module[] = []
    const other: Module[] = []
    for (const m of gd.modules) (boundMechId && m.boundMechId === boundMechId ? same : other).push(m)
    return [same, other]
  }, [gd.modules, boundMechId])

  const pilotIds = value?.kind === 'pilotOnly' ? value.pilotIds : []
  const pilotName = (id: string) => gd.pilots.find((p) => p.id === id)?.name ?? id

  function switchKind(next: UnlockKind) {
    if (next === '') return onChange(undefined)
    if (next === 'moduleAtMaxLevel') return onChange({ kind: 'moduleAtMaxLevel', moduleId: '' })
    return onChange({ kind: 'pilotOnly', pilotIds: [] })
  }

  return (
    <Field label="啟用條件 unlockCondition（未設定=無條件生效）">
      <select value={kind} onChange={(e) => switchKind(e.target.value as UnlockKind)} className="input-field">
        <option value="">無條件生效（241 筆裡 235 筆是這一種）</option>
        <option value="moduleAtMaxLevel">某顆模組達滿級才解鎖</option>
        <option value="pilotOnly">限定機師才能發動</option>
      </select>

      {value?.kind === 'moduleAtMaxLevel' && (
        <>
          <select
            value={value.moduleId}
            onChange={(e) => onChange({ kind: 'moduleAtMaxLevel', moduleId: e.target.value })}
            className="input-field mt-2"
          >
            <option value="">（請選擇觸發的模組）</option>
            {sameMech.length > 0 && (
              <optgroup label="本機甲的模組">
                {sameMech.map((m) => <option key={m.id} value={m.id}>{m.name}（{m.id}）</option>)}
              </optgroup>
            )}
            <optgroup label="其他模組">
              {otherMods.map((m) => <option key={m.id} value={m.id}>{m.name}（{m.id}）</option>)}
            </optgroup>
          </select>
          {!value.moduleId && (
            <p className="text-[14px] text-accent-red mt-1">尚未選擇觸發的模組 —— 這樣存下去，這顆模組會<b>永遠</b>處於停用態。</p>
          )}
          {value.moduleId && !(gd.modules.find((m) => m.id === value.moduleId)?.levels ?? []).length && (
            <p className="text-[14px] text-accent-yellow mt-1">
              ⚠ 這顆觸發模組沒有 <code>levels[]</code> ⇒ 滿級是 0 級，條件<b>永遠不成立</b>。先去把它的等級資料補齊。
            </p>
          )}
        </>
      )}

      {value?.kind === 'pilotOnly' && (
        <>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {pilotIds.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-accent-orange/40 bg-accent-orange/10 text-accent-orange text-xs">
                {pilotName(id)}
                <button
                  type="button"
                  className="hover:text-accent-red"
                  onClick={() => onChange({ kind: 'pilotOnly', pilotIds: pilotIds.filter((x) => x !== id) })}
                  title="移除"
                >✕</button>
              </span>
            ))}
            {pilotIds.length === 0 && (
              <span className="text-[14px] text-accent-red">尚未指定機師 —— 這樣存下去，這顆模組會<b>永遠</b>處於停用態。</span>
            )}
          </div>
          <select
            value=""
            onChange={(e) => {
              const id = e.target.value
              if (id && !pilotIds.includes(id)) onChange({ kind: 'pilotOnly', pilotIds: [...pilotIds, id] })
            }}
            className="input-field mt-2"
          >
            <option value="">＋ 加入機師…</option>
            {gd.pilots
              .filter((p) => !pilotIds.includes(p.id))
              .map((p) => <option key={p.id} value={p.id}>{p.name}（{p.id}）</option>)}
          </select>
        </>
      )}

      <p className="text-[14px] text-text-dim mt-1 leading-relaxed">
        條件不成立時，模組<span className="text-accent-red">不會從畫面上消失</span>，
        而是顯示成<span className="text-accent-cyan">停用態並講出原因</span>
        —— 直接消失的話玩家會以為是 bug。這裡<span className="text-accent-red">不是</span>「隱藏這顆模組」的開關。
        <br />
        ⚠ 只填<span className="text-accent-orange">整顆模組的生效條件</span>。
        像影虎〈虎魄·無束〉L2「當[虎王]駕駛一整套[影虎]時…」那種是
        <span className="text-accent-orange">效果內的條件</span>，模組本身照樣存在、照樣算等級 —— 那些不要填在這裡。
        <br />
        ⚠ 觸發者是<span className="text-accent-orange">別顆模組</span>：復仇女神四顆〈模型-XX〉自己的描述裡
        沒有「限制解除」四個字，那句話在〈迸發模組〉的 LV8 文本裡。
      </p>
    </Field>
  )
}

type EditTab = 'basic' | 'stats' | 'weapon' | 'levels' | 'conditional'

const EDIT_TABS: AdminEditTabDef<EditTab>[] = [
  { id: 'basic',       label: '基本資訊' },
  { id: 'stats',       label: '基本屬性' },
  { id: 'weapon',      label: '武器增傷' },
  { id: 'levels',      label: '等級資料' },
  { id: 'conditional', label: '條件效果' },
]

function ModuleEditPanel({
  module: mod,
  mechs,
  onSave,
  onCancel,
}: {
  module: Module
  mechs: Mech[]
  onSave: (m: Module) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm]     = useState<Module>({ ...mod })
  useDraftWrite('modules', form, (m) => m.name)   // 草稿暫存（PLAN-045）：監聽的必須是 form，不是外層的 editing
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [editTab, setEditTab] = useState<EditTab>('basic')

  useEffect(() => { setForm({ ...mod }); setEditTab('basic') }, [mod])

  function update<K extends keyof Module>(key: K, value: Module[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit() {
    setSaving(true); setError(null)
    try { await onSave(form) }
    catch (e) { setError(e instanceof Error ? e.message : '儲存失敗，請重試'); setSaving(false) }
  }

  return (
    <AdminModal saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
      <h3 className="text-lg font-bold mb-3 flex items-center gap-2 shrink-0">
        <span className="text-accent-orange">✎</span> 編輯模組
        <span className="text-text-dim text-sm font-normal ml-1">{form.id}</span>
      </h3>

      <AdminEditTabs
        tabs={EDIT_TABS.map((t) => ({
          ...t,
          badge:
            t.id === 'levels'      ? (form.levels ?? []).length :
            t.id === 'conditional' ? (form.conditionalEffects ?? []).length : undefined,
        }))}
        active={editTab}
        onChange={setEditTab}
      />

      <div className="overflow-y-auto flex-1 pr-1">
        {editTab === 'basic' && (
          /* PLAN-033 C-2：本頁原為一條垂直堆疊——名稱／圖示／180px 描述 textarea／
             RefPicker，後面再接 7 個分類與關聯設定，長到必須捲兩屏。
             拆成左「文本」右「分類與關聯設定」雙欄；RefPicker 留左欄，它解析的
             就是上方 description 的 [xxx]，分開就看不到對照。 */
          <div className={GRID_TWO_PANE}>
            <div className="space-y-3 min-w-0">
              <Field label="名稱">
                <input value={form.name} onChange={(e) => update('name', e.target.value)} className="input-field" />
              </Field>
              <IconField label="圖示 icon" value={form.icon} onChange={(v) => update('icon', v || undefined)} defaultFolder="modules" />
              <Field label="效果描述（滿等效果）">
                <p className="text-[12px] text-text-dim mb-1.5 leading-relaxed">
                  此處填<span className="text-accent-yellow">滿等（最高等級）</span>的效果描述，會直接顯示在前台模組卡片上；各等級的差異值另在「等級資料」分頁維護。
                </p>
                <textarea value={form.description} onChange={(e) => update('description', e.target.value)} className="input-field min-h-[180px] resize-y" />
              </Field>
              <RefPicker
                text={form.description}
                // 各等級未自填 refs 時前台回退到這份（moduleRefs.levelRefs），
                // 故等級文本獨有的 [xxx] 不算殘留
                siblingTexts={(form.levels ?? []).map((lv) => lv.description)}
                value={form.descriptionRefs}
                onChange={(refs) => update('descriptionRefs', refs)}
                onCompileText={(tf) => update('description', tf(form.description))}
              />
            </div>

            <div className="space-y-3 min-w-0">
              <Field label="模組增加等級 moduleAddLevel（配裝模擬器用，預設 1）">
                <input type="number" min={0} value={form.moduleAddLevel ?? 1} onChange={(e) => update('moduleAddLevel', Number(e.target.value))} className="input-field" />
              </Field>
              <Field label="槽位">
                <select value={form.slot} onChange={(e) => update('slot', e.target.value)} className="input-field">
                  {SLOT_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="品質">
                <select value={form.rarity} onChange={(e) => update('rarity', e.target.value)} className="input-field">
                  {Object.values(ModuleRarity).map((r) => <option key={r} value={r}>{r} 級</option>)}
                </select>
              </Field>
              <Field label="綁定機甲">
                <select value={form.boundMechId ?? ''} onChange={(e) => update('boundMechId', e.target.value || null)} className="input-field">
                  <option value="">不綁定（通用模組）</option>
                  {mechs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <p className="text-[14px] text-text-dim mt-1 leading-relaxed">
                  這是<span className="text-accent-orange">使用限制</span>，不是取得途徑：綁定後，傷害模擬時此模組
                  <span className="text-accent-orange">只能裝在該機甲上</span>，其他機甲一律無法使用。
                  <br />
                  若只是「拆這台機甲可以取得此模組」，請改在下方的
                  <span className="text-accent-cyan">拆解來源機甲</span>勾選，
                  <span className="text-accent-red">不要</span>在此綁定 —— 誤綁會讓模組在模擬器裡消失於其他機甲的可選清單。
                  <br />
                  通用模組請保持「不綁定」（機甲的8級模組只要機甲有設定就會自動對應到模組圖鑑）。
                </p>
              </Field>
              <Field label="綁定部位（複選，空白=不限）">
                <div className="flex flex-wrap gap-4 mt-1">
                  {PART_OPTIONS.map(({ value, label }) => {
                    const parts = Array.isArray(form.boundPart) ? form.boundPart : (form.boundPart ? [form.boundPart as string] : [])
                    const checked = parts.includes(value)
                    return (
                      <label key={value} className="flex items-center gap-1.5 text-sm cursor-pointer hover:text-text-primary">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = checked ? parts.filter((p) => p !== value) : [...parts, value]
                            update('boundPart', next.length > 0 ? next : null)
                          }}
                          className="accent-accent-orange w-3.5 h-3.5"
                        />
                        {label}
                      </label>
                    )
                  })}
                </div>
                {(!form.boundPart || (Array.isArray(form.boundPart) && form.boundPart.length === 0)) && (
                  <p className="text-[14px] text-text-dim mt-1">不限部位</p>
                )}
                {/* PLAN-052-K：`boundPart` 不只是顯示用的標籤，它是**專屬模組逐部位等級的輸入**——
                    level = (levels.length > boundPart.length) ? 2 : 1。沒填就會從每一格靜默消失。 */}
                {form.slot === ModuleSlot.EXCLUSIVE && (!form.boundPart || form.boundPart.length === 0) && (
                  <p className="text-[14px] text-accent-yellow mt-1 leading-relaxed">
                    ⚠ 專屬模組沒填綁定部位，會<b>從機甲的每一個部位消失</b>（不是不限部位）——
                    它與 <code>levels[]</code> 的階數一起決定「這顆在哪一格出幾級」。
                  </p>
                )}
              </Field>
              <SlotLevelMultiplierField
                value={form.slotLevelMultiplier}
                onChange={(v) => update('slotLevelMultiplier', v)}
              />
              <UnlockConditionField
                value={form.unlockCondition}
                boundMechId={form.boundMechId}
                onChange={(v) => update('unlockCondition', v)}
              />
              <Field label="遊戲取得途徑（複選）">
                <div className="flex flex-wrap gap-4 mt-1">
                  {Object.values(ModuleSource).map((v) => {
                    const sources = Array.isArray(form.source) ? form.source : (form.source ? [form.source as string] : [])
                    const checked = sources.includes(v)
                    return (
                      <label key={v} className="flex items-center gap-1.5 text-sm cursor-pointer hover:text-text-primary">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            let next = checked ? sources.filter((s) => s !== v) : [...sources, v]
                            if (next.some((s) => s !== ModuleSource.UNKNOWN)) {
                              next = next.filter((s) => s !== ModuleSource.UNKNOWN)
                            }
                            update('source', next)
                          }}
                          className="accent-accent-orange w-3.5 h-3.5"
                        />
                        {v}
                      </label>
                    )
                  })}
                </div>
              </Field>
              <Field label="拆解來源機甲（可拆哪些機甲取得此模組）">
                <p className="text-[14px] text-text-dim mt-1 mb-1.5 leading-relaxed">
                  只影響<span className="text-accent-cyan">取得途徑</span>的顯示，
                  <span className="text-accent-red">不會</span>限制模組能裝在哪台機甲。
                  使用限制請設上方的<span className="text-accent-orange">綁定機甲</span>。
                </p>
                <div className="mt-1 border border-border rounded-lg max-h-44 overflow-y-auto divide-y divide-border/40">
                  {mechs.length === 0 ? (
                    <p className="text-xs text-text-dim p-2">載入機甲中...</p>
                  ) : (
                    mechs.map((m) => {
                      const ids    = form.dismantleMechIds ?? []
                      const checked = ids.includes(m.id)
                      return (
                        <label key={m.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-bg-dark/60">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const next = checked ? ids.filter((id) => id !== m.id) : [...ids, m.id]
                              update('dismantleMechIds', next)
                            }}
                            className="accent-accent-orange w-3.5 h-3.5 shrink-0"
                          />
                          <span className="text-sm text-text-secondary flex-1">{m.name}</span>
                          <span className="text-[13px] text-text-dim shrink-0">{m.id}</span>
                        </label>
                      )
                    })
                  )}
                </div>
                {(form.dismantleMechIds ?? []).length > 0 && (
                  <p className="text-[14px] text-accent-cyan mt-1">
                    已選：{(form.dismantleMechIds ?? []).map((id) => mechs.find((m) => m.id === id)?.name ?? id).join('、')}
                  </p>
                )}
              </Field>
              <Field label="資料維護標記">
                <select value={form.managedBy ?? ModuleDataSource.MANUAL} onChange={(e) => update('managedBy', e.target.value)} className="input-field">
                  <option value={ModuleDataSource.MANUAL}>手動新增 (manual)</option>
                  <option value={ModuleDataSource.AUTO}>腳本自動擷取 (auto)</option>
                </select>
              </Field>
            </div>
          </div>
        )}

        {editTab === 'stats' && (
          <div className={`${GRID_AUTO_FIELDS} gap-3`}>
            <Field label="增傷 (%)"><input type="number" value={form.dmg} onChange={(e) => update('dmg', Number(e.target.value))} className="input-field" /></Field>
            <Field label="暴擊率"><input type="number" value={form.crit_rate ?? 0} onChange={(e) => update('crit_rate', Number(e.target.value))} className="input-field" /></Field>
            <Field label="暴擊傷害 (%)"><input type="number" value={form.critDmg} onChange={(e) => update('critDmg', Number(e.target.value))} className="input-field" /></Field>
            <Field label="命中率"><input type="number" value={form.acc_rate ?? 0} onChange={(e) => update('acc_rate', Number(e.target.value))} className="input-field" /></Field>
            <Field label="火力提升 (%)"><input type="number" value={form.firepower_rate ?? 0} onChange={(e) => update('firepower_rate', Number(e.target.value))} className="input-field" /></Field>
            <Field label="護甲提升 (%)"><input type="number" value={form.armor_rate ?? 0} onChange={(e) => update('armor_rate', Number(e.target.value))} className="input-field" /></Field>
            <Field label="機甲出力增加"><input type="number" value={form.output_bonus ?? 0} onChange={(e) => update('output_bonus', Number(e.target.value))} className="input-field" /></Field>
            <Field label="被暴擊率降低 (%)"><input type="number" value={form.crit_resist_rate ?? 0} onChange={(e) => update('crit_resist_rate', Number(e.target.value))} className="input-field" /></Field>
            <Field label="回避率 (%)"><input type="number" value={form.dodge_rate ?? 0} onChange={(e) => update('dodge_rate', Number(e.target.value))} className="input-field" /></Field>
            <Field label="耐久值提升 (%)"><input type="number" value={form.durable_rate ?? 0} onChange={(e) => update('durable_rate', Number(e.target.value))} className="input-field" /></Field>
            <Field label="遭受傷害降低 (%)"><input type="number" value={form.dmg_resist_rate ?? 0} onChange={(e) => update('dmg_resist_rate', Number(e.target.value))} className="input-field" /></Field>
          </div>
        )}

        {editTab === 'weapon' && (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-text-dim font-medium tracking-wider uppercase mb-2">大分類增傷 (%)</p>
              <div className={`${GRID_AUTO_FIELDS} gap-3`}>
                <Field label="突擊武器增傷"><input type="number" value={form.dmg_assault ?? 0} onChange={(e) => update('dmg_assault', Number(e.target.value))} className="input-field" /></Field>
                <Field label="格鬥武器增傷"><input type="number" value={form.dmg_melee ?? 0} onChange={(e) => update('dmg_melee', Number(e.target.value))} className="input-field" /></Field>
                <Field label="射擊武器增傷"><input type="number" value={form.dmg_shooting ?? 0} onChange={(e) => update('dmg_shooting', Number(e.target.value))} className="input-field" /></Field>
                <Field label="戰術武器增傷"><input type="number" value={form.dmg_tactical ?? 0} onChange={(e) => update('dmg_tactical', Number(e.target.value))} className="input-field" /></Field>
              </div>
            </div>
            <div className="pt-2 border-t border-border/60">
              <p className="text-xs text-text-dim font-medium tracking-wider uppercase mb-2">突擊細分 (%)</p>
              <div className={`${GRID_AUTO_FIELDS} gap-3`}>
                <Field label="機槍增傷"><input type="number" value={form.dmg_machinegun ?? 0} onChange={(e) => update('dmg_machinegun', Number(e.target.value))} className="input-field" /></Field>
                <Field label="重機槍增傷"><input type="number" value={form.dmg_heavy_machinegun ?? 0} onChange={(e) => update('dmg_heavy_machinegun', Number(e.target.value))} className="input-field" /></Field>
                <Field label="霰彈增傷"><input type="number" value={form.dmg_shotgun ?? 0} onChange={(e) => update('dmg_shotgun', Number(e.target.value))} className="input-field" /></Field>
                <Field label="噴火器增傷"><input type="number" value={form.dmg_flamethrower ?? 0} onChange={(e) => update('dmg_flamethrower', Number(e.target.value))} className="input-field" /></Field>
              </div>
            </div>
            <div className="pt-2 border-t border-border/60">
              <p className="text-xs text-text-dim font-medium tracking-wider uppercase mb-2">格鬥細分 (%)</p>
              <div className={`${GRID_AUTO_FIELDS} gap-3`}>
                <Field label="刀劍增傷"><input type="number" value={form.dmg_blade ?? 0} onChange={(e) => update('dmg_blade', Number(e.target.value))} className="input-field" /></Field>
                <Field label="長柄增傷"><input type="number" value={form.dmg_polearm ?? 0} onChange={(e) => update('dmg_polearm', Number(e.target.value))} className="input-field" /></Field>
                <Field label="拳套增傷"><input type="number" value={form.dmg_fist ?? 0} onChange={(e) => update('dmg_fist', Number(e.target.value))} className="input-field" /></Field>
                <Field label="打樁機增傷"><input type="number" value={form.dmg_pile ?? 0} onChange={(e) => update('dmg_pile', Number(e.target.value))} className="input-field" /></Field>
                <Field label="電鋸增傷"><input type="number" value={form.dmg_chainsaw ?? 0} onChange={(e) => update('dmg_chainsaw', Number(e.target.value))} className="input-field" /></Field>
              </div>
            </div>
            <div className="pt-2 border-t border-border/60">
              <p className="text-xs text-text-dim font-medium tracking-wider uppercase mb-2">射擊細分 (%)</p>
              <div className={`${GRID_AUTO_FIELDS} gap-3`}>
                <Field label="輕型狙擊步槍增傷"><input type="number" value={form.dmg_sniper_light ?? 0} onChange={(e) => update('dmg_sniper_light', Number(e.target.value))} className="input-field" /></Field>
                <Field label="狙擊步槍增傷"><input type="number" value={form.dmg_sniper ?? 0} onChange={(e) => update('dmg_sniper', Number(e.target.value))} className="input-field" /></Field>
              </div>
            </div>
            <div className="pt-2 border-t border-border/60">
              <p className="text-xs text-text-dim font-medium tracking-wider uppercase mb-2">戰術細分 (%)</p>
              <div className={`${GRID_AUTO_FIELDS} gap-3`}>
                <Field label="導彈增傷"><input type="number" value={form.dmg_missile ?? 0} onChange={(e) => update('dmg_missile', Number(e.target.value))} className="input-field" /></Field>
                <Field label="火箭增傷"><input type="number" value={form.dmg_rocket ?? 0} onChange={(e) => update('dmg_rocket', Number(e.target.value))} className="input-field" /></Field>
                <Field label="電磁炮增傷"><input type="number" value={form.dmg_railgun ?? 0} onChange={(e) => update('dmg_railgun', Number(e.target.value))} className="input-field" /></Field>
                <Field label="浮游炮增傷"><input type="number" value={form.dmg_funnel ?? 0} onChange={(e) => update('dmg_funnel', Number(e.target.value))} className="input-field" /></Field>
              </div>
            </div>
            <div className="pt-2 border-t border-border/60">
              <p className="text-xs text-text-dim font-medium tracking-wider uppercase mb-2">其他觸發增傷 (%)</p>
              <div className={`${GRID_AUTO_FIELDS} gap-3`}>
                <Field label="反擊增傷"><input type="number" value={form.dmg_counter ?? 0} onChange={(e) => update('dmg_counter', Number(e.target.value))} className="input-field" /></Field>
                <Field label="敵方階段增傷"><input type="number" value={form.dmg_enemy_phase ?? 0} onChange={(e) => update('dmg_enemy_phase', Number(e.target.value))} className="input-field" /></Field>
              </div>
            </div>
          </div>
        )}

        {editTab === 'levels' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-text-dim font-medium tracking-wider uppercase">模組等級 levels</span>
              <button
                onClick={() =>
                  update('levels', [
                    ...(form.levels ?? []),
                    {
                      level: (form.levels?.length ?? 0) + 1,
                      description: '',
                      dmg: 0, crit_rate: 0, critDmg: 0, acc_rate: 0,
                      firepower_rate: 0, armor_rate: 0, crit_resist_rate: 0,
                      output_bonus: 0, dodge_rate: 0, durable_rate: 0, dmg_resist_rate: 0,
                    },
                  ])
                }
                className="text-xs text-accent-cyan hover:text-accent-cyan/80 transition-colors"
              >
                + 新增等級
              </button>
            </div>
            {(form.levels ?? []).length === 0 ? (
              <p className="text-xs text-text-dim py-4 text-center">無等級資料</p>
            ) : (
              <div className="space-y-2">
                {(form.levels ?? []).map((lv, idx) => (
                  <ModuleLevelItem
                    key={idx}
                    levelData={lv}
                    index={idx}
                    onChange={(updated) => {
                      const arr = [...(form.levels ?? [])]
                      arr[idx] = updated
                      update('levels', arr)
                    }}
                    onRemove={() => update('levels', (form.levels ?? []).filter((_, i) => i !== idx))}
                    topDescription={form.description}
                    topRefs={form.descriptionRefs}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {editTab === 'conditional' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-text-dim font-medium tracking-wider uppercase">條件效果 conditionalEffects</span>
              <button
                onClick={() =>
                  update('conditionalEffects', [
                    ...(form.conditionalEffects ?? []),
                    { trigger: ConditionalTrigger.PER_BUFF_HELD, stats: [] },
                  ])
                }
                className="text-xs text-accent-cyan hover:text-accent-cyan/80 transition-colors"
              >
                + 新增條件效果
              </button>
            </div>
            {(form.conditionalEffects ?? []).length === 0 ? (
              <p className="text-xs text-text-dim py-4 text-center">無條件效果</p>
            ) : (
              <div className="space-y-3">
                {(form.conditionalEffects ?? []).map((ce, idx) => (
                  <ConditionalEffectItem
                    key={idx}
                    effect={ce}
                    index={idx}
                    onChange={(updated) => {
                      const arr = [...(form.conditionalEffects ?? [])]
                      arr[idx] = updated
                      update('conditionalEffects', arr)
                    }}
                    onRemove={() =>
                      update('conditionalEffects', (form.conditionalEffects ?? []).filter((_, i) => i !== idx))
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AdminModal>
  )
}

// ─── 模組管理列表 ──────────────────────────────────────────────────────────────
export default function ModuleAdmin({
  mechs,
  initialSearch = '',
}: {
  mechs: Mech[]
  initialSearch?: string
}) {
  const [editing, setEditing] = useState<Module | null>(null)
  const draft = useDraftRestore<Module>('modules')
  const gd = useGameData()

  const {
    items: filtered, loading, error, hasMore, search, setSearch,
    filters, setFilter, submitSearch, loadMore, upsert,
  } = useClientPaged<Module, ModuleFilters>({
    source: gd.modules,
    initialSearch,
    initialFilters: { slot: 'all', bound: 'all', stats: 'all', source: 'all' },
    matchFilters: (m, f) =>
      (f.slot === 'all' || m.slot === f.slot) &&
      (f.bound === 'all' || (f.bound === 'bound' ? !!m.boundMechId : !m.boundMechId)) &&
      (f.stats === 'all' || (f.stats === 'has' ? moduleHasStats(m) : !moduleHasStats(m))) &&
      (f.source === 'all' ||
        (Array.isArray(m.source) ? m.source.includes(f.source) : m.source === f.source)),
  })

  // ── 新增模組：先選模組類型，再依類型決定 ID 前綴 ─────────────────────────
  //   特性 / 八級 / 通用 → mod_<名稱>
  //   機甲副模組         → sub_mod_<名稱>
  //   機甲專屬模組       → mod_<機甲名>_fixed_<n>（n 自動接續既有序號）
  // 機甲用下拉選而非手打，從源頭杜絕打錯字（歷史上就是手打 ID 造成 "莫日" 這類髒資料）。
  const [newSlot, setNewSlot] = useState<ModuleSlot>(ModuleSlot.SLOT_4)
  const [newMechId, setNewMechId] = useState('')

  const isExclusive = newSlot === ModuleSlot.EXCLUSIVE
  const idPrefix = newSlot === ModuleSlot.BUILT_IN ? 'sub_mod' : 'mod'
  const newMech = mechs.find((m) => m.id === newMechId) ?? null

  function deriveModuleId(name: string): string {
    if (!name.trim()) return ''
    // 專屬模組的 ID 只由機甲決定、與模組名稱無關；未選機甲則無法生成
    if (isExclusive) return newMech ? makeExclusiveModuleId(newMech.name, gd.modules) : ''
    return makeEntityId(idPrefix, name)
  }

  const {
    creating, newId, setNewId, newIdError, setNewIdError,
    openCreate, cancelCreate, confirmCreate, derivedId,
  } = useNewItemCreation(
    gd.modules, // 用全量而非當前分頁 filtered，否則撞名檢查會漏掉沒載入的項目
    (m) => m.id,
    (id, name) => ({
      ...makeDefaultModule(id),
      name: stripIdPrefix(idPrefix, name),
      slot: newSlot,
      boundMechId: isExclusive ? newMechId : null,
    }),
    deriveModuleId,
  )

  function openCreateReset() {
    setNewSlot(ModuleSlot.SLOT_4)
    setNewMechId('')
    openCreate()
  }

  async function confirmCreateChecked() {
    if (!derivedId) {
      setNewIdError(isExclusive && !newMechId ? '請先選擇綁定機甲' : '請輸入名稱')
      return
    }
    if (await docExists('modules', derivedId)) { setNewIdError(`ID「${derivedId}」已存在`); return }
    const item = confirmCreate()
    if (item) setEditing(item)
  }

  async function handleSave(updated: Module) {
    const version = await updateModule(updated)
    upsert(updated)
    gd.patchCollectionItem('modules', updated, version)
    draft.commit()   // 存檔成功 → 清除本機草稿，避免下次進頁跳過期提示
    setEditing(null)
  }

  return (
    <div>
      <DraftRestoreBar draft={draft} onRestore={setEditing} />
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitSearch() }}
          placeholder="搜尋名稱開頭（Enter 搜尋）..."
          className="flex-1 min-w-[180px] px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-orange"
        />
        <button
          onClick={submitSearch}
          className="px-3 py-2 bg-bg-dark border border-border text-text-secondary text-sm rounded-lg hover:border-border-accent hover:text-text-primary transition-colors"
        >
          搜尋
        </button>
        <select value={filters.slot} onChange={(e) => setFilter('slot', e.target.value)} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部槽位</option>
          {SLOT_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={filters.bound} onChange={(e) => setFilter('bound', e.target.value as ModuleFilters['bound'])} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部綁定</option>
          <option value="bound">已綁定機甲</option>
          <option value="unbound">未綁定（通用）</option>
        </select>
        <select value={filters.stats} onChange={(e) => setFilter('stats', e.target.value as ModuleFilters['stats'])} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部數值</option>
          <option value="has">已填數值</option>
          <option value="none">尚未填值</option>
        </select>
        <select value={filters.source} onChange={(e) => setFilter('source', e.target.value)} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部來源</option>
          {Object.values(ModuleSource).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="text-text-dim text-xs">
          {error ? <span className="text-accent-red">載入失敗：{error}</span>
            : loading ? '載入中...'
            : `顯示 ${filtered.length} 個模組${hasMore ? '（可載入更多）' : ''}`}
        </p>
        <button
          onClick={openCreateReset}
          className="text-xs px-3 py-1.5 bg-accent-orange text-black font-bold rounded-lg hover:opacity-90 transition-opacity"
        >
          + 新增模組
        </button>
      </div>

      <NewItemDialog
        creating={creating}
        newId={newId}
        newIdError={newIdError}
        placeholder="模組名稱，例：末日中樞"
        hint={<>先選模組類型，再輸入名稱；文件 ID 由系統依類型自動生成（儲存後不可更改）</>}
        deriveMode
        derivedId={derivedId}
        extra={
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={newSlot}
              onChange={(e) => { setNewSlot(e.target.value as ModuleSlot); setNewIdError('') }}
              className="px-3 py-2 rounded-lg bg-bg-card border border-border text-text-primary text-sm"
            >
              {SLOT_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
            {isExclusive && (
              <select
                value={newMechId}
                onChange={(e) => { setNewMechId(e.target.value); setNewIdError('') }}
                className="px-3 py-2 rounded-lg bg-bg-card border border-border text-text-primary text-sm"
              >
                <option value="">— 選擇綁定機甲 —</option>
                {mechs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
            <span className="text-xs text-text-dim">
              前綴{' '}
              <span className="text-accent-cyan font-mono">
                {isExclusive ? 'mod_<機甲名>_fixed_n' : `${idPrefix}_`}
              </span>
            </span>
            {isExclusive && !newMechId && (
              <span className="text-xs text-accent-red">⚠ 專屬模組需先選擇機甲才能生成 ID</span>
            )}
          </div>
        }
        onChangeId={(v) => { setNewId(v); setNewIdError('') }}
        onConfirm={() => { void confirmCreateChecked() }}
        onCancel={cancelCreate}
      />

      <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
        {filtered.map((mod) => (
          <div
            key={mod.id}
            className="bg-bg-dark border border-border rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-border-accent transition-colors cursor-pointer"
            onClick={() => setEditing(mod)}
          >
            {mod.icon && (
              <img src={mod.icon} alt="" className="w-8 h-8 rounded shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm text-text-primary truncate">
                  {mod.name || <span className="text-text-dim font-normal">（未命名）</span>}
                </span>
                <span className="text-[13px] px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-dim shrink-0">
                  {SLOT_LABEL[mod.slot] ?? mod.slot}
                </span>
                {mod.managedBy === ModuleDataSource.AUTO && (
                  <span className="text-[13px] px-1.5 py-0.5 rounded bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/30 shrink-0">自動</span>
                )}
                {Array.isArray(mod.source) && mod.source.length > 0 && (
                  <span className="text-[13px] px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-dim shrink-0">
                    {mod.source.join('・')}
                  </span>
                )}
                {moduleHasStats(mod) && (
                  <span className="text-[13px] text-accent-green shrink-0">
                    {mod.dmg > 0 && `傷+${mod.dmg}%`}
                    {(mod.crit_rate ?? 0) > 0 && ` 暴+${mod.crit_rate}`}
                    {mod.critDmg > 0 && ` 爆傷+${mod.critDmg}%`}
                    {(mod.acc_rate ?? 0) > 0 && ` 命+${mod.acc_rate}`}
                    {(mod.firepower_rate ?? 0) > 0 && ` 火力+${mod.firepower_rate}%`}
                    {(mod.output_bonus ?? 0) > 0 && ` 出力+${mod.output_bonus}`}
                  </span>
                )}
              </div>
              <p className="text-xs text-text-dim truncate mt-0.5">{mod.description || '（無描述）'}</p>
            </div>
            <div className="text-right shrink-0 ml-2">
              {mod.boundMechId ? (
                <span className="text-[14px] text-accent-orange">
                  {mechs.find((m) => m.id === mod.boundMechId)?.name ?? mod.boundMechId}
                </span>
              ) : (
                <span className="text-[14px] text-text-dim">通用</span>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && !loading && (
          <p className="text-text-dim text-sm text-center py-8">找不到符合條件的模組</p>
        )}
      </div>

      <LoadMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />

      {editing && (
        <ModuleEditPanel
          module={editing}
          mechs={mechs}
          onSave={handleSave}
          onCancel={() => { draft.discard(); setEditing(null) }}
        />
      )}
    </div>
  )
}
