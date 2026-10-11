// 登場版本的兩層篩選（2026-10-11）—— 機甲圖鑑與機師圖鑑共用
//
// 平常只有一列：全部 ／ v3.x ／ v2.x ／ v1.x。選了大版本，同一列接著展開它的小版本
// （「全部 3.x」＋各小版本，較小一號），任何一個版本仍是兩下就點得到。
// 為什麼這樣排、篩選值的形狀，見 utils/versionFilter.ts。
//
// 點擊規則（沿用圖鑑其他篩選「再點一次＝取消」的手感）：
//   · 點大版本：切到「整個大版本」；再點一次已選中的大版本 ⇒ 回到全部（收起）
//   · 點小版本：只看那一版；再點一次已選中的小版本 ⇒ 回到「整個大版本」（不是全部 —— 人還在這一組裡）
import { useMemo } from 'react'
import {
  groupVersionsByMajor, majorFilterValue, majorOfFilter, isMajorFilter,
  type VersionFilterValue,
} from '../../utils/versionFilter'

/** 與兩個圖鑑頁的 filterBtn 同一套外觀 */
const chip = (active: boolean, small = false) =>
  `${small ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'} rounded-lg font-medium border transition-colors cursor-pointer ${
    active
      ? 'bg-accent-orange/15 text-accent-orange border-accent-orange/40'
      : 'bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary'
  }`

export function VersionFilter({
  versions,
  value,
  onChange,
  label = '登場版本',
}: {
  /** 資料中出現過的所有登場版本（可重複、可含空字串，元件自己整理） */
  versions: readonly string[]
  value: VersionFilterValue
  onChange: (next: VersionFilterValue) => void
  label?: string
}) {
  const groups = useMemo(() => groupVersionsByMajor(versions), [versions])
  if (groups.length === 0) return null   // 全空時整區隱藏（與改版前一致）

  const activeMajor = majorOfFilter(value)
  const expanded = groups.find((g) => g.major === activeMajor)

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <span className="text-xs text-text-dim mr-1">{label}</span>
      <button type="button" className={chip(!value)} onClick={() => onChange('')}>全部</button>
      {groups.map((g) => {
        const active = activeMajor === g.major
        return (
          <button
            key={g.major}
            type="button"
            aria-expanded={active}
            className={chip(active)}
            onClick={() => onChange(active ? '' : majorFilterValue(g.major))}
          >
            v{g.major}.x
          </button>
        )
      })}

      {expanded && (
        <>
          {/* 分隔線：第二層是「這個大版本裡面」，不是又多一排同級的選項 */}
          <span aria-hidden className="w-px h-5 bg-border mx-1" />
          <button
            type="button"
            className={chip(isMajorFilter(value), true)}
            onClick={() => onChange(majorFilterValue(expanded.major))}
          >
            全部 {expanded.major}.x
          </button>
          {expanded.versions.map((v) => {
            const active = value === v
            return (
              <button
                key={v}
                type="button"
                className={chip(active, true)}
                onClick={() => onChange(active ? majorFilterValue(expanded.major) : v)}
              >
                {v}
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}
