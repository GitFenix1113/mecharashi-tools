import { useState, useEffect } from 'react'
import type { GlossaryTerm } from '../../../types'
import { Field, AdminModal, useNewItemCreation, NewItemDialog, useClientPaged, LoadMoreButton } from './shared'
import { updateGlossaryTerm, docExists } from '../../../lib/firestoreApi'
import { useGameData } from '../../../contexts/GameDataContext'
import { RefPicker } from '../../../components/admin/RefPicker'

// ─── 預設值工廠 ────────────────────────────────────────────────────────────────
function makeDefaultTerm(id: string): GlossaryTerm {
  return { id, name: '', category: '', description: '', descriptionRefs: {}, aliases: [], icon: undefined }
}

// ─── 詞條編輯面板 ──────────────────────────────────────────────────────────────
function GlossaryEditPanel({
  term,
  onSave,
  onCancel,
}: {
  term: GlossaryTerm
  onSave: (t: GlossaryTerm) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm]     = useState<GlossaryTerm>({ ...term })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => { setForm({ ...term }) }, [term])

  function update<K extends keyof GlossaryTerm>(key: K, value: GlossaryTerm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit() {
    setSaving(true); setError(null)
    try { await onSave(form) }
    catch (e) { setError(e instanceof Error ? e.message : '儲存失敗，請重試'); setSaving(false) }
  }

  return (
    <AdminModal saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2 shrink-0">
        <span className="text-accent-purple">◆</span>
        編輯詞條
        <span className="text-text-dim text-sm font-normal ml-1">{form.id}</span>
      </h3>

      <div className="overflow-y-auto flex-1 pr-1 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="詞條名稱 name（= [xxx] 內文字）">
            <input value={form.name} onChange={(e) => update('name', e.target.value)} className="input-field" placeholder="如：固定傷害" />
          </Field>
          <Field label="機制分類 category（選填）">
            <input value={form.category ?? ''} onChange={(e) => update('category', e.target.value || undefined)} className="input-field" placeholder="如：傷害 / 狀態 / 資源 / 通用" />
          </Field>
        </div>

        <Field label="詞條解釋 description">
          <textarea
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            className="input-field min-h-[72px] resize-y text-sm leading-relaxed"
            placeholder="解釋此機制關鍵字的意義（可含 [xxx] 再引用其他實體）"
          />
        </Field>

        {/* 解釋內也能再引用其他實體 */}
        <RefPicker
          text={form.description}
          value={form.descriptionRefs}
          onChange={(refs) => update('descriptionRefs', refs)}
          onCompileText={(tf) => update('description', tf(form.description))}
        />

        <div className="grid grid-cols-2 gap-3">
          <Field label="同義詞 aliases（逗號分隔）">
            <input
              value={(form.aliases ?? []).join(', ')}
              onChange={(e) => update('aliases', e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean))}
              className="input-field"
              placeholder="如：真實傷害, 固傷"
            />
          </Field>
          <Field label="圖示 icon（選填，URL 或 /images/…）">
            <input value={form.icon ?? ''} onChange={(e) => update('icon', e.target.value || undefined)} className="input-field" placeholder="/images/glossary/..." />
          </Field>
        </div>
      </div>
    </AdminModal>
  )
}

// ─── 詞條管理列表 ──────────────────────────────────────────────────────────────
export default function GlossaryAdmin({ initialSearch = '' }: { initialSearch?: string }) {
  const [editing, setEditing] = useState<GlossaryTerm | null>(null)
  const gd = useGameData()

  const {
    items: filtered, loading, error, hasMore, search, setSearch,
    submitSearch, loadMore, upsert,
  } = useClientPaged<GlossaryTerm, Record<string, never>>({
    source: gd.glossaryTerms,
    initialSearch,
    initialFilters: {},
    matchFilters: () => true,
  })

  const { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate } =
    useNewItemCreation(filtered, (t) => t.id, makeDefaultTerm)

  async function confirmCreateChecked() {
    const id = newId.trim()
    if (id && await docExists('glossaryTerms', id)) { setNewIdError(`ID「${id}」已存在`); return }
    const item = confirmCreate()
    if (item) setEditing(item)
  }

  async function handleSave(updated: GlossaryTerm) {
    const version = await updateGlossaryTerm(updated)
    upsert(updated)
    gd.patchCollectionItem('glossaryTerms', updated, version)
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
      </div>

      {/* 計數 + 新增 */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-text-dim text-xs">
          {error ? <span className="text-accent-red">載入失敗：{error}</span>
            : loading ? '載入中...'
            : `顯示 ${filtered.length} 個詞條${hasMore ? '（可載入更多）' : ''}`}
        </p>
        <button
          onClick={openCreate}
          className="text-xs px-3 py-1.5 bg-accent-orange text-black font-bold rounded-lg hover:opacity-90 transition-opacity"
        >
          + 新增詞條
        </button>
      </div>

      <NewItemDialog
        creating={creating}
        newId={newId}
        newIdError={newIdError}
        placeholder="term_固定傷害"
        hint={<>輸入新詞條 ID（格式如 <span className="text-accent-cyan">term_固定傷害</span>，儲存後不可更改）</>}
        onChangeId={(v) => { setNewId(v); setNewIdError('') }}
        onConfirm={() => { void confirmCreateChecked() }}
        onCancel={cancelCreate}
      />

      {/* 詞條列表 */}
      <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
        {filtered.map((term) => (
          <div
            key={term.id}
            className="bg-bg-dark border border-accent-purple/20 rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-border-accent transition-colors cursor-pointer"
            onClick={() => setEditing(term)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm text-text-primary truncate">
                  {term.name || <span className="text-text-dim font-normal">（未命名）</span>}
                </span>
                {term.category && (
                  <span className="text-[13px] px-1.5 py-0.5 rounded border border-accent-purple/30 bg-accent-purple/10 text-accent-purple shrink-0">
                    {term.category}
                  </span>
                )}
                {(term.aliases?.length ?? 0) > 0 && (
                  <span className="text-[12px] text-text-dim shrink-0">別名 {term.aliases!.length}</span>
                )}
              </div>
              <p className="text-[13px] text-text-secondary truncate mt-0.5">{term.description || '（無解釋）'}</p>
            </div>
          </div>
        ))}
        {filtered.length === 0 && !loading && (
          <p className="text-text-dim text-sm text-center py-8">找不到符合條件的詞條</p>
        )}
      </div>

      <LoadMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />

      {editing && (
        <GlossaryEditPanel
          term={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}
