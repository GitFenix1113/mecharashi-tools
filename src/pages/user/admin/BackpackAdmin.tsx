import { useState, useEffect, useMemo } from 'react'
import type { Backpack, BackpackSkillDoc } from '../../../types'
import { WeaponEquipSlot } from '../../../types/enums'
import { updateBackpack } from '../../../lib/firestoreApi'
import { useGameData } from '../../../contexts/GameDataContext'
import {
  Field, AdminModal, useNewItemCreation, NewItemDialog, GRID_AUTO_FIELDS,
  useCascadeDelete, ConfirmDeleteDialog, DeleteButton,
} from './shared'
import { IconField } from '../../../components/admin/IconPicker'
import { BACKPACK_TYPE_CONFIG, ASSEMBLABLE_ARMOR_CONFIG } from '../../../components/BackpackBadges'
import { parseBackpackName } from '../../../utils/backpackClassify'
import { parseBuffRef, formatBuffRef } from '../../../utils/buffRef'

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
    skillIds: [],   // PLAN-043：技能改由 backpackSkills 集合引用，掛載器在 Phase C 接上
  }
}

// ─── 技能掛載器（PLAN-043 C-3）────────────────────────────────────────────────
// 取代原本的內嵌 mainSkill 表單：技能本體改由「背包技能」分頁維護，這裡只掛 id。
// 元素格式同 buffIds，階梯技能以 `id@N` 指定級。
function BackpackSkillPicker({
  value,
  skills,
  onChange,
}: {
  value: string[]
  skills: BackpackSkillDoc[]
  onChange: (next: string[]) => void
}) {
  const [search, setSearch] = useState('')
  const byId = useMemo(() => new Map(skills.map(s => [s.id, s])), [skills])

  // 候選：排除已掛的，再套名稱搜尋
  const candidates = useMemo(() => {
    const attached = new Set(value.map(v => parseBuffRef(v).buffId))
    const q = search.trim().toLowerCase()
    return skills
      .filter(s => !attached.has(s.id))
      .filter(s => !q || s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  }, [skills, value, search])

  function add(id: string) {
    if (!id) return
    // 階梯技能預設掛第一級——不指定級的話前台不知道要顯示哪一階
    const doc = byId.get(id)
    const first = doc?.levels?.length ? doc.levels[0].level : undefined
    onChange([...value, formatBuffRef(id, first)])
  }
  function setLevel(idx: number, level: number | undefined) {
    const { buffId } = parseBuffRef(value[idx])
    const next = [...value]
    next[idx] = formatBuffRef(buffId, level)
    onChange(next)
  }

  return (
    <div className="border border-accent-cyan/40 rounded-lg p-3 bg-accent-cyan/5 space-y-2.5">
      <span className="text-xs text-accent-cyan font-medium uppercase tracking-wider">
        掛載技能 skillIds（技能本體請至「背包技能」分頁維護）
      </span>

      {value.length === 0 ? (
        <p className="text-xs text-text-dim py-1">尚未掛載技能。</p>
      ) : (
        <div className="space-y-1.5">
          {value.map((raw, idx) => {
            const { buffId, level } = parseBuffRef(raw)
            const doc = byId.get(buffId)
            const levels = doc?.levels ?? []
            return (
              <div key={`${raw}-${idx}`} className="flex items-center gap-2 bg-bg-dark border border-border rounded-lg px-2.5 py-2">
                {doc?.icon && (
                  <img src={doc.icon} alt="" className="w-7 h-7 rounded shrink-0" onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
                )}
                <div className="flex-1 min-w-0 truncate">
                  {/* 解析不到 = 斷鏈（技能被刪或 id 打錯）。必須顯眼，否則前台只會靜默不顯示 */}
                  {doc ? (
                    <span className="text-sm text-text-primary font-medium">{doc.name}</span>
                  ) : (
                    <span className="text-sm text-accent-red">⚠ 找不到此技能</span>
                  )}
                  <span className="text-[11px] text-text-dim font-mono ml-2">{raw}</span>
                </div>
                {levels.length > 0 && (
                  // 固定寬容器：`.input-field` 是 index.css 的無 layer 規則（width:100%），
                  // 會壓過 Tailwind 的 w-auto／w-36（utilities 在 layer 內優先度較低）。
                  // 直接給 select 加寬度 class 無效——它會撐滿整列把名稱擠成 0 寬。
                  <div className="w-36 shrink-0">
                    <select
                      value={level ?? ''}
                      onChange={e => setLevel(idx, e.target.value ? Number(e.target.value) : undefined)}
                      className="input-field py-1 text-xs"
                    >
                      <option value="">（不指定級）</option>
                      {levels.map(lv => (
                        <option key={lv.level} value={lv.level}>{lv.name || `Lv.${lv.level}`}</option>
                      ))}
                    </select>
                  </div>
                )}
                <button
                  onClick={() => onChange(value.filter((_, i) => i !== idx))}
                  className="text-[13px] px-1.5 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10 shrink-0"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜尋技能名稱..."
          className="input-field"
        />
        <select value="" onChange={e => add(e.target.value)} className="input-field">
          <option value="">＋ 加入技能（{candidates.length} 個可選）</option>
          {candidates.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}{s.levels?.length ? `（${s.levels.length} 級）` : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
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
  const gd = useGameData()

  // PLAN-036：前置主背包 picker 的分類縮小（類型 / 名稱搜尋）
  const [prereqType, setPrereqType]     = useState(() => defaultPrereqType(backpack))
  const [prereqSearch, setPrereqSearch] = useState('')

  useEffect(() => {
    setForm({ ...backpack })
    setError(null)
    setPrereqType(defaultPrereqType(backpack)); setPrereqSearch('')   // 類型預設：S+ 用 line 推、SS 用自身 type
  }, [backpack])

  // PLAN-036：前置候選＝低一階背包（SS←S+、S+←S）；PLAN-043：技能挑選器需 backpackSkills
  useEffect(() => { gd.ensureLoaded(['backpacks', 'backpackSkills']) }, [gd])
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

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      let data = form
      // PLAN-036：craft（前置主背包）僅 SS/S+ 有意義（低一階前置），其餘階不寫
      if (!prereqRarityOf(data.rarity)) data = { ...data, craft: undefined }
      await onSave(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗，請重試')
      setSaving(false)
    }
  }

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

        <IconField
          label="圖示 icon"
          value={form.icon ?? ''}
          onChange={v => update('icon', v || undefined)}
          defaultFolder="backpacks"
        />

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

        {/* 風味文案（PLAN-043）：遊戲內背包卡下方的灰字敘述 */}
        <Field label="風味文案 flavor（選填；遊戲內背包卡下方的灰字敘述）">
          <textarea
            value={form.flavor ?? ''}
            onChange={e => update('flavor', e.target.value || undefined)}
            className="input-field min-h-[70px] resize-y text-sm leading-relaxed"
            placeholder="直接將額外動能輸送到腿部傳動裝置，無論是使用滑輪還是步行，機甲的移動力都能得到提升。"
          />
        </Field>

        {/* PLAN-043 C-3：技能改由 backpackSkills 集合引用，此處只掛 id */}
        <BackpackSkillPicker
          value={form.skillIds ?? []}
          skills={gd.backpackSkills}
          onChange={ids => update('skillIds', ids)}
        />
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
  // PLAN-043 C-4：背包成為第四個可刪的集合。硬外鍵（前置鏈 / 複合武器融合）由
  // entityRefs 標記為 hardRef，命中時 ConfirmDeleteDialog 會顯示 blocker 並禁用確認鈕。
  const del = useCascadeDelete('backpack', 'backpacks')

  // 客戶端載入全背包（前台/前置 picker 本就已載入 → 零額外讀取），改成品質篩選 + 即時搜尋
  useEffect(() => { gd.ensureLoaded(['backpacks', 'backpackSkills']) }, [gd])
  const loading = !gd.loadedKeys.has('backpacks')

  // 掛載技能的顯示名（列表 badge 用）
  const skillNameOf = useMemo(
    () => new Map(gd.backpackSkills.map(s => [s.id, s.name])),
    [gd.backpackSkills],
  )

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
                {(bp.skillIds ?? []).map(raw => {
                  const { buffId, level } = parseBuffRef(raw)
                  const name = skillNameOf.get(buffId)
                  return (
                    <span
                      key={raw}
                      className={`text-[13px] px-1.5 py-0.5 rounded shrink-0 border ${
                        name
                          ? 'bg-accent-cyan/10 text-accent-cyan border-accent-cyan/30'
                          : 'bg-accent-red/10 text-accent-red border-accent-red/30'
                      }`}
                    >
                      ✦ {name ?? `找不到 ${buffId}`}{level ? ` Lv.${level}` : ''}
                    </span>
                  )
                })}
              </div>
              <p className="text-[14px] text-text-dim mt-0.5">{bp.id} · 重量 {bp.weight}</p>
            </div>
            <DeleteButton onAsk={() => void del.ask(bp.id)} busy={del.asking === bp.id} />
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
