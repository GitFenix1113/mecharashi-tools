import { useState, useEffect, useMemo } from 'react'
import type { NeuralDriveAbility, SkillEffect } from '../../../types'
import { Field, AdminModal, useNewItemCreation, NewItemDialog, useClientPaged, LoadMoreButton } from './shared'
import { updateNeuralDriveAbility, docExists } from '../../../lib/firestoreApi'
import { makeEntityId, stripIdPrefix } from '../../../utils/idSlug'
import { useGameData } from '../../../contexts/GameDataContext'
import { RefPicker } from '../../../components/admin/RefPicker'
import { IconField } from '../../../components/admin/IconPicker'
import { SkillEffectItem } from './PilotAdmin'

type NdFilters = { status: 'all' | 'noEffects' | 'unlinked' }

// 描述內 [xxx] token 數 vs 已指派 refs 數 → 是否有未連結標記
const tokenRe = /\[([^\]]+)\]/g
function unlinkedCount(a: NeuralDriveAbility): number {
  const tokens = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(a.description ?? '')) !== null) tokens.add(m[1])
  const refs = a.descriptionRefs ?? {}
  let n = 0
  for (const t of tokens) if (!refs[t]) n++
  return n
}

// ─── 預設值工廠 ────────────────────────────────────────────────────────────────
function makeDefaultNdAbility(id: string, name = ''): NeuralDriveAbility {
  return { id, name, description: '', descriptionRefs: {}, icon: '', iconLocal: '', effects: [], buffIds: [] }
}

// ─── 能力編輯面板 ──────────────────────────────────────────────────────────────
function NdAbilityEditPanel({
  ability,
  onSave,
  onCancel,
}: {
  ability: NeuralDriveAbility
  onSave: (a: NeuralDriveAbility) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm]     = useState<NeuralDriveAbility>({ ...ability })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => { setForm({ ...ability }) }, [ability])

  function update<K extends keyof NeuralDriveAbility>(key: K, value: NeuralDriveAbility[K]) {
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
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2 shrink-0">
        <span className="text-accent-purple">◆</span> 編輯神驅能力
        <span className="text-text-dim text-sm font-normal ml-1">{form.id}</span>
      </h3>

      <div className="overflow-y-auto flex-1 pr-1 space-y-3">
        <Field label="能力名稱 name（= [xxx] 內文字）">
          <input value={form.name} onChange={(e) => update('name', e.target.value)} className="input-field" placeholder="如：協同作戰1" />
        </Field>

        <IconField
          label="圖示 iconLocal（本地圖檔）"
          value={form.iconLocal}
          onChange={(v) => update('iconLocal', v || undefined)}
          defaultFolder="skills"
        />

        <Field label="效果說明 description">
          <textarea
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            className="input-field min-h-[120px] resize-y text-sm leading-relaxed"
            placeholder="能力效果文字（可含 [xxx] 引用其他神驅能力 / 詞條 / buff）"
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
            <p className="text-xs text-text-dim py-2 text-center">尚未填入（模擬器不計此能力）</p>
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
            placeholder="buff_xxx, buff_yyy@2"
          />
        </Field>
      </div>
    </AdminModal>
  )
}

// ─── 神驅能力庫管理列表 ──────────────────────────────────────────────────────────
export default function NeuralDriveAdmin({ initialSearch = '' }: { initialSearch?: string }) {
  const [editing, setEditing] = useState<NeuralDriveAbility | null>(null)
  const gd = useGameData()

  // 反查：每個 abilityId 被幾位機師引用（neuralDrive level 的 abilityId）
  const usageCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of gd.pilots) {
      const seen = new Set<string>()
      for (const z of p.neuralDrive ?? []) for (const lv of z.levels ?? []) {
        if (lv.abilityId && !seen.has(lv.abilityId)) { seen.add(lv.abilityId); m.set(lv.abilityId, (m.get(lv.abilityId) ?? 0) + 1) }
      }
    }
    return m
  }, [gd.pilots])

  const {
    items: filtered, loading, error, hasMore, search, setSearch,
    filters, setFilter, submitSearch, loadMore, upsert,
  } = useClientPaged<NeuralDriveAbility, NdFilters>({
    source: gd.neuralDriveAbilities,
    initialSearch,
    initialFilters: { status: 'all' },
    matchFilters: (a, f) =>
      f.status === 'all' ||
      (f.status === 'noEffects' ? (a.effects ?? []).length === 0 : unlinkedCount(a) > 0),
  })

  const { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate, derivedId } =
    useNewItemCreation(
      gd.neuralDriveAbilities,
      (a) => a.id,
      (id, name) => makeDefaultNdAbility(id, stripIdPrefix('nd', name)),
      (name) => makeEntityId('nd', name),
    )

  async function confirmCreateChecked() {
    const id = makeEntityId('nd', newId)
    if (!id) { setNewIdError('名稱無法產生有效 ID，請改用其他名稱'); return }
    if (await docExists('neuralDriveAbilities', id)) {
      setNewIdError(`已有同名能力（ID：${id}），請改名或編輯既有項目`)
      return
    }
    const item = confirmCreate()
    if (item) setEditing(item)
  }

  async function handleSave(updated: NeuralDriveAbility) {
    const version = await updateNeuralDriveAbility(updated)
    upsert(updated)
    gd.patchCollectionItem('neuralDriveAbilities', updated, version)
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
        <select value={filters.status} onChange={(e) => setFilter('status', e.target.value as NdFilters['status'])} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部</option>
          <option value="noEffects">缺 effects（待補模擬）</option>
          <option value="unlinked">缺引用標記（[xxx] 未指派）</option>
        </select>
      </div>

      {/* 計數 + 新增 */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-text-dim text-xs">
          {error ? <span className="text-accent-red">載入失敗：{error}</span>
            : loading ? '載入中...'
            : `顯示 ${filtered.length} 個能力${hasMore ? '（可載入更多）' : ''}`}
        </p>
        <button
          onClick={openCreate}
          className="text-xs px-3 py-1.5 bg-accent-purple text-black font-bold rounded-lg hover:opacity-90 transition-opacity"
        >
          + 新增能力
        </button>
      </div>

      <NewItemDialog
        creating={creating}
        newId={newId}
        newIdError={newIdError}
        placeholder="輸入能力名稱，如：協同作戰1"
        hint={<>輸入能力名稱，系統自動生成文件 ID（前綴固定 <span className="text-accent-cyan">nd_</span>）</>}
        onChangeId={(v) => { setNewId(v); setNewIdError('') }}
        onConfirm={() => { void confirmCreateChecked() }}
        onCancel={cancelCreate}
        deriveMode
        derivedId={derivedId}
      />

      {/* 能力列表 */}
      <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
        {filtered.map((a) => {
          const effCount = (a.effects ?? []).length
          const used = usageCount.get(a.id) ?? 0
          const unlinked = unlinkedCount(a)
          return (
            <div
              key={a.id}
              className="bg-bg-dark border border-accent-purple/20 rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-border-accent transition-colors cursor-pointer"
              onClick={() => setEditing(a)}
            >
              {a.iconLocal && (
                <img src={a.iconLocal} alt="" className="w-8 h-8 rounded shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm text-text-primary truncate">
                    {a.name || <span className="text-text-dim font-normal">（未命名）</span>}
                  </span>
                  <span className={`text-[13px] shrink-0 ${used > 0 ? 'text-accent-green' : 'text-text-dim'}`}>機師 {used}</span>
                  <span className={`text-[13px] shrink-0 ${effCount > 0 ? 'text-accent-cyan' : 'text-text-dim'}`}>效果 {effCount}</span>
                  {unlinked > 0 && <span className="text-[12px] px-1.5 py-0.5 rounded border border-accent-orange/40 bg-accent-orange/10 text-accent-orange shrink-0">未連結 {unlinked}</span>}
                </div>
                <p className="text-[13px] text-text-secondary truncate mt-0.5">{a.description || '（無說明）'}</p>
              </div>
              <span className="text-text-dim font-mono text-[11px] shrink-0 max-w-[30%] truncate">{a.id}</span>
            </div>
          )
        })}
        {filtered.length === 0 && !loading && (
          <p className="text-text-dim text-sm text-center py-8">找不到符合條件的能力</p>
        )}
      </div>

      <LoadMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />

      {editing && (
        <NdAbilityEditPanel
          ability={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}
