import { useState } from 'react'
import type { LoreChapter, LoreCommentary, Pilot } from '../../../types'
import { Field } from '../../../pages/user/admin/shared'
import { RefPicker } from '../RefPicker'
import { cleanOcr, makeChapterKey, mergeSoftWraps, moveItem } from './loreEditText'
import { ICON_BTN } from './LoreDossierEditor'
import { SMALL_BTN } from './LoreFrontEditor'

/**
 * 故事館編輯台「逸聞章節」分頁（PLAN-042-A E-1 的章節編輯，PLAN-042-E D-2 拆檔、D-5 加草稿旗標）。
 *
 * ⚠ 章節 key 建立後不可變更（見 makeChapterKey），所以這裡只顯示、不給改。
 * ⚠ 每章各自一組 RefPicker：它的 text 陣列語意是「同一份 refs 的多個欄位」，
 *   把多章 join 成一段餵進去會讓同名 token 的重複判定完全失準。
 */
export function LoreChaptersEditor({
  chapters, pilots, onChange, previewKey, onPreview,
}: {
  chapters: LoreChapter[]
  pilots: Pilot[]
  onChange: (next: LoreChapter[]) => void
  /** 預覽中的章節（右欄／預覽分頁顯示閱讀模式）；undefined＝預覽扉頁 */
  previewKey?: string
  onPreview: (key: string | undefined) => void
}) {
  const [ocr, setOcr] = useState('')
  const patch = (i: number, p: Partial<LoreChapter>) => onChange(chapters.map((c, n) => (n === i ? { ...c, ...p } : c)))
  const add = (body = '') => onChange([...chapters, { key: makeChapterKey(chapters), title: '', body }])

  return (
    <div className="space-y-4">
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
          <button type="button" onClick={() => setOcr((t) => cleanOcr(t))} disabled={!ocr} className={SMALL_BTN}>清理</button>
          <button type="button" onClick={() => setOcr((t) => mergeSoftWraps(t))} disabled={!ocr} className={SMALL_BTN}>合併軟換行</button>
          <button
            type="button"
            onClick={() => { add(ocr); setOcr('') }}
            disabled={!ocr.trim()}
            className="text-xs px-3 py-1.5 rounded-lg bg-accent-cyan/15 border border-accent-cyan/40 text-accent-cyan hover:bg-accent-cyan/25 transition-colors disabled:opacity-40"
          >
            ＋ 新增為一章
          </button>
        </div>
      </div>

      {chapters.map((ch, i) => (
        <ChapterCard
          key={ch.key}
          chapter={ch}
          index={i}
          total={chapters.length}
          pilots={pilots}
          previewing={previewKey === ch.key}
          onPatch={(p) => patch(i, p)}
          onMove={(dir) => onChange(moveItem(chapters, i, dir))}
          onRemove={() => { if (previewKey === ch.key) onPreview(undefined); onChange(chapters.filter((_, n) => n !== i)) }}
          onPreview={() => onPreview(previewKey === ch.key ? undefined : ch.key)}
        />
      ))}

      {chapters.length === 0 && (
        <p className="text-text-dim text-sm text-center py-6">尚未建立任何章節。可從上方 OCR 區貼入原文，或直接新增空白章節。</p>
      )}

      <button
        type="button"
        onClick={() => add()}
        className="w-full py-2 rounded-xl border border-dashed border-border text-text-secondary text-sm hover:border-border-accent hover:text-text-primary transition-colors"
      >
        ＋ 新增章節
      </button>
    </div>
  )
}

// ─── 單章編輯卡 ────────────────────────────────────────────────────────────────
function ChapterCard({
  chapter, index, total, pilots, previewing, onPatch, onMove, onRemove, onPreview,
}: {
  chapter: LoreChapter
  index: number
  total: number
  pilots: Pilot[]
  previewing: boolean
  onPatch: (patch: Partial<LoreChapter>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onPreview: () => void
}) {
  return (
    <div className={`bg-bg-dark border rounded-xl p-3 space-y-3 ${chapter.draft ? 'border-dashed border-accent-yellow/50' : 'border-border'}`}>
      {/* 章節列首：key 是唯讀的（進網址、也是還原錨點） */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-[Orbitron,sans-serif] tracking-[2px] text-accent-cyan uppercase">
          {chapter.label ?? `PART ${index + 1}`}
        </span>
        <span className="text-[11px] font-mono text-text-dim" title="章節 key：進網址、且為還原錨點，建立後不可變更">
          {chapter.key}
        </span>
        {/* 草稿（D-5）：前台不列出、網址導回扉頁、館首頁章節數不計入。資料仍會整包下載——只防「沒寫完的被讀到」，不是保密 */}
        <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer" title="草稿章：前台不列出，資料仍會隨整包下載（不是保密）">
          <input type="checkbox" checked={!!chapter.draft} onChange={(e) => onPatch({ draft: e.target.checked ? true : undefined })} />
          草稿
        </label>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={onPreview}
            className={`${ICON_BTN} ${previewing ? '!border-accent-cyan/60 !text-accent-cyan' : ''}`}
            title="在預覽區看這一章的閱讀模式（再按一次回到扉頁）"
          >
            {previewing ? '預覽中' : '預覽'}
          </button>
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className={ICON_BTN} title="上移">▲</button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className={ICON_BTN} title="下移">▼</button>
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
          <input value={chapter.title} onChange={(e) => onPatch({ title: e.target.value })} className="input-field text-sm" placeholder="如：光環遍身" />
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

      {/* ⚠ 側錄寫回 chapters[i].bodyRefs（entityRefs 寫死 refsField:'bodyRefs'）。 */}
      <RefPicker
        text={chapter.body}
        value={chapter.bodyRefs}
        onChange={(refs) => onPatch({ bodyRefs: refs })}
        onCompileText={(tf, refs) => onPatch({ body: tf(chapter.body), ...(refs && { bodyRefs: refs }) })}
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

// ─── 旁白列編輯（LoreCommentary）──────────────────────────────────────────────
// speakerId 指向 pilots 文件 ID（總綱決策三：故事館不新增 RefType，只准指 pilots）。
// 用 select 而不是自由輸入：手打 ID 幾乎必然打錯，而查不到的 speakerId 在前台
// 只會靜默少一顆頭像，資料層沒有任何機制會發現。
function CommentaryEditor({
  items, pilots, onChange,
}: {
  items: LoreCommentary[]
  pilots: Pilot[]
  onChange: (next: LoreCommentary[]) => void
}) {
  const update = (i: number, patch: Partial<LoreCommentary>) => onChange(items.map((c, n) => (n === i ? { ...c, ...patch } : c)))

  return (
    <div className="space-y-1.5">
      {items.map((c, i) => {
        const known = pilots.some((p) => p.id === c.speakerId)
        return (
          <div key={i} className="flex gap-2 items-start">
            <select value={c.speakerId} onChange={(e) => update(i, { speakerId: e.target.value })} className="input-field w-44 shrink-0 text-sm">
              <option value="">（未指定說話者）</option>
              {/* 查無此 ID 時仍保留原值，避免下拉把資料靜默改成空字串 */}
              {!known && c.speakerId && <option value={c.speakerId}>⚠ {c.speakerId}</option>}
              {pilots.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input value={c.text} onChange={(e) => update(i, { text: e.target.value })} className="input-field flex-1 text-sm" placeholder="旁白內容" />
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
