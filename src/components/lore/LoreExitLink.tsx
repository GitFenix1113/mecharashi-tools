import { Link, useNavigate, type LinkProps } from 'react-router-dom'
import { exitLore } from './loreExit'

/**
 * 離館連結（PLAN-042-G）：header 的「離館」、卷宗的落款鈐印、切換列的「圖鑑」共用。
 * 就是一個普通的 <Link>（href 照常、可複製、可中鍵開新分頁），只有一般左鍵點擊改走出館過場（loreExit.ts）。
 */
export default function LoreExitLink({ to, onClick, ...rest }: Omit<LinkProps, 'to'> & { to: string }) {
  const navigate = useNavigate()
  return (
    <Link
      {...rest}
      to={to}
      onClick={(e) => {
        onClick?.(e)
        // 已被別的處理器攔下、中鍵、修飾鍵、開新視窗：交回瀏覽器／Link 原本的行為
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        if (rest.target && rest.target !== '_self') return
        e.preventDefault()
        exitLore(navigate, to)
      }}
    />
  )
}
