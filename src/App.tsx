import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { GameDataProvider } from './contexts/GameDataContext'
import { ReferenceProvider } from './contexts/ReferenceContext'
import Layout from './components/Layout'
import AdminRoute from './components/AdminRoute'
import HomePage from './pages/home/HomePage'
import PilotsPage from './pages/pilots/PilotsPage'
import PilotDetailPage from './pages/pilots/PilotDetailPage'
import MechsPage from './pages/mechs/MechsPage'
import MechDetailPage from './pages/mechs/MechDetailPage'
import WeaponsPage from './pages/weapons/WeaponsPage'
import BackpacksPage from './pages/backpacks/BackpacksPage'
import ModulesPage from './pages/modules/ModulesPage'
import SimulatorPage from './pages/simulator/SimulatorPage'
import ResearchPage from './pages/simulator/ResearchPage'
import NewsPage from './pages/news/NewsPage'
import GuidesPage from './pages/guides/GuidesPage'
import ToolsPage from './pages/tools/ToolsPage'
import DocumentsPage from './pages/documents/DocumentsPage'
import ProfilePage from './pages/user/ProfilePage'
import AdminPage from './pages/user/AdminPage'
import ComponentsPage from './pages/components/ComponentsPage'
import NotFoundPage from './pages/NotFoundPage'
const WeaponDetailPage         = lazy(() => import('./pages/weapons/WeaponDetailPage'))
const AdminVersionListPage     = lazy(() => import('./pages/admin/AdminVersionListPage'))
const AdminVersionEditorPage   = lazy(() => import('./pages/admin/AdminVersionEditorPage'))
const AdminHistoryPage         = lazy(() => import('./pages/admin/AdminHistoryPage'))
const RainbowMechPlannerPage   = lazy(() => import('./pages/guides/tools/RainbowMechPlannerPage'))
const ComponentDropsPage       = lazy(() => import('./pages/guides/tools/ComponentDropsPage'))
const StorageDebugPage         = lazy(() => import('./pages/debug/StorageDebugPage'))
const ConnectivityPage         = lazy(() => import('./pages/debug/ConnectivityPage'))

function App() {
  return (
    <AuthProvider>
      <GameDataProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
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
            <Route path="simulator" element={<SimulatorPage />} />
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
