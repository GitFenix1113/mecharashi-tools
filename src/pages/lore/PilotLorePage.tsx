import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import LoreStage from '../../components/lore/LoreStage'
import LoreDossier from '../../components/lore/LoreDossier'
import LoreChapterPager from '../../components/lore/LoreChapterPager'
import LoreChapterBody from '../../components/lore/LoreChapterBody'
import LoreSkinPicker from '../../components/lore/LoreSkinPicker'
import LoreViewer from '../../components/lore/LoreViewer'
import GachaFxLive from '../../components/lore/gacha/GachaFxLive'
import { hasGachaFx, pilotGachaFxKey } from '../../components/lore/gacha/gachaFxRegistry'
import { useGachaFxPref } from '../../components/lore/gacha/gachaFxPref'
import LoreSwitcher, { type LoreRosterGroup } from '../../components/lore/LoreSwitcher'
import { ClassIcon } from '../../components/icons/ClassIcon'
import { MechTypeIcon } from '../../components/icons/MechTypeIcon'
import { pilotClassMeta } from '../../data/pilotClasses'
import { pilotSubject } from '../../components/lore/loreSubject'
import { buildLoreGroups, readLoreSort, withLoreNames, writeLoreSort, type LoreSort } from '../../components/lore/loreRoster'
import { publishedChapters } from '../../components/lore/loreText'
import { defaultStageArt, loreSideOf, preloadImages, preloadStageArt, skinStageArt, type StageArt } from '../../components/lore/loreStageArt'
import { pilotCard, pilotSkins, type PilotSkinArt } from '../../utils/gameArt'
import { assetUrl } from '../../utils/assets'
import { useFactionEmblems, useMechLore, useMechs, usePilotLore, usePilots } from '../../hooks/useFirestore'
import { emblemTitle, emblemsById } from '../../utils/factionEmblems'
import type { LoreDoc, Pilot } from '../../types'
import { usePageTitle } from '../../contexts/PageTitleContext'
import { useLoreHall } from './useLoreHall'

/**
 * 機師故事館的扉頁與章節頁（PLAN-042-A D-3；PLAN-042-D 改版成「舞台＋卷宗」）。
 *
 * `/lore/pilots/:id` 是檔案（扉頁），`/lore/pilots/:id/:part` 是閱讀模式 —— **同一個元件**、同一棵樹：
 * 換章、換人、進出閱讀模式都不會卸載舞台，動畫才接得起來。外觀放在 `?skin=<立繪鍵>`。
 * 開場／換人／外觀／章節／鍵盤的狀態機在 `useLoreHall`（PLAN-042-B C-3，與機甲廳共用）；本頁只管機師的資料與畫面。
 *
 * ── 三件事必須照著做，錯了都不會有錯誤訊息 ──────────────────────────────
 * ① **守衛順序是 error → loading → 內容**（地雷 M-04）：抓取失敗時 loading 恆為 true。
 * ② **pilotLore 不擋整頁**：整頁只等 pilots（舞台、名冊、換人都只要身分欄位）。pilotLore 的 error／loading
 *   只交給卷宗（LoreDossier 的 status）——PLAN-042-E 起簡介與個人資料也住 pilotLore，讀不到時卷宗要明講
 *   「載入失敗」，不能退化成看起來像空白資料的扉頁；同樣先判 error 再判 loading（失敗時 loading 恆為 true）。
 * ③ **構圖在渲染前決定**（loreStage.ts）：直式全身／橫式半身／官網圖層／場景插畫的取景不同，等圖載完再換會跳。
 *
 * 草稿章（LoreChapter.draft）一律經 `publishedChapters()` 濾掉：目錄、‹ ›、章節網址都看不到，
 * 草稿章（或打錯）的章節網址導回扉頁。
 *
 * 鑑賞（LoreViewer）看兩種圖：舞台的全身立繪，或卷宗最後的招募插畫（PLAN-042-A Phase J，比照機甲廳）。
 * 招募插畫有卡池動態（src/data/gachaFx/pilots/<gameId>.json）才疊 GachaFxLive，且只在看招募插畫時播。
 *
 * ⚠ 館內唯一的 scrollport 是 LoreLayout 的 `.lore-scroll`（M-08），本頁不開任何 overflow-y；
 *   舞台是 sticky 全高層＋負 margin，卷宗在同一個 scrollport 裡疊上去。
 */

/** 同一個分頁裡，每位機師最後選的外觀（換人再回來還記得） */
const rememberedSkins = new Map<string, string>()

/** 外觀的名稱、隱藏、順序在 pilotLore（PLAN-042-E E-1）；lore 讀不到時照圖檔層原樣列 */
function stageArtFor(pilot: Pilot, skinKey: string, lore: LoreDoc | undefined): { art: StageArt | null; skins: PilotSkinArt[]; skin: PilotSkinArt | null } {
  const skins = pilotSkins(pilot, lore)
  const skin = skinKey ? skins.find((s) => s.key === skinKey) ?? null : null
  return { art: skin ? skinStageArt(pilot, skin) : defaultStageArt(pilot), skins, skin }
}

export default function PilotLorePage() {
  const { id: urlId } = useParams<{ id: string }>()
  const { data: pilots, loading, error } = usePilots()
  // 分頁標題跟網址走（PLAN-061），不跟過場中的 shown：退場動畫期間網址已經是下一位
  const titleName = pilots.find((p) => p.id === urlId)?.name
  usePageTitle(titleName ? `${titleName} 機師故事` : null)
  // 只交給卷宗，不擋整頁：見檔頭第 ② 條
  const { data: loreDocs, loading: loreLoading, error: loreError } = usePilotLore()
  const loreById = useMemo(() => new Map(loreDocs.map((d) => [d.id, d])), [loreDocs])
  // 徽章名稱（PLAN-042-F）只是滑鼠提示：讀不到就退回陣營文字，loading／error 都不看
  const { data: emblems } = useFactionEmblems()
  const logoLabel = useMemo(() => {
    const byId = emblemsById(emblems)
    return (key: string) => emblemTitle(key, byId)
  }, [emblems])
  // 座機卡（PLAN-042-B D-7）：機甲與型號讀不到只少一張卡，不看 loading／error
  const { data: mechs } = useMechs()
  const { data: mechLoreDocs } = useMechLore()

  // ── 名冊順序（＝館首頁的排序；A-2）─────────────────────────────────────────
  const [sort, setSortState] = useState<LoreSort>(readLoreSort)
  const setSort = useCallback((s: LoreSort) => { setSortState(s); writeLoreSort(s) }, [])
  // 名冊成員帶 pilotLore 的英文名（搜尋、title 要用；PLAN-042-E 起它不在 pilots 上）
  const groups = useMemo(() => buildLoreGroups(withLoreNames(pilots, loreDocs), sort), [pilots, loreDocs, sort])
  const order = useMemo(() => groups.flatMap((g) => g.items), [groups])
  // 共用的切換列／名冊只認得 LoreSubject（PLAN-042-B C-2）：組的色調與職業圖示在這裡決定
  const rosterGroups = useMemo<LoreRosterGroup[]>(() => groups.map((g) => ({
    key: g.key,
    label: g.label,
    tone: sort === 'class' ? (pilotClassMeta(g.key)?.paper ?? 'var(--lore-ink-2)') : 'var(--lore-ink-2)',
    // 依駕照分組時圖示維持中性色：類型色會和頭像外圈的職業色撞（決策十）
    icon: sort === 'class' ? <ClassIcon pilotClass={g.key} size={18} decorative />
      : sort === 'weight' ? <MechTypeIcon type={g.key} size={18} decorative /> : undefined,
    items: g.items.map(pilotSubject),
  })), [groups, sort])
  const rosterOrder = useMemo(() => rosterGroups.flatMap((g) => g.items), [rosterGroups])
  const pilotById = useMemo(() => new Map(pilots.map((p) => [p.id, p])), [pilots])
  const chapterCounts = useMemo(() => new Map(loreDocs.map((d) => [d.id, publishedChapters(d.chapters).length])), [loreDocs])
  const skinCounts = useMemo(() => new Map(pilots.map((p) => [p.id, pilotSkins(p, loreById.get(p.id)).length])), [pilots, loreById])
  const chapterCount = useCallback((pid: string) => chapterCounts.get(pid) ?? 0, [chapterCounts])
  const skinCount = useCallback((p: { id: string }) => skinCounts.get(p.id) ?? 0, [skinCounts])

  // ── 展廳狀態機（PLAN-042-B C-3）────────────────────────────────────────────
  const stageOf = useCallback((p: Pilot, skinKey: string) => stageArtFor(p, skinKey, loreById.get(p.id)), [loreById])
  const chaptersOf = useCallback((pid: string) => publishedChapters(loreById.get(pid)?.chapters), [loreById])
  const {
    id, shown, stage, phase, rootRef, switcherRef, progressRef, className, dir, onTouchStart, onTouchEnd,
    select, chapters, activeIndex, chapterDir, isReading, selectChapter, chapterHref, fileHref,
    pickSkin, viewer, openViewer, closeViewer, onViewerClosed, stageArtRect, setRosterOpen,
  } = useLoreHall({
    basePath: '/lore/pilots',
    entities: pilots,
    order,
    stageOf,
    chaptersOf,
    chaptersSettled: !!loreError || !loreLoading,
    rememberedSkins,
  })
  const lore = phase.shownId ? loreById.get(phase.shownId) : undefined
  // 鑑賞看的是招募插畫時記著點下去的那張卡（飛行動畫的起點）；null＝看全身立繪
  const [cardEl, setCardEl] = useState<HTMLElement | null>(null)
  const openCard = useCallback((el: HTMLElement) => { setCardEl(el); openViewer() }, [openViewer])
  const openMain = useCallback(() => { setCardEl(null); openViewer() }, [openViewer])
  const cardRect = useCallback(() => (cardEl?.isConnected ? cardEl.getBoundingClientRect() : null), [cardEl])
  // 卡池動態的開關（兩館共用、同分頁記住；預設看 prefers-reduced-motion／省流量，見 gachaFxPref.ts）
  const [fxOn, setFxOn] = useGachaFxPref()
  const art = stage?.art ?? null
  const skins = stage?.skins ?? []
  const skin = stage?.skin ?? null
  // 舞台與外觀列吃的「這位」：英文名來自 pilotLore（PLAN-042-E），與名冊的 withLoreNames 同源
  const shownSubject = useMemo(() => (shown ? pilotSubject({ ...shown, nameEn: lore?.nameEn }) : null), [shown, lore])
  const pairedMech = useMemo(() => {
    const mech = shown?.pairedMechId ? mechs.find((m) => m.id === shown.pairedMechId) : undefined
    if (!mech) return null
    return {
      mech,
      modelNo: mechLoreDocs.find((d) => d.id === mech.id)?.modelNo,
      href: `/lore/mechs/${encodeURIComponent(mech.id)}`,
    }
  }, [shown, mechs, mechLoreDocs])

  // ① error → ② loading → ③ 查無（順序不可調換，見檔頭）
  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl px-4 py-3 text-sm text-accent-red">資料載入失敗：{error.message}</div>
        <Link to="/lore" className="mt-4 inline-block text-sm text-accent-orange no-underline">← 回故事館</Link>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="h-96 bg-bg-card border border-border rounded-xl animate-pulse" />
      </div>
    )
  }
  if (!shown || !shownSubject) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center text-text-dim">
        <p>找不到機師資料</p>
        <Link to="/lore" className="text-accent-orange no-underline text-sm mt-4 inline-block">← 回故事館</Link>
      </div>
    )
  }

  // 回圖鑑（PLAN-042-G）：指向「顯示中的那位」而不是網址的 id——換人時網址先變、舞台與卷宗落後一拍，
  // 點下去應該去畫面上看到的那位
  const codexHref = `/pilots/${encodeURIComponent(shown.id)}`
  const card = pilotCard(shown)
  const cardUrl = card?.src
  const cardSrc = cardUrl ? assetUrl(cardUrl) : undefined
  const viewingCard = !!cardEl && !!cardSrc
  // 卡池動態：這組卡池有資料（gachaFx/pilots/<gameId>.json，gameId＝圖所在的那位）才有，且只在看招募插畫時播
  const fxKeyRaw = pilotGachaFxKey(card?.home)
  const fxKey = hasGachaFx(fxKeyRaw) ? fxKeyRaw : undefined
  const viewerSrc = viewingCard ? cardSrc : art?.full

  const tools = (
    <>
      <LoreSkinPicker subject={shownSubject} skins={skins} current={skin?.key ?? ''} onPick={pickSkin} />
      {art && (
        // 指到就先載鑑賞圖：官網 8 位與場景外觀的鑑賞圖跟舞台不是同一張，載完才能從舞台飛出去
        <button
          type="button"
          className="lore-pill"
          onPointerEnter={() => { void preloadImages([art.full]) }}
          onFocus={() => { void preloadImages([art.full]) }}
          onClick={openMain}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" /></svg>
          全身立繪
        </button>
      )}
    </>
  )

  return (
    <div
      ref={rootRef}
      className={className}
      data-side={loreSideOf(shown)}
      data-variant={art?.variant ?? 'wide'}
      data-dir={dir}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="lore-stage-wrap">
        <LoreStage subject={shownSubject} art={art} tools={tools} />
      </div>

      <main className="lore-dossier">
        {isReading ? (
          <LoreChapterPager chapters={chapters} activeKey={chapters[activeIndex].key} onSelect={selectChapter} backHref={fileHref}>
            {/* key＝章節 key：換章重掛，稿紙的進場動畫才會重播。⚠ 不得 {...chapter} spread（見 LoreChapterBody 檔頭） */}
            <LoreChapterBody
              key={chapters[activeIndex].key}
              chapter={chapters[activeIndex]}
              index={activeIndex}
              prev={chapters[activeIndex - 1]}
              next={chapters[activeIndex + 1]}
              onSelect={selectChapter}
              backHref={fileHref}
              pilotName={shown.name}
              dir={chapterDir}
            />
          </LoreChapterPager>
        ) : (
          <LoreDossier
            pilot={shown}
            lore={lore ?? null}
            status={loreError ? 'error' : loreLoading ? 'loading' : 'ready'}
            chapters={chapters}
            chapterHref={chapterHref}
            logoLabel={logoLabel}
            codexHref={codexHref}
            pairedMech={pairedMech}
            cardSrc={cardSrc}
            cardLive={!!fxKey}
            onOpenCard={openCard}
          />
        )}
      </main>

      {isReading && <div ref={progressRef} className="lore-progress" aria-hidden="true" />}

      {order.length > 1 && id && (
        <LoreSwitcher
          ref={switcherRef}
          groups={rosterGroups}
          order={rosterOrder}
          currentId={id}
          sort={sort}
          onSortChange={setSort}
          chapterCount={chapterCount}
          skinCount={skinCount}
          onSelect={select}
          onOpenChange={setRosterOpen}
          codexHref={codexHref}
          codexName={shown.name}
          onHover={(s) => {
            const p = pilotById.get(s.id)
            if (p) void preloadStageArt(stageOf(p, rememberedSkins.get(p.id) ?? '').art)
          }}
        />
      )}

      {viewer !== 'closed' && viewerSrc && (
        <LoreViewer
          src={viewerSrc}
          // 招募插畫的圖名用卡池名稱（pilotLore.gachaTitle），沒填才叫「招募插畫」
          name={viewingCard ? `${shown.name}・${lore?.gachaTitle?.trim() || '招募插畫'}` : shown.name}
          label={viewingCard ? '鑑賞' : undefined}
          onClose={closeViewer}
          originRect={viewingCard ? cardRect : stageArtRect}
          closing={viewer === 'closing'}
          onClosed={() => { onViewerClosed(); setCardEl(null) }}
          live={viewingCard && fxKey && fxOn && cardSrc ? (zoom) => <GachaFxLive fxKey={fxKey} background={cardSrc} zoom={zoom} /> : undefined}
        >
          {viewingCard ? (
            fxKey && (
              <div className="lore-viewer__tools">
                <div className="lore-skins lore-bgtoggle" role="radiogroup" aria-label="卡池動態">
                  <span className="lore-skins__lbl">卡池</span>
                  {([[true, '動態'], [false, '靜態']] as const).map(([v, t]) => (
                    <button key={t} type="button" role="radio" aria-checked={fxOn === v} className="lore-bgopt" onClick={() => setFxOn(v)}>{t}</button>
                  ))}
                </div>
              </div>
            )
          ) : (
            // 外觀只在看全身立繪時能換（看招募插畫時換了也看不到）
            <LoreSkinPicker subject={shownSubject} skins={skins} current={skin?.key ?? ''} onPick={pickSkin} className="lore-skins" />
          )}
        </LoreViewer>
      )}
    </div>
  )
}
