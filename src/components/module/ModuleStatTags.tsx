import { STAT_LABELS, type StatKey } from '../../utils/moduleStats'

/** 任何帶有模組數值欄位的物件——Module（滿級快照）與 ModuleLevel（單一等級）都適用。 */
export type ModuleStats = Partial<Record<StatKey, number>>

type Variant = 'plain' | 'chip'

const CONTAINER_DEFAULT: Record<Variant, string> = {
  plain: 'gap-3 mt-2',
  chip:  'gap-2 mt-2',
}

/**
 * 模組數值標籤列。取代先前在 ModulesPage / MechDetailPage / 等級浮窗中
 * 各自手寫的三份欄位展開——那些拷貝只列了 11 個欄位，武器類別增傷從未被顯示過。
 *
 * 刻意吃「一個帶數值欄位的物件」而非模組本身：PLAN-044 Phase B 讓卡片跟著等級選擇器走之後，
 * 這裡改傳 levels[i] 即可，元件本身不必改。
 *
 * 空值規則：值為 0 / undefined 的欄位不渲染；整組皆空時回傳 null（連容器都不出現，不留空白區塊）。
 */
export function ModuleStatTags({
  stats,
  variant = 'plain',
  className,
}: {
  stats?: ModuleStats | null
  variant?: Variant
  className?: string
}) {
  if (!stats) return null

  const active = STAT_LABELS.filter(({ key }) => (stats[key] ?? 0) !== 0)
  if (active.length === 0) return null

  return (
    <div className={`flex flex-wrap text-[14px] ${className ?? CONTAINER_DEFAULT[variant]}`}>
      {active.map(({ key, label, color, suffix, prefix }) => {
        const value = `${prefix ?? '+'}${stats[key]}${suffix}`
        return variant === 'chip' ? (
          <span key={key} className="bg-bg-card border border-border rounded px-2 py-0.5">
            <span className="text-text-dim">{label} </span>
            <span className={`${color} font-bold`}>{value}</span>
          </span>
        ) : (
          <span key={key} className={color}>
            {label}{value}
          </span>
        )
      })}
    </div>
  )
}
