import { useEffect, useMemo, useState } from 'react'
import { FactionLogo } from '../icons/FactionLogo'
import { loadIconIndex, peekIconIndex } from './gameIconIndex'
import {
  FACTION_LOGO_MAX, groupLogoPairs, isMonoLogo, logoNumber, type LogoSuggestion,
} from '../../utils/factionLogos'

// ─── 陣營徽章選圖器（PLAN-059 D-2）───────────────────────────────────────────
//
// 給機師故事館編輯台用：每位機師挑 0～2 個官方陣營徽章（pilotLore.factionLogos）。
//
// ⚠ 預覽一律鋪在**紙色底**（扉頁的實際底色），不用後台的暗色：單色版 _00 在紙上是墨色印章，
//   白字的彩色版（如 HORIZON）在紙上會看不清——選的當下就看得出來，不必上前台才發現。
//   後台本身是暗色主題，所以這裡的紙色與墨色寫死，不吃館內的 token。
// ⚠ 不預填、不猜對應：沒有官方資料能把陣營文字對到徽章編號，判斷權在管理者。
//   「同陣營建議」只列其他機師**已經選好**的，一鍵套用。

const PAPER = 'bg-[#efe7d8] text-[#2b2621]'

export function FactionLogoPicker({
  value, onChange, faction, suggestions,
}: {
  /** 已正規化（normalizeFactionLogos）的目前值 */
  value: string[]
  onChange: (next: string[]) => void
  /** 這位機師的陣營文字（pilots.faction），只拿來顯示建議的出處 */
  faction?: string
  suggestions: LogoSuggestion[]
}) {
  const [keys, setKeys] = useState<string[] | null>(() => peekIconIndex()?.camp ?? null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    loadIconIndex()
      .then((m) => { if (alive) setKeys(m.camp ?? []) })
      .catch((e) => { if (alive) setLoadError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  const pairs = useMemo(() => groupLogoPairs(keys ?? []), [keys])
  const shown = useMemo(() => {
    const q = search.replace(/\D/g, '').replace(/^0+/, '')
    return q ? pairs.filter((p) => String(Number(p.num)).includes(q)) : pairs
  }, [pairs, search])

  function toggle(key: string) {
    setHint(null)
    if (value.includes(key)) { onChange(value.filter((k) => k !== key)); return }
    // 同一個編號只留一個變體：點另一個變體＝換成它
    const num = logoNumber(key)
    const sameNum = value.find((k) => logoNumber(k) === num)
    if (sameNum) { onChange(value.map((k) => (k === sameNum ? key : k))); return }
    if (value.length >= FACTION_LOGO_MAX) { setHint(`最多 ${FACTION_LOGO_MAX} 個——先移除一個再選`); return }
    onChange([...value, key])
  }

  const same = (logos: string[]) => logos.length === value.length && logos.every((k, i) => k === value[i])

  return (
    <div className="space-y-2">
      {/* 已選＋預覽 */}
      <div className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 ${PAPER}`}>
        <span className="text-[11px] text-[#6b6259]">扉頁預覽</span>
        {value.length ? value.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5 rounded-full border border-[#b9ab92] bg-white/50 py-0.5 pl-1 pr-2 text-xs">
            <FactionLogo logoKey={k} size={30} />
            <span className="font-mono">{logoNumber(k)}</span>
            <span className="text-[#948a7e]">{isMonoLogo(k) ? '單色' : '彩色'}</span>
            <button
              type="button"
              onClick={() => toggle(k)}
              className="ml-0.5 text-[#948a7e] hover:text-[#b10000] cursor-pointer"
              aria-label={`移除 ${logoNumber(k)}`}
            >
              ×
            </button>
          </span>
        )) : (
          <span className="text-xs text-[#948a7e]">尚未選擇——扉頁照舊顯示文字圓環</span>
        )}
      </div>

      {/* 同陣營建議 */}
      {suggestions.length > 0 && (
        <div className="rounded-lg border border-dashed border-accent-cyan/40 px-3 py-2 text-xs text-text-secondary space-y-1.5">
          <div>同樣寫「<b className="text-text-primary">{faction}</b>」的其他機師已選：</div>
          {suggestions.slice(0, 3).map((s) => (
            <div key={s.logos.join('|')} className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${PAPER}`}>
                {s.logos.map((k) => <FactionLogo key={k} logoKey={k} size={24} />)}
              </span>
              <span className="text-text-dim truncate max-w-[16rem]">{s.pilots.join('、')}</span>
              <button
                type="button"
                onClick={() => { setHint(null); onChange(s.logos) }}
                disabled={same(s.logos)}
                className="px-2 py-0.5 rounded border border-accent-cyan/40 text-accent-cyan hover:bg-accent-cyan/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
              >
                {same(s.logos) ? '已套用' : '套用'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 圖庫 */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋編號（例：25）"
          className="input-field text-sm w-44"
        />
        <span className="text-[11px] text-text-dim">
          {keys ? `${pairs.length} 個陣營・點單色或彩色版選取` : loadError ? '' : '載入中…'}
        </span>
        {hint && <span className="text-[11px] text-accent-yellow">{hint}</span>}
      </div>
      {loadError && <p className="text-xs text-accent-red">⚠ {loadError}</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-1.5 max-h-80 overflow-y-auto pr-1">
        {shown.map((p) => (
          <div key={p.num} className={`rounded-lg border border-[#d3c7b2] px-1 pt-1 pb-0.5 ${PAPER}`}>
            <div className="flex justify-center gap-1">
              {[p.mono, p.color].map((k, i) => k ? (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggle(k)}
                  title={`${k}（${i === 0 ? '單色：扉頁上會是墨色' : '彩色：原樣'}）`}
                  className={`w-12 h-12 grid place-items-center rounded-md border-2 transition-colors cursor-pointer ${
                    value.includes(k) ? 'border-[#c2410c] bg-[#c2410c]/10' : 'border-transparent hover:border-[#b9ab92]'
                  }`}
                >
                  <FactionLogo logoKey={k} size={40} />
                </button>
              ) : (
                <span key={i} className="w-12 h-12 grid place-items-center text-[10px] text-[#b9ab92]">—</span>
              ))}
            </div>
            <div className="text-center font-mono text-[10.5px] text-[#948a7e]">{p.num}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
