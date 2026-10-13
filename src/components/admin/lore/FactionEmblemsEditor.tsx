import { useEffect, useMemo, useRef, useState } from 'react'
import type { FactionEmblem } from '../../../types'
import { useGameData } from '../../../contexts/GameDataContext'
import { updateFactionEmblem } from '../../../lib/firestoreApi'
import { FactionLogo } from '../../icons/FactionLogo'
import { loadIconIndex, peekIconIndex } from '../gameIconIndex'
import {
  emblemCatalog, emblemUsage, factionValues, isNamed, matchEmblem, normalizeEmblem, type EmblemEntry,
} from '../../../utils/factionEmblems'

// ─── 故事館編輯台「陣營徽章」分頁（PLAN-042-F D-1）──────────────────────────────
//
// 替每顆官方徽章填名稱、圖上字樣、對應的陣營文字（PLAN-042-F 決策四）。清單以**圖庫**為準
// （images/game/icons/index.json 的 camp），DB 沒有文件的編號＝未命名，存檔時才建文件。
//
// ⚠ 這裡**不會**替任何機師選徽章——「對應的陣營文字」只讓選圖器把這顆排進建議區，
//   每位機師的徽章仍在編輯面板的扉頁分頁逐位點選（決策六的精神：判斷權在管理者）。
// ⚠ 註記讀不到（rules／Worker 還沒部署、或網路錯誤）時**不開放編輯**：存檔是整份覆寫，
//   不知道既有內容就存，會把別人填過的字樣、備註洗掉。

const PAPER = 'bg-[#efe7d8] text-[#2b2621]'
type Filter = 'all' | 'unnamed' | 'used'

export function FactionEmblemsEditor({ focus }: {
  /** 網址 `?emblem=0021`：捲到並標示那一顆（選圖器的「補名稱」連過來） */
  focus?: string | null
}) {
  const gd = useGameData()
  const { ensureLoaded } = gd
  useEffect(() => { void ensureLoaded(['factionEmblems', 'pilotLore', 'pilots']) }, [ensureLoaded])

  const [keys, setKeys] = useState<string[] | null>(() => peekIconIndex()?.camp ?? null)
  const [indexError, setIndexError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    loadIconIndex()
      .then((m) => { if (alive) setKeys(m.camp ?? []) })
      .catch((e) => { if (alive) setIndexError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const loadError = gd.errorMap['factionEmblems'] ?? null
  const loaded = gd.loadedKeys.has('factionEmblems')

  const entries = useMemo(() => emblemCatalog(keys ?? [], gd.factionEmblems), [keys, gd.factionEmblems])
  const usage = useMemo(() => emblemUsage(gd.pilotLore), [gd.pilotLore])
  const nameOf = useMemo(() => new Map(gd.pilots.map((p) => [p.id, p.name])), [gd.pilots])
  const factionOptions = useMemo(() => factionValues(gd.pilots), [gd.pilots])
  const named = entries.filter(isNamed).length

  const shown = entries.filter((en) =>
    matchEmblem(en, search)
    && (filter === 'all' || (filter === 'unnamed' ? !isNamed(en) : (usage.get(en.num)?.length ?? 0) > 0)),
  )

  async function save(next: FactionEmblem) {
    const clean = normalizeEmblem(next)
    const version = await updateFactionEmblem(clean)
    gd.patchCollectionItem('factionEmblems', clean, version)
  }

  if (indexError) return <p className="text-accent-red text-sm">⚠ 圖示索引載入失敗：{indexError}</p>
  if (loadError) {
    return (
      <div className="rounded-xl border border-accent-red/40 bg-accent-red/10 px-4 py-3">
        <p className="text-accent-red text-sm font-bold">⚠ 陣營徽章註記載入失敗</p>
        <p className="text-text-secondary text-xs mt-1 break-all">{loadError.message}</p>
        <p className="text-text-dim text-xs mt-2">
          存檔是整份覆寫，讀不到既有內容時不開放編輯。剛上線時多半是 Firestore 規則或 Worker 還沒部署（PLAN-042-F E-2）。
        </p>
      </div>
    )
  }
  if (!keys || !loaded) return <p className="text-text-dim text-sm text-center py-10">載入中...</p>

  return (
    <div>
      <p className="text-text-dim text-xs leading-relaxed mb-3">
        替每顆官方徽章標上陣營的中英文名稱與圖上字樣，選圖器就會顯示名稱、可以用名稱搜尋。
        「對應的陣營文字」填機師資料裡的陣營寫法（例：晨星同盟、晨星同盟防衛軍），那些機師開選圖器時這顆會排在最前面——
        <b className="text-text-secondary">只是建議，不會替任何人自動選</b>。
      </p>

      <div className="grid grid-cols-3 gap-2 mb-3 max-w-md">
        <Stat label="已命名" value={`${named} / ${entries.length}`} />
        <Stat label="使用中" value={`${[...usage.keys()].length} 顆`} />
        <Stat label="已選徽章的機師" value={`${gd.pilotLore.filter((d) => (d.factionLogos?.length ?? 0) > 0).length} 位`} />
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋中英文名稱、圖上字樣、陣營文字或編號"
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-orange"
        />
        <div className="flex gap-1">
          {([['all', '全部'], ['unnamed', '未命名'], ['used', '使用中']] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setFilter(v)}
              className={`px-3 py-2 rounded-lg text-xs border transition-colors ${
                filter === v
                  ? 'bg-accent-cyan/15 border-accent-cyan/40 text-accent-cyan'
                  : 'bg-bg-dark border-border text-text-secondary hover:border-border-accent hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <datalist id="faction-emblem-factions">
        {factionOptions.map((f) => <option key={f} value={f} />)}
      </datalist>

      <div className="space-y-2">
        {shown.map((en) => (
          <EmblemRow
            key={`${en.num}:${JSON.stringify(en.emblem ?? null)}`}
            entry={en}
            users={(usage.get(en.num) ?? []).map((id) => nameOf.get(id) ?? id)}
            focused={focus === en.num}
            onSave={save}
          />
        ))}
        {shown.length === 0 && <p className="text-text-dim text-sm text-center py-8">找不到符合條件的徽章</p>}
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

/** 一顆徽章一列。表單狀態留在列內，key 帶著 DB 內容——別人存檔或自己存完，列會用新值重建 */
function EmblemRow({ entry, users, focused, onSave }: {
  entry: EmblemEntry
  users: string[]
  focused: boolean
  onSave: (next: FactionEmblem) => Promise<void>
}) {
  const initial: FactionEmblem = entry.emblem ?? { id: entry.num }
  const [form, setForm] = useState<FactionEmblem>(() => ({ ...initial, factions: [...(initial.factions ?? [])] }))
  const [factionDraft, setFactionDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // 直接跳、不用 smooth：從選圖器連過來是新分頁，在背景開的話分頁是 hidden，
  // 瀏覽器不跑捲動動畫（實測停在 0），直接跳在哪種情況都會到
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' })
  }, [focused])

  const patch = (p: Partial<FactionEmblem>) => { setForm((f) => ({ ...f, ...p })); setError(null) }
  const dirty = JSON.stringify(normalizeEmblem({ ...form, factions: withDraft(form.factions, factionDraft) }))
    !== JSON.stringify(normalizeEmblem(initial))

  function addFaction() {
    const v = factionDraft.trim()
    if (!v) return
    patch({ factions: withDraft(form.factions, v) })
    setFactionDraft('')
  }

  async function handleSave() {
    setSaving(true)
    try {
      // 打了一半沒按 Enter 的陣營文字也算進去（不然存完才發現沒存到）
      await onSave({ ...form, factions: withDraft(form.factions, factionDraft) })
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗，請重試')
    } finally {
      // 成功時列多半已因 key 改變而重建；bump 失敗（version ''）時快取不會就地更新、列不重建，也要解除
      setSaving(false)
    }
  }

  const title = form.name?.trim() || entry.emblem?.name || '未命名'
  return (
    <div
      ref={ref}
      className={`rounded-xl border bg-bg-card p-3 flex flex-col md:flex-row gap-3 ${
        focused ? 'border-accent-orange' : 'border-border'
      }`}
    >
      <div className="flex items-start gap-3 md:w-56 shrink-0">
        <div className={`flex gap-1 rounded-lg p-1.5 ${PAPER}`}>
          {[entry.mono, entry.color].map((k, i) => k ? (
            <span key={k} title={`${k}（${i === 0 ? '單色' : '彩色'}）`} className="w-14 h-14 grid place-items-center">
              <FactionLogo logoKey={k} size={52} />
            </span>
          ) : (
            <span key={i} className="w-14 h-14 grid place-items-center text-[10px] text-[#b9ab92]">—</span>
          ))}
        </div>
        <div className="min-w-0">
          <div className="font-mono text-xs text-text-dim">{entry.num}</div>
          <div className={`text-sm font-bold truncate ${isNamed(entry) || form.name?.trim() ? 'text-text-primary' : 'text-text-dim'}`}>{title}</div>
          {(form.nameEn?.trim() || entry.emblem?.nameEn) && (
            <div className="text-[11px] text-text-secondary truncate" title={form.nameEn ?? entry.emblem?.nameEn}>{form.nameEn?.trim() || entry.emblem?.nameEn}</div>
          )}
          <div className="text-[11px] text-text-dim" title={users.join('、')}>
            {users.length ? `使用中 ${users.length} 位` : '沒有人使用'}
          </div>
        </div>
      </div>

      <div className="flex-1 min-w-0 grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] text-text-dim">
          中文名稱
          <input value={form.name ?? ''} onChange={(e) => patch({ name: e.target.value })} className="input-field text-sm mt-0.5" placeholder="陣營中文名稱" />
        </label>
        <label className="text-[11px] text-text-dim">
          英文名稱
          <input value={form.nameEn ?? ''} onChange={(e) => patch({ nameEn: e.target.value })} className="input-field text-sm mt-0.5" placeholder="陣營英文名稱" />
        </label>
        <label className="text-[11px] text-text-dim sm:col-span-2">
          圖上字樣（原文照抄；不一定等於英文名稱）
          <input value={form.inscription ?? ''} onChange={(e) => patch({ inscription: e.target.value })} className="input-field text-sm mt-0.5" placeholder="圖上看得到的字（沒有就留空）" />
        </label>
        <div className="text-[11px] text-text-dim sm:col-span-2">
          對應的陣營文字（機師資料裡的寫法；只用來排建議）
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {(form.factions ?? []).map((f) => (
              <span key={f} className="inline-flex items-center gap-1 rounded-full border border-accent-cyan/30 bg-accent-cyan/10 px-2 py-0.5 text-xs text-accent-cyan">
                {f}
                <button
                  type="button"
                  onClick={() => patch({ factions: (form.factions ?? []).filter((x) => x !== f) })}
                  className="text-accent-cyan/70 hover:text-accent-red cursor-pointer"
                  aria-label={`移除 ${f}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              list="faction-emblem-factions"
              value={factionDraft}
              onChange={(e) => setFactionDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFaction() } }}
              onBlur={addFaction}
              className="input-field text-sm w-48"
              placeholder="輸入或選擇後按 Enter"
            />
          </div>
        </div>
        <label className="text-[11px] text-text-dim sm:col-span-2">
          備註
          <input value={form.note ?? ''} onChange={(e) => patch({ note: e.target.value })} className="input-field text-sm mt-0.5" placeholder="給管理員看的備註" />
        </label>
      </div>

      <div className="flex md:flex-col items-center md:items-end justify-end gap-2 shrink-0">
        {error && <span className="text-[11px] text-accent-red max-w-[12rem]">{error}</span>}
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="text-xs px-3 py-1.5 rounded-lg border border-accent-orange/50 text-accent-orange hover:bg-accent-orange/10 transition-colors disabled:opacity-40 disabled:cursor-default"
        >
          {saving ? '儲存中…' : dirty ? '儲存' : '已儲存'}
        </button>
      </div>
    </div>
  )
}

/** 把輸入框裡還沒按 Enter 的字也併進清單（去頭尾空白、不重複） */
function withDraft(list: string[] | undefined, draft: string): string[] {
  const v = draft.trim()
  const cur = list ?? []
  return v && !cur.includes(v) ? [...cur, v] : cur
}
