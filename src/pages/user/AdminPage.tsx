import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import type { GrayOpsRoster } from '../../types'
import { updateGrayOpsRoster } from '../../lib/firestoreApi'
import { useAuth } from '../../contexts/AuthContext'
import { useGameData, type CollectionKey } from '../../contexts/GameDataContext'
import { TabButton, AdminLoadGate, ADMIN_WIDE_MAX_W } from './admin/shared'
import ModuleAdmin from './admin/ModuleAdmin'
import MechAdmin from './admin/MechAdmin'
import PilotAdmin from './admin/PilotAdmin'
import WeaponAdmin from './admin/WeaponAdmin'
import ComponentAdmin from './admin/ComponentAdmin'
import UserAdmin from './admin/UserAdmin'
import GrayOpsAdmin from './admin/GrayOpsAdmin'
import BackpackAdmin from './admin/BackpackAdmin'
import BackpackSkillAdmin from './admin/BackpackSkillAdmin'
import GlossaryAdmin from './admin/GlossaryAdmin'
import BuffAdmin from './admin/BuffAdmin'
import SkillAdmin from './admin/SkillAdmin'
import NeuralDriveAdmin from './admin/NeuralDriveAdmin'

type Tab = 'modules' | 'mechs' | 'pilots' | 'weapons' | 'components' | 'backpacks' | 'backpackSkills' | 'glossary' | 'skills' | 'neuralDrive' | 'buffs' | 'users' | 'grayops'

// 各分頁的載入設定：
//   keys       — 此分頁需要整包載入的集合（主資料 + 編輯面板下拉用的關聯集合）。
//                一律經 GameDataContext 載入（版本快取 gate，命中快取＝0 讀取）。
//   searchable — 閘門是否提供搜尋框（僅未預載入、仍走伺服器端分頁的分頁會用到閘門）。
//   selfLoading— 分頁元件自行管理主資料載入（伺服器端分頁查詢）；armed 後直接掛載。
//   preload    — true：切到此分頁即整包預載入主資料，支援前端「片段」搜尋（useClientPaged）。
// 註：components 資料量較大，仍維持伺服器端分頁查詢（不整包載入、沿用閘門）。
//     backpacks 於 PLAN-036 改回整包預載入（客戶端品質篩選 + 前置 picker，180 筆不大）。
const TAB_CONFIG: Record<Tab, { keys: CollectionKey[]; searchable: boolean; selfLoading: boolean; preload: boolean }> = {
  modules:    { keys: ['modules', 'mechs'],  searchable: true,  selfLoading: false, preload: true  },
  mechs:      { keys: ['mechs', 'modules', 'weapons'], searchable: true, selfLoading: false, preload: true },
  pilots:     { keys: ['pilots'],            searchable: true,  selfLoading: false, preload: true  },
  // PLAN-032：武器技能引用化後，技能編輯分頁要從技能庫挑 doc → 必須一併載入 pilotSkills。
  // 漏了不會報錯，症狀是「掛載挑選器候選 0 個」與「已掛的引用全顯示⚠找不到此技能」。
  weapons:    { keys: ['weapons', 'pilots', 'pilotSkills'], searchable: true, selfLoading: false, preload: true },
  components: { keys: [],                     searchable: true,  selfLoading: true,  preload: false },
  // mechs 是給「同步 Icon / 連結」查名稱用的（GrayOpsAdmin），漏了按鈕會停用
  grayops:    { keys: ['grayOpsRoster', 'mechs'], searchable: false, selfLoading: false, preload: false },
  backpacks:  { keys: ['backpacks', 'backpackSkills'], searchable: true, selfLoading: false, preload: true },
  // PLAN-043：技能庫需 backpacks 才算得出「掛載幾個背包 / 孤兒技能」
  backpackSkills: { keys: ['backpackSkills', 'backpacks'], searchable: true, selfLoading: false, preload: true },
  glossary:   { keys: ['glossaryTerms'],     searchable: true,  selfLoading: false, preload: true  },
  skills:     { keys: ['pilotSkills'],       searchable: true,  selfLoading: false, preload: true  },
  neuralDrive:{ keys: ['neuralDriveAbilities', 'pilots'], searchable: true, selfLoading: false, preload: true },
  buffs:      { keys: ['buffs'],             searchable: true,  selfLoading: false, preload: true  },
  users:      { keys: [],                     searchable: false, selfLoading: true,  preload: false },
}

export default function AdminPage() {
  const { user, userProfile, loading: authLoading } = useAuth()
  const {
    mechs: ctxMechs,
    pilots: ctxPilots,
    modules: ctxModules,
    weapons: ctxWeapons,
    grayOpsRoster: ctxGrayOpsRoster,
    loadedKeys,
    errorMap,
    ensureLoaded,
    reloadTick,
    patchSingleton,
  } = useGameData()

  const [tab, setTab] = useState<Tab>('modules')

  // 已「啟用」（按下載入或使用篩選）的分頁；以及閘門帶入的初始搜尋字串
  const [armedTabs, setArmedTabs]     = useState<Set<Tab>>(new Set())
  const [searchSeeds, setSearchSeeds] = useState<Partial<Record<Tab, string>>>({})

  const armTab = useCallback((t: Tab, initialSearch: string) => {
    setSearchSeeds(prev => ({ ...prev, [t]: initialSearch }))
    setArmedTabs(prev => (prev.has(t) ? prev : new Set(prev).add(t)))
    const { keys } = TAB_CONFIG[t]
    if (keys.length) void ensureLoaded(keys)
  }, [ensureLoaded])

  // 重新載入（reload 清空快取後）→ 重新拉取目前已啟用分頁的關聯集合
  useEffect(() => {
    armedTabs.forEach(t => {
      const { keys } = TAB_CONFIG[t]
      if (keys.length) void ensureLoaded(keys)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick])

  // 預載入分頁：切到該分頁即自動 arm（整包載入主資料，支援前端片段搜尋；不顯示載入閘門）
  useEffect(() => {
    if (TAB_CONFIG[tab].preload && !armedTabs.has(tab)) armTab(tab, '')
  }, [tab, armedTabs, armTab])

  async function handleGrayOpsSave(updated: GrayOpsRoster) {
    const version = await updateGrayOpsRoster(updated)
    patchSingleton('grayOpsRoster', updated, version)
  }

  if (authLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <p className="text-text-dim">驗證中...</p>
      </div>
    )
  }

  if (!user || (userProfile?.role !== 'ADMIN' && userProfile?.role !== 'OWNER')) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="bg-bg-card border border-border rounded-xl p-10 text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-xl font-bold mb-2">無存取權限</h2>
          <p className="text-text-dim text-sm">此頁面僅限管理者使用。</p>
        </div>
      </div>
    )
  }

  const cfg         = TAB_CONFIG[tab]
  // 預載入分頁視為已啟用（不顯示閘門；由上方 effect 觸發整包載入）
  const isArmed     = armedTabs.has(tab) || cfg.preload
  const tabLoaded   = cfg.keys.every(k => loadedKeys.has(k))
  const tabError    = cfg.keys.map(k => errorMap[k]).find(Boolean)?.message ?? null
  const searchSeed  = searchSeeds[tab] ?? ''
  const showContent = isArmed && (cfg.selfLoading || tabLoaded)

  // 列表容器與編輯彈窗共用寬度（PLAN-033 A-4）；上方 authLoading / 無權限兩個狀態
  // 只有一段置中短訊息，維持 max-w-6xl 較好看，故不套用。
  return (
    <div className={`${ADMIN_WIDE_MAX_W} mx-auto px-4 py-12`}>
      <div className="mb-8">
        <span className="text-xs text-accent-orange tracking-[3px] uppercase font-[Orbitron,sans-serif]">
          Admin
        </span>
        <h1 className="text-3xl font-bold mt-2">管理後台</h1>
        <p className="text-text-secondary mt-2 text-sm">
          維護模組數值、機甲模組綁定、機師基本資料、用戶權限。儲存後直接更新 Firestore，無需手動匯出。
        </p>
        <div className="mt-4 flex items-start gap-2 text-xs bg-accent-cyan/5 border border-accent-cyan/20 rounded-lg px-3 py-2 text-text-secondary">
          <span className="text-accent-cyan shrink-0">💡</span>
          <span>
            多數分頁切換後會<span className="text-accent-cyan font-medium">自動預載入</span>
            （透過版本快取，未改版時不重複計費），並可用
            <span className="text-accent-cyan font-medium">片段關鍵字</span>即時搜尋名稱 / ID。
            <span className="text-accent-cyan font-medium">背包 / 元件</span>資料量較大，仍維持
            <span className="text-accent-cyan font-medium">輸入名稱開頭分頁查詢</span>。
          </span>
        </div>
      </div>

      {/* 子頁面入口（版本管理 / 變更歷史）。變更歷史採子頁而非第 13 個 Tab——
          changeHistory 不走 GameDataContext 預載入模型，硬塞 TAB_CONFIG 要開空 keys 特例 */}
      <div className="mb-6 flex gap-3 flex-wrap">
        <Link
          to="/admin/versions"
          className="inline-flex items-center gap-3 px-5 py-3 bg-accent-purple/10 border border-accent-purple/30 rounded-xl hover:bg-accent-purple/20 hover:border-accent-purple/50 transition-colors no-underline"
        >
          <span className="text-accent-purple text-xl">📋</span>
          <div>
            <div className="text-sm font-bold text-accent-purple">版本管理</div>
            <div className="text-xs text-text-dim">管理遊戲版本與活動資料</div>
          </div>
          <span className="text-accent-purple/50 ml-2 text-lg">›</span>
        </Link>
        <Link
          to="/admin/history"
          className="inline-flex items-center gap-3 px-5 py-3 bg-accent-green/10 border border-accent-green/30 rounded-xl hover:bg-accent-green/20 hover:border-accent-green/50 transition-colors no-underline"
        >
          <span className="text-accent-green text-xl">📜</span>
          <div>
            <div className="text-sm font-bold text-accent-green">變更歷史</div>
            <div className="text-xs text-text-dim">資料異動稽核記錄與刪除快照</div>
          </div>
          <span className="text-accent-green/50 ml-2 text-lg">›</span>
        </Link>
      </div>

      {/* 分頁標籤 */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <TabButton active={tab === 'modules'}    onClick={() => setTab('modules')}>模組管理</TabButton>
        <TabButton active={tab === 'mechs'}      onClick={() => setTab('mechs')}>機甲管理</TabButton>
        <TabButton active={tab === 'pilots'}     onClick={() => setTab('pilots')}>機師管理</TabButton>
        <TabButton active={tab === 'weapons'}    onClick={() => setTab('weapons')}>武器管理</TabButton>
        <TabButton active={tab === 'components'} onClick={() => setTab('components')}>元件管理</TabButton>
        <TabButton active={tab === 'backpacks'}  onClick={() => setTab('backpacks')}>背包管理</TabButton>
        <TabButton active={tab === 'backpackSkills'} onClick={() => setTab('backpackSkills')}>背包技能</TabButton>
        <TabButton active={tab === 'glossary'}   onClick={() => setTab('glossary')}>詞條管理</TabButton>
        <TabButton active={tab === 'skills'}      onClick={() => setTab('skills')}>技能管理</TabButton>
        <TabButton active={tab === 'neuralDrive'} onClick={() => setTab('neuralDrive')}>神經驅動</TabButton>
        <TabButton active={tab === 'buffs'}      onClick={() => setTab('buffs')}>BUFF 管理</TabButton>
        <TabButton active={tab === 'users'}      onClick={() => setTab('users')}>用戶管理</TabButton>
        <TabButton active={tab === 'grayops'}    onClick={() => setTab('grayops')}>灰燼行動</TabButton>
      </div>

      {/* 分頁內容 */}
      <div className="bg-bg-card border border-border rounded-xl p-6">
        {/* 載入閘門：尚未啟用 → 顯示提示與篩選 / 載入按鈕 */}
        {!isArmed && (
          <AdminLoadGate searchable={cfg.searchable} onLoad={(q) => armTab(tab, q)} />
        )}

        {/* 已啟用、關聯集合載入中（僅非 selfLoading 分頁）*/}
        {isArmed && !cfg.selfLoading && !tabLoaded && !tabError && (
          <p className="text-text-dim text-sm text-center py-10">載入中...</p>
        )}

        {/* 已啟用、載入失敗 */}
        {isArmed && tabError && (
          <p className="text-accent-red text-sm text-center py-10">載入失敗：{tabError}</p>
        )}

        {/* 已啟用 → 顯示分頁內容 */}
        {showContent && tab === 'modules' && (
          <ModuleAdmin initialSearch={searchSeed} mechs={ctxMechs} />
        )}
        {showContent && tab === 'mechs' && (
          <MechAdmin initialSearch={searchSeed} modules={ctxModules} weapons={ctxWeapons} />
        )}
        {showContent && tab === 'pilots' && (
          <PilotAdmin initialSearch={searchSeed} />
        )}
        {showContent && tab === 'weapons' && (
          <WeaponAdmin initialSearch={searchSeed} pilots={ctxPilots} />
        )}
        {showContent && tab === 'components' && (
          <ComponentAdmin initialSearch={searchSeed} />
        )}
        {showContent && tab === 'backpacks' && <BackpackAdmin initialSearch={searchSeed} />}
        {showContent && tab === 'backpackSkills' && <BackpackSkillAdmin initialSearch={searchSeed} />}
        {showContent && tab === 'glossary' && <GlossaryAdmin initialSearch={searchSeed} />}
        {showContent && tab === 'skills' && <SkillAdmin initialSearch={searchSeed} />}
        {showContent && tab === 'neuralDrive' && <NeuralDriveAdmin initialSearch={searchSeed} />}
        {showContent && tab === 'buffs' && <BuffAdmin initialSearch={searchSeed} />}
        {showContent && tab === 'users' && <UserAdmin currentUid={user.uid} />}
        {showContent && tab === 'grayops' && (
          <GrayOpsAdmin roster={ctxGrayOpsRoster} mechs={ctxMechs} onSave={handleGrayOpsSave} />
        )}
      </div>
    </div>
  )
}
