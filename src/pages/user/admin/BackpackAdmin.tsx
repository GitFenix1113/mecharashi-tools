import { useState, useEffect, useMemo } from 'react'
import type { Backpack } from '../../../types'
import { WeaponEquipSlot } from '../../../types/enums'
import { updateBackpack } from '../../../lib/firestoreApi'
import { useGameData } from '../../../contexts/GameDataContext'
import { RefPicker } from '../../../components/admin/RefPicker'
import { Field, AdminModal, useNewItemCreation, NewItemDialog, GRID_AUTO_FIELDS } from './shared'
import { BACKPACK_TYPE_CONFIG, ASSEMBLABLE_ARMOR_CONFIG } from '../../../components/BackpackBadges'
import { parseBackpackName } from '../../../utils/backpackClassify'

const PAGE_SIZE = 20
const ALL_RARITIES = ['SS', 'S+', 'S', 'A', 'B']
const ALL_BACKPACK_TYPES = Object.keys(BACKPACK_TYPE_CONFIG)

// PLAN-036：前置主背包是「低一階」的背包（SS←S+、S+←S）；其餘階無前置關係
function prereqRarityOf(rarity: string): string | null {
  if (rarity === 'SS') return 'S+'
  if (rarity === 'S+') return 'S'
  return null
}
// 前置類型的預設值：S+ 的前置是變體背包（強化→Enhance / 干擾→EMP，非自身 PowerAdd）；
// SS 的前置通常同類型，故用自身 type。查無則 'ALL'。
function defaultPrereqType(bp: Backpack): string {
  if (bp.rarity === 'S+') {
    const { line } = parseBackpackName(bp.name)
    return line === '強化' ? 'Enhance' : line === '干擾' ? 'EMP' : 'ALL'
  }
  if (bp.rarity === 'SS') return bp.type
  return 'ALL'
}

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
  const gd = useGameData()

  // PLAN-036：前置主背包 picker 的分類縮小（類型 / 名稱搜尋）
  const [prereqType, setPrereqType]     = useState(() => defaultPrereqType(backpack))
  const [prereqSearch, setPrereqSearch] = useState('')

  useEffect(() => {
    setForm({ ...backpack })
    setHasMainSkill(!!backpack.mainSkill)
    setError(null)
    setPrereqType(defaultPrereqType(backpack)); setPrereqSearch('')   // 類型預設：S+ 用 line 推、SS 用自身 type
  }, [backpack])

  // PLAN-036：前置候選＝低一階背包（SS←S+、S+←S）
  useEffect(() => { gd.ensureLoaded(['backpacks']) }, [gd])
  const prereqRarity = prereqRarityOf(form.rarity)
  const prereqCandidates = useMemo(
    () => prereqRarity
      ? gd.backpacks
          .filter(b => b.rarity === prereqRarity && b.id !== form.id)
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
      : [],
    [gd.backpacks, form.id, prereqRarity],
  )

  // 經分類縮小後的候選；已選中的前置一律保留在清單內（即使被篩掉／非 S+），避免 select 顯示空白
  const narrowedPrereq = useMemo(() => {
    const q = prereqSearch.trim().toLowerCase()
    const list = prereqCandidates.filter(b =>
      (prereqType === 'ALL' || b.type === prereqType) &&
      (!q || b.name.toLowerCase().includes(q)),
    )
    const selectedId = form.craft?.prereqBackpackId
    if (selectedId && !list.some(b => b.id === selectedId)) {
      const sel = gd.backpacks.find(b => b.id === selectedId)
      if (sel) return [sel, ...list]
    }
    return list
  }, [prereqCandidates, prereqType, prereqSearch, form.craft?.prereqBackpackId, gd.backpacks])

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
      let data = hasMainSkill ? form : { ...form, mainSkill: undefined }
      // PLAN-036：craft（前置主背包）僅 SS/S+ 有意義（低一階前置），其餘階不寫
      if (!prereqRarityOf(data.rarity)) data = { ...data, craft: undefined }
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

        {/* PLAN-033 B-4：類型／稀有度／重量／修理量原為兩組固定二欄，皆屬同質短欄位，合併為單一自動格線 */}
        <div className={`${GRID_AUTO_FIELDS} gap-3`}>
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

        {/* PLAN-036：前置主背包（SS←S+、S+←S；種類/圖紙由前台 derive） */}
        {prereqRarity && (
          <div className="border border-accent-orange/40 rounded-lg p-3 bg-accent-orange/5 space-y-2">
            <span className="text-xs text-accent-orange font-medium uppercase tracking-wider">
              前置主背包 craft.prereqBackpackId（製作的前置 · 候選為 {prereqRarity} 背包）
            </span>
            {/* 分類縮小：類型（預設帶入背包自身類型，前置通常同類型）/ 名稱搜尋 */}
            <div className="grid grid-cols-2 gap-2">
              <select value={prereqType} onChange={e => setPrereqType(e.target.value)} className="input-field">
                <option value="ALL">類型：全部</option>
                {ALL_BACKPACK_TYPES.map(t => (
                  <option key={t} value={t}>類型：{BACKPACK_TYPE_CONFIG[t]?.label ?? t}</option>
                ))}
              </select>
              <input
                value={prereqSearch}
                onChange={e => setPrereqSearch(e.target.value)}
                placeholder="搜尋名稱（例：護甲）..."
                className="input-field"
              />
            </div>
            <Field label="選擇前置主背包（選填；空 = 未關聯，前台前置篩選下不顯示此背包）">
              <select
                value={form.craft?.prereqBackpackId ?? ''}
                onChange={e => update('craft', e.target.value ? { prereqBackpackId: e.target.value } : undefined)}
                className="input-field"
                size={8}
              >
                <option value="">（未設定）</option>
                {narrowedPrereq.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name}（{b.rarity} · {BACKPACK_TYPE_CONFIG[b.type]?.label ?? b.type}）
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-[11px] text-text-dim">
              縮小後 {narrowedPrereq.length} 項
              {form.craft?.prereqBackpackId && (
                <span className="text-accent-orange">
                  {' · 已選：'}
                  {gd.backpacks.find(b => b.id === form.craft?.prereqBackpackId)?.name ?? form.craft.prereqBackpackId}
                </span>
              )}
            </p>
          </div>
        )}

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
                <textarea value={skill.description} onChange={e => updateSkill('description', e.target.value)} className="input-field min-h-[150px] resize-y" />
              </Field>
              <RefPicker
                text={skill.description}
                value={skill.descriptionRefs}
                onChange={refs => updateSkill('descriptionRefs', refs)}
                onCompileText={tf => updateSkill('description', tf(skill.description))}
              />
              <Field label="圖示 icon（選填，填圖示檔名如 Icon_skill_passive_1234）">
                <input
                  value={skill.icon ?? ''}
                  onChange={e => updateSkill('icon', e.target.value || undefined)}
                  className="input-field"
                  placeholder="Icon_skill_passive_1234"
                />
              </Field>
              {/* PLAN-033 B-4：增傷／爆率／爆傷／命中四個數值欄位原為兩組固定二欄，合併為單一自動格線 */}
              <div className={`${GRID_AUTO_FIELDS} gap-3`}>
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
  const gd = useGameData()
  const [rarityFilter, setRarityFilter] = useState('SS')   // 預設 SS（特種背包才需編輯前置；S+ 以下幾乎不再變動）
  const [search, setSearch]             = useState(initialSearch)
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE)
  const [editing, setEditing]           = useState<Backpack | null>(null)

  // 客戶端載入全背包（前台/前置 picker 本就已載入 → 零額外讀取），改成品質篩選 + 即時搜尋
  useEffect(() => { gd.ensureLoaded(['backpacks']) }, [gd])
  const loading = !gd.loadedKeys.has('backpacks')

  const { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate } =
    useNewItemCreation(gd.backpacks, b => b.id, makeDefaultBackpack)

  useEffect(() => { setDisplayCount(PAGE_SIZE) }, [rarityFilter, search])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return gd.backpacks
      .filter(b => rarityFilter === 'ALL' || b.rarity === rarityFilter)
      .filter(b => !q || b.name.toLowerCase().includes(q) || b.id.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  }, [gd.backpacks, rarityFilter, search])

  const shown = filtered.slice(0, displayCount)

  async function handleSave(updated: Backpack) {
    const version = await updateBackpack(updated)
    gd.patchCollectionItem('backpacks', updated, version)   // 列表由 gd.backpacks derive → 存檔即時反映
    setEditing(null)
  }

  const rarityBtn = (active: boolean) =>
    `px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
      active
        ? 'bg-accent-pink/15 text-accent-pink border-accent-pink/40'
        : 'bg-bg-dark text-text-secondary border-border hover:border-border-accent hover:text-text-primary'
    }`

  return (
    <div>
      {/* 品質篩選（預設 SS）*/}
      <div className="flex flex-wrap gap-1.5 items-center mb-3">
        <span className="text-xs text-text-dim mr-1 shrink-0">品質</span>
        <button className={rarityBtn(rarityFilter === 'ALL')} onClick={() => setRarityFilter('ALL')}>全部</button>
        {ALL_RARITIES.map(r => (
          <button key={r} className={rarityBtn(rarityFilter === r)} onClick={() => setRarityFilter(r)}>{r}</button>
        ))}
        <span className="text-[11px] text-text-dim ml-1">預設 SS（特種背包才需編輯前置主背包）</span>
      </div>

      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="即時搜尋背包名稱 / ID..."
          className="flex-1 min-w-[180px] px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-pink"
        />
        <button
          onClick={openCreate}
          className="text-xs px-3 py-1.5 bg-accent-pink text-white font-bold rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          + 新增背包
        </button>
      </div>

      <p className="text-text-dim text-xs mb-3">
        {loading
          ? '載入中...'
          : `顯示 ${Math.min(displayCount, filtered.length)} / ${filtered.length} 件（品質：${rarityFilter === 'ALL' ? '全部' : rarityFilter}${search ? `，搜尋「${search}」` : ''}）`}
      </p>

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
        {shown.map(bp => (
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
                {bp.craft?.prereqBackpackId && (
                  <span className="text-[13px] px-1.5 py-0.5 rounded bg-accent-orange/10 text-accent-orange border border-accent-orange/30 shrink-0">
                    前置：{gd.backpacks.find(x => x.id === bp.craft?.prereqBackpackId)?.name ?? '?'}
                  </span>
                )}
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

        {!loading && filtered.length === 0 && (
          <p className="text-text-dim text-sm text-center py-8">沒有符合條件的背包</p>
        )}
      </div>

      {!loading && displayCount < filtered.length && (
        <div className="mt-4 text-center">
          <button
            onClick={() => setDisplayCount(n => n + PAGE_SIZE)}
            className="px-6 py-2 rounded-xl border border-border bg-bg-dark text-text-secondary text-sm hover:border-border-accent hover:text-text-primary transition-colors"
          >
            載入更多（{filtered.length - displayCount} 件）
          </button>
        </div>
      )}

      {editing && (
        <BackpackEditPanel backpack={editing} onSave={handleSave} onCancel={() => setEditing(null)} />
      )}
    </div>
  )
}
