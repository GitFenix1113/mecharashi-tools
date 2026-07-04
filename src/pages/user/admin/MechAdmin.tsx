import { useState, useEffect, useMemo } from 'react'
import type { Mech, Module } from '../../../types'
import { ModuleSlot, ArmorType } from '../../../types/enums'
import { Field, AdminModal, useClientPaged, LoadMoreButton } from './shared'
import { updateMech } from '../../../lib/firestoreApi'
import { useGameVersions } from '../../../hooks/useGameVersions'
import { useGameData } from '../../../contexts/GameDataContext'

type MechFilters = { armorType: string }

// ─── 機甲管理列表 ──────────────────────────────────────────────────────────────
export default function MechAdmin({
  modules,
  initialSearch = '',
}: {
  modules: Module[]
  initialSearch?: string
}) {
  const [editing, setEditing] = useState<Mech | null>(null)
  const gd = useGameData()

  const {
    items: filtered, loading, error, hasMore, search, setSearch,
    filters, setFilter, submitSearch, loadMore, upsert,
  } = useClientPaged<Mech, MechFilters>({
    source: gd.mechs,
    initialSearch,
    initialFilters: { armorType: 'all' },
    matchFilters: (m, f) => f.armorType === 'all' || m.armorType === f.armorType,
  })

  async function handleSave(updated: Mech) {
    const version = await updateMech(updated)
    upsert(updated)
    gd.patchCollectionItem('mechs', updated, version)
    setEditing(null)
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitSearch() }}
          placeholder="搜尋機甲名稱開頭（Enter 搜尋）..."
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-orange"
        />
        <button
          onClick={submitSearch}
          className="px-3 py-2 bg-bg-dark border border-border text-text-secondary text-sm rounded-lg hover:border-border-accent hover:text-text-primary transition-colors"
        >
          搜尋
        </button>
        <select
          value={filters.armorType}
          onChange={(e) => setFilter('armorType', e.target.value)}
          className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm"
        >
          <option value="all">全部類型</option>
          {Object.values(ArmorType).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <p className="text-text-dim text-xs mb-3">
        {error ? <span className="text-accent-red">載入失敗：{error}</span>
          : loading ? '載入中...'
          : `顯示 ${filtered.length} 台機甲${hasMore ? '（可載入更多）' : ''}`}
      </p>

      <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
        {filtered.map((mech) => {
          const mod4      = modules.find((m) => m.id === mech.module4Id)
          const mod8      = modules.find((m) => m.id === mech.module8Id)
          const fixedMods = (mech.moduleFixedIds ?? [])
            .map((id) => modules.find((m) => m.id === id))
            .filter(Boolean)
          const hasMissingModule =
            (mech.module4Id && !mod4) ||
            (mech.module8Id && !mod8) ||
            (mech.moduleFixedIds ?? []).some((id) => !modules.find((m) => m.id === id))

          return (
            <div
              key={mech.id}
              className={`bg-bg-dark border rounded-lg px-3 py-2.5 hover:border-border-accent transition-colors cursor-pointer ${hasMissingModule ? 'border-accent-red/40' : 'border-border'}`}
              onClick={() => setEditing(mech)}
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm">{mech.name}</span>
                    <span className="text-[13px] px-1.5 py-0.5 rounded border border-border text-text-dim shrink-0">
                      {mech.armorType}
                    </span>
                    {hasMissingModule && (
                      <span className="text-[13px] text-accent-red shrink-0">⚠ 模組未對應</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    <span className="text-[14px] text-accent-cyan">
                      四模: {mod4 ? mod4.name : <span className="text-text-dim">（未設定）</span>}
                    </span>
                    <span className="text-[14px] text-accent-orange">
                      八模: {mod8 ? mod8.name : <span className="text-text-dim">（未設定）</span>}
                    </span>
                    {fixedMods.length > 0 && (
                      <span className="text-[14px] text-accent-green">
                        固定: {fixedMods.map((m) => m!.name).join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && !loading && (
          <p className="text-text-dim text-sm text-center py-8">找不到符合條件的機甲</p>
        )}
      </div>

      <LoadMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />

      {editing && (
        <MechEditPanel
          mech={editing}
          modules={modules}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}

// ─── 機甲編輯面板 ──────────────────────────────────────────────────────────────
function MechEditPanel({
  mech,
  modules,
  onSave,
  onCancel,
}: {
  mech: Mech
  modules: Module[]
  onSave: (m: Mech) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm]   = useState<Mech>({ ...mech })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const gameVersions = useGameVersions()

  useEffect(() => { setForm({ ...mech }) }, [mech])

  const availableModules = useMemo(
    () => modules.filter((m) => m.boundMechId === form.id || !m.boundMechId),
    [modules, form.id]
  )
  const mod4Options  = availableModules.filter((m) => m.slot === ModuleSlot.SLOT_4)
  const mod8Options  = availableModules.filter((m) => m.slot === ModuleSlot.SLOT_8)
  const fixedOptions = availableModules.filter((m) => m.slot === ModuleSlot.BUILT_IN)

  async function handleSubmit() {
    setSaving(true); setError(null)
    try { await onSave(form) }
    catch (e) { setError(e instanceof Error ? e.message : '儲存失敗，請重試'); setSaving(false) }
  }

  return (
    <AdminModal maxWidth="max-w-lg" saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2 shrink-0">
        <span className="text-accent-orange">⚙</span> 機甲模組配置
        <span className="text-text-secondary text-sm font-normal ml-1">{form.name}</span>
      </h3>

      <div className="overflow-y-auto flex-1 pr-1 space-y-4">
        <Field label="登場版本 debutVersion">
          <select
            value={form.debutVersion ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, debutVersion: e.target.value || undefined }))}
            className="input-field"
          >
            <option value="">（未設定）</option>
            {gameVersions.map((v) => <option key={v} value={v}>{v}</option>)}
            {form.debutVersion && !gameVersions.includes(form.debutVersion) && (
              <option value={form.debutVersion}>{form.debutVersion}（清單外）</option>
            )}
          </select>
        </Field>

        <Field label="四格模組 (4mod)">
          <select
            value={form.module4Id ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, module4Id: e.target.value || undefined }))}
            className="input-field"
          >
            <option value="">（未設定）</option>
            {mod4Options.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {form.module4Id && !mod4Options.find((m) => m.id === form.module4Id) && (
            <p className="text-xs text-accent-red mt-1">⚠ 目前設定的模組 ID 不在列表中：{form.module4Id}</p>
          )}
        </Field>

        <Field label="八格模組 (8mod)">
          <select
            value={form.module8Id ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, module8Id: e.target.value || undefined }))}
            className="input-field"
          >
            <option value="">（未設定）</option>
            {mod8Options.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {form.module8Id && !mod8Options.find((m) => m.id === form.module8Id) && (
            <p className="text-xs text-accent-red mt-1">⚠ 目前設定的模組 ID 不在列表中：{form.module8Id}</p>
          )}
        </Field>

        <Field label="固定模組">
          <div className="space-y-2">
            {(form.moduleFixedIds ?? []).map((fixedId, idx) => (
              <div key={idx} className="flex gap-2">
                <select
                  value={fixedId}
                  onChange={(e) => {
                    const newIds = [...(form.moduleFixedIds ?? [])]
                    newIds[idx] = e.target.value
                    setForm((f) => ({ ...f, moduleFixedIds: newIds }))
                  }}
                  className="input-field flex-1"
                >
                  <option value="">（未設定）</option>
                  {fixedOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <button
                  onClick={() => {
                    const newIds = (form.moduleFixedIds ?? []).filter((_, i) => i !== idx)
                    setForm((f) => ({ ...f, moduleFixedIds: newIds }))
                  }}
                  className="px-2 py-1 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10 text-xs shrink-0"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                setForm((f) => ({ ...f, moduleFixedIds: [...(f.moduleFixedIds ?? []), ''] }))
              }
              className="text-xs text-accent-cyan hover:text-accent-cyan/80 transition-colors"
            >
              + 新增固定模組欄位
            </button>
          </div>
        </Field>
      </div>
    </AdminModal>
  )
}
