import { Link } from 'react-router-dom'
import SiteChangelog from '../../components/home/SiteChangelog'
import SiteTeamSection from '../../components/home/SiteTeamSection'
import NavIcon from '../../components/icons/NavIcon'
import { VERSION_VIEWS } from '../../components/versions/VersionViewTabs'
import { SITE_NAME_EN } from '../../lib/siteMeta'

/**
 * 首頁（PLAN-050 Phase B ＋ 2026-08-19 站長調整）。
 *
 * 演變順序：
 * ① PLAN-015：scroll-snap 兩頁 —— 第一頁 Hero、第二頁資料面板，靠捲動換頁。
 * ② PLAN-050 Phase A/B：三個版本檢視獨立成 `/versions/*`，snap 架構刪除，
 *    首頁留下「站務頂帶 ＋ 版本速覽面板」。
 * ③ 站長定案（現況）：**首頁不再放資料**。版本情報已經是完整的一區，速覽表在首頁
 *    永遠只能拿到 48vw、擠成一團；把它留在這裡等於兩邊都做不好。
 *    首頁回歸單一職責 —— 站務履歷與維護團隊，資料由導覽列的「版本情報」進入。
 *
 * 因此這裡不再需要視窗高度外殼、也不需要可收合頂帶（收合是為了跟資料面板搶空間，
 * 現在沒有東西要搶），改回一般文件流版面，footer 由 Layout 統一渲染。
 */
export default function HomePage() {
  return (
    <div className="relative">
      {/* 左濃右淡的遮罩：左側保證文字可讀，右側把背景立繪讓出來 */}
      <div className="absolute inset-0 bg-gradient-to-r from-bg-dark/85 via-bg-dark/50 lg:via-bg-dark/30 to-transparent pointer-events-none" />

      <div className="relative z-10 w-full max-w-[min(92vw,780px)] px-6 lg:px-12 py-8 flex flex-col gap-5">
        {/* 站名 */}
        <div>
          <h1 className="font-[Orbitron,sans-serif] text-3xl sm:text-4xl lg:text-5xl font-black tracking-wider leading-tight bg-gradient-to-br from-white to-accent-orange bg-clip-text text-transparent">
            MECHARASHI<br />
            <span className="text-xl sm:text-2xl lg:text-3xl">
              {SITE_NAME_EN}
            </span>
          </h1>
          <p className="mt-3 text-text-secondary text-base font-semibold tracking-[0.2em]">
            獾迎你的到來！
          </p>
        </div>

        {/*
          版本情報的入口。導覽列已經有「版本情報 ▾」，這裡再放一次是因為首頁不再
          自帶任何資料 —— 沒有入口的話，第一次來的人會停在一個看不到內容的頁面。

          第一版做成一行以「·」分隔的橘色文字連結，使用者回報「看不出來是能按的」——
          可點性只靠顏色，而這站到處都是橘字。改成**膠囊按鈕**：可點性靠邊框與底色
          （形狀），顏色只是強調；icon 與導覽列下拉共用同一組，讓「這三個是同一組東西」
          在兩處視覺一致。同樣的判斷在 VersionGanttPanel 的收合鈕上寫過一次：
          可點性靠形狀與動詞，不能只靠一個符號。

          仍然不做圖示卡片格：那是這個首頁早年拆掉的東西，而且會把首頁重新變成導航頁。
          這裡的高度是一行（約 40px），首頁依舊是站務頁。
        */}
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-bold tracking-[2px] text-accent-orange font-[Orbitron,sans-serif]">
            版本情報
          </span>
          <div className="flex flex-wrap gap-2">
            {VERSION_VIEWS.map(view => (
              <Link
                key={view.id}
                to={view.to}
                className="group inline-flex items-center gap-2 rounded-xl border border-accent-orange/40 bg-accent-orange/10
                           px-3.5 py-2 text-sm font-medium text-text-primary no-underline transition-colors
                           hover:border-accent-orange hover:bg-accent-orange/20"
              >
                <NavIcon name={view.icon} className="w-4 h-4 shrink-0 text-accent-orange" />
                {view.zhLabel}
                <span className="text-accent-orange/70 transition-transform group-hover:translate-x-0.5">→</span>
              </Link>
            ))}
          </div>
        </div>

        {/* 網站更新履歷 */}
        <SiteChangelog />

        {/* 維護團隊與社群 */}
        <SiteTeamSection />
      </div>
    </div>
  )
}
