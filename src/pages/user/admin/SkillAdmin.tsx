import { useState, useEffect } from 'react'
import type { PilotSkillDoc, SkillEffect } from '../../../types'
import { formatWeaponReq } from '../../../types'
import { SkillType } from '../../../types/enums'
import { Field, AdminModal, useNewItemCreation, NewItemDialog, useClientPaged, LoadMoreButton } from './shared'
import { updatePilotSkill, docExists } from '../../../lib/firestoreApi'
import { useGameData } from '../../../contexts/GameDataContext'
import { RefPicker } from '../../../components/admin/RefPicker'
import { IconField } from '../../../components/admin/IconPicker'
import { SkillEffectItem } from './PilotAdmin'

type SkillFilters = { type: string; manual: 'all' | 'manual' | 'auto' }

// ─── 預設值工廠 ────────────────────────────────────────────────────────────────
function makeDefaultSkill(id: string): PilotSkillDoc {
  return {
    id,
    name: '',
    type: SkillType.PASSIVE,
    description: '',
    descriptionRefs: {},
    icon: '',
    iconLocal: '',
    effects: [],
    buffIds: [],
    manual: true,
  }
}

// ─── 技能編輯面板 ──────────────────────────────────────────────────────────────
function SkillEditPanel({
  skill,
  onSave,
  onCancel,
}: {
  skill: PilotSkillDoc
  onSave: (s: PilotSkillDoc) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm]     = useState<PilotSkillDoc>({ ...skill })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => { setForm({ ...skill }) }, [skill])

  function update<K extends keyof PilotSkillDoc>(key: K, value: PilotSkillDoc[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }
  const effects = form.effects ?? []
  const buffIds = form.buffIds ?? []
  function updateEffects(next: SkillEffect[]) { update('effects', next) }
  function updateBuffIds(val: string) {
    update('buffIds', val.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))
  }

  async function handleSubmit() {
    setSaving(true); setError(null)
    try { await onSave(form) }
    catch (e) { setError(e instanceof Error ? e.message : '儲存失敗，請重試'); setSaving(false) }
  }

  return (
    <AdminModal saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <span className="text-accent-orange">✎</span> 編輯技能
          <span className="text-text-dim text-sm font-normal ml-1">{form.id}</span>
        </h3>
        {form.manual && <span className="text-[12px] px-1.5 py-0.5 rounded border border-accent-orange/40 bg-accent-orange/10 text-accent-orange">手動</span>}
      </div>

      <div className="overflow-y-auto flex-1 pr-1 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="技能名稱 name">
            <input value={form.name} onChange={(e) => update('name', e.target.value)} className="input-field" placeholder="如：虛粒子形態" />
          </Field>
          <Field label="技能類型 type">
            <select value={form.type} onChange={(e) => update('type', e.target.value)} className="input-field">
              <option value={SkillType.PASSIVE}>{SkillType.PASSIVE}</option>
              <option value={SkillType.ACTIVE}>{SkillType.ACTIVE}</option>
              <option value={SkillType.COMMAND}>{SkillType.COMMAND}</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="AP ap">
              <input type="text" value={form.ap ?? ''} onChange={(e) => update('ap', e.target.value || undefined)} className="input-field" placeholder="—" />
            </Field>
            <Field label="CD cd">
              <input type="text" value={form.cd ?? ''} onChange={(e) => update('cd', e.target.value || undefined)} className="input-field" placeholder="—" />
            </Field>
          </div>
        </div>

        <IconField
          label="圖示 iconLocal（本地圖檔）"
          value={form.iconLocal}
          onChange={(v) => update('iconLocal', v)}
          defaultFolder="skills"
        />

        {form.weapon && (
          <p className="text-[12px] text-text-dim">限定武器 weapon：<span className="text-accent-purple">{formatWeaponReq(form.weapon)}</span>（由爬蟲腳本管理）</p>
        )}

        <Field label="效果說明 description">
          <textarea
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            className="input-field min-h-[72px] resize-y text-sm leading-relaxed"
            placeholder="技能效果文字描述（可含 [xxx] 引用其他實體）"
          />
        </Field>

        <RefPicker
          text={form.description}
          value={form.descriptionRefs}
          onChange={(refs) => update('descriptionRefs', refs)}
          onCompileText={(tf) => update('description', tf(form.description))}
        />

        {/* 可計算效果 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] text-text-dim font-medium uppercase tracking-wider">可計算效果 effects</span>
            <button
              onClick={() => updateEffects([...effects, { stat: 'dmg', value: 0, scope: 'self', condition: null }])}
              className="text-[13px] text-accent-cyan hover:text-accent-cyan/80 transition-colors"
            >
              + 新增效果
            </button>
          </div>
          {effects.length === 0 ? (
            <p className="text-xs text-text-dim py-2 text-center">尚未填入（計算器／模擬器不計此技能）</p>
          ) : (
            <div className="space-y-2">
              {effects.map((eff, i) => (
                <SkillEffectItem
                  key={i}
                  effect={eff}
                  index={i}
                  onChange={(updated) => { const next = [...effects]; next[i] = updated; updateEffects(next) }}
                  onRemove={() => updateEffects(effects.filter((_, idx) => idx !== i))}
                />
              ))}
            </div>
          )}
        </div>

        <Field label="觸發 Buff ID buffIds（逗號分隔）">
          <textarea
            value={buffIds.join(', ')}
            onChange={(e) => updateBuffIds(e.target.value)}
            className="input-field min-h-[44px] resize-none text-xs"
            placeholder="buff_001, buff_002"
          />
        </Field>
      </div>
    </AdminModal>
  )
}

// ─── 技能管理列表 ──────────────────────────────────────────────────────────────
export default function SkillAdmin({ initialSearch = '' }: { initialSearch?: string }) {
  const [editing, setEditing] = useState<PilotSkillDoc | null>(null)
  const gd = useGameData()

  const {
    items: filtered, loading, error, hasMore, search, setSearch,
    filters, setFilter, submitSearch, loadMore, upsert,
  } = useClientPaged<PilotSkillDoc, SkillFilters>({
    source: gd.pilotSkills,
    initialSearch,
    initialFilters: { type: 'all', manual: 'all' },
    matchFilters: (s, f) =>
      (f.type === 'all' || s.type === f.type) &&
      (f.manual === 'all' || (f.manual === 'manual' ? s.manual === true : s.manual !== true)),
  })

  const { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate } =
    useNewItemCreation(filtered, (s) => s.id, makeDefaultSkill)

  async function confirmCreateChecked() {
    const id = newId.trim()
    if (id && await docExists('pilotSkills', id)) { setNewIdError(`ID「${id}」已存在`); return }
    const item = confirmCreate()
    if (item) setEditing(item)
  }

  async function handleSave(updated: PilotSkillDoc) {
    const version = await updatePilotSkill(updated)
    upsert(updated)
    gd.patchCollectionItem('pilotSkills', updated, version)
    setEditing(null)
  }

  return (
    <div>
      {/* 搜尋列 */}
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
          <option value={SkillType.PASSIVE}>{SkillType.PASSIVE}</option>
          <option value={SkillType.ACTIVE}>{SkillType.ACTIVE}</option>
          <option value={SkillType.COMMAND}>{SkillType.COMMAND}</option>
        </select>
        <select value={filters.manual} onChange={(e) => setFilter('manual', e.target.value as SkillFilters['manual'])} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部來源</option>
          <option value="manual">手動新增</option>
          <option value="auto">腳本擷取</option>
        </select>
      </div>

      {/* 計數 + 新增 */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-text-dim text-xs">
          {error ? <span className="text-accent-red">載入失敗：{error}</span>
            : loading ? '載入中...'
            : `顯示 ${filtered.length} 個技能${hasMore ? '（可載入更多）' : ''}`}
        </p>
        <button
          onClick={openCreate}
          className="text-xs px-3 py-1.5 bg-accent-orange text-black font-bold rounded-lg hover:opacity-90 transition-opacity"
        >
          + 新增技能
        </button>
      </div>

      <NewItemDialog
        creating={creating}
        newId={newId}
        newIdError={newIdError}
        placeholder="skill_虛粒子形態"
        hint={<>輸入新技能 ID（格式如 <span className="text-accent-cyan">skill_虛粒子形態</span>，儲存後不可更改）</>}
        onChangeId={(v) => { setNewId(v); setNewIdError('') }}
        onConfirm={() => { void confirmCreateChecked() }}
        onCancel={cancelCreate}
      />

      {/* 技能列表 */}
      <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
        {filtered.map((skill) => {
          const effCount = (skill.effects ?? []).length
          return (
            <div
              key={skill.id}
              className="bg-bg-dark border border-border rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-border-accent transition-colors cursor-pointer"
              onClick={() => setEditing(skill)}
            >
              {skill.iconLocal && (
                <img src={skill.iconLocal} alt="" className="w-8 h-8 rounded shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm text-text-primary truncate">
                    {skill.name || <span className="text-text-dim font-normal">（未命名）</span>}
                  </span>
                  <span className="text-[13px] px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-dim shrink-0">{skill.type}</span>
                  {skill.manual && <span className="text-[12px] px-1.5 py-0.5 rounded border border-accent-orange/40 bg-accent-orange/10 text-accent-orange shrink-0">手動</span>}
                  {skill.ap && <span className="text-[13px] text-accent-green shrink-0">AP {skill.ap}</span>}
                  {skill.cd && <span className="text-[13px] text-accent-orange shrink-0">CD {skill.cd}</span>}
                  <span className={`text-[13px] shrink-0 ${effCount > 0 ? 'text-accent-cyan' : 'text-text-dim'}`}>效果 {effCount}</span>
                </div>
                <p className="text-[13px] text-text-secondary truncate mt-0.5">{skill.description || '（無說明）'}</p>
              </div>
              <span className="text-text-dim font-mono text-[11px] shrink-0 max-w-[30%] truncate">{skill.id}</span>
            </div>
          )
        })}
        {filtered.length === 0 && !loading && (
          <p className="text-text-dim text-sm text-center py-8">找不到符合條件的技能</p>
        )}
      </div>

      <LoadMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />

      {editing && (
        <SkillEditPanel
          skill={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}
