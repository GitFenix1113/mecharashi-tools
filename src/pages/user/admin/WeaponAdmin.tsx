import { useState, useEffect, useMemo } from 'react'
import type { Weapon, Pilot, WeaponSkill, WeaponSkillRef, PilotSkillDoc } from '../../../types'
import { isWeaponSkillRef } from '../../../utils/weaponSkills'
import {
  WeaponType, WeaponKind, WeaponRarity, MechRestriction, WeaponEquipSlot,
  RangeType, SkillType, SkillActivation,
} from '../../../types/enums'
import {
  Field, AdminModal, useNewItemCreation, NewItemDialog, useClientPaged, LoadMoreButton,
  GRID_AUTO_FIELDS, GRID_TWO_PANE, AdminEditTabs, type AdminEditTabDef,
  DraftRestoreBar,
} from './shared'
import { useDraftWrite, useDraftRestore } from '../../../hooks/useDraftAutosave'
import { updateWeapon, docExists } from '../../../lib/firestoreApi'
import { makeNumberedEntityId, maxEntitySeq, stripNumberedIdPrefix } from '../../../utils/idSlug'
import { useGameData } from '../../../contexts/GameDataContext'
import { RefPicker } from '../../../components/admin/RefPicker'
import { WEAPON_RARITY_CLASS, WEAPON_KIND_BY_TYPE, ALL_WEAPON_KINDS } from './constants'
import { SkillEffectItem } from './PilotAdmin'

type WeaponFilters = { rarity: string; type: string; exclusive: 'all' | 'yes' | 'no' }

// ─── 預設值工廠 ────────────────────────────────────────────────────────────────
function makeDefaultWeapon(id: string, name = ''): Weapon {
  return {
    id,
    name,
    type: WeaponType.Sniper,
    kind: WeaponKind.HeavySniper,
    kindCoefficient: 0,
    attack: 0,
    accuracy: 0,
    critValue: 0,
    rangeType: RangeType.MANHATTAN,
    minRange: 1,
    maxRange: 1,
    weight: 0,
    ammoCount: 0,
    hitCount: 1,
    rarity: WeaponRarity.S,
    mechRestriction: MechRestriction.NONE,
    equipSlot: WeaponEquipSlot.SINGLE_HAND,
    isExclusive: false,
    triggerSlots: 0,
    effectSlots: 0,
    componentLimit: 0,
    fixedMod: { planName: '', maxLevel: 70, effects: [] },
    floatingMod: { planName: '', slots: 0, possibleEffects: [] },
    skills: [],
  }
}

// ─── 已掛載的技能庫引用（PLAN-032 M4）─────────────────────────────────────────
//
// 與 BackpackSkillPicker（PLAN-043）同形制，但多一個 activation 選擇器：
// 它是**掛載側**的欄位，同一個技能在不同武器上可以不同（實測 38 個技能有此變異），
// 所以不能像背包那樣只掛一個 id 字串。
function WeaponSkillRefRow({
  entry,
  doc,
  onChange,
  onRemove,
}: {
  entry: WeaponSkillRef
  doc: PilotSkillDoc | undefined
  onChange: (updated: WeaponSkillRef) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2 bg-bg-dark border border-accent-cyan/30 rounded-lg px-2.5 py-2">
      <span className="text-[11px] px-1.5 py-0.5 rounded border border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan shrink-0">引用</span>
      {doc?.iconLocal && (
        <img src={doc.iconLocal} alt="" className="w-7 h-7 rounded shrink-0" onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
      )}
      <div className="flex-1 min-w-0 truncate">
        {/* 解析不到 = 斷鏈（技能被刪或 id 打錯）。必須顯眼，否則前台只會靜默少一塊技能 */}
        {doc
          ? <span className="text-sm text-text-primary font-medium">{doc.name}</span>
          : <span className="text-sm text-accent-red">⚠ 找不到此技能</span>}
        <span className="text-[11px] text-text-dim font-mono ml-2">{entry.skillId}</span>
      </div>
      {/* 固定寬容器：`.input-field` 是 index.css 的無 layer 規則（width:100%），
          會壓過 Tailwind 的 w-auto（見 BackpackSkillPicker 的同款註解）。 */}
      <div className="w-44 shrink-0">
        <select
          value={entry.activation}
          onChange={e => onChange({ ...entry, activation: e.target.value as WeaponSkillRef['activation'] })}
          className="input-field py-1 text-xs"
        >
          <option value={SkillActivation.CARRY}>carry — 攜帶即生效</option>
          <option value={SkillActivation.EQUIP}>equip — 裝備中生效</option>
          <option value={SkillActivation.USE}>use — 僅使用時生效</option>
        </select>
      </div>
      <button
        onClick={onRemove}
        className="text-[13px] px-1.5 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10 shrink-0"
      >✕</button>
    </div>
  )
}

/** 從技能庫挑一筆掛上來。預設只列 domain:'weapon'，可切「全部」（跨域共用技能用）。 */
function WeaponSkillRefAdder({
  skills,
  attachedIds,
  onAdd,
}: {
  skills: PilotSkillDoc[]
  attachedIds: Set<string>
  onAdd: (skillId: string) => void
}) {
  const [search, setSearch] = useState('')
  const [scope, setScope]   = useState<'weapon' | 'all'>('weapon')

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return skills
      .filter(s => !attachedIds.has(s.id))
      .filter(s => scope === 'all' || s.domain === 'weapon')
      .filter(s => !q || s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
      .slice(0, 60)   // 技能庫 850+ 筆，不設上限會讓 select 卡住
  }, [skills, attachedIds, search, scope])

  return (
    <div className="grid grid-cols-[auto_1fr_2fr] gap-2">
      <select
        value={scope}
        onChange={e => setScope(e.target.value as 'weapon' | 'all')}
        className="input-field py-1 text-xs w-28"
      >
        <option value="weapon">武器技能</option>
        <option value="all">全部技能</option>
      </select>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="搜尋技能名稱..."
        className="input-field py-1 text-xs"
      />
      <select
        value=""
        onChange={e => { onAdd(e.target.value); setSearch('') }}
        className="input-field py-1 text-xs"
      >
        <option value="">＋ 掛載技能庫技能（{candidates.length} 個候選）</option>
        {candidates.map(s => (
          <option key={s.id} value={s.id}>{s.name} — {s.id}</option>
        ))}
      </select>
    </div>
  )
}

// ─── 武器技能項目 ──────────────────────────────────────────────────────────────
function WeaponSkillItem({
  skill,
  index,
  expanded,
  onToggle,
  onChange,
  onRemove,
}: {
  skill: WeaponSkill
  index: number
  expanded: boolean
  onToggle: () => void
  onChange: (updated: WeaponSkill) => void
  onRemove: () => void
}) {
  const effects = skill.effects ?? []
  const buffIds = skill.buffIds ?? []

  const activationColor =
    skill.activation === SkillActivation.CARRY ? 'text-accent-green border-accent-green/30 bg-accent-green/10' :
    skill.activation === SkillActivation.EQUIP  ? 'text-accent-cyan border-accent-cyan/30 bg-accent-cyan/10' :
                                                   'text-accent-orange border-accent-orange/30 bg-accent-orange/10'

  return (
    <div className="border border-border/60 rounded-lg bg-bg-dark/50">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none" onClick={onToggle}>
        <span className="text-[13px] text-text-dim w-3 shrink-0">{expanded ? '▼' : '▶'}</span>
        <span className="text-sm font-medium flex-1 truncate">
          {skill.name || <span className="text-text-dim font-normal">（未命名）#{index + 1}</span>}
        </span>
        <span className={`text-[13px] px-1.5 py-0.5 rounded border shrink-0 ${activationColor}`}>{skill.activation}</span>
        <span className={`text-[13px] shrink-0 ${effects.length > 0 ? 'text-accent-cyan' : 'text-text-dim'}`}>效果 {effects.length}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="text-[13px] px-1.5 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10 shrink-0"
        >✕</button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t border-border/40 pt-2.5 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="技能名稱 name">
              <input value={skill.name} onChange={(e) => onChange({ ...skill, name: e.target.value })} className="input-field" />
            </Field>
            <Field label="技能類型 type">
              <select value={skill.type} onChange={(e) => onChange({ ...skill, type: e.target.value })} className="input-field">
                <option value={SkillType.PASSIVE}>{SkillType.PASSIVE}</option>
                <option value={SkillType.ACTIVE}>{SkillType.ACTIVE}</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="圖示路徑 iconLocal（本地）">
              <input value={skill.iconLocal ?? ''} onChange={(e) => onChange({ ...skill, iconLocal: e.target.value || undefined })} className="input-field" placeholder="/images/weapons/skills/..." />
            </Field>
            <Field label="圖示 URL icon（遠端，選填）">
              <input value={skill.icon ?? ''} onChange={(e) => onChange({ ...skill, icon: e.target.value || undefined })} className="input-field" placeholder="https://..." />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="生效方式 activation">
              <select
                value={skill.activation}
                onChange={(e) => onChange({ ...skill, activation: e.target.value as WeaponSkill['activation'] })}
                className="input-field"
              >
                <option value={SkillActivation.CARRY}>carry — 攜帶即生效</option>
                <option value={SkillActivation.EQUIP}>equip — 裝備中生效</option>
                <option value={SkillActivation.USE}>use — 僅使用時生效</option>
              </select>
            </Field>
            <Field label="加強天賦 enhancesTalentName（選填）">
              <input
                value={skill.enhancesTalentName ?? ''}
                onChange={(e) => onChange({ ...skill, enhancesTalentName: e.target.value || undefined })}
                className="input-field"
                placeholder="專武加強天賦名稱"
              />
            </Field>
          </div>
          <Field label="技能描述 description">
            <textarea value={skill.description} onChange={(e) => onChange({ ...skill, description: e.target.value })} className="input-field min-h-[150px] resize-y" />
          </Field>
          {/*
            PLAN-039：enhancedTalentDescription 原本沒接進來（PLAN-022 遺留缺口）——
            它的 [xxx] 無法在此指派、語法糖也不會被代入，但 entityRefs 的 WEAPONS textUnits
            確實會掃它。兩段一併傳入並同步套用 transform，與 PilotAdmin 的天賦一致。
          */}
          <RefPicker
            text={[skill.description, skill.enhancedTalentDescription]}
            value={skill.descriptionRefs}
            onChange={(refs) => onChange({ ...skill, descriptionRefs: refs })}
            onCompileText={(tf) => onChange({
              ...skill,
              description: tf(skill.description),
              enhancedTalentDescription: skill.enhancedTalentDescription
                ? tf(skill.enhancedTalentDescription)
                : skill.enhancedTalentDescription,
            })}
          />
          {skill.enhancesTalentName && (
            <Field label="強化後天賦描述 enhancedTalentDescription（遊戲原文，用於差異對比）">
              <textarea
                value={skill.enhancedTalentDescription ?? ''}
                onChange={(e) => onChange({ ...skill, enhancedTalentDescription: e.target.value || undefined })}
                className="input-field min-h-[150px] resize-y"
                placeholder="填入天賦被此專武強化後的完整描述文字（複製遊戲原文）"
              />
            </Field>
          )}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] text-text-dim font-medium uppercase tracking-wider">可計算效果 effects</span>
              <button
                onClick={() => onChange({ ...skill, effects: [...effects, { stat: 'dmg', value: 0, scope: 'self', condition: null }] })}
                className="text-[13px] text-accent-cyan hover:text-accent-cyan/80 transition-colors"
              >
                + 新增效果
              </button>
            </div>
            {effects.length === 0 ? (
              <p className="text-xs text-text-dim py-2 text-center">尚未填入（計算器不計此技能）</p>
            ) : (
              <div className="space-y-2">
                {effects.map((eff, effIdx) => (
                  <SkillEffectItem
                    key={effIdx}
                    effect={eff}
                    index={effIdx}
                    onChange={(updated) => {
                      const next = [...effects]; next[effIdx] = updated
                      onChange({ ...skill, effects: next })
                    }}
                    onRemove={() => onChange({ ...skill, effects: effects.filter((_, i) => i !== effIdx) })}
                  />
                ))}
              </div>
            )}
          </div>
          <Field label="觸發 Buff ID buffIds（逗號分隔）">
            <textarea
              value={buffIds.join(', ')}
              onChange={(e) => {
                const ids = e.target.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
                onChange({ ...skill, buffIds: ids })
              }}
              className="input-field min-h-[48px] resize-y font-mono text-xs"
              placeholder="buff_001, buff_002"
            />
          </Field>
        </div>
      )}
    </div>
  )
}

// ─── 武器編輯面板 ──────────────────────────────────────────────────────────────
// PLAN-033 C-1：原 stats / range / slots 三個分頁在 Phase B 格線響應式化後各只剩
// 1～3 排，三頁加起來仍不到彈窗內容區（1080p 下約 760px、可容 10～11 排）的一半。
// 併為單一 'combat' 分頁、以 section 標題 + border-t 分隔，省下兩次分頁切換。
type WeaponEditTab = 'basic' | 'combat' | 'mods' | 'skills'

const WEAPON_EDIT_TABS: AdminEditTabDef<WeaponEditTab>[] = [
  { id: 'basic',  label: '基本資訊' },
  { id: 'combat', label: '戰鬥屬性・射程・插槽' },
  { id: 'mods',   label: '改裝方案' },
  { id: 'skills', label: '武器技能' },
]

function WeaponEditPanel({
  weapon,
  pilots,
  onSave,
  onCancel,
}: {
  weapon: Weapon
  pilots: Pilot[]
  onSave: (w: Weapon) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm]           = useState<Weapon>({ ...weapon })
  useDraftWrite('weapons', form, (w) => w.name)   // 草稿暫存（PLAN-045）：監聽的必須是 form，不是外層的 editing
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [editTab, setEditTab]     = useState<WeaponEditTab>('basic')
  const [expandedSkillIdx, setExpandedSkillIdx] = useState<number | null>(null)

  // PLAN-032 M4：技能庫（pilotSkills 集合＝全站技能字典，武器技能也住這裡）。
  // AdminPage 的 TAB_CONFIG 已預載 pilotSkills，這裡直接讀不必再 ensureLoaded。
  const gdPanel  = useGameData()
  const skillMap = useMemo(() => new Map(gdPanel.pilotSkills.map(s => [s.id, s])), [gdPanel.pilotSkills])

  useEffect(() => { setForm({ ...weapon }); setEditTab('basic'); setExpandedSkillIdx(null) }, [weapon])

  function update<K extends keyof Weapon>(key: K, value: Weapon[K]) { setForm((f) => ({ ...f, [key]: value })) }
  function updateFixedMod<K extends keyof Weapon['fixedMod']>(key: K, value: Weapon['fixedMod'][K]) { setForm((f) => ({ ...f, fixedMod: { ...f.fixedMod, [key]: value } })) }
  function updateFloatingMod<K extends keyof Weapon['floatingMod']>(key: K, value: Weapon['floatingMod'][K]) { setForm((f) => ({ ...f, floatingMod: { ...f.floatingMod, [key]: value } })) }

  async function handleSubmit() {
    setSaving(true); setError(null)
    try { await onSave(form) }
    catch (e) { setError(e instanceof Error ? e.message : '儲存失敗，請重試'); setSaving(false) }
  }

  const currentKindOptions = WEAPON_KIND_BY_TYPE[form.type] ?? ALL_WEAPON_KINDS

  return (
    <AdminModal saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
      <div className="flex items-start gap-3 mb-3 shrink-0">
        {form.icon && (
          <img src={form.icon} alt="" className="w-10 h-10 rounded shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <span className="text-accent-purple">⚔</span> 編輯武器
            <span className="text-text-dim text-sm font-normal ml-1">{form.id}</span>
          </h3>
          <p className="text-[14px] text-text-dim mt-0.5">
            {form.type} · {form.kind} · {form.rarity} · 技能 {(form.skills ?? []).length}
          </p>
        </div>
      </div>

      <AdminEditTabs tabs={WEAPON_EDIT_TABS} active={editTab} onChange={setEditTab} />

      <div className="overflow-y-auto flex-1 pr-1">
        {editTab === 'basic' && (
          <div className="space-y-3">
            <Field label="武器名稱 name">
              <input value={form.name} onChange={(e) => update('name', e.target.value)} className="input-field" />
            </Field>
            {/* 分類欄位群：5 個短下拉／數值合併為單一自動格線（PLAN-033 B-1） */}
            <div className={`${GRID_AUTO_FIELDS} gap-3`}>
              <Field label="武器類型 type">
                <select value={form.type} onChange={(e) => update('type', e.target.value)} className="input-field">
                  {Object.values(WeaponType).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
              <Field label="武器種類 kind">
                <select value={form.kind} onChange={(e) => update('kind', e.target.value)} className="input-field">
                  {currentKindOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="種類係數 kindCoefficient">
                <input type="number" step="0.01" value={form.kindCoefficient} onChange={(e) => update('kindCoefficient', Number(e.target.value))} className="input-field" />
              </Field>
              <Field label="稀有度 rarity">
                <select value={form.rarity} onChange={(e) => update('rarity', e.target.value)} className="input-field">
                  {Object.values(WeaponRarity).map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="裝備部位 equipSlot">
                <select value={form.equipSlot} onChange={(e) => update('equipSlot', e.target.value)} className="input-field">
                  <option value={WeaponEquipSlot.SINGLE_HAND}>singleHand — 單手</option>
                  <option value={WeaponEquipSlot.DUAL_HAND}>dualHand — 雙手</option>
                  <option value={WeaponEquipSlot.SHOULDER}>shoulder — 肩膀</option>
                  <option value={WeaponEquipSlot.BACK}>back — 背後</option>
                </select>
              </Field>
            </div>
            <Field label="機甲限制 mechRestriction">
              <select value={form.mechRestriction} onChange={(e) => update('mechRestriction', e.target.value)} className="input-field">
                <option value={MechRestriction.NONE}>none — 無限制</option>
                <option value={MechRestriction.LIGHT_ONLY}>light — 僅輕型機甲</option>
                <option value={MechRestriction.MEDIUM_ONLY}>medium — 僅中型機甲</option>
                <option value={MechRestriction.HEAVY_ONLY}>heavy — 僅重型機甲</option>
              </select>
            </Field>
            <Field label="圖示路徑 icon（選填）">
              <input value={form.icon ?? ''} onChange={(e) => update('icon', e.target.value || undefined)} className="input-field" placeholder="/images/weapons/..." />
            </Field>
          </div>
        )}

        {/* 戰鬥屬性・射程・插槽：原為三個獨立分頁，PLAN-033 C-1 併為一頁（以 border-t 分區） */}
        {editTab === 'combat' && (
          <div className="space-y-3">
            <p className="text-xs text-text-dim font-medium tracking-wider uppercase">戰鬥屬性 stats</p>
            {/* 6 個數值原本拆成 3 組 grid-cols-2、要捲 3 排；併為單一自動格線後寬螢幕一排看完（PLAN-033 B-1） */}
            <div className={`${GRID_AUTO_FIELDS} gap-3`}>
              <Field label="攻擊力 attack"><input type="number" value={form.attack} onChange={(e) => update('attack', Number(e.target.value))} className="input-field" /></Field>
              <Field label="命中值 accuracy"><input type="number" value={form.accuracy} onChange={(e) => update('accuracy', Number(e.target.value))} className="input-field" /></Field>
              <Field label="暴擊值 critValue"><input type="number" value={form.critValue} onChange={(e) => update('critValue', Number(e.target.value))} className="input-field" /></Field>
              <Field label="重量 weight"><input type="number" value={form.weight} onChange={(e) => update('weight', Number(e.target.value))} className="input-field" /></Field>
              <Field label="彈藥量 ammoCount（0 = 無限彈藥）"><input type="number" value={form.ammoCount} onChange={(e) => update('ammoCount', Number(e.target.value))} className="input-field" /></Field>
              <Field label="連擊數 hitCount"><input type="number" value={form.hitCount} onChange={(e) => update('hitCount', Number(e.target.value))} className="input-field" /></Field>
            </div>
            <div className="p-3 bg-bg-dark rounded-lg border border-border/60">
              <p className="text-[13px] text-text-dim font-medium uppercase mb-1">連擊數參考</p>
              <p className="text-[14px] text-text-secondary">霰彈槍=12 · 機槍/重機槍/電鋸=10 · 噴火器=8 · 浮游炮=6 · 其他=1</p>
            </div>

            <div className="pt-4 border-t border-border/60 space-y-3">
              <p className="text-xs text-text-dim font-medium tracking-wider uppercase">射程 range</p>
              <Field label="射程型態 rangeType">
                <select
                  value={form.rangeType}
                  onChange={(e) => {
                    const rt = e.target.value
                    update('rangeType', rt)
                    if (rt === RangeType.RING) update('minRange', 0)
                  }}
                  className="input-field"
                >
                  <option value={RangeType.MANHATTAN}>manhattan — 菱形射程（Manhattan 距離，可打斜格）</option>
                  <option value={RangeType.ORTHOGONAL}>orthogonal — 十字直線（上下左右，不可打斜格）</option>
                  <option value={RangeType.RING}>ring — 環形N圈（含自身格，Chebyshev 距離）</option>
                </select>
              </Field>
              <div className={`${GRID_AUTO_FIELDS} gap-3`}>
                <Field label={form.rangeType === RangeType.RING ? 'minRange（ring 型固定為 0）' : '最小射程 minRange'}>
                  <input type="number" value={form.minRange} onChange={(e) => update('minRange', Number(e.target.value))} className="input-field" disabled={form.rangeType === RangeType.RING} />
                </Field>
                <Field label={form.rangeType === RangeType.RING ? '圈數 maxRange（N圈）' : '最大射程 maxRange'}>
                  <input type="number" value={form.maxRange} onChange={(e) => update('maxRange', Number(e.target.value))} className="input-field" />
                </Field>
              </div>
              <div className="p-3 bg-bg-dark rounded-lg border border-border/60 space-y-1.5">
                <p className="text-[13px] text-text-dim font-medium uppercase">射程顯示預覽</p>
                <p className="font-mono text-sm text-accent-cyan">
                  {form.rangeType === RangeType.RING
                    ? `${form.maxRange}+（${(2 * form.maxRange + 1) ** 2} 格覆蓋）`
                    : `${form.minRange}-${form.maxRange}`}
                </p>
                <p className="text-[14px] text-text-dim">
                  {form.rangeType === RangeType.RING
                    ? `ring：以持有者為中心，Chebyshev 距離 ≤ ${form.maxRange} 的 ${2 * form.maxRange + 1}×${2 * form.maxRange + 1} 方格`
                    : form.rangeType === RangeType.ORTHOGONAL
                    ? `orthogonal：十字直線，Manhattan 距離 [${form.minRange}, ${form.maxRange}]，不可打斜格`
                    : `manhattan：菱形範圍，Manhattan 距離 [${form.minRange}, ${form.maxRange}]，可打斜格`}
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-border/60 space-y-3">
              <p className="text-xs text-text-dim font-medium tracking-wider uppercase">元件・專武 slots</p>
              <div className="p-3 bg-bg-dark rounded-lg border border-border/60 space-y-3">
                <p className="text-xs text-text-dim font-medium uppercase tracking-wider">元件插槽</p>
                <div className={`${GRID_AUTO_FIELDS} gap-3`}>
                  <Field label="觸元件槽 triggerSlots"><input type="number" value={form.triggerSlots} onChange={(e) => update('triggerSlots', Number(e.target.value))} className="input-field" /></Field>
                  <Field label="應元件槽 effectSlots"><input type="number" value={form.effectSlots} onChange={(e) => update('effectSlots', Number(e.target.value))} className="input-field" /></Field>
                  <Field label="元件上限 componentLimit"><input type="number" value={form.componentLimit} onChange={(e) => update('componentLimit', Number(e.target.value))} className="input-field" /></Field>
                </div>
                <p className="text-[14px] text-text-dim">SS / S+ = 4；S = 3；其他 = 0</p>
              </div>
              <div className="p-3 bg-bg-dark rounded-lg border border-border/60 space-y-3">
                <p className="text-xs text-text-dim font-medium uppercase tracking-wider">專屬武器設定</p>
                <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                  <input type="checkbox" checked={form.isExclusive} onChange={(e) => update('isExclusive', e.target.checked)} className="accent-accent-orange w-4 h-4" />
                  <span>isExclusive — 此武器為專屬武器（SS 稀有度）</span>
                </label>
                {form.isExclusive && (
                  <Field label="綁定機師 exclusiveFor（機師 ID）">
                    <select value={form.exclusiveFor ?? ''} onChange={(e) => update('exclusiveFor', e.target.value || undefined)} className="input-field">
                      <option value="">（未指定）</option>
                      {pilots.map((p) => <option key={p.id} value={p.id}>{p.name}（{p.id}）</option>)}
                    </select>
                  </Field>
                )}
              </div>
            </div>
          </div>
        )}

        {editTab === 'mods' && (
          /* PLAN-033 C-2：固定改裝與浮動改裝是語意對等的姊妹區塊，原本上下疊、
             各自帶一串效果清單，合計動輒兩屏。並排後垂直長度取兩者最大值而非總和。 */
          <div className={GRID_TWO_PANE}>
            <div className="min-w-0">
              <p className="text-xs text-text-dim font-medium uppercase tracking-wider mb-2">固定改裝 fixedMod（效果固定，依等級解鎖）</p>
              <div className="space-y-3 p-3 bg-bg-dark rounded-lg border border-border/60">
                <div className={`${GRID_AUTO_FIELDS} gap-3`}>
                  <Field label="方案名稱 planName"><input value={form.fixedMod.planName} onChange={(e) => updateFixedMod('planName', e.target.value)} className="input-field" placeholder="如 機槍VIII" /></Field>
                  <Field label="最高等級 maxLevel"><input type="number" value={form.fixedMod.maxLevel} onChange={(e) => updateFixedMod('maxLevel', Number(e.target.value))} className="input-field" /></Field>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[13px] text-text-dim uppercase">效果列表 effects</span>
                    <button
                      onClick={() => updateFixedMod('effects', [...form.fixedMod.effects, { stat: 'attack', value: 0 }])}
                      className="text-[13px] text-accent-cyan hover:text-accent-cyan/80 transition-colors"
                    >+ 新增效果</button>
                  </div>
                  {form.fixedMod.effects.length === 0 ? (
                    <p className="text-xs text-text-dim py-2 text-center">無固定效果</p>
                  ) : (
                    <div className="space-y-2">
                      {form.fixedMod.effects.map((eff, idx) => (
                        <div key={idx} className="flex gap-2 items-end">
                          <Field label="效果類型 stat">
                            <select
                              value={eff.stat}
                              onChange={(e) => { const next = [...form.fixedMod.effects]; next[idx] = { ...next[idx], stat: e.target.value }; updateFixedMod('effects', next) }}
                              className="input-field"
                            >
                              <option value="attack">attack — 攻擊力</option>
                              <option value="crit">crit — 暴擊值</option>
                              <option value="accuracy">accuracy — 命中值</option>
                            </select>
                          </Field>
                          <Field label="數值 value">
                            <input type="number" value={eff.value}
                              onChange={(e) => { const next = [...form.fixedMod.effects]; next[idx] = { ...next[idx], value: Number(e.target.value) }; updateFixedMod('effects', next) }}
                              className="input-field" />
                          </Field>
                          <button
                            onClick={() => updateFixedMod('effects', form.fixedMod.effects.filter((_, i) => i !== idx))}
                            className="px-2 py-1.5 mb-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10 text-xs shrink-0"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="min-w-0">
              <p className="text-xs text-text-dim font-medium uppercase tracking-wider mb-2">浮動改裝 floatingMod（效果隨機，有範圍）</p>
              <div className="space-y-3 p-3 bg-bg-dark rounded-lg border border-border/60">
                <div className={`${GRID_AUTO_FIELDS} gap-3`}>
                  <Field label="方案名稱 planName"><input value={form.floatingMod.planName} onChange={(e) => updateFloatingMod('planName', e.target.value)} className="input-field" placeholder="如 機槍IV" /></Field>
                  <Field label="效果欄位數 slots"><input type="number" value={form.floatingMod.slots} onChange={(e) => updateFloatingMod('slots', Number(e.target.value))} className="input-field" /></Field>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[13px] text-text-dim uppercase">可能效果 possibleEffects</span>
                    <button
                      onClick={() => updateFloatingMod('possibleEffects', [...form.floatingMod.possibleEffects, { stat: 'attack', condition: null, min: 0, max: 0 }])}
                      className="text-[13px] text-accent-cyan hover:text-accent-cyan/80 transition-colors"
                    >+ 新增</button>
                  </div>
                  {form.floatingMod.possibleEffects.length === 0 ? (
                    <p className="text-xs text-text-dim py-2 text-center">無浮動效果</p>
                  ) : (
                    <div className="space-y-2">
                      {form.floatingMod.possibleEffects.map((eff, idx) => (
                        <div key={idx} className="border border-border/40 rounded-lg p-2.5 space-y-2">
                          <div className="flex items-end gap-2">
                            <Field label="效果類型 stat">
                              <select
                                value={eff.stat}
                                onChange={(e) => { const next = [...form.floatingMod.possibleEffects]; next[idx] = { ...next[idx], stat: e.target.value }; updateFloatingMod('possibleEffects', next) }}
                                className="input-field text-xs"
                              >
                                <option value="attack">attack — 攻擊力</option>
                                <option value="crit">crit — 暴擊值</option>
                                <option value="accuracy">accuracy — 命中值</option>
                                <option value="firepower">firepower — 火力</option>
                              </select>
                            </Field>
                            <button
                              onClick={() => updateFloatingMod('possibleEffects', form.floatingMod.possibleEffects.filter((_, i) => i !== idx))}
                              className="px-2 py-1.5 mb-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10 text-xs shrink-0"
                            >✕</button>
                          </div>
                          <div className={`${GRID_AUTO_FIELDS} gap-2`}>
                            <Field label="最小值 min">
                              <input type="number" value={eff.min}
                                onChange={(e) => { const next = [...form.floatingMod.possibleEffects]; next[idx] = { ...next[idx], min: Number(e.target.value) }; updateFloatingMod('possibleEffects', next) }}
                                className="input-field" />
                            </Field>
                            <Field label="最大值 max">
                              <input type="number" value={eff.max}
                                onChange={(e) => { const next = [...form.floatingMod.possibleEffects]; next[idx] = { ...next[idx], max: Number(e.target.value) }; updateFloatingMod('possibleEffects', next) }}
                                className="input-field" />
                            </Field>
                          </div>
                          <Field label="觸發條件 condition（留空 = null 無條件）">
                            <input
                              value={eff.condition ?? ''}
                              onChange={(e) => { const next = [...form.floatingMod.possibleEffects]; next[idx] = { ...next[idx], condition: e.target.value || null }; updateFloatingMod('possibleEffects', next) }}
                              className="input-field text-xs"
                              placeholder="留空 = null（無條件）"
                            />
                          </Field>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {editTab === 'skills' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-text-dim font-medium uppercase tracking-wider">武器技能 skills</span>
              <button
                onClick={() => {
                  const next = [...(form.skills ?? []), {
                    name: '', type: SkillType.PASSIVE,
                    activation: SkillActivation.CARRY as WeaponSkill['activation'],
                    description: '', effects: [], buffIds: [],
                  }]
                  update('skills', next)
                  setExpandedSkillIdx(next.length - 1)
                }}
                className="text-xs text-text-dim hover:text-text-secondary transition-colors"
              >
                + 新增內嵌技能（舊格式）
              </button>
            </div>

            {/* PLAN-032 M4：從技能庫挑一筆掛上來。
                技能**本體**（名稱／正文／effects／buffIds）請至「技能」分頁維護——
                那才是單一資料源，改一處全站生效。這裡只設定「這把武器怎麼用它」。 */}
            <div className="border border-accent-cyan/40 rounded-lg p-3 bg-accent-cyan/5 space-y-2.5 mb-3">
              <span className="text-xs text-accent-cyan font-medium uppercase tracking-wider">
                掛載技能庫技能（技能本體請至「技能」分頁維護）
              </span>
              <WeaponSkillRefAdder
                skills={gdPanel.pilotSkills}
                attachedIds={new Set((form.skills ?? []).filter(isWeaponSkillRef).map(e => e.skillId))}
                onAdd={(skillId) => {
                  if (!skillId) return
                  // 預設 carry：實測 S+ 一般武器 39/39 皆為 carry，是最常見的起點；
                  // SS 專武常為 use，掛上後在右側下拉改。
                  update('skills', [...(form.skills ?? []), { skillId, activation: SkillActivation.CARRY as WeaponSkillRef['activation'] }])
                }}
              />
              <p className="text-[11px] text-text-dim">
                找不到要掛的技能？先到「技能」分頁新增（domain 選「武器技能」），再回來掛。
              </p>
            </div>
            {(form.skills ?? []).length === 0 ? (
              <p className="text-xs text-text-dim py-4 text-center">無武器技能</p>
            ) : (
              <div className="space-y-2">
                {(form.skills ?? []).map((skill, idx) => isWeaponSkillRef(skill) ? (
                  // 引用格式：只編輯掛載側的 activation。技能本體在技能庫，
                  // 刻意不在這裡給任何內容欄位——那會讓人以為改了只影響這把武器。
                  <WeaponSkillRefRow
                    key={`ref-${skill.skillId}-${idx}`}
                    entry={skill}
                    doc={skillMap.get(skill.skillId)}
                    onChange={(updated) => {
                      const next = [...(form.skills ?? [])]; next[idx] = updated
                      update('skills', next)
                    }}
                    onRemove={() => {
                      update('skills', (form.skills ?? []).filter((_, i) => i !== idx))
                      if (expandedSkillIdx === idx) setExpandedSkillIdx(null)
                    }}
                  />
                ) : (
                  <WeaponSkillItem
                    key={idx}
                    skill={skill}
                    index={idx}
                    expanded={expandedSkillIdx === idx}
                    onToggle={() => setExpandedSkillIdx(expandedSkillIdx === idx ? null : idx)}
                    onChange={(updated) => {
                      const next = [...(form.skills ?? [])]; next[idx] = updated
                      update('skills', next)
                    }}
                    onRemove={() => {
                      update('skills', (form.skills ?? []).filter((_, i) => i !== idx))
                      if (expandedSkillIdx === idx) setExpandedSkillIdx(null)
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AdminModal>
  )
}

// ─── 武器管理列表 ──────────────────────────────────────────────────────────────
export default function WeaponAdmin({
  pilots,
  initialSearch = '',
}: {
  pilots: Pilot[]
  initialSearch?: string
}) {
  const [editing, setEditing] = useState<Weapon | null>(null)
  const draft = useDraftRestore<Weapon>('weapons')
  const gd = useGameData()

  const {
    items: filtered, loading, error, hasMore, search, setSearch,
    filters, setFilter, submitSearch, loadMore, upsert,
  } = useClientPaged<Weapon, WeaponFilters>({
    source: gd.weapons,
    initialSearch,
    initialFilters: { rarity: 'all', type: 'all', exclusive: 'all' },
    matchFilters: (w, f) =>
      (f.rarity === 'all' || w.rarity === f.rarity) &&
      (f.type === 'all' || w.type === f.type) &&
      (f.exclusive === 'all' || (f.exclusive === 'yes' ? !!w.isExclusive : !w.isExclusive)),
  })

  // 輸入框收「名稱」，ID 由系統生成 `weapon_<3位流水號>_<slug(name)>`，續既有最大號 +1。
  // 原本是維護者手打 ID 且只比對 `filtered`（當前搜尋／篩選結果），有兩個洞：
  //   1. 沒有格式防呆 → 直接把名稱當 ID 打進去，建出 `天燼審判` 這種無前綴文件；
  //   2. 撞名只查當前分頁 → 被篩掉的武器看不到，會靜默建出第二份。
  //
  // ⚠ 流水號讓「同一名稱兩次建立」產出兩個**不同**的 ID，撞 ID 檢查因此救不了重複；
  //   真正擋重複的是 findEntityClash 的 **name** 維度，所以 existingItems 必須是
  //   `gd.weapons` 全集合（useClientPaged 的 source，本頁一定已整包載入）而非 `filtered`。
  const nextSeq = useMemo(() => maxEntitySeq('weapon', gd.weapons.map((w) => w.id)) + 1, [gd.weapons])

  const { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate, derivedId } =
    useNewItemCreation(
      gd.weapons,                                            // 全集合 in-memory 撞名（名稱維度是主防線）
      (w) => w.id,
      (id, name) => makeDefaultWeapon(id, stripNumberedIdPrefix('weapon', name)),
      (name) => makeNumberedEntityId('weapon', name, nextSeq),
      (w) => w.name,                                         // 名稱撞名：ID 可能因改名而與 name 脫鉤
    )

  async function confirmCreateChecked() {
    // 集合還沒載完就建立 → maxEntitySeq 掃到的是空/半套清單，會從 001 起跳並與既有武器撞號，
    // 而且 in-memory 撞名同時失效（看不到既有項目 = 靜默建出第二份）。擋在生成 ID 之前。
    // 判斷要用 gd.loadedKeys 而非 useClientPaged 的 loading —— 後者是寫死的 false（見 shared.tsx:310），
    // 拿它當守衛等於沒守。AdminPage 進本分頁才 ensureLoaded(['weapons'])，所以這個窗口是真的存在。
    if (!gd.loadedKeys.has('weapons')) { setNewIdError('武器資料尚未載入完成，請稍候再試'); return }
    const id = makeNumberedEntityId('weapon', newId, nextSeq)
    if (!id) { setNewIdError('名稱無法產生有效 ID，請改用其他名稱'); return }
    // 伺服器端撞 ID 檢查：續號理論上不會撞，但 gd.weapons 若因故不完整（快取失效中、
    // 另一個分頁同時建立）算出的號就會偏小，這道擋的是那個窗口。
    if (await docExists('weapons', id)) {
      setNewIdError(`ID「${id}」已存在，請重新整理頁面後再試（流水號可能已被其他人用掉）`)
      return
    }
    const item = confirmCreate()
    if (item) setEditing(item)
  }

  async function handleSave(updated: Weapon) {
    const version = await updateWeapon(updated)
    upsert(updated)
    gd.patchCollectionItem('weapons', updated, version)
    draft.commit()   // 存檔成功 → 清除本機草稿，避免下次進頁跳過期提示
    setEditing(null)
  }

  return (
    <div>
      <DraftRestoreBar draft={draft} onRestore={setEditing} />
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitSearch() }}
          placeholder="搜尋武器名稱開頭（Enter 搜尋）..."
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
          {Object.values(WeaponRarity).map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filters.type} onChange={(e) => setFilter('type', e.target.value)} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部類型</option>
          {Object.values(WeaponType).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filters.exclusive} onChange={(e) => setFilter('exclusive', e.target.value as WeaponFilters['exclusive'])} className="px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm">
          <option value="all">全部武器</option>
          <option value="yes">專屬武器</option>
          <option value="no">通用武器</option>
        </select>
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="text-text-dim text-xs">
          {error ? <span className="text-accent-red">載入失敗：{error}</span>
            : loading ? '載入中...'
            : `顯示 ${filtered.length} 把武器${hasMore ? '（可載入更多）' : ''}`}
        </p>
        <button
          onClick={openCreate}
          className="text-xs px-3 py-1.5 bg-accent-orange text-black font-bold rounded-lg hover:opacity-90 transition-opacity"
        >
          + 新增武器
        </button>
      </div>

      <NewItemDialog
        creating={creating}
        newId={newId}
        newIdError={newIdError}
        placeholder="武器名稱，如 天燼審判"
        hint={<>輸入新武器<span className="text-accent-cyan">名稱</span>，文件 ID 由系統續號生成（下一號 <span className="text-accent-cyan">weapon_{String(nextSeq).padStart(3, '0')}_</span>，儲存後不可更改）</>}
        onChangeId={(v) => { setNewId(v); setNewIdError('') }}
        onConfirm={() => { void confirmCreateChecked() }}
        onCancel={cancelCreate}
        deriveMode
        derivedId={derivedId}
      />

      <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
        {filtered.map((w) => {
          const pilot = pilots.find((p) => p.id === w.exclusiveFor)
          return (
            <div
              key={w.id}
              className="bg-bg-dark border border-border rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-border-accent transition-colors cursor-pointer"
              onClick={() => setEditing(w)}
            >
              {w.icon && (
                <img src={w.icon} alt="" className="w-8 h-8 rounded shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm text-text-primary truncate">
                    {w.name || <span className="text-text-dim font-normal">（未命名）</span>}
                  </span>
                  <span className={`text-[13px] px-1.5 py-0.5 rounded border font-bold shrink-0 ${WEAPON_RARITY_CLASS[w.rarity] ?? 'text-text-dim border-border bg-bg-card'}`}>{w.rarity}</span>
                  <span className="text-[13px] px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-dim shrink-0">{w.type}</span>
                  <span className="text-[13px] px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-dim shrink-0">{w.kind}</span>
                  {w.isExclusive && (
                    <span className="text-[13px] px-1.5 py-0.5 rounded bg-accent-purple/10 text-accent-purple border border-accent-purple/30 shrink-0">
                      專屬{pilot ? `・${pilot.name}` : '（未綁定）'}
                    </span>
                  )}
                </div>
                <p className="text-[14px] text-text-dim mt-0.5">
                  {w.equipSlot} · 重量 {w.weight} · 攻擊 {w.attack} · 射程 {w.rangeType === RangeType.RING ? `${w.maxRange}+` : `${w.minRange}-${w.maxRange}`}
                </p>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && !loading && (
          <p className="text-text-dim text-sm text-center py-8">找不到符合條件的武器</p>
        )}
      </div>

      <LoadMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />

      {editing && (
        <WeaponEditPanel weapon={editing} pilots={pilots} onSave={handleSave} onCancel={() => { draft.discard(); setEditing(null) }} />
      )}
    </div>
  )
}
