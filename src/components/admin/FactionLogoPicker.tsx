import { useEffect, useMemo, useState } from 'react'
import { FactionLogo } from '../icons/FactionLogo'
import { loadIconIndex, peekIconIndex } from './gameIconIndex'
import { useGameData } from '../../contexts/GameDataContext'
import {
  FACTION_LOGO_MAX, isMonoLogo, logoNumber, type LogoSuggestion,
} from '../../utils/factionLogos'
import {
  emblemCatalog, emblemName, emblemTitle, emblemsById, isNamed, matchEmblem, rankEmblems, suggestedEmblemNums,
} from '../../utils/factionEmblems'

// ─── 陣營徽章選圖器（PLAN-059 D-2；PLAN-042-F D-2 改版）─────────────────────────
//
// 給機師故事館編輯台用：每位機師挑 0～2 個官方陣營徽章（pilotLore.factionLogos）。
//
// PLAN-042-F：徽章有了名稱與圖上字樣（factionEmblems，編輯台「陣營徽章」分頁維護）——
//   卡片放大、標名稱，可用名稱／字樣／編號搜尋；排序「建議 → 已命名 → 未命名」。
//   建議＝註記的「對應的陣營文字」等於這位機師的陣營，或同陣營的其他機師已選。**只排序、不代選。**
//   註記讀不到（rules／Worker 未部署）時照樣能選，只是全部顯示成編號——不擋編輯。
//
// ⚠ 預覽一律鋪在**紙色底**（扉頁的實際底色），不用後台的暗色：單色版 _00 在紙上是墨色印章，
//   白字的彩色版（如 HORIZON）在紙上會看不清——選的當下就看得出來，不必上前台才發現。
//   後台本身是暗色主題，所以這裡的紙色與墨色寫死，不吃館內的 token。

const PAPER = 'bg-[#efe7d8] text-[#2b2621]'

export function FactionLogoPicker({
  value, onChange, faction, suggestions,
}: {
  /** 已正規化（normalizeFactionLogos）的目前值 */
  value: string[]
  onChange: (next: string[]) => void
  /** 這位機師的陣營文字（pilots.faction）：建議的比對依據與出處 */
  faction?: string
  suggestions: LogoSuggestion[]
}) {
  const { factionEmblems, ensureLoaded } = useGameData()
  useEffect(() => { void ensureLoaded(['factionEmblems']) }, [ensureLoaded])

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

  const byId = useMemo(() => emblemsById(factionEmblems), [factionEmblems])
  const entries = useMemo(() => emblemCatalog(keys ?? [], factionEmblems), [keys, factionEmblems])
  const suggested = useMemo(() => suggestedEmblemNums(faction, entries, suggestions), [faction, entries, suggestions])
  const shown = useMemo(
    () => rankEmblems(entries.filter((en) => matchEmblem(en, search)), suggested),
    [entries, search, suggested],
  )
  const named = entries.filter(isNamed).length
  const labelOf = (k: string) => emblemName(k, byId) ?? logoNumber(k) ?? k

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
            <FactionLogo logoKey={k} size={36} />
            <span className="font-bold">{labelOf(k)}</span>
            <span className="text-[#948a7e]">{isMonoLogo(k) ? '單色' : '彩色'}</span>
            <button
              type="button"
              onClick={() => toggle(k)}
              className="ml-0.5 text-[#948a7e] hover:text-[#b10000] cursor-pointer"
              aria-label={`移除 ${labelOf(k)}`}
            >
              ×
            </button>
          </span>
        )) : (
          <span className="text-xs text-[#948a7e]">尚未選擇——扉頁照舊顯示文字圓環</span>
        )}
      </div>

      {/* 同陣營建議：其他機師已選的組合，一鍵套用 */}
      {suggestions.length > 0 && (
        <div className="rounded-lg border border-dashed border-accent-cyan/40 px-3 py-2 text-xs text-text-secondary space-y-1.5">
          <div>同樣寫「<b className="text-text-primary">{faction}</b>」的其他機師已選：</div>
          {suggestions.slice(0, 3).map((s) => (
            <div key={s.logos.join('|')} className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 ${PAPER}`}>
                {s.logos.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1">
                    <FactionLogo logoKey={k} size={28} />
                    <span className="text-[11px]">{labelOf(k)}</span>
                  </span>
                ))}
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
          placeholder="搜尋中英文名稱、圖上字樣或編號"
          className="input-field text-sm w-64"
        />
        <span className="text-[11px] text-text-dim">
          {keys ? `${entries.length} 個徽章・已命名 ${named}・點單色或彩色版選取` : loadError ? '' : '載入中…'}
        </span>
        {hint && <span className="text-[11px] text-accent-yellow">{hint}</span>}
      </div>
      {loadError && <p className="text-xs text-accent-red">⚠ {loadError}</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2 max-h-[30rem] overflow-y-auto pr-1">
        {shown.map((en) => {
          const name = en.emblem?.name?.trim()
          const picked = value.some((k) => logoNumber(k) === en.num)
          return (
            <div
              key={en.num}
              className={`rounded-lg border-2 px-1.5 pt-1.5 pb-1 ${PAPER} ${
                picked ? 'border-[#c2410c]' : suggested.has(en.num) ? 'border-accent-cyan/60' : 'border-[#d3c7b2]'
              }`}
            >
              <div className="flex justify-center gap-1">
                {[en.mono, en.color].map((k, i) => k ? (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggle(k)}
                    title={`${emblemTitle(k, byId) ?? en.num}・${i === 0 ? '單色（扉頁上會是墨色）' : '彩色（原樣）'}`}
                    className={`w-[84px] h-[84px] grid place-items-center rounded-md border-2 transition-colors cursor-pointer ${
                      value.includes(k) ? 'border-[#c2410c] bg-[#c2410c]/10' : 'border-transparent hover:border-[#b9ab92]'
                    }`}
                  >
                    <FactionLogo logoKey={k} size={76} />
                  </button>
                ) : (
                  <span key={i} className="w-[84px] h-[84px] grid place-items-center text-[10px] text-[#b9ab92]">—</span>
                ))}
              </div>
              <div className="mt-1 text-center leading-tight">
                {name ? (
                  <div className="text-[13px] font-bold">{name}</div>
                ) : (
                  <a
                    href={`${import.meta.env.BASE_URL}admin/lore?view=emblems&emblem=${en.num}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] text-[#948a7e] hover:text-[#c2410c] no-underline"
                    title="在新分頁打開「陣營徽章」分頁補名稱（不會關掉這裡的編輯）"
                  >
                    未命名・補名稱 ↗
                  </a>
                )}
                {en.emblem?.nameEn && (
                  <div className="text-[11px] text-[#6b6259] truncate" title={en.emblem.nameEn}>{en.emblem.nameEn}</div>
                )}
                <div className="font-mono text-[10.5px] text-[#948a7e] truncate" title={en.emblem?.inscription}>
                  {en.num}{en.emblem?.inscription && en.emblem.inscription !== en.emblem.nameEn ? ` · ${en.emblem.inscription}` : ''}
                </div>
                {suggested.has(en.num) && <div className="text-[10.5px] text-[#0e7490]">建議</div>}
              </div>
            </div>
          )
        })}
        {keys && shown.length === 0 && <p className="text-xs text-text-dim col-span-full py-4 text-center">找不到符合的徽章</p>}
      </div>
    </div>
  )
}
