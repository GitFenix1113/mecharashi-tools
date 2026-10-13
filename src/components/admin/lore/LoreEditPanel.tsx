import { useMemo, useState } from 'react'
import type { LoreDoc, Pilot } from '../../../types'
import { ADMIN_WIDE_MAX_W, AdminEditTabs, AdminModal, type AdminEditTabDef } from '../../../pages/user/admin/shared'
import { useDraftWrite } from '../../../hooks/useDraftAutosave'
import { useLayoutBreakpoint } from '../../../hooks/useLayoutBreakpoint'
import { useGameData } from '../../../contexts/GameDataContext'
import { factionLogoSuggestions } from '../../../utils/factionLogos'
import { duplicateLabels, normalizeDossier, unlabeledRows } from '../../../utils/loreDossier'
import { pilotSkinCatalog } from '../../../utils/gameArt'
import { LoreFrontEditor } from './LoreFrontEditor'
import { LoreDossierEditor } from './LoreDossierEditor'
import { LoreChaptersEditor } from './LoreChaptersEditor'
import { LoreSkinsEditor } from './LoreSkinsEditor'
import { LorePreview } from './LorePreview'

/**
 * 草稿暫存的 kind（PLAN-045）。PLAN-042-E 起從 'pilotLore' 換成新的：
 * 改版前存下的草稿沒有 intro／dossier／nameEn／skins，還原後一存檔就會把搬遷進來的資料整份洗掉
 * （saveWithHistory 是整份覆寫）。換 kind 等於不再提示那些舊草稿——凍結期間本來就沒有人在編。
 */
export const LORE_DRAFT_KIND = 'pilotLore.v2'

type LoreTab = 'front' | 'dossier' | 'chapters' | 'skins' | 'preview'

/**
 * 故事館編輯台的編輯面板（PLAN-042-E D-2）：一位機師的所有故事資料在同一個面板編完——
 * 扉頁（英文名、簡介、署名、徽章）／人物檔案／逸聞章節／外觀，右欄即時預覽（D-4）。
 * 窄螢幕（< 1024px）預覽改成一個分頁。
 *
 * 存檔是**整份覆寫**（saveWithHistory → writeDoc）：表單必須帶著文件的每一個欄位，
 * 所以初始化時整份複製，不要只挑編得到的欄位。
 */
export function LoreEditPanel({
  doc, pilot, onSave, onCancel,
}: {
  /** 既有文件，或由列表現場造的 `{ id, name, chapters: [] }` 空殼 */
  doc: LoreDoc
  /** 查不到（被刪的機師、還原了別人的草稿）時是 undefined：仍可編，只是沒有預覽 */
  pilot: Pilot | undefined
  onSave: (next: LoreDoc) => Promise<void>
  onCancel: () => void
}) {
  // 旁白的說話者候選、陣營徽章的「同陣營建議」：列表層已 ensureLoaded(['pilots','pilotLore'])，這裡只取同一份記憶體資料
  const { pilots, pilotLore } = useGameData()
  const narrow = useLayoutBreakpoint() === 'narrow'

  // 逐層複製：直接沿用 GameDataContext 的物件會讓「取消」之後記憶體快取裡已經是改過的內容
  const [form, setForm] = useState<LoreDoc>(() => ({
    ...doc,
    chapters: (doc.chapters ?? []).map((c) => ({ ...c, commentary: c.commentary?.map((x) => ({ ...x })) })),
    ...(doc.dossier && { dossier: { ...doc.dossier, extra: doc.dossier.extra?.map((f) => ({ ...f })) } }),
    ...(doc.skins && { skins: doc.skins.map((s) => ({ ...s })) }),
  }))
  // ⚠ 草稿必須接在編輯器內部、監聽 form（見 useDraftAutosave 檔頭）
  useDraftWrite(LORE_DRAFT_KIND, form, (d) => d.name ?? d.id)

  const [tab, setTab] = useState<LoreTab>('front')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewSkin, setPreviewSkin] = useState('')
  const [previewChapter, setPreviewChapter] = useState<string | undefined>(undefined)

  const patch = (p: Partial<LoreDoc>) => setForm((f) => ({ ...f, ...p }))
  const logoSuggestions = useMemo(
    () => factionLogoSuggestions(doc.id, pilot?.faction, pilots, pilotLore),
    [doc.id, pilot?.faction, pilots, pilotLore],
  )
  const skinCount = useMemo(() => pilotSkinCatalog(pilot).length, [pilot])

  const tabs: AdminEditTabDef<LoreTab>[] = [
    { id: 'front', label: '扉頁' },
    { id: 'dossier', label: '人物檔案', badge: form.dossier?.extra?.length },
    { id: 'chapters', label: '逸聞章節', badge: form.chapters.length },
    { id: 'skins', label: '外觀', badge: skinCount },
    ...(narrow && pilot ? [{ id: 'preview' as const, label: '預覽' }] : []),
  ]
  // 從窄螢幕拉寬時「預覽」分頁會消失 → 退回扉頁
  const activeTab: LoreTab = tab === 'preview' && !(narrow && pilot) ? 'front' : tab

  async function handleSubmit() {
    const extra = form.dossier?.extra
    const dup = duplicateLabels(extra)
    const unlabeled = unlabeledRows(extra)
    if (dup.length || unlabeled.length) {
      setTab('dossier')
      setError([
        dup.length ? `人物檔案的自訂欄位有同名標籤：${dup.join('、')}` : '',
        unlabeled.length ? `人物檔案第 ${unlabeled.join('、')} 列有內容但沒有標籤` : '',
      ].filter(Boolean).join('；'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        ...form,
        // ⚠ name 一定要帶：saveWithHistory 的 targetName 取 `item.name ?? id`，漏了稽核記錄都會是文件 ID
        name: pilot?.name ?? form.name,
        nameEn: form.nameEn?.trim() || undefined,
        intro: form.intro?.trim() || undefined,
        frontSource: form.frontSource?.trim() || undefined,
        dossier: normalizeDossier(form.dossier),
        // 名稱在存檔時才 trim（打字中 trim 會把正要打的空白吃掉）
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
      {activeTab === 'front' && <LoreFrontEditor form={form} pilot={pilot} onChange={patch} logoSuggestions={logoSuggestions} />}
      {activeTab === 'dossier' && (
        <LoreDossierEditor value={form.dossier} faction={pilot?.faction} onChange={(dossier) => patch({ dossier })} />
      )}
      {activeTab === 'chapters' && (
        <LoreChaptersEditor
          chapters={form.chapters}
          pilots={pilots}
          onChange={(chapters) => patch({ chapters })}
          previewKey={previewChapter}
          onPreview={(key) => { setPreviewChapter(key); if (key && narrow) setTab('preview') }}
        />
      )}
      {activeTab === 'skins' && (
        <LoreSkinsEditor
          pilot={pilot}
          value={form.skins}
          onChange={(skins) => patch({ skins })}
          previewKey={previewSkin}
          onPreview={(key) => { setPreviewSkin(key); setPreviewChapter(undefined); if (narrow) setTab('preview') }}
        />
      )}
    </>
  )

  const previewChapterObj = previewChapter ? form.chapters.find((c) => c.key === previewChapter) : undefined
  const preview = pilot ? (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-text-dim flex-wrap">
        <span className="text-accent-cyan font-bold">即時預覽</span>
        <span>
          {previewChapterObj
            ? `閱讀模式 · ${previewChapterObj.label ?? `PART ${form.chapters.indexOf(previewChapterObj) + 1}`}${previewChapterObj.draft ? '（草稿，前台看不到）' : ''}`
            : '扉頁'}
        </span>
        {previewChapterObj && (
          <button type="button" onClick={() => setPreviewChapter(undefined)} className="text-accent-cyan hover:underline">回到扉頁</button>
        )}
        <span className="ml-auto">依目前視窗寬度等比縮小，尚未存檔</span>
      </div>
      <LorePreview pilot={pilot} lore={form} skinKey={previewSkin} chapterKey={previewChapterObj?.key} />
    </div>
  ) : null

  return (
    <AdminModal maxWidth={ADMIN_WIDE_MAX_W} saving={saving} error={error} onSave={handleSubmit} onCancel={onCancel}>
      <h3 className="text-lg font-bold mb-3 flex items-center gap-2 shrink-0 flex-wrap">
        <span className="text-accent-cyan">◆</span>
        故事館編輯台
        <span className="text-text-primary">{pilot?.name ?? form.name ?? form.id}</span>
        <span className="text-text-dim text-sm font-normal">{form.id}</span>
        {!pilot && <span className="text-xs font-normal text-accent-yellow">⚠ 找不到這位機師（沒有預覽）</span>}
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
