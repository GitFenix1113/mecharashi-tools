import { useMemo, useState } from 'react'
import type { LoreDossierField, Mech, MechLoreDoc, MechMaker } from '../../../types'
import { ADMIN_WIDE_MAX_W, AdminEditTabs, AdminModal, Field, type AdminEditTabDef } from '../../../pages/user/admin/shared'
import { useDraftWrite } from '../../../hooks/useDraftAutosave'
import { useLayoutBreakpoint } from '../../../hooks/useLayoutBreakpoint'
import { useGameData } from '../../../contexts/GameDataContext'
import { duplicateLabels, unlabeledRows } from '../../../utils/loreDossier'
import { mechCardArt, mechGameArt, mechSkinCatalog } from '../../../utils/gameArt'
import { usePatchVersions } from '../../../hooks/usePatchVersions'
import { gachaTitleSuggestions } from '../../lore/mechGachaTitle'
import { mechWeightClassOf } from '../../../data/mechWeightClasses'
import { byMakerOrder } from '../../lore/mechRoster'
import { LoreFieldRowsEditor } from './LoreDossierEditor'
import { LoreChaptersEditor } from './LoreChaptersEditor'
import { LoreSkinsEditor } from './LoreSkinsEditor'
import { MechLineageEditor } from './MechLineageEditor'
import { relationIssues } from '../../lore/mechLineage'
import { MechLorePreview } from './MechLorePreview'
import { SMALL_BTN } from './LoreFrontEditor'
import { cleanOcr, mergeSoftWraps, normalizeCommentary, sectionIssues, type LoreSectionCache } from './loreEditText'

/** 草稿暫存的 kind（PLAN-045）：與機師的 'pilotLore.v2' 分開，兩邊的草稿互不覆蓋 */
export const MECH_LORE_DRAFT_KIND = 'mechLore.v1'

type MechTab = 'front' | 'specs' | 'lineage' | 'skins' | 'chapters' | 'preview'

/**
 * 故事館編輯台「機甲」的編輯面板（PLAN-042-B G-1）：一台機甲的故事資料在同一個面板編完——
 * 扉頁（型號、廠商、英文名、系列、卡池名稱、介紹、來源）／技術檔案（非數值諸元）／系譜／塗裝／逸聞章節，右欄即時預覽。
 * 結構照機師版 LoreEditPanel；章節與塗裝分頁是同一個元件。
 *
 * 名字、類型、品質、登場版本是圖鑑與故事館共用的身分欄位（與數值有關，決策 B-7），在「機甲管理」編。
 * 存檔是**整份覆寫**（saveWithHistory → writeDoc）：表單必須帶著文件的每一個欄位，所以初始化時整份複製。
 */
export function MechLoreEditPanel({
  doc, mech, onSave, onCancel,
}: {
  /** 既有文件，或由列表現場造的 `{ id, name, chapters: [] }` 空殼 */
  doc: MechLoreDoc
  /** 查不到（被刪的機甲、還原了別台的草稿）時是 undefined：仍可編，只是沒有預覽 */
  mech: Mech | undefined
  onSave: (next: MechLoreDoc) => Promise<void>
  onCancel: () => void
}) {
  // 列表層已 ensureLoaded(['mechs','mechLore','mechMakers','pilots'])，這裡只取同一份記憶體資料
  const { mechs, mechLore, mechMakers, pilots } = useGameData()
  const narrow = useLayoutBreakpoint() === 'narrow'

  // 逐層複製：直接沿用 GameDataContext 的物件會讓「取消」之後記憶體快取裡已經是改過的內容
  const [form, setForm] = useState<MechLoreDoc>(() => ({
    ...doc,
    chapters: (doc.chapters ?? []).map((c) => ({
      ...c,
      commentary: c.commentary?.map((x) => ({ ...x, ...(x.speaker && { speaker: { ...x.speaker } }) })),
    })),
    ...(doc.specs && { specs: doc.specs.map((f) => ({ ...f })) }),
    ...(doc.relations && { relations: doc.relations.map((r) => ({ ...r })) }),
    ...(doc.skins && { skins: doc.skins.map((s) => ({ ...s })) }),
  }))
  // ⚠ 草稿必須接在編輯器內部、監聽 form（見 useDraftAutosave 檔頭）
  useDraftWrite(MECH_LORE_DRAFT_KIND, form, (d) => d.name ?? d.id)

  const [tab, setTab] = useState<MechTab>('front')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewSkin, setPreviewSkin] = useState('')
  const [previewChapter, setPreviewChapter] = useState<string | undefined>(undefined)
  const [sectionCache, setSectionCache] = useState<Record<string, LoreSectionCache>>({})

  const patch = (p: Partial<MechLoreDoc>) => setForm((f) => ({ ...f, ...p }))
  const skinCatalog = useMemo(() => mechSkinCatalog(mech), [mech])
  const makers = useMemo(() => [...mechMakers].sort(byMakerOrder), [mechMakers])
  const maker = (form.maker && mechMakers.find((m) => m.id === form.maker)) || null

  const tabs: AdminEditTabDef<MechTab>[] = [
    { id: 'front', label: '扉頁' },
    { id: 'specs', label: '技術檔案', badge: form.specs?.length },
    { id: 'lineage', label: '系譜', badge: form.relations?.length },
    { id: 'skins', label: '塗裝', badge: skinCatalog.length },
    { id: 'chapters', label: '逸聞章節', badge: form.chapters.length },
    ...(narrow && mech ? [{ id: 'preview' as const, label: '預覽' }] : []),
  ]
  const activeTab: MechTab = tab === 'preview' && !(narrow && mech) ? 'front' : tab

  async function handleSubmit() {
    const dup = duplicateLabels(form.specs)
    const unlabeled = unlabeledRows(form.specs)
    if (dup.length || unlabeled.length) {
      setTab('specs')
      setError([
        dup.length ? `技術檔案有同名標籤：${dup.join('、')}` : '',
        unlabeled.length ? `技術檔案第 ${unlabeled.join('、')} 列有內容但沒有標籤` : '',
      ].filter(Boolean).join('；'))
      return
    }
    const rel = relationIssues(form.relations)
    if (rel.length) {
      setTab('lineage')
      setError(`系譜要先改好：${rel.join('；')}`)
      return
    }
    const badSources = sectionIssues(form.chapters, sectionCache)
    if (badSources.length) {
      setTab('chapters')
      setError(`逸聞章節的署名要先改好：${badSources.join('；')}`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const specs = normalizeSpecs(form.specs)
      const relations = form.relations?.map((r) => ({
        mechId: r.mechId,
        ...(r.kind && { kind: r.kind }),
        ...(r.note?.trim() && { note: r.note.trim() }),
      }))
      await onSave({
        ...form,
        // ⚠ name 一定要帶：saveWithHistory 的 targetName 取 `item.name ?? id`，漏了稽核記錄都會是文件 ID
        name: mech?.name ?? form.name,
        modelNo: form.modelNo?.trim() || undefined,
        maker: form.maker || undefined,
        nameEn: form.nameEn?.trim() || undefined,
        series: form.series?.trim() || undefined,
        gachaTitle: form.gachaTitle?.trim() || undefined,
        intro: form.intro?.trim() || undefined,
        frontSource: form.frontSource?.trim() || undefined,
        specs,
        relations: relations?.length ? relations : undefined,
        chapters: form.chapters.map((ch) => ({ ...ch, commentary: normalizeCommentary(ch.commentary) })),
        skins: form.skins?.length
          ? form.skins.map((s) => ({ key: s.key, ...(s.name?.trim() && { name: s.name.trim() }), ...(s.hidden && { hidden: true as const }) }))
          : undefined,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗，請重試')
      setSaving(false)
    }
  }

  const editor = (
    <>
      {activeTab === 'front' && <MechFrontEditor form={form} mech={mech} makers={makers} onChange={patch} />}
      {activeTab === 'specs' && (
        <div className="space-y-3">
          <p className="text-xs text-text-dim leading-relaxed">
            卷宗「構造」卡的諸元表：型號、製造廠商、類型、品質、登場版本、系列、英文名會自動列出（取自扉頁與機甲管理），
            這裡補<b className="text-text-secondary">與數值無關</b>的其他項目，例如量產狀態、搭載核心、主要用途。留空的列不顯示。
          </p>
          <LoreFieldRowsEditor
            value={form.specs}
            onChange={(specs) => patch({ specs })}
            title="技術檔案（標籤即前台顯示文字，順序＝顯示順序）"
            emptyHint="尚無項目。例如：量產狀態、搭載核心、主要用途。"
            labelPlaceholder="標籤，如：量產狀態"
          />
        </div>
      )}
      {activeTab === 'lineage' && (
        <MechLineageEditor mechId={form.id} value={form.relations} onChange={(relations) => patch({ relations })} mechs={mechs} loreDocs={mechLore} />
      )}
      {activeTab === 'skins' && (
        <LoreSkinsEditor
          catalog={skinCatalog}
          defaultSrc={mech ? mechGameArt(mech, 'sn') : undefined}
          defaultSub="官方主視覺（_SN_Raw）"
          noun="塗裝"
          importHint="import-game-assets.mjs --mech-lore"
          thumbOf={(s) => s.raw}
          value={form.skins}
          onChange={(skins) => patch({ skins })}
          previewKey={previewSkin}
          onPreview={(key) => { setPreviewSkin(key); setPreviewChapter(undefined); if (narrow) setTab('preview') }}
        />
      )}
      {activeTab === 'chapters' && (
        <LoreChaptersEditor
          chapters={form.chapters}
          pilots={pilots}
          onChange={(chapters) => patch({ chapters })}
          previewKey={previewChapter}
          onPreview={(key) => { setPreviewChapter(key); if (key && narrow) setTab('preview') }}
          sectionCache={sectionCache}
          onSectionCache={(key, entry) => setSectionCache((m) => ({ ...m, [key]: entry }))}
        />
      )}
    </>
  )

  const previewChapterObj = previewChapter ? form.chapters.find((c) => c.key === previewChapter) : undefined
  const preview = mech ? (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-text-dim flex-wrap">
        <span className="text-accent-cyan font-bold">即時預覽</span>
        <span>
          {previewChapterObj
            ? `閱讀模式 · ${previewChapterObj.label ?? `PART ${form.chapters.indexOf(previewChapterObj) + 1}`}${previewChapterObj.draft ? '（草稿，前台看不到）' : ''}`
            : '檔案'}
        </span>
        {previewChapterObj && (
          <button type="button" onClick={() => setPreviewChapter(undefined)} className="text-accent-cyan hover:underline">回到檔案</button>
        )}
        <span className="ml-auto">依目前視窗寬度等比縮小，尚未存檔</span>
      </div>
      <MechLorePreview mech={mech} lore={form} maker={maker} skinKey={previewSkin} chapterKey={previewChapterObj?.key} />
    </div>
  ) : null

  return (
    <AdminModal maxWidth={ADMIN_WIDE_MAX_W} saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
      <h3 className="text-lg font-bold mb-3 flex items-center gap-2 shrink-0 flex-wrap">
        <span className="text-accent-cyan">◆</span>
        機甲故事館編輯台
        <span className="text-text-primary">{mech?.name ?? form.name ?? form.id}</span>
        <span className="text-text-dim text-sm font-normal">{form.id}</span>
        {!mech && <span className="text-xs font-normal text-accent-yellow">⚠ 找不到這台機甲（沒有預覽）</span>}
      </h3>

      <AdminEditTabs tabs={tabs} active={activeTab} onChange={setTab} />

      {narrow || !preview ? (
        <div className="overflow-y-auto flex-1 min-h-0 pr-1">
          {activeTab === 'preview' ? preview : editor}
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-4">
          <div className="overflow-y-auto min-h-0 pr-1">{editor}</div>
          <div className="overflow-y-auto min-h-0 pr-1">{preview}</div>
        </div>
      )}
    </AdminModal>
  )
}

/** 去頭尾空白、丟掉兩格都空的列；一列都不剩回 undefined（欄位從文件上消失） */
function normalizeSpecs(specs: LoreDossierField[] | undefined): LoreDossierField[] | undefined {
  const out = (specs ?? [])
    .map((f) => ({ label: f.label.trim(), value: f.value.trim() }))
    .filter((f) => f.label || f.value)
  return out.length ? out : undefined
}

/**
 * 「扉頁」分頁：型號、廠商、英文名、系列、卡池名稱、介紹、來源。
 * 清空一律存 undefined：writeDoc 是整份覆寫，欄位會真的從文件上消失。
 */
function MechFrontEditor({
  form, mech, makers, onChange,
}: {
  form: MechLoreDoc
  mech: Mech | undefined
  makers: MechMaker[]
  onChange: (patch: Partial<MechLoreDoc>) => void
}) {
  const intro = form.intro ?? ''
  const known = !form.maker || makers.some((m) => m.id === form.maker)
  // 型號前綴的建議（決策 B-8：只建議、不自動指派——前綴對不上廠商的例外約 15 台）
  const prefix = form.modelNo?.trim().match(/^[A-Za-z]+/)?.[0]?.toUpperCase()
  const suggested = prefix && !form.maker
    ? makers.find((m) => m.modelPrefixes?.some((p) => p.trim().toUpperCase() === prefix))
    : undefined
  const weight = mechWeightClassOf(mech?.armorType)
  // 卡池名稱的建議：公告管線解析到的機甲卡池（版本活動 specificMechBanner）。讀不到版本資料就只是沒有建議
  const { data: versions } = usePatchVersions()
  const gachaHints = useMemo(() => gachaTitleSuggestions(mech?.name, versions), [mech?.name, versions])
  const hasCard = !!mechCardArt(mech)

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-dim leading-relaxed">
        名字、類型、品質、登場版本是圖鑑與故事館共用的身分欄位，在「機甲管理」編輯：
        <span className="text-text-secondary"> {mech?.name ?? form.id}</span>
        {weight && <span className="text-text-secondary"> · {weight.full}</span>}
        {mech?.quality && <span className="text-text-secondary"> · {mech.quality}</span>}
        {mech?.debutVersion && <span className="text-text-secondary"> · v{mech.debutVersion}</span>}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="型號 modelNo（卷宗標題與舞台上的型號鋼印）">
          <input
            value={form.modelNo ?? ''}
            onChange={(e) => onChange({ modelNo: e.target.value || undefined })}
            className="input-field text-sm font-mono"
            placeholder="DD-117"
          />
        </Field>
        <Field label="廠商 maker（名冊分組、卷宗標題；清單在「機甲廠商」分頁）">
          <select
            value={form.maker ?? ''}
            onChange={(e) => onChange({ maker: e.target.value || undefined })}
            className="input-field text-sm"
          >
            <option value="">（未填：前台顯示「廠商未載」）</option>
            {!known && <option value={form.maker}>⚠ 對不到：{form.maker}</option>}
            {makers.map((m) => <option key={m.id} value={m.id}>{m.name?.trim() || m.id}（{m.id}）</option>)}
          </select>
          {suggested && (
            <button type="button" onClick={() => onChange({ maker: suggested.id })} className="mt-1 text-[11px] text-accent-cyan hover:underline">
              型號前綴 {prefix} 對到「{suggested.name?.trim() || suggested.id}」——用這家
            </button>
          )}
        </Field>
        <Field label="英文名 nameEn（卷宗副標、名冊搜尋）">
          <input
            value={form.nameEn ?? ''}
            onChange={(e) => onChange({ nameEn: e.target.value || undefined })}
            className="input-field text-sm"
            placeholder="Glasya"
          />
        </Field>
        <Field label="系列 series（選填，例：破曉者、KX 系列）">
          <input
            value={form.series ?? ''}
            onChange={(e) => onChange({ series: e.target.value || undefined })}
            className="input-field text-sm"
          />
        </Field>
        <Field label="卡池名稱 gachaTitle（卷宗最後招募插畫卡的標題；空＝顯示「卡池」）">
          <input
            value={form.gachaTitle ?? ''}
            onChange={(e) => onChange({ gachaTitle: e.target.value || undefined })}
            className="input-field text-sm"
            placeholder="可能性的彼端"
          />
          {gachaHints.filter((h) => h.title !== form.gachaTitle?.trim()).map((h) => (
            <button
              key={`${h.server}|${h.title}`}
              type="button"
              onClick={() => onChange({ gachaTitle: h.title })}
              className="mt-1 mr-3 text-[11px] text-accent-cyan hover:underline"
            >
              {h.server === 'tw' ? '台服' : '陸服'}公告 {h.date}「{h.title}」——用這個
            </button>
          ))}
          {!hasCard && <p className="mt-1 text-[11px] text-text-dim">這台站上沒有招募插畫，卷宗不會出現卡池卡（填了也看不到）。</p>}
        </Field>
      </div>

      <div>
        <Field label="技術檔案介紹 intro（純文字，換行即分段；型號不要寫在第一行，填在上面的型號欄）">
          <textarea
            value={intro}
            onChange={(e) => onChange({ intro: e.target.value || undefined })}
            className="input-field min-h-[180px] resize-y text-sm leading-relaxed"
            placeholder="貼上或輸入介紹。"
          />
        </Field>
        <div className="flex gap-2 flex-wrap mt-1.5">
          <button type="button" onClick={() => onChange({ intro: cleanOcr(intro) || undefined })} disabled={!intro} className={SMALL_BTN}>
            清理（OCR）
          </button>
          <button type="button" onClick={() => onChange({ intro: mergeSoftWraps(intro) || undefined })} disabled={!intro} className={SMALL_BTN}>
            合併軟換行
          </button>
        </div>
      </div>

      <Field label="介紹的來源 frontSource（選填；台版譯文填「台版官方公告」，陸版原文留空）">
        <input
          value={form.frontSource ?? ''}
          onChange={(e) => onChange({ frontSource: e.target.value || undefined })}
          className="input-field text-sm"
          placeholder="台版官方公告"
        />
      </Field>
    </div>
  )
}
