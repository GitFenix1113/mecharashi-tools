import { MechPartPosition } from '../../types/enums'

const PART_LABELS: Record<string, string> = {
  [MechPartPosition.TORSO]:     '軀幹',
  [MechPartPosition.LEFT_ARM]:  '左臂',
  [MechPartPosition.RIGHT_ARM]: '右臂',
  [MechPartPosition.LEGS]:      '腿部',
}

/**
 * 綁定部位 → 顯示字串；不限部位時回傳 null。
 *
 * boundPart 型別是 string[] | null，但 Firestore 仍有少數殘留的**純字串**舊資料
 * （PLAN-041 清點時記錄到 3 筆），故 Array.isArray 的防禦不可省略。
 */
function formatBoundParts(boundPart?: string[] | string | null): string | null {
  if (!boundPart) return null
  const list = Array.isArray(boundPart) ? boundPart : [boundPart]
  if (list.length === 0) return null
  return list.map((p) => PART_LABELS[p] ?? p).join('・')
}

/**
 * 綁定部位顯示。
 * variant='inline' → 圖鑑用的括號附註，接在採用機甲後面
 * variant='row'    → 機甲詳情頁用的「綁定部位：xxx」獨立一行
 */
export function ModuleBoundPart({
  boundPart,
  variant = 'row',
  className = '',
}: {
  boundPart?: string[] | string | null
  variant?: 'inline' | 'row'
  className?: string
}) {
  const text = formatBoundParts(boundPart)
  if (!text) return null

  if (variant === 'inline') {
    return <span className={`ml-2 text-accent-purple ${className}`}>({text})</span>
  }

  return (
    <div className={`text-[14px] text-text-dim ${className}`}>
      綁定部位：<span className="text-accent-purple font-medium">{text}</span>
    </div>
  )
}
