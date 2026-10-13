import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LoreDoc, Pilot } from '../../../types'
import LoreStage from '../../lore/LoreStage'
import LoreDossier from '../../lore/LoreDossier'
import LoreChapterBody from '../../lore/LoreChapterBody'
import { defaultStageArt, loreSideOf, skinStageArt } from '../../lore/loreStageArt'
import { publishedChapters } from '../../lore/loreText'
import { pilotSkinCatalog } from '../../../utils/gameArt'
import { emblemName, emblemsById } from '../../../utils/factionEmblems'
import { useGameData } from '../../../contexts/GameDataContext'

/**
 * 故事館編輯台的即時預覽（PLAN-042-E D-4）：**直接渲染前台的 LoreStage／LoreDossier／LoreChapterBody**，
 * 吃的是編輯中的表單——看到的就是上線的樣子，不是另一份仿製的版面。
 *
 * ── 為什麼是「縮小的整個視窗」────────────────────────────────────────────
 * 前台的舞台＋卷宗版面是用 `100vw`／`100vh` 算的（index.css 的 .lore-page：--u、--cx、--dossier-x…），
 * 塞進一欄窄框裡只會排壞。所以這裡渲染一個**寬 100vw** 的虛擬視窗，再整個 `scale()` 成欄寬：
 * 每個 calc 都照真的視窗算，縮小後就是這個瀏覽器寬度下前台的等比縮圖（手機上看到的就是手機版面）。
 * 紙色主題由 `.lore-shell` 包住虛擬視窗局部套用，不影響後台其他部分。
 *
 * ⚠ transform 會讓裡面的 fixed 元素改對齊這個框（containing block）——預覽裡刻意不放任何 fixed 浮層
 *   （切換列、名冊、全身立繪都不渲染），所以沒事。
 * ⚠ 整塊 `inert`：預覽裡的章節連結、旁白頭像點下去會離開後台，這裡只看不點。
 * ⚠ 舞台在前台是 sticky 全高層；預覽裡改成貼在頂端的絕對定位（index.css 的 .lore-preview 區塊），
 *   不然它會跟著後台捲動容器黏住、縮放後的位置對不上。
 */
export interface LorePreviewProps {
  pilot: Pilot
  /** 編輯中的表單 */
  lore: LoreDoc
  /** 預覽的外觀鍵；'' ＝預設外觀 */
  skinKey: string
  /** 預覽的章節（閱讀模式）；undefined ＝扉頁。草稿章也看得到——編輯者就是要看自己的草稿 */
  chapterKey?: string
}

export function LorePreview({ pilot, lore, skinKey, chapterKey }: LorePreviewProps) {
  const paneRef = useRef<HTMLDivElement>(null)
  const vpRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ scale: 0.3, height: 400 })
  // 徽章名稱：編輯台的選圖器已 ensureLoaded(['factionEmblems'])，這裡只取同一份記憶體資料
  const { factionEmblems } = useGameData()
  const logoLabel = useMemo(() => {
    const byId = emblemsById(factionEmblems)
    return (key: string) => emblemName(key, byId)
  }, [factionEmblems])

  useLayoutEffect(() => {
    const pane = paneRef.current, vp = vpRef.current
    if (!pane || !vp) return
    const measure = () => {
      const scale = pane.clientWidth / Math.max(1, window.innerWidth)
      setBox((b) => {
        const height = Math.ceil(vp.offsetHeight * scale)
        return b.scale === scale && b.height === height ? b : { scale, height }
      })
    }
    // 不必先同步量一次：ResizeObserver 在 observe 當下就會回呼一次（排版後、繪製前）
    const ro = new ResizeObserver(measure)
    ro.observe(pane)
    ro.observe(vp)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  // 外觀：與前台同一份清單（含隱藏的——編輯者可能正要決定藏不藏）；找不到就退回預設外觀
  const art = useMemo(() => {
    const skin = skinKey ? pilotSkinCatalog(pilot).find((s) => s.key === skinKey) : undefined
    return skin ? skinStageArt(pilot, skin) : defaultStageArt(pilot)
  }, [pilot, skinKey])
  const chapters = lore.chapters ?? []
  const readIndex = chapterKey ? chapters.findIndex((c) => c.key === chapterKey) : -1
  const reading = readIndex >= 0

  const cls = ['lore-page', 'is-revealed', 'is-ready', 'is-intro-done', reading && 'is-reading'].filter(Boolean).join(' ')

  return (
    <div ref={paneRef} className="lore-preview" style={{ height: box.height }}>
      <div
        ref={vpRef}
        className="lore-shell lore-preview__vp"
        style={{ transform: `scale(${box.scale})` }}
        inert
      >
        <div className={cls} data-side={loreSideOf(pilot)} data-variant={art?.variant ?? 'wide'} data-dir="1">
          <div className="lore-stage-wrap">
            <LoreStage pilot={pilot} art={art} nameEn={lore.nameEn} />
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
                pilotName={pilot.name}
              />
            ) : (
              <LoreDossier pilot={pilot} lore={lore} chapters={publishedChapters(chapters)} chapterHref={() => '#'} logoLabel={logoLabel} />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
