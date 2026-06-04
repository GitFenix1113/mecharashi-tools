import { useState, useEffect } from 'react'
import type { Component, ComponentBase, ConditionComponent, FunctionComponent } from '../../../types'
import {
  ComponentType, ConditionType, EffectType, ModuleSubtype, ItemRarity, WeaponType, ComponentsWType,
} from '../../../types/enums'
import { assetUrl } from '../../../utils/assets'
import { Field, AdminModal, useNewItemCreation, NewItemDialog, useServerPaged, LoadMoreButton } from './shared'
import { getCollectionPage, updateComponent, docExists } from '../../../lib/firestoreApi'
import {
  COMPONENT_TYPE_LABEL, CONDITION_TYPE_LABEL, EFFECT_TYPE_LABEL,
  MODULE_SUBTYPE_LABEL, COMPONENT_RARITY_CLASS,
} from './constants'

type ComponentFilters = { type: string; rarity: string; wType: string; subtype: number | 'all' }

// ─── 預設值工廠 ────────────────────────────────────────────────────────────────
function makeDefaultComponent(id: string): Component {
  return {
    id,
    name: '',
    componentType: ComponentType.CONDITION,
    moduleSubtype: ModuleSubtype.ATTACK_METHOD,
    probabilityLevel: 1,
    description: '',
    allowedWeaponTypes: Object.values(WeaponType),
    rarity: ItemRarity.A,
    icon: undefined,
    iconLocal: undefined,
    componentsWType: ComponentsWType.NORMAL,
    conditionType: ConditionType.ALWAYS,
    condition: '',
  } as ConditionComponent
}

// ─── 圖示預覽（含載入狀態診斷）────────────────────────────────────────────────
function ComponentIconPreview({
  outerFrameSrc,
  iconSrc,
  hasOuterFrameLocal,
}: {
  outerFrameSrc: string
  iconSrc?: string
  hasOuterFrameLocal: boolean
}) {
  const [frameStatus, setFrameStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [iconStatus, setIconStatus]   = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => { setFrameStatus('loading') }, [outerFrameSrc])
  useEffect(() => { setIconStatus('loading') }, [iconSrc])

  return (
    <div className="flex items-start gap-4 p-3 bg-bg-dark rounded-lg border border-border/60">
      <div className="relative w-20 h-20 shrink-0 rounded" style={{ background: '#3a3a4a' }}>
        <img
          src={outerFrameSrc}
          alt="outer frame"
          className="absolute object-contain"
          style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '80%', height: '80%' }}
          onLoad={() => setFrameStatus('ok')}
          onError={() => setFrameStatus('error')}
        />
        {iconSrc && (
          <img
            src={iconSrc}
            alt="skill icon"
            className="absolute object-contain"
            style={{ top: '50%', left: '50%', transform: 'translate(-51%, -52%) rotate(16deg)', width: '48%', height: '48%' }}
            onLoad={() => setIconStatus('ok')}
            onError={() => setIconStatus('error')}
          />
        )}
      </div>
      <div className="space-y-1 text-[12px] pt-0.5">
        <p className="text-text-secondary font-medium text-[13px]">圖示預覽</p>
        <p>
          <span className="text-text-dim mr-1">外框：</span>
          {frameStatus === 'ok'      && <span className="text-green-400">✓ 載入成功</span>}
          {frameStatus === 'error'   && <span className="text-accent-red">✗ 載入失敗</span>}
          {frameStatus === 'loading' && <span className="text-text-dim">載入中…</span>}
        </p>
        {iconSrc && (
          <p>
            <span className="text-text-dim mr-1">技能圖：</span>
            {iconStatus === 'ok'      && <span className="text-green-400">✓ 載入成功</span>}
            {iconStatus === 'error'   && <span className="text-accent-red">✗ 載入失敗</span>}
            {iconStatus === 'loading' && <span className="text-text-dim">載入中…</span>}
          </p>
        )}
        {!hasOuterFrameLocal && (
          <p className="text-accent-orange">⚠ outerFrameLocal 未設定，使用推算路徑</p>
        )}
        <p className="text-text-dim break-all max-w-xs leading-relaxed">{outerFrameSrc}</p>
      </div>
    </div>
  )
}

// ─── 元件編輯面板 ──────────────────────────────────────────────────────────────
function ComponentEditPanel({
  component: comp,
  onSave,
  onCancel,
}: {
  component: Component
  onSave: (c: Component) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm]     = useState<Component>({ ...comp })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => { setForm({ ...comp }) }, [comp])

  function updateBase<K extends keyof ComponentBase>(key: K, value: ComponentBase[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleTypeChange(newType: string) {
    if (newType === ComponentType.CONDITION) {
      setForm({
        ...form,
        componentType: ComponentType.CONDITION,
        conditionType: ConditionType.ALWAYS,
        condition: '',
      } as ConditionComponent)
    } else {
      const { condition: _cond, conditionType: _ct, ...rest } = form as ConditionComponent
      setForm({
        ...rest,
        componentType: ComponentType.FUNCTION,
        effectType: EffectType.DMG_BOOST,
      } as FunctionComponent)
    }
  }

  function toggleWeaponType(wt: string) {
    const current = form.allowedWeaponTypes ?? []
    const next = current.includes(wt) ? current.filter((x) => x !== wt) : [...current, wt]
    updateBase('allowedWeaponTypes', next)
  }

  async function handleSubmit() {
    setSaving(true); setError(null)
    try { await onSave(form) }
    catch (e) { setError(e instanceof Error ? e.message : '儲存失敗，請重試'); setSaving(false) }
  }

  const isCondition = form.componentType === ComponentType.CONDITION

  return (
    <AdminModal saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2 shrink-0">
        <span className={isCondition ? 'text-accent-purple' : 'text-accent-cyan'}>◆</span>
        {isCondition ? '編輯觸元件' : '編輯應元件'}
        <span className="text-text-dim text-sm font-normal ml-1">{form.id}</span>
      </h3>

      <div className="overflow-y-auto flex-1 pr-1 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="元件名稱 name">
            <input value={form.name} onChange={(e) => updateBase('name', e.target.value)} className="input-field" />
          </Field>
          <Field label="元件類型 componentType">
            <select value={form.componentType} onChange={(e) => handleTypeChange(e.target.value)} className="input-field">
              <option value={ComponentType.CONDITION}>Condition — 觸元件</option>
              <option value={ComponentType.FUNCTION}>Function — 應元件</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="稀有度 rarity">
            <select value={form.rarity} onChange={(e) => updateBase('rarity', e.target.value)} className="input-field">
              {Object.values(ItemRarity).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="元件等級 probabilityLevel">
            <input type="number" min={1} value={form.probabilityLevel} onChange={(e) => updateBase('probabilityLevel', Number(e.target.value))} className="input-field" />
          </Field>
          <Field label="W 類型 componentsWType">
            <select value={form.componentsWType} onChange={(e) => updateBase('componentsWType', e.target.value as 'W' | 'Normal')} className="input-field">
              <option value={ComponentsWType.NORMAL}>Normal — 一般元件</option>
              <option value={ComponentsWType.W}>W — W型元件</option>
            </select>
          </Field>
        </div>

        <Field label="子類型 moduleSubtype">
          <select value={form.moduleSubtype} onChange={(e) => updateBase('moduleSubtype', Number(e.target.value))} className="input-field">
            {Object.entries(ModuleSubtype).map(([, v]) => (
              <option key={v} value={v}>{v} — {MODULE_SUBTYPE_LABEL[v]}</option>
            ))}
          </select>
        </Field>

        <Field label="完整效果描述 description">
          <textarea value={form.description} onChange={(e) => updateBase('description', e.target.value)} className="input-field min-h-[72px] resize-y" />
        </Field>

        {isCondition ? (
          <>
            <Field label="觸發條件類型 conditionType">
              <select
                value={(form as ConditionComponent).conditionType}
                onChange={(e) => setForm((f) => ({ ...f, conditionType: e.target.value } as ConditionComponent))}
                className="input-field"
              >
                {Object.values(ConditionType).map((v) => (
                  <option key={v} value={v}>{CONDITION_TYPE_LABEL[v] ?? v}</option>
                ))}
              </select>
            </Field>
            <Field label="觸發條件描述文字 condition">
              <input
                value={(form as ConditionComponent).condition}
                onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value } as ConditionComponent))}
                className="input-field"
                placeholder="如：同時使用兩把武器攻擊時"
              />
            </Field>
          </>
        ) : (
          <Field label="效果類型 effectType">
            <select
              value={(form as FunctionComponent).effectType}
              onChange={(e) => setForm((f) => ({ ...f, effectType: e.target.value } as FunctionComponent))}
              className="input-field"
            >
              {Object.values(EffectType).map((v) => (
                <option key={v} value={v}>{EFFECT_TYPE_LABEL[v] ?? v}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="允許裝備的武器種類 allowedWeaponTypes（空 = 不限）">
          <div className="flex flex-wrap gap-4 mt-1">
            {Object.values(WeaponType).map((wt) => {
              const checked = (form.allowedWeaponTypes ?? []).includes(wt)
              return (
                <label key={wt} className="flex items-center gap-1.5 text-sm cursor-pointer hover:text-text-primary">
                  <input type="checkbox" checked={checked} onChange={() => toggleWeaponType(wt)} className="accent-accent-orange w-3.5 h-3.5" />
                  {wt}
                </label>
              )
            })}
          </div>
          <button
            className="text-[13px] text-accent-cyan mt-1.5"
            onClick={() => updateBase('allowedWeaponTypes', Object.values(WeaponType))}
          >全選</button>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="技能圖示 key icon（如 Icon_skill_passive_5223）">
            <input value={form.icon ?? ''} onChange={(e) => updateBase('icon', e.target.value || undefined)} className="input-field" placeholder="Icon_skill_passive_..." />
          </Field>
          <Field label="技能圖示路徑 iconLocal">
            <input value={form.iconLocal ?? ''} onChange={(e) => updateBase('iconLocal', e.target.value || undefined)} className="input-field" placeholder="/images/components/..." />
          </Field>
        </div>

        <Field label="外框圖路徑 outerFrameLocal（由 patch 腳本自動填入）">
          <input
            value={form.outerFrameLocal ?? ''}
            onChange={(e) => updateBase('outerFrameLocal', e.target.value || undefined)}
            className="input-field"
            placeholder="/images/components/OuterFrame/statetype_Condition.png"
          />
          <p className="text-[12px] text-text-dim mt-1">
            若空白則自動推算：OuterFrame/statetype_{form.componentType}{form.componentsWType === ComponentsWType.W ? '_W' : ''}.png
          </p>
        </Field>

        {(form.icon || form.iconLocal || form.outerFrameLocal) && (
          <ComponentIconPreview
            outerFrameSrc={assetUrl(form.outerFrameLocal ?? `/images/components/OuterFrame/statetype_${form.componentType}${form.componentsWType === ComponentsWType.W ? '_W' : ''}.png`)}
            iconSrc={form.iconLocal ? assetUrl(form.iconLocal) : undefined}
            hasOuterFrameLocal={!!form.outerFrameLocal}
          />
        )}
      </div>
    </AdminModal>
  )
}

// ─── 元件管理列表 ──────────────────────────────────────────────────────────────
export default function ComponentAdmin({ initialSearch = '' }: { initialSearch?: string }) {
  const [editing, setEditing] = useState<Component | null>(null)

  const {
    items: filtered, loading, error, hasMore, search, setSearch,
    filters, setFilter, submitSearch, loadMore, upsert,
  } = useServerPaged<Component, ComponentFilters>({
    fetchPage: (opts) => getCollectionPage<Component>('components', opts),
    initialSearch,
    initialFilters: { type: 'all', rarity: 'all', wType: 'all', subtype: 'all' },
    toEquals: (f) => ({
      ...(f.type !== 'all' ? { componentType: f.type } : {}),
      ...(f.rarity !== 'all' ? { rarity: f.rarity } : {}),
      ...(f.wType !== 'all' ? { componentsWType: f.wType } : {}),
      ...(f.subtype !== 'all' ? { moduleSubtype: f.subtype } : {}),
    }),
    matchFilters: (c, f) =>
      (f.type === 'all' || c.componentType === f.type) &&
      (f.rarity === 'all' || c.rarity === f.rarity) &&
      (f.wType === 'all' || c.componentsWType === f.wType) &&
      (f.subtype === 'all' || c.moduleSubtype === f.subtype),
  })

  const { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate } =
    useNewItemCreation(filtered, (c) => c.id, makeDefaultComponent)

  async function confirmCreateChecked() {
    const id = newId.trim()
    if (id && await docExists('components', id)) { setNewIdError(`ID「${id}」已存在`); return }
    const item = confirmCreate()
    if (item) setEditing(item)
  }

  async function handleSave(updated: Component) {
    await updateComponent(updated)
    upsert(updated)
    setEditing(null)
  }

  const conditions = filtered.filter((c): c is ConditionComponent => c.componentType === ComponentType.CONDITION)
  const functions_ = filtered.filter((c): c is FunctionComponent  => c.componentType === ComponentType.FUNCTION)

  return (
    <div>
      {/* 篩選列 */}
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
        <select value={filters.type} onChange={(e) => setFilter('type', e.target.value)} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部類型</option>
          {Object.values(ComponentType).map((v) => <option key={v} value={v}>{COMPONENT_TYPE_LABEL[v] ?? v}</option>)}
        </select>
        <select value={filters.rarity} onChange={(e) => setFilter('rarity', e.target.value)} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部稀有度</option>
          {Object.values(ItemRarity).map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filters.wType} onChange={(e) => setFilter('wType', e.target.value)} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部 W 類型</option>
          <option value={ComponentsWType.NORMAL}>Normal — 一般</option>
          <option value={ComponentsWType.W}>W — W型元件</option>
        </select>
        <select
          value={filters.subtype === 'all' ? 'all' : String(filters.subtype)}
          onChange={(e) => setFilter('subtype', e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm"
        >
          <option value="all">全部子類型</option>
          {Object.entries(ModuleSubtype).map(([, v]) => (
            <option key={v} value={v}>{v} — {MODULE_SUBTYPE_LABEL[v]}</option>
          ))}
        </select>
      </div>

      {/* 計數 + 新增 */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-text-dim text-xs">
          {error ? <span className="text-accent-red">載入失敗：{error}</span>
            : loading ? '載入中...'
            : `顯示 ${filtered.length} 個元件${hasMore ? '（可載入更多）' : ''}`}
          {!error && <>
            <span className="ml-2 text-accent-purple">觸元件 {conditions.length}</span>
            <span className="ml-2 text-accent-cyan">應元件 {functions_.length}</span>
          </>}
        </p>
        <button
          onClick={openCreate}
          className="text-xs px-3 py-1.5 bg-accent-orange text-black font-bold rounded-lg hover:opacity-90 transition-opacity"
        >
          + 新增元件
        </button>
      </div>

      <NewItemDialog
        creating={creating}
        newId={newId}
        newIdError={newIdError}
        placeholder="comp_"
        hint={<>輸入新元件 ID（格式如 <span className="text-accent-cyan">comp_12345</span>，儲存後不可更改）</>}
        onChangeId={(v) => { setNewId(v); setNewIdError('') }}
        onConfirm={() => { void confirmCreateChecked() }}
        onCancel={cancelCreate}
      />

      {/* 元件列表 */}
      <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
        {filtered.map((comp) => {
          const isCondition  = comp.componentType === ComponentType.CONDITION
          const accentClass  = isCondition ? 'text-accent-purple' : 'text-accent-cyan'
          const borderAccent = isCondition ? 'border-accent-purple/20' : 'border-accent-cyan/20'
          return (
            <div
              key={comp.id}
              className={`bg-bg-dark border rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-border-accent transition-colors cursor-pointer ${borderAccent}`}
              onClick={() => setEditing(comp)}
            >
              <div className="relative w-9 h-9 shrink-0">
                <img
                  src={assetUrl(comp.outerFrameLocal ?? `/images/components/OuterFrame/statetype_${comp.componentType}${comp.componentsWType === ComponentsWType.W ? '_W' : ''}.png`)}
                  alt=""
                  className="absolute object-contain"
                  style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '80%', height: '80%' }}
                  onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                />
                {comp.iconLocal && (
                  <img
                    src={assetUrl(comp.iconLocal)}
                    alt=""
                    className="absolute object-contain"
                    style={{ top: '50%', left: '50%', transform: 'translate(-51%, -52%) rotate(16deg)', width: '48%', height: '48%' }}
                    onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                  />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm text-text-primary truncate">
                    {comp.name || <span className="text-text-dim font-normal">（未命名）</span>}
                  </span>
                  <span className={`text-[13px] px-1.5 py-0.5 rounded border font-bold shrink-0 ${COMPONENT_RARITY_CLASS[comp.rarity] ?? 'text-text-dim border-border bg-bg-card'}`}>
                    {comp.rarity}
                  </span>
                  <span className={`text-[13px] px-1.5 py-0.5 rounded border shrink-0 ${isCondition ? 'text-accent-purple bg-accent-purple/10 border-accent-purple/30' : 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30'}`}>
                    {isCondition ? '觸元件' : '應元件'}
                  </span>
                  {comp.componentsWType === ComponentsWType.W && (
                    <span className="text-[13px] px-1.5 py-0.5 rounded bg-accent-orange/10 text-accent-orange border border-accent-orange/30 shrink-0">W型</span>
                  )}
                  <span className="text-[13px] text-text-dim shrink-0">Lv.{comp.probabilityLevel}</span>
                </div>
                <div className="text-[14px] mt-0.5 truncate">
                  <span className="text-text-dim mr-2">{MODULE_SUBTYPE_LABEL[comp.moduleSubtype] ?? comp.moduleSubtype}</span>
                  {isCondition
                    ? <span className={accentClass}>{(comp as ConditionComponent).condition || '—'}</span>
                    : <span className={accentClass}>{EFFECT_TYPE_LABEL[(comp as FunctionComponent).effectType] ?? (comp as FunctionComponent).effectType}</span>
                  }
                </div>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && !loading && (
          <p className="text-text-dim text-sm text-center py-8">找不到符合條件的元件</p>
        )}
      </div>

      <LoadMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />

      {editing && (
        <ComponentEditPanel
          component={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}
