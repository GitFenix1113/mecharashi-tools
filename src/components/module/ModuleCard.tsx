import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Module } from '../../types'
import { imageCandidates } from '../../utils/assets'
import { FallbackImage } from '../FallbackImage'
import { RefText } from '../RefText'
import { ModuleSlotBadge, ModuleRarityBadge } from '../ModuleBadges'
import { ModuleStatTags } from './ModuleStatTags'
import { ModuleBoundPart } from './ModuleBoundPart'
import { ModuleLevelSelector } from './ModuleLevelSelector'

type Variant = 'catalog' | 'detail'

interface ModuleCardProps {
  mod: Module
  /** catalog＝模組圖鑑（大圖示、含槽位標籤與來源）；detail＝機甲詳情頁（小圖示、緊湊） */
  variant?: Variant
  /** 標題下方的額外資訊；圖鑑用來放採用機甲列 */
  meta?: ReactNode
  /** 顯示綁定部位（機甲詳情頁的專屬模組才需要） */
  showBoundPart?: boolean
}

const CONTAINER: Record<Variant, string> = {
  catalog: 'bg-bg-card border border-border rounded-xl p-4',
  detail:  'bg-bg-dark border border-border rounded-xl p-4',
}

/** 圖示載不到時留一個灰底方塊，而非把 <img> 藏起來——後者會讓版面塌一塊。 */
function ModuleIcon({ icon, name, size }: { icon?: string; name: string; size: string }) {
  const box = `${size} rounded-lg bg-bg-dark border border-border flex-shrink-0`
  if (!icon) return <div className={box} />
  return (
    <FallbackImage
      candidates={imageCandidates(icon)}
      alt={name}
      className={`${box} object-cover`}
      fallback={<div className={box} />}
    />
  )
}

/**
 * 模組卡（PLAN-044）。圖鑑與機甲詳情頁共用同一份實作——先前兩頁各有一份，
 * 連數值標籤都手寫了兩次且欄位不齊。
 *
 * 等級狀態**放在卡片內部**：各卡獨立，不做全頁連動（決策二——模組的等級上限不一致，
 * 一個全域「Lv.5」對半數卡片沒有意義）。預設落在滿級，維持改版前「卡片顯示滿級快照」的語感。
 */
export function ModuleCard({
  mod,
  variant = 'catalog',
  meta,
  showBoundPart,
}: ModuleCardProps) {
  const levels = mod.levels ?? []
  const maxLevel = levels.length
  const [selected, setSelected] = useState(maxLevel)
  // 資料重載後等級數可能變動，夾住避免指到不存在的等級
  const level = Math.min(selected, maxLevel)
  const current = levels[level - 1]

  const isCatalog = variant === 'catalog'

  const header = (
    <div className={`flex items-center gap-2 flex-wrap ${isCatalog ? 'mb-1' : ''}`}>
      <h3 className="font-bold text-sm text-text-primary">{mod.name}</h3>
      {mod.rarity && <ModuleRarityBadge rarity={mod.rarity} />}
      {isCatalog && <ModuleSlotBadge slot={mod.slot} />}
    </div>
  )

  const body = (
    <>
      {meta}
      {showBoundPart && <ModuleBoundPart boundPart={mod.boundPart} className="mb-1" />}
      {isCatalog && Array.isArray(mod.source) && mod.source.length > 0 && (
        <div className="text-[14px] text-text-dim mb-1">
          來源：<span className="text-text-secondary">{mod.source.join('、')}</span>
        </div>
      )}
      <ModuleLevelSelector
        level={level}
        maxLevel={maxLevel}
        onChange={setSelected}
        className="my-2"
      />
      <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-line">
        <RefText
          text={current?.description ?? mod.description}
          refs={current?.descriptionRefs ?? mod.descriptionRefs}
        />
      </p>
      {/* 數值跟著選取的等級走；沒有等級資料時退回模組頂層（滿級快照） */}
      <ModuleStatTags stats={current ?? mod} variant={isCatalog ? 'plain' : 'chip'} />
    </>
  )

  return (
    <div className={CONTAINER[variant]}>
      {isCatalog ? (
        <div className="flex items-start gap-3">
          <ModuleIcon icon={mod.icon} name={mod.name} size="w-12 h-12" />
          <div className="flex-1 min-w-0">
            {header}
            {body}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-2">
            <ModuleIcon icon={mod.icon} name={mod.name} size="w-8 h-8" />
            <div className="flex-1 min-w-0">{header}</div>
          </div>
          {body}
        </>
      )}
    </div>
  )
}
