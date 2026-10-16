import { useEffect, useMemo, useState } from 'react'
import type { MechMaker } from '../../../types'
import { useGameData } from '../../../contexts/GameDataContext'
import { updateMechMaker } from '../../../lib/firestoreApi'
import { FactionLogo } from '../../icons/FactionLogo'
import { FactionLogoPicker } from '../FactionLogoPicker'
import { byMakerOrder } from '../../lore/mechRoster'
import { makerStageArt } from '../../../utils/gameArt'
import { assetUrl } from '../../../utils/assets'
import { GAME_MAKER_STAGES } from '../../../data/gameArtIndex'

// ─── 故事館編輯台「機甲廠商」分頁（PLAN-042-B G-2，決策 B-8）────────────────────────
//
// mechMakers 的增修：中英文名、徽章、舞台背景、型號前綴、排序、備註。做法比照「陣營徽章」分頁（FactionEmblemsEditor）：
// 一家一列、各自存檔；寫入是 writeDoc＋bump（**不走 saveWithHistory**、不進 SPECS，理由見 lib/api/mechMakers.ts）。
//
// ⚠ 文件 ID＝官方舞台背景鍵（Doll、UKB…），**建立後不能改**：每台機甲的 mechLore.maker 存的就是它。
//   新增的廠商若沒有自己的舞台背景，在「舞台背景」選一張沿用（存在 stage 欄位）。
// ⚠ 沒有刪除：被機甲引用中的廠商刪掉，名冊就會整組掉進「廠商未載」。不用的廠商把排序往後調即可。
// ⚠ 讀不到既有資料時不開放編輯：存檔是整份覆寫，會把別人填過的欄位洗掉。

const PAPER = 'bg-[#efe7d8] text-[#2b2621]'
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/

export function MechMakersEditor() {
  const gd = useGameData()
  const { ensureLoaded } = gd
  useEffect(() => { void ensureLoaded(['mechMakers', 'mechLore', 'mechs']) }, [ensureLoaded])

  const loadError = gd.errorMap['mechMakers'] ?? gd.errorMap['mechLore'] ?? null
  const loaded = gd.loadedKeys.has('mechMakers') && gd.loadedKeys.has('mechLore')

  // 還沒存的新廠商（存檔後就會出現在 gd.mechMakers，從這裡拿掉）
  const [fresh, setFresh] = useState<string[]>([])
  const [newId, setNewId] = useState('')
  const [newError, setNewError] = useState<string | null>(null)

  const makers = useMemo(() => [...gd.mechMakers].sort(byMakerOrder), [gd.mechMakers])
  const known = useMemo(() => new Set(gd.mechMakers.map((m) => m.id.toLowerCase())), [gd.mechMakers])
  const pending = fresh.filter((id) => !known.has(id.toLowerCase()))
  // 每家被幾台機甲用（mechLore.maker）——名冊分組就是照這個
  const usage = useMemo(() => {
    const nameOf = new Map(gd.mechs.map((m) => [m.id, m.name]))
    const map = new Map<string, string[]>()
    for (const d of gd.mechLore) if (d.maker) (map.get(d.maker) ?? map.set(d.maker, []).get(d.maker)!).push(nameOf.get(d.id) ?? d.id)
    return map
  }, [gd.mechLore, gd.mechs])
  const unassigned = gd.mechs.length - [...usage.entries()].filter(([id]) => gd.mechMakers.some((m) => m.id === id)).reduce((n, [, l]) => n + l.length, 0)

  async function save(next: MechMaker) {
    const clean = normalizeMaker(next)
    const version = await updateMechMaker(clean)
    gd.patchCollectionItem('mechMakers', clean, version)
  }

  function addMaker() {
    const id = newId.trim()
    if (!ID_RE.test(id)) { setNewError('ID 只能用英文字母開頭的英數字、底線、連字號（例：Doll、NewCorp）'); return }
    if (known.has(id.toLowerCase()) || fresh.some((f) => f.toLowerCase() === id.toLowerCase())) { setNewError(`已經有 ${id} 了`); return }
    setFresh((f) => [...f, id])
    setNewId('')
    setNewError(null)
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-accent-red/40 bg-accent-red/10 px-4 py-3">
        <p className="text-accent-red text-sm font-bold">⚠ 機甲廠商載入失敗</p>
        <p className="text-text-secondary text-xs mt-1 break-all">{loadError.message}</p>
        <p className="text-text-dim text-xs mt-2">存檔是整份覆寫，讀不到既有內容時不開放編輯。</p>
      </div>
    )
  }
  if (!loaded) return <p className="text-text-dim text-sm text-center py-10">載入中...</p>

  return (
    <div>
      <p className="text-text-dim text-xs leading-relaxed mb-3">
        機甲故事館依廠商分組名冊、卷宗標題列出廠商、鑑賞模式用廠商舞台當背景。每台機甲屬於哪家在「機甲」分頁的扉頁選；
        這裡管廠商本身。<b className="text-text-secondary">排序</b>小的在前（名冊與館首頁的分組順序），沒填的排在最後。
        <b className="text-text-secondary">型號前綴</b>只用來在機甲扉頁「建議」廠商，不會自動指派。
      </p>

      <div className="grid grid-cols-3 gap-2 mb-3 max-w-md">
        <Stat label="廠商" value={`${makers.length} 家`} />
        <Stat label="有機甲的" value={`${makers.filter((m) => usage.has(m.id)).length} 家`} />
        <Stat label="廠商未載" value={`${unassigned} 台`} />
      </div>

      <div className="space-y-2">
        {makers.map((m) => (
          <MakerRow key={`${m.id}:${JSON.stringify(m)}`} maker={m} isNew={false} users={usage.get(m.id) ?? []} onSave={save} />
        ))}
        {pending.map((id) => (
          <MakerRow key={`new:${id}`} maker={{ id }} isNew users={[]} onSave={save} onDiscard={() => setFresh((f) => f.filter((x) => x !== id))} />
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-dashed border-border p-3">
        <div className="text-[13px] text-text-secondary font-medium mb-1">新增廠商</div>
        <p className="text-[11px] text-text-dim mb-2">
          ID 建立後不能改（機甲存的是它）。有官方舞台背景的用背景檔名的那段（Skynet_Wap_BG_<b>Doll</b>_Raw → Doll）。
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={newId}
            onChange={(e) => { setNewId(e.target.value); setNewError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') addMaker() }}
            className="input-field text-sm w-48 font-mono"
            placeholder="例：NewCorp"
          />
          <button type="button" onClick={addMaker} disabled={!newId.trim()} className="text-xs px-3 py-1.5 rounded-lg border border-accent-cyan/50 text-accent-cyan hover:bg-accent-cyan/10 transition-colors disabled:opacity-40">
            ＋ 新增一列
          </button>
          {newError && <span className="text-[11px] text-accent-red">{newError}</span>}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-2">
      <div className="text-[11px] text-text-dim">{label}</div>
      <div className="text-sm font-bold text-text-primary">{value}</div>
    </div>
  )
}

/** 一家一列。表單狀態留在列內，key 帶著 DB 內容——存檔後列會用新值重建 */
function MakerRow({ maker, isNew, users, onSave, onDiscard }: {
  maker: MechMaker
  isNew: boolean
  users: string[]
  onSave: (next: MechMaker) => Promise<void>
  onDiscard?: () => void
}) {
  const [form, setForm] = useState<MechMaker>(() => ({ ...maker, modelPrefixes: [...(maker.modelPrefixes ?? [])] }))
  const [prefixText, setPrefixText] = useState(() => (maker.modelPrefixes ?? []).join('、'))
  const [orderText, setOrderText] = useState(() => (maker.order === undefined ? '' : String(maker.order)))
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patch = (p: Partial<MechMaker>) => { setForm((f) => ({ ...f, ...p })); setError(null) }
  const current = (): MechMaker => ({ ...form, modelPrefixes: parsePrefixes(prefixText), order: parseOrder(orderText) })
  const dirty = isNew || JSON.stringify(normalizeMaker(current())) !== JSON.stringify(normalizeMaker(maker))
  const stage = makerStageArt(form)
  const stageKeys = [...GAME_MAKER_STAGES].sort()

  async function handleSave() {
    if (orderText.trim() && parseOrder(orderText) === undefined) { setError('排序要填數字'); return }
    setSaving(true)
    try {
      await onSave(current())
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗，請重試')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`rounded-xl border bg-bg-card p-3 flex flex-col md:flex-row gap-3 ${isNew ? 'border-accent-cyan/50' : 'border-border'}`}>
      <div className="flex items-start gap-3 md:w-64 shrink-0">
        <div className="space-y-1.5">
          <span className="block w-40 aspect-[2/1] rounded-md overflow-hidden bg-black/40" title={stage ? '舞台背景' : '沒有舞台背景'}>
            {stage
              ? <img src={assetUrl(stage)} alt="" loading="lazy" className="w-full h-full object-cover" />
              : <span className="w-full h-full grid place-items-center text-[10px] text-text-dim">沒有舞台背景</span>}
          </span>
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            className={`flex items-center gap-2 rounded-lg px-2 py-1 ${PAPER} text-[11px] hover:ring-1 hover:ring-accent-cyan/60`}
            title="選徽章"
          >
            {form.logo ? <FactionLogo logoKey={form.logo} size={28} /> : <span className="w-7 h-7 grid place-items-center text-[#b9ab92]">—</span>}
            {picking ? '收起' : form.logo ? '換徽章' : '選徽章'}
          </button>
        </div>
        <div className="min-w-0">
          <div className="font-mono text-xs text-text-dim">{maker.id}{isNew && <span className="text-accent-cyan">（新）</span>}</div>
          <div className={`text-sm font-bold truncate ${form.name?.trim() ? 'text-text-primary' : 'text-text-dim'}`}>{form.name?.trim() || '未命名'}</div>
          <div className="text-[11px] text-text-dim" title={users.join('、')}>{users.length ? `${users.length} 台機甲` : '沒有機甲'}</div>
        </div>
      </div>

      <div className="flex-1 min-w-0 grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] text-text-dim">
          中文名稱
          <input value={form.name ?? ''} onChange={(e) => patch({ name: e.target.value })} className="input-field text-sm mt-0.5" placeholder="例：多爾集團" />
        </label>
        <label className="text-[11px] text-text-dim">
          英文名稱
          <input value={form.nameEn ?? ''} onChange={(e) => patch({ nameEn: e.target.value })} className="input-field text-sm mt-0.5" placeholder="例：DOLL" />
        </label>
        <label className="text-[11px] text-text-dim">
          舞台背景（沒選＝用 ID 那張）
          <select value={form.stage ?? ''} onChange={(e) => patch({ stage: e.target.value || undefined })} className="input-field text-sm mt-0.5">
            <option value="">（用 ID：{maker.id}{GAME_MAKER_STAGES.has(maker.id) ? '' : '——站上沒有這張'}）</option>
            {stageKeys.filter((k) => k !== maker.id).map((k) => <option key={k} value={k}>沿用 {k}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-text-dim">
          排序（小的在前；空＝排最後）
          <input value={orderText} onChange={(e) => { setOrderText(e.target.value); setError(null) }} inputMode="numeric" className="input-field text-sm mt-0.5" placeholder="例：10" />
        </label>
        <label className="text-[11px] text-text-dim sm:col-span-2">
          型號前綴（用頓號或空白分隔；只用來在機甲扉頁建議廠商）
          <input value={prefixText} onChange={(e) => { setPrefixText(e.target.value); setError(null) }} className="input-field text-sm mt-0.5 font-mono" placeholder="例：KX、KXM" />
        </label>
        <label className="text-[11px] text-text-dim sm:col-span-2">
          備註
          <input value={form.note ?? ''} onChange={(e) => patch({ note: e.target.value })} className="input-field text-sm mt-0.5" placeholder="給管理員看的備註（例：中文名待確認）" />
        </label>
        {picking && (
          <div className="sm:col-span-2">
            <FactionLogoPicker
              value={form.logo ? [form.logo] : []}
              // 廠商只有一顆徽章：選第二顆＝換掉（選圖器本身最多允許兩顆）
              onChange={(next) => patch({ logo: next.at(-1) })}
              suggestions={[]}
            />
          </div>
        )}
      </div>

      <div className="flex md:flex-col items-center md:items-end justify-end gap-2 shrink-0">
        {error && <span className="text-[11px] text-accent-red max-w-[12rem]">{error}</span>}
        {isNew && onDiscard && (
          <button type="button" onClick={onDiscard} className="text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:text-text-primary transition-colors">
            取消
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="text-xs px-3 py-1.5 rounded-lg border border-accent-orange/50 text-accent-orange hover:bg-accent-orange/10 transition-colors disabled:opacity-40 disabled:cursor-default"
        >
          {saving ? '儲存中…' : isNew ? '建立' : dirty ? '儲存' : '已儲存'}
        </button>
      </div>
    </div>
  )
}

/** 頓號、逗號、空白都算分隔；去重、保留輸入的大小寫 */
function parsePrefixes(text: string): string[] {
  return [...new Set(text.split(/[\s,，、]+/).map((s) => s.trim()).filter(Boolean))]
}

function parseOrder(text: string): number | undefined {
  const t = text.trim()
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** 存檔前整理：去頭尾空白、空的欄位拿掉（writeDoc 整份覆寫，欄位會真的從文件上消失） */
function normalizeMaker(m: MechMaker): MechMaker {
  const str = (s: string | undefined) => s?.trim() || undefined
  const prefixes = m.modelPrefixes?.map((p) => p.trim()).filter(Boolean)
  return {
    id: m.id,
    ...(str(m.name) && { name: str(m.name) }),
    ...(str(m.nameEn) && { nameEn: str(m.nameEn) }),
    ...(m.logo && { logo: m.logo }),
    ...(str(m.stage) && { stage: str(m.stage) }),
    ...(prefixes?.length && { modelPrefixes: prefixes }),
    ...(m.order !== undefined && { order: m.order }),
    ...(str(m.note) && { note: str(m.note) }),
  }
}
