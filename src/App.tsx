import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { GameDataProvider } from './contexts/GameDataContext'
import { ReferenceProvider } from './contexts/ReferenceContext'
import Layout from './components/layout/Layout'
import { ScrollManager } from './components/layout/ScrollManager'
import AdminRoute from './components/auth/AdminRoute'
import HomePage from './pages/home/HomePage'
import PilotsPage from './pages/pilots/PilotsPage'
import PilotDetailPage from './pages/pilots/PilotDetailPage'
import MechsPage from './pages/mechs/MechsPage'
import MechDetailPage from './pages/mechs/MechDetailPage'
import WeaponsPage from './pages/weapons/WeaponsPage'
import BackpacksPage from './pages/backpacks/BackpacksPage'
import ModulesPage from './pages/modules/ModulesPage'
import LoadoutPage from './pages/simulator/LoadoutPage'
import ResearchPage from './pages/simulator/ResearchPage'
import NewsPage from './pages/news/NewsPage'
import GuidesPage from './pages/guides/GuidesPage'
import ToolsPage from './pages/tools/ToolsPage'
import DocumentsPage from './pages/documents/DocumentsPage'
import ProfilePage from './pages/user/ProfilePage'
import AdminPage from './pages/user/AdminPage'
import ComponentsPage from './pages/components/ComponentsPage'
import VersionsLayout from './pages/versions/VersionsLayout'
import VersionQuickPage from './pages/versions/VersionQuickPage'
import VersionGrayOpsPage from './pages/versions/VersionGrayOpsPage'
// 機師故事館的外殼（PLAN-042-A）。它是 <Route element>，不在 Suspense 之內，
// 因此**必須靜態 import**（比照 VersionsLayout）；它本身刻意零依賴，體積可忽略。
import LoreLayout from './pages/lore/LoreLayout'
import NotFoundPage from './pages/NotFoundPage'
const WeaponDetailPage         = lazy(() => import('./pages/weapons/WeaponDetailPage'))
// 時間線是最重的檢視（src/components/timeline/ 共 9 檔 1853 行）。路由化之前它無條件
// 進首頁 bundle，現在只有真的走到 /versions/timeline 才載入（PLAN-050 A-5）。
const VersionTimelinePage      = lazy(() => import('./pages/versions/VersionTimelinePage'))
// 故事館三頁一律 lazy：館首頁要載 89 張縮圖的卡片牆、扉頁要載立繪三層合成，
// 兩者對「從沒走進故事館的訪客」都是純負擔。從第一天就切出去，之後不必回頭補。
const LoreHomePage             = lazy(() => import('./pages/lore/LoreHomePage'))
const PilotLorePage            = lazy(() => import('./pages/lore/PilotLorePage'))
const AdminLorePage            = lazy(() => import('./pages/admin/AdminLorePage'))
const AdminVersionListPage     = lazy(() => import('./pages/admin/AdminVersionListPage'))
const AdminVersionEditorPage   = lazy(() => import('./pages/admin/AdminVersionEditorPage'))
const AdminHistoryPage         = lazy(() => import('./pages/admin/AdminHistoryPage'))
const AdminSystemLogPage       = lazy(() => import('./pages/admin/AdminSystemLogPage'))
const AdminAnalyticsPage       = lazy(() => import('./pages/admin/AdminAnalyticsPage'))
const AdminAnnouncementsPage   = lazy(() => import('./pages/admin/AdminAnnouncementsPage'))
const RainbowMechPlannerPage   = lazy(() => import('./pages/guides/tools/RainbowMechPlannerPage'))
const ComponentDropsPage       = lazy(() => import('./pages/guides/tools/ComponentDropsPage'))
const StorageDebugPage         = lazy(() => import('./pages/debug/StorageDebugPage'))
const ConnectivityPage         = lazy(() => import('./pages/debug/ConnectivityPage'))

function App() {
  return (
    <AuthProvider>
      <GameDataProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        {/* 換頁捲動：進新頁回到頂端、上一頁回到原位（元件式路由用不了 <ScrollRestoration>，見元件檔頭） */}
        <ScrollManager />
        <ReferenceProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="pilots" element={<PilotsPage />} />
            <Route path="pilots/:id" element={<PilotDetailPage />} />
            <Route path="mechs" element={<MechsPage />} />
            <Route path="mechs/:id" element={<MechDetailPage />} />
            <Route path="weapons" element={<WeaponsPage />} />
            <Route path="weapons/:id" element={<Suspense fallback={null}><WeaponDetailPage /></Suspense>} />
            <Route path="backpacks" element={<BackpacksPage />} />
            <Route path="modules" element={<ModulesPage />} />
            <Route path="components" element={<ComponentsPage />} />

            {/* 版本情報三分頁（PLAN-050 A-1）。共用一個 layout route：tab bar 放在
                VersionsLayout 裡，切換檢視時不重新掛載，Timeline 走 lazy 也只有內容區進 Suspense。
                首頁 / 維持可用、不做破壞性轉址 —— Hero 的退場是 Phase B 的事。 */}
            <Route path="versions" element={<VersionsLayout />}>
              <Route index element={<Navigate to="quick" replace />} />
              <Route path="quick" element={<VersionQuickPage />} />
              <Route path="grayops" element={<VersionGrayOpsPage />} />
              <Route path="timeline" element={<VersionTimelinePage />} />
              {/* 單一版本深連結：可分享、可開兩個分頁比較兩個版本 */}
              <Route path="timeline/:version" element={<VersionTimelinePage />} />
            </Route>
            {/* 機師故事館（PLAN-042-A）。LoreLayout 是共用外殼：它掛 html.lore-mode、
                開全館唯一的 scrollport、負責跨路由捲頂，因此**三個子頁共用同一個 layout route**，
                切換機師時外殼不卸載（進場遮罩不會每次重播）。
                扉頁與章節頁刻意是同一個元件 PilotLorePage —— 版面骨架只寫一份，不會漂移。
                參數一律命名 :id（analytics/track.ts 寫死讀 params.id，改名會讓機師熱度一筆不記，
                而 routeKeys.test.ts 只斷言反方向、測試照樣全綠）。 */}
            <Route path="lore" element={<LoreLayout />}>
              <Route index element={<Suspense fallback={null}><LoreHomePage /></Suspense>} />
              <Route path="pilots/:id" element={<Suspense fallback={null}><PilotLorePage /></Suspense>} />
              <Route path="pilots/:id/:part" element={<Suspense fallback={null}><PilotLorePage /></Suspense>} />
              {/* 館內的兜底轉址是**必要的**（地雷 M-28）：Layout 的 chromeMode 是純路徑推導，
                  /lore/xyz 一律判成 immersive，但 React Router 不做部分匹配、會落到全站的
                  path="*" NotFoundPage ⇒ 一頁深色 404 配紙色館頭，footer／subnav／手機 Tab Bar
                  全被藏掉，使用者手上只剩「離館」。順帶解掉 /lore/pilots 這種裸路徑。 */}
              <Route path="*" element={<Navigate to="/lore" replace />} />
            </Route>
            {/* 路徑保留 /simulator（PLAN-052-B E-2）：052-C 的分享碼要用它，
                而且不碰 Cloudflare 的 Transform Rule——新開頂層路由等於新增一個只存在於
                CF Dashboard 的例外條件（PLAN-038 踩過）。 */}
            <Route path="simulator" element={<LoadoutPage />} />
            <Route path="research" element={<ResearchPage />} />
            <Route path="news" element={<NewsPage />} />
            <Route path="guides" element={<GuidesPage />} />
            <Route path="tools" element={<ToolsPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="tools/rainbow-planner" element={<Suspense fallback={null}><RainbowMechPlannerPage /></Suspense>} />
            <Route path="guides/component-drops" element={<Suspense fallback={null}><ComponentDropsPage /></Suspense>} />
            <Route path="debug/storage" element={<Suspense fallback={null}><StorageDebugPage /></Suspense>} />
            {/* 頂層短路徑（非 /debug/ 之下）：要發給中國測試者，網址越好念好打越好 */}
            <Route path="connectivity" element={<Suspense fallback={null}><ConnectivityPage /></Suspense>} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route
              path="admin/versions"
              element={<AdminRoute><Suspense fallback={null}><AdminVersionListPage /></Suspense></AdminRoute>}
            />
            <Route
              path="admin/versions/:versionId"
              element={<AdminRoute><Suspense fallback={null}><AdminVersionEditorPage /></Suspense></AdminRoute>}
            />
            <Route
              path="admin/history"
              element={<AdminRoute><Suspense fallback={null}><AdminHistoryPage /></Suspense></AdminRoute>}
            />
            {/* 系統日誌僅 OWNER 可看：內含維護者的 UA、儲存用量等裝置指紋（PLAN-045） */}
            <Route
              path="admin/system-log"
              element={<AdminRoute ownerOnly><Suspense fallback={null}><AdminSystemLogPage /></Suspense></AdminRoute>}
            />
            {/* 台版公告審核工作檯（PLAN-048 Phase 2）。ADMIN 即可用——它只操作 staging 與版本活動 */}
            <Route
              path="admin/announcements"
              element={<AdminRoute><Suspense fallback={null}><AdminAnnouncementsPage /></Suspense></AdminRoute>}
            />
            {/* 使用統計（PLAN-046）。ADMIN 即可看——內容是站務彙總數字，不含個人行為資料 */}
            <Route
              path="admin/analytics"
              element={<AdminRoute><Suspense fallback={null}><AdminAnalyticsPage /></Suspense></AdminRoute>}
            />
            {/* 機師故事館編輯台（PLAN-042-A E-1）。ADMIN 即可用——它只寫 pilotLore。
                AdminRoute 在外、Suspense 在內（與上面五條後台路由一致）：反過來的話
                未授權者會先付一次 chunk 下載才被導走。 */}
            <Route
              path="admin/lore"
              element={<AdminRoute><Suspense fallback={null}><AdminLorePage /></Suspense></AdminRoute>}
            />
            {/* catch-all：未匹配路徑顯示 404 引導頁（放最後，只在所有 route 都沒中時生效）。
                置於 Layout 之下，故仍有導覽列可用；先前缺此條時只會渲染空白內容區。 */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
        </ReferenceProvider>
      </BrowserRouter>
      </GameDataProvider>
    </AuthProvider>
  )
}

export default App
