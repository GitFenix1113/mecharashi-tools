import type { RaidDifficulty } from '../../types/enums'
import { fieldLabel, pathDifficulty } from '../../utils/raidOverride'

/**
 * 「人工修正」註記（PLAN-064 H）：站長在後台覆寫過、和陸版資料不同的欄位。
 * 只列這個難度的（difficulty 省略＝不分難度的文件，例如期本身）。
 */
export function RaidManualNote({ paths, difficulty, className = '' }: { paths?: string[]; difficulty?: RaidDifficulty; className?: string }) {
  const shown = (paths ?? []).filter((p) => {
    const d = pathDifficulty(p)
    return !difficulty || d === null || d === difficulty
  })
  if (!shown.length) return null
  return (
    <div className={`text-[11px] text-text-dim ${className}`}>
      <span className="text-accent-cyan mr-1" aria-hidden>✎</span>
      人工修正（與陸版資料不同）：{shown.map((p) => fieldLabel(p, { omitDifficulty: !!difficulty })).join('、')}
    </div>
  )
}
