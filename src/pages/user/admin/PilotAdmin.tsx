import { useState, useEffect, useMemo } from 'react'
import type { Pilot, PilotSkill, PilotSkillDoc, PilotTalent, TalentNdVariant, SkillEffect, SkillCondition, NeuralDrive, NeuralDriveLevel, NeuralDriveAbility } from '../../../types'
import { formatWeaponReq } from '../../../types'
import { ItemRarity, PilotClass, MechLicense, WeaponType } from '../../../types/enums'
import { Field, AdminModal, useClientPaged, LoadMoreButton, useNewItemCreation, NewItemDialog } from './shared'
import { updatePilot, docExists } from '../../../lib/firestoreApi'
import { makeEntityId, stripIdPrefix } from '../../../utils/idSlug'
import { useGameData } from '../../../contexts/GameDataContext'
import { buildSkillMap } from '../../../utils/pilotSkills'
import { buildNdAbilityMap } from '../../../utils/neuralDriveAbilities'
import { RefPicker } from '../../../components/admin/RefPicker'
import { IconField } from '../../../components/admin/IconPicker'
import { PILOT_RARITY_CLASS, TRIGGER_DISPLAY, STAT_OPTIONS } from './constants'

// ─── 新機師預設值工廠（PLAN-025）─────────────────────────────────────────────────
// 手建機師沒有官方爬蟲來源：statsBase / additionalInfo 給空物件，apBase 複製 ap。
// manual:true 讓爬蟲補丁整筆跳過（防日後官方同名機師覆寫人工資料）。
function makeDefaultPilot(id: string, name = ''): Pilot {
  const ap = { init: 0, max: 0, recovery: 0 }
  return {
    id,
    name,
    fullName: name,
    rarity: ItemRarity.S,
    class: PilotClass.ASSAULT,
    faction: '',
    license: MechLicense.MEDIUM,
    masterLevel: '',
    profile: { gender: '', bloodType: '', height: '', additionalInfo: {} },
    stats: { melee: 0, assault: 0, shooting: 0, tactics: 0, defense: 0, engineering: 0 },
    statsBase: {},
    ap,
    apBase: { ...ap },
    talents: [],
    skills: [],
    neuralDrive: [],
    portrait: '',
    manual: true,
  }
}

type PilotFilters = { rarity: string; class: string }

// ─── 技能條件編輯器 ────────────────────────────────────────────────────────────
function SkillConditionEditor({
  condition,
  onChange,
}: {
  condition: SkillCondition
  onChange: (updated: SkillCondition) => void
}) {
  return (
    <div className="p-2 bg-bg-dark/60 rounded border border-border/40 space-y-2 mt-1.5">
      <Field label="觸發條件 trigger">
        <select
          value={condition.trigger}
          onChange={(e) => onChange({ ...condition, trigger: e.target.value })}
          className="input-field"
        >
          {Object.entries(TRIGGER_DISPLAY).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      </Field>
      {condition.trigger === 'weaponType' && (
        <Field label="武器類型 weaponType">
          <select
            value={condition.weaponType ?? ''}
            onChange={(e) => onChange({ ...condition, weaponType: e.target.value || undefined })}
            className="input-field"
          >
            <option value="">不限</option>
            {Object.values(WeaponType).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      )}
      {condition.trigger === 'hpBelow' && (
        <Field label="HP 門檻 (%) hpThreshold">
          <input
            type="number"
            value={condition.hpThreshold ?? ''}
            onChange={(e) => onChange({ ...condition, hpThreshold: e.target.value !== '' ? Number(e.target.value) : undefined })}
            className="input-field"
            placeholder="如：50 代表 HP < 50%"
          />
        </Field>
      )}
      {condition.trigger === 'onApSkill' && (
        <Field label="最低 AP 消耗 minApCost">
          <input
            type="number"
            value={condition.minApCost ?? ''}
            onChange={(e) => onChange({ ...condition, minApCost: e.target.value !== '' ? Number(e.target.value) : undefined })}
            className="input-field"
          />
        </Field>
      )}
      {condition.trigger === 'hasBuff' && (
        <Field label="狀態名稱 hasBuff">
          <input
            type="text"
            value={condition.hasBuff ?? ''}
            onChange={(e) => onChange({ ...condition, hasBuff: e.target.value || undefined })}
            className="input-field"
            placeholder="如：強化射擊、瞄準"
          />
        </Field>
      )}
      <Field label="目標職業 targetClass（選填）">
        <input
          type="text"
          value={condition.targetClass ?? ''}
          onChange={(e) => onChange({ ...condition, targetClass: e.target.value || undefined })}
          className="input-field"
          placeholder="如：突擊手（留空 = 不限）"
        />
      </Field>
    </div>
  )
}

// ─── 技能效果項目 ──────────────────────────────────────────────────────────────
export function SkillEffectItem({
  effect,
  index,
  onChange,
  onRemove,
}: {
  effect: SkillEffect
  index: number
  onChange: (updated: SkillEffect) => void
  onRemove: () => void
}) {
  const hasCondition = effect.condition !== null

  return (
    <div className="border border-border/50 rounded-lg p-2.5 space-y-2 bg-bg-card/30">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-text-dim">效果 #{index + 1}</span>
        <button
          onClick={onRemove}
          className="text-[13px] px-1.5 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10"
        >
          ✕ 移除
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="屬性 stat">
          <select
            value={effect.stat}
            onChange={(e) => onChange({ ...effect, stat: e.target.value })}
            className="input-field text-xs"
          >
            {STAT_OPTIONS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
        </Field>
        <Field label="數值 value">
          <input
            type="number"
            value={effect.value}
            onChange={(e) => onChange({ ...effect, value: Number(e.target.value) })}
            className="input-field"
          />
        </Field>
        <Field label="對象 scope">
          <select
            value={effect.scope}
            onChange={(e) => onChange({ ...effect, scope: e.target.value })}
            className="input-field"
          >
            <option value="self">自身 (self)</option>
            <option value="ally">隊友 (ally)</option>
            <option value="team">全隊 (team)</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="計算方式 valueType">
          <select
            value={effect.valueType ?? 'add'}
            onChange={(e) => onChange({ ...effect, valueType: e.target.value as 'add' | 'override' })}
            className="input-field"
          >
            <option value="add">加算 (add)　—　預設</option>
            <option value="override">覆蓋原始值 (override)</option>
          </select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[14px] text-text-dim cursor-pointer">
        <input
          type="checkbox"
          checked={hasCondition}
          onChange={() => onChange({ ...effect, condition: hasCondition ? null : { trigger: 'always' } })}
          className="accent-accent-orange w-3.5 h-3.5"
        />
        有條件觸發
      </label>
      {hasCondition && effect.condition && (
        <SkillConditionEditor
          condition={effect.condition}
          onChange={(cond) => onChange({ ...effect, condition: cond })}
        />
      )}
    </div>
  )
}

// ─── 可計算效果清單編輯器（天賦 effects / enhancedEffects 共用）────────────────
function EffectListEditor({
  label,
  effects,
  onChange,
}: {
  label: string
  effects: SkillEffect[]
  onChange: (next: SkillEffect[]) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] text-text-dim font-medium uppercase tracking-wider">{label}</span>
        <button
          onClick={() => onChange([...effects, { stat: 'dmg', value: 0, scope: 'self', condition: null }])}
          className="text-[13px] text-accent-cyan hover:text-accent-cyan/80 transition-colors"
        >
          + 新增效果
        </button>
      </div>
      {effects.length === 0 ? (
        <p className="text-xs text-text-dim py-2 text-center">尚未填入</p>
      ) : (
        <div className="space-y-2">
          {effects.map((eff, i) => (
            <SkillEffectItem
              key={i}
              effect={eff}
              index={i}
              onChange={(updated) => { const next = [...effects]; next[i] = updated; onChange(next) }}
              onRemove={() => onChange(effects.filter((_, idx) => idx !== i))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 已指派技能列（唯讀；效果/描述請至「技能管理」分頁編輯）──────────────────────
function AssignedSkillRow({
  id,
  skill,
  index,
  count,
  onMove,
  onRemove,
}: {
  id: string
  skill: PilotSkillDoc | null
  index: number
  count: number
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const effCount = skill ? (skill.effects ?? []).length : 0
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/60 bg-bg-dark/50">
      <div className="flex flex-col shrink-0">
        <button type="button" onClick={() => onMove(-1)} disabled={index === 0}
          className="text-[11px] leading-none text-text-dim hover:text-text-primary disabled:opacity-20">▲</button>
        <button type="button" onClick={() => onMove(1)} disabled={index === count - 1}
          className="text-[11px] leading-none text-text-dim hover:text-text-primary disabled:opacity-20">▼</button>
      </div>
      {skill?.iconLocal && (
        <img src={skill.iconLocal} alt="" className="w-6 h-6 rounded shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      )}
      <div className="flex-1 min-w-0">
        {skill ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{skill.name || '（未命名技能）'}</span>
            <span className="text-[12px] px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-dim shrink-0">{skill.type}</span>
            {skill.manual && <span className="text-[11px] px-1.5 py-0.5 rounded border border-accent-orange/40 bg-accent-orange/10 text-accent-orange shrink-0">手動</span>}
            {skill.ap && <span className="text-[12px] text-accent-green shrink-0">AP {skill.ap}</span>}
            {skill.cd && <span className="text-[12px] text-accent-orange shrink-0">CD {skill.cd}</span>}
            {skill.pp && <span className="text-[12px] text-accent-green shrink-0">消耗 {skill.pp}PP</span>}
            {skill.weapon && <span className="text-[12px] text-accent-purple shrink-0">{formatWeaponReq(skill.weapon)}</span>}
            <span className={`text-[12px] shrink-0 ${effCount > 0 ? 'text-accent-cyan' : 'text-text-dim'}`}>效果 {effCount}</span>
          </div>
        ) : (
          <span className="text-sm text-accent-red">⚠ 技能庫查無 <span className="font-mono text-[12px]">{id}</span></span>
        )}
      </div>
      <button type="button" onClick={onRemove}
        className="shrink-0 text-[13px] px-1.5 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10">✕ 移除</button>
    </div>
  )
}

// ─── 技能庫挑選器（加入引用）────────────────────────────────────────────────────
function SkillRefPicker({
  allSkills,
  assignedIds,
  onAdd,
}: {
  allSkills: PilotSkillDoc[]
  assignedIds: string[]
  onAdd: (id: string) => void
}) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const assigned = new Set(assignedIds)
    return allSkills
      .filter((s) => !assigned.has(s.id))
      .filter((s) => !q || (s.name || '').toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
      .slice(0, 50)
  }, [allSkills, search, assignedIds])

  return (
    <div className="border border-accent-orange/40 rounded-lg">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setSearch('') }}
        className="w-full text-left px-3 py-2 text-[13px] text-accent-orange hover:bg-accent-orange/10 transition-colors flex items-center justify-between"
      >
        <span>+ 從技能庫加入技能</span>
        <span className="text-text-dim text-xs">{open ? '收合' : '展開'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/40">
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋技能名稱 / ID…"
            className="input-field text-sm"
          />
          <div className="max-h-52 overflow-y-auto rounded border border-border/40 divide-y divide-border/30">
            {filtered.length === 0 ? (
              <p className="text-xs text-text-dim text-center py-3">查無可加入的技能（請先到「技能管理」分頁建立）</p>
            ) : filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onAdd(s.id)}
                className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-bg-card transition-colors flex items-center gap-2"
              >
                {s.iconLocal && <img src={s.iconLocal} alt="" className="w-5 h-5 rounded shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
                <span className="flex-1 truncate text-text-secondary">{s.name || '（未命名）'}</span>
                <span className="text-[11px] px-1 rounded bg-bg-card border border-border text-text-dim shrink-0">{s.type}</span>
                <span className="text-text-dim font-mono text-[11px] truncate max-w-[40%]">{s.id}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 機師技能分頁（純引用 / 指派模式）──────────────────────────────────────────
function PilotSkillRefsTab({
  assignedIds,
  onChange,
  skillMap,
  allSkills,
  legacyEmbedded,
  embeddedSkills,
}: {
  assignedIds: string[]
  onChange: (ids: string[]) => void
  skillMap: Map<string, PilotSkillDoc>
  allSkills: PilotSkillDoc[]
  legacyEmbedded: boolean
  embeddedSkills: PilotSkill[]
}) {
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir
    if (j < 0 || j >= assignedIds.length) return
    const next = [...assignedIds]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    onChange(next)
  }
  function remove(idx: number) { onChange(assignedIds.filter((_, i) => i !== idx)) }
  function add(id: string) { if (!assignedIds.includes(id)) onChange([...assignedIds, id]) }

  if (legacyEmbedded) {
    return (
      <div className="space-y-2.5">
        <p className="text-[13px] text-accent-yellow bg-accent-yellow/10 border border-accent-yellow/30 rounded-lg px-3 py-2">
          ⚠ 此機師技能仍是舊版內嵌格式，尚未遷移為引用。請先執行 <code>migrate-plan004</code> 腳本後再以此處管理；本面板儲存不會更動既有技能。
        </p>
        <div className="space-y-1.5">
          {embeddedSkills.map((s, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/60 bg-bg-dark/50">
              {s.iconLocal && <img src={s.iconLocal} alt="" className="w-6 h-6 rounded shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
              <span className="text-sm font-medium flex-1 truncate">{s.name || '（未命名技能）'}</span>
              <span className="text-[12px] px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-dim shrink-0">{s.type}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      <p className="text-[13px] text-text-dim">
        此分頁管理「這位機師擁有哪些技能」（引用技能庫 pilotSkills）。
        技能的名稱、效果、描述請至上方「技能管理」分頁編輯——一處修改、所有持有它的機師同步生效。
      </p>

      {assignedIds.length === 0 ? (
        <p className="text-text-dim text-sm text-center py-6">尚未指派技能，請從下方技能庫加入</p>
      ) : (
        <div className="space-y-1.5">
          {assignedIds.map((id, idx) => (
            <AssignedSkillRow
              key={id}
              id={id}
              skill={skillMap.get(id) ?? null}
              index={idx}
              count={assignedIds.length}
              onMove={(dir) => move(idx, dir)}
              onRemove={() => remove(idx)}
            />
          ))}
        </div>
      )}

      <SkillRefPicker allSkills={allSkills} assignedIds={assignedIds} onAdd={add} />
    </div>
  )
}

// ─── 算力改寫變體編輯（PLAN-021 3-1）───────────────────────────────────────────
function NdVariantsEditor({
  variants,
  zones,
  onChange,
}: {
  variants: TalentNdVariant[]
  zones: string[]
  onChange: (next: TalentNdVariant[] | undefined) => void
}) {
  function upd(idx: number, patch: Partial<TalentNdVariant>) {
    onChange(variants.map((v, i) => (i === idx ? { ...v, ...patch } : v)))
  }
  function add() {
    onChange([...variants, { minSum: 0, description: '' }])
  }
  function remove(idx: number) {
    const next = variants.filter((_, i) => i !== idx)
    onChange(next.length ? next : undefined)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-dim font-medium tracking-wider uppercase">神經驅動算力改寫 ndVariants（選填）</p>
        <button
          onClick={add}
          className="shrink-0 text-[12px] px-2 py-0.5 text-accent-pink border border-accent-pink/40 rounded hover:bg-accent-pink/10 transition-colors"
        >
          + 新增算力階
        </button>
      </div>
      {variants.length === 0 ? (
        <p className="text-[12px] text-text-dim">
          無改寫變體。僅「算力跨門檻會改寫天賦正文」的機師（如艾達）需要填；正文照抄遊戲 / WIKI 完整原文即可。
        </p>
      ) : (
        <>
          <p className="text-[12px] text-text-dim">建議依 minSum 升序排列；生效判定為「該分區算力 ≥ minSum 取最高階」。</p>
          {variants.map((v, idx) => (
            <div key={idx} className="p-2 bg-bg-dark/60 rounded border border-border/40 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <Field label="分區 zone">
                  <select
                    value={v.zone ?? ''}
                    onChange={(e) => upd(idx, { zone: e.target.value || undefined })}
                    className="input-field"
                  >
                    <option value="">未指定（退化判定）</option>
                    {/* 機師現有分區之外，保留已存在但不在清單中的值，避免切換時資料遺失 */}
                    {[...new Set([...zones, ...(v.zone && !zones.includes(v.zone) ? [v.zone] : [])])].map((z) => (
                      <option key={z} value={z}>{z}</option>
                    ))}
                  </select>
                </Field>
                <Field label="算力門檻 minSum">
                  <input
                    type="number"
                    value={v.minSum}
                    onChange={(e) => upd(idx, { minSum: Number(e.target.value) })}
                    className="input-field"
                  />
                </Field>
                <Field label="標籤 label（選填）">
                  <input
                    value={v.label ?? ''}
                    onChange={(e) => upd(idx, { label: e.target.value || undefined })}
                    className="input-field"
                    placeholder={`預設：${v.zone ?? '分區'} 算力 ≥ ${v.minSum}`}
                  />
                </Field>
              </div>
              <Field label="改寫正文 description">
                <textarea
                  value={v.description}
                  onChange={(e) => upd(idx, { description: e.target.value })}
                  className="input-field min-h-[130px] resize-y text-xs leading-relaxed"
                  placeholder="此算力階的完整天賦正文（[xxx] 用該階 buff 名，如 [凝勢III]）"
                />
              </Field>
              <Field label="滿星版改寫正文 descriptionMax（選填）">
                <textarea
                  value={v.descriptionMax ?? ''}
                  onChange={(e) => upd(idx, { descriptionMax: e.target.value || undefined })}
                  className="input-field min-h-[130px] resize-y text-xs leading-relaxed"
                  placeholder="滿星 × 此算力階的正文；未填時前台退回顯示初始版並提示待補"
                />
              </Field>
              {/* 變體 refs 與天賦 descriptionRefs 合併解析：已在天賦層指派過的 token（如 [星爆]）此處可留空 */}
              <RefPicker
                text={[v.description, v.descriptionMax].filter(Boolean).join('\n')}
                value={v.descriptionRefs}
                onChange={(refs) => upd(idx, { descriptionRefs: refs })}
                onCompileText={(tf) => upd(idx, {
                  description: tf(v.description),
                  descriptionMax: v.descriptionMax ? tf(v.descriptionMax) : v.descriptionMax,
                })}
              />
              <div className="flex justify-end">
                <button
                  onClick={() => remove(idx)}
                  className="text-[12px] px-2 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10"
                >
                  ✕ 移除此階
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ─── 天賦項目編輯 ──────────────────────────────────────────────────────────────
function TalentItem({
  talent,
  zones,
  expanded,
  onToggle,
  onChange,
  onRemove,
}: {
  talent: PilotTalent
  zones: string[]
  expanded: boolean
  onToggle: () => void
  onChange: (updated: PilotTalent) => void
  onRemove: () => void
}) {
  const effects  = talent.effects ?? []
  const enhanced = talent.enhancedEffects ?? []
  const buffIds  = talent.buffIds ?? []
  function upd<K extends keyof PilotTalent>(key: K, value: PilotTalent[K]) { onChange({ ...talent, [key]: value }) }
  function updBuffIds(val: string) { upd('buffIds', val.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)) }
  const refText = [talent.description, talent.descriptionMax].filter(Boolean).join('\n')

  return (
    <div className="border border-border/60 rounded-lg bg-bg-dark/50">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none" onClick={onToggle}>
        <span className="text-[13px] text-text-dim w-3 shrink-0">{expanded ? '▼' : '▶'}</span>
        {talent.iconLocal && (
          <img src={talent.iconLocal} alt="" className="w-6 h-6 rounded shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
        )}
        <span className="text-sm font-medium flex-1 truncate">{talent.name || '（未命名天賦）'}</span>
        {talent.manual && <span className="text-[11px] px-1.5 py-0.5 rounded border border-accent-orange/40 bg-accent-orange/10 text-accent-orange shrink-0">手動</span>}
        {(talent.ndVariants?.length ?? 0) > 0 && <span className="text-[12px] text-accent-pink shrink-0">算力階 {talent.ndVariants!.length}</span>}
        {talent.type && <span className="text-[12px] px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-dim shrink-0">{talent.type}</span>}
        <span className={`text-[12px] shrink-0 ${effects.length > 0 ? 'text-accent-cyan' : 'text-text-dim'}`}>效果 {effects.length}</span>
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t border-border/40 pt-2.5 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="天賦名稱 name">
              <input value={talent.name} onChange={(e) => upd('name', e.target.value)} className="input-field" placeholder="如：核心天賦" />
            </Field>
            <Field label="類型 type">
              <input value={talent.type} onChange={(e) => upd('type', e.target.value)} className="input-field" placeholder="如：核心 / 職業" />
            </Field>
          </div>
          <IconField label="圖示 iconLocal（本地圖檔）" value={talent.iconLocal} onChange={(v) => upd('iconLocal', v)} defaultFolder="skills" />
          <Field label="效果說明 description">
            <textarea
              value={talent.description}
              onChange={(e) => upd('description', e.target.value)}
              className="input-field min-h-[150px] resize-y text-xs leading-relaxed"
              placeholder="天賦效果文字描述（可含 [xxx] 引用其他實體）"
            />
          </Field>
          <Field label="滿級效果 descriptionMax（選填）">
            <textarea
              value={talent.descriptionMax}
              onChange={(e) => upd('descriptionMax', e.target.value)}
              className="input-field min-h-[150px] resize-y text-xs leading-relaxed"
              placeholder="滿級 / 強化後的效果說明"
            />
          </Field>
          <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!talent.manual}
              onChange={(e) => upd('manual', e.target.checked || undefined)}
              className="mt-0.5"
            />
            <span>
              手動正文保護 <code className="text-accent-orange">manual</code> —
              勾選後爬蟲補丁不覆寫 description / descriptionMax（官方 API 正文為滿晶片狀態，人工去污染後務必勾選）
            </span>
          </label>
          {/* description 與 descriptionMax 共用一份 descriptionRefs（兩者的 [xxx] 都在此指派）*/}
          <RefPicker
            text={refText}
            value={talent.descriptionRefs}
            onChange={(refs) => upd('descriptionRefs', refs)}
            onCompileText={(tf) => onChange({
              ...talent,
              description: tf(talent.description),
              descriptionMax: talent.descriptionMax ? tf(talent.descriptionMax) : talent.descriptionMax,
            })}
          />
          <NdVariantsEditor variants={talent.ndVariants ?? []} zones={zones} onChange={(n) => upd('ndVariants', n)} />
          <EffectListEditor label="可計算效果 effects" effects={effects} onChange={(n) => upd('effects', n)} />
          <EffectListEditor
            label="強化效果 enhancedEffects（選填）"
            effects={enhanced}
            onChange={(n) => upd('enhancedEffects', n.length ? n : undefined)}
          />
          <Field label="觸發 Buff ID buffIds（逗號分隔）">
            <textarea
              value={buffIds.join(', ')}
              onChange={(e) => updBuffIds(e.target.value)}
              className="input-field min-h-[44px] resize-none text-xs"
              placeholder="buff_001, buff_002"
            />
          </Field>
          <div className="pt-1 flex justify-end">
            <button
              onClick={onRemove}
              className="text-[13px] px-2 py-1 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10"
            >
              ✕ 刪除此天賦
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 機師天賦分頁 ──────────────────────────────────────────────────────────────
function PilotTalentsTab({
  talents,
  zones,
  onChange,
}: {
  talents: PilotTalent[]
  zones: string[]
  onChange: (updated: PilotTalent[]) => void
}) {
  // 預設展開第一筆天賦（遊戲天賦目前僅一筆，等同開啟即展開）
  const [expandedIdx, setExpandedIdx] = useState<number | null>(talents.length > 0 ? 0 : null)

  function updateTalent(idx: number, updated: PilotTalent) {
    const next = [...talents]; next[idx] = updated; onChange(next)
  }
  function addTalent() {
    onChange([...talents, {
      name: '', type: '', description: '', descriptionMax: '', descriptionRefs: {},
      icon: '', iconLocal: '', effects: [], buffIds: [],
    }])
    setExpandedIdx(talents.length)
  }
  function removeTalent(idx: number) {
    onChange(talents.filter((_, i) => i !== idx))
    setExpandedIdx(null)
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-text-dim">天賦資料可在此編輯；描述中的 <code>[xxx]</code> 可指派引用。儲存後寫入機師文件。</p>
        {/* 遊戲天賦目前僅一筆 —— 已存在天賦時隱藏新增鈕，避免誤建第二筆 */}
        {talents.length === 0 && (
          <button
            onClick={addTalent}
            className="shrink-0 text-[13px] px-2.5 py-1 text-accent-orange border border-accent-orange/40 rounded hover:bg-accent-orange/10 transition-colors"
          >
            + 新增天賦
          </button>
        )}
      </div>

      {talents.length === 0 ? (
        <p className="text-text-dim text-sm text-center py-8">無天賦資料，可點右上角「新增天賦」建立</p>
      ) : (
        <div className="space-y-1.5">
          {talents.map((t, idx) => (
            <TalentItem
              key={idx}
              talent={t}
              zones={zones}
              expanded={expandedIdx === idx}
              onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              onChange={(updated) => updateTalent(idx, updated)}
              onRemove={() => removeTalent(idx)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 神驅能力挑選器（各級連結能力庫 abilityId）─────────────────────────────────
// 內嵌展開式（非 absolute，避免在 modal 捲動區被裁切）；查無 abilityId 時標紅提示。
function NdAbilitySelect({
  value,
  abilities,
  abilityMap,
  onChange,
}: {
  value: string | undefined
  abilities: NeuralDriveAbility[]
  abilityMap: Map<string, NeuralDriveAbility>
  onChange: (id: string) => void
}) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const selected = value ? abilityMap.get(value) : undefined
  const missing  = !!value && !selected

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return abilities
      .filter((a) => !q || (a.name || '').toLowerCase().includes(q) || a.id.toLowerCase().includes(q))
      .slice(0, 50)
  }, [abilities, search])

  return (
    <div className="border border-border/50 rounded-lg">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setSearch('') }}
        className={`w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2 rounded-lg transition-colors hover:bg-bg-card ${missing ? 'text-accent-red' : ''}`}
      >
        {selected ? (
          <>
            {selected.iconLocal && <img src={selected.iconLocal} alt="" className="w-5 h-5 rounded shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
            <span className="flex-1 truncate text-text-secondary">{selected.name || '（未命名）'}</span>
            <span className="text-text-dim font-mono text-[11px] truncate max-w-[40%]">{selected.id}</span>
          </>
        ) : missing ? (
          <span className="flex-1 truncate">⚠ 能力庫查無 <span className="font-mono">{value}</span></span>
        ) : (
          <span className="flex-1 text-text-dim">— 點此連結能力庫 —</span>
        )}
        <span className="text-text-dim shrink-0">{open ? '收合' : '▾'}</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 pt-1 space-y-2 border-t border-border/40">
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋能力名稱 / ID…"
            className="input-field text-xs"
          />
          <div className="max-h-44 overflow-y-auto rounded border border-border/40 divide-y divide-border/30">
            {filtered.length === 0 ? (
              <p className="text-xs text-text-dim text-center py-3">查無能力，請先到「神經驅動」分頁建立能力</p>
            ) : filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => { onChange(a.id); setOpen(false) }}
                className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-bg-card transition-colors flex items-center gap-2"
              >
                {a.iconLocal && <img src={a.iconLocal} alt="" className="w-5 h-5 rounded shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
                <span className="flex-1 truncate text-text-secondary">{a.name || '（未命名）'}</span>
                <span className="text-text-dim font-mono text-[11px] truncate max-w-[40%]">{a.id}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 神驅分區卡（分區名 / 圖示 / 插槽 / 各級門檻）────────────────────────────────
// 前台固定四區（PilotDetailPage 的 ND_ORDER），分區名以選單約束，避免打錯導致前台漏顯示。
const ND_ZONE_OPTIONS = ['α', 'β', 'γ1', 'γ2']

// 插槽晶片固定三種。寫入的 value 沿用官方 WIKI 命名（攻擊/迴避/暴擊，暫不動資料），
// 但後台顯示改用「顏色」標籤——WIKI 命名與實際能力有落差、易混淆；顏色對齊前台 SlotChips。
const CHIP_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '攻擊', label: '🔴 紅色晶片' },
  { value: '迴避', label: '🟡 黃色晶片' },
  { value: '暴擊', label: '🔵 藍色晶片' },
]
const SLOT_POS = ['一', '二', '三']
const slotLabel = (i: number) => SLOT_POS[i] ?? String(i + 1)
const composeSlot = (i: number, type: string) => `插槽${slotLabel(i)}：${type}芯片`
/** 從插槽字串解析出晶片類型 value（相容英文舊值 Attack/Dodge/Critical），對不上時預設「攻擊」。 */
function chipTypeOf(slot: string): string {
  const raw = /：\s*(.+?)\s*芯片/.exec(slot)?.[1] ?? slot
  if (/attack|攻擊/i.test(raw))      return '攻擊'
  if (/dodge|迴避|回避/i.test(raw))  return '迴避'
  if (/crit|暴擊/i.test(raw))        return '暴擊'
  return CHIP_TYPE_OPTIONS.some((o) => o.value === raw) ? raw : '攻擊'
}

function makeNdLevel(level: number): NeuralDriveLevel {
  // PLAN-023 新格式：只留 abilityId 引用；嵌入欄位給空值（type 要求 required）
  return { level, minSum: 0, abilityId: '', effect: '', skillName: '', skillIcon: '', iconLocal: '', effects: [], buffIds: [] }
}

function NdZoneCard({
  zone,
  index,
  count,
  abilities,
  abilityMap,
  onChange,
  onMove,
  onRemove,
}: {
  zone: NeuralDrive
  index: number
  count: number
  abilities: NeuralDriveAbility[]
  abilityMap: Map<string, NeuralDriveAbility>
  onChange: (updated: NeuralDrive) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const slots  = zone.slots ?? []
  const levels = zone.levels ?? []
  function upd<K extends keyof NeuralDrive>(key: K, value: NeuralDrive[K]) { onChange({ ...zone, [key]: value }) }

  // 插槽：以晶片類型陣列為真實來源，每次結構變動都依 index 重編位置字串（插槽一/二/三）
  const slotTypes = slots.map(chipTypeOf)
  function setTypes(types: string[]) { upd('slots', types.map((t, i) => composeSlot(i, t))) }
  function updSlotType(i: number, t: string) { setTypes(slotTypes.map((x, xi) => (xi === i ? t : x))) }
  function addSlot()      { setTypes([...slotTypes, '攻擊']) }
  function removeSlot(i: number) { setTypes(slotTypes.filter((_, xi) => xi !== i)) }

  // 各級
  function updLevel(i: number, patch: Partial<NeuralDriveLevel>) {
    upd('levels', levels.map((lv, li) => (li === i ? { ...lv, ...patch } : lv)))
  }
  function addLevel()      { upd('levels', [...levels, makeNdLevel(levels.length + 1)]) }
  function removeLevel(i: number) { upd('levels', levels.filter((_, li) => li !== i)) }

  return (
    <div className="border border-accent-purple/25 rounded-lg bg-bg-dark/50">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40">
        <div className="flex flex-col shrink-0">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0}
            className="text-[11px] leading-none text-text-dim hover:text-text-primary disabled:opacity-20">▲</button>
          <button type="button" onClick={() => onMove(1)} disabled={index === count - 1}
            className="text-[11px] leading-none text-text-dim hover:text-text-primary disabled:opacity-20">▼</button>
        </div>
        <span className="text-accent-purple shrink-0">◆</span>
        <select
          value={zone.name}
          onChange={(e) => upd('name', e.target.value)}
          className="input-field flex-1"
        >
          <option value="">— 選擇分區 —</option>
          {/* 保留已存在但不在標準清單中的值，避免切換時資料遺失 */}
          {[...new Set([...ND_ZONE_OPTIONS, ...(zone.name && !ND_ZONE_OPTIONS.includes(zone.name) ? [zone.name] : [])])].map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
        <button type="button" onClick={onRemove}
          className="shrink-0 text-[13px] px-1.5 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10">✕ 刪除分區</button>
      </div>

      <div className="px-3 py-2.5 space-y-3">
        <Field label="分區圖示 icon（選填，遠端路徑）">
          <input value={zone.icon ?? ''} onChange={(e) => upd('icon', e.target.value)} className="input-field" placeholder="留空即可" />
        </Field>

        {/* 插槽 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[13px] text-text-dim font-medium uppercase tracking-wider">插槽 slots</span>
            <button type="button" onClick={addSlot} className="text-[13px] text-accent-cyan hover:text-accent-cyan/80 transition-colors">+ 新增插槽</button>
          </div>
          {slots.length === 0 ? (
            <p className="text-xs text-text-dim py-1">尚未填入插槽</p>
          ) : (
            <div className="space-y-1.5">
              {slots.map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-text-dim shrink-0 w-12">插槽{slotLabel(i)}</span>
                  <select
                    value={slotTypes[i]}
                    onChange={(e) => updSlotType(i, e.target.value)}
                    className="input-field flex-1 text-xs"
                  >
                    {CHIP_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <button type="button" onClick={() => removeSlot(i)}
                    className="shrink-0 text-[13px] px-1.5 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 各級門檻 + 能力引用 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[13px] text-text-dim font-medium uppercase tracking-wider">各級 levels（算力門檻 + 能力）</span>
            <button type="button" onClick={addLevel} className="text-[13px] text-accent-cyan hover:text-accent-cyan/80 transition-colors">+ 新增等級</button>
          </div>
          {levels.length === 0 ? (
            <p className="text-xs text-text-dim py-1">尚未填入等級</p>
          ) : (
            <div className="space-y-2">
              {levels.map((lv, i) => (
                <div key={i} className="p-2 bg-bg-card/40 rounded border border-border/40 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="grid grid-cols-2 gap-2 flex-1">
                      <Field label="Lv level">
                        <input type="number" value={lv.level} onChange={(e) => updLevel(i, { level: Number(e.target.value) })} className="input-field" />
                      </Field>
                      <Field label="算力門檻 minSum">
                        <input type="number" value={lv.minSum} onChange={(e) => updLevel(i, { minSum: Number(e.target.value) })} className="input-field" />
                      </Field>
                    </div>
                    <button type="button" onClick={() => removeLevel(i)}
                      className="shrink-0 self-start mt-5 text-[13px] px-1.5 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10">✕</button>
                  </div>
                  <NdAbilitySelect
                    value={lv.abilityId}
                    abilities={abilities}
                    abilityMap={abilityMap}
                    onChange={(id) => updLevel(i, { abilityId: id })}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── 機師神經驅動分頁 ──────────────────────────────────────────────────────────
function PilotNeuralDriveTab({
  neuralDrive,
  abilities,
  onChange,
}: {
  neuralDrive: NeuralDrive[]
  abilities: NeuralDriveAbility[]
  onChange: (nd: NeuralDrive[]) => void
}) {
  const abilityMap = useMemo(() => buildNdAbilityMap(abilities), [abilities])

  function updateZone(idx: number, updated: NeuralDrive) { onChange(neuralDrive.map((z, i) => (i === idx ? updated : z))) }
  function addZone() { onChange([...neuralDrive, { name: '', icon: '', slots: [], levels: [] }]) }
  function removeZone(idx: number) { onChange(neuralDrive.filter((_, i) => i !== idx)) }
  function moveZone(idx: number, dir: -1 | 1) {
    const j = idx + dir
    if (j < 0 || j >= neuralDrive.length) return
    const next = [...neuralDrive]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    onChange(next)
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-text-dim">
          編輯各神經驅動分區、插槽與各級算力門檻；每級以下拉<strong>連結能力庫</strong>（能力的效果 / 描述請至上方「神經驅動」分頁維護——一處修改、所有機師同步）。
        </p>
        <button
          onClick={addZone}
          className="shrink-0 text-[13px] px-2.5 py-1 text-accent-purple border border-accent-purple/40 rounded hover:bg-accent-purple/10 transition-colors"
        >
          + 新增分區
        </button>
      </div>

      {neuralDrive.length === 0 ? (
        <p className="text-text-dim text-sm text-center py-8">無神經驅動分區，可點右上角「新增分區」建立</p>
      ) : (
        <div className="space-y-2">
          {neuralDrive.map((z, idx) => (
            <NdZoneCard
              key={idx}
              zone={z}
              index={idx}
              count={neuralDrive.length}
              abilities={abilities}
              abilityMap={abilityMap}
              onChange={(updated) => updateZone(idx, updated)}
              onMove={(dir) => moveZone(idx, dir)}
              onRemove={() => removeZone(idx)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 個人資料自訂欄位編輯器（additionalInfo 任意鍵值）──────────────────────────
// 機師個人資料偏「說故事」、欄位不固定：以自訂鍵值列呈現，前台依 key 當標籤直接渲染。
// 自帶本地 pairs 狀態使打字穩定；父層以 key={pilot.id} 強制換機師時重置。
function AdditionalInfoEditor({
  value,
  onChange,
}: {
  value: Record<string, string>
  onChange: (v: Record<string, string>) => void
}) {
  const [pairs, setPairs] = useState<{ k: string; v: string }[]>(
    () => Object.entries(value ?? {}).map(([k, v]) => ({ k, v })),
  )

  function sync(next: { k: string; v: string }[]) {
    setPairs(next)
    const obj: Record<string, string> = {}
    for (const { k, v } of next) { const key = k.trim(); if (key) obj[key] = v }
    onChange(obj)
  }
  const updK = (i: number, k: string) => sync(pairs.map((p, pi) => (pi === i ? { ...p, k } : p)))
  const updV = (i: number, v: string) => sync(pairs.map((p, pi) => (pi === i ? { ...p, v } : p)))
  const add    = () => sync([...pairs, { k: '', v: '' }])
  const remove = (i: number) => sync(pairs.filter((_, pi) => pi !== i))

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[13px] text-text-dim font-medium uppercase tracking-wider">自訂欄位 additionalInfo</span>
        <button type="button" onClick={add} className="text-[13px] text-accent-cyan hover:text-accent-cyan/80 transition-colors">+ 新增欄位</button>
      </div>
      {pairs.length === 0 ? (
        <p className="text-xs text-text-dim py-1">尚無自訂欄位。欄位名（左）會直接當作前台顯示的標籤，值（右）為內容。</p>
      ) : (
        <div className="space-y-1.5">
          {pairs.map((p, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-2">
              <input
                value={p.k}
                onChange={(e) => updK(i, e.target.value)}
                className="input-field text-xs"
                placeholder="欄位名，如：出身"
              />
              <input
                value={p.v}
                onChange={(e) => updV(i, e.target.value)}
                className="input-field text-xs"
                placeholder="內容"
              />
              <button type="button" onClick={() => remove(i)}
                className="shrink-0 text-[13px] px-1.5 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 機師編輯面板 ──────────────────────────────────────────────────────────────
type PilotEditTab = 'basic' | 'stats' | 'ap' | 'profile' | 'talents' | 'skills' | 'neuralDrive'

const PILOT_EDIT_TABS: { id: PilotEditTab; label: string }[] = [
  { id: 'basic',       label: '基本資訊' },
  { id: 'stats',       label: '屬性數值' },
  { id: 'ap',          label: 'AP 系統' },
  { id: 'profile',     label: '個人資料' },
  { id: 'talents',     label: '天賦' },
  { id: 'skills',      label: '技能' },
  { id: 'neuralDrive', label: '神經驅動' },
]

function PilotEditPanel({
  pilot,
  onSave,
  onCancel,
}: {
  pilot: Pilot
  onSave: (p: Pilot) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm]       = useState<Pilot>({ ...pilot })
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [editTab, setEditTab] = useState<PilotEditTab>('basic')

  useEffect(() => { setForm({ ...pilot }); setEditTab('basic') }, [pilot])

  // PLAN-004：技能改由 pilotSkills 集合管理；機師文件僅存技能 ID 順序（引用）
  const gd = useGameData()
  useEffect(() => { gd.ensureLoaded(['pilotSkills', 'neuralDriveAbilities']) }, [gd])
  const skillMap = useMemo(() => buildSkillMap(gd.pilotSkills), [gd.pilotSkills])
  // 舊版相容：若機師 skills 仍含內嵌物件（非 ID 字串）視為未遷移
  const legacyEmbedded = useMemo(() => (pilot.skills ?? []).some((s) => typeof s !== 'string'), [pilot])
  const embeddedSkills = useMemo(
    () => (pilot.skills ?? []).filter((s): s is PilotSkill => typeof s !== 'string'),
    [pilot],
  )
  const [assignedIds, setAssignedIds] = useState<string[]>([])
  useEffect(() => {
    setAssignedIds((pilot.skills ?? []).filter((s): s is string => typeof s === 'string'))
  }, [pilot])

  function update<K extends keyof Pilot>(key: K, value: Pilot[K]) { setForm((f) => ({ ...f, [key]: value })) }
  function updateStats(key: keyof Pilot['stats'], value: number) { setForm((f) => ({ ...f, stats: { ...f.stats, [key]: value } })) }
  function updateAp(key: 'init' | 'max' | 'recovery', value: number) { setForm((f) => ({ ...f, ap: { ...f.ap, [key]: value } })) }
  function updateProfile(key: 'gender' | 'bloodType' | 'height', value: string) { setForm((f) => ({ ...f, profile: { ...f.profile, [key]: value } })) }

  async function handleSubmit() {
    setSaving(true); setError(null)
    try {
      // 新格式：機師文件只存技能 ID 順序；舊版內嵌格式則原樣保留（待腳本遷移）
      const skills: Pilot['skills'] = legacyEmbedded ? (form.skills ?? []) : assignedIds
      await onSave({ ...form, skills })
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗，請重試'); setSaving(false)
    }
  }

  const skillCount = legacyEmbedded ? embeddedSkills.length : assignedIds.length

  return (
    <AdminModal saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
      <div className="flex items-start gap-3 mb-3 shrink-0">
        {form.portrait && (
          <img
            src={form.portrait}
            alt=""
            className="w-12 h-12 rounded-lg object-cover shrink-0"
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <span className="text-accent-orange">✎</span> 編輯機師
            <span className="text-text-dim text-sm font-normal ml-1">{form.id}</span>
          </h3>
          <p className="text-[14px] text-text-dim mt-0.5">
            技能 {skillCount}（效果於「技能管理」分頁編輯）· 天賦 {form.talents?.length ?? 0}（可編輯）· 神經驅動 {form.neuralDrive?.length ?? 0} 分區（可編輯）
          </p>
        </div>
      </div>

      {/* Tab 列 */}
      <div className="flex gap-1 mb-4 shrink-0 flex-wrap">
        {PILOT_EDIT_TABS.map((t) => {
          const badge =
            t.id === 'skills'      ? skillCount :
            t.id === 'talents'     ? (form.talents?.length ?? 0) :
            t.id === 'neuralDrive' ? (form.neuralDrive?.length ?? 0) : 0
          const hasBadge = badge > 0
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
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="overflow-y-auto flex-1 pr-1">
        {editTab === 'basic' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="顯示名稱 name"><input value={form.name} onChange={(e) => update('name', e.target.value)} className="input-field" /></Field>
              <Field label="全名 fullName"><input value={form.fullName || ''} onChange={(e) => update('fullName', e.target.value)} className="input-field" /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="稀有度 rarity">
                <select value={form.rarity} onChange={(e) => update('rarity', e.target.value)} className="input-field">
                  {Object.values(ItemRarity).map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="職業 class">
                <select value={form.class} onChange={(e) => update('class', e.target.value)} className="input-field">
                  {Object.values(PilotClass).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="駕駛許可 license">
                <select value={form.license} onChange={(e) => update('license', e.target.value)} className="input-field">
                  {Object.values(MechLicense).map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="陣營 faction"><input value={form.faction || ''} onChange={(e) => update('faction', e.target.value)} className="input-field" /></Field>
              <Field label="駕駛等級 masterLevel"><input value={form.masterLevel || ''} onChange={(e) => update('masterLevel', e.target.value)} className="input-field" /></Field>
            </div>
            <IconField label="立繪路徑 portrait" value={form.portrait} onChange={(v) => update('portrait', v)} defaultFolder="pilots" />
            <Field label="故事 lore（Markdown）">
              <textarea value={form.lore || ''} onChange={(e) => update('lore', e.target.value)} className="input-field min-h-[150px] resize-y" />
            </Field>
          </div>
        )}

        {editTab === 'stats' && (
          <div>
            <p className="text-xs text-text-dim font-medium tracking-wider uppercase mb-3">六維屬性 stats</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <Field label="格鬥 melee"><input type="number" value={form.stats.melee} onChange={(e) => updateStats('melee', Number(e.target.value))} className="input-field" /></Field>
              <Field label="突擊 assault"><input type="number" value={form.stats.assault} onChange={(e) => updateStats('assault', Number(e.target.value))} className="input-field" /></Field>
              <Field label="射擊 shooting"><input type="number" value={form.stats.shooting} onChange={(e) => updateStats('shooting', Number(e.target.value))} className="input-field" /></Field>
              <Field label="戰術 tactics"><input type="number" value={form.stats.tactics} onChange={(e) => updateStats('tactics', Number(e.target.value))} className="input-field" /></Field>
              <Field label="防禦 defense"><input type="number" value={form.stats.defense} onChange={(e) => updateStats('defense', Number(e.target.value))} className="input-field" /></Field>
              <Field label="工程 engineering"><input type="number" value={form.stats.engineering} onChange={(e) => updateStats('engineering', Number(e.target.value))} className="input-field" /></Field>
            </div>
            <div className="pt-3 border-t border-border/60">
              <p className="text-xs text-text-dim font-medium tracking-wider uppercase mb-3">素質</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="攻擊素質 attack"><input type="number" value={form.attack ?? 0} onChange={(e) => update('attack', Number(e.target.value))} className="input-field" /></Field>
                <Field label="防禦素質 defense (pilot)"><input type="number" value={form.defense ?? 0} onChange={(e) => update('defense', Number(e.target.value))} className="input-field" /></Field>
              </div>
            </div>
          </div>
        )}

        {editTab === 'ap' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label="初始 AP init"><input type="number" value={form.ap.init} onChange={(e) => updateAp('init', Number(e.target.value))} className="input-field" /></Field>
              <Field label="AP 上限 max"><input type="number" value={form.ap.max} onChange={(e) => updateAp('max', Number(e.target.value))} className="input-field" /></Field>
              <Field label="AP 回復 recovery"><input type="number" value={form.ap.recovery} onChange={(e) => updateAp('recovery', Number(e.target.value))} className="input-field" /></Field>
            </div>
            {form.apBase && (
              <div className="p-3 bg-bg-dark rounded-lg border border-border/60">
                <p className="text-[13px] text-text-dim font-medium tracking-wider uppercase mb-2">基礎值 apBase（參考，由爬蟲腳本管理）</p>
                <div className="grid grid-cols-3 gap-2 text-xs text-text-dim">
                  <div>初始：{form.apBase.init}</div>
                  <div>上限：{form.apBase.max}</div>
                  <div>回復：{form.apBase.recovery}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {editTab === 'profile' && (
          <div className="space-y-3">
            <p className="text-[13px] text-text-dim">
              個人資料偏「說故事」、欄位不固定。常用三欄（性別 / 血型 / 身高）留空即不顯示；
              其餘一律用下方<strong>自訂欄位</strong>自由增減，欄位名即為前台顯示標籤。
            </p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="性別 gender"><input value={form.profile?.gender || ''} onChange={(e) => updateProfile('gender', e.target.value)} className="input-field" /></Field>
              <Field label="血型 bloodType"><input value={form.profile?.bloodType || ''} onChange={(e) => updateProfile('bloodType', e.target.value)} className="input-field" /></Field>
              <Field label="身高 height"><input value={form.profile?.height || ''} onChange={(e) => updateProfile('height', e.target.value)} className="input-field" /></Field>
            </div>
            <div className="pt-2 border-t border-border/60">
              <AdditionalInfoEditor
                key={form.id}
                value={form.profile?.additionalInfo ?? {}}
                onChange={(info) => setForm((f) => ({ ...f, profile: { ...f.profile, additionalInfo: info } }))}
              />
            </div>
          </div>
        )}

        {editTab === 'talents' && (
          <PilotTalentsTab
            talents={form.talents ?? []}
            zones={(form.neuralDrive ?? []).map((nd) => nd.name)}
            onChange={(t) => update('talents', t)}
          />
        )}

        {editTab === 'skills' && (
          <PilotSkillRefsTab
            assignedIds={assignedIds}
            onChange={setAssignedIds}
            skillMap={skillMap}
            allSkills={gd.pilotSkills}
            legacyEmbedded={legacyEmbedded}
            embeddedSkills={embeddedSkills}
          />
        )}

        {editTab === 'neuralDrive' && (
          <PilotNeuralDriveTab
            neuralDrive={form.neuralDrive ?? []}
            abilities={gd.neuralDriveAbilities}
            onChange={(nd) => update('neuralDrive', nd)}
          />
        )}
      </div>
    </AdminModal>
  )
}

// ─── 機師管理列表 ──────────────────────────────────────────────────────────────
export default function PilotAdmin({ initialSearch = '' }: { initialSearch?: string }) {
  const [editing, setEditing] = useState<Pilot | null>(null)
  const gd = useGameData()

  const {
    items: filtered, loading, error, hasMore, search, setSearch,
    filters, setFilter, submitSearch, loadMore, upsert,
  } = useClientPaged<Pilot, PilotFilters>({
    source: gd.pilots,
    initialSearch,
    initialFilters: { rarity: 'all', class: 'all' },
    matchFilters: (p, f) =>
      (f.rarity === 'all' || p.rarity === f.rarity) &&
      (f.class === 'all' || p.class === f.class),
  })

  const { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate, derivedId } =
    useNewItemCreation(
      gd.pilots,                                              // 全集合 in-memory 撞名
      (p) => p.id,
      (id, name) => makeDefaultPilot(id, stripIdPrefix('pilot', name)),
      (name) => makeEntityId('pilot', name),                 // deriveId：pilot_<slug(name)>
    )

  async function confirmCreateChecked() {
    const id = makeEntityId('pilot', newId)
    if (!id) { setNewIdError('名稱無法產生有效 ID，請改用其他名稱'); return }
    // 伺服器端撞 ID 檢查：涵蓋不在記憶體中的機師（撞名 = 撞 ID，導引去編輯既有項）
    if (await docExists('pilots', id)) {
      setNewIdError(`已有同名機師（ID：${id}），請改名或編輯既有項目`)
      return
    }
    const item = confirmCreate()
    if (item) setEditing(item)
  }

  async function handleSave(updated: Pilot) {
    const version = await updatePilot(updated)
    upsert(updated)
    gd.patchCollectionItem('pilots', updated, version)
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
        <select value={filters.rarity} onChange={(e) => setFilter('rarity', e.target.value)} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部稀有度</option>
          {Object.values(ItemRarity).map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filters.class} onChange={(e) => setFilter('class', e.target.value)} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部職業</option>
          {Object.values(PilotClass).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* 計數 + 新增 */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-text-dim text-xs">
          {error ? <span className="text-accent-red">載入失敗：{error}</span>
            : loading ? '載入中...'
            : `顯示 ${filtered.length} 位機師${hasMore ? '（可載入更多）' : ''}`}
        </p>
        <button
          onClick={openCreate}
          className="text-xs px-3 py-1.5 bg-accent-orange text-black font-bold rounded-lg hover:opacity-90 transition-opacity"
        >
          + 新增機師
        </button>
      </div>

      <NewItemDialog
        creating={creating}
        newId={newId}
        newIdError={newIdError}
        placeholder="輸入機師名稱，如：淬鋒凱登"
        hint={<>輸入機師名稱，系統自動生成文件 ID（前綴固定 <span className="text-accent-cyan">pilot_</span>）</>}
        onChangeId={(v) => { setNewId(v); setNewIdError('') }}
        onConfirm={() => { void confirmCreateChecked() }}
        onCancel={cancelCreate}
        deriveMode
        derivedId={derivedId}
      />

      <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
        {filtered.map((pilot) => (
          <div
            key={pilot.id}
            className="bg-bg-dark border border-border rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-border-accent transition-colors cursor-pointer"
            onClick={() => setEditing(pilot)}
          >
            {pilot.portrait && (
              <img
                src={pilot.portrait}
                alt=""
                className="w-10 h-10 rounded-lg object-cover shrink-0"
                onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm text-text-primary">{pilot.name}</span>
                {pilot.fullName && pilot.fullName !== pilot.name && (
                  <span className="text-xs text-text-dim truncate">{pilot.fullName}</span>
                )}
                <span className={`text-[13px] px-1.5 py-0.5 rounded border font-bold shrink-0 ${PILOT_RARITY_CLASS[pilot.rarity] ?? 'text-text-dim border-border bg-bg-card'}`}>
                  {pilot.rarity}
                </span>
                <span className="text-[13px] px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-dim shrink-0">{pilot.class}</span>
                <span className="text-[13px] px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-dim shrink-0">{pilot.license}</span>
              </div>
              <div className="text-[14px] text-text-dim mt-0.5">
                格{pilot.stats.melee} · 突{pilot.stats.assault} · 射{pilot.stats.shooting} · 術{pilot.stats.tactics} · 防{pilot.stats.defense} · 工{pilot.stats.engineering}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && !loading && (
          <p className="text-text-dim text-sm text-center py-8">找不到符合條件的機師</p>
        )}
      </div>

      <LoadMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />

      {editing && (
        <PilotEditPanel
          pilot={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}
