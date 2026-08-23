import { useState, useMemo } from 'react'
import type { MechForm, FormRestrict, Pilot } from '../../../types'
import { WeaponType } from '../../../types/enums'
import {
  Field, AdminModal, useNewItemCreation, NewItemDialog, useClientPaged, LoadMoreButton,
  useCascadeDelete, ConfirmDeleteDialog, DeleteButton, DraftRestoreBar,
} from './shared'
import { useDraftWrite, useDraftRestore } from '../../../hooks/useDraftAutosave'
import { updateForm, docExists } from '../../../lib/firestoreApi'
import { slugify, stripIdPrefix } from '../../../utils/idSlug'
import { useGameData } from '../../../contexts/GameDataContext'
import { RefPicker } from '../../../components/admin/RefPicker'
import { IconField } from '../../../components/admin/IconPicker'
import { ArmamentMountEditor } from '../../../components/admin/ArmamentMountEditor'

// ─── 機師形態管理（PLAN-041 Phase B）──────────────────────────────────────────
//
// 形態是 100% 手動維護的資料（官方 API 與 WIKI 都沒有）→【降低填寫摩擦是第一目標】。
// 全庫預期只有個位數筆（海莉絲 4 筆），故不做伺服器分頁，一律走 useClientPaged。

/**
 * 可被形態白名單限定的武器類型 = WeaponType **去掉「特殊」**（PLAN-040 決策九 / PLAN-041）。
 *
 * ⚠ 刻意在此就地 filter，**不複用 `COMPONENT_WEAPON_TYPES`**：那個常數的語意是
 *   「可裝元件的武器類型」，與「形態可裝備的武器類型」只是今天恰好同值。
 *   共用會讓日後任一邊變動時無聲拖動另一邊。
 * 「特殊」＝固定武裝，本來就無法更換，武器過濾器對它沒有意義。
 */
const FORM_ALLOW_TYPES = Object.values(WeaponType).filter((t) => t !== WeaponType.Special)

/** 形態名去掉尾綴的「形態／型態」，供組 ID 用：「先鋒形態」→「先鋒」。 */
const formIdSuffix = (name: string) => name.trim().replace(/[形型]態$/, '').trim()

function makeDefaultForm(id: string, name: string, pilotId: string, order: number): MechForm {
  return {
    id, name, pilotId, order,
    description: '',
    descriptionRefs: {},
    restrict: { kind: 'weaponType', allow: [] },
    grantedBuffIds: [],
    manual: true,   // 官方無此資料、純手建 → 補丁腳本應略過
  }
}

// ─── 機師選擇器 ───────────────────────────────────────────────────────────────
// 只有調構師的機甲會變形態，全部 82 名機師一起列出來只是干擾。
//
// ⚠ 但**不能只靠 class 字串**：實測有 2/82 的 class 與實際職業機制對不上
//   （瑪汀妮 class=機械師卻掛格鬥家職業單元、唐小葵掛突擊手）。因此：
//   ① 已經有形態的機師一律列出（否則資料一旦建好就會被過濾器藏起來、變成改不到的孤兒）；
//   ② 留一個「顯示全部機師」開關，讓 class 對不上的新調構師仍建得起來。
function PilotSelect({
  value,
  pilots,
  forms,
  onChange,
}: {
  value: string
  pilots: Pilot[]
  forms: MechForm[]
  onChange: (id: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const options = useMemo(() => {
    const withForms = new Set(forms.map((f) => f.pilotId))
    return pilots.filter((p) => showAll || p.class === '調構師' || withForms.has(p.id) || p.id === value)
  }, [pilots, forms, showAll, value])

  return (
    <div className="space-y-1">
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-field">
        <option value="">（請選擇機師）</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>{p.class ? `${p.name} · ${p.class}` : p.name}</option>
        ))}
      </select>
      <label className="flex items-center gap-1.5 text-[11px] text-text-dim">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-accent-pink" />
        顯示全部機師（預設只列調構師，因為只有調構師的機甲會變形態）
      </label>
    </div>
  )
}

const ACCENT_SKIN = {
  cyan:   { border: 'border-accent-cyan/40',   bg: 'bg-accent-cyan/5',   text: 'text-accent-cyan' },
  purple: { border: 'border-accent-purple/40', bg: 'bg-accent-purple/5', text: 'text-accent-purple' },
  yellow: { border: 'border-accent-yellow/40', bg: 'bg-accent-yellow/5', text: 'text-accent-yellow' },
} as const

// ─── 通用 ID 清單挑選器 ───────────────────────────────────────────────────────
// weaponIds / lockedSkillIds / grantedBuffIds 三處共用（同形制於 BackpackAdmin 的
// BackpackSkillPicker，但這裡不需要 `id@N` 等級語法，故不引 parseBuffRef）。
function IdListPicker({
  label,
  hint,
  value,
  candidates,
  onChange,
  accent = 'cyan',
}: {
  label: string
  hint?: React.ReactNode
  value: string[]
  candidates: { id: string; name: string; badge?: string }[]
  onChange: (next: string[]) => void
  accent?: 'cyan' | 'purple' | 'yellow'
}) {
  const [search, setSearch] = useState('')
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates])

  const options = useMemo(() => {
    const attached = new Set(value)
    const q = search.trim().toLowerCase()
    return candidates
      .filter((c) => !attached.has(c.id))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
      .slice(0, 50)   // 候選可達數百筆，截斷避免 select 卡頓；縮不到就用搜尋
  }, [candidates, value, search])

  // 完整 class 字串查表，**不可用 `border-${ring}/40` 這種樣板組字**——
  // Tailwind 是靜態掃描原始碼決定要產出哪些 utility，組出來的 class 不會被產生。
  const skin = ACCENT_SKIN[accent]

  return (
    <div className={`border ${skin.border} rounded-lg p-3 ${skin.bg} space-y-2.5`}>
      <span className={`text-xs ${skin.text} font-medium uppercase tracking-wider`}>{label}</span>
      {hint && <p className="text-[11px] text-text-dim leading-relaxed">{hint}</p>}

      {value.length === 0 ? (
        <p className="text-xs text-text-dim py-1">尚未挑選。</p>
      ) : (
        <div className="space-y-1.5">
          {value.map((id, idx) => {
            const doc = byId.get(id)
            return (
              <div key={`${id}-${idx}`} className="flex items-center gap-2 bg-bg-dark border border-border rounded-lg px-2.5 py-2">
                <div className="flex-1 min-w-0 truncate">
                  {/* 解析不到 = 斷鏈（目標被刪或 id 打錯）。必須顯眼——前台只會靜默少一塊 */}
                  {doc ? (
                    <span className="text-sm text-text-primary font-medium">{doc.name}</span>
                  ) : (
                    <span className="text-sm text-accent-red">⚠ 找不到此項目</span>
                  )}
                  <span className="text-[11px] text-text-dim font-mono ml-2">{id}</span>
                </div>
                <button
                  onClick={() => onChange(value.filter((_, i) => i !== idx))}
                  className="shrink-0 text-[13px] px-2 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10"
                >
                  移除
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋名稱或 ID…"
          className="flex-1 px-2.5 py-1.5 rounded-lg bg-bg-dark border border-border text-text-primary text-xs focus:outline-none focus:border-accent-orange"
        />
        <div className="w-56 shrink-0">
          {/* 固定寬容器：`.input-field` 是無 layer 的 width:100% 規則，會壓過 Tailwind 的寬度 utility */}
          <select
            value=""
            onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]) }}
            className="input-field py-1.5 text-xs"
          >
            <option value="">＋ 加入…（{options.length}）</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>{c.badge ? `${c.badge} ${c.name}` : c.name}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}

// ─── 形態編輯面板 ─────────────────────────────────────────────────────────────
function FormEditPanel({
  form: initial,
  onSave,
  onCancel,
}: {
  form: MechForm
  onSave: (f: MechForm) => Promise<void>
  onCancel: () => void
}) {
  const gd = useGameData()
  const [form, setForm] = useState<MechForm>({ ...initial })
  useDraftWrite('forms', form, (f) => f.name)   // 草稿暫存（PLAN-045）：監聽 form 而非外層 editing
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  // 刻意**沒有** `useEffect(() => setForm(initial), [initial])`：換編輯對象時由呼叫端
  // 以 `key={editing.id}` 重新掛載本元件來重設 state。同樣的效果、少一輪串聯 render，
  // 也避開 react-hooks/set-state-in-effect。（其餘 Admin 分頁沿用舊寫法，尚未一併改。）
  function update<K extends keyof MechForm>(key: K, value: MechForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  /**
   * 切換 restrict 的 kind。
   * **一律整支換掉、不合併舊欄位**——union 的兩支欄位不同，殘留的 allow 會跟著
   * fixedArmament 一起被寫進 Firestore，成為讀取端 discriminant 之外的幽靈資料。
   */
  function switchKind(kind: FormRestrict['kind']) {
    update('restrict', kind === 'weaponType'
      ? { kind: 'weaponType', allow: [] }
      : { kind: 'fixedArmament', mounts: [] })
  }

  function toggleAllow(t: WeaponType) {
    if (form.restrict.kind !== 'weaponType') return
    const allow = form.restrict.allow
    update('restrict', {
      kind: 'weaponType',
      allow: allow.includes(t) ? allow.filter((x) => x !== t) : [...allow, t],
    })
  }

  async function handleSubmit() {
    if (!form.pilotId) { setError('請先選擇所屬機師'); return }
    setSaving(true); setError(null)
    try { await onSave(form) }
    catch (e) { setError(e instanceof Error ? e.message : '儲存失敗，請重試'); setSaving(false) }
  }

  // 固定武裝候選：isFixedArmament 的排前面並加鎖頭標記——全庫 180+ 把武器裡只有 6 把
  // 是固定武裝，不標的話等於要維護者自己記得哪幾把。
  // 先取成 const 再用：union 的窄化在 callback 內不保證存活，靠 `form.restrict.weaponIds`
  // 直接寫進 onChange 會被 TS 視為可能是 weaponType 分支。
  const fixed = form.restrict.kind === 'fixedArmament' ? form.restrict : null
  const allowed = form.restrict.kind === 'weaponType' ? form.restrict.allow : null

  return (
    <AdminModal maxWidth="max-w-3xl" saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2 shrink-0">
        <span className="text-accent-pink">◆</span>
        編輯形態
        <span className="text-text-dim text-sm font-normal ml-1">{form.id}</span>
      </h3>

      <div className="overflow-y-auto flex-1 pr-1 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="所屬機師（必填）">
            <PilotSelect value={form.pilotId} pilots={gd.pilots} forms={gd.forms} onChange={(id) => update('pilotId', id)} />
          </Field>
          <Field label="形態名稱（用「形」態，不用「型」態）">
            <input value={form.name} onChange={(e) => update('name', e.target.value)} className="input-field" placeholder="如：先鋒形態" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="顯示順序（數字小的排前面）">
            <input
              type="number"
              value={form.order}
              onChange={(e) => update('order', Number(e.target.value) || 0)}
              className="input-field"
            />
            {/* PLAN-052-A C-3：分享碼的形態身分用 formId，不是 order。
                沒有這行提醒的話，後台一次重排就會讓所有既存分享碼靜默指向另一個形態。 */}
            <p className="text-[11px] text-text-dim mt-1 leading-relaxed">
              ⚠ 此欄位<strong className="text-text-secondary">只影響顯示順序，不是識別碼</strong>——
              配裝分頁與分享碼認的是形態 ID，重排順序不會影響既有的分享連結。
            </p>
          </Field>
          <Field label="天賦專屬形態">
            <label className="flex items-center gap-2 text-sm text-text-secondary h-[38px]">
              <input
                type="checkbox"
                checked={!!form.isSignature}
                onChange={(e) => update('isSignature', e.target.checked || undefined)}
                className="accent-accent-pink"
              />
              前台會加上 ★ 與金框，與一般戰鬥形態分開顯示
            </label>
          </Field>
        </div>

        <Field label="獨立配裝">
          <label className="flex items-start gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={!!form.independentLoadout}
              onChange={(e) => update('independentLoadout', e.target.checked || undefined)}
              className="accent-accent-pink mt-1"
            />
            <span>
              這個形態有自己獨立的一套武器背包（模擬器會為它開一個配裝分頁）。
              {/* 不用 derive 取代：今天「weaponType 形態數」恰好給出正確答案，但那是巧合——
                  曜有一個 weaponType 形態卻共用同一套配裝，derive 會多開一個分頁且沒有任何錯誤。 */}
              <span className="block text-[11px] text-text-dim mt-1 leading-relaxed">
                海莉絲的先鋒／突擊／戰術要勾；曜的兩個形態不勾（共用同一套）。
                <strong className="text-text-secondary">武裝焊死的形態不需要勾</strong>——那種形態沒有東西可配。
              </span>
            </span>
          </label>
        </Field>

        <IconField
          label="形態圖示（選填）"
          value={form.icon}
          onChange={(v) => update('icon', v || undefined)}
        />

        <Field label="形態固有效果（照抄遊戲內形態卡正文。前台形態卡顯示的就是這段字）">
          <textarea
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            className="input-field min-h-[120px] resize-y text-sm leading-relaxed"
            placeholder="機甲移動力+1，使用[格鬥]和[射擊]武器主動攻擊時傷害和暴擊率提升15%"
          />
        </Field>

        <RefPicker
          text={form.description}
          value={form.descriptionRefs}
          onChange={(refs) => update('descriptionRefs', refs)}
          onCompileText={(tf) => update('description', tf(form.description))}
        />

        {/* ── 裝備限制（discriminated union）───────────────────────────────── */}
        <div className="border border-accent-pink/40 rounded-lg p-3 bg-accent-pink/5 space-y-2.5">
          <span className="text-xs text-accent-pink font-medium uppercase tracking-wider">這個形態能裝什麼武器</span>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={form.restrict.kind === 'weaponType'} onChange={() => switchKind('weaponType')} className="accent-accent-pink" />
              可自由換裝，但限定武器類型
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={form.restrict.kind === 'fixedArmament'} onChange={() => switchKind('fixedArmament')} className="accent-accent-pink" />
              完全不能換裝（武器焊死）
            </label>
          </div>

          {allowed ? (
            <div>
              <p className="text-[11px] text-text-dim mb-1.5">
                勾選這個形態下可以裝備的武器類型。沒有「特殊」是故意的——那類是焊死在機體上的固定武裝，本來就換不掉，拿類型過濾它沒有意義。
              </p>
              <div className="flex flex-wrap gap-3">
                {FORM_ALLOW_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-sm text-text-secondary">
                    <input
                      type="checkbox"
                      checked={allowed.includes(t)}
                      onChange={() => toggleAllow(t)}
                      className="accent-accent-pink"
                    />
                    {t}
                  </label>
                ))}
              </div>
            </div>
          ) : fixed ? (
            <div className="space-y-2.5">
              <p className="text-[11px] text-text-dim leading-relaxed">
                <strong className="text-accent-yellow">這個形態下所有槽位都不能動</strong>——雙手、雙肩、背部一律鎖住，
                不是只有下面列出的武器那幾格。遊戲裡雙肩雖然顯示成空的 [+]，但點不下去。
              </p>
              <ArmamentMountEditor
                label="焊死在機體上的武裝"
                hint={<>🔒 標記＝無法更換也不能裝元件的固定武裝，已排在候選最前面。槽位由武器自己的
                  equipSlot 決定、不可手改（硬不變式），只有左右側需要選——耀星在右手、隕星在左手、千星在背部。</>}
                value={fixed.mounts}
                weapons={gd.weapons}
                onChange={(mounts) => update('restrict', { ...fixed, mounts })}
              />
              {/* 「被鎖住的技能」不另設欄位：正文裡的 [虛粒子刃] 這類引用已完整表達，
                  再存一份 id 清單只會變成第二個真相源。詳見 types/form.ts 的註解。 */}
            </div>
          ) : null}
        </div>

        <IdListPicker
          label="額外的形態增益（來自天賦，非形態本身）"
          hint={<>掛「[型態增益]」這類由天賦滿星另外給的一次性增益（正文通常寫「觸發效果後移除」）。形態自己永遠生效的效果請寫在上方「形態固有效果」，兩者在前台會分兩段標明來源，不合併。</>}
          value={form.grantedBuffIds ?? []}
          candidates={gd.buffs.map((b) => ({ id: b.id, name: b.name }))}
          onChange={(ids) => update('grantedBuffIds', ids)}
        />

        <Field label="怎麼進入／退出這個形態（選填，照抄遊戲正文）">
          <textarea
            value={form.entryNote ?? ''}
            onChange={(e) => update('entryNote', e.target.value || undefined)}
            className="input-field min-h-[70px] resize-y text-sm leading-relaxed"
            placeholder="如：消耗所有[激發能]切換為此形態，持續 3 回合"
          />
        </Field>
      </div>
    </AdminModal>
  )
}

// ─── 形態管理列表 ─────────────────────────────────────────────────────────────
export default function FormAdmin({ initialSearch = '' }: { initialSearch?: string }) {
  const gd = useGameData()
  const [editing, setEditing] = useState<MechForm | null>(null)
  const [newPilotId, setNewPilotId] = useState('')
  const draft = useDraftRestore<MechForm>('forms')
  const del = useCascadeDelete('form', 'forms')

  const pilotName = useMemo(
    () => new Map(gd.pilots.map((p) => [p.id, p.name])),
    [gd.pilots],
  )

  const {
    items: filtered, loading, error, hasMore, search, setSearch,
    submitSearch, loadMore, upsert,
  } = useClientPaged<MechForm, Record<string, never>>({
    source: gd.forms,
    initialSearch,
    initialFilters: {},
    matchFilters: () => true,
  })

  // ID 慣例：`form_<機師名>_<形態名去掉「形態」尾綴>`，如 form_海莉絲_先鋒。
  // 與其他集合的 `<prefix>_<slug(name)>` 不同——形態名（先鋒／突擊…）在不同調構師之間
  // 必然重複，只用名稱會直接撞 ID。
  // ⚠ **不可用 makeEntityId('form', `${機師}_${形態}`)**：它內部會 slugify 整個字串，
  //   而 slugify 的保留字元不含底線（0x5F 不在 CJK／英數／全形區間內）→ 分隔符被吃掉，
  //   生出 `form_海莉絲先鋒` 而不是 `form_海莉絲_先鋒`。兩段各自 slugify 再自行組裝。
  const deriveId = (name: string) => {
    const pn = slugify(pilotName.get(newPilotId) ?? '')
    const suffix = slugify(formIdSuffix(stripIdPrefix('form', name)))
    return pn && suffix ? `form_${pn}_${suffix}` : ''
  }

  const { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate, derivedId } =
    useNewItemCreation(
      gd.forms,
      (f) => f.id,
      (id, name) => makeDefaultForm(
        id,
        stripIdPrefix('form', name),
        newPilotId,
        gd.forms.filter((f) => f.pilotId === newPilotId).length + 1,   // order 預設接在該機師既有形態之後
      ),
      deriveId,
      (f) => f.name,
    )

  async function confirmCreateChecked() {
    if (!newPilotId) { setNewIdError('請先選擇所屬機師（ID 需要機師名）'); return }
    const id = deriveId(newId)
    if (!id) { setNewIdError('名稱無法產生有效 ID，請改用其他名稱'); return }
    // 伺服器端撞 ID 檢查：涵蓋不在記憶體中的文件
    if (await docExists('forms', id)) {
      setNewIdError(`已有同名形態（ID：${id}），請改名或編輯既有項目`)
      return
    }
    const item = confirmCreate()
    if (item) setEditing(item)
  }

  async function handleSave(updated: MechForm) {
    // 2026-08-12：restrict.lockedSkillIds 已從資料模型移除。從 Firestore 讀回的舊文件仍可能
    // 帶著它（型別看不到、但 `{...doc}` 會原樣帶進來再被 setDoc 寫回去），故存檔前顯式清掉。
    // 全庫確認無殘留後這段可刪。
    if (updated.restrict?.kind === 'fixedArmament') {
      delete (updated.restrict as { lockedSkillIds?: unknown }).lockedSkillIds
    }
    const version = await updateForm(updated)   // 內部走 saveWithHistory → 記錄變更歷史並 bump 版本
    upsert(updated)
    gd.patchCollectionItem('forms', updated, version)
    draft.commit()
    setEditing(null)
  }

  const restrictLabel = (f: MechForm) =>
    f.restrict?.kind === 'fixedArmament'
      ? `固定武裝 ${f.restrict.mounts.length}`
      : `限 ${(f.restrict?.allow ?? []).join('・') || '未設定'}`

  return (
    <div>
      <DraftRestoreBar draft={draft} onRestore={setEditing} />

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

      <div className="flex items-center justify-between mb-3">
        <p className="text-text-dim text-xs">
          {error ? <span className="text-accent-red">載入失敗：{error}</span>
            : loading ? '載入中...'
            : `顯示 ${filtered.length} 個形態${hasMore ? '（可載入更多）' : ''}`}
        </p>
        <button
          onClick={() => { setNewPilotId(''); openCreate() }}
          className="text-xs px-3 py-1.5 bg-accent-orange text-black font-bold rounded-lg hover:opacity-90 transition-opacity"
        >
          + 新增形態
        </button>
      </div>

      <NewItemDialog
        creating={creating}
        newId={newId}
        newIdError={newIdError}
        placeholder="輸入形態名稱，如：先鋒形態"
        hint={<>先選機師再輸入形態名稱，系統自動生成文件 ID（格式 <span className="text-accent-cyan">form_機師名_形態名</span>）</>}
        onChangeId={(v) => { setNewId(v); setNewIdError('') }}
        onConfirm={() => { void confirmCreateChecked() }}
        onCancel={cancelCreate}
        deriveMode
        derivedId={derivedId}
        extra={
          <PilotSelect
            value={newPilotId}
            pilots={gd.pilots}
            forms={gd.forms}
            onChange={(id) => { setNewPilotId(id); setNewIdError('') }}
          />
        }
      />

      {!del.plan && del.error && (
        <p className="text-accent-red text-xs mb-2">⚠ 無法讀取刪除影響範圍：{del.error}</p>
      )}

      <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
        {filtered.map((f) => (
          <div
            key={f.id}
            className="bg-bg-dark border border-accent-pink/20 rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-border-accent transition-colors cursor-pointer"
            onClick={() => setEditing(f)}
          >
            <span className="text-xs text-text-dim font-mono shrink-0 w-6 text-center">{f.order}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {f.isSignature && <span className="text-accent-yellow shrink-0">★</span>}
                <span className="font-bold text-sm text-text-primary truncate">
                  {f.name || <span className="text-text-dim font-normal">（未命名）</span>}
                </span>
                <span className="text-[13px] px-1.5 py-0.5 rounded border border-accent-pink/30 bg-accent-pink/10 text-accent-pink shrink-0">
                  {pilotName.get(f.pilotId) ?? <span className="text-accent-red">⚠ 機師不存在</span>}
                </span>
                <span className="text-[12px] text-text-dim shrink-0">{restrictLabel(f)}</span>
                {(f.grantedBuffIds?.length ?? 0) > 0 && (
                  <span className="text-[12px] text-text-dim shrink-0">增益 {f.grantedBuffIds!.length}</span>
                )}
              </div>
              <p className="text-[13px] text-text-secondary truncate mt-0.5">{f.description || '（無正文）'}</p>
            </div>
            <DeleteButton onAsk={() => void del.ask(f.id)} busy={del.asking === f.id} />
          </div>
        ))}
        {filtered.length === 0 && !loading && (
          <p className="text-text-dim text-sm text-center py-8">找不到符合條件的形態</p>
        )}
      </div>

      <LoadMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />

      {/* key={id}：換編輯對象＝重新掛載面板，取代「useEffect 同步 props → state」的舊寫法 */}
      {editing && (
        <FormEditPanel
          key={editing.id}
          form={editing}
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
