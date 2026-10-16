import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import LoreStage from '../../components/lore/LoreStage'
import MechDossier, { CARD_LABEL, type MechLineageItem } from '../../components/lore/MechDossier'
import LoreChapterPager from '../../components/lore/LoreChapterPager'
import LoreChapterBody from '../../components/lore/LoreChapterBody'
import LoreSkinPicker from '../../components/lore/LoreSkinPicker'
import LoreViewer from '../../components/lore/LoreViewer'
import LoreSwitcher, { type LoreRosterGroup } from '../../components/lore/LoreSwitcher'
import { FactionLogo } from '../../components/icons/FactionLogo'
import { mechSubject } from '../../components/lore/loreSubject'
import { buildMechGroups } from '../../components/lore/mechRoster'
import { readLoreSort, writeLoreSort, type LoreSort } from '../../components/lore/loreRoster'
import { publishedChapters } from '../../components/lore/loreText'
import { mechSkinStageArt, mechStageArt, preloadImages, preloadStageArt, type StageArt } from '../../components/lore/loreStageArt'
import { makerStageArt, mechCardArt, mechSkins, type PilotSkinArt } from '../../utils/gameArt'
import { assetUrl } from '../../utils/assets'
import { pairedPilotOf } from '../../utils/officialPairs'
import { useMechLore, useMechMakers, useMechs, usePilots } from '../../hooks/useFirestore'
import type { Mech, MechLoreDoc, MechRelationKind } from '../../types'
import { usePageTitle } from '../../contexts/PageTitleContext'
import { useLoreHall } from './useLoreHall'

/**
 * 機甲故事館的扉頁與章節頁（PLAN-042-B Phase D）。結構與 PilotLorePage 相同：
 * `/lore/mechs/:id` 是檔案、`/lore/mechs/:id/:part` 是閱讀模式，同一個元件、同一棵樹；
 * 狀態機在 useLoreHall（C-3），本頁只管機甲的資料與畫面。
 *
 * ── 照著做，錯了都不會有錯誤訊息 ───────────────────────────────────────────
 * ① 守衛順序 error → loading → 內容（地雷 M-04）：抓取失敗時 loading 恆為 true。
 * ② mechLore 不擋整頁：整頁只等 mechs；mechLore 的 error／loading 交給卷宗（MechDossier 的 status）。
 * ③ 廠商（mechMakers）只是名稱與徽章：讀不到就顯示「廠商未載」、名冊歸到未載那組，不擋頁面。
 *
 * 塗裝（F-1）：圖在 game/mechs/<wap>/skins/、名稱／隱藏／順序在 mechLore.skins（mechSkins() 合併）；35 台有、其餘沒有塗裝列。
 * 鑑賞（D-4）：主視覺／塗裝／四分件／招募插畫，背景可切廠商舞台或紙色（招募插畫本身不透明，不給切）。
 */

/** 同一個分頁裡，每台最後選的塗裝（與機師廳分開記） */
const rememberedSkins = new Map<string, string>()
/** 鑑賞背景的偏好（同一個分頁內記住；預設廠商舞台＝遊戲內機甲圖鑑的樣子） */
let viewerBgPref: 'stage' | 'paper' = 'stage'

interface MechStage { art: StageArt | null; skins: PilotSkinArt[]; skin: PilotSkinArt | null }
const NO_SKINS: PilotSkinArt[] = []
/** 機甲的舞台：預設主視覺，或網址 `?skin=` 指到的那套塗裝（對不到＝預設） */
function stageArtFor(mech: Mech, skinKey: string, lore: MechLoreDoc | undefined): MechStage {
  const skins = mechSkins(mech, lore)
  const skin = skinKey ? skins.find((s) => s.key === skinKey) ?? null : null
  return { art: skin ? mechSkinStageArt(mech, skin) : mechStageArt(mech), skins, skin }
}

const SORT_LABELS: Record<LoreSort, string> = { class: '廠商', debut: '登場版本' }

export default function MechLorePage() {
  const { id: urlId } = useParams<{ id: string }>()
  const { data: mechs, loading, error } = useMechs()
  // 分頁標題跟網址走（PLAN-061），不跟過場中的 shown
  const titleName = mechs.find((m) => m.id === urlId)?.name
  usePageTitle(titleName ? `${titleName} 機甲故事` : null)
  // 只交給卷宗，不擋整頁：見檔頭第 ② 條
  const { data: loreDocs, loading: loreLoading, error: loreError } = useMechLore()
  const loreById = useMemo(() => new Map(loreDocs.map((d) => [d.id, d])), [loreDocs])
  const { data: makers } = useMechMakers()
  const makerById = useMemo(() => new Map(makers.map((m) => [m.id, m])), [makers])
  // 官配機師（搭乘者卡）：pilots 讀不到只少一張卡，不看 loading／error
  const { data: pilots } = usePilots()

  // ── 名冊（依廠商／登場版本；與機師廳共用同一個排序偏好）──────────────────────────
  const [sort, setSortState] = useState<LoreSort>(readLoreSort)
  const setSort = useCallback((s: LoreSort) => { setSortState(s); writeLoreSort(s) }, [])
  const groups = useMemo(
    () => buildMechGroups(mechs, sort, (m) => loreById.get(m.id)?.maker, makers),
    [mechs, sort, loreById, makers],
  )
  const order = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const subjectOf = useCallback((m: Mech) => {
    const lore = loreById.get(m.id)
    return mechSubject(m, lore, lore?.maker ? makerById.get(lore.maker) : null)
  }, [loreById, makerById])
  const rosterGroups = useMemo<LoreRosterGroup[]>(() => groups.map((g) => ({
    key: g.key,
    label: g.label,
    icon: g.maker?.logo ? <FactionLogo logoKey={g.maker.logo} size={18} label={g.label} /> : undefined,
    items: g.items.map(subjectOf),
  })), [groups, subjectOf])
  const rosterOrder = useMemo(() => rosterGroups.flatMap((g) => g.items), [rosterGroups])
  const chapterCounts = useMemo(() => new Map(loreDocs.map((d) => [d.id, publishedChapters(d.chapters).length])), [loreDocs])
  const chapterCount = useCallback((mid: string) => chapterCounts.get(mid) ?? 0, [chapterCounts])
  const skinCounts = useMemo(() => new Map(mechs.map((m) => [m.id, mechSkins(m, loreById.get(m.id)).length])), [mechs, loreById])
  const skinCount = useCallback((m: { id: string }) => skinCounts.get(m.id) ?? 0, [skinCounts])

  // 系譜的反查：別台的 relations 連到這台（人工連好的資料，不是文字比對；決策 B-10）
  const incoming = useMemo(() => {
    const map = new Map<string, { from: string; kind?: MechRelationKind; note?: string }[]>()
    for (const d of loreDocs) {
      for (const r of d.relations ?? []) {
        const list = map.get(r.mechId) ?? []
        list.push({ from: d.id, kind: r.kind, note: r.note })
        map.set(r.mechId, list)
      }
    }
    return map
  }, [loreDocs])

  // ── 展廳狀態機（C-3）────────────────────────────────────────────────────────
  const stageOf = useCallback((m: Mech, skinKey: string) => stageArtFor(m, skinKey, loreById.get(m.id)), [loreById])
  const chaptersOf = useCallback((mid: string) => publishedChapters(loreById.get(mid)?.chapters), [loreById])
  const {
    id, shown, stage, phase, rootRef, switcherRef, progressRef, className, dir, onTouchStart, onTouchEnd,
    select, chapters, activeIndex, chapterDir, isReading, selectChapter, chapterHref, fileHref,
    pickSkin, viewer, openViewer, closeViewer, onViewerClosed, stageArtRect, setRosterOpen,
  } = useLoreHall({
    basePath: '/lore/mechs',
    entities: mechs,
    order,
    stageOf,
    chaptersOf,
    chaptersSettled: !!loreError || !loreLoading,
    rememberedSkins,
  })
  const lore = phase.shownId ? loreById.get(phase.shownId) ?? null : null
  const maker = lore?.maker ? makerById.get(lore.maker) ?? null : null
  const art = stage?.art ?? null
  const shownSubject = useMemo(() => (shown ? mechSubject(shown, lore, maker) : null), [shown, lore, maker])

  const lineage = useMemo<MechLineageItem[]>(() => {
    if (!shown) return []
    const byId = new Map(mechs.map((m) => [m.id, m]))
    const out: MechLineageItem[] = []
    const seen = new Set<string>()
    for (const r of lore?.relations ?? []) {
      const m = byId.get(r.mechId)
      if (!m || seen.has(m.id)) continue   // 指向已刪掉的機甲：略過那一條
      seen.add(m.id)
      out.push({ mech: m, modelNo: loreById.get(m.id)?.modelNo, kind: r.kind, dir: 0, note: r.note })
    }
    for (const r of incoming.get(shown.id) ?? []) {
      const m = byId.get(r.from)
      if (!m || seen.has(m.id)) continue
      seen.add(m.id)
      out.push({ mech: m, modelNo: loreById.get(m.id)?.modelNo, kind: r.kind, dir: 1, note: r.note })
    }
    return out
  }, [shown, lore, mechs, loreById, incoming])
  const pilot = useMemo(() => (shown ? pairedPilotOf(shown.id, pilots) ?? null : null), [shown, pilots])

  // ── 鑑賞：主視覺（或選中的塗裝）、某一張分件、招募插畫。後兩者從卷宗那格縮圖飛出去、飛回來 ─────────
  const [part, setPart] = useState<{ src: string; label: string; el: HTMLElement } | null>(null)
  const [viewerBg, setViewerBgState] = useState(viewerBgPref)
  const setViewerBg = useCallback((v: 'stage' | 'paper') => { viewerBgPref = v; setViewerBgState(v) }, [])
  const openPart = useCallback((src: string, el: HTMLElement, label: string) => {
    setPart({ src, label, el })
    openViewer()
  }, [openViewer])
  const openMain = useCallback(() => { setPart(null); openViewer() }, [openViewer])
  const partRect = useCallback(() => (part?.el.isConnected ? part.el.getBoundingClientRect() : null), [part])

  // ① error → ② loading → ③ 查無（順序不可調換，見檔頭）
  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl px-4 py-3 text-sm text-accent-red">資料載入失敗：{error.message}</div>
        <Link to="/lore/mechs" className="mt-4 inline-block text-sm text-accent-orange no-underline">← 回故事館</Link>
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
        <p>找不到機甲資料</p>
        <Link to="/lore/mechs" className="text-accent-orange no-underline text-sm mt-4 inline-block">← 回故事館</Link>
      </div>
    )
  }

  // 回圖鑑：指向「顯示中的那台」（換台時網址先變、畫面落後一拍）
  const codexHref = `/mechs/${encodeURIComponent(shown.id)}`
  const cardUrl = mechCardArt(shown)
  const cardSrc = cardUrl ? assetUrl(cardUrl) : undefined
  const stageBgUrl = makerStageArt(maker)
  const stageBg = stageBgUrl ? assetUrl(stageBgUrl) : undefined
  // 招募插畫是整張場景（不透明）：背景切了也看不到，不給切
  const viewingCard = part?.label === CARD_LABEL
  const skins = stage?.skins ?? NO_SKINS

  const tools = (
    <>
      <LoreSkinPicker subject={shownSubject} skins={skins} current={stage?.skin?.key ?? ''} onPick={pickSkin} noun="塗裝" />
      {art && (
        <button
          type="button"
          className="lore-pill"
          onPointerEnter={() => { void preloadImages([art.full]) }}
          onFocus={() => { void preloadImages([art.full]) }}
          onClick={openMain}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" /></svg>
          鑑賞
        </button>
      )}
    </>
  )

  return (
    <div
      ref={rootRef}
      className={className}
      data-side="left"
      // 卷宗的位置一律照主視覺（sn）：塗裝（mskin）的幾何在 .lore-figure 自己身上，換塗裝時卷宗不跟著跳
      data-variant="sn"
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
          <MechDossier
            mech={shown}
            lore={lore}
            maker={maker}
            status={loreError ? 'error' : loreLoading ? 'loading' : 'ready'}
            chapters={chapters}
            chapterHref={chapterHref}
            lineage={lineage}
            lineageHref={(mid) => `/lore/mechs/${encodeURIComponent(mid)}`}
            pilot={pilot}
            pilotHref={(pid) => `/lore/pilots/${encodeURIComponent(pid)}`}
            codexHref={codexHref}
            onOpenPart={openPart}
            cardSrc={cardSrc}
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
          noun="機甲"
          searchPlaceholder="搜尋名字、型號、英文名、廠商…"
          sortLabels={SORT_LABELS}
          skinNoun="塗裝"
          unit="台"
          onHover={(s) => {
            const m = mechs.find((x) => x.id === s.id)
            if (m) void preloadStageArt(stageArtFor(m, rememberedSkins.get(m.id) ?? '', loreById.get(m.id)).art)
          }}
        />
      )}

      {viewer !== 'closed' && art && (
        <LoreViewer
          src={part?.src ?? art.full}
          name={part ? `${shown.name}・${part.label}` : stage?.skin ? `${shown.name}・${stage.skin.label}` : shown.name}
          label="鑑賞"
          backdrop={!viewingCard && viewerBg === 'stage' ? stageBg : undefined}
          onClose={closeViewer}
          originRect={part ? partRect : stageArtRect}
          closing={viewer === 'closing'}
          onClosed={() => { onViewerClosed(); setPart(null) }}
        >
          {((stageBg && !viewingCard) || (!part && skins.length > 0)) && (
            <div className="lore-viewer__tools">
              {stageBg && !viewingCard && (
                <div className="lore-skins lore-bgtoggle" role="radiogroup" aria-label="背景">
                  <span className="lore-skins__lbl">背景</span>
                  {([['stage', '廠商舞台'], ['paper', '紙色']] as const).map(([v, t]) => (
                    <button key={v} type="button" role="radio" aria-checked={viewerBg === v} className="lore-bgopt" onClick={() => setViewerBg(v)}>{t}</button>
                  ))}
                </div>
              )}
              {/* 塗裝只在看主視覺時能換（看分件或招募插畫時，換了也看不到） */}
              {!part && <LoreSkinPicker subject={shownSubject} skins={skins} current={stage?.skin?.key ?? ''} onPick={pickSkin} noun="塗裝" />}
            </div>
          )}
        </LoreViewer>
      )}
    </div>
  )
}
