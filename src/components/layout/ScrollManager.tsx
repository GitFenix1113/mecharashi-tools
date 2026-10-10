// 全站換頁捲動管理（2026-10-11）—— 決策表在 src/utils/scrollPolicy.ts
//
// 只管 window 的捲動。沉浸式版面（故事館、時間線）的 window 不捲，各自的捲動容器自己處理
// （故事館見 LoreLayout 的「跨路由捲頂」），這裡對它們的 scrollTo 是無害的空操作。
//
// ── 為什麼要自己記位置，而不是交給瀏覽器（history.scrollRestoration = 'auto'）──
// 瀏覽器在 popstate 當下就還原捲動，但那時 React 還沒換上上一頁的內容：從詳情頁按上一頁，
// 還原的高度會被詳情頁的高度截短，回到圖鑑時停在錯的位置。改成 manual，
// 等目標頁渲染出來、文件夠高了再捲（最多等約 1.5 秒，使用者自己動了滾輪就放棄）。
//
// ── 位置怎麼記 ──
// 以 React Router 的 location.key 為鍵（每個歷史項目一個，存在 history.state 裡、重新整理後不變）。
// 捲動時持續更新「目前這一項」的位置；記錄表同步到 sessionStorage，重新整理後一樣回得去。
// ⚠ 換頁瞬間新頁面若比較矮，瀏覽器會把 scrollY 截短並發出一次 scroll 事件 —— 那一次不能記到
//   舊頁頭上。所以「目前是哪一項」用 ref 在 layout effect 裡先換掉（早於那個非同步的 scroll 事件）。
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { scrollActionFor, rememberPosition } from '../../utils/scrollPolicy'
import { UNKEYED_HISTORY_KEY as UNKEYED } from '../../utils/historyKey'
import { recordTrailEntry, currentHistoryIdx } from '../../utils/historyTrail'

const STORAGE_KEY = 'mecharashi_scroll_positions'
/**
 * 還原時等目標頁長高：每 50ms 試一次、最多 1.5 秒。
 * 用 setTimeout 而不是 requestAnimationFrame：rAF 在背景分頁完全不跑（2026-10-11 實測），
 * 重新整理時頁面還沒長高的那一下被截短之後就再也不會重試；計時器在背景只是變慢，仍會跑完。
 */
const RESTORE_INTERVAL_MS = 50
const RESTORE_MAX_TRIES = 30

function loadPositions(): Map<string, number> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return new Map(raw ? (JSON.parse(raw) as [string, number][]) : [])
  } catch {
    return new Map()
  }
}

function savePositions(map: Map<string, number>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...map]))
  } catch {
    // 隱私模式或 storage 被鎖：只是重新整理後回不到原位，不影響本次瀏覽
  }
}

/** 等文件長到夠高再捲到 y；使用者自己捲動（滾輪／觸控／鍵盤）就放棄，不跟人搶 */
function restoreTo(y: number): () => void {
  let tries = 0
  let timer = 0
  let cancelled = false
  const cancel = () => { cancelled = true }
  const opts = { passive: true, once: true } as const
  window.addEventListener('wheel', cancel, opts)
  window.addEventListener('touchstart', cancel, opts)
  window.addEventListener('keydown', cancel, { once: true })
  const cleanup = () => {
    window.clearTimeout(timer)
    window.removeEventListener('wheel', cancel)
    window.removeEventListener('touchstart', cancel)
    window.removeEventListener('keydown', cancel)
  }
  const tick = () => {
    if (cancelled) return cleanup()
    const max = document.documentElement.scrollHeight - window.innerHeight
    window.scrollTo(0, Math.min(y, Math.max(0, max)))
    if (max >= y || ++tries >= RESTORE_MAX_TRIES) return cleanup()
    timer = window.setTimeout(tick, RESTORE_INTERVAL_MS)
  }
  tick()
  return () => { cancelled = true; cleanup() }
}

export function ScrollManager() {
  const location = useLocation()
  const navType = useNavigationType()
  const positions = useRef<Map<string, number> | null>(null)
  const currentKey = useRef(location.key)
  const prevPathname = useRef(location.pathname)

  if (positions.current === null) positions.current = loadPositions()

  // 改成手動還原（理由見檔頭）。卸載時還原，不留副作用
  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return
    const prev = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => { window.history.scrollRestoration = prev }
  }, [])

  // 記錄「目前這一項」的位置，兩個時機互為備援：
  //   · scroll：持續更新（一般情況靠它）
  //   · 點擊（捕獲階段）：連結與 navigate() 都由點擊觸發，捕獲階段早於 <Link> 自己的處理，
  //     此刻新頁還沒換上，scrollY 一定是舊頁的。補的是「最後一次捲動事件還沒派發就點下去」的空檔
  //   ⚠ 刻意**不**掛 popstate：React Router 的 popstate 監聽器比這裡早註冊，它觸發的重繪在
  //     微任務裡就提交完了 —— 輪到這裡時 currentKey 已經是新頁，記到的是新頁的位置，毫無用處
  //     （2026-10-11 實測）。上一頁之前的位置由 scroll 持續記錄即可。
  // 離開分頁（關閉／重新整理）前寫進 sessionStorage
  useEffect(() => {
    const map = positions.current!
    const record = () => {
      if (currentKey.current !== UNKEYED) rememberPosition(map, currentKey.current, window.scrollY)
    }
    const onHide = () => { record(); savePositions(map) }
    window.addEventListener('scroll', record, { passive: true })
    document.addEventListener('click', record, true)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('scroll', record)
      document.removeEventListener('click', record, true)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  useLayoutEffect(() => {
    const map = positions.current!
    const action = scrollActionFor({
      navType,
      prevPathname: prevPathname.current,
      pathname: location.pathname,
      hash: location.hash,
      savedY: location.key === UNKEYED ? undefined : map.get(location.key),
    })
    // 先換「目前是哪一項」：新頁面比較矮時瀏覽器截短 scrollY 的那次 scroll 事件，要記到新的這一項頭上
    currentKey.current = location.key
    prevPathname.current = location.pathname
    savePositions(map)
    // 順便記下這一格的網址，給「返回清單」判斷上一頁是不是清單（見 utils/historyTrail.ts）。
    // 掛在這裡是因為全站只有這支元件在每次換頁都會跑
    recordTrailEntry(currentHistoryIdx(), location.pathname + location.search)

    switch (action.kind) {
      case 'top':
        window.scrollTo(0, 0)
        return
      case 'hash': {
        const el = document.getElementById(action.id)
        if (el) el.scrollIntoView()
        else window.scrollTo(0, 0)
        return
      }
      case 'restore':
        return restoreTo(action.y)
      case 'none':
        return
    }
  }, [location.key, location.pathname, location.search, location.hash, navType])

  return null
}
