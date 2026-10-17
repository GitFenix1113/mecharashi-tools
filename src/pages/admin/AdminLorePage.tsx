import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { LoreDoc, Pilot } from '../../types'
import { DraftRestoreBar, LoadMoreButton, useClientPaged } from '../user/admin/shared'
import { useDraftRestore } from '../../hooks/useDraftAutosave'
import { updatePilotLore } from '../../lib/firestoreApi'
import { useGameData } from '../../contexts/GameDataContext'
import { useAuth } from '../../contexts/AuthContext'
import { isAdminRole } from '../../utils/userRole'
import { pilotSkinCatalog } from '../../utils/gameArt'
import {
  LORE_GAP_LABEL, hasLoreGap, loreProgressOf, summarizeLoreProgress, type LoreGap, type LoreProgress,
} from '../../utils/loreProgress'
import { LoreEditPanel, LORE_DRAFT_KIND } from '../../components/admin/lore/LoreEditPanel'
import { FactionEmblemsEditor } from '../../components/admin/lore/FactionEmblemsEditor'
import { MechLoreAdmin } from '../../components/admin/lore/MechLoreAdmin'
import { MechMakersEditor } from '../../components/admin/lore/MechMakersEditor'

// ─── 故事館編輯台（PLAN-042-A Phase E-1；PLAN-042-E D 段改版；PLAN-042-B G 段加機甲）────────────
//
// 一位機師的故事資料**全部在這裡編**：扉頁（英文名、簡介、署名、陣營徽章）、人物檔案、逸聞章節、外觀。
// PLAN-042-E 之前簡介與人物檔案在「機師管理 › 個人資料」，那個分頁已移除（圖鑑只管數值與機制）。
// 編輯面板拆在 components/admin/lore/，本檔只負責列表（進度總覽）、篩選與開關面板。
//
// 走**獨立子頁**而不是後台的第 15 顆 Tab，理由有兩個：
//   ① 互動形狀不同構——其餘 14 顆分頁編的是「一份文件一組欄位」，這裡編的是
//      「一份文件 N 章長文」，每章各自帶正文、署名、旁白與一組引用側錄。
//   ② 權限要能獨立授權——內容是人工逐字打進去的，未來可能開給非工程的編輯協作。
//
// 網址 `?pilot=<文件 ID>` 直接打開那一位的面板（機師管理的捷徑連到這裡）；開關面板都會同步網址。
// `?view=emblems` 切到「陣營徽章」分頁（PLAN-042-F D-1），`&emblem=<4 碼>` 捲到那一顆（選圖器的「補名稱」連過來）。
// `?view=mechs` 切到「機甲」分頁、`&mech=<文件 ID>` 打開那一台（PLAN-042-B G-1，列表與面板在 MechLoreAdmin）；
// `?view=makers` 切到「機甲廠商」分頁（G-2）。
//
// ⚠ `LoreDoc.chapters` 在型別上是**必填**（`chapters: LoreChapter[]`），但**執行期不保證存在**：
//   Firestore 沒有 schema 強制，任何寫入路徑漏掉該欄位，讀回來就是 undefined 而 TS 完全不擋。
//   2026-09-10 就踩過——當時一支一次性腳本只寫了 `{ id, name, frontSource }`，34 筆文件全都沒有
//   `chapters`，於是本頁渲染列表統計時 `d.chapters.length` 直接 TypeError，錯誤冒泡出 Layout ⇒
//   **整頁全白、連 header 都沒有**（`AdminRoute` 外層沒有 error boundary，`Suspense fallback={null}`
//   也吃掉了任何提示）。資料已補回 `chapters: []`，但本頁一律走 `?.chapters?.` 防禦——修資料治標，防禦才治本。
//
// ⚠ 本頁**沒有任何刪除路徑**，這是刻意的（lib/api/pilotLore.ts 檔尾有完整說明）：
//   pilotLore 不是任何 [xxx] 引用的目標，沒有級聯要跑；而「一鍵抹掉一整份人工長文」
//   不該是一顆按鈕。要清空就把內容逐項清掉後存檔，那條路徑會留下 update 記錄，
//   前一版內容也還在 changeHistory 裡。

interface LoreFilters {
  gap: 'all' | LoreGap
}

const GAP_OPTIONS: { value: LoreFilters['gap']; label: string }[] = [
  { value: 'all', label: '全部' },
  ...(Object.keys(LORE_GAP_LABEL) as LoreGap[]).map((g) => ({ value: g, label: LORE_GAP_LABEL[g] })),
]

export default function AdminLorePage() {
  const gd = useGameData()
  const isAdmin = isAdminRole(useAuth().userProfile?.role)

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

  const draft = useDraftRestore<LoreDoc>(LORE_DRAFT_KIND)
  // 從草稿還原的那份：只在網址也指著同一位時才用它（換人＝放棄還原）
  const [restored, setRestored] = useState<LoreDoc | null>(null)

  const [params, setParams] = useSearchParams()
  const editingId = params.get('pilot')
  const view: LoreView = VIEWS.some(([v]) => v === params.get('view')) ? params.get('view') as LoreView : 'pilots'
  const setView = (v: LoreView) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    if (v === 'pilots') next.delete('view')
    else next.set('view', v)
    // 換分頁就關掉別的分頁開著的面板與定位
    for (const k of ['emblem', 'pilot', 'mech']) next.delete(k)
    return next
  }, { replace: true })
  const openEditor = (id: string) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    next.set('pilot', id)
    return next
  }, { replace: true })
  const closeEditor = () => {
    setRestored(null)
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('pilot')
      return next
    }, { replace: true })
  }

  const loreById = useMemo(() => new Map(gd.pilotLore.map((d) => [d.id, d])), [gd.pilotLore])
  const pilotById = useMemo(() => new Map(gd.pilots.map((p) => [p.id, p])), [gd.pilots])

  // 進度總覽（D-3）：全部從資料推導。外觀總數取 build 時的清單（pilotSkinCatalog），不是 DB
  const progress = useMemo(
    () => new Map<string, LoreProgress>(gd.pilots.map((p) => [
      p.id, loreProgressOf(loreById.get(p.id), pilotSkinCatalog(p).map((s) => s.key)),
    ])),
    [gd.pilots, loreById],
  )
  const summary = useMemo(() => summarizeLoreProgress([...progress.values()]), [progress])

  // 列表來源是 **pilots** 不是 pilotLore：每位機師都要能點進去建檔
  const {
    items, hasMore, search, setSearch, filters, setFilter, submitSearch, loadMore,
  } = useClientPaged<Pilot, LoreFilters>({
    source: gd.pilots,
    initialFilters: { gap: 'all' },
    matchFilters: (p, f) => {
      if (f.gap === 'all') return true
      const pr = progress.get(p.id)
      return !!pr && hasLoreGap(pr, f.gap)
    },
  })

  async function handleSave(next: LoreDoc) {
    const version = await updatePilotLore(next)
    // version === '' 時 patchCollectionItem 內部改走 removeCache，是安全降級
    gd.patchCollectionItem('pilotLore', next, version)
    draft.commit()
    closeEditor()
  }

  // 面板要編的那一份：草稿 → 既有文件 → 現場造的空殼。建立與存檔兩處都要帶 name（見 LoreEditPanel 的 handleSubmit）
  const editingPilot = editingId ? pilotById.get(editingId) : undefined
  const editingDoc: LoreDoc | null = !editingId || loading || error ? null
    : restored?.id === editingId ? restored
    : (() => {
        const existing = loreById.get(editingId)
        const name = editingPilot?.name ?? existing?.name ?? editingId
        return existing ? { ...existing, name } : { id: editingId, name, chapters: [] }
      })()

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">

      {/* 麵包屑 */}
      <div className="flex items-center gap-2 text-xs text-text-dim mb-4">
        {/* 故事館協作編輯（PLAN-042-H）進不了後台首頁，麵包屑就不給他一個會被導走的連結 */}
        {isAdmin ? (
          <Link to="/admin" className="hover:text-text-secondary transition-colors no-underline">後台管理</Link>
        ) : (
          <span>故事館協作</span>
        )}
        <span>›</span>
        <span className="text-accent-cyan">故事館</span>
      </div>

      {/* 頁首 */}
      <div className="mb-6">
        <div className="text-[10px] font-[Orbitron,sans-serif] tracking-[3px] text-accent-cyan uppercase mb-1">
          Admin · Lore
        </div>
        <h1 className="text-2xl font-bold text-text-primary">故事館編輯台</h1>
        <p className="text-text-dim text-sm mt-1">
          {view === 'mechs' || view === 'makers'
            ? '一台機甲的型號、廠商、介紹、技術檔案、系譜、塗裝名稱與逸聞章節都在這裡編。名字、類型、品質、登場版本在「機甲管理」。'
            : '一位機師的英文名、簡介、人物檔案、逸聞章節、陣營徽章與外觀名稱都在這裡編。名字、全名、職業、陣營在「機師管理」。'}
        </p>
      </div>

      <div className="flex gap-1 mb-5 border-b border-border" role="tablist">
        {VIEWS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`px-4 py-2 -mb-px text-sm border-b-2 transition-colors ${
              view === v ? 'border-accent-cyan text-accent-cyan' : 'border-transparent text-text-dim hover:text-text-secondary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'emblems' ? (
        <FactionEmblemsEditor focus={params.get('emblem')} />
      ) : view === 'mechs' ? (
        <MechLoreAdmin />
      ) : view === 'makers' ? (
        <MechMakersEditor />
      ) : error ? (
        <div className="rounded-xl border border-accent-red/40 bg-accent-red/10 px-4 py-3">
          <p className="text-accent-red text-sm font-bold">⚠ 資料載入失敗</p>
          <p className="text-text-secondary text-xs mt-1 break-all">{error.message}</p>
          <p className="text-text-dim text-xs mt-2">
            編輯台需要完整的既有資料才能安全覆寫，故載入失敗時不開放編輯。
          </p>
        </div>
      ) : loading ? (
        <p className="text-text-dim text-sm text-center py-10">載入中...</p>
      ) : (
        <>
          <DraftRestoreBar
            draft={draft}
            onRestore={(d) => { setRestored(d); openEditor(d.id) }}
          />

          {/* 全站完成度（D-3）：全部從資料推導，不存任何狀態欄位 */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
            <Stat label="簡介" value={summary.intro} total={summary.pilots} />
            <Stat label="人物檔案" value={summary.dossier} total={summary.pilots} />
            <Stat label="有逸聞" value={summary.withChapters} total={summary.pilots} note={`共 ${summary.chapters} 章${summary.drafts ? `，草稿 ${summary.drafts}` : ''}`} />
            <Stat label="外觀已命名" value={summary.skinsDone} total={summary.skinsTotal} note="以「套」計；隱藏的算處理過" />
            <Stat label="陣營徽章" value={summary.logos} total={summary.pilots} />
          </div>

          {/* 搜尋 + 缺什麼篩選 */}
          <div className="flex flex-wrap gap-2 mb-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitSearch() }}
              placeholder="搜尋機師名稱 / ID 片段..."
              className="flex-1 min-w-[180px] px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-orange"
            />
            <div className="flex gap-1 flex-wrap">
              {GAP_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setFilter('gap', o.value)}
                  className={`px-3 py-2 rounded-lg text-xs border transition-colors ${
                    filters.gap === o.value
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
          </p>

          <div className="space-y-1.5">
            {items.map((p) => {
              const pr = progress.get(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left bg-bg-card border border-border rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-border-accent transition-colors"
                  onClick={() => { setRestored(null); openEditor(p.id) }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-text-primary truncate">{p.name}</span>
                      <span className="text-[11px] font-mono text-text-dim truncate">{p.id}</span>
                    </div>
                    {pr && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        <Chip ok={pr.hasIntro}>{pr.hasIntro ? '簡介' : '缺簡介'}</Chip>
                        <Chip ok={pr.dossierFields > 0}>{pr.dossierFields ? `檔案 ${pr.dossierFields} 欄` : '缺檔案'}</Chip>
                        <Chip ok={pr.chapters - pr.drafts > 0} muted={pr.chapters === 0}>
                          {pr.chapters} 章{pr.drafts ? `（草稿 ${pr.drafts}）` : ''}
                        </Chip>
                        {pr.skinsTotal > 0 && (
                          <Chip ok={pr.skinsDone === pr.skinsTotal}>外觀 {pr.skinsDone}/{pr.skinsTotal}</Chip>
                        )}
                        <Chip ok={pr.hasLogo}>{pr.hasLogo ? '徽章' : '缺徽章'}</Chip>
                      </div>
                    )}
                  </div>
                  <span className="text-text-dim text-sm shrink-0" aria-hidden>›</span>
                </button>
              )
            })}
            {items.length === 0 && (
              <p className="text-text-dim text-sm text-center py-8">找不到符合條件的機師</p>
            )}
          </div>

          <LoadMoreButton hasMore={hasMore} loading={false} onClick={loadMore} />
        </>
      )}

      {view === 'pilots' && editingDoc && (
        <LoreEditPanel
          // 換人、或在同一位身上改成還原草稿 → 整個 remount，useState 的 initializer 自然重跑
          key={`${editingDoc.id}:${restored?.id === editingDoc.id ? 'draft' : 'db'}`}
          doc={editingDoc}
          pilot={editingPilot}
          onSave={handleSave}
          onCancel={() => { draft.discard(); closeEditor() }}
        />
      )}
    </div>
  )
}

type LoreView = 'pilots' | 'mechs' | 'emblems' | 'makers'
const VIEWS: readonly (readonly [LoreView, string])[] = [['pilots', '機師'], ['mechs', '機甲'], ['emblems', '陣營徽章'], ['makers', '機甲廠商']]

function Stat({ label, value, total, note }: { label: string; value: number; total: number; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-2" title={note}>
      <div className="text-[11px] text-text-dim">{label}</div>
      <div className="text-sm font-bold text-text-primary">
        {value}<span className="text-text-dim font-normal"> / {total}</span>
      </div>
      {note && <div className="text-[10px] text-text-dim truncate">{note}</div>}
    </div>
  )
}

function Chip({ ok, muted, children }: { ok: boolean; muted?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`text-[11px] px-1.5 py-0.5 rounded border ${
        ok
          ? 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan'
          : muted
            ? 'bg-bg-dark border-border text-text-dim'
            : 'bg-accent-yellow/10 border-accent-yellow/30 text-accent-yellow'
      }`}
    >
      {children}
    </span>
  )
}
