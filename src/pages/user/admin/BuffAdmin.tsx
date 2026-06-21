import { useState, useEffect, useMemo } from 'react'
import type { GameBuff, SkillEffect, BuffLevel } from '../../../types'
import { BuffType } from '../../../types/enums'
import { Field, AdminModal, useNewItemCreation, NewItemDialog, useClientPaged, LoadMoreButton } from './shared'
import { updateBuff, docExists } from '../../../lib/firestoreApi'
import { useGameData } from '../../../contexts/GameDataContext'
import { RefPicker } from '../../../components/admin/RefPicker'
import { IconField } from '../../../components/admin/IconPicker'
import { resolveIconSrc } from '../../../utils/assets'
import { makeEntityId, stripIdPrefix } from '../../../utils/idSlug'
import { SkillEffectItem } from './PilotAdmin'

// ─── BuffType 顯示對照 ──────────────────────────────────────────────────────────
const BUFF_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: BuffType.STAT_BOOST, label: '數值增益 statBoost' },
  { value: BuffType.RESOURCE,   label: '資源 resource' },
  { value: BuffType.STATE,      label: '狀態 / 形態 state' },
  { value: BuffType.DEBUFF,     label: '減益 debuff' },
  { value: BuffType.CONTROL,    label: '控制 control' },
]
const BUFF_TYPE_LABEL: Record<string, string> = {
  statBoost: '數值增益', resource: '資源', state: '狀態', debuff: '減益', control: '控制',
}

// ─── 預設值工廠 ────────────────────────────────────────────────────────────────
// PLAN-020：建立時帶入名稱與分類，編輯面板開啟時 name / buffType 已預填。
function makeDefaultBuff(id: string, name = '', buffType: string = BuffType.STATE): GameBuff {
  return { id, name, description: '', descriptionRefs: {}, buffType, effects: [], icon: undefined }
}

// ─── 互斥群組選擇器（防呆）──────────────────────────────────────────────────────
// 自由文字易因「跨筆字串必須完全一致」而出錯：改為「從現有群組挑選」為主、「建立新群組」為輔。
// 加入既有群組 = 從清單選同一字串（不可能打錯）；建新才打字並即時擋大小寫變體重複 + NFC/trim 正規化。
// 群組命名中立：不限定 pilot 前綴，全域互斥（如「傷害提升」）也只是清單裡的一筆。
const MUTEX_NONE = '__mutex_none__'
const MUTEX_NEW = '__mutex_new__'
const MUTEX_CURRENT = '__mutex_current__'
const normalizeMutex = (s: string) => s.normalize('NFC').trim()

function MutexGroupField({
  value,
  currentBuffId,
  onChange,
}: {
  value: string | undefined
  currentBuffId: string
  onChange: (v: string | undefined) => void
}) {
  const gd = useGameData()
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState<string | null>(null)

  // group → 其他成員名稱[]（排除目前編輯中的 buff，避免自身重複計數）
  const groupMembers = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const b of gd.buffs) {
      if (!b.mutexGroup || b.id === currentBuffId) continue
      const arr = m.get(b.mutexGroup) ?? []
      arr.push(b.name || b.id)
      m.set(b.mutexGroup, arr)
    }
    return m
  }, [gd.buffs, currentBuffId])

  const groups = useMemo(() => [...groupMembers.keys()].sort(), [groupMembers])
  const valueIsKnown = value != null && groups.includes(value)
  const others = value != null ? groupMembers.get(value) ?? [] : []

  function handleSelect(v: string) {
    setNote(null)
    if (v === MUTEX_NONE) { onChange(undefined); return }
    if (v === MUTEX_NEW) { setDraft(''); setCreating(true); return }
    onChange(v)
  }

  function confirmNew() {
    const norm = normalizeMutex(draft)
    if (!norm) { setNote('請輸入群組名稱'); return }
    // 不分大小寫命中既有群組 → 改用既有正規寫法，避免大小寫變體造成「看起來同組、實則不同」
    const hit = groups.find((g) => g.toLowerCase() === norm.toLowerCase())
    onChange(hit ?? norm)
    setCreating(false)
    setDraft('')
    setNote(hit ? `已對應現有群組「${hit}」` : null)
  }

  const draftNorm = normalizeMutex(draft)
  const draftHit = groups.find((g) => g.toLowerCase() === draftNorm.toLowerCase())

  return (
    <Field label="互斥群組 mutexGroup（選填；同群一次只能存在一個，計算器取最高）">
      {!creating ? (
        <>
          <select
            value={valueIsKnown ? value! : value != null ? MUTEX_CURRENT : MUTEX_NONE}
            onChange={(e) => handleSelect(e.target.value)}
            className="input-field"
          >
            <option value={MUTEX_NONE}>（無互斥）</option>
            {value != null && !valueIsKnown && <option value={MUTEX_CURRENT}>{value}（新群組）</option>}
            {groups.map((g) => (
              <option key={g} value={g}>{g} · {groupMembers.get(g)!.length} 個成員</option>
            ))}
            <option value={MUTEX_NEW}>＋ 建立新群組…</option>
          </select>
          {value != null && (
            <p className="text-[12px] text-text-dim mt-1">
              {others.length > 0
                ? <>同群：{others.join('、')}（連同此 BUFF 共 {others.length + 1} 個）</>
                : '新群組，目前僅此 BUFF'}
            </p>
          )}
          {note && <p className="text-[12px] text-accent-cyan mt-1">{note}</p>}
        </>
      ) : (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setNote(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmNew() } }}
              className="input-field flex-1"
              placeholder="如：pilot_0XX_艾達_凝勢 或 傷害提升·全域"
            />
            <button type="button" onClick={confirmNew} className="px-3 py-1.5 bg-accent-orange text-black font-bold rounded-lg text-sm shrink-0">確認</button>
            <button type="button" onClick={() => { setCreating(false); setDraft('') }} className="px-3 py-1.5 bg-bg-dark border border-border text-text-secondary rounded-lg text-sm shrink-0">取消</button>
          </div>
          {draftNorm && (
            <p className="text-[12px] text-text-dim">
              將{draftHit ? '改用既有群組' : '建立'}：<span className="text-accent-cyan">{draftHit ?? draftNorm}</span>
              {draftHit && '（已存在相近群組，避免重複）'}
            </p>
          )}
          {note && <p className="text-[12px] text-accent-red">{note}</p>}
        </div>
      )}
    </Field>
  )
}

// ─── 詞條來源（PLAN-024）：掛 glossaryTerm，用其官方說明取代 buff 詳情卡顯示 ──────────
// 純顯示來源綁定，無計算意義；為未來技能資料庫鋪路（關鍵字說明單一真相源）。
function TermRefField({
  value,
  onChange,
}: {
  value: string | undefined
  onChange: (v: string | undefined) => void
}) {
  const gd = useGameData()
  useEffect(() => { gd.ensureLoaded(['glossaryTerms']) }, [gd])
  const terms = useMemo(
    () => [...gd.glossaryTerms].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')),
    [gd.glossaryTerms],
  )
  const selected = value ? gd.glossaryTerms.find((t) => t.id === value) : undefined
  return (
    <Field label="詞條來源 termRef（選填；填了則詳情卡改用此詞條的官方說明，取代上方說明）">
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className="input-field">
        <option value="">（不掛詞條，沿用上方說明）</option>
        {value && !selected && <option value={value}>{value}（找不到此詞條）</option>}
        {terms.map((t) => (
          <option key={t.id} value={t.id}>{t.name}{t.category ? ` · ${t.category}` : ''}</option>
        ))}
      </select>
      {selected && (
        <p className="text-[12px] text-text-dim mt-1 leading-relaxed whitespace-pre-wrap">
          詞條說明：{selected.description || '（此詞條尚無說明）'}
        </p>
      )}
    </Field>
  )
}

// ─── 階梯等級項（PLAN-024）：折疊式單級編輯，比照 ModuleLevelItem ──────────────────
function BuffLevelItem({
  levelData,
  onChange,
  onRemove,
}: {
  levelData: BuffLevel
  onChange: (updated: BuffLevel) => void
  onRemove: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  function upd<K extends keyof BuffLevel>(key: K, value: BuffLevel[K]) {
    onChange({ ...levelData, [key]: value })
  }
  const effects = levelData.effects ?? []
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
            <Field label="該級描述 description（選填）">
              <input type="text" value={levelData.description ?? ''} onChange={(e) => upd('description', e.target.value || undefined)} className="input-field" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="最大疊加 maxStack（選填）">
              <input
                type="number"
                value={levelData.maxStack ?? ''}
                onChange={(e) => upd('maxStack', e.target.value === '' ? undefined : Number(e.target.value))}
                className="input-field"
              />
            </Field>
            <Field label="持續回合 duration（選填）">
              <input
                type="number"
                value={levelData.duration ?? ''}
                onChange={(e) => upd('duration', e.target.value === '' ? undefined : Number(e.target.value))}
                className="input-field"
              />
            </Field>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] text-text-dim font-medium uppercase tracking-wider">該級效果 effects</span>
              <button
                onClick={() => upd('effects', [...effects, { stat: 'dmg', value: 0, scope: 'self', condition: null }])}
                className="text-[12px] text-accent-cyan hover:text-accent-cyan/80 transition-colors"
              >
                + 新增效果
              </button>
            </div>
            {effects.length === 0 ? (
              <p className="text-xs text-text-dim py-1 text-center">尚未填入（數值型階梯各級在此填 dmg 等增益）</p>
            ) : (
              <div className="space-y-2">
                {effects.map((eff, i) => (
                  <SkillEffectItem
                    key={i}
                    effect={eff}
                    index={i}
                    onChange={(updated) => { const next = [...effects]; next[i] = updated; upd('effects', next) }}
                    onRemove={() => upd('effects', effects.filter((_, idx) => idx !== i))}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── BUFF 編輯面板 ──────────────────────────────────────────────────────────────
function BuffEditPanel({
  buff,
  onSave,
  onCancel,
}: {
  buff: GameBuff
  onSave: (b: GameBuff) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm]     = useState<GameBuff>({ ...buff })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => { setForm({ ...buff }) }, [buff])

  function update<K extends keyof GameBuff>(key: K, value: GameBuff[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }
  const effects = form.effects ?? []
  function updateEffects(next: SkillEffect[]) { update('effects', next) }

  // PLAN-024：flat XOR leveled — 有 levels 即為階梯 buff，能力資料權威來源轉為各級，
  // 頂層 maxStack/duration/effects 停用（避免「頂層 vs 各級」雙來源衝突）。
  const isLeveled = (form.levels?.length ?? 0) > 0
  const staleTop = [
    form.maxStack != null && 'maxStack',
    form.duration != null && 'duration',
    (form.effects?.length ?? 0) > 0 && 'effects',
  ].filter(Boolean) as string[]
  const hasStaleTop = isLeveled && staleTop.length > 0

  async function handleSubmit() {
    setSaving(true); setError(null)
    // 階梯 buff 存檔時清空頂層能力欄位，確保 DB 不殘留非權威資料
    const payload: GameBuff = isLeveled ? { ...form, maxStack: undefined, duration: undefined, effects: [] } : form
    try { await onSave(payload) }
    catch (e) { setError(e instanceof Error ? e.message : '儲存失敗，請重試'); setSaving(false) }
  }

  return (
    <AdminModal saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2 shrink-0">
        <span className="text-accent-orange">◆</span>
        編輯 BUFF
        <span className="text-text-dim text-sm font-normal ml-1">{form.id}</span>
      </h3>

      <div className="overflow-y-auto flex-1 pr-1 space-y-3">
        {hasStaleTop && (
          <div className="rounded-lg border border-accent-yellow/40 bg-accent-yellow/10 px-3 py-2.5 text-[12px] text-accent-yellow leading-relaxed">
            ⚠ 此為階梯 buff，但頂層仍殘留 <span className="font-bold">{staleTop.join(' / ')}</span>；儲存後會自動清空（能力資料改由各等級提供）。請先確認各級已填好對應數值再儲存。
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="名稱 name（= [xxx] 內文字）">
            <input value={form.name} onChange={(e) => update('name', e.target.value)} className="input-field" placeholder="如：虛粒子形態" />
          </Field>
          <Field label="類型 buffType">
            <select value={form.buffType} onChange={(e) => update('buffType', e.target.value)} className="input-field">
              {BUFF_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>

        <Field label="說明 description">
          <textarea
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            className="input-field min-h-[150px] resize-y text-sm leading-relaxed"
            placeholder="BUFF 效果說明（可含 [xxx] 引用其他實體，含其他 buff）"
          />
        </Field>

        {/* 說明內也能引用其他實體（含 buff 互引） */}
        <RefPicker
          text={form.description}
          value={form.descriptionRefs}
          onChange={(refs) => update('descriptionRefs', refs)}
          onCompileText={(tf) => update('description', tf(form.description))}
        />

        {!isLeveled ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="最大疊加 maxStack（選填）">
              <input
                type="number"
                value={form.maxStack ?? ''}
                onChange={(e) => update('maxStack', e.target.value === '' ? undefined : Number(e.target.value))}
                className="input-field"
              />
            </Field>
            <Field label="持續回合 duration（選填）">
              <input
                type="number"
                value={form.duration ?? ''}
                onChange={(e) => update('duration', e.target.value === '' ? undefined : Number(e.target.value))}
                className="input-field"
              />
            </Field>
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 bg-bg-dark/40 px-3 py-2.5 text-[12px] text-text-dim leading-relaxed">
            最大疊加 / 持續回合改由 <span className="text-accent-yellow">各等級</span> 提供（階梯 buff，頂層欄位已停用）。
          </div>
        )}

        <IconField
          label="圖示 icon（選填）"
          value={form.icon}
          onChange={(v) => update('icon', v || undefined)}
          defaultFolder="skills"
        />

        <MutexGroupField
          value={form.mutexGroup}
          currentBuffId={form.id}
          onChange={(v) => update('mutexGroup', v)}
        />

        <TermRefField
          value={form.termRef}
          onChange={(v) => update('termRef', v)}
        />

        {/* 可計算效果（階梯 buff 改由各級提供，頂層停用）*/}
        {!isLeveled ? (
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
              <p className="text-xs text-text-dim py-2 text-center">尚未填入（計算器／模擬器不計此 BUFF）</p>
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
        ) : (
          <div className="rounded-lg border border-border/60 bg-bg-dark/40 px-3 py-2.5 text-[12px] text-text-dim leading-relaxed">
            可計算效果改由 <span className="text-accent-yellow">各等級</span> 的 effects 提供（階梯 buff，頂層 effects 已停用）。
          </div>
        )}

        {/* 階梯等級 levels（PLAN-024）：填了即為階梯 buff，各級獨立 maxStack/effects */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] text-text-dim font-medium uppercase tracking-wider">階梯等級 levels（選填）</span>
            <button
              onClick={() => update('levels', [...(form.levels ?? []), { level: (form.levels?.length ?? 0) + 1 }])}
              className="text-[13px] text-accent-cyan hover:text-accent-cyan/80 transition-colors"
            >
              + 新增等級
            </button>
          </div>
          {(form.levels ?? []).length === 0 ? (
            <p className="text-xs text-text-dim py-2 text-center">
              無等級資料。填了即為「階梯 buff」：各級獨立 maxStack / effects，同 buff 不同 level 天然互斥（取代 mutexGroup）。
            </p>
          ) : (
            <>
              <p className="text-[11px] text-accent-yellow/80 mb-2 leading-relaxed">
                ⚡ 此為階梯 buff：頂層 maxStack / 互斥群組可留空，由各級提供；數值引用以 <code>&lt;id.lvN.attr&gt;</code> 指定級、buffIds 以 <code>id@N</code> 賦予級。
              </p>
              <div className="space-y-2">
                {(form.levels ?? []).map((lv, idx) => (
                  <BuffLevelItem
                    key={idx}
                    levelData={lv}
                    onChange={(updated) => { const arr = [...(form.levels ?? [])]; arr[idx] = updated; update('levels', arr) }}
                    onRemove={() => update('levels', (form.levels ?? []).filter((_, i) => i !== idx))}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </AdminModal>
  )
}

// ─── BUFF 管理列表 ──────────────────────────────────────────────────────────────
export default function BuffAdmin({ initialSearch = '' }: { initialSearch?: string }) {
  const [editing, setEditing] = useState<GameBuff | null>(null)
  const gd = useGameData()

  const {
    items: filtered, loading, error, hasMore, search, setSearch,
    submitSearch, loadMore, upsert,
  } = useClientPaged<GameBuff, Record<string, never>>({
    source: gd.buffs,
    initialSearch,
    initialFilters: {},
    matchFilters: () => true,
  })

  // 新建對話框先選分類，分類寫入 buffType 欄位、不進 ID（決策二：前綴統一 buff_）
  const [newBuffType, setNewBuffType] = useState<string>(BuffType.STATE)

  const { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate, derivedId } =
    useNewItemCreation(
      gd.buffs,                                          // 全集合 in-memory 撞名（涵蓋未在當前分頁者）
      (b) => b.id,
      (id, name) => makeDefaultBuff(id, stripIdPrefix('buff', name), newBuffType), // name 也剝除誤打前綴
      (name) => makeEntityId('buff', name),             // deriveId：buff_<slug(name)>
    )

  function startCreate() { setNewBuffType(BuffType.STATE); openCreate() }

  async function confirmCreateChecked() {
    const id = makeEntityId('buff', newId)
    if (!id) { setNewIdError('名稱無法產生有效 ID，請改用其他名稱'); return }
    // 伺服器端撞 ID 檢查：涵蓋不在記憶體中的 BUFF（撞名 = 撞 ID，導引去編輯既有項）
    if (await docExists('buffs', id)) {
      setNewIdError(`已有同名 BUFF（ID：${id}），請改名或編輯既有項目`)
      return
    }
    const item = confirmCreate()                         // 頁內 in-memory 撞名 + 生成預設值
    if (item) setEditing(item)
  }

  async function handleSave(updated: GameBuff) {
    const version = await updateBuff(updated)
    upsert(updated)
    gd.patchCollectionItem('buffs', updated, version)
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
            : `顯示 ${filtered.length} 個 BUFF${hasMore ? '（可載入更多）' : ''}`}
        </p>
        <button
          onClick={startCreate}
          className="text-xs px-3 py-1.5 bg-accent-orange text-black font-bold rounded-lg hover:opacity-90 transition-opacity"
        >
          + 新增 BUFF
        </button>
      </div>

      <NewItemDialog
        creating={creating}
        newId={newId}
        newIdError={newIdError}
        placeholder="輸入 BUFF 名稱，如：虛粒子形態"
        hint={<>輸入 BUFF 名稱，系統自動生成文件 ID（前綴固定 <span className="text-accent-cyan">buff_</span>）</>}
        onChangeId={(v) => { setNewId(v); setNewIdError('') }}
        onConfirm={() => { void confirmCreateChecked() }}
        onCancel={cancelCreate}
        deriveMode
        derivedId={derivedId}
        extra={
          <label className="flex items-center gap-2 text-xs text-text-dim">
            分類 buffType
            <select
              value={newBuffType}
              onChange={(e) => setNewBuffType(e.target.value)}
              className="px-2 py-1 rounded-lg bg-bg-card border border-border text-text-primary text-sm focus:outline-none focus:border-accent-orange"
            >
              {BUFF_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        }
      />

      {/* BUFF 列表 */}
      <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
        {filtered.map((buff) => (
          <div
            key={buff.id}
            className="bg-bg-dark border border-accent-orange/20 rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-border-accent transition-colors cursor-pointer"
            onClick={() => setEditing(buff)}
          >
            {buff.icon && (
              <img src={resolveIconSrc(buff.icon)} alt="" className="w-8 h-8 rounded shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm text-text-primary truncate">
                  {buff.name || <span className="text-text-dim font-normal">（未命名）</span>}
                </span>
                <span className="text-[13px] px-1.5 py-0.5 rounded border border-accent-orange/30 bg-accent-orange/10 text-accent-orange shrink-0">
                  {BUFF_TYPE_LABEL[buff.buffType] ?? buff.buffType}
                </span>
                {buff.mutexGroup && (
                  <span className="text-[12px] text-text-dim shrink-0">互斥 {buff.mutexGroup}</span>
                )}
              </div>
              <p className="text-[13px] text-text-secondary truncate mt-0.5">{buff.description || '（無說明）'}</p>
            </div>
          </div>
        ))}
        {filtered.length === 0 && !loading && (
          <p className="text-text-dim text-sm text-center py-8">找不到符合條件的 BUFF</p>
        )}
      </div>

      <LoadMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />

      {editing && (
        <BuffEditPanel
          buff={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}
