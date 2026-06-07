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
const WeaponDetailPage         = lazy(() => import('./pages/weapons/WeaponDetailPage'))
const AdminVersionListPage     = lazy(() => import('./pages/admin/AdminVersionListPage'))
const AdminVersionEditorPage   = lazy(() => import('./pages/admin/AdminVersionEditorPage'))
const RainbowMechPlannerPage   = lazy(() => import('./pages/guides/tools/RainbowMechPlannerPage'))

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
          </Route>
        </Routes>
        </ReferenceProvider>
      </BrowserRouter>
      </GameDataProvider>
    </AuthProvider>
  )
}

export default App
