import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 舊分頁的保險（2026-10-04，搭配 deploy.yml 的退役檔清理）：新版部署、舊 chunk 退役滿 30 天被清掉之後，
// 開著舊分頁的人切到 lazy 頁面時動態 import 會 404 → 路由層沒有 error boundary，整頁會白掉。
// 重新整理就能拿到新的 index.html。10 秒內不重複，避免真的斷網或檔案真的不見時無限重整；
// 儲存被封鎖時就不重整，交回原本的錯誤流程。配裝模擬器的草稿本來就存在 localStorage，重整不會丟。
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'mecharashi:preloadReloadAt'
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 10_000) return
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return
  }
  event.preventDefault()   // 不讓 Vite 把錯誤往外拋 → React 不會先白掉一下
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
