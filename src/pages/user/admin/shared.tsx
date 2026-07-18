import { useState, useEffect, useRef, useCallback } from 'react'

// ── 後台內容區共用寬度（PLAN-033）───────────────────────────────────────────────
// 編輯彈窗（AdminModal）與列表容器（AdminPage）共用同一個值，避免兩者寬度各自漂移。
// ⚠ 必須維持完整字面量字串：Tailwind 是掃描原始碼文字來產生 CSS 的，
//   若拆成 `max-w-[min(${a},${b})]` 之類的樣板字串就掃不到，會靜默無樣式。
export const ADMIN_WIDE_MAX_W = 'max-w-[min(90vw,1920px)]'

// ── 後台表單格線（PLAN-033 Phase B）─────────────────────────────────────────────
// 同質短欄位群（數值、短下拉）專用：auto-fill 依實際可用寬度自動決定欄數——
// 欄位多就排滿一列，欄位少就靠左留白、不被撐胖。
//   ⚠ 是 auto-fill 不是 auto-fit：auto-fit 會收合空軌道、讓現有欄位吃掉整列寬度，
//     正好是本階段要消滅的「胖輸入框」。兩者只差一個字，行為相反。
// 量的是元素自身寬度而非視窗，所以窄版彈窗（max-w-2xl）與巢狀卡片內都會自動縮成
// 較少欄，不需要另外配斷點。
//   ⚠ 異質長欄位群不要套用——自由文字（名稱）、圖片路徑、textarea 本來就該吃滿寬度。
//   ⚠ 必須維持完整字面量字串，Tailwind 才掃得到。調整密度改下面的 220px 即全站生效。
export const GRID_AUTO_FIELDS = 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))]'

// ── Field：帶標籤的表單欄位包裝 ────────────────────────────────────────────────
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-text-dim mb-1 block">{label}</label>
      {children}
    </div>
  )
}

// ── TabButton：頂層分頁按鈕（AdminPage 用）────────────────────────────────────
export function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? 'bg-accent-orange text-black'
          : 'bg-bg-dark border border-border text-text-secondary hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  )
}

// ── AdminLoadGate：分頁資料延遲載入閘門（降低查詢量）────────────────────────────
// 各分頁預設不自動載入。管理者需「使用篩選」或「點擊載入」才向 Firestore 查詢。
// searchable=true 時提供搜尋框，輸入的關鍵字會帶入該分頁的篩選條件。
export function AdminLoadGate({
  searchable,
  onLoad,
}: {
  searchable: boolean
  onLoad: (initialSearch: string) => void
}) {
  const [q, setQ] = useState('')
  return (
    <div className="flex flex-col items-center text-center py-12 px-4">
      <div className="text-4xl mb-3">🗂️</div>
      <h3 className="text-lg font-bold mb-1.5">資料尚未載入</h3>
      <p className="text-text-secondary text-sm max-w-md mb-5 leading-relaxed">
        為降低資料庫查詢量，後台資料不會自動載入。
        {searchable ? '輸入名稱開頭搜尋，或直接瀏覽（皆分頁載入）。' : '請點擊下方按鈕載入此分頁資料。'}
      </p>
      {searchable && (
        <div className="flex gap-2 w-full max-w-sm mb-3">
          <input
            autoFocus
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) onLoad(q.trim()) }}
            placeholder="搜尋名稱 / ID..."
            className="flex-1 px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-orange"
          />
          <button
            onClick={() => onLoad(q.trim())}
            disabled={!q.trim()}
            className="px-4 py-2 bg-accent-orange text-black text-sm font-bold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            搜尋載入
          </button>
        </div>
      )}
      <button
        onClick={() => onLoad('')}
        className={searchable
          ? 'px-4 py-2 border border-border text-text-secondary text-sm rounded-lg hover:bg-bg-dark transition-colors'
          : 'px-5 py-2.5 bg-accent-orange text-black text-sm font-bold rounded-lg hover:opacity-90 transition-opacity'}
      >
        {searchable ? '瀏覽全部' : '載入資料'}
      </button>
    </div>
  )
}

// ── useServerPaged：後台列表的伺服器端分頁 + 條件查詢 ────────────────────────────
// 取代「整包載入 + 前端過濾」：只抓符合條件的文件，分頁載入更多。
//  • 文字搜尋（按 Enter / 按鈕觸發）→ 伺服器端 name 開頭比對
//  • 下拉條件 → 瀏覽模式時送伺服器端等值查詢；文字模式時改由 matchFilters 前端即時過濾
//  • matchFilters 一律套用於回傳項目，確保非等值類條件（陣列、計算欄位）也能生效
export interface ServerPage<T> { items: T[]; hasMore: boolean; cursor: unknown }

export interface UseServerPagedArgs<T, F> {
  fetchPage: (opts: {
    namePrefix: string
    equals: Record<string, string | number | boolean | null>
    cursor: unknown
    pageSize: number
  }) => Promise<ServerPage<T>>
  initialFilters: F
  /** 由目前下拉條件組出伺服器端等值查詢（只放可用等值表達、免複合索引的欄位）。 */
  toEquals: (filters: F) => Record<string, string | number | boolean | null>
  /** 前端條件比對（涵蓋所有下拉條件；瀏覽模式下對伺服器已過濾者為冪等）。 */
  matchFilters: (item: T, filters: F) => boolean
  initialSearch?: string
  pageSize?: number
}

export function useServerPaged<T extends { id: string }, F>({
  fetchPage, initialFilters, toEquals, matchFilters, initialSearch = '', pageSize = 30,
}: UseServerPagedArgs<T, F>) {
  const [search, setSearch]             = useState(initialSearch)
  const [activeSearch, setActiveSearch] = useState(initialSearch)
  const [filters, setFilters]           = useState<F>(initialFilters)
  const [rawItems, setRawItems]         = useState<T[]>([])
  const [loading, setLoading]           = useState(false)
  const [hasMore, setHasMore]           = useState(false)
  const [error, setError]               = useState<string | null>(null)

  const cursorRef = useRef<unknown>(null)

  const runQuery = useCallback(async (term: string, flt: F, append: boolean) => {
    const textMode = term.trim().length > 0
    setLoading(true)
    setError(null)
    try {
      const res = await fetchPage({
        namePrefix: term,
        equals: textMode ? {} : toEquals(flt),
        cursor: append ? cursorRef.current : null,
        pageSize,
      })
      cursorRef.current = res.cursor
      setHasMore(res.hasMore)
      setRawItems(prev => (append ? [...prev, ...res.items] : res.items))
    } catch (e) {
      // 若某條件組合需要 Firestore 複合索引，錯誤訊息會帶建立索引的連結
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [fetchPage, toEquals, pageSize])

  // 首次掛載依閘門帶入的搜尋字串載入第一頁
  useEffect(() => { void runQuery(initialSearch, initialFilters, false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const submitSearch = useCallback(() => {
    setActiveSearch(search)
    void runQuery(search, filters, false)
  }, [search, filters, runQuery])

  const setFilter = useCallback(<K extends keyof F>(key: K, value: F[K]) => {
    setFilters(prev => {
      const next = { ...prev, [key]: value } as F
      // 瀏覽模式下，只有伺服器端條件真的改變才重查（避免純前端條件造成多餘查詢）
      if (activeSearch.trim().length === 0 &&
          JSON.stringify(toEquals(prev)) !== JSON.stringify(toEquals(next))) {
        void runQuery('', next, false)
      }
      return next
    })
  }, [activeSearch, runQuery, toEquals])

  const loadMore = useCallback(() => { void runQuery(activeSearch, filters, true) }, [activeSearch, filters, runQuery])

  const upsert = useCallback((item: T) => {
    setRawItems(prev => {
      const exists = prev.some(i => i.id === item.id)
      return exists ? prev.map(i => (i.id === item.id ? item : i)) : [item, ...prev]
    })
  }, [])

  const items = rawItems.filter(i => matchFilters(i, filters))

  return { items, loading, error, hasMore, search, setSearch, filters, setFilter, submitSearch, loadMore, upsert, activeSearch }
}

// ── useClientPaged：整包快取 + 前端片段搜尋 + 前端分頁 ──────────────────────────
// 搭配 GameDataContext 的版本快取使用：整個集合已在記憶體（命中快取＝0 讀取），
// 因此可做 name / id「任意位置片段」比對，並以前端分頁限制單次渲染的列數。
// 介面與 useServerPaged 對齊，分頁元件可最小改動替換；清單直接讀 source，
// 儲存後由 patchCollectionItem 就地更新來源，故 upsert 為相容用的空操作。
export interface UseClientPagedArgs<T, F> {
  /** 來自 GameDataContext 的整包集合（已由 AdminPage ensureLoaded 載入）。 */
  source: T[]
  initialFilters: F
  /** 下拉條件比對（涵蓋所有條件，前端即時過濾）。 */
  matchFilters: (item: T, filters: F) => boolean
  /** 文字片段比對；預設比對 name 與 id（轉小寫、includes 任意位置）。 */
  matchText?: (item: T, lowerQuery: string) => boolean
  initialSearch?: string
  pageSize?: number
}

function defaultMatchText<T extends { id: string }>(item: T, q: string): boolean {
  const name = (item as { name?: string }).name
  return (name ? name.toLowerCase().includes(q) : false) || item.id.toLowerCase().includes(q)
}

export function useClientPaged<T extends { id: string }, F>({
  source, initialFilters, matchFilters, matchText, initialSearch = '', pageSize = 30,
}: UseClientPagedArgs<T, F>) {
  const [search, setSearchState] = useState(initialSearch)
  const [filters, setFilters]    = useState<F>(initialFilters)
  const [page, setPage]          = useState(1)

  // 改搜尋字串 / 改條件 → 回到第一頁（避免停在超出新結果集的頁碼）
  const setSearch    = useCallback((v: string) => { setSearchState(v); setPage(1) }, [])
  const submitSearch = useCallback(() => setPage(1), [])
  const loadMore     = useCallback(() => setPage(p => p + 1), [])
  const setFilter = useCallback(<K extends keyof F>(key: K, value: F[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }) as F)
    setPage(1)
  }, [])

  const q       = search.trim().toLowerCase()
  const test    = matchText ?? defaultMatchText
  const matched = source.filter(i => (!q || test(i, q)) && matchFilters(i, filters))
  const items   = matched.slice(0, page * pageSize)
  const hasMore = matched.length > items.length

  // 清單直接讀 GameDataContext，儲存後由 patchCollectionItem 就地更新來源 → 此處留空。
  const upsert = useCallback((_item: T) => {}, [])

  return {
    items, loading: false, error: null as string | null, hasMore,
    search, setSearch, filters, setFilter, submitSearch, loadMore, upsert,
    activeSearch: search,
  }
}

// ── LoadMoreButton：分頁「載入更多」按鈕 ───────────────────────────────────────
export function LoadMoreButton({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null
  return (
    <div className="mt-4 text-center">
      <button
        onClick={onClick}
        disabled={loading}
        className="px-6 py-2 rounded-xl border border-border bg-bg-dark text-text-secondary text-sm hover:border-border-accent hover:text-text-primary transition-colors disabled:opacity-50"
      >
        {loading ? '載入中...' : '載入更多'}
      </button>
    </div>
  )
}

// ── AdminModal：各 EditPanel 共用彈窗殼層 ─────────────────────────────────────
// children 應包含：標題、(可選 Tab 列)、overflow-y-auto flex-1 捲動區
// 彈窗殼自帶：錯誤行、儲存/取消按鈕列
//
// 寬度（PLAN-033）：預設 min(90vw, 1920px)。後台維護者只用 PC、不考慮手機，
//   故放寬到接近滿版；1920px 上限僅為防止超寬螢幕（3440px+）把彈窗撐到荒謬寬度，
//   在 2133px 以下的視窗完全不會觸發。欄位少的編輯器（Glossary / NeuralDrive /
//   Skill）顯式傳 max-w-2xl 維持窄版——撐寬只會讓兩三個欄位漂在一片空白裡。
//   ⚠ 不可改用 w-[90vw]：殼層已有 w-full，兩者都在設 width，勝負取決於 Tailwind
//     產生的 CSS 規則順序而非你寫的 class 順序。用 max-w-* 才是確定行為。
// ⚠ 這裡刻意「不」加 Tailwind 的容器查詢工具類（PLAN-033 踩過的坑，別加回來）：
//   它會套用 container-type:inline-size，而該值隱含 contain:layout——layout containment
//   會讓此元素成為 position:fixed 子孫的 containing block。多個編輯器在彈窗內使用
//   IconField（components/admin/IconPicker），該元件是 `fixed inset-0` 的全螢幕浮層，
//   一旦套上就會改對齊彈窗的框而非視窗，浮層直接錯位。
//   內部格線改用 GRID_AUTO_FIELDS（見下方）達成同樣目的，且它量的是元素自身寬度，
//   本來就不需要容器查詢。
//   （註：產出的 CSS 裡可能仍看得到該 utility 的定義，那是 Tailwind 掃描器不解析語法、
//     只抓字串所致——連 docs/ 的 PLAN 文件在討論它時的字面量都會被掃到（copy-docs 會把
//     docs 複製進 public/）。那是無元素套用的死規則，判斷有沒有踩雷要看「元素上有沒有這個
//     class」，不是看 CSS 裡有沒有這條規則。）
export function AdminModal({
  maxWidth = ADMIN_WIDE_MAX_W,
  saving,
  error,
  onSave,
  saveLabel = '儲存變更',
  onCancel,
  children,
}: {
  maxWidth?: string
  saving: boolean
  error: string | null
  onSave: () => void
  saveLabel?: string
  onCancel: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className={`bg-bg-card border border-border rounded-xl p-6 w-full ${maxWidth} max-h-[90vh] flex flex-col`}>
        {children}
        {error && <p className="text-xs text-accent-red mt-3 shrink-0">⚠ {error}</p>}
        <div className="flex gap-3 mt-4 shrink-0">
          <button
            onClick={onSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-accent-orange text-black font-bold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? '儲存中...' : saveLabel}
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 border border-border text-text-secondary rounded-lg hover:bg-bg-dark transition-colors disabled:opacity-50"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

// ── useNewItemCreation：新建 ID 對話框邏輯（模組/武器/元件共用）─────────────────
// 兩種模式（PLAN-020）：
//  • 預設（不傳 deriveId）：維護者手打文件 ID，沿用既有行為（撞名為精準比對）。
//  • deriveId 模式：輸入框收「名稱」，ID 由 deriveId(name) 系統生成；
//    confirmCreate 先生成 ID 再做 in-memory 撞名檢查；空 slug（生成 ID 為空）擋下。
//    撞名比對「不分大小寫」——Firestore 文件 ID 區分大小寫，buff_x 與 BUFF_x
//    是兩筆不同文件，會造成大小寫孿生；deriveId 模式一律視為重複並擋下。
// makeDefault 第二參數 name 在預設模式下等於 ID（呼叫端可忽略），故向後相容。
export function useNewItemCreation<T>(
  existingItems: T[],
  getId: (item: T) => string,
  makeDefault: (id: string, name: string) => T,
  deriveId?: (name: string) => string,
) {
  const [creating, setCreating] = useState(false)
  const [newId, setNewId]       = useState('')
  const [newIdError, setNewIdError] = useState('')

  // deriveId 模式下 newId 存的是「名稱」，derivedId 為即時預覽用的生成 ID。
  const deriveMode = !!deriveId
  const derivedId  = deriveId ? deriveId(newId) : newId.trim()

  function openCreate()  { setCreating(true); setNewId(''); setNewIdError('') }
  function cancelCreate() { setCreating(false) }

  function confirmCreate(): T | null {
    const name = newId.trim()
    const id   = deriveId ? deriveId(name) : name
    if (!id) {
      setNewIdError(deriveMode ? '名稱無法產生有效 ID，請改用其他名稱' : '請輸入 ID')
      return null
    }
    // deriveId 模式：ID 不分大小寫都視為重複（擋掉 buff_x 與 BUFF_x 的大小寫孿生）
    const lower = id.toLowerCase()
    const clash = deriveMode
      ? existingItems.find((item) => getId(item).toLowerCase() === lower)
      : existingItems.find((item) => getId(item) === id)
    if (clash) {
      const clashId = getId(clash)
      setNewIdError(deriveMode
        ? `已有同名項目（ID：${clashId}），請改名或編輯既有項目`
        : `ID「${id}」已存在`)
      return null
    }
    setCreating(false); setNewId(''); setNewIdError('')
    return makeDefault(id, name)
  }

  return { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate, derivedId, deriveMode }
}

// ── NewItemDialog：新建 ID 輸入框 UI ─────────────────────────────────────────
// deriveMode（PLAN-020）：輸入框收「名稱」，下方即時預覽系統生成的唯讀 ID；
// 生成 ID 為空（名稱無有效字元）時提示並停用「建立」。extra 供額外欄位（如分類選擇）。
export function NewItemDialog({
  creating,
  newId,
  newIdError,
  placeholder,
  hint,
  onChangeId,
  onConfirm,
  onCancel,
  deriveMode = false,
  derivedId = '',
  extra,
}: {
  creating: boolean
  newId: string
  newIdError: string
  placeholder: string
  hint: React.ReactNode
  onChangeId: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
  deriveMode?: boolean
  derivedId?: string
  extra?: React.ReactNode
}) {
  if (!creating) return null
  const slugEmpty   = deriveMode && newId.trim().length > 0 && derivedId.length === 0
  const confirmable = !deriveMode || derivedId.length > 0
  return (
    <div className="mb-4 p-4 bg-bg-dark border border-accent-orange/40 rounded-xl">
      <p className="text-xs text-text-dim mb-2 font-medium">{hint}</p>
      <div className="flex gap-2">
        <input
          autoFocus
          type="text"
          value={newId}
          onChange={(e) => onChangeId(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && confirmable) onConfirm() }}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 rounded-lg bg-bg-card border border-border text-text-primary text-sm focus:outline-none focus:border-accent-orange"
        />
        <button
          onClick={onConfirm}
          disabled={!confirmable}
          className="px-4 py-2 bg-accent-orange text-black text-sm font-bold rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          建立
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-2 border border-border text-text-secondary text-sm rounded-lg hover:bg-bg-card"
        >
          取消
        </button>
      </div>
      {extra && <div className="mt-2">{extra}</div>}
      {deriveMode && (
        <p className="text-xs mt-2">
          {derivedId ? (
            <>
              將建立文件 ID：<span className="text-accent-cyan font-mono">{derivedId}</span>
              <span className="text-text-dim">（系統生成、儲存後不可更改）</span>
            </>
          ) : slugEmpty ? (
            <span className="text-accent-red">⚠ 名稱無法產生有效 ID，請改用其他名稱</span>
          ) : (
            <span className="text-text-dim">輸入名稱後將自動生成文件 ID</span>
          )}
        </p>
      )}
      {newIdError && <p className="text-xs text-accent-red mt-1.5">⚠ {newIdError}</p>}
    </div>
  )
}
