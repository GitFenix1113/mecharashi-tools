// 「返回清單」連結（2026-10-11）
//
// 外觀與行為都是一般連結（href 正確、可以右鍵另開、中鍵開新分頁），只攔截**一般左鍵**：
// 上一頁就是這份清單時改成 navigate(-1)，回到清單原本捲到的位置與篩選條件；
// 否則照常開一份新的清單。判斷在 utils/historyTrail.ts。
//
// 用在兩處：常駐分頁列（SubNavTabs，人在詳情頁時那一格變成「← 機甲」）與各詳情頁頂端的返回連結。
// 兩處共用同一支，不會一邊回原位、一邊回頂端。
import type { MouseEvent, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { backToListAction, currentHistoryIdx, previousTrailPath } from '../../utils/historyTrail'

export function BackToListLink({
  to,
  className,
  children,
  ...rest
}: {
  /** 清單路徑，例如 `/mechs` */
  to: string
  className?: string
  children: ReactNode
  'aria-label'?: string
  title?: string
}) {
  const navigate = useNavigate()

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // 修飾鍵／非左鍵：交還給瀏覽器（另開分頁、另存連結），不攔
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const idx = currentHistoryIdx()
    if (backToListAction(previousTrailPath(idx), idx, to) === 'back') {
      e.preventDefault()   // <Link> 看到 defaultPrevented 就不會再自己導覽
      navigate(-1)
    }
    // 'push'：不攔，讓 <Link> 照常導覽到新的清單
  }

  return (
    <Link to={to} onClick={onClick} className={className} {...rest}>
      {children}
    </Link>
  )
}
