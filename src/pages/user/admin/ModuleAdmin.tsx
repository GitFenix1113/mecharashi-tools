import { useState, useEffect } from 'react'
import type { Module, Mech, ConditionalEffect, ModuleLevel } from '../../../types'
import {
  ModuleRarity, ModuleSlot, ModuleSource, ModuleDataSource, ConditionalTrigger,
} from '../../../types/enums'
import { Field, AdminModal, useNewItemCreation, NewItemDialog, useServerPaged, LoadMoreButton } from './shared'
import { getCollectionPage, updateModule, docExists } from '../../../lib/firestoreApi'
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

      <div className="grid grid-cols-2 gap-2">
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
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Field label="基礎加成 base（選填）">
          <input type="number" value={effect.base ?? ''} onChange={(e) => upd('base', e.target.value === '' ? undefined : Number(e.target.value))} className="input-field" placeholder="—" />
        </Field>
        <Field label="每單位追加 scale（選填）">
          <input type="number" value={effect.scale ?? ''} onChange={(e) => upd('scale', e.target.value === '' ? undefined : Number(e.target.value))} className="input-field" placeholder="—" />
        </Field>
        <Field label="總加成上限 max（選填）">
          <input type="number" value={effect.max ?? ''} onChange={(e) => upd('max', e.target.value === '' ? undefined : Number(e.target.value))} className="input-field" placeholder="—" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
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
}: {
  levelData: ModuleLevel
  index: number
  onChange: (updated: ModuleLevel) => void
  onRemove: () => void
}) {
  const [collapsed, setCollapsed] = useState(index > 0)

  function upd<K extends keyof ModuleLevel>(key: K, value: ModuleLevel[K]) {
    onChange({ ...levelData, [key]: value })
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
          <div className="grid grid-cols-2 gap-2">
            <Field label="等級 level">
              <input type="number" value={levelData.level} onChange={(e) => upd('level', Number(e.target.value))} className="input-field" />
            </Field>
            <Field label="效果描述 description">
              <input type="text" value={levelData.description} onChange={(e) => upd('description', e.target.value)} className="input-field" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
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
          <div className="pt-2 border-t border-border/40">
            <p className="text-[13px] text-text-dim font-medium tracking-wider uppercase mb-2">武器專屬增傷 (%)</p>
            <div className="grid grid-cols-2 gap-2">
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
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 模組編輯面板 ──────────────────────────────────────────────────────────────
type EditTab = 'basic' | 'stats' | 'weapon' | 'levels' | 'conditional'

const EDIT_TABS: { id: EditTab; label: string }[] = [
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

      {/* Tab 列 */}
      <div className="flex gap-1 mb-4 shrink-0 flex-wrap">
        {EDIT_TABS.map((t) => {
          const hasBadge =
            (t.id === 'levels' && (form.levels ?? []).length > 0) ||
            (t.id === 'conditional' && (form.conditionalEffects ?? []).length > 0)
          return (
            <button
              key={t.id}
              onClick={() => setEditTab(t.id)}
              className={`relative px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                editTab === t.id
                  ? 'bg-accent-orange text-black'
                  : 'bg-bg-dark border border-border text-text-secondary hover:text-text-primary'
              }`}
            >
              {t.label}
              {hasBadge && (
                <span className={`ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[12px] font-bold ${editTab === t.id ? 'bg-black/20 text-black' : 'bg-accent-cyan/20 text-accent-cyan'}`}>
                  {t.id === 'levels' ? (form.levels ?? []).length : (form.conditionalEffects ?? []).length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="overflow-y-auto flex-1 pr-1">
        {editTab === 'basic' && (
          <div className="space-y-3">
            <Field label="名稱">
              <input value={form.name} onChange={(e) => update('name', e.target.value)} className="input-field" />
            </Field>
            <IconField label="圖示 icon" value={form.icon} onChange={(v) => update('icon', v || undefined)} defaultFolder="modules" />
            <Field label="效果描述">
              <textarea value={form.description} onChange={(e) => update('description', e.target.value)} className="input-field min-h-[80px] resize-y" />
            </Field>
            <RefPicker
              text={form.description}
              value={form.descriptionRefs}
              onChange={(refs) => update('descriptionRefs', refs)}
            />
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
            </Field>
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
        )}

        {editTab === 'stats' && (
          <div className="grid grid-cols-2 gap-3">
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
              <div className="grid grid-cols-2 gap-3">
                <Field label="突擊武器增傷"><input type="number" value={form.dmg_assault ?? 0} onChange={(e) => update('dmg_assault', Number(e.target.value))} className="input-field" /></Field>
                <Field label="格鬥武器增傷"><input type="number" value={form.dmg_melee ?? 0} onChange={(e) => update('dmg_melee', Number(e.target.value))} className="input-field" /></Field>
                <Field label="射擊武器增傷"><input type="number" value={form.dmg_shooting ?? 0} onChange={(e) => update('dmg_shooting', Number(e.target.value))} className="input-field" /></Field>
                <Field label="戰術武器增傷"><input type="number" value={form.dmg_tactical ?? 0} onChange={(e) => update('dmg_tactical', Number(e.target.value))} className="input-field" /></Field>
              </div>
            </div>
            <div className="pt-2 border-t border-border/60">
              <p className="text-xs text-text-dim font-medium tracking-wider uppercase mb-2">突擊細分 (%)</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="機槍增傷"><input type="number" value={form.dmg_machinegun ?? 0} onChange={(e) => update('dmg_machinegun', Number(e.target.value))} className="input-field" /></Field>
                <Field label="重機槍增傷"><input type="number" value={form.dmg_heavy_machinegun ?? 0} onChange={(e) => update('dmg_heavy_machinegun', Number(e.target.value))} className="input-field" /></Field>
                <Field label="霰彈增傷"><input type="number" value={form.dmg_shotgun ?? 0} onChange={(e) => update('dmg_shotgun', Number(e.target.value))} className="input-field" /></Field>
                <Field label="噴火器增傷"><input type="number" value={form.dmg_flamethrower ?? 0} onChange={(e) => update('dmg_flamethrower', Number(e.target.value))} className="input-field" /></Field>
              </div>
            </div>
            <div className="pt-2 border-t border-border/60">
              <p className="text-xs text-text-dim font-medium tracking-wider uppercase mb-2">格鬥細分 (%)</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="刀劍增傷"><input type="number" value={form.dmg_blade ?? 0} onChange={(e) => update('dmg_blade', Number(e.target.value))} className="input-field" /></Field>
                <Field label="長柄增傷"><input type="number" value={form.dmg_polearm ?? 0} onChange={(e) => update('dmg_polearm', Number(e.target.value))} className="input-field" /></Field>
                <Field label="拳套增傷"><input type="number" value={form.dmg_fist ?? 0} onChange={(e) => update('dmg_fist', Number(e.target.value))} className="input-field" /></Field>
                <Field label="打樁機增傷"><input type="number" value={form.dmg_pile ?? 0} onChange={(e) => update('dmg_pile', Number(e.target.value))} className="input-field" /></Field>
                <Field label="電鋸增傷"><input type="number" value={form.dmg_chainsaw ?? 0} onChange={(e) => update('dmg_chainsaw', Number(e.target.value))} className="input-field" /></Field>
              </div>
            </div>
            <div className="pt-2 border-t border-border/60">
              <p className="text-xs text-text-dim font-medium tracking-wider uppercase mb-2">射擊細分 (%)</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="輕型狙擊步槍增傷"><input type="number" value={form.dmg_sniper_light ?? 0} onChange={(e) => update('dmg_sniper_light', Number(e.target.value))} className="input-field" /></Field>
                <Field label="狙擊步槍增傷"><input type="number" value={form.dmg_sniper ?? 0} onChange={(e) => update('dmg_sniper', Number(e.target.value))} className="input-field" /></Field>
              </div>
            </div>
            <div className="pt-2 border-t border-border/60">
              <p className="text-xs text-text-dim font-medium tracking-wider uppercase mb-2">戰術細分 (%)</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="導彈增傷"><input type="number" value={form.dmg_missile ?? 0} onChange={(e) => update('dmg_missile', Number(e.target.value))} className="input-field" /></Field>
                <Field label="火箭增傷"><input type="number" value={form.dmg_rocket ?? 0} onChange={(e) => update('dmg_rocket', Number(e.target.value))} className="input-field" /></Field>
                <Field label="電磁炮增傷"><input type="number" value={form.dmg_railgun ?? 0} onChange={(e) => update('dmg_railgun', Number(e.target.value))} className="input-field" /></Field>
                <Field label="浮游炮增傷"><input type="number" value={form.dmg_funnel ?? 0} onChange={(e) => update('dmg_funnel', Number(e.target.value))} className="input-field" /></Field>
              </div>
            </div>
            <div className="pt-2 border-t border-border/60">
              <p className="text-xs text-text-dim font-medium tracking-wider uppercase mb-2">其他觸發增傷 (%)</p>
              <div className="grid grid-cols-2 gap-3">
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
  const gd = useGameData()

  const {
    items: filtered, loading, error, hasMore, search, setSearch,
    filters, setFilter, submitSearch, loadMore, upsert,
  } = useServerPaged<Module, ModuleFilters>({
    fetchPage: (opts) => getCollectionPage<Module>('modules', opts),
    initialSearch,
    initialFilters: { slot: 'all', bound: 'all', stats: 'all', source: 'all' },
    // 伺服器端只放可乾淨等值表達者：slot。
    // 綁定狀態（boundMechId 可能為 null 或欄位不存在，== null 查不到後者）、
    // 數值有無、來源（陣列）一律由 matchFilters 前端過濾，避免漏抓。
    toEquals: (f) => ({ ...(f.slot !== 'all' ? { slot: f.slot } : {}) }),
    matchFilters: (m, f) =>
      (f.slot === 'all' || m.slot === f.slot) &&
      (f.bound === 'all' || (f.bound === 'bound' ? !!m.boundMechId : !m.boundMechId)) &&
      (f.stats === 'all' || (f.stats === 'has' ? moduleHasStats(m) : !moduleHasStats(m))) &&
      (f.source === 'all' ||
        (Array.isArray(m.source) ? m.source.includes(f.source) : m.source === f.source)),
  })

  const { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate } =
    useNewItemCreation(filtered, (m) => m.id, makeDefaultModule)

  async function confirmCreateChecked() {
    const id = newId.trim()
    if (id && await docExists('modules', id)) { setNewIdError(`ID「${id}」已存在`); return }
    const item = confirmCreate()
    if (item) setEditing(item)
  }

  async function handleSave(updated: Module) {
    const version = await updateModule(updated)
    upsert(updated)
    gd.patchCollectionItem('modules', updated, version)
    setEditing(null)
  }

  return (
    <div>
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
          onClick={openCreate}
          className="text-xs px-3 py-1.5 bg-accent-orange text-black font-bold rounded-lg hover:opacity-90 transition-opacity"
        >
          + 新增模組
        </button>
      </div>

      <NewItemDialog
        creating={creating}
        newId={newId}
        newIdError={newIdError}
        placeholder="mod_"
        hint={<>輸入新模組 ID（格式如 <span className="text-accent-cyan">mod_123</span>，儲存後不可更改）</>}
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
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}
