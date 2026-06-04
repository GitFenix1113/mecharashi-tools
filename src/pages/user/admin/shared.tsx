import { useState, useEffect, useRef, useCallback } from 'react'

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
export function AdminModal({
  maxWidth = 'max-w-2xl',
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
export function useNewItemCreation<T>(
  existingItems: T[],
  getId: (item: T) => string,
  makeDefault: (id: string) => T,
) {
  const [creating, setCreating] = useState(false)
  const [newId, setNewId]       = useState('')
  const [newIdError, setNewIdError] = useState('')

  function openCreate()  { setCreating(true); setNewId(''); setNewIdError('') }
  function cancelCreate() { setCreating(false) }

  function confirmCreate(): T | null {
    const trimmed = newId.trim()
    if (!trimmed) { setNewIdError('請輸入 ID'); return null }
    if (existingItems.some((item) => getId(item) === trimmed)) {
      setNewIdError(`ID「${trimmed}」已存在`)
      return null
    }
    setCreating(false); setNewId(''); setNewIdError('')
    return makeDefault(trimmed)
  }

  return { creating, newId, setNewId, newIdError, setNewIdError, openCreate, cancelCreate, confirmCreate }
}

// ── NewItemDialog：新建 ID 輸入框 UI ─────────────────────────────────────────
export function NewItemDialog({
  creating,
  newId,
  newIdError,
  placeholder,
  hint,
  onChangeId,
  onConfirm,
  onCancel,
}: {
  creating: boolean
  newId: string
  newIdError: string
  placeholder: string
  hint: React.ReactNode
  onChangeId: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!creating) return null
  return (
    <div className="mb-4 p-4 bg-bg-dark border border-accent-orange/40 rounded-xl">
      <p className="text-xs text-text-dim mb-2 font-medium">{hint}</p>
      <div className="flex gap-2">
        <input
          autoFocus
          type="text"
          value={newId}
          onChange={(e) => onChangeId(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onConfirm() }}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 rounded-lg bg-bg-card border border-border text-text-primary text-sm focus:outline-none focus:border-accent-orange"
        />
        <button
          onClick={onConfirm}
          className="px-4 py-2 bg-accent-orange text-black text-sm font-bold rounded-lg hover:opacity-90"
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
      {newIdError && <p className="text-xs text-accent-red mt-1.5">⚠ {newIdError}</p>}
    </div>
  )
}
