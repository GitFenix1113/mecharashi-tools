// PLAN-043 C-1／C-2：背包技能庫後台
//
// 骨架照抄 SkillAdmin（全站最乾淨的單檔範本），等級編輯區照抄 BuffAdmin 的 BuffLevelItem——
// levels[] 與 BuffLevel 同構就該用同一套操作，維護者不必學第二種。

import { useState, useEffect } from 'react'
import type { BackpackSkillDoc, BackpackSkillLevel, SkillEffect } from '../../../types'
import { SkillType } from '../../../types/enums'
import {
  Field, AdminModal, GRID_AUTO_FIELDS,
  useNewItemCreation, NewItemDialog, useClientPaged, LoadMoreButton,
  useCascadeDelete, ConfirmDeleteDialog, DeleteButton,
  DraftRestoreBar,
} from './shared'
import { useDraftWrite, useDraftRestore } from '../../../hooks/useDraftAutosave'
import { updateBackpackSkill, docExists } from '../../../lib/firestoreApi'
import { makeEntityId, stripIdPrefix } from '../../../utils/idSlug'
import { checkBuffLevelName } from '../../../utils/ndOverrides'
import { sortLevelsAscending } from '../../../utils/buffLevelRefs'
import { useGameData } from '../../../contexts/GameDataContext'
import { RefPicker } from '../../../components/admin/RefPicker'
import { IconField } from '../../../components/admin/IconPicker'
import { SkillEffectItem } from './PilotAdmin'

/** PLAN-043 E-1：背包技能圖示的獨立資料夾（與被動技能圖大量重複是刻意接受的） */
const BACKPACK_SKILL_ICON_FOLDER = 'skills/背包技能'

type SkillFilters = { skillType: string; leveled: 'all' | 'leveled' | 'flat' }

/** 階名軟驗證的文案：與 BUFF 共用檢查邏輯，但「未填」的後果不同 */
const LEVEL_NAME_OPTS = {
  missingMessage: '未填 → 前台顯示不出「移動強化Ⅰ」這類階名，只會顯示技能原名',
  sameAsBaseMessage: '與技能名稱相同 → 明示此級顯示為原名（官方無階名的技能適用）',
  baseLabel: '技能名稱',
}

// ─── 預設值工廠 ────────────────────────────────────────────────────────────────
function makeDefaultBackpackSkill(id: string, name = ''): BackpackSkillDoc {
  return {
    id,
    name,
    skillType: SkillType.PASSIVE,   // 遊戲內背包技能實務上幾乎全為被動
    description: '',
    descriptionRefs: {},
    icon: '',
    effects: [],
    buffIds: [],
  }
}

// ─── 階梯等級項（照抄 BuffLevelItem 的折疊式單級編輯）──────────────────────────
function BackpackSkillLevelItem({
  levelData,
  skillName,
  onChange,
  onRemove,
}: {
  levelData: BackpackSkillLevel
  /** 母技能名稱，供階名軟驗證比對前綴 */
  skillName: string
  onChange: (updated: BackpackSkillLevel) => void
  onRemove: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  function upd<K extends keyof BackpackSkillLevel>(key: K, value: BackpackSkillLevel[K]) {
    onChange({ ...levelData, [key]: value })
  }
  const effects = levelData.effects ?? []
  const buffIds = levelData.buffIds ?? []
  const nameCheck = checkBuffLevelName(skillName, levelData.level, levelData.name, LEVEL_NAME_OPTS)

  return (
    <div className="border border-border/60 rounded-lg bg-bg-dark/50">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none" onClick={() => setCollapsed(!collapsed)}>
        <span className="text-[13px] text-text-dim w-3">{collapsed ? '▶' : '▼'}</span>
        <span className="text-[14px] text-text-dim font-medium flex-1 truncate">
          Lv.{levelData.level}
          {levelData.name && <span className="ml-2 text-accent-cyan font-normal">{levelData.name}</span>}
          {!nameCheck.ok && <span className="ml-2 text-accent-yellow font-normal">⚠</span>}
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
            <Field label="該級顯示名 name">
              <input
                type="text"
                value={levelData.name ?? ''}
                onChange={(e) => upd('name', e.target.value || undefined)}
                className="input-field"
                placeholder={`如：${skillName || '移動強化'}Ⅱ`}
              />
            </Field>
          </div>

          {/* 軟驗證：只警示不擋存檔。刻意不做羅馬數字自動推導——既有資料已知損壞
              （'失穩ⅠⅠⅠ' 是三個重複 U+2160），推導在髒資料上必然失敗（PLAN-024） */}
          <div className={`text-[11px] leading-relaxed ${nameCheck.ok ? 'text-text-dim' : 'text-accent-yellow'}`}>
            {nameCheck.ok ? (nameCheck.message || '✓ 階名格式正確') : `⚠ ${nameCheck.message}`}
            {!nameCheck.ok && nameCheck.suggestion && (
              <button
                type="button"
                onClick={() => upd('name', nameCheck.suggestion)}
                className="ml-2 px-1.5 py-0.5 border border-accent-cyan/40 text-accent-cyan rounded hover:bg-accent-cyan/10"
              >
                套用「{nameCheck.suggestion}」
              </button>
            )}
          </div>

          <Field label="該級描述 description（選填；不填則沿用技能頂層描述）">
            <textarea
              value={levelData.description ?? ''}
              onChange={(e) => upd('description', e.target.value || undefined)}
              className="input-field min-h-[90px] resize-y text-sm leading-relaxed"
              placeholder="機甲移動力增加1格；機甲軀幹耐久值提升10%，造成傷害提升5%"
            />
          </Field>
          {/* 各級正文可各自引用（[隱形]／[武器切換]…），故 picker 也要逐級提供，
              否則 levels[].descriptionRefs 這個掃描站點永遠不可能被正確填出來 */}
          <RefPicker
            text={levelData.description ?? ''}
            value={levelData.descriptionRefs}
            onChange={(refs) => upd('descriptionRefs', refs)}
            onCompileText={(tf) => upd('description', tf(levelData.description ?? ''))}
          />

          <IconField
            label="該級圖示 icon（選填；不填沿用技能圖示）"
            value={levelData.icon ?? ''}
            onChange={(v) => upd('icon', v || undefined)}
            defaultFolder={BACKPACK_SKILL_ICON_FOLDER}
          />

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
              <p className="text-xs text-text-dim py-1 text-center">尚未填入（各級數值差異在此填，如移動力 +1 / +2）</p>
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

          <Field label="該級觸發 Buff ID buffIds（逗號分隔，選填）">
            <textarea
              value={buffIds.join(', ')}
              onChange={(e) => upd('buffIds', e.target.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))}
              className="input-field min-h-[40px] resize-none font-mono text-xs"
              placeholder="buff_001, buff_002@2"
            />
          </Field>
        </div>
      )}
    </div>
  )
}

// ─── 技能編輯面板 ──────────────────────────────────────────────────────────────
function BackpackSkillEditPanel({
  skill,
  onSave,
  onCancel,
}: {
  skill: BackpackSkillDoc
  onSave: (s: BackpackSkillDoc) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm]     = useState<BackpackSkillDoc>({ ...skill })
  useDraftWrite('backpackSkills', form, (s) => s.name)   // 草稿暫存（PLAN-045）：監聽的必須是 form，不是外層的 editing
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => { setForm({ ...skill }); setError(null) }, [skill])

  function update<K extends keyof BackpackSkillDoc>(key: K, value: BackpackSkillDoc[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }
  const effects = form.effects ?? []
  const buffIds = form.buffIds ?? []
  const levels  = form.levels ?? []
  const isLeveled = levels.length > 0

  async function handleSubmit() {
    setSaving(true); setError(null)
    try {
      // 實測 buff_迴避率降低 的 levels 順序是 [2,3,5,4]，亂序只會讓人誤讀
      await onSave({ ...form, levels: sortLevelsAscending(form.levels) })
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗，請重試')
      setSaving(false)
    }
  }

  // 欄位量與 SkillAdmin 相當 → 沿用窄版（PLAN-033）
  return (
    <AdminModal maxWidth="max-w-2xl" saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <span className="text-accent-cyan">✎</span> 編輯背包技能
          <span className="text-text-dim text-sm font-normal ml-1">{form.id}</span>
        </h3>
        {form.officialId && (
          <span
            className="text-[12px] px-1.5 py-0.5 rounded border border-border text-text-dim"
            title="官方 API 的數字技能 ID，由 PLAN-043 遷移保留，純備查"
          >
            官方 {form.officialId}
          </span>
        )}
      </div>

      <div className="overflow-y-auto flex-1 pr-1 space-y-3">
        <div className={`${GRID_AUTO_FIELDS} gap-3`}>
          <Field label="技能名稱 name">
            <input value={form.name} onChange={(e) => update('name', e.target.value)} className="input-field" placeholder="如：移動強化" />
          </Field>
          <Field label="技能類型 skillType">
            <select value={form.skillType} onChange={(e) => update('skillType', e.target.value)} className="input-field">
              <option value={SkillType.PASSIVE}>{SkillType.PASSIVE}</option>
              <option value={SkillType.ACTIVE}>{SkillType.ACTIVE}</option>
              <option value={SkillType.COMMAND}>{SkillType.COMMAND}</option>
            </select>
          </Field>
        </div>

        <IconField
          label="圖示 icon"
          value={form.icon ?? ''}
          onChange={(v) => update('icon', v)}
          defaultFolder={BACKPACK_SKILL_ICON_FOLDER}
        />

        <Field label={`效果說明 description${isLeveled ? '（階梯技能：各級可各自覆寫；此處填共通描述）' : ''}`}>
          <textarea
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            className="input-field min-h-[150px] resize-y text-sm leading-relaxed"
            placeholder="技能效果文字描述（可含 [xxx] 引用其他實體）"
          />
        </Field>

        <RefPicker
          text={form.description}
          value={form.descriptionRefs}
          onChange={(refs) => update('descriptionRefs', refs)}
          onCompileText={(tf) => update('description', tf(form.description))}
        />

        {/* 可計算效果（非階梯技能用；階梯技能改由各級提供） */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] text-text-dim font-medium uppercase tracking-wider">
              可計算效果 effects{isLeveled && '（階梯技能請改填各級）'}
            </span>
            <button
              onClick={() => update('effects', [...effects, { stat: 'dmg', value: 0, scope: 'self', condition: null }])}
              className="text-[13px] text-accent-cyan hover:text-accent-cyan/80 transition-colors"
            >
              + 新增效果
            </button>
          </div>
          {effects.length === 0 ? (
            <p className="text-xs text-text-dim py-2 text-center">尚未填入（模擬器不計此技能的數值）</p>
          ) : (
            <div className="space-y-2">
              {effects.map((eff: SkillEffect, i: number) => (
                <SkillEffectItem
                  key={i}
                  effect={eff}
                  index={i}
                  onChange={(updated) => { const next = [...effects]; next[i] = updated; update('effects', next) }}
                  onRemove={() => update('effects', effects.filter((_, idx) => idx !== i))}
                />
              ))}
            </div>
          )}
        </div>

        <Field label="觸發 Buff ID buffIds（逗號分隔）">
          <textarea
            value={buffIds.join(', ')}
            onChange={(e) => update('buffIds', e.target.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))}
            className="input-field min-h-[44px] resize-none font-mono text-xs"
            placeholder="buff_001, buff_002"
          />
        </Field>

        {/* 階梯等級 levels（PLAN-043，同構於 PLAN-024 的 BuffLevel）*/}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] text-text-dim font-medium uppercase tracking-wider">階梯等級 levels（選填）</span>
            <button
              onClick={() => update('levels', [...levels, { level: levels.length + 1 }])}
              className="text-[13px] text-accent-cyan hover:text-accent-cyan/80 transition-colors"
            >
              + 新增等級
            </button>
          </div>
          {!isLeveled ? (
            <p className="text-xs text-text-dim py-2 text-center">
              無等級資料。遊戲內「移動強化Ⅰ／Ⅱ／Ⅲ」這類同族技能填在這裡：一族一筆 doc，各級獨立 description / effects / buffIds。
            </p>
          ) : (
            <>
              <p className="text-[11px] text-accent-yellow/80 mb-2 leading-relaxed">
                ⚡ 此為階梯技能：背包以 <code>skillIds</code> 的 <code>id@N</code> 指定掛哪一級（如 <code>{form.id}@1</code>）。
              </p>
              <div className="space-y-2">
                {levels.map((lv, idx) => (
                  <BackpackSkillLevelItem
                    key={idx}
                    levelData={lv}
                    skillName={form.name}
                    onChange={(updated) => { const arr = [...levels]; arr[idx] = updated; update('levels', arr) }}
                    onRemove={() => update('levels', levels.filter((_, i) => i !== idx))}
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

// ─── 背包技能管理列表 ──────────────────────────────────────────────────────────
export default function BackpackSkillAdmin({ initialSearch = '' }: { initialSearch?: string }) {
  const [editing, setEditing] = useState<BackpackSkillDoc | null>(null)
  const draft = useDraftRestore<BackpackSkillDoc>('backpackSkills')
  const gd = useGameData()
  const del = useCascadeDelete('backpackSkill', 'backpackSkills')

  const {
    items: filtered, loading, error, hasMore, search, setSearch,
    filters, setFilter, submitSearch, loadMore, upsert,
  } = useClientPaged<BackpackSkillDoc, SkillFilters>({
    source: gd.backpackSkills,
    initialSearch,
    initialFilters: { skillType: 'all', leveled: 'all' },
    matchFilters: (s, f) =>
      (f.skillType === 'all' || s.skillType === f.skillType) &&
      (f.leveled === 'all' || (f.leveled === 'leveled' ? (s.levels?.length ?? 0) > 0 : (s.levels?.length ?? 0) === 0)),
  })

  // 掛載數：哪些技能還沒有任何背包用（孤兒），一眼看得出來
  const holderCount = new Map<string, number>()
  for (const bp of gd.backpacks) {
    for (const raw of bp.skillIds ?? []) {
      const bare = raw.split('@')[0]
      holderCount.set(bare, (holderCount.get(bare) ?? 0) + 1)
    }
  }

  const { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate, derivedId } =
    useNewItemCreation(
      gd.backpackSkills,                                        // 全集合 in-memory 撞名
      (s) => s.id,
      (id, name) => makeDefaultBackpackSkill(id, stripIdPrefix('bpskill', name)),
      (name) => makeEntityId('bpskill', name),                  // deriveId：bpskill_<slug(name)>
      (s) => s.name,                                            // 名稱撞名：ID 可能因改名而與 name 脫鉤
    )

  async function confirmCreateChecked() {
    const id = makeEntityId('bpskill', newId)
    if (!id) { setNewIdError('名稱無法產生有效 ID，請改用其他名稱'); return }
    // 伺服器端撞 ID 檢查：涵蓋不在記憶體中的技能（撞名 = 撞 ID，導引去編輯既有項）
    if (await docExists('backpackSkills', id)) {
      setNewIdError(`已有同名技能（ID：${id}），請改名或編輯既有項目`)
      return
    }
    const item = confirmCreate()
    if (item) setEditing(item)
  }

  async function handleSave(updated: BackpackSkillDoc) {
    const version = await updateBackpackSkill(updated)
    upsert(updated)
    gd.patchCollectionItem('backpackSkills', updated, version)
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
          className="flex-1 min-w-[180px] px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-cyan"
        />
        <button
          onClick={submitSearch}
          className="px-3 py-2 bg-bg-dark border border-border text-text-secondary text-sm rounded-lg hover:border-border-accent hover:text-text-primary transition-colors"
        >
          搜尋
        </button>
        <select value={filters.skillType} onChange={(e) => setFilter('skillType', e.target.value)} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部類型</option>
          <option value={SkillType.PASSIVE}>{SkillType.PASSIVE}</option>
          <option value={SkillType.ACTIVE}>{SkillType.ACTIVE}</option>
          <option value={SkillType.COMMAND}>{SkillType.COMMAND}</option>
        </select>
        <select value={filters.leveled} onChange={(e) => setFilter('leveled', e.target.value as SkillFilters['leveled'])} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部</option>
          <option value="leveled">階梯技能</option>
          <option value="flat">無等級</option>
        </select>
      </div>

      {/* 計數 + 新增 */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-text-dim text-xs">
          {error ? <span className="text-accent-red">載入失敗：{error}</span>
            : loading ? '載入中...'
            : `顯示 ${filtered.length} 個背包技能${hasMore ? '（可載入更多）' : ''}`}
        </p>
        <button
          onClick={openCreate}
          className="text-xs px-3 py-1.5 bg-accent-cyan text-black font-bold rounded-lg hover:opacity-90 transition-opacity"
        >
          + 新增背包技能
        </button>
      </div>

      <NewItemDialog
        creating={creating}
        newId={newId}
        newIdError={newIdError}
        placeholder="輸入技能名稱，如：移動強化"
        hint={<>輸入技能名稱，系統自動生成文件 ID（前綴固定 <span className="text-accent-cyan">bpskill_</span>）。同族的 Ⅰ／Ⅱ／Ⅲ 請<b>建成同一筆</b>再用「階梯等級」區分。</>}
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
          const lvCount = skill.levels?.length ?? 0
          const holders = holderCount.get(skill.id) ?? 0
          return (
            <div
              key={skill.id}
              className="bg-bg-dark border border-border rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-border-accent transition-colors cursor-pointer"
              onClick={() => setEditing(skill)}
            >
              {skill.icon && (
                <img src={skill.icon} alt="" className="w-8 h-8 rounded shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm text-text-primary truncate">
                    {skill.name || <span className="text-text-dim font-normal">（未命名）</span>}
                  </span>
                  <span className="text-[13px] px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-dim shrink-0">{skill.skillType}</span>
                  {lvCount > 0 && (
                    <span className="text-[12px] px-1.5 py-0.5 rounded border border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan shrink-0">
                      {lvCount} 級
                    </span>
                  )}
                  <span className={`text-[13px] shrink-0 ${(skill.buffIds?.length ?? 0) > 0 ? 'text-accent-cyan' : 'text-text-dim'}`}>
                    BUFF {skill.buffIds?.length ?? 0}
                  </span>
                  {/* 孤兒技能：沒有任何背包掛載 → 多半是改名／誤建的殘留 */}
                  <span className={`text-[13px] shrink-0 ${holders > 0 ? 'text-text-dim' : 'text-accent-yellow'}`}>
                    {holders > 0 ? `${holders} 個背包` : '⚠ 無背包掛載'}
                  </span>
                </div>
                <p className="text-[13px] text-text-secondary truncate mt-0.5">{skill.description || '（無說明）'}</p>
              </div>
              <span className="text-text-dim font-mono text-[11px] shrink-0 max-w-[30%] truncate">{skill.id}</span>
              <DeleteButton onAsk={() => void del.ask(skill.id)} busy={del.asking === skill.id} />
            </div>
          )
        })}
        {filtered.length === 0 && !loading && (
          <p className="text-text-dim text-sm text-center py-8">找不到符合條件的背包技能</p>
        )}
      </div>

      <LoadMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />

      {editing && (
        <BackpackSkillEditPanel
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
