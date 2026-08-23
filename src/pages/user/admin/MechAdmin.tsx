import { useState, useEffect, useMemo } from 'react'
import type { Mech, Module, MechPart, Weapon } from '../../../types'
import { ModuleSlot, ArmorType, PartInterface } from '../../../types/enums'
import {
  Field, AdminModal, useClientPaged, LoadMoreButton, useNewItemCreation, NewItemDialog,
  GRID_AUTO_FIELDS, AdminEditTabs, type AdminEditTabDef,
  DraftRestoreBar,
} from './shared'
import { useDraftWrite, useDraftRestore } from '../../../hooks/useDraftAutosave'
import { IconField, loadManifest } from '../../../components/admin/IconPicker'
import { ArmamentMountEditor } from '../../../components/admin/ArmamentMountEditor'
import { ModuleBoundPart } from '../../../components/module/ModuleBoundPart'
import { updateMech, docExists } from '../../../lib/firestoreApi'
import { makeNumberedEntityId, maxEntitySeq, stripNumberedIdPrefix } from '../../../utils/idSlug'
import { useGameVersions } from '../../../hooks/useGameVersions'
import { useGameData } from '../../../contexts/GameDataContext'
import { useAuth } from '../../../contexts/AuthContext'

type MechFilters = { armorType: string }

// 空白部件工廠：依 position 帶上該部位專屬欄位（臂 hit、腿 dodge/move、軀幹 antiRiot/output）。
function makeDefaultPart(position: MechPart['position']): MechPart {
  const base: MechPart = { position, durable: 0, armor: 0, firepower: 0, weight: 0, interface: '' }
  if (position === 'leftArm' || position === 'rightArm') base.hit = 0
  if (position === 'legs') { base.dodge = 0; base.move = 0 }
  if (position === 'torso') { base.antiRiot = 0; base.output = 0 }
  return base
}

// 新機甲預設值（六大數值 0、空四部件、無模組引用）。
// manual:true 讓爬蟲補丁整筆跳過（防日後官方同名機甲覆寫人工資料）。
function makeDefaultMech(id: string, name = ''): Mech {
  return {
    id,
    name,
    armorType: ArmorType.MEDIUM,
    firepower: 0,
    armor: 0,
    evasion: 0,
    mobility: 0,
    weight: 0,
    output: 0,
    parts: {
      torso: makeDefaultPart('torso'),
      leftArm: makeDefaultPart('leftArm'),
      rightArm: makeDefaultPart('rightArm'),
      legs: makeDefaultPart('legs'),
    },
    moduleFixedIds: [],
    manual: true,
  }
}

// ─── 機甲管理列表 ──────────────────────────────────────────────────────────────
export default function MechAdmin({
  modules,
  weapons,
  initialSearch = '',
}: {
  modules: Module[]
  weapons: Weapon[]
  initialSearch?: string
}) {
  const [editing, setEditing] = useState<Mech | null>(null)
  const draft = useDraftRestore<Mech>('mechs')
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

  // 輸入框收「名稱」，ID 由系統生成 `mech_<3位流水號>_<slug(name)>`，續既有最大號 +1（比照 weapons）。
  // 原本生的是不帶號的 `mech_<slug>`，與爬蟲留下的 83 筆 `mech_NNN_名稱` 長相不一致，
  // 且會踩到列表排序：MechsPage 第三排序鍵 idNum() 對無號 ID 一律回傳 0，同版本同品質時排序失序。
  //
  // ⚠ 流水號讓「同一名稱兩次建立」產出兩個**不同**的 ID，撞 ID 檢查因此救不了重複；
  //   真正擋重複的是 findEntityClash 的 **name** 維度，所以 existingItems 必須是
  //   `gd.mechs` 全集合（useClientPaged 的 source，本頁整包載入）而非 `filtered`。
  const nextSeq = useMemo(() => maxEntitySeq('mech', gd.mechs.map((m) => m.id)) + 1, [gd.mechs])

  const { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate, derivedId } =
    useNewItemCreation(
      gd.mechs,                                              // 全集合 in-memory 撞名（名稱維度是主防線）
      (m) => m.id,
      (id, name) => makeDefaultMech(id, stripNumberedIdPrefix('mech', name)),
      (name) => makeNumberedEntityId('mech', name, nextSeq), // deriveId：mech_<NNN>_<slug(name)>
      (m) => m.name,                                        // 名稱撞名：ID 可能因改名而與 name 脫鉤
    )

  async function confirmCreateChecked() {
    // 集合還沒載完就建立 → maxEntitySeq 掃到的是空/半套清單，會從 001 起跳並與既有機甲撞號，
    // 而且 in-memory 撞名同時失效（看不到既有項目 = 靜默建出第二份）。擋在生成 ID 之前。
    // 判斷要用 gd.loadedKeys 而非 useClientPaged 的 loading —— 後者是寫死的 false（見 shared.tsx:310），
    // 拿它當守衛等於沒守。AdminPage 進本分頁才 ensureLoaded(['mechs'])，所以這個窗口是真的存在。
    if (!gd.loadedKeys.has('mechs')) { setNewIdError('機甲資料尚未載入完成，請稍候再試'); return }
    const id = makeNumberedEntityId('mech', newId, nextSeq)
    if (!id) { setNewIdError('名稱無法產生有效 ID，請改用其他名稱'); return }
    // 伺服器端撞 ID 檢查：續號理論上不會撞，但另一個分頁同時建立時算出的號會偏小，擋的是那個窗口。
    if (await docExists('mechs', id)) {
      setNewIdError(`ID「${id}」已存在，請重新整理頁面後再試（流水號可能已被其他人用掉）`)
      return
    }
    const item = confirmCreate()
    if (item) setEditing(item)
  }

  async function handleSave(updated: Mech) {
    const version = await updateMech(updated)
    upsert(updated)
    gd.patchCollectionItem('mechs', updated, version)
    draft.commit()   // 存檔成功 → 清除本機草稿，避免下次進頁跳過期提示
    setEditing(null)
  }

  return (
    <div>
      <DraftRestoreBar draft={draft} onRestore={setEditing} />
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

      {/* 計數 + 新增 */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-text-dim text-xs">
          {error ? <span className="text-accent-red">載入失敗：{error}</span>
            : loading ? '載入中...'
            : `顯示 ${filtered.length} 台機甲${hasMore ? '（可載入更多）' : ''}`}
        </p>
        <button
          onClick={openCreate}
          className="text-xs px-3 py-1.5 bg-accent-orange text-black font-bold rounded-lg hover:opacity-90 transition-opacity"
        >
          + 新增機甲
        </button>
      </div>

      <NewItemDialog
        creating={creating}
        newId={newId}
        newIdError={newIdError}
        placeholder="輸入機甲名稱，如：莫比烏斯X"
        hint={<>輸入新機甲<span className="text-accent-cyan">名稱</span>，文件 ID 由系統續號生成（下一號 <span className="text-accent-cyan">mech_{String(nextSeq).padStart(3, '0')}_</span>，儲存後不可更改）</>}
        onChangeId={(v) => { setNewId(v); setNewIdError('') }}
        onConfirm={() => { void confirmCreateChecked() }}
        onCancel={cancelCreate}
        deriveMode
        derivedId={derivedId}
      />

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
          weapons={weapons}
          onSave={handleSave}
          onCancel={() => { draft.discard(); setEditing(null) }}
        />
      )}
    </div>
  )
}

// ─── 機甲編輯面板（分頁式完整編輯器，PLAN-028 Phase B）──────────────────────────
// PLAN-033 C-1：原 weapons（3 個槽）與 appearance（2 個 IconField）各只有 3 排上下，
// 併為單一 'gear' 分頁；同時 key → id 以對齊共用的 AdminEditTabs（C-0）。
type MechEditTab = 'basic' | 'parts' | 'modules' | 'gear'

/**
 * 分頁定義。第四個分頁的名稱依角色而異：武器槽那一區只有 OWNER 看得到（見下方
 * gear 分頁的說明），對 ADMIN 來說這頁就只剩外觀，掛著「武器槽」三個字會找不到東西。
 */
const mechEditTabs = (isOwner: boolean): AdminEditTabDef<MechEditTab>[] => [
  { id: 'basic',   label: '基本數值' },
  { id: 'parts',   label: '部件' },
  { id: 'modules', label: '模組（能力）' },
  { id: 'gear',    label: isOwner ? '武器槽・外觀' : '外觀' },
]

// 通用數字欄位：空字串視為 0，避免 NaN 寫入。
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <Field label={label}>
      <input
        type="number"
        className="input-field"
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    </Field>
  )
}

function MechEditPanel({
  mech,
  modules,
  weapons,
  onSave,
  onCancel,
}: {
  mech: Mech
  modules: Module[]
  weapons: Weapon[]
  onSave: (m: Mech) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm]   = useState<Mech>({ ...mech })
  useDraftWrite('mechs', form, (m) => m.name)   // 草稿暫存（PLAN-045）：監聽的必須是 form，不是外層的 editing
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [tab, setTab]       = useState<MechEditTab>('basic')
  const [autoFillMsg, setAutoFillMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const gameVersions = useGameVersions()
  const { userProfile } = useAuth()
  const isOwner = userProfile?.role === 'OWNER'
  const tabs = useMemo(() => mechEditTabs(isOwner), [isOwner])
  // 本機甲的圖片資料夾（public/images/mechs/{機甲名}）；供 IconPicker 預設開啟與自動帶入使用。
  const mechFolder = `mechs/${form.name}`

  useEffect(() => { setForm({ ...mech }) }, [mech])

  const availableModules = useMemo(
    () => modules.filter((m) => m.boundMechId === form.id || !m.boundMechId),
    [modules, form.id]
  )
  const mod4Options  = availableModules.filter((m) => m.slot === ModuleSlot.SLOT_4)
  const mod8Options  = availableModules.filter((m) => m.slot === ModuleSlot.SLOT_8)
  // 固定模組（moduleFixedIds）可放：一般副模組(BUILT_IN) + 本機甲的專屬模組(EXCLUSIVE)。
  // 專屬模組雖靠 boundMechId 反查顯示於前台，但仍須列在此供選取——模擬器與模組反查以 moduleFixedIds 判定搭載。
  const fixedOptions = availableModules.filter(
    (m) => m.slot === ModuleSlot.BUILT_IN || (m.slot === ModuleSlot.EXCLUSIVE && m.boundMechId === form.id)
  )
  // 本機甲已有的專屬 / 綁定模組；為 0 時代表可能是全新手建機甲，於模組分頁提示跨分頁工作流。
  const boundToThis  = useMemo(() => modules.filter((m) => m.boundMechId === form.id), [modules, form.id])
  const moduleById   = useMemo(() => new Map(modules.map((m) => [m.id, m])), [modules])
  // 專屬模組：boundMechId 指向本機甲且槽位為「機甲專屬模組」；前台以此反查歸入「專屬模組」區（此處唯讀顯示）。
  const exclusiveBound = useMemo(
    () => modules.filter((m) => m.boundMechId === form.id && m.slot === ModuleSlot.EXCLUSIVE),
    [modules, form.id],
  )

  const set = <K extends keyof Mech>(key: K, value: Mech[K]) => setForm((f) => ({ ...f, [key]: value }))

  // 依機甲名稱掃 public/images/mechs/{名稱}/，把標準檔名（torso/leftArm/rightArm/legs/portrait/half）
  // 的圖片路徑一次補進四部件與立繪。找不到資料夾或某檔則略過該項。
  async function autoFillImages() {
    const name = form.name.trim()
    if (!name) { setAutoFillMsg({ ok: false, text: '請先填寫機甲名稱' }); return }
    try {
      const manifest = await loadManifest()
      const files = manifest.folders[mechFolder]
      if (!files) {
        setAutoFillMsg({ ok: false, text: `找不到資料夾 public/images/${mechFolder}/（請確認名稱與資料夾一致，並已重跑圖檔清單）` })
        return
      }
      // 找 basename（去副檔名）等於 base 的檔；優先 .png。
      const pick = (base: string): string | undefined => {
        if (files.includes(`${base}.png`)) return `${base}.png`
        return files.find((f) => f.replace(/\.[^.]+$/, '').toLowerCase() === base.toLowerCase())
      }
      const url = (file: string) => `/images/${mechFolder}/${file}`

      const nextParts = { ...form.parts }
      const filledParts: string[] = []
      for (const pos of ['torso', 'leftArm', 'rightArm', 'legs'] as const) {
        const file = pick(pos)
        if (file) {
          nextParts[pos] = { ...(form.parts?.[pos] ?? makeDefaultPart(pos)), icon: url(file) }
          filledParts.push(PART_LABELS[pos])
        }
      }
      const portraitFile = pick('portrait')
      const halfFile     = pick('half')

      setForm((f) => ({
        ...f,
        parts: nextParts,
        portrait:     portraitFile ? url(portraitFile) : f.portrait,
        halfPortrait: halfFile     ? url(halfFile)     : f.halfPortrait,
      }))

      const extra = [portraitFile && '立繪', halfFile && '半身像'].filter(Boolean)
      if (filledParts.length === 0 && extra.length === 0) {
        setAutoFillMsg({ ok: false, text: `資料夾存在但找不到標準檔名（torso/leftArm/rightArm/legs/portrait/half）` })
      } else {
        setAutoFillMsg({ ok: true, text: `已帶入：${[...filledParts, ...extra].join('、')}（來源 ${mechFolder}）` })
      }
    } catch (e) {
      setAutoFillMsg({ ok: false, text: e instanceof Error ? e.message : '讀取圖檔清單失敗' })
    }
  }

  async function handleSubmit() {
    setSaving(true); setError(null)
    try { await onSave(form) }
    catch (e) { setError(e instanceof Error ? e.message : '儲存失敗，請重試'); setSaving(false) }
  }

  return (
    <AdminModal saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
      <h3 className="text-lg font-bold mb-3 flex items-center gap-2 shrink-0">
        <span className="text-accent-orange">⚙</span> 機甲編輯
        <span className="text-text-secondary text-sm font-normal ml-1">{form.name}</span>
        {form.manual && (
          <span className="text-[11px] px-1.5 py-0.5 rounded border border-accent-orange/40 text-accent-orange shrink-0">手動建立</span>
        )}
      </h3>

      <AdminEditTabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="overflow-y-auto flex-1 pr-1 space-y-4">
        {/* ── 基本數值 ── */}
        {tab === 'basic' && (
          <>
            <div className={`${GRID_AUTO_FIELDS} gap-3`}>
              <Field label="護甲類型 armorType">
                <select className="input-field" value={form.armorType} onChange={(e) => set('armorType', e.target.value as ArmorType)}>
                  {Object.values(ArmorType).map((t) => <option key={t} value={t}>{t}</option>)}
                  {form.armorType && !Object.values(ArmorType).includes(form.armorType as ArmorType) && (
                    <option value={form.armorType}>{form.armorType}（清單外）</option>
                  )}
                </select>
              </Field>
              <Field label="品質 quality">
                <input className="input-field" value={form.quality ?? ''} placeholder="如 S / A"
                  onChange={(e) => set('quality', e.target.value || undefined)} />
              </Field>
              <NumberField label="火力 firepower" value={form.firepower} onChange={(v) => set('firepower', v)} />
              <NumberField label="裝甲 armor" value={form.armor} onChange={(v) => set('armor', v)} />
              <NumberField label="閃避 evasion" value={form.evasion} onChange={(v) => set('evasion', v)} />
              <NumberField label="移動力 mobility" value={form.mobility} onChange={(v) => set('mobility', v)} />
              <NumberField label="重量 weight" value={form.weight} onChange={(v) => set('weight', v)} />
              <NumberField label="出力 output" value={form.output} onChange={(v) => set('output', v)} />
            </div>
            <Field label="登場版本 debutVersion">
              <select className="input-field" value={form.debutVersion ?? ''}
                onChange={(e) => set('debutVersion', e.target.value || undefined)}>
                <option value="">（未設定）</option>
                {gameVersions.map((v) => <option key={v} value={v}>{v}</option>)}
                {form.debutVersion && !gameVersions.includes(form.debutVersion) && (
                  <option value={form.debutVersion}>{form.debutVersion}（清單外）</option>
                )}
              </select>
            </Field>
            <Field label="介紹文本 lore">
              <textarea className="input-field min-h-[120px]" value={form.lore ?? ''} placeholder="機甲背景 / 故事敘述"
                onChange={(e) => set('lore', e.target.value || undefined)} />
            </Field>
          </>
        )}

        {/* ── 部件 ── */}
        {tab === 'parts' && (
          <div className="space-y-3">
            <p className="text-xs text-text-dim">各部位共通欄位為耐久 / 護甲 / 火力 / 重量 / 接口；命中僅左右臂、閃避與移動僅腿部、抗暴與出力僅軀幹。</p>
            <div className="flex items-center gap-2 flex-wrap bg-bg-dark/40 border border-border rounded-lg px-3 py-2">
              <button
                type="button"
                onClick={() => { void autoFillImages() }}
                className="text-xs px-3 py-1.5 bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/40 rounded-lg hover:bg-accent-cyan/25 transition-colors font-medium"
              >
                🔎 依機甲名稱自動帶入圖片
              </button>
              <span className="text-[11px] text-text-dim">掃 <code>public/images/{mechFolder}/</code> 的標準檔名補上各部位 icon 與立繪</span>
              {autoFillMsg && (
                <span className={`text-[11px] w-full ${autoFillMsg.ok ? 'text-accent-green' : 'text-accent-yellow'}`}>
                  {autoFillMsg.ok ? '✓ ' : '⚠ '}{autoFillMsg.text}
                </span>
              )}
            </div>
            {(['torso', 'leftArm', 'rightArm', 'legs'] as const).map((pos) => (
              <PartEditor
                key={pos}
                label={PART_LABELS[pos]}
                part={form.parts?.[pos] ?? makeDefaultPart(pos)}
                defaultFolder={mechFolder}
                weapons={weapons}
                onChange={(p) => setForm((f) => ({ ...f, parts: { ...f.parts, [pos]: p } }))}
              />
            ))}
          </div>
        )}

        {/* ── 模組（能力）引用 ── */}
        {tab === 'modules' && (
          <>
            {boundToThis.length === 0 && (
              <div className="text-xs text-accent-yellow bg-accent-yellow/10 border border-accent-yellow/25 rounded-lg px-3 py-2">
                找不到本機甲的專屬模組？機甲「能力」由模組提供，需先到「模組管理」分頁新增模組，
                並把該模組的 <code className="text-accent-cyan">boundMechId</code> 設為本機甲 ID
                （<code className="text-accent-cyan">{form.id}</code>），下方下拉才選得到。
              </div>
            )}
            <Field label="四格模組 (4mod)">
              <select className="input-field" value={form.module4Id ?? ''}
                onChange={(e) => set('module4Id', e.target.value || undefined)}>
                <option value="">（未設定）</option>
                {mod4Options.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {form.module4Id && !mod4Options.find((m) => m.id === form.module4Id) && (
                <p className="text-xs text-accent-red mt-1">⚠ 目前設定的模組 ID 不在列表中：{form.module4Id}</p>
              )}
            </Field>
            <Field label="八格模組 (8mod)">
              <select className="input-field" value={form.module8Id ?? ''}
                onChange={(e) => set('module8Id', e.target.value || undefined)}>
                <option value="">（未設定）</option>
                {mod8Options.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {form.module8Id && !mod8Options.find((m) => m.id === form.module8Id) && (
                <p className="text-xs text-accent-red mt-1">⚠ 目前設定的模組 ID 不在列表中：{form.module8Id}</p>
              )}
            </Field>
            <Field label="固定模組（副模組／專屬）">
              <div className="space-y-2">
                {(form.moduleFixedIds ?? []).map((fixedId, idx) => {
                  const mod         = fixedId ? moduleById.get(fixedId) : undefined
                  const inOptions   = fixedOptions.some((m) => m.id === fixedId)
                  const isExclusive = mod?.slot === ModuleSlot.EXCLUSIVE
                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex gap-2">
                        <select
                          value={fixedId}
                          onChange={(e) => {
                            const newIds = [...(form.moduleFixedIds ?? [])]
                            newIds[idx] = e.target.value
                            set('moduleFixedIds', newIds)
                          }}
                          className="input-field flex-1"
                        >
                          <option value="">（未設定）</option>
                          {fixedOptions.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.slot === ModuleSlot.EXCLUSIVE ? `${m.name}（專屬）` : m.name}
                            </option>
                          ))}
                          {/* 目前值不在選項中（如綁到別台機甲或查無）時，補一個顯示用選項，避免有值卻顯示「未設定」 */}
                          {fixedId && !inOptions && (
                            <option value={fixedId}>
                              {mod ? `${mod.name}（${mod.slot}）` : `${fixedId}（查無此模組）`}
                            </option>
                          )}
                        </select>
                        <button
                          onClick={() => set('moduleFixedIds', (form.moduleFixedIds ?? []).filter((_, i) => i !== idx))}
                          className="px-2 py-1 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10 text-xs shrink-0"
                        >
                          ✕
                        </button>
                      </div>
                      {isExclusive && (
                        <p className="text-xs text-accent-cyan/80">
                          ℹ 這是<strong>專屬模組</strong>（同時列於下方「專屬模組」區）。<strong>請保留在此</strong>——
                          模擬器與模組反查是以固定模組清單判定機甲搭載哪些模組；移除會導致模擬少算、反查失去關聯。
                        </p>
                      )}
                      {fixedId && !mod && (
                        <p className="text-xs text-accent-red">⚠ 查無此模組 ID：{fixedId}</p>
                      )}
                    </div>
                  )
                })}
                <button
                  onClick={() => set('moduleFixedIds', [...(form.moduleFixedIds ?? []), ''])}
                  className="text-xs text-accent-cyan hover:text-accent-cyan/80 transition-colors"
                >
                  + 新增固定模組欄位
                </button>
              </div>
            </Field>

            {/* 專屬模組：boundMechId 反查，唯讀（於「模組管理」編輯） */}
            {exclusiveBound.length > 0 && (
              <Field label="專屬模組（自動關聯 · 唯讀）">
                <p className="text-xs text-text-dim mb-2">
                  以下模組的 <code className="text-accent-cyan">boundMechId</code> 指向本機甲且槽位為「機甲專屬模組」，
                  前台會自動歸入「專屬模組」區。這些通常也會出現在上方「固定模組」清單中（那是模擬器判定搭載的依據，屬正常）。
                  此區額外顯示綁定部位並供檢視；如需編輯效果 / 綁定部位，請至「模組管理」分頁。
                </p>
                <div className="space-y-1.5">
                  {exclusiveBound.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 bg-bg-dark/50 border border-border rounded-lg px-3 py-2 text-sm">
                      <span className="text-accent-cyan font-medium">{m.name}</span>
                      {/* 用共用元件而非自己 join：① 它有 Array.isArray 防禦（Firestore 無型別，
                          舊資料曾出現純字串 boundPart，而 `字串.length > 0` 會通過守衛、`.join` 才拋錯，
                          且本專案無 ErrorBoundary → 整頁掛掉）；② 它會把 torso 映射成「軀幹」，
                          與前台一致——這裡原本直接 join 原始碼值。 */}
                      <ModuleBoundPart boundPart={m.boundPart} variant="inline" />
                      <span className="text-[11px] text-text-dim ml-auto font-mono truncate max-w-[40%]">{m.id}</span>
                    </div>
                  ))}
                </div>
              </Field>
            )}
          </>
        )}

        {/* ── 武器槽・外觀（原為兩個分頁，PLAN-033 C-1 併為一頁）── */}
        {tab === 'gear' && (
          <div className="space-y-3">
            {/* 武器槽隱藏時不畫上分隔線，否則 ADMIN 看到的是一條沒有上文的孤立橫線 */}
            <div className={`${isOwner ? 'pt-4 border-t border-border/60 ' : ''}space-y-3`}>
              <p className="text-xs text-text-dim font-medium tracking-wider uppercase">外觀 appearance</p>
              <IconField
                label="立繪 portrait"
                value={form.portrait}
                defaultFolder={mechFolder}
                placeholder="/images/mechs/{機甲名}/portrait.png"
                onChange={(v) => set('portrait', v || undefined)}
              />
              <IconField
                label="半身像 halfPortrait"
                value={form.halfPortrait}
                defaultFolder={mechFolder}
                placeholder="/images/mechs/{機甲名}/half.png"
                onChange={(v) => set('halfPortrait', v || undefined)}
              />
              <p className="text-xs text-text-dim">
                「選取圖片」預設開啟本機甲資料夾 <code>{mechFolder}</code>；也可到「部件」分頁按「自動帶入圖片」一次補齊。
                圖片無官方來源者，須自行放入 <code>public/images/mechs/</code> 後重跑圖檔清單。
              </p>
            </div>
          </div>
        )}
      </div>
    </AdminModal>
  )
}

const PART_LABELS: Record<MechPart['position'], string> = {
  torso:    '軀幹 torso',
  leftArm:  '左臂 leftArm',
  rightArm: '右臂 rightArm',
  legs:     '腿部 legs',
}

// 依 position 顯示條件式欄位的部件編輯器。
function PartEditor({ label, part, defaultFolder, weapons, onChange }: { label: string; part: MechPart; defaultFolder: string; weapons: Weapon[]; onChange: (p: MechPart) => void }) {
  const num = (k: 'durable' | 'armor' | 'firepower' | 'weight' | 'hit' | 'dodge' | 'move' | 'antiRiot' | 'output', lbl: string) => (
    <NumberField label={lbl} value={part[k] ?? 0} onChange={(v) => onChange({ ...part, [k]: v })} />
  )
  return (
    <div className="border border-border rounded-lg p-3 space-y-3">
      <div className="font-bold text-sm text-accent-cyan">{label}</div>
      <div className={`${GRID_AUTO_FIELDS} gap-3`}>
        {num('durable', '耐久 durable')}
        {num('armor', '護甲 armor')}
        {num('firepower', '火力 firepower')}
        {num('weight', '重量 weight')}
        {(part.position === 'leftArm' || part.position === 'rightArm') && num('hit', '命中 hit')}
        {part.position === 'legs' && num('dodge', '閃避 dodge')}
        {part.position === 'legs' && num('move', '移動力 move')}
        {part.position === 'torso' && num('antiRiot', '抗暴 antiRiot')}
        {part.position === 'torso' && num('output', '出力 output')}
      </div>
      {/* PLAN-052-A D-1：接口改下拉選單。手打會產生「ⅠⅠ型接口」這種 tsc 抓不到的錯字
          （實測星夜女神四格全中），而值域只有兩個值 —— 沒有理由留一個能打錯的輸入框。 */}
      <Field label="接口 interface">
        <select
          className="input-field"
          value={part.interface ?? ''}
          onChange={(e) => onChange({ ...part, interface: e.target.value as PartInterface | '' })}
        >
          <option value="">（未建檔）</option>
          {Object.values(PartInterface).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <p className="text-[11px] text-text-dim mt-1">
          留「未建檔」代表<strong className="text-text-secondary">尚未取得資料</strong>，前台會顯示「接口資料未建檔」而不是留白。
        </p>
      </Field>
      <IconField
        label={`部件圖片 icon（${part.position}）`}
        value={part.icon}
        defaultFolder={defaultFolder}
        placeholder={`/images/mechs/{機甲名}/${part.position}.png`}
        onChange={(v) => onChange({ ...part, icon: v || undefined })}
      />
      <Field label="CDN 資產名 mechaIcon（選填）">
        <input className="input-field" value={part.mechaIcon ?? ''}
          placeholder="官方 CDN waparts/ 資產名；手建可留空"
          onChange={(e) => onChange({ ...part, mechaIcon: e.target.value || undefined })} />
      </Field>
      {/* PLAN-052-A C-2：取代已刪除的 leftShoulderSlot/rightShoulderSlot/backSlot 三態欄位。
          掛在部件而非機甲頂層，因為肩槽附屬於手臂（左臂→左肩、右臂→右肩）。 */}
      <ArmamentMountEditor
        label={`固定武裝 fixedArmament（${part.position}）`}
        hint={<>焊死在這個部件上、無法更換的武裝。左臂帶左肩、右臂帶右肩——
          帕斯卡是<strong className="text-text-secondary">同一把衝擊炮掛左右兩肩</strong>，
          所以兩邊的部件各填一筆。沒有固定武裝的部件保持空白。</>}
        value={part.fixedArmament ?? []}
        weapons={weapons}
        defaultSide={part.position === 'rightArm' ? 'right' : 'left'}
        onChange={(mounts) => onChange({ ...part, fixedArmament: mounts.length ? mounts : [] })}
      />
    </div>
  )
}

