import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'

/**
 * 版本情報三分頁的共用外殼（PLAN-050 A-1）。
 *
 * 外殼是**視窗高度**（.viewport-shell）而非文件流：Timeline 的甘特面板需要一個
 * 有明確高度的容器才能把捲動關在自己身上（`h-full` ＋ 內層 overflow-y-auto），
 * 主從分割的兩條獨立捲動軸更是完全依賴這一點。
 * 這也是為什麼 Layout 對 /versions 不渲染 footer 與底部佔位。
 *
 * ── 三個檢視的分頁列已隱藏（2026-08-19 站長指示）──
 * 導覽列的「版本情報 ▾」下拉已經是三個檢視的入口，頁內再放一條同樣的分頁列是
 * 同一組導覽出現兩次 —— 而且它吃掉的是 Timeline 最缺的垂直空間。
 * 元件本身留在 `components/versions/VersionViewTabs.tsx` 沒有刪除，
 * 要恢復只需在下方 <div> 內加回 `<VersionViewTabs />` 一行。
 * 該檔的 `VERSION_VIEWS` 仍在使用中（首頁的入口連結）。
 */
export default function VersionsLayout() {
  return (
    <div className="viewport-shell flex flex-col min-h-0">
      {/*
        overscroll-contain：捲到邊界後不把剩餘 delta 交給祖先（scroll chaining）。
        首頁 2026-08-19 的「往上捲一下就彈回 Hero」正是漏掉這個屬性造成的，
        這裡從一開始就補上。
      */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  )
}
