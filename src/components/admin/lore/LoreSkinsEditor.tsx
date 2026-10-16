import { useMemo } from 'react'
import type { LoreSkinSetting } from '../../../types'
import type { PilotSkinArt } from '../../../utils/gameArt'
import { assetUrl } from '../../../utils/assets'
import { moveItem } from './loreEditText'
import { ICON_BTN } from './LoreDossierEditor'

/**
 * 故事館編輯台「外觀」（機師）／「塗裝」（機甲，PLAN-042-B G-1）分頁：命名、隱藏、排序。
 *
 * **列的是 build 時的清單**（pilotSkinCatalog／mechSkinCatalog，042-E 決策六的靜態層），不是 DB——
 * 圖檔在哪、屬於誰仍由 `import-game-assets.mjs --skins`／`--mech-lore` 決定，後台沒辦法新增圖。
 * DB（pilotLore.skins／mechLore.skins）只存名稱、隱藏、順序。
 *
 * 一旦在這裡動過任何一格，就把**整份清單**依目前順序寫回 skins（每套一筆）：
 * 順序本身就是資料，只存有改過的那幾筆會讓「沒列到的接在後面」這條規則替編輯者決定順序。
 * DB 裡對不到圖檔的殘留 key 因此也會在下次存檔時自然消失（前台本來就忽略它們）。
 *
 * 預設那一套不在這裡改：機師是 pilots.artKey（圖鑑頭像也在用），機甲是官方主視覺，都留在各自的管理頁。
 */
export function LoreSkinsEditor({
  catalog, defaultSrc, defaultSub, noun = '外觀', importHint, thumbOf = defaultThumb,
  value, onChange, previewKey, onPreview,
}: {
  /** build 時的清單（含 DB 隱藏的） */
  catalog: PilotSkinArt[]
  /** 「預設」那格的縮圖（未套 BASE_URL） */
  defaultSrc: string | undefined
  /** 「預設」那格的說明，例「機師管理的立繪（artKey）」 */
  defaultSub: string
  /** 外觀／塗裝 */
  noun?: string
  /** 沒有任何一套時的提示：要跑哪個匯入指令 */
  importHint: string
  /** 每一格用哪張圖當縮圖（未套 BASE_URL） */
  thumbOf?: (s: PilotSkinArt) => string
  value: LoreSkinSetting[] | undefined
  onChange: (next: LoreSkinSetting[] | undefined) => void
  /** 預覽中的鍵；'' ＝預設 */
  previewKey: string
  onPreview: (key: string) => void
}) {
  const rows = useMemo(() => orderedRows(catalog, value), [catalog, value])
  const stale = useMemo(() => {
    const keys = new Set(catalog.map((s) => s.key))
    return (value ?? []).filter((s) => !keys.has(s.key)).map((s) => s.key)
  }, [catalog, value])

  if (!catalog.length) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-text-secondary">目前沒有其他{noun}（新增要跑 <code className="text-xs">{importHint}</code> 再部署）。</p>
        {stale.length > 0 && <StaleNote noun={noun} keys={stale} onClear={() => onChange(undefined)} />}
      </div>
    )
  }

  /** 改一格 → 整份清單依目前順序寫回 */
  const commit = (next: Row[]) => onChange(next.map(({ skin, name, hidden }) => ({
    key: skin.key,
    ...(name.trim() && { name }),
    ...(hidden && { hidden: true as const }),
  })))
  const patchRow = (i: number, p: Partial<Pick<Row, 'name' | 'hidden'>>) => commit(rows.map((r, n) => (n === i ? { ...r, ...p } : r)))

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-dim leading-relaxed">
        前台的{noun}列依這裡的順序排；沒命名的顯示「{noun} N」（N 是匯入時的序號，不隨排序變動）。
        隱藏的{noun}前台不列出，但圖仍在網站上（例如台版還沒推出時先藏起來）。點縮圖可在預覽區看舞台構圖。
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        <SkinThumb
          src={defaultSrc}
          label={`預設${noun}`}
          sub={defaultSub}
          active={previewKey === ''}
          onClick={() => onPreview('')}
          noun={noun}
        />
        {rows.map((r, i) => (
          <div key={r.skin.key} className={`rounded-xl border p-2 space-y-1.5 ${r.hidden ? 'border-dashed border-border opacity-70' : 'border-border'} bg-bg-dark`}>
            <SkinThumb
              src={thumbOf(r.skin)}
              label={r.name.trim() || r.skin.defaultLabel}
              sub={`${r.skin.key}${r.skin.scene ? ' · 場景插畫' : ''}`}
              active={previewKey === r.skin.key}
              onClick={() => onPreview(r.skin.key)}
              noun={noun}
              bare
            />
            <input
              value={r.name}
              onChange={(e) => patchRow(i, { name: e.target.value })}
              className="input-field text-xs"
              placeholder={r.skin.defaultLabel}
              aria-label={`${r.skin.key} 的名稱`}
            />
            <div className="flex items-center gap-1">
              <label className="flex items-center gap-1 text-[11px] text-text-secondary cursor-pointer mr-auto">
                <input type="checkbox" checked={r.hidden} onChange={(e) => patchRow(i, { hidden: e.target.checked })} />
                隱藏
              </label>
              <button type="button" onClick={() => commit(moveItem(rows, i, -1))} disabled={i === 0} className={ICON_BTN} title="往前">◀</button>
              <button type="button" onClick={() => commit(moveItem(rows, i, 1))} disabled={i === rows.length - 1} className={ICON_BTN} title="往後">▶</button>
            </div>
          </div>
        ))}
      </div>
      {stale.length > 0 && <StaleNote noun={noun} keys={stale} onClear={() => commit(rows)} />}
    </div>
  )
}

/** 機師外觀的縮圖：頭像 → 頭部 → 整張 Raw */
const defaultThumb = (s: PilotSkinArt) => s.half ?? s.head ?? s.raw

interface Row {
  skin: PilotSkinArt
  name: string
  hidden: boolean
}

/** 與前台 applySkinSettings() 同一套合併規則，但**不濾掉隱藏的**（編輯台要能把它們叫回來） */
function orderedRows(catalog: PilotSkinArt[], settings: LoreSkinSetting[] | undefined): Row[] {
  const byKey = new Map(catalog.map((s) => [s.key, s]))
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const st of settings ?? []) {
    const skin = byKey.get(st.key)
    if (!skin || seen.has(skin.key)) continue
    seen.add(skin.key)
    rows.push({ skin, name: st.name ?? '', hidden: st.hidden === true })
  }
  for (const skin of catalog) if (!seen.has(skin.key)) rows.push({ skin, name: '', hidden: false })
  return rows
}

function SkinThumb({ src, label, sub, active, onClick, noun, bare }: {
  src: string | undefined
  label: string
  sub: string
  active: boolean
  onClick: () => void
  noun: string
  /** 已經在卡片框裡（外觀格），不再畫自己的框 */
  bare?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full text-left rounded-lg transition-colors ${bare ? '' : 'border p-2 bg-bg-dark'} ${active ? 'ring-2 ring-accent-cyan/70' : bare ? '' : 'border-border hover:border-border-accent'}`}
      title={`在預覽區看這套${noun}`}
    >
      <span className="block aspect-square rounded-md overflow-hidden bg-black/30">
        {src ? (
          <img src={assetUrl(src)} alt="" loading="lazy" className="w-full h-full object-cover object-top" />
        ) : (
          <span className="w-full h-full grid place-items-center text-[11px] text-text-dim">預設</span>
        )}
      </span>
      <span className="block mt-1 text-xs font-bold text-text-primary truncate">{label}</span>
      <span className="block text-[10px] font-mono text-text-dim truncate">{sub}</span>
    </button>
  )
}

function StaleNote({ noun, keys, onClear }: { noun: string; keys: string[]; onClear: () => void }) {
  return (
    <p className="text-xs text-text-dim">
      ⚠ 有 {keys.length} 筆{noun}設定對不到圖檔（前台已忽略）：<span className="font-mono">{keys.join('、')}</span>
      <button type="button" onClick={onClear} className="ml-2 text-accent-cyan hover:underline">清掉</button>
    </p>
  )
}
