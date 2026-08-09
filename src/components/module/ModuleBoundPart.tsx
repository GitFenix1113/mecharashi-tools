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
 * boundPart 型別是 string[] | null，但 Firestore 是無型別的，曾殘留 3 筆**純字串**舊資料。
 * 那 3 筆已於 2026-08-10（PLAN-040 A-2）改成陣列，**全庫現為 0 筆**——
 * 但 Array.isArray 的防禦**仍不可省略**，理由是：
 *   ① tsc 擋不住未來的壞寫入（型別宣告只是宣告，Firestore 不強制）；
 *   ② 失敗模式極差——`'torso'.length > 0` 會通過守衛，`.join()` 才拋 TypeError，
 *      而本專案沒有任何 ErrorBoundary，render 拋錯會讓整頁掛掉。
 * 長期守門員是 `scripts/validate-module-binding.mjs`（PLAN-040 A-3）：它從源頭抓型別違規，
 * 本分支只是安全網。所有顯示 boundPart 的地方都應該用本元件，不要自己 join。
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
