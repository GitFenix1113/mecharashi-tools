import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import type { GrayOpsRoster } from '../../types'
import { updateGrayOpsRoster } from '../../lib/firestoreApi'
import { useAuth } from '../../contexts/AuthContext'
import { useGameData, type CollectionKey } from '../../contexts/GameDataContext'
import { TabButton, AdminLoadGate } from './admin/shared'
import ModuleAdmin from './admin/ModuleAdmin'
import MechAdmin from './admin/MechAdmin'
import PilotAdmin from './admin/PilotAdmin'
import WeaponAdmin from './admin/WeaponAdmin'
import ComponentAdmin from './admin/ComponentAdmin'
import UserAdmin from './admin/UserAdmin'
import GrayOpsAdmin from './admin/GrayOpsAdmin'
import BackpackAdmin from './admin/BackpackAdmin'
import GlossaryAdmin from './admin/GlossaryAdmin'
import BuffAdmin from './admin/BuffAdmin'
import SkillAdmin from './admin/SkillAdmin'

type Tab = 'modules' | 'mechs' | 'pilots' | 'weapons' | 'components' | 'backpacks' | 'glossary' | 'skills' | 'buffs' | 'users' | 'grayops'

// 各分頁的延遲載入設定：
//   keys       — 需透過 GameDataContext 整包載入的「關聯集合」（供編輯面板下拉用）
//   searchable — 閘門是否提供搜尋框（可帶入分頁的開頭搜尋）
//   selfLoading— 分頁元件自行管理主資料載入（伺服器端分頁查詢）；armed 後直接掛載
// 主資料（pilots/weapons/...）一律由分頁元件以 getCollectionPage 分頁查詢，不整包載入。
// keys 只保留「關聯集合」：weapons→pilots、modules→mechs、mechs→modules。
const TAB_CONFIG: Record<Tab, { keys: CollectionKey[]; searchable: boolean; selfLoading: boolean }> = {
  modules:    { keys: ['mechs'],          searchable: true,  selfLoading: true  },
  mechs:      { keys: ['modules'],        searchable: true,  selfLoading: true  },
  pilots:     { keys: [],                 searchable: true,  selfLoading: true  },
  weapons:    { keys: ['pilots'],         searchable: true,  selfLoading: true  },
  components: { keys: [],                 searchable: true,  selfLoading: true  },
  grayops:    { keys: ['grayOpsRoster'],  searchable: false, selfLoading: false },
  backpacks:  { keys: [],                 searchable: true,  selfLoading: true  },
  glossary:   { keys: [],                 searchable: true,  selfLoading: true  },
  skills:     { keys: [],                 searchable: true,  selfLoading: true  },
  buffs:      { keys: [],                 searchable: true,  selfLoading: true  },
  users:      { keys: [],                 searchable: false, selfLoading: true  },
}

export default function AdminPage() {
  const { user, userProfile, loading: authLoading } = useAuth()
  const {
    mechs: ctxMechs,
    pilots: ctxPilots,
    modules: ctxModules,
    grayOpsRoster: ctxGrayOpsRoster,
    loadedKeys,
    errorMap,
    ensureLoaded,
    reloadTick,
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

  async function handleGrayOpsSave(updated: GrayOpsRoster) {
    await updateGrayOpsRoster(updated)
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
  const isArmed     = armedTabs.has(tab)
  const tabLoaded   = cfg.keys.every(k => loadedKeys.has(k))
  const tabError    = cfg.keys.map(k => errorMap[k]).find(Boolean)?.message ?? null
  const searchSeed  = searchSeeds[tab] ?? ''
  const showContent = isArmed && (cfg.selfLoading || tabLoaded)

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
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
            為降低資料庫查詢量，各分頁資料<span className="text-accent-cyan font-medium">不會自動載入</span>，且改為
            <span className="text-accent-cyan font-medium">依條件分頁查詢</span>。
            切換分頁後請<span className="text-accent-cyan font-medium">輸入名稱開頭搜尋</span>或選擇下拉條件，
            再以「載入更多」翻頁。
          </span>
        </div>
      </div>

      {/* 版本管理入口 */}
      <div className="mb-6">
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
      </div>

      {/* 分頁標籤 */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <TabButton active={tab === 'modules'}    onClick={() => setTab('modules')}>模組管理</TabButton>
        <TabButton active={tab === 'mechs'}      onClick={() => setTab('mechs')}>機甲管理</TabButton>
        <TabButton active={tab === 'pilots'}     onClick={() => setTab('pilots')}>機師管理</TabButton>
        <TabButton active={tab === 'weapons'}    onClick={() => setTab('weapons')}>武器管理</TabButton>
        <TabButton active={tab === 'components'} onClick={() => setTab('components')}>元件管理</TabButton>
        <TabButton active={tab === 'backpacks'}  onClick={() => setTab('backpacks')}>背包管理</TabButton>
        <TabButton active={tab === 'glossary'}   onClick={() => setTab('glossary')}>詞條管理</TabButton>
        <TabButton active={tab === 'skills'}      onClick={() => setTab('skills')}>技能管理</TabButton>
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
          <MechAdmin initialSearch={searchSeed} modules={ctxModules} />
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
        {showContent && tab === 'glossary' && <GlossaryAdmin initialSearch={searchSeed} />}
        {showContent && tab === 'skills' && <SkillAdmin initialSearch={searchSeed} />}
        {showContent && tab === 'buffs' && <BuffAdmin initialSearch={searchSeed} />}
        {showContent && tab === 'users' && <UserAdmin currentUid={user.uid} />}
        {showContent && tab === 'grayops' && (
          <GrayOpsAdmin roster={ctxGrayOpsRoster} onSave={handleGrayOpsSave} />
        )}
      </div>
    </div>
  )
}
