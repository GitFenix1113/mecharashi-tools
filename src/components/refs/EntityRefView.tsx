import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EntityRef, RefType, DescriptionRefs, PilotTalent } from '../../types'
import { useGameData, type CollectionKey } from '../../contexts/GameDataContext'
import { useReference } from '../../contexts/ReferenceContext'
import { STAT_LABELS } from '../../utils/moduleStats'
import { mechPortraitCandidates, pilotPortraitCandidates } from '../../utils/assets'
import { backpackIconCandidates, gameIconCandidates, weaponIconCandidates } from '../../utils/gameIcons'
import { pickLevel } from '../../utils/ndOverrides'
import { mechModuleSet, type MechModuleSet } from '../../utils/mechModules'
import { FallbackImage } from '../common/FallbackImage'
import { RefText } from './RefText'
import { RefScopeContext } from './RefChip'
import { RefMechModules } from './RefMechModules'
import { RefPilotTalents } from './RefPilotTalents'

/**
 * PLAN-019 Layer 1 — 引用詳情卡片內容（被浮窗 / BottomSheet / hover 預覽共用）。
 * 依 EntityRef.refType 從 GameDataContext 解析目標實體。
 * 描述以 RefText 渲染並包在 RefScope(inPopover) 內，巢狀 [xxx] 可繼續 drill。
 */

const REF_TYPE_LABEL: Record<RefType, string> = {
  buff: 'BUFF / 狀態', skill: '技能', pilot: '機師', mech: '機甲', weapon: '武器',
  module: '模組', backpack: '背包', component: '元件', stat: '屬性', term: '詞條', neuralDrive: '神經驅動',
  form: '形態',
}

const REF_TO_COLLECTION: Partial<Record<RefType, CollectionKey>> = {
  pilot: 'pilots', mech: 'mechs', weapon: 'weapons',
  module: 'modules', backpack: 'backpacks', component: 'components', buff: 'buffs',
  skill: 'pilotSkills', term: 'glossaryTerms', neuralDrive: 'neuralDriveAbilities',
  form: 'forms',
}

/**
 * 有獨立詳情頁的型別 → 浮窗底部顯示「查看完整詳情 →」。
 *
 * PLAN-041 決策十一：**形態沒有自己的路由**，它是機師詳情頁的一個分頁。故本表填 'pilots'
 * 僅作為「這型別可跳轉」的旗標（:280 的 gate 需要它為真），實際目的地由 resolve() 回的
 * 完整 route 決定——那裡帶了 `?tab=` 讓落點直接是形態分頁，`${routeBase}/${refId}` 的
 * 拼接慣例對形態不適用（refId 不是 pilotId）。
 */
const REF_TO_ROUTE: Partial<Record<RefType, string>> = {
  pilot: 'pilots', mech: 'mechs', weapon: 'weapons', form: 'pilots',
}

const BUFF_TYPE_LABEL: Record<string, string> = {
  statBoost: '數值增益', resource: '資源', state: '狀態', debuff: '減益', control: '控制',
}

interface Resolved {
  title: string
  subtitle?: string
  /** 有序候選圖片路徑，載入失敗逐層退回（見 utils/assets 的 imageCandidates） */
  images?: string[]
  description?: string
  descriptionRefs?: DescriptionRefs
  /** 機甲專用：浮窗本文改列自帶模組（滿級），取代機體描述 */
  mechModules?: MechModuleSet
  /** 機師專用：浮窗本文改列天賦（最大強化），取代機師故事 */
  pilotTalents?: PilotTalent[]
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
        images: pilotPortraitCandidates(p),
        // 2026-10-09 站長決定：比照機甲卡，浮窗不放機師故事，改列天賦（見 RefPilotTalents）
        pilotTalents: p.talents ?? [],
        route: `/pilots/${p.id}`,
      }
    }
    case 'mech': {
      const m = gd.mechs.find(x => x.id === ref.refId)
      if (!m) return null
      return {
        title: m.name,
        subtitle: [m.armorType, m.quality].filter(Boolean).join(' · '),
        images: mechPortraitCandidates(m),
        // 2026-10-09 站長決定：浮窗不放機體描述（故事），改列模組——引用機甲時想知道的是
        // 「這台帶什麼」。modules 還沒載入時四組皆空，由 RefMechModules 顯示載入中。
        mechModules: mechModuleSet(m, gd.modules),
        route: `/mechs/${m.id}`,
      }
    }
    case 'weapon': {
      const w = gd.weapons.find(x => x.id === ref.refId)
      if (!w) return null
      return {
        title: w.name,
        subtitle: [w.type, w.kind, w.rarity].filter(Boolean).join(' · '),
        images: weaponIconCandidates(w),
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
        images: gameIconCandidates(mod.icon),
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
        images: backpackIconCandidates(b),
      }
    }
    case 'component': {
      const c = gd.components.find(x => x.id === ref.refId)
      if (!c) return null
      return {
        title: c.name,
        subtitle: c.rarity,
        images: gameIconCandidates(c.icon, c.iconLocal),
        description: c.description,
      }
    }
    case 'buff': {
      const b = gd.buffs.find(x => x.id === ref.refId)
      if (!b) return null
      const buffTypeLabel = BUFF_TYPE_LABEL[b.buffType] ?? b.buffType
      // PLAN-024：引用指定 level → 優先顯示該級資料（[凝勢I] 看 lv1、[凝勢III] 看 lv3）
      // 取級統一走 pickLevel（PLAN-034 B-3），與 numRefs 同源
      const lv = pickLevel(b.levels, ref.level)
      // termRef：掛了詞條則以官方關鍵字說明為通用/補充顯示來源
      const term = b.termRef ? gd.glossaryTerms.find(t => t.id === b.termRef) : undefined
      // 描述優先序：該級描述 > 詞條說明 > buff 自身描述
      const description = lv?.description || term?.description || b.description
      const descriptionRefs = lv?.description ? lv.descriptionRefs : (term ? term.descriptionRefs : b.descriptionRefs)
      const maxStack = lv?.maxStack ?? b.maxStack
      const maxTriggers = lv?.maxTriggers ?? b.maxTriggers
      const subtitle = [
        buffTypeLabel,
        lv ? `Lv${lv.level}` : '',
        maxStack != null ? `最大疊加 ${maxStack}` : '',
        maxTriggers != null ? `生效 ${maxTriggers} 次` : '',
        term ? `源自詞條：${term.name}` : '',
      ].filter(Boolean).join(' · ')
      const icon = lv?.icon || b.icon
      return {
        title: b.name,
        subtitle,
        images: gameIconCandidates(icon, term?.icon),
        description,
        descriptionRefs,
      }
    }
    case 'skill': {
      const s = gd.pilotSkills.find(x => x.id === ref.refId)
      if (!s) return null
      return {
        title: s.name,
        subtitle: [s.type, s.ap ? `AP ${s.ap}` : '', s.cd ? `CD ${s.cd}` : '', s.pp ? `消耗 ${s.pp}PP` : '']
          .filter(Boolean).join(' · '),
        images: gameIconCandidates(s.icon, s.iconLocal),
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
    case 'term': {
      const t = gd.glossaryTerms.find(x => x.id === ref.refId)
      if (!t) return null
      return {
        title: t.name,
        subtitle: t.category,
        images: gameIconCandidates(t.icon),
        description: t.description,
        descriptionRefs: t.descriptionRefs,
      }
    }
    case 'form': {
      const f = gd.forms.find(x => x.id === ref.refId)
      if (!f) return null
      const owner = gd.pilots.find(p => p.id === f.pilotId)
      const restrictLabel = f.restrict?.kind === 'fixedArmament'
        ? '固定武裝'
        : f.restrict?.allow?.length ? `限 ${f.restrict.allow.join('・')}` : ''
      return {
        title: f.name,
        subtitle: [owner?.name, f.isSignature ? '天賦專屬形態' : '形態', restrictLabel]
          .filter(Boolean).join(' · '),
        images: gameIconCandidates(f.icon),
        description: f.description,
        descriptionRefs: f.descriptionRefs,
        // 形態沒有獨立詳情頁 → 帶 ?tab= 直接落在機師頁的形態分頁（見 REF_TO_ROUTE 註解）。
        // D-1 的 derived active tab 尚未落地前，該參數會被忽略，行為降級為「跳到機師頁」。
        route: `/pilots/${f.pilotId}?tab=形態`,
      }
    }
    case 'neuralDrive': {
      const a = gd.neuralDriveAbilities.find(x => x.id === ref.refId)
      if (!a) return null
      return {
        title: a.name,
        subtitle: '神經驅動能力',
        images: gameIconCandidates(a.icon, a.iconLocal),
        description: a.description,
        descriptionRefs: a.descriptionRefs,
      }
    }
    default:
      return { title: ref.label || ref.refId, pending: true }
  }
}

export function EntityRefView({ entityRef, interactive, showClose = false }: { entityRef: EntityRef; interactive: boolean; showClose?: boolean }) {
  const gd = useGameData()
  const { back, close, canBack } = useReference()
  const navigate = useNavigate()

  const collectionKey = REF_TO_COLLECTION[entityRef.refType]
  // PLAN-024：buff 掛 termRef 時詞條說明來自 glossaryTerms，須一併載入（僅在該 buff 確有 termRef 時才抓，省 read）
  const buffNeedsTerm = entityRef.refType === 'buff'
    && !!gd.buffs.find(x => x.id === entityRef.refId)?.termRef
  // PLAN-041：形態卡的副標要顯示所屬機師名（形態 doc 只存 pilotId）。機甲頁等引用來源
  // 不保證載過 pilots，漏了副標會少一截；pilots 有版本快取，一個 session 只付一次。
  const formNeedsPilot = entityRef.refType === 'form'
  // 機甲卡本文是模組清單。modules 與其他集合同走版本快取：本機有快取就 0 請求，
  // 沒有也只打一次 Worker（邊緣快取命中則 0 Firestore read）。
  const mechNeedsModules = entityRef.refType === 'mech'
  useEffect(() => {
    const keys: CollectionKey[] = []
    if (collectionKey) keys.push(collectionKey)
    if (buffNeedsTerm) keys.push('glossaryTerms')
    if (formNeedsPilot) keys.push('pilots')
    if (mechNeedsModules) keys.push('modules')
    if (keys.length) gd.ensureLoaded(keys)
  }, [collectionKey, buffNeedsTerm, formNeedsPilot, mechNeedsModules, gd])

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
              {!!resolved.images?.length && (
                <FallbackImage
                  candidates={resolved.images}
                  alt={resolved.title}
                  className="w-14 h-14 rounded-lg object-cover bg-bg-dark border border-border flex-shrink-0"
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

            {resolved.mechModules && (
              <RefScopeContext.Provider value={{ inPopover: true }}>
                <RefMechModules
                  set={resolved.mechModules}
                  loading={!gd.loadedKeys.has('modules')}
                  clamp={!interactive}
                />
              </RefScopeContext.Provider>
            )}

            {resolved.pilotTalents && (
              <RefScopeContext.Provider value={{ inPopover: true }}>
                <RefPilotTalents talents={resolved.pilotTalents} clamp={!interactive} />
              </RefScopeContext.Provider>
            )}

            {resolved.pending && (
              <div className="rounded-lg bg-accent-purple/5 border border-accent-purple/25 px-3 py-2.5 text-[12px] text-text-secondary leading-relaxed">
                此引用為「{REF_TYPE_LABEL[entityRef.refType]}」，目前尚無對應詳情資料，先以名稱呈現。
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
