import { useEffect, useMemo, useState } from 'react'
import { resolveIconSrc } from '../../utils/assets'

/**
 * 後台「選取圖片」挑選器。
 *
 * 來源為本地 public/images（由 scripts/generate-image-manifest.mjs 產生
 * images/manifest.json）。讓維護者直接從各資料夾挑選 icon，免手填路徑。
 * 選定後寫回的值統一為 "/images/<folder>/<file>"（前台以 resolveIconSrc 套 BASE_URL）。
 *
 * - IconPicker：彈窗本體（資料夾下拉 + 搜尋 + 縮圖網格）。
 * - IconField ：帶標籤的欄位（文字輸入 + 旁附預覽縮圖 + 開啟挑選器按鈕），
 *               各後台編輯面板直接使用。
 */

export interface Manifest {
  folders: Record<string, string[]>
}

// 模組層級快取：整個 session 只 fetch 一次 manifest
let manifestCache: Manifest | null = null
let manifestPromise: Promise<Manifest> | null = null

export function loadManifest(): Promise<Manifest> {
  if (manifestCache) return Promise.resolve(manifestCache)
  if (!manifestPromise) {
    // ?v=__BUILD_ID__：manifest.json 位於 public/，網址永遠不變、內容卻每次加圖都會變，
    // 而 CDN 會邊緣快取它（Cloudflare 預設 4 小時），導致新加的圖在後台挑不到且無法靠
    // 重新整理解決。每次部署換一個 query 即換一個快取鍵，必定取到當次建置的清單。
    const url = `${import.meta.env.BASE_URL}images/manifest.json?v=${__BUILD_ID__}`
    manifestPromise = fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`圖檔清單載入失敗（${r.status}）`); return r.json() })
      .then((m: Manifest) => { manifestCache = m; return m })
      .catch((err) => { manifestPromise = null; throw err })
  }
  return manifestPromise
}

/** folder + file → 標準儲存路徑 */
function toPath(folder: string, file: string): string {
  return folder === '.' ? `/images/${file}` : `/images/${folder}/${file}`
}

const ALL = '*' // 跨資料夾搜尋的特殊 folder key
const MAX_RESULTS = 500

function folderLabel(folder: string, count: number): string {
  const name = folder === '.' ? '（根目錄）' : folder
  return `${name}（${count}）`
}

// ── 挑選器彈窗 ─────────────────────────────────────────────────────────────────
export function IconPicker({
  value,
  defaultFolder,
  onPick,
  onClose,
}: {
  value?: string
  defaultFolder?: string
  onPick: (path: string) => void
  onClose: () => void
}) {
  const [manifest, setManifest] = useState<Manifest | null>(manifestCache)
  const [error, setError]       = useState<string | null>(null)
  const [folder, setFolder]     = useState<string>(defaultFolder ?? '')
  const [search, setSearch]     = useState('')

  useEffect(() => {
    let alive = true
    loadManifest()
      .then((m) => {
        if (!alive) return
        setManifest(m)
        setFolder((f) => {
          if (f === ALL || (f && m.folders[f])) return f
          // defaultFolder 可能是「群組」（如 "skills" 對應 skills/被動技能…），退回第一個子資料夾
          if (f) {
            const sub = Object.keys(m.folders).filter((k) => k.startsWith(`${f}/`)).sort((a, b) => a.localeCompare(b, 'zh-Hant'))[0]
            if (sub) return sub
          }
          return Object.keys(m.folders).sort()[0] ?? '.'
        })
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  // 資料夾下拉選項：defaultFolder 群組（含其子資料夾，如 skills/被動技能）置頂、
  // 其次「全部」、再依字母排序
  const folderOptions = useMemo(() => {
    if (!manifest) return [] as string[]
    const keys = Object.keys(manifest.folders).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    const inGroup = (k: string) => !!defaultFolder && (k === defaultFolder || k.startsWith(`${defaultFolder}/`))
    const ordered: string[] = []
    for (const k of keys) if (inGroup(k)) ordered.push(k)
    ordered.push(ALL)
    for (const k of keys) if (!inGroup(k)) ordered.push(k)
    return ordered
  }, [manifest, defaultFolder])

  // 目前顯示的縮圖清單（folder + search 過濾）
  const results = useMemo(() => {
    if (!manifest) return [] as { folder: string; file: string }[]
    const q = search.trim().toLowerCase()
    const out: { folder: string; file: string }[] = []
    if (folder === ALL) {
      if (!q) return out // 全部資料夾須先輸入關鍵字，避免一次塞 1800+ 張
      for (const [fld, files] of Object.entries(manifest.folders)) {
        for (const file of files) {
          if (file.toLowerCase().includes(q)) {
            out.push({ folder: fld, file })
            if (out.length >= MAX_RESULTS) return out
          }
        }
      }
    } else {
      const files = manifest.folders[folder] ?? []
      for (const file of files) {
        if (!q || file.toLowerCase().includes(q)) {
          out.push({ folder, file })
          if (out.length >= MAX_RESULTS) return out
        }
      }
    }
    return out
  }, [manifest, folder, search])

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        className="bg-bg-card border border-border rounded-xl p-5 w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h3 className="text-base font-bold flex items-center gap-2">
            <span className="text-accent-orange">🖼️</span> 選取圖片
            <span className="text-text-dim text-xs font-normal">來源 public/images</span>
          </h3>
          <button onClick={onClose} className="text-text-dim hover:text-text-primary text-lg leading-none">✕</button>
        </div>

        {error ? (
          <div className="py-10 text-center text-sm text-accent-red">
            {error}
            <p className="text-text-dim text-xs mt-2">請先執行 <code>npm run manifest:images</code> 產生圖檔清單。</p>
          </div>
        ) : !manifest ? (
          <p className="py-10 text-center text-sm text-text-dim">載入圖檔清單中…</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-3 shrink-0">
              <select
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                className="input-field text-sm max-w-[260px]"
              >
                {folderOptions.map((f) =>
                  f === ALL
                    ? <option key={ALL} value={ALL}>（全部資料夾，需搜尋）</option>
                    : <option key={f} value={f}>{folderLabel(f, manifest.folders[f].length)}</option>,
                )}
              </select>
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜尋檔名…"
                className="input-field text-sm flex-1 min-w-[160px]"
              />
            </div>

            <div className="overflow-y-auto flex-1 -mx-1 px-1">
              {results.length === 0 ? (
                <p className="py-10 text-center text-sm text-text-dim">
                  {folder === ALL && !search.trim() ? '請輸入關鍵字以搜尋全部資料夾' : '找不到符合的圖檔'}
                </p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(74px,1fr))] gap-2">
                  {results.map(({ folder: fld, file }) => {
                    const path = toPath(fld, file)
                    const active = value === path
                    return (
                      <button
                        key={path}
                        type="button"
                        onClick={() => { onPick(path); onClose() }}
                        title={folder === ALL ? `${fld}/${file}` : file}
                        className={`group flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-colors ${
                          active ? 'border-accent-orange bg-accent-orange/10' : 'border-border/50 hover:border-border-accent hover:bg-bg-dark'
                        }`}
                      >
                        <img
                          src={resolveIconSrc(path)}
                          alt=""
                          loading="lazy"
                          className="w-12 h-12 object-contain"
                          onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.15')}
                        />
                        <span className="text-[10px] text-text-dim truncate max-w-full leading-tight">{file}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <p className="text-[11px] text-text-dim mt-2 shrink-0">
              顯示 {results.length}{results.length >= MAX_RESULTS ? '+（已達上限，請縮小範圍）' : ''} 張 · 點擊縮圖即套用
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ── 帶標籤的 icon 欄位（文字輸入 + 預覽 + 開啟挑選器）──────────────────────────────
export function IconField({
  label,
  value,
  onChange,
  defaultFolder,
  placeholder = '/images/... 或貼上遠端 URL',
}: {
  label: string
  value?: string
  onChange: (v: string) => void
  defaultFolder?: string
  placeholder?: string
}) {
  const [picking, setPicking] = useState(false)
  const val = value ?? ''

  return (
    <div>
      <label className="text-xs text-text-dim mb-1 block">{label}</label>
      <div className="flex items-center gap-2">
        {val ? (
          <img
            src={resolveIconSrc(val)}
            alt=""
            className="w-10 h-10 rounded object-contain border border-border/50 bg-bg-dark shrink-0"
            onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.15')}
          />
        ) : (
          <div className="w-10 h-10 rounded border border-dashed border-border/60 bg-bg-dark/50 shrink-0 flex items-center justify-center text-text-dim text-[10px]">無</div>
        )}
        <input
          type="text"
          value={val}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="input-field flex-1 text-sm"
        />
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="shrink-0 px-3 py-2 text-sm text-accent-cyan border border-accent-cyan/40 rounded-lg hover:bg-accent-cyan/10 transition-colors whitespace-nowrap"
        >
          選取圖片
        </button>
        {val && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="shrink-0 px-2 py-2 text-sm text-accent-red border border-accent-red/30 rounded-lg hover:bg-accent-red/10 transition-colors"
          >
            清除
          </button>
        )}
      </div>

      {picking && (
        <IconPicker
          value={val}
          defaultFolder={defaultFolder}
          onPick={(path) => onChange(path)}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}
