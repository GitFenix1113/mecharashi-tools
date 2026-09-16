import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { LoreChapter, LoreCommentary, LoreDoc, Pilot } from '../../types'
import {
  ADMIN_WIDE_MAX_W,
  AdminModal,
  DraftRestoreBar,
  Field,
  LoadMoreButton,
  useClientPaged,
} from '../user/admin/shared'
import { useDraftRestore, useDraftWrite } from '../../hooks/useDraftAutosave'
import { RefPicker } from '../../components/admin/RefPicker'
import { updatePilotLore } from '../../lib/firestoreApi'
import { useGameData } from '../../contexts/GameDataContext'

// ─── 機師故事館編輯台（PLAN-042-A Phase E-1）─────────────────────────────────
//
// 走**獨立子頁**而不是後台的第 15 顆 Tab，理由有兩個：
//   ① 互動形狀不同構——其餘 14 顆分頁編的是「一份文件一組欄位」，這裡編的是
//      「一份文件 N 章長文」，每章各自帶正文、署名、旁白與一組引用側錄。
//   ② 權限要能獨立授權——內容是人工逐字打進去的，未來可能開給非工程的編輯協作。
//
// ⚠ `LoreDoc.chapters` 在型別上是**必填**（`chapters: LoreChapter[]`），但**執行期不保證存在**：
//   Firestore 沒有 schema 強制，任何寫入路徑漏掉該欄位，讀回來就是 undefined 而 TS 完全不擋。
//   2026-09-10 就踩過——`scripts/temp_scripts/extract-lore-source.mjs --apply` 只寫了
//   `{ id, name, frontSource }`，34 筆文件全都沒有 `chapters`，於是本頁渲染列表統計時
//   `d.chapters.length` 直接 TypeError，錯誤冒泡出 Layout ⇒ **整頁全白、連 header 都沒有**
//   （`AdminRoute` 外層沒有 error boundary，`Suspense fallback={null}` 也吃掉了任何提示）。
//   資料已補回 `chapters: []`，但本頁一律走 `?.chapters?.` 防禦——修資料治標，防禦才治本。
//
// ⚠ 本頁**沒有任何刪除路徑**，這是刻意的（lib/api/pilotLore.ts 檔尾有完整說明）：
//   pilotLore 不是任何 [xxx] 引用的目標，沒有級聯要跑；而「一鍵抹掉一整份人工長文」
//   是全站唯一無法靠重跑爬蟲救回來的操作。要清空就把章節逐章移除後存檔，
//   那條路徑會留下 update 記錄，前一版內容也還在 changeHistory 裡。

/** 列表的建檔狀態篩選 */
type BuiltFilter = 'all' | 'yes' | 'no'

interface LoreFilters {
  built: BuiltFilter
}

const BUILT_OPTIONS: { value: BuiltFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'no',  label: '僅未建檔' },
  { value: 'yes', label: '僅已建檔' },
]

/**
 * 新增章節時自動產生穩定 key。**建立後不可變更**——網址（`/lore/pilots/:id/:part`）
 * 是唯一真相，而 changeHistory 的還原錨點也是靠 key 定位（`by: 'key'`）。
 * 改掉既有 key 會讓已分享的連結與既有快照錨點同時失效，且兩者都不會報錯。
 *
 * 從 `chapters.length + 1` 起跳並跳過已用號碼：刪掉中段某章後再新增，
 * 不會撿回已經被分享出去的舊號碼。
 */
function makeChapterKey(chapters: LoreChapter[]): string {
  const used = new Set(chapters.map((c) => c.key))
  for (let n = chapters.length + 1; ; n++) {
    const k = `part-${n}`
    if (!used.has(k)) return k
  }
}

/**
 * OCR 貼上的基本清理：換行正規化、逐行去頭尾空白（含全形空白 U+3000）、
 * 三個以上的連續換行收成一個空行。
 *
 * ⚠ 只做這三件事。斷句、標點修復、錯字都留給人——OCR 的錯法沒有規律，
 *   自動「修正」會製造出看起來對、但與原文不同的正文。
 */
function cleanOcr(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    // U+3000 ＝全形空白（OCR 對遊戲內首行縮排最常見的產出）。
    // 一律寫成逸出序列：字面量會被 ESLint 的 no-irregular-whitespace 擋下，
    // 而且它在 diff 與編輯器裡與半形空白長得一模一樣，改壞了看不出來。
    .map((line) => line.replace(/^[\s\u3000]+/, '').replace(/[\s\u3000]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 視為「這一行已經講完」的句末標點。不在此列的行尾＝OCR 的軟換行。 */
const HARD_LINE_END = /[。」』！？…：]$/

/**
 * 把 OCR 依版面切出來的軟換行接回同一段。
 *
 * **刻意做成明示按鈕而不是自動套用**：遊戲內文本有大量以「——」「…」結尾的短行、
 * 以及刻意的單行分句，接錯了要逐字改回來，比不接更費工。由編輯看過再按。
 * 空行（段落分界）一律保留。
 */
function mergeSoftWraps(text: string): string {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const prev = out[out.length - 1]
    if (prev !== undefined && prev !== '' && line !== '' && !HARD_LINE_END.test(prev)) {
      out[out.length - 1] = prev + line
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}

// ─── 旁白列編輯（LoreCommentary）──────────────────────────────────────────────
// speakerId 指向 pilots 文件 ID（總綱決策三：故事館不新增 RefType，只准指 pilots）。
// 用 select 而不是自由輸入：手打 ID 幾乎必然打錯，而查不到的 speakerId 在前台
// 只會靜默少一顆頭像，資料層沒有任何機制會發現。
function CommentaryEditor({
  items,
  pilots,
  onChange,
}: {
  items: LoreCommentary[]
  pilots: Pilot[]
  onChange: (next: LoreCommentary[]) => void
}) {
  function update(i: number, patch: Partial<LoreCommentary>) {
    onChange(items.map((c, n) => (n === i ? { ...c, ...patch } : c)))
  }

  return (
    <div className="space-y-1.5">
      {items.map((c, i) => {
        const known = pilots.some((p) => p.id === c.speakerId)
        return (
          <div key={i} className="flex gap-2 items-start">
            <select
              value={c.speakerId}
              onChange={(e) => update(i, { speakerId: e.target.value })}
              className="input-field w-44 shrink-0 text-sm"
            >
              <option value="">（未指定說話者）</option>
              {/* 查無此 ID 時仍保留原值，避免下拉把資料靜默改成空字串 */}
              {!known && c.speakerId && <option value={c.speakerId}>⚠ {c.speakerId}</option>}
              {pilots.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              value={c.text}
              onChange={(e) => update(i, { text: e.target.value })}
              className="input-field flex-1 text-sm"
              placeholder="旁白內容"
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, n) => n !== i))}
              className="px-2 py-1.5 rounded-lg border border-border text-text-dim text-xs hover:text-accent-red hover:border-accent-red/40 transition-colors shrink-0"
              title="移除這一列旁白"
            >
              ✕
            </button>
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => onChange([...items, { speakerId: '', text: '' }])}
        className="text-xs px-3 py-1 rounded-lg border border-border text-text-secondary hover:border-border-accent hover:text-text-primary transition-colors"
      >
        ＋ 新增旁白
      </button>
    </div>
  )
}

// ─── 單章編輯卡 ────────────────────────────────────────────────────────────────
function ChapterCard({
  chapter,
  index,
  total,
  pilots,
  onPatch,
  onMove,
  onRemove,
}: {
  chapter: LoreChapter
  index: number
  total: number
  pilots: Pilot[]
  onPatch: (patch: Partial<LoreChapter>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  return (
    <div className="bg-bg-dark border border-border rounded-xl p-3 space-y-3">
      {/* 章節列首：key 是唯讀的（進網址、也是還原錨點） */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-[Orbitron,sans-serif] tracking-[2px] text-accent-cyan uppercase">
          {chapter.label ?? `PART ${index + 1}`}
        </span>
        <span className="text-[11px] font-mono text-text-dim" title="章節 key：進網址、且為還原錨點，建立後不可變更">
          {chapter.key}
        </span>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="px-2 py-1 rounded-lg border border-border text-text-secondary text-xs hover:border-border-accent hover:text-text-primary transition-colors disabled:opacity-30"
            title="上移"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            className="px-2 py-1 rounded-lg border border-border text-text-secondary text-xs hover:border-border-accent hover:text-text-primary transition-colors disabled:opacity-30"
            title="下移"
          >
            ▼
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="px-2 py-1 rounded-lg border border-border text-text-dim text-xs hover:text-accent-red hover:border-accent-red/40 transition-colors"
            title="移除這一章（存檔後生效，前一版仍留在變更歷史裡）"
          >
            移除本章
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-3">
        <Field label="章節標籤 label（留空 → PART N）">
          <input
            value={chapter.label ?? ''}
            onChange={(e) => onPatch({ label: e.target.value || undefined })}
            className="input-field text-sm"
            placeholder={`PART ${index + 1}`}
          />
        </Field>
        <Field label="章節標題 title">
          <input
            value={chapter.title}
            onChange={(e) => onPatch({ title: e.target.value })}
            className="input-field text-sm"
            placeholder="如：光環遍身"
          />
        </Field>
      </div>

      <Field label="正文 body（可含 [xxx] 引用標記）">
        <textarea
          value={chapter.body}
          onChange={(e) => onPatch({ body: e.target.value })}
          className="input-field min-h-[220px] resize-y text-sm leading-relaxed"
          placeholder="貼上或輸入本章正文。空行分段。"
        />
      </Field>

      {/* ⚠ 每章各自一組：RefPicker 的 text 陣列語意是「同一份 refs 的多個欄位」，
          把多章 join 成一段餵進去會讓同名 token 的重複判定完全失準。
          ⚠ 側錄寫回 chapters[i].bodyRefs（entityRefs 寫死 refsField:'bodyRefs'）。 */}
      <RefPicker
        text={chapter.body}
        value={chapter.bodyRefs}
        onChange={(refs) => onPatch({ bodyRefs: refs })}
        onCompileText={(tf) => onPatch({ body: tf(chapter.body) })}
      />

      <Field label="出處署名 source（選填，如：——《週刊米赫瑪·文娛版》）">
        <input
          value={chapter.source ?? ''}
          onChange={(e) => onPatch({ source: e.target.value || undefined })}
          className="input-field text-sm"
          placeholder="——《週刊米赫瑪·文娛版》"
        />
      </Field>

      <Field label="旁白 commentary（選填）">
        <CommentaryEditor
          items={chapter.commentary ?? []}
          pilots={pilots}
          onChange={(next) => onPatch({ commentary: next.length > 0 ? next : undefined })}
        />
      </Field>
    </div>
  )
}

// ─── 編輯面板 ──────────────────────────────────────────────────────────────────
interface LoreEditPanelProps {
  /** 既有文件，或由列表現場造的 `{ id: pilot.id, name: pilot.name, chapters: [] }` 空殼 */
  doc: LoreDoc
  pilotName: string
  onSave: (next: LoreDoc) => Promise<void>
  onCancel: () => void
}

function LoreEditPanel({ doc, pilotName, onSave, onCancel }: LoreEditPanelProps) {
  // 旁白的說話者候選。列表層已 ensureLoaded(['pilots'])，這裡只是取用同一份記憶體資料，
  // 不會額外觸發任何讀取。
  const { pilots } = useGameData()

  // chapters 逐章淺拷貝：直接沿用 GameDataContext 的物件會讓「取消」之後
  // 記憶體快取裡已經是改過的內容（畫面正常、下次進頁才發現對不上）。
  const [form, setForm] = useState<LoreDoc>(() => ({
    ...doc,
    chapters: (doc.chapters ?? []).map((c) => ({ ...c })),
  }))

  // ⚠ 草稿必須接在**編輯器內部**、監聽 form。接在列表層監聽 editing 會存下
  //   「打開編輯器那一刻的原始快照」——提示照樣跳，還原出來卻是舊的，比沒有草稿更糟。
  //   nameOf 是 inline 箭頭，hook 內部已用 ref 承接，不可進依賴陣列。
  useDraftWrite('pilotLore', form, (d) => d.name ?? d.id)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ocr, setOcr] = useState('')

  // ⚠ 換編輯對象時的重置**不在這裡**：呼叫端給了 `key={editing.doc.id}`，
  //   換人就整個 remount，`useState` 的 initializer 自然重跑。
  //   其他後台面板用的是 `useEffect(() => setForm({...item}), [item])`，
  //   那個寫法會被 react-hooks/set-state-in-effect 擋下（而且多跑一輪 render）。

  function patchChapter(i: number, patch: Partial<LoreChapter>) {
    setForm((f) => ({
      ...f,
      chapters: f.chapters.map((c, n) => (n === i ? { ...c, ...patch } : c)),
    }))
  }

  function moveChapter(i: number, dir: -1 | 1) {
    setForm((f) => {
      const j = i + dir
      if (j < 0 || j >= f.chapters.length) return f
      const next = [...f.chapters]
      const tmp = next[i]
      next[i] = next[j]
      next[j] = tmp
      return { ...f, chapters: next }
    })
  }

  function removeChapter(i: number) {
    setForm((f) => ({ ...f, chapters: f.chapters.filter((_, n) => n !== i) }))
  }

  /** 新增一章（key 自動產生）。body 可由 OCR 區直接帶入。 */
  function addChapter(body = '') {
    setForm((f) => ({
      ...f,
      chapters: [...f.chapters, { key: makeChapterKey(f.chapters), title: '', body }],
    }))
  }

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      // ⚠ name 一定要帶：saveWithHistory 的 targetName 取 `item.name ?? id`，
      //   漏了整頁稽核記錄都會是文件 ID，要等到日後查「誰改了哪一章」才發現。
      await onSave({ ...form, name: pilotName })
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗，請重試')
      setSaving(false)
    }
  }

  return (
    <AdminModal maxWidth={ADMIN_WIDE_MAX_W} saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2 shrink-0">
        <span className="text-accent-cyan">◆</span>
        編輯逸聞
        <span className="text-text-primary">{pilotName}</span>
        <span className="text-text-dim text-sm font-normal ml-1">{form.id}</span>
        <span className="text-text-dim text-xs font-normal ml-auto">共 {form.chapters.length} 章</span>
      </h3>

      <div className="overflow-y-auto flex-1 pr-1 space-y-4">
        {/* 扉頁署名：正文本身住 pilots.lore（爬蟲每次補丁都會重寫），這裡只存
            「原文的哪一段是署名」這個編輯決策。 */}
        <Field label="扉頁署名 frontSource（選填；扉頁正文本身在 pilots.lore，不在這裡編）">
          <input
            value={form.frontSource ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, frontSource: e.target.value || undefined }))}
            className="input-field text-sm"
            placeholder="——《週刊米赫瑪·文娛版》"
          />
        </Field>

        {/* OCR 貼上輔助區。刻意**不做程式自動切章**——章節劃分是編輯決策，
            猜錯的切點會把兩章的正文混在一起，比手動貼三次更難修。 */}
        <div className="bg-bg-dark border border-dashed border-border rounded-xl p-3 space-y-2">
          <div className="text-xs text-text-dim">
            OCR 貼上區：先貼原文 → 清理 → 視情況合併軟換行 → 新增為一章。內容不會自動存檔。
          </div>
          <textarea
            value={ocr}
            onChange={(e) => setOcr(e.target.value)}
            className="input-field min-h-[120px] resize-y text-sm leading-relaxed"
            placeholder="把遊戲內截圖辨識出來的原文貼在這裡"
          />
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setOcr((t) => cleanOcr(t))}
              disabled={!ocr}
              className="text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:border-border-accent hover:text-text-primary transition-colors disabled:opacity-40"
            >
              清理
            </button>
            <button
              type="button"
              onClick={() => setOcr((t) => mergeSoftWraps(t))}
              disabled={!ocr}
              className="text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:border-border-accent hover:text-text-primary transition-colors disabled:opacity-40"
            >
              合併軟換行
            </button>
            <button
              type="button"
              onClick={() => { addChapter(ocr); setOcr('') }}
              disabled={!ocr.trim()}
              className="text-xs px-3 py-1.5 rounded-lg bg-accent-cyan/15 border border-accent-cyan/40 text-accent-cyan hover:bg-accent-cyan/25 transition-colors disabled:opacity-40"
            >
              ＋ 新增為一章
            </button>
          </div>
        </div>

        {form.chapters.map((ch, i) => (
          <ChapterCard
            key={ch.key}
            chapter={ch}
            index={i}
            total={form.chapters.length}
            pilots={pilots}
            onPatch={(patch) => patchChapter(i, patch)}
            onMove={(dir) => moveChapter(i, dir)}
            onRemove={() => removeChapter(i)}
          />
        ))}

        {form.chapters.length === 0 && (
          <p className="text-text-dim text-sm text-center py-6">
            尚未建立任何章節。可從上方 OCR 區貼入原文，或直接新增空白章節。
          </p>
        )}

        <button
          type="button"
          onClick={() => addChapter()}
          className="w-full py-2 rounded-xl border border-dashed border-border text-text-secondary text-sm hover:border-border-accent hover:text-text-primary transition-colors"
        >
          ＋ 新增章節
        </button>
      </div>
    </AdminModal>
  )
}

// ─── 編輯台主頁 ────────────────────────────────────────────────────────────────
export default function AdminLorePage() {
  const gd = useGameData()

  // ⚠ 必須解構出 ensureLoaded 當依賴。寫成 [gd] 的話：Provider 的 value 是每次 render
  //   新建的物件字面量（未 memo），而抓取失敗的 catch 會 setErrorMap → re-render →
  //   新的 gd → effect 再跑 → 再抓，形成無限重抓迴圈（畫面只是轉圈，看不出來）。
  const { ensureLoaded } = gd
  useEffect(() => { void ensureLoaded(['pilotLore', 'pilots']) }, [ensureLoaded])

  // ⚠ error 必須判斷在 loading 之前：GameDataContext 的 catch 只寫 errorMap、
  //   不把 key 加進 loadedKeys ⇒ 抓取失敗時 loading 永遠是 true，
  //   先判 loading 就會永遠停在骨架、看不到任何錯誤訊息。
  const error = gd.errorMap['pilotLore'] ?? gd.errorMap['pilots'] ?? null
  const loading = !gd.loadedKeys.has('pilotLore') || !gd.loadedKeys.has('pilots')

  const [editing, setEditing] = useState<{ doc: LoreDoc; pilotName: string } | null>(null)
  const draft = useDraftRestore<LoreDoc>('pilotLore')

  const loreById = useMemo(
    () => new Map(gd.pilotLore.map((d) => [d.id, d])),
    [gd.pilotLore],
  )

  // 列表來源是 **pilots** 不是 pilotLore：89 位機師都要能點進去建檔，
  // 只列已建檔的 34 筆等於把還沒開工的 55 位藏起來。
  const {
    items, hasMore, search, setSearch, filters, setFilter, submitSearch, loadMore,
  } = useClientPaged<Pilot, LoreFilters>({
    source: gd.pilots,
    initialFilters: { built: 'all' },
    matchFilters: (p, f) => {
      if (f.built === 'all') return true
      const built = (loreById.get(p.id)?.chapters?.length ?? 0) > 0
      return f.built === 'yes' ? built : !built
    },
  })

  function openEditor(p: Pilot) {
    const existing = loreById.get(p.id)
    setEditing({
      // 建立與存檔兩處都要帶 name（見 handleSave 的註解）
      doc: existing ? { ...existing, name: p.name } : { id: p.id, name: p.name, chapters: [] },
      pilotName: p.name,
    })
  }

  async function handleSave(next: LoreDoc) {
    const version = await updatePilotLore(next)
    // version === '' 時 patchCollectionItem 內部改走 removeCache，是安全降級
    gd.patchCollectionItem('pilotLore', next, version)
    draft.commit()
    setEditing(null)
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">

      {/* 麵包屑 */}
      <div className="flex items-center gap-2 text-xs text-text-dim mb-4">
        <Link to="/admin" className="hover:text-text-secondary transition-colors no-underline">後台管理</Link>
        <span>›</span>
        <span className="text-accent-cyan">機師故事館</span>
      </div>

      {/* 頁首 */}
      <div className="mb-6">
        <div className="text-[10px] font-[Orbitron,sans-serif] tracking-[3px] text-accent-cyan uppercase mb-1">
          Admin · Pilot Lore
        </div>
        <h1 className="text-2xl font-bold text-text-primary">機師故事館</h1>
        <p className="text-text-dim text-sm mt-1">
          逸聞章節 100% 人工輸入（OCR 輔助）。扉頁正文取自機師資料的簡介，不在這裡編輯。
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-accent-red/40 bg-accent-red/10 px-4 py-3">
          <p className="text-accent-red text-sm font-bold">⚠ 資料載入失敗</p>
          <p className="text-text-secondary text-xs mt-1 break-all">{error.message}</p>
          <p className="text-text-dim text-xs mt-2">
            編輯台需要完整的既有逸聞才能安全覆寫，故載入失敗時不開放編輯。
          </p>
        </div>
      ) : loading ? (
        <p className="text-text-dim text-sm text-center py-10">載入中...</p>
      ) : (
        <>
          <DraftRestoreBar
            draft={draft}
            onRestore={(d) => setEditing({ doc: d, pilotName: d.name ?? d.id })}
          />

          {/* 搜尋 + 建檔狀態篩選 */}
          <div className="flex flex-wrap gap-2 mb-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitSearch() }}
              placeholder="搜尋機師名稱 / ID 片段..."
              className="flex-1 min-w-[180px] px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-orange"
            />
            <div className="flex gap-1">
              {BUILT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setFilter('built', o.value)}
                  className={`px-3 py-2 rounded-lg text-xs border transition-colors ${
                    filters.built === o.value
                      ? 'bg-accent-cyan/15 border-accent-cyan/40 text-accent-cyan'
                      : 'bg-bg-dark border-border text-text-secondary hover:border-border-accent hover:text-text-primary'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <p className="text-text-dim text-xs mb-3">
            顯示 {items.length} 位機師{hasMore ? '（可載入更多）' : ''}
            <span className="mx-2">·</span>
            全站已建檔 {gd.pilotLore.filter((d) => (d.chapters?.length ?? 0) > 0).length} / {gd.pilots.length}
          </p>

          <div className="space-y-1.5">
            {items.map((p) => {
              const doc = loreById.get(p.id)
              const count = doc?.chapters?.length ?? 0
              return (
                <div
                  key={p.id}
                  className="bg-bg-card border border-border rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-border-accent transition-colors cursor-pointer"
                  onClick={() => openEditor(p)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-text-primary truncate">{p.name}</span>
                      <span className="text-[11px] font-mono text-text-dim truncate">{p.id}</span>
                    </div>
                    <p className="text-[13px] text-text-secondary truncate mt-0.5">
                      {doc?.chapters?.[0]?.title || (doc?.frontSource ? `扉頁署名：${doc.frontSource}` : '（尚未建檔）')}
                    </p>
                  </div>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded border shrink-0 ${
                      count > 0
                        ? 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan'
                        : 'bg-bg-dark border-border text-text-dim'
                    }`}
                  >
                    {count} 章
                  </span>
                </div>
              )
            })}
            {items.length === 0 && (
              <p className="text-text-dim text-sm text-center py-8">找不到符合條件的機師</p>
            )}
          </div>

          <LoadMoreButton hasMore={hasMore} loading={false} onClick={loadMore} />
        </>
      )}

      {editing && (
        <LoreEditPanel
          key={editing.doc.id}
          doc={editing.doc}
          pilotName={editing.pilotName}
          onSave={handleSave}
          onCancel={() => { draft.discard(); setEditing(null) }}
        />
      )}
    </div>
  )
}
