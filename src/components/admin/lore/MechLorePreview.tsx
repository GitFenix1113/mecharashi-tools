import { useMemo } from 'react'
import type { Mech, MechLoreDoc, MechMaker } from '../../../types'
import LoreStage from '../../lore/LoreStage'
import MechDossier from '../../lore/MechDossier'
import LoreChapterBody from '../../lore/LoreChapterBody'
import { mechSkinStageArt, mechStageArt } from '../../lore/loreStageArt'
import { mechSubject } from '../../lore/loreSubject'
import { publishedChapters } from '../../lore/loreText'
import { buildMechLineage } from '../../lore/mechLineage'
import { mechCardArt, mechSkinCatalog } from '../../../utils/gameArt'
import { assetUrl } from '../../../utils/assets'
import { pairedPilotOf } from '../../../utils/officialPairs'
import { useGameData } from '../../../contexts/GameDataContext'
import { LorePreviewFrame } from './LorePreview'

/**
 * 故事館編輯台「機甲」分頁的即時預覽（PLAN-042-B G-1）：與機師版 LorePreview 同一套做法——
 * **直接渲染前台的 LoreStage／MechDossier／LoreChapterBody**，吃編輯中的表單，外框是共用的 LorePreviewFrame（縮小的整個視窗）。
 *
 * 系譜吃表單裡的 relations（正在編的那份）＋其他機甲連到這台的反查；廠商吃表單裡選的那一家。
 * 預覽裡不畫朱印與任何連結（沒給 codexHref／pilotHref），整塊 inert。
 */
export interface MechLorePreviewProps {
  mech: Mech
  /** 編輯中的表單 */
  lore: MechLoreDoc
  /** 表單裡選的廠商（對不到＝null，卷宗顯示「廠商未載」） */
  maker: MechMaker | null
  /** 預覽的塗裝代碼；'' ＝預設主視覺 */
  skinKey: string
  /** 預覽的章節（閱讀模式）；undefined ＝扉頁。草稿章也看得到 */
  chapterKey?: string
}

export function MechLorePreview({ mech, lore, maker, skinKey, chapterKey }: MechLorePreviewProps) {
  // 列表層已 ensureLoaded(['mechs','mechLore','pilots'])，這裡只取同一份記憶體資料
  const { mechs, mechLore, pilots } = useGameData()

  // 塗裝：與前台同一份清單（含隱藏的——編輯者可能正要決定藏不藏）；找不到就退回主視覺
  const art = useMemo(() => {
    const skin = skinKey ? mechSkinCatalog(mech).find((s) => s.key === skinKey) : undefined
    return skin ? mechSkinStageArt(mech, skin) : mechStageArt(mech)
  }, [mech, skinKey])
  const lineage = useMemo(() => buildMechLineage(mech.id, lore.relations, mechs, mechLore), [mech.id, lore.relations, mechs, mechLore])
  const pilot = useMemo(() => pairedPilotOf(mech.id, pilots) ?? null, [mech.id, pilots])
  const card = mechCardArt(mech)

  const chapters = lore.chapters ?? []
  const readIndex = chapterKey ? chapters.findIndex((c) => c.key === chapterKey) : -1
  const reading = readIndex >= 0
  const cls = ['lore-page', 'is-revealed', 'is-ready', 'is-intro-done', reading && 'is-reading'].filter(Boolean).join(' ')

  return (
    <LorePreviewFrame>
      <div className={cls} data-side="left" data-variant="sn" data-dir="1">
        <div className="lore-stage-wrap">
          <LoreStage subject={mechSubject(mech, lore, maker)} art={art} />
        </div>
        <main className="lore-dossier">
          {reading ? (
            <LoreChapterBody
              key={chapters[readIndex].key}
              chapter={chapters[readIndex]}
              index={readIndex}
              prev={chapters[readIndex - 1]}
              next={chapters[readIndex + 1]}
              onSelect={() => {}}
              backHref="#"
              pilotName={mech.name}
            />
          ) : (
            <MechDossier
              mech={mech}
              lore={lore}
              maker={maker}
              chapters={publishedChapters(chapters)}
              chapterHref={() => '#'}
              lineage={lineage}
              lineageHref={() => '#'}
              pilot={pilot}
              cardSrc={card ? assetUrl(card) : undefined}
            />
          )}
        </main>
      </div>
    </LorePreviewFrame>
  )
}
