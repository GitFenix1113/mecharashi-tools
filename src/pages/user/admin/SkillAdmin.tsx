import { useState, useEffect } from 'react'
import type { PilotSkillDoc, SkillEffect } from '../../../types'
import { formatWeaponReq } from '../../../types'
import { SkillType } from '../../../types/enums'
import { Field, AdminModal, useNewItemCreation, NewItemDialog, useClientPaged, LoadMoreButton, useCascadeDelete, ConfirmDeleteDialog, DeleteButton, DraftRestoreBar } from './shared'
import { useDraftWrite, useDraftRestore } from '../../../hooks/useDraftAutosave'
import { updatePilotSkill, docExists } from '../../../lib/firestoreApi'
import { makeEntityId, stripIdPrefix, idPrefixCasings } from '../../../utils/idSlug'
import { useGameData } from '../../../contexts/GameDataContext'
import { RefPicker } from '../../../components/admin/RefPicker'
import { IconField } from '../../../components/admin/IconPicker'
import { SkillEffectItem } from './PilotAdmin'

type SkillFilters = { type: string; manual: 'all' | 'manual' | 'auto'; domain: 'all' | 'pilot' | 'weapon' }

// ─── 預設值工廠 ────────────────────────────────────────────────────────────────
function makeDefaultSkill(id: string, name = ''): PilotSkillDoc {
  return {
    id,
    name,
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
  useDraftWrite('pilotSkills', form, (s) => s.name)   // 草稿暫存（PLAN-045）：監聽的必須是 form，不是外層的 editing
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

  // 欄位少 → 維持窄版（PLAN-033）；吃 AdminModal 的 90vw 預設只會讓欄位漂在空白裡
  return (
    <AdminModal maxWidth="max-w-2xl" saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
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
              <option value={SkillType.PP}>{SkillType.PP}</option>
              <option value={SkillType.EXTRA}>{SkillType.EXTRA}</option>
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="AP ap">
              <input type="text" value={form.ap ?? ''} onChange={(e) => update('ap', e.target.value || undefined)} className="input-field" placeholder="—" />
            </Field>
            <Field label="CD cd">
              <input type="text" value={form.cd ?? ''} onChange={(e) => update('cd', e.target.value || undefined)} className="input-field" placeholder="—" />
            </Field>
            <Field label="PP pp">
              <input type="text" value={form.pp ?? ''} onChange={(e) => update('pp', e.target.value || undefined)} className="input-field" placeholder="—" />
            </Field>
          </div>
        </div>

        <Field label="所屬領域 domain（PLAN-032；未填＝機師技能）">
          <select
            value={form.domain ?? ''}
            onChange={(e) => update('domain', (e.target.value || undefined) as PilotSkillDoc['domain'])}
            className="input-field"
          >
            <option value="">機師技能（未填）</option>
            <option value="pilot">機師技能</option>
            <option value="weapon">武器技能</option>
          </select>
        </Field>

        <Field label="單元類型 unitType（機師一開始自帶的「初始被動能力」請選「職業單元」）">
          <select
            value={form.unitType ?? ''}
            onChange={(e) => update('unitType', e.target.value || undefined)}
            className="input-field"
          >
            <option value="">一般技能（無）</option>
            <option value="0">核心單元</option>
            <option value="6">職業單元（初始被動能力）</option>
          </select>
        </Field>

        <IconField
          label="圖示 iconLocal（本地圖檔）"
          value={form.iconLocal}
          onChange={(v) => update('iconLocal', v)}
          defaultFolder="skills"
        />

        {form.weapon && (
          <p className="text-[12px] text-text-dim">限定武器 weapon：<span className="text-accent-purple">{formatWeaponReq(form.weapon)}</span>（由爬蟲腳本管理）</p>
        )}

        {/* PLAN-032 決策七：專武強化兩欄住在定義側（與 descriptionRefs 一起被消費，拆開會失同步）。
            此處只顯示不編輯——強化後正文是遊戲原文，改它等於偽造官方文本；
            要改請走武器爬蟲或直接改 Firestore。 */}
        {form.enhancesTalentName && (
          <div className="rounded-lg border border-accent-yellow/30 bg-accent-yellow/5 px-3 py-2 space-y-1">
            <p className="text-[12px] text-accent-yellow">
              ▶ 專武技能 · 強化天賦：<span className="font-bold">{form.enhancesTalentName}</span>
            </p>
            {form.enhancedTalentDescription && (
              <p className="text-[12px] text-text-secondary leading-relaxed">
                強化後天賦原文：{form.enhancedTalentDescription}
              </p>
            )}
            <p className="text-[11px] text-text-dim">（遊戲原文，唯讀；與上方 descriptionRefs 共用同一份引用表）</p>
          </div>
        )}

        <Field label="效果說明 description">
          <textarea
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            className="input-field min-h-[150px] resize-y text-sm leading-relaxed"
            placeholder="技能效果文字描述（可含 [xxx] 引用其他實體）"
          />
        </Field>

        <RefPicker
          text={form.description}
          // 專武強化正文與各 variant 正文共用這份引用表（PLAN-032 決策七），
          // 不傳的話它們獨有的 [xxx] 會被誤報成殘留
          siblingTexts={[
            form.enhancedTalentDescription,
            ...(form.variants ?? []).map((v) => v.description),
          ]}
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
  const draft = useDraftRestore<PilotSkillDoc>('pilotSkills')
  const gd = useGameData()
  const del = useCascadeDelete('pilotSkill', 'pilotSkills')

  const {
    items: filtered, loading, error, hasMore, search, setSearch,
    filters, setFilter, submitSearch, loadMore, upsert,
  } = useClientPaged<PilotSkillDoc, SkillFilters>({
    source: gd.pilotSkills,
    initialSearch,
    initialFilters: { type: 'all', manual: 'all', domain: 'all' },
    matchFilters: (s, f) =>
      (f.type === 'all' || s.type === f.type) &&
      (f.manual === 'all' || (f.manual === 'manual' ? s.manual === true : s.manual !== true)) &&
      // PLAN-032：未填 domain 一律視為 'pilot'（既有 719 筆天然合法，不需要回填）
      (f.domain === 'all' || (s.domain ?? 'pilot') === f.domain),
  })

  const { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate, derivedId } =
    useNewItemCreation(
      gd.pilotSkills,                                          // 全集合 in-memory 撞名（涵蓋未在當前分頁者）
      (s) => s.id,
      (id, name) => makeDefaultSkill(id, stripIdPrefix('skill', name)), // name 也剝除誤打前綴
      (name) => makeEntityId('skill', name),                  // deriveId：skill_<slug(name)>
      (s) => s.name,                                          // 名稱撞名：ID 可能因改名而與 name 脫鉤
    )

  async function confirmCreateChecked() {
    const id = makeEntityId('skill', newId)
    if (!id) { setNewIdError('名稱無法產生有效 ID，請改用其他名稱'); return }
    // 伺服器端撞 ID 檢查：涵蓋不在記憶體中的技能（撞名 = 撞 ID，導引去編輯既有項）。
    //
    // PLAN-032 M0：**大小寫兩種前綴都要查**。技能庫現況是 `SKILL_` 大寫 134 筆 /
    // `skill_` 小寫 512 筆的混血（歷史遺留），而 makeEntityId 只產得出小寫形式——
    // 只查小寫等於對那 134 筆完全無防呆，`SKILL_故障植入` 存在時仍會放行建出
    // `skill_故障植入`，變成同名兩份。Firestore 文件 ID 區分大小寫，這兩筆是真的兩份文件。
    // （in-memory 那道 useNewItemCreation 的檢查本來就不分大小寫，這裡是補齊伺服器端。）
    const clashId = (await Promise.all(
      idPrefixCasings(id).map(async (cand) => (await docExists('pilotSkills', cand)) ? cand : null),
    )).find(Boolean)
    if (clashId) {
      setNewIdError(`已有同名技能（ID：${clashId}），請改名或編輯既有項目`)
      return
    }
    const item = confirmCreate()
    if (item) setEditing(item)
  }

  async function handleSave(updated: PilotSkillDoc) {
    const version = await updatePilotSkill(updated)
    upsert(updated)
    gd.patchCollectionItem('pilotSkills', updated, version)
    draft.commit()   // 存檔成功 → 清除本機草稿，避免下次進頁跳過期提示
    setEditing(null)
  }

  return (
    <div>
      <DraftRestoreBar draft={draft} onRestore={setEditing} />
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
          <option value={SkillType.PP}>{SkillType.PP}</option>
          <option value={SkillType.EXTRA}>{SkillType.EXTRA}</option>
        </select>
        <select value={filters.manual} onChange={(e) => setFilter('manual', e.target.value as SkillFilters['manual'])} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部來源</option>
          <option value="manual">手動新增</option>
          <option value="auto">腳本擷取</option>
        </select>
        {/* PLAN-032：本集合是「技能庫」不是「機師的技能」——武器技能也住這裡，用 domain 分類 */}
        <select value={filters.domain} onChange={(e) => setFilter('domain', e.target.value as SkillFilters['domain'])} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部領域</option>
          <option value="pilot">機師技能</option>
          <option value="weapon">武器技能</option>
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
        placeholder="輸入技能名稱，如：虛粒子形態"
        hint={<>輸入技能名稱，系統自動生成文件 ID（前綴固定 <span className="text-accent-cyan">skill_</span>）</>}
        onChangeId={(v) => { setNewId(v); setNewIdError('') }}
        onConfirm={() => { void confirmCreateChecked() }}
        onCancel={cancelCreate}
        deriveMode
        derivedId={derivedId}
      />

      {!del.plan && del.error && (
        <p className="text-accent-red text-xs mb-2">⚠ 無法讀取刪除影響範圍：{del.error}</p>
      )}

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
                  {skill.unitType === '6' && <span className="text-[12px] px-1.5 py-0.5 rounded border border-accent-green/40 bg-accent-green/10 text-accent-green shrink-0">初始被動</span>}
                  {skill.manual && <span className="text-[12px] px-1.5 py-0.5 rounded border border-accent-orange/40 bg-accent-orange/10 text-accent-orange shrink-0">手動</span>}
                  {skill.domain === 'weapon' && <span className="text-[12px] px-1.5 py-0.5 rounded border border-accent-purple/40 bg-accent-purple/10 text-accent-purple shrink-0">武器</span>}
                  {skill.ap && <span className="text-[13px] text-accent-green shrink-0">AP {skill.ap}</span>}
                  {skill.cd && <span className="text-[13px] text-accent-orange shrink-0">CD {skill.cd}</span>}
                  {skill.pp && <span className="text-[13px] text-accent-yellow shrink-0">PP {skill.pp}</span>}
                  <span className={`text-[13px] shrink-0 ${effCount > 0 ? 'text-accent-cyan' : 'text-text-dim'}`}>效果 {effCount}</span>
                </div>
                <p className="text-[13px] text-text-secondary truncate mt-0.5">{skill.description || '（無說明）'}</p>
              </div>
              <span className="text-text-dim font-mono text-[11px] shrink-0 max-w-[30%] truncate">{skill.id}</span>
              <DeleteButton onAsk={() => void del.ask(skill.id)} busy={del.asking === skill.id} />
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
          onCancel={() => { draft.discard(); setEditing(null) }}
        />
      )}

      {del.plan && (
        <ConfirmDeleteDialog
          plan={del.plan}
          busy={del.busy}
          error={del.error}
          onConfirm={() => void del.confirm()}
          onCancel={del.cancel}
        />
      )}
    </div>
  )
}
