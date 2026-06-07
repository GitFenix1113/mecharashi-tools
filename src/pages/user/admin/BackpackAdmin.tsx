import { useState, useEffect } from 'react'
import type { Backpack } from '../../../types'
import { WeaponEquipSlot } from '../../../types/enums'
import { updateBackpack, getBackpacksPage } from '../../../lib/firestoreApi'
import { RefPicker } from '../../../components/admin/RefPicker'
import { Field, AdminModal, useNewItemCreation, NewItemDialog } from './shared'
import { BACKPACK_TYPE_CONFIG, ASSEMBLABLE_ARMOR_CONFIG } from '../../../components/BackpackBadges'

const PAGE_SIZE = 20
const ALL_RARITIES = ['SS', 'S+', 'S', 'A', 'B']
const ALL_BACKPACK_TYPES = Object.keys(BACKPACK_TYPE_CONFIG)

function makeDefaultBackpack(id: string): Backpack {
  return {
    id,
    name: '',
    type: 'Ammo',
    rarity: 'S',
    weight: 0,
    slot: WeaponEquipSlot.BACK,
    assemblableArmorType: [],
    repairAmount: 0,
  }
}

// ─── 編輯面板 ──────────────────────────────────────────────────────────────────
function BackpackEditPanel({
  backpack,
  onSave,
  onCancel,
}: {
  backpack: Backpack
  onSave: (b: Backpack) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm]           = useState<Backpack>({ ...backpack })
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [hasMainSkill, setHasMainSkill] = useState(!!backpack.mainSkill)

  useEffect(() => {
    setForm({ ...backpack })
    setHasMainSkill(!!backpack.mainSkill)
    setError(null)
  }, [backpack])

  function update<K extends keyof Backpack>(key: K, value: Backpack[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function toggleArmorType(type: string) {
    setForm(f => {
      const arr = f.assemblableArmorType
      const next = arr.includes(type) ? arr.filter(t => t !== type) : [...arr, type]
      return { ...f, assemblableArmorType: next }
    })
  }

  type SkillKey = keyof NonNullable<Backpack['mainSkill']>
  function updateSkill<K extends SkillKey>(key: K, value: NonNullable<Backpack['mainSkill']>[K]) {
    setForm(f => ({ ...f, mainSkill: { ...f.mainSkill!, [key]: value } }))
  }

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      const data = hasMainSkill ? form : { ...form, mainSkill: undefined }
      await onSave(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗，請重試')
      setSaving(false)
    }
  }

  const skill = form.mainSkill

  return (
    <AdminModal saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <span className="text-accent-pink text-xl">🎒</span>
        <h3 className="text-lg font-bold">編輯背包</h3>
        <span className="text-text-dim text-sm font-normal ml-1">{form.id}</span>
      </div>

      <div className="overflow-y-auto flex-1 space-y-3 pr-1">
        <Field label="背包名稱 name">
          <input value={form.name} onChange={e => update('name', e.target.value)} className="input-field" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="類型 type">
            <select value={form.type} onChange={e => update('type', e.target.value)} className="input-field">
              {ALL_BACKPACK_TYPES.map(t => (
                <option key={t} value={t}>{BACKPACK_TYPE_CONFIG[t]?.label ?? t}（{t}）</option>
              ))}
            </select>
          </Field>
          <Field label="稀有度 rarity">
            <select value={form.rarity} onChange={e => update('rarity', e.target.value)} className="input-field">
              {ALL_RARITIES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="重量 weight">
            <input type="number" value={form.weight} onChange={e => update('weight', Number(e.target.value))} className="input-field" />
          </Field>
          <Field label="修理量 repairAmount（非修理類填 0）">
            <input type="number" value={form.repairAmount} onChange={e => update('repairAmount', Number(e.target.value))} className="input-field" />
          </Field>
        </div>

        <Field label="圖示 icon（選填，填圖示檔名如 Icon_backpack_12345）">
          <input
            value={form.icon ?? ''}
            onChange={e => update('icon', e.target.value || undefined)}
            className="input-field"
            placeholder="Icon_backpack_12345"
          />
        </Field>

        <div>
          <label className="text-xs text-text-dim mb-2 block">
            裝備限制 assemblableArmorType（勾選 = 指定類型可裝，全不勾 = 無限制）
          </label>
          <div className="flex gap-4">
            {Object.entries(ASSEMBLABLE_ARMOR_CONFIG).map(([key, cfg]) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={form.assemblableArmorType.includes(key)}
                  onChange={() => toggleArmorType(key)}
                  className="accent-accent-pink w-4 h-4"
                />
                {cfg.label}
              </label>
            ))}
          </div>
        </div>

        {/* 主技能 */}
        <div className="border border-border/60 rounded-lg p-3 bg-bg-dark/30">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-text-dim font-medium uppercase tracking-wider">主技能 mainSkill</span>
            <label className="flex items-center gap-1.5 cursor-pointer text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={hasMainSkill}
                onChange={e => {
                  setHasMainSkill(e.target.checked)
                  if (e.target.checked && !form.mainSkill) {
                    setForm(f => ({ ...f, mainSkill: { id: '', name: '', description: '', buffIds: [] } }))
                  }
                }}
                className="accent-accent-pink w-4 h-4"
              />
              有主技能（SS 稀有度）
            </label>
          </div>

          {hasMainSkill && skill && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="技能 ID id">
                  <input value={skill.id} onChange={e => updateSkill('id', e.target.value)} className="input-field" />
                </Field>
                <Field label="技能名稱 name">
                  <input value={skill.name} onChange={e => updateSkill('name', e.target.value)} className="input-field" />
                </Field>
              </div>
              <Field label="技能描述 description">
                <textarea value={skill.description} onChange={e => updateSkill('description', e.target.value)} className="input-field min-h-[72px] resize-y" />
              </Field>
              <RefPicker
                text={skill.description}
                value={skill.descriptionRefs}
                onChange={refs => updateSkill('descriptionRefs', refs)}
              />
              <Field label="圖示 icon（選填，填圖示檔名如 Icon_skill_passive_1234）">
                <input
                  value={skill.icon ?? ''}
                  onChange={e => updateSkill('icon', e.target.value || undefined)}
                  className="input-field"
                  placeholder="Icon_skill_passive_1234"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="增傷 dmg（%，選填）">
                  <input
                    type="number"
                    value={skill.dmg ?? ''}
                    onChange={e => updateSkill('dmg', e.target.value !== '' ? Number(e.target.value) : undefined)}
                    className="input-field"
                    placeholder="留空 = 不填"
                  />
                </Field>
                <Field label="爆率 crit（選填）">
                  <input
                    type="number"
                    value={skill.crit ?? ''}
                    onChange={e => updateSkill('crit', e.target.value !== '' ? Number(e.target.value) : undefined)}
                    className="input-field"
                    placeholder="留空 = 不填"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="爆傷 critDmg（%，選填）">
                  <input
                    type="number"
                    value={skill.critDmg ?? ''}
                    onChange={e => updateSkill('critDmg', e.target.value !== '' ? Number(e.target.value) : undefined)}
                    className="input-field"
                    placeholder="留空 = 不填"
                  />
                </Field>
                <Field label="命中 acc（選填）">
                  <input
                    type="number"
                    value={skill.acc ?? ''}
                    onChange={e => updateSkill('acc', e.target.value !== '' ? Number(e.target.value) : undefined)}
                    className="input-field"
                    placeholder="留空 = 不填"
                  />
                </Field>
              </div>
              <Field label="特殊效果標籤 specialEffects（逗號分隔，選填）">
                <input
                  value={(skill.specialEffects ?? []).join(', ')}
                  onChange={e => {
                    const arr = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    updateSkill('specialEffects', arr.length > 0 ? arr : undefined)
                  }}
                  className="input-field"
                  placeholder="高傷害, 特殊效果"
                />
              </Field>
              <Field label="觸發 Buff ID buffIds（逗號分隔）">
                <textarea
                  value={(skill.buffIds ?? []).join(', ')}
                  onChange={e => {
                    const ids = e.target.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
                    updateSkill('buffIds', ids)
                  }}
                  className="input-field min-h-[48px] resize-y font-mono text-xs"
                  placeholder="buff_001, buff_002"
                />
              </Field>
            </div>
          )}
        </div>
      </div>
    </AdminModal>
  )
}

// ─── 背包管理列表 ──────────────────────────────────────────────────────────────
export default function BackpackAdmin({ initialSearch = '' }: { initialSearch?: string }) {
  const [items, setItems]     = useState<Backpack[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [cursor, setCursor]   = useState<string | null>(null)
  const [search, setSearch]   = useState(initialSearch)
  const [activeSearch, setActiveSearch] = useState(initialSearch)
  const [editing, setEditing] = useState<Backpack | null>(null)

  const { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate } =
    useNewItemCreation(items, b => b.id, makeDefaultBackpack)

  async function loadPage(searchTerm: string, after: string | null, append: boolean) {
    setLoading(true)
    try {
      const result = await getBackpacksPage({
        nameSearch: searchTerm,
        lastItemName: after ?? undefined,
        pageSize: PAGE_SIZE,
      })
      setItems(prev => append ? [...prev, ...result.items] : result.items)
      setHasMore(result.hasMore)
      setCursor(result.lastItemName)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadPage(initialSearch, null, false) }, [])

  function handleSearch() {
    setActiveSearch(search)
    void loadPage(search, null, false)
  }

  function handleLoadMore() {
    void loadPage(activeSearch, cursor, true)
  }

  async function handleSave(updated: Backpack) {
    await updateBackpack(updated)
    setItems(prev => {
      const exists = prev.some(b => b.id === updated.id)
      return exists ? prev.map(b => b.id === updated.id ? updated : b) : [updated, ...prev]
    })
    setEditing(null)
  }

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
          placeholder="搜尋背包名稱（Enter 搜尋）..."
          className="flex-1 min-w-[180px] px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-pink"
        />
        <button
          onClick={handleSearch}
          className="px-3 py-2 bg-bg-dark border border-border text-text-secondary text-sm rounded-lg hover:border-border-accent hover:text-text-primary transition-colors"
        >
          搜尋
        </button>
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="text-text-dim text-xs">
          {loading
            ? '載入中...'
            : `顯示 ${items.length} 件背包${activeSearch ? `（搜尋：「${activeSearch}」）` : '（前 ' + PAGE_SIZE + ' 筆）'}`}
        </p>
        <button
          onClick={openCreate}
          className="text-xs px-3 py-1.5 bg-accent-pink text-white font-bold rounded-lg hover:opacity-90 transition-opacity"
        >
          + 新增背包
        </button>
      </div>

      <NewItemDialog
        creating={creating}
        newId={newId}
        newIdError={newIdError}
        placeholder="backpack_12345"
        hint={<>輸入新背包 ID（格式如 <span className="text-accent-cyan">backpack_12345</span>，儲存後不可更改）</>}
        onChangeId={v => { setNewId(v); setNewIdError('') }}
        onConfirm={() => {
          const item = confirmCreate()
          if (item) setEditing(item)
        }}
        onCancel={cancelCreate}
      />

      <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
        {items.map(bp => (
          <div
            key={bp.id}
            className="bg-bg-dark border border-border rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-border-accent transition-colors cursor-pointer"
            onClick={() => setEditing(bp)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm text-text-primary">
                  {bp.name || <span className="text-text-dim font-normal">（未命名）</span>}
                </span>
                <span className="text-[13px] px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-dim shrink-0">
                  {bp.rarity}
                </span>
                <span className="text-[13px] px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-dim shrink-0">
                  {BACKPACK_TYPE_CONFIG[bp.type]?.label ?? bp.type}
                </span>
                {bp.mainSkill && (
                  <span className="text-[13px] px-1.5 py-0.5 rounded bg-accent-pink/10 text-accent-pink border border-accent-pink/30 shrink-0">
                    ✦ {bp.mainSkill.name}
                  </span>
                )}
              </div>
              <p className="text-[14px] text-text-dim mt-0.5">{bp.id} · 重量 {bp.weight}</p>
            </div>
          </div>
        ))}

        {items.length === 0 && !loading && (
          <p className="text-text-dim text-sm text-center py-8">沒有符合條件的背包</p>
        )}
      </div>

      {hasMore && !loading && (
        <div className="mt-4 text-center">
          <button
            onClick={handleLoadMore}
            className="px-6 py-2 rounded-xl border border-border bg-bg-dark text-text-secondary text-sm hover:border-border-accent hover:text-text-primary transition-colors"
          >
            載入更多
          </button>
        </div>
      )}

      {editing && (
        <BackpackEditPanel backpack={editing} onSave={handleSave} onCancel={() => setEditing(null)} />
      )}
    </div>
  )
}
