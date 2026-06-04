import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EntityRef, RefType, DescriptionRefs } from '../types'
import { useGameData, type CollectionKey } from '../contexts/GameDataContext'
import { useReference } from '../contexts/ReferenceContext'
import { STAT_LABELS } from '../utils/moduleStats'
import { assetUrl, resolveIconSrc } from '../utils/assets'
import { RefText } from './RefText'
import { RefScopeContext } from './RefChip'

/**
 * PLAN-019 Layer 1 — 引用詳情卡片內容（被浮窗 / BottomSheet / hover 預覽共用）。
 * 依 EntityRef.refType 從 GameDataContext 解析目標實體。
 * 描述以 RefText 渲染並包在 RefScope(inPopover) 內，巢狀 [xxx] 可繼續 drill。
 */

const REF_TYPE_LABEL: Record<RefType, string> = {
  buff: 'BUFF / 狀態', skill: '技能', pilot: '機師', mech: '機甲', weapon: '武器',
  module: '模組', backpack: '背包', component: '元件', stat: '屬性', term: '詞條',
}

const REF_TO_COLLECTION: Partial<Record<RefType, CollectionKey>> = {
  pilot: 'pilots', mech: 'mechs', weapon: 'weapons',
  module: 'modules', backpack: 'backpacks', component: 'components', buff: 'buffs',
  skill: 'pilotSkills',
}

const REF_TO_ROUTE: Partial<Record<RefType, string>> = {
  pilot: 'pilots', mech: 'mechs', weapon: 'weapons',
}

const BUFF_TYPE_LABEL: Record<string, string> = {
  statBoost: '數值增益', resource: '資源', state: '狀態', debuff: '減益', control: '控制',
}

interface Resolved {
  title: string
  subtitle?: string
  image?: string
  description?: string
  descriptionRefs?: DescriptionRefs
  route?: string
  pending?: boolean
}

function resolve(ref: EntityRef, gd: ReturnType<typeof useGameData>): Resolved | null {
  switch (ref.refType) {
    case 'pilot': {
      const p = gd.pilots.find(x => x.id === ref.refId)
      if (!p) return null
      return {
        title: p.name,
        subtitle: [p.rarity, p.class, p.faction].filter(Boolean).join(' · '),
        image: p.portraitUrl || (p.portrait ? assetUrl(p.portrait) : undefined),
        description: p.lore,
        route: `/pilots/${p.id}`,
      }
    }
    case 'mech': {
      const m = gd.mechs.find(x => x.id === ref.refId)
      if (!m) return null
      return {
        title: m.name,
        subtitle: [m.armorType, m.quality].filter(Boolean).join(' · '),
        image: m.halfPortrait ? assetUrl(m.halfPortrait) : (m.portrait ? assetUrl(m.portrait) : undefined),
        description: m.lore,
        route: `/mechs/${m.id}`,
      }
    }
    case 'weapon': {
      const w = gd.weapons.find(x => x.id === ref.refId)
      if (!w) return null
      return {
        title: w.name,
        subtitle: [w.type, w.kind, w.rarity].filter(Boolean).join(' · '),
        image: w.icon ? assetUrl(w.icon) : undefined,
        description: w.description,
        route: `/weapons/${w.id}`,
      }
    }
    case 'module': {
      const mod = gd.modules.find(x => x.id === ref.refId)
      if (!mod) return null
      return {
        title: mod.name,
        subtitle: [mod.slot, mod.rarity].filter(Boolean).join(' · '),
        image: mod.icon ? assetUrl(mod.icon) : undefined,
        description: mod.description,
        descriptionRefs: mod.descriptionRefs,
      }
    }
    case 'backpack': {
      const b = gd.backpacks.find(x => x.id === ref.refId)
      if (!b) return null
      return {
        title: b.name,
        subtitle: [b.type, b.rarity].filter(Boolean).join(' · '),
        image: b.icon ? assetUrl(b.icon) : undefined,
      }
    }
    case 'component': {
      const c = gd.components.find(x => x.id === ref.refId)
      if (!c) return null
      return {
        title: c.name,
        subtitle: c.rarity,
        image: c.iconLocal ? assetUrl(c.iconLocal) : undefined,
        description: c.description,
      }
    }
    case 'buff': {
      const b = gd.buffs.find(x => x.id === ref.refId)
      if (!b) return null
      return {
        title: b.name,
        subtitle: [BUFF_TYPE_LABEL[b.buffType] ?? b.buffType, b.mutexGroup ? `形態群組：${b.mutexGroup}` : '']
          .filter(Boolean).join(' · '),
        image: b.icon ? assetUrl(b.icon) : undefined,
        description: b.description,
        descriptionRefs: b.descriptionRefs,
      }
    }
    case 'skill': {
      const s = gd.pilotSkills.find(x => x.id === ref.refId)
      if (!s) return null
      return {
        title: s.name,
        subtitle: [s.type, s.ap ? `AP ${s.ap}` : '', s.cd ? `CD ${s.cd}` : '']
          .filter(Boolean).join(' · '),
        image: (s.iconLocal || s.icon) ? resolveIconSrc(s.iconLocal || s.icon) : undefined,
        description: s.description,
        descriptionRefs: s.descriptionRefs,
      }
    }
    case 'stat': {
      const s = STAT_LABELS.find(x => x.key === ref.refId)
      return {
        title: ref.label || s?.label || ref.refId,
        subtitle: '屬性加成',
        description: s ? `對應屬性欄位：${s.key}` : undefined,
      }
    }
    // term：集合尚未建立（PLAN-019-C）
    default:
      return { title: ref.label || ref.refId, pending: true }
  }
}

export function EntityRefView({ entityRef, interactive, showClose = false }: { entityRef: EntityRef; interactive: boolean; showClose?: boolean }) {
  const gd = useGameData()
  const { back, close, canBack } = useReference()
  const navigate = useNavigate()

  const collectionKey = REF_TO_COLLECTION[entityRef.refType]
  useEffect(() => { if (collectionKey) gd.ensureLoaded([collectionKey]) }, [collectionKey, gd])

  const loading = collectionKey ? !gd.loadedKeys.has(collectionKey) : false
  const resolved = resolve(entityRef, gd)
  const routeBase = REF_TO_ROUTE[entityRef.refType]

  return (
    <div className="flex flex-col max-h-[inherit]">
      {/* header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          {interactive && canBack && (
            <button
              onClick={back}
              className="w-6 h-6 flex items-center justify-center rounded text-text-dim hover:text-text-primary hover:bg-bg-dark transition-colors text-sm leading-none"
              aria-label="返回"
            >←</button>
          )}
          <span className="text-[12px] font-[Orbitron,sans-serif] tracking-widest uppercase text-accent-purple truncate">
            {REF_TYPE_LABEL[entityRef.refType]}
          </span>
        </div>
        {showClose && (
          <button
            onClick={close}
            className="w-6 h-6 flex items-center justify-center rounded-full text-text-dim hover:text-text-primary hover:bg-bg-dark transition-colors text-base leading-none"
            aria-label="關閉"
          >✕</button>
        )}
      </div>

      {/* body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5">
        {loading && !resolved && <div className="text-text-dim text-sm py-6 text-center">載入中…</div>}
        {!loading && !resolved && (
          <div className="text-text-secondary text-sm py-6 text-center">
            找不到對應資料（{entityRef.refType}/{entityRef.refId}）。
          </div>
        )}
        {resolved && (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              {resolved.image && (
                <img
                  src={resolved.image}
                  alt={resolved.title}
                  className="w-14 h-14 rounded-lg object-cover bg-bg-dark border border-border flex-shrink-0"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <div className="min-w-0">
                <h3 className="font-bold text-[15px] text-text-primary">{resolved.title}</h3>
                {resolved.subtitle && <p className="text-[12px] text-text-secondary mt-0.5">{resolved.subtitle}</p>}
              </div>
            </div>

            {resolved.description && (
              <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
                <RefScopeContext.Provider value={{ inPopover: true }}>
                  <RefText text={resolved.description} refs={resolved.descriptionRefs} />
                </RefScopeContext.Provider>
              </p>
            )}

            {resolved.pending && (
              <div className="rounded-lg bg-accent-purple/5 border border-accent-purple/25 px-3 py-2.5 text-[12px] text-text-secondary leading-relaxed">
                此引用為「{REF_TYPE_LABEL[entityRef.refType]}」，詳情資料庫將由後續子計畫提供
                （詞條庫 → PLAN-019-C）。目前先以名稱呈現。
              </div>
            )}
          </div>
        )}
      </div>

      {/* footer */}
      {interactive && resolved?.route && routeBase && (
        <div className="flex-shrink-0 px-4 py-2.5 border-t border-border">
          <button
            onClick={() => { navigate(resolved.route!); close() }}
            className="w-full text-center text-sm font-semibold text-accent-purple bg-accent-purple/10 border border-accent-purple/30 rounded-lg py-2 hover:bg-accent-purple/20 transition-colors cursor-pointer"
          >
            查看完整詳情 →
          </button>
        </div>
      )}
    </div>
  )
}
