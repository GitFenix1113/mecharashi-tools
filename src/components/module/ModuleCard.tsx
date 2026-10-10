import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Module } from '../../types'
import { gameIconCandidates } from '../../utils/gameIcons'
import { FallbackImage } from '../common/FallbackImage'
import { RefText } from '../refs/RefText'
import { ModuleSlotBadge, ModuleRarityBadge } from '../badges/ModuleBadges'
import { ModuleStatTags } from './ModuleStatTags'
import { ModuleBoundPart } from './ModuleBoundPart'
import { ModuleLevelSelector } from './ModuleLevelSelector'
import { ModuleAllLevelsButton } from './ModuleAllLevels'
import { levelRefs } from './moduleRefs'

type Variant = 'catalog' | 'detail' | 'row'

interface ModuleCardProps {
  mod: Module
  /**
   * catalog＝模組圖鑑（大圖示、含槽位標籤與來源）；detail＝機甲詳情頁（小圖示、緊湊）；
   * row＝機甲詳情頁的**副模組**，單行（2026-10-10）。
   *
   * ⚠ row 刻意**沒有滑桿與數值標籤**：副模組的描述只有 8 個字左右（中位數 8、最長 11，82 台實測），
   *   一整張卡加滑桿只為「暴擊率提升10%」太浪費；數值標籤（暴擊 +10%）又與描述講同一件事。
   *   各等級改由「全部」查看。
   */
  variant?: Variant
  /** 標題下方的額外資訊；圖鑑用來放採用機甲列 */
  meta?: ReactNode
  /** 顯示綁定部位（機甲詳情頁的專屬模組才需要） */
  showBoundPart?: boolean
}

const CONTAINER: Record<Variant, string> = {
  catalog: 'bg-bg-card border border-border rounded-xl p-4',
  detail:  'bg-bg-dark border border-border rounded-xl p-3.5',
  row:     'bg-bg-dark border border-border rounded-xl px-3 py-1.5',
}

/** 圖示載不到時留一個灰底方塊，而非把 <img> 藏起來——後者會讓版面塌一塊。 */
function ModuleIcon({ icon, name, size }: { icon?: string; name: string; size: string }) {
  const box = `${size} rounded-lg bg-bg-dark border border-border flex-shrink-0`
  if (!icon) return <div className={box} />
  return (
    <FallbackImage
      candidates={gameIconCandidates(icon)}
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

  // 滑桿＝查閱單一等級；右側「全部」＝一覽比較（各等級跳幅），兩個入口互補（圖鑑用；詳情頁的排法見下方）
  const levelControls = maxLevel > 1 && (
    <>
      <ModuleLevelSelector
        level={level}
        maxLevel={maxLevel}
        onChange={setSelected}
        className="flex-1 min-w-0"
      />
      <ModuleAllLevelsButton mod={mod} currentLevel={level} />
    </>
  )

  const description = (
    <RefText
      text={current?.description ?? mod.description}
      // 空物件也要回退到頂層：`??` 只擋 undefined，後台存過一次空 refs 就會讓整卡的 chip
      // 全部消失，而症狀與「還沒指派」完全一樣（沒有錯誤、只是不亮）。
      refs={levelRefs(current) ?? mod.descriptionRefs}
    />
  )

  const body = (
    <>
      {meta}
      {/* detail 的綁定部位放在標題列（見下方），這裡只剩圖鑑會走到 */}
      {showBoundPart && isCatalog && <ModuleBoundPart boundPart={mod.boundPart} className="mb-1" />}
      {isCatalog && Array.isArray(mod.source) && mod.source.length > 0 && (
        <div className="text-[14px] text-text-dim mb-1">
          來源：<span className="text-text-secondary">{mod.source.join('、')}</span>
        </div>
      )}
      {isCatalog && levelControls && <div className="flex items-center gap-2 my-2">{levelControls}</div>}
      <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-line">{description}</p>
      {/* 數值跟著選取的等級走；沒有等級資料時退回模組頂層（滿級快照） */}
      <ModuleStatTags stats={current ?? mod} variant={isCatalog ? 'plain' : 'chip'} />
    </>
  )

  // ── row：副模組單行（見 Variant 註解）。等級固定在滿級，要看各級按「全部」 ──
  if (variant === 'row') {
    return (
      <div className={`${CONTAINER.row} flex flex-wrap items-center gap-x-3 gap-y-1`}>
        <div className="flex items-center gap-2 shrink-0">
          <ModuleIcon icon={mod.icon} name={mod.name} size="w-6 h-6" />
          {header}
        </div>
        <p className="flex-1 min-w-[8rem] text-xs text-text-secondary leading-relaxed">{description}</p>
        {maxLevel > 1 && (
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <span className="text-[13px] font-bold font-[JetBrains_Mono,monospace] text-accent-orange">
              Lv.{level}/{maxLevel}
            </span>
            <ModuleAllLevelsButton mod={mod} currentLevel={level} />
          </div>
        )}
      </div>
    )
  }

  return (
    // detail 掛 @container：標題列的排法看的是**這張卡**的寬度（整寬卡 vs 專屬兩欄 vs 手機），不是視窗寬度
    <div className={`${CONTAINER[variant]} ${isCatalog ? '' : '@container'}`}>
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
          {/* detail 標題列（2026-10-10，一屏看完的前提下每張卡省一整行）：
              · 卡寬 ≥ 440px：名稱｜等級選擇（撐滿）｜全部 —— 一行
              · 卡寬 < 440px（手機、專屬模組兩欄）：名稱｜全部 一行，等級選擇獨佔第二行、按鈕平均撐滿
                —— 不這樣排的話，手機的 8 顆分段按鈕會折成兩行、「全部」被擠到右下角 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <ModuleIcon icon={mod.icon} name={mod.name} size="w-8 h-8" />
              <div className="min-w-0">{header}</div>
              {/* 專屬模組的綁定部位併進標題列：獨立一行時每排卡片多 24px，復仇女神四顆就是兩排 */}
              {showBoundPart && <ModuleBoundPart boundPart={mod.boundPart} variant="tag" />}
            </div>
            {maxLevel > 1 && (
              <>
                <div className="order-3 basis-full @[440px]:order-none @[440px]:basis-[200px] flex-1 min-w-0">
                  <ModuleLevelSelector level={level} maxLevel={maxLevel} onChange={setSelected} fill />
                </div>
                <ModuleAllLevelsButton mod={mod} currentLevel={level} className="ml-auto @[440px]:ml-0" />
              </>
            )}
          </div>
          {body}
        </>
      )}
    </div>
  )
}
