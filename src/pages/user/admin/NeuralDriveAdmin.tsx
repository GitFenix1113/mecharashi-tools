import { useState, useEffect, useMemo } from 'react'
import type { NeuralDriveAbility, SkillEffect, Pilot } from '../../../types'
import { Field, AdminModal, useNewItemCreation, NewItemDialog, useClientPaged, LoadMoreButton, DraftRestoreBar } from './shared'
import { useDraftWrite, useDraftRestore } from '../../../hooks/useDraftAutosave'
import { updateNeuralDriveAbility, docExists } from '../../../lib/firestoreApi'
import { makeEntityId, stripIdPrefix } from '../../../utils/idSlug'
import { useGameData } from '../../../contexts/GameDataContext'
import { RefPicker } from '../../../components/admin/RefPicker'
import { IconField } from '../../../components/admin/IconPicker'
import { SkillEffectItem } from './PilotAdmin'
import { parseBuffRef, formatBuffRef } from '../../../utils/buffRef'
import { isSelfBuff, pickLevel } from '../../../utils/ndOverrides'
import { findBuffLevelRefs } from '../../../utils/buffLevelRefs'
import { useRefScanData } from '../../../hooks/useRefScanData'

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

// ─── buffUpgrades 編輯器（PLAN-034 E-1）────────────────────────────────────────
//
// **必須是下拉，不能是 textarea。** 現況 buffIds 只 split+trim，不驗證 id 存在／級範圍／
// 分隔符字形——這三種錯誤的表現形式都是「畫面沒有變化」，與「還沒填」完全不可區分。
// 而 buffUpgrades 錯了更難察覺：覆寫層的降級是靜默的（整族不進表），使用者只會覺得
// 「點算力沒反應」，不會有任何錯誤訊息。
//
// **與 buffIds 分開的獨立元件**：賦予 vs 升階語意不同，共用一個欄位必然貼錯。
function BuffUpgradesField({
  value,
  onChange,
}: {
  value: string[] | undefined
  onChange: (next: string[] | undefined) => void
}) {
  const gd = useGameData()
  const { data: scanData, missingColls } = useRefScanData()

  // 可選目標：有 levels[] **且為自身增益**。debuff / control 一律不列——
  // 覆寫粒度是「家族 × 整頁」，分不清敵我，列出來就是給人踩（決策五第四條）。
  const candidates = useMemo(
    () => gd.buffs
      .filter((b) => (b.levels?.length ?? 0) > 0 && isSelfBuff(b))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')),
    [gd.buffs],
  )

  const entries = value ?? []
  const setAt = (i: number, next: string) => {
    const arr = [...entries]; arr[i] = next; onChange(arr)
  }
  const removeAt = (i: number) => {
    const arr = entries.filter((_, idx) => idx !== i)
    onChange(arr.length ? arr : undefined)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[13px] text-text-dim font-medium uppercase tracking-wider">
          升階 buffUpgrades（選填）
        </span>
        <button
          type="button"
          onClick={() => onChange([...entries, ''])}
          className="text-[13px] text-accent-cyan hover:text-accent-cyan/80 transition-colors"
        >
          + 新增升階
        </button>
      </div>

      <p className="text-[11px] text-text-dim leading-relaxed mb-2">
        語意是「<b className="text-text-secondary">升階</b>」而非「賦予」：本能力生效時，該 buff 家族在
        <b className="text-text-secondary">該機師頁</b>的生效階至少為 N。門檻＝本能力被掛在哪一級的 minSum，不另外填。
        <br />
        <span className="text-accent-yellow">
          ⚠ 只能選<b>既有</b>等級，不可為了讓這裡能用而在共享 buffs 集合裡憑空造級；
          通用能力（跨多位機師共享者）請勿填——一填就改寫所有掛載機師的頁面。
        </span>
      </p>

      {entries.length === 0 ? (
        <p className="text-xs text-text-dim py-1.5 text-center">未設定（此能力不改寫任何 buff 的階）</p>
      ) : (
        <div className="space-y-2">
          {entries.map((raw, i) => {
            const { buffId, level } = parseBuffRef(raw)
            const buff = gd.buffs.find((b) => b.id === buffId)
            const lv = buff ? pickLevel(buff.levels, level) : undefined
            const refCount = buff && level != null ? findBuffLevelRefs(buff.id, level, scanData).length : 0

            return (
              <div key={i} className="p-2 bg-bg-card/40 rounded border border-border/40 space-y-1.5">
                {/* flex-wrap + basis：視窗窄時「階」下拉整組換行，而不是把 buff 下拉擠成一個箭頭。
                    選項字面本來就長（遭受傷害降低（buff_遭受傷害降低）），單行硬塞必然壓垮其中一個。 */}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={buffId}
                    onChange={(e) => setAt(i, formatBuffRef(e.target.value, undefined))}
                    className="input-field flex-1 basis-[18rem] min-w-0"
                  >
                    <option value="">— 選擇目標 buff（僅列有等級的自身增益）—</option>
                    {candidates.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}（{b.id}）</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2 flex-1 basis-[12rem] min-w-0">
                    <select
                      value={level ?? ''}
                      onChange={(e) => setAt(i, formatBuffRef(buffId, e.target.value === '' ? undefined : Number(e.target.value)))}
                      disabled={!buff}
                      className="input-field flex-1 min-w-0 disabled:opacity-40"
                    >
                      <option value="">— 階 —</option>
                      {(buff?.levels ?? []).map((l) => (
                        <option key={l.level} value={l.level}>
                          Lv{l.level}{l.name ? `（${l.name}）` : '（未填階名）'}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeAt(i)}
                      className="shrink-0 text-[13px] px-1.5 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* 即時回饋：選完就看得到「這一階是什麼、會影響多少地方」 */}
                {!buffId ? (
                  <p className="text-[11px] text-accent-yellow">尚未選擇目標，此筆會被忽略。</p>
                ) : !buff ? (
                  <p className="text-[11px] text-accent-red">查無 {buffId}（buffs 未載入或已被刪除）。</p>
                ) : level == null ? (
                  <p className="text-[11px] text-accent-yellow">尚未選階：沒有 @N 的元素會讓整族不進覆寫表。</p>
                ) : !lv ? (
                  <p className="text-[11px] text-accent-red">{buff.name} 沒有第 {level} 級。</p>
                ) : (
                  <p className="text-[11px] text-text-dim">
                    <span className="text-accent-cyan">Lv{lv.level}</span>
                    {lv.maxStack != null && <>（最大疊加 {lv.maxStack}）</>}
                    {' · '}
                    影響 <span className="text-accent-cyan">{refCount}</span> 處指向該級的引用
                    {missingColls.length > 0 && (
                      <span className="text-accent-yellow">（未完整掃描，缺 {missingColls.join('、')}）</span>
                    )}
                    {!lv.name && (
                      <span className="text-accent-red"> · 該級未填階名 → 建表閘門③會讓整族退場，請先到 BUFF 管理補上</span>
                    )}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── 掛載明細（usageCount 徽章展開）──────────────────────────────────────────
interface MountInfo { pilotName: string; zone: string; level: number; minSum: number }

function collectMounts(pilots: Pilot[], abilityId: string): MountInfo[] {
  const out: MountInfo[] = []
  for (const p of pilots) {
    for (const z of p.neuralDrive ?? []) {
      for (const lv of z.levels ?? []) {
        if (lv.abilityId === abilityId) {
          out.push({ pilotName: p.name, zone: z.name, level: lv.level, minSum: lv.minSum ?? 0 })
        }
      }
    }
  }
  return out
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
  useDraftWrite('neuralDriveAbilities', form, (a) => a.name)   // 草稿暫存（PLAN-045）：監聽的必須是 form，不是外層的 editing
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [mountsOpen, setMountsOpen] = useState(false)
  const gd = useGameData()

  useEffect(() => { setForm({ ...ability }) }, [ability])

  // 同一份 ability 掛在不同機師身上，門檻可能完全不同（minSum 存在 pilots 文件）。
  // 這件事在全域集合頁上完全看不到，卻決定了「這條升階何時生效」。
  const mounts = useMemo(() => collectMounts(gd.pilots, ability.id), [gd.pilots, ability.id])
  const pilotCount = useMemo(() => new Set(mounts.map((m) => m.pilotName)).size, [mounts])

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

  // 原本是 max-w-2xl（PLAN-033「欄位少 → 維持窄版」）。PLAN-034 加進升階編輯器後
  // 那個寬度已經不夠：一列要塞「目標 buff 下拉 + 階下拉 + 移除鈕」，而選項字面很長
  // （遭受傷害降低（buff_遭受傷害降低）），2xl 會把 buff 下拉擠成只剩一個箭頭。
  return (
    <AdminModal maxWidth="max-w-4xl" saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
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
          <p className="text-[11px] text-text-dim mt-1">
            「<b className="text-text-secondary">賦予</b>」：本能力讓機師獲得這些 buff，會進模擬器的 buff 池。
            要改變<b className="text-text-secondary">既有 buff 的階</b>請用下方的升階欄位。
          </p>
        </Field>

        {/* 掛載明細：門檻住在 pilots 文件，在這個全域集合頁上原本完全看不到 */}
        <div className={`rounded-lg border px-3 py-2 ${
          pilotCount >= 2 ? 'border-accent-yellow/40 bg-accent-yellow/[0.07]' : 'border-border bg-bg-dark/40'
        }`}>
          <button
            type="button"
            onClick={() => setMountsOpen((o) => !o)}
            className="w-full flex items-center gap-2 text-left cursor-pointer"
          >
            <span className="text-[13px] text-text-dim">{mountsOpen ? '▼' : '▶'}</span>
            <span className={`text-[12px] font-bold ${pilotCount >= 2 ? 'text-accent-yellow' : 'text-text-secondary'}`}>
              掛載於 {pilotCount} 位機師 · {mounts.length} 個等級
            </span>
            {pilotCount >= 2 && (form.buffUpgrades?.length ?? 0) > 0 && (
              <span className="text-[11px] text-accent-yellow">⚠ 跨機師共享能力上的升階會改寫所有掛載機師的頁面</span>
            )}
          </button>
          {mountsOpen && (
            mounts.length === 0 ? (
              <p className="text-[11px] text-text-dim mt-1.5">尚無任何機師掛載此能力（孤兒能力，填了升階也不會生效）。</p>
            ) : (
              <ul className="mt-1.5 space-y-0.5">
                {mounts.map((m, i) => (
                  <li key={i} className="text-[11px] text-text-secondary font-mono">
                    {m.pilotName} · {m.zone} Lv{m.level} · minSum={' '}
                    <span className={m.minSum <= 0 ? 'text-accent-red' : ''}>{m.minSum}</span>
                    {m.minSum <= 0 && <span className="text-accent-red"> ← 未設定門檻，此處的升階不會生效</span>}
                  </li>
                ))}
              </ul>
            )
          )}
        </div>

        <BuffUpgradesField
          value={form.buffUpgrades}
          onChange={(next) => update('buffUpgrades', next)}
        />
      </div>
    </AdminModal>
  )
}

// ─── 神驅能力庫管理列表 ──────────────────────────────────────────────────────────
export default function NeuralDriveAdmin({ initialSearch = '' }: { initialSearch?: string }) {
  const [editing, setEditing] = useState<NeuralDriveAbility | null>(null)
  const draft = useDraftRestore<NeuralDriveAbility>('neuralDriveAbilities')
  const gd = useGameData()
  // buffUpgrades 編輯器要列「有等級的自身增益」並反查引用數，兩者都需要 buffs；
  // pilots 供掛載明細（門檻 minSum 住在那裡）。
  useEffect(() => { gd.ensureLoaded(['buffs', 'pilots']) }, [gd])

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
      (a) => a.name,                                          // 名稱撞名：ID 可能因改名而與 name 脫鉤
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
                  {(a.buffUpgrades?.length ?? 0) > 0 && (
                    <span className="text-[12px] px-1.5 py-0.5 rounded border border-accent-pink/40 bg-accent-pink/10 text-accent-pink shrink-0">
                      升階 {a.buffUpgrades!.length}
                    </span>
                  )}
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
          onCancel={() => { draft.discard(); setEditing(null) }}
        />
      )}
    </div>
  )
}
