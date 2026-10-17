import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FallbackImage } from '../../components/common/FallbackImage'
import { pilotClassMeta } from '../../data/pilotClasses'
import { mechWeightClassOf } from '../../data/mechWeightClasses'
import { ClassIcon } from '../../components/icons/ClassIcon'
import { FactionLogo } from '../../components/icons/FactionLogo'
import { MechTypeIcon } from '../../components/icons/MechTypeIcon'
import { normalizeFactionLogos } from '../../utils/factionLogos'
import { toneBar } from '../../components/loadout/PickerVariants'
import { useMechLore, useMechMakers, useMechs, usePilotLore, usePilots } from '../../hooks/useFirestore'
import { assetUrl, mechPortraitCandidates, pilotPortraitCandidates } from '../../utils/assets'
import { mechCardArt, pilotCardArt } from '../../utils/gameArt'
import { GAME_MECH_CARDS } from '../../data/gameArtIndex'
import type { Mech, MechMaker, Pilot } from '../../types'
import { buildLoreGroups, LORE_SORTS, readLoreSort, writeLoreSort, type LoreSort } from '../../components/lore/loreRoster'
import { buildMechGroups } from '../../components/lore/mechRoster'
import { publishedChapters } from '../../components/lore/loreText'
import { PILOT_HERO_POOL, pickHeroCard } from '../../components/lore/loreHeroCast'

/**
 * 故事館的館首頁：機師廳（`/lore`，PLAN-042-A D-2）與機甲廳（`/lore/mechs`，PLAN-042-B E-1）。
 *
 * 兩館各是一條路由、不是頁內分頁：網址可以分享、可以被收錄，header 的館名也跟著網址走。
 * 兩條路由掛同一個元件，`hall` 決定畫哪一館；兩館的資料 hook 分在 PilotHall／MechHall 裡，
 * 進機師廳不會順便抓 mechs。
 *
 * ── 為什麼列 `pilots`／`mechs` 而不是 `pilotLore`／`mechLore`（決策 D）──
 * 牆是「名冊」：名字、類別、版本、立繪都是實體本身的身分欄位，故事集合只拿來疊章節數與徽章。
 * 讀不到故事集合時牆照樣完整（只少了角標）；改列故事集合則等於把牆的完整性綁在故事資料上。
 *
 * ⚠ **89 張卡片、88 張縮圖是正確現象。** `public/images/pilots/` 只有 88 個資料夾——
 *   賽拉的 `portrait` 是空字串、沒有圖片資料夾。她要照樣出現在牆上、縮圖走
 *   `FallbackImage` 的佔位（比照全站「未建檔不留白」慣例）。
 *   **不要加過濾把她藏起來**，那才是真的 bug。
 */
export default function LoreHomePage({ hall = 'pilots' }: { hall?: LoreHall }) {
  return hall === 'mechs' ? <MechHall /> : <PilotHall />
}

// ─── 機師廳 ──────────────────────────────────────────────────────────────────

function PilotHall() {
  const { data: pilots, loading, error } = usePilots()
  // ⚠ 刻意不取 usePilotLore 的 loading：ensureLoaded 的 catch 只寫 errorMap、不把 key 加進
  //   loadedKeys ⇒ 抓取失敗時它的 loading 永遠是 true，gate 在它身上會讓整面牆永遠轉圈。
  //   章節徽章消失是可接受的降級，牆不見不是。
  const { data: loreDocs, error: loreError } = usePilotLore()
  const [sort, setSort] = useLoreSortPref()

  // ⚠ 泛型要自己標：`Object.fromEntries` 對 `(string | number)[]` 這種非 tuple 的 entry
  //   會落到回傳 any 的那條多載，不標就是把 any 一路傳進 <PilotCard>。
  //   草稿章不計入（publishedChapters，PLAN-042-E D-5）；它也兼顧 Worker 回來的舊文件缺 chapters 欄位。
  const chapterCount = useMemo<Record<string, number>>(
    () => Object.fromEntries(loreDocs.map((d) => [d.id, publishedChapters(d.chapters).length])),
    [loreDocs],
  )
  // 陣營徽章（PLAN-059 D-4）：卡片左上角只放第一個。和章節數同一份 pilotLore，讀不到時一起消失
  const firstLogo = useMemo<Record<string, string | undefined>>(
    () => Object.fromEntries(loreDocs.map((d) => [d.id, normalizeFactionLogos(d.factionLogos)[0]])),
    [loreDocs],
  )

  const groups = useMemo(() => buildGroups(pilots, sort), [pilots, sort])
  const hero = <PilotHero count={loading || error ? undefined : pilots.length} />

  // ── 守衛順序一律 error → loading → 內容（地雷 M-04）──
  // 反過來寫的話，抓取失敗時 loading 恆為 true，`if (loading)` 先命中 ⇒ 永遠看不到錯誤分支：
  // 畫面一直轉圈、沒有紅字、沒有 console error。
  if (error) return <PageFrame hero={hero}><LoadError message={error.message} /></PageFrame>
  if (loading) return <PageFrame hero={hero}><WallSkeleton cell="aspect-square" grid={GRID} /></PageFrame>

  return (
    <PageFrame hero={hero}>
      <SortBar sort={sort} onSort={setSort} sortLabels={PILOT_SORT_LABELS} />

      {/* loreError 不是致命：只讓章節徽章與陣營角標消失，牆照常渲染。 */}
      {loreError && (
        <p className="mb-4 text-xs text-text-dim">章節索引暫時讀不到，卡片上的章節數先不顯示。</p>
      )}

      {groups.map((g) => (
        <section key={g.key} className="mb-8 last:mb-0">
          <h2 className="mb-3 flex items-center gap-2">
            <span aria-hidden className={`h-4 w-[3px] ${toneBar(g.tone)}`} />
            {/* 依職業分組時標題前放職業圖示（PLAN-059 C-4）；依版本分組時 key 不是職業，ClassIcon 什麼都不畫。
                依駕照分組時放 L／M／H 圖示，中性色（決策十：類型色會和職業色撞） */}
            <span className={`inline-flex items-center gap-1.5 text-sm font-bold ${g.tone || 'text-text-secondary'}`}>
              {sort === 'weight'
                ? <MechTypeIcon type={g.key} size={16} decorative />
                : <ClassIcon pilotClass={g.key} size={16} decorative />}
              {g.label}
            </span>
            <span className="text-xs text-text-dim">{g.items.length}</span>
          </h2>

          <div className={GRID}>
            {g.items.map((p) => (
              <PilotCard key={p.id} pilot={p} chapters={chapterCount[p.id] ?? 0} logo={firstLogo[p.id]} />
            ))}
          </div>
        </section>
      ))}
    </PageFrame>
  )
}

// ─── 機甲廳（PLAN-042-B E-1）────────────────────────────────────────────────

/**
 * 結構照抄機師廳，差在三處：
 * ① 分組是「廠商／登場版本／類型」（mechRoster.ts，與展廳名冊同一套），組頭放廠商徽章或 L／M／H 圖示。
 * ② 廠商住在 mechLore.maker、名稱與徽章住在 mechMakers ⇒ 依廠商分組要等**這兩份都落定**才畫牆，
 *    否則先整面歸「廠商未載」、資料到了再重排，牆會跳一次。「落定」＝讀到或讀失敗（失敗時 loading 恆為 true，
 *    理由同機師廳的 usePilotLore）；讀失敗就照樣畫，全部歸未載那組，不擋牆。
 * ③ 卡片是 560×340 的橫幅立繪（官方 `Icon_mecha_wap####`，左緣已淡出），色條是輕／中／重的類型色。
 */
function MechHall() {
  const { data: mechs, loading, error } = useMechs()
  const { data: loreDocs, loading: loreLoading, error: loreError } = useMechLore()
  const { data: makers, loading: makersLoading, error: makersError } = useMechMakers()
  const [sort, setSort] = useLoreSortPref()

  const loreById = useMemo(() => new Map(loreDocs.map((d) => [d.id, d])), [loreDocs])
  const makerById = useMemo(() => new Map(makers.map((m) => [m.id, m])), [makers])
  const chapterCount = useMemo<Record<string, number>>(
    () => Object.fromEntries(loreDocs.map((d) => [d.id, publishedChapters(d.chapters).length])),
    [loreDocs],
  )
  const groups = useMemo(
    () => buildMechGroups(mechs, sort, (m) => loreById.get(m.id)?.maker, makers),
    [mechs, sort, loreById, makers],
  )
  const settled = sort !== 'class' || ((!loreLoading || !!loreError) && (!makersLoading || !!makersError))
  const hero = <MechHero count={loading || error ? undefined : mechs.length} />

  if (error) return <PageFrame hero={hero}><LoadError message={error.message} /></PageFrame>
  if (loading || !settled) return <PageFrame hero={hero}><WallSkeleton cell="aspect-[28/17]" grid={MECH_GRID} /></PageFrame>

  return (
    <PageFrame hero={hero}>
      <SortBar sort={sort} onSort={setSort} sortLabels={MECH_SORT_LABELS} />

      {loreError && (
        <p className="mb-4 text-xs text-text-dim">機甲故事索引暫時讀不到：廠商分組、廠商徽章與章節數先不顯示。</p>
      )}

      {groups.map((g) => {
        // 依類型分組時組頭染上類型色（青／綠／紅，與卡片色條同色）；其餘分組維持中性
        const tone = sort === 'weight' ? (mechWeightClassOf(g.key)?.text ?? '') : ''
        return (
        <section key={g.key} className="mb-8 last:mb-0">
          <h2 className="mb-3 flex items-center gap-2">
            <span aria-hidden className={`h-4 w-[3px] ${toneBar(tone)}`} />
            <span className={`inline-flex items-center gap-1.5 text-sm font-bold ${tone || 'text-text-secondary'}`}>
              {sort === 'weight' && <MechTypeIcon type={g.key} size={18} decorative />}
              {g.maker?.logo && <FactionLogo logoKey={g.maker.logo} size={18} />}
              {g.label}
              {/* 英文名與中文名相同（KATANA）就不重複 */}
              {g.maker?.nameEn && g.maker.nameEn.toLowerCase() !== g.label.toLowerCase() && (
                <span className="font-mono text-[10px] font-normal tracking-[0.18em] text-text-dim">{g.maker.nameEn}</span>
              )}
            </span>
            <span className="text-xs text-text-dim">{g.items.length}</span>
          </h2>

          <div className={MECH_GRID}>
            {g.items.map((m) => {
              // 依廠商分組時組頭已經有徽章，卡片再標一次只是重複；依登場版本／類型時才在卡上標廠商
              const makerId = sort !== 'class' ? loreById.get(m.id)?.maker : undefined
              return (
                <MechCard
                  key={m.id}
                  mech={m}
                  chapters={chapterCount[m.id] ?? 0}
                  maker={makerId ? makerById.get(makerId) : undefined}
                />
              )
            })}
          </div>
        </section>
        )
      })}
    </PageFrame>
  )
}

// ─── 型別與常數 ──────────────────────────────────────────────────────────────

type LoreHall = 'pilots' | 'mechs'

interface LoreGroup {
  key: string
  label: string
  /** 區塊標題與色條共用的 `text-*` 類名；查無職業時是空字串 */
  tone: string
  items: Pilot[]
}

const GRID = 'grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7'
/** 機甲卡是橫幅（28:17），一列放的比機師少 */
const MECH_GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'

const PILOT_SORT_LABELS: Record<LoreSort, string> = { class: '依職業', debut: '依登場版本', weight: '依駕照' }
const MECH_SORT_LABELS: Record<LoreSort, string> = { class: '依廠商', debut: '依登場版本', weight: '依類型' }

/**
 * 排序是「名冊順序」（PLAN-042-D A-2）：詳情頁的切換列、名冊、‹ › 都照這個走，所以記在 sessionStorage。
 * 兩館共用同一個值：'class' 在機甲廳就是廠商、'weight' 在機師廳是駕照（mechRoster.ts）。
 */
function useLoreSortPref(): [LoreSort, (s: LoreSort) => void] {
  const [sort, setSortState] = useState<LoreSort>(readLoreSort)
  return [sort, (s) => { setSortState(s); writeLoreSort(s) }]
}

// ─── 分組 ────────────────────────────────────────────────────────────────────

/** 分組與排序本身在 loreRoster.ts（與詳情頁的名冊共用）；這裡只補上牆面用的色類名。 */
function buildGroups(pilots: Pilot[], sort: LoreSort): LoreGroup[] {
  return buildLoreGroups(pilots, sort).map((g) => ({
    ...g,
    tone: sort === 'class' ? (pilotClassMeta(g.key)?.text ?? '') : '',
  }))
}

// ─── 版面外殼 ────────────────────────────────────────────────────────────────

/**
 * 三個回傳分支共用的外框（錯誤卡／骨架／內容）。
 *
 * hero 由各館傳進來、放在同一個位置：資料到的那一刻（骨架 → 內容）hero 不會重掛，陣容不會當場換人。
 *
 * ⚠ 本頁不得開任何 `overflow-y-auto`：全館唯一的 scrollport 是 `LoreLayout` 的
 *   `.lore-scroll`，多開一層會讓兩條捲軸並存、館內的 sticky 相對錯誤的祖先定位。
 */
function PageFrame({ hero, children }: { hero: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {hero}
      {children}
    </div>
  )
}

function LoadError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-sm text-accent-red">
      資料載入失敗：{message}
    </div>
  )
}

function WallSkeleton({ cell, grid }: { cell: string; grid: string }) {
  return (
    <div className={grid}>
      {Array.from({ length: 14 }).map((_, i) => (
        <div key={i} className={`${cell} animate-pulse rounded-lg border border-border bg-bg-card`} />
      ))}
    </div>
  )
}

/**
 * 排序列。換館（機師｜機甲）不在這裡：2026-10-17 起兩館比照資料圖鑑分開，
 * 主導覽是「故事館 ▾」下拉、館內換館在紙色細帶的館名旁（Layout.tsx）。
 *
 * ⚠ 排序用 <button> 不用 <select>：紙色館內的 option 是由系統繪製的，
 *   色票覆寫不到（index.css 另有一條防禦式覆寫兜底，但不該依賴它）。
 */
function SortBar({ sort, onSort, sortLabels }: {
  sort: LoreSort
  onSort: (s: LoreSort) => void
  sortLabels: Record<LoreSort, string>
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-text-dim">排序</span>
        {LORE_SORTS.map((s) => (
          <button key={s} type="button" className={sortBtn(sort === s)} onClick={() => onSort(s)}>
            {sortLabels[s]}
          </button>
        ))}
      </div>
    </div>
  )
}

const sortBtn = (active: boolean) =>
  `rounded-lg border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
    active
      ? 'border-accent-orange/40 bg-accent-orange/15 text-accent-orange'
      : 'border-border bg-bg-card text-text-secondary hover:border-border-accent hover:text-text-primary'
  }`

// ─── hero ────────────────────────────────────────────────────────────────────

/**
 * 兩館共用的 hero：紅帶＋招募插畫（2600×1080 卡池主視覺）＋自排標題，就是官網首頁本來的構圖。
 * 插畫鋪在紅帶右側、紅帶壓在它左緣上（index.css 的 .lore-home-hero__card）；每次進館抽一張（loreHeroCast.ts）。
 * 一張約 200 KB，純裝飾（aria-hidden）。
 *
 * 沿革：機師廳最早是官網 KV＋「操控指揮 機師出列」招募標語圖（冷色 3D 寫實跟紙面館格格不入、主角是機甲、
 * 而且和下面一列「機師故事館」雙標題 → 真正的 <h1> 移進 hero）；2026-10-14 換成官網立繪群像（8 位抽 4 位），
 * 2026-10-18 比照機甲廳（PLAN-042-B F-2）換成招募插畫，兩館的 hero 從此同一套。
 */
function HallHero({ script, title, lead, card }: {
  /** 紅帶上的黃色手寫字 */
  script: string
  title: string
  lead: React.ReactNode
  /** 插畫路徑；池子是空的就只剩紅帶與標題 */
  card?: string
}) {
  return (
    <header className="lore-home-hero mb-6 sm:mb-8">
      <div className="lore-home-hero__band" aria-hidden="true" />
      <div className="lore-home-hero__cast" aria-hidden="true">
        {card && (
          <img
            className="lore-home-hero__card"
            src={assetUrl(card)}
            alt=""
            width={2600}
            height={1080}
            decoding="async"
            fetchPriority="high"
            // 載完才淡入（CSS 的 [data-loaded]）：圖要等 React 渲染後才開始抓，直接顯示會在紙面上「啪」一聲冒出來。
            // 用 data 屬性不用 className：React 不管這個屬性，重繪（骨架 → 內容）時不會被洗掉
            onLoad={(e) => { e.currentTarget.dataset.loaded = '' }}
          />
        )}
      </div>
      <div className="lore-home-hero__title">
        <span className="lore-script-font lore-home-hero__script" aria-hidden="true">{script}</span>
        <span className="lore-home-hero__eyebrow">ARCHIVE · 檔案館</span>
        <h1 className="lore-home-hero__h1">{title}</h1>
        <p className="lore-home-hero__lead">{lead}</p>
      </div>
    </header>
  )
}

function PilotHero({ count }: { count?: number }) {
  const [gameId] = useState(() => pickHeroCard(PILOT_HERO_POOL))
  return (
    <HallHero
      script="Pilots"
      title="機師故事館"
      lead={<>收錄機師的個人簡介與逸聞章節{count !== undefined && <><br />共 {count} 位機師</>}</>}
      card={gameId ? pilotCardArt({ gameId }) : undefined}
    />
  )
}

function MechHero({ count }: { count?: number }) {
  const [wap] = useState(() => pickHeroCard([...GAME_MECH_CARDS.keys()]))
  return (
    <HallHero
      script="Mecha"
      title="機甲故事館"
      lead={<>收錄機甲的技術檔案與逸聞章節{count !== undefined && <><br />共 {count} 台機甲</>}</>}
      card={wap ? mechCardArt({ gameId: wap }) : undefined}
    />
  )
}

// ─── 卡片 ────────────────────────────────────────────────────────────────────

/**
 * ⚠ `half.webp` **不是去背圖**，每張帶各自不同的原生背景色（實測有灰、綠、粉）。
 *   直接鋪成網格會花掉整面牆，所以每一格一律三件套：
 *     統一卡框 ＋ 底部漸層遮罩（壓住背景、讓名字讀得到）＋ 左側 3px 職業色條。
 *   ——與挑選器的頭像牆（`PilotAvatarCard`）同一套理由，色條也共用同一份查表。
 *
 * ⚠ 88 張縮圖必須 `loading="lazy"`：全載約 2.6MB。
 * ⚠ 名字壓在深色遮罩上，所以用固定的白字而不是 `text-text-primary`——
 *   館內的 token 已被覆寫成紙色墨字（#2b2621），套上去就是深底配深字。
 */
function PilotCard({ pilot, chapters, logo }: { pilot: Pilot; chapters: number; logo?: string }) {
  const tone = pilotClassMeta(pilot.class)?.text ?? ''

  return (
    <Link
      to={`/lore/pilots/${pilot.id}`}
      // 官網縮圖框的語彙（PLAN-042-C F-1）：黑底、hover 紅框 #b10000、微微上浮
      className="group relative block aspect-square overflow-hidden rounded-lg border-2 border-[#1a1614]/70 bg-[#0a0c10] no-underline transition-[border-color,transform] duration-200 hover:border-[#b10000] hover:-translate-y-0.5"
    >
      {/* 縮圖**本地優先**（PLAN-042-C F-1；PLAN-054 起本地官方原檔排第一），官方 CDN 只當退路：遠端 media.zlongame.com
          在台灣線路上首屏會空一陣子（實測 5 秒後仍有 43 張 pending），本地檔走 Cloudflare 邊緣快取。
          代價是與 /pilots（遠端優先）不共用同一組 URL、瀏覽器快取不互通——88 張約 2.6MB，可接受。
          ⚠ 賽拉沒有 portrait 也沒有 portraitUrl ⇒ 候選為空 ⇒ 直接落到 fallback，卡片照樣在牆上。 */}
      <FallbackImage
        candidates={pilotPortraitCandidates(pilot)}
        alt={pilot.name}
        loading="lazy"
        className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
        fallback={
          <span className="absolute inset-0 flex items-center justify-center text-[11px] text-text-dim">
            尚無立繪
          </span>
        }
      />
      <span
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,12,16,0.05)_38%,rgba(10,12,16,0.92))]"
      />
      <span aria-hidden className={`absolute left-0 top-0 h-full w-[3px] ${toneBar(tone)}`} />

      {/* 陣營徽章角標（PLAN-059 D-4）：左上角、與右上的章節徽章分開。縮圖是暗底：單色版吃白色，彩色版原樣 */}
      {logo && (
        <span className="absolute left-2 top-1.5 text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          <FactionLogo logoKey={logo} size={24} label={pilot.faction} />
        </span>
      )}

      {/* 章節徽章只在真的有（非草稿的）章節時出現。多數機師還沒有章節 ⇒ 沒有角標是正確現象。 */}
      {chapters > 0 && <ChapterBadge n={chapters} />}

      <span className="absolute bottom-1.5 left-2 right-2 flex flex-col text-left">
        <span className="truncate text-[13px] font-bold leading-tight text-white">{pilot.name}</span>
        <span className="flex items-center gap-1 truncate text-[11px] leading-tight text-white/65">
          {/* 職業圖示上職業色；縮圖是暗底，色在白字旁仍讀得出來 */}
          <ClassIcon pilotClass={pilot.class} size={12} decorative className={tone} />
          {pilot.class}
          {pilot.debutVersion && ` · v${pilot.debutVersion}`}
        </span>
      </span>
    </Link>
  )
}

/**
 * 機甲卡：與機師卡同一套卡框語彙（黑底、hover 紅框、底部漸層、左色條、左上徽章、右上章節數）。
 *
 * 縮圖是官方 `Icon_mecha_wap####`（560×340，去背、左緣已淡出）：卡片比例 28:17 剛好裝下、不裁切。
 * 93 張約 5 MB，一定要 lazy。左上是**廠商**徽章（機師卡是陣營），只在依登場版本排序時給——
 * 依廠商分組時組頭就是廠商。廠商讀不到就不放，不留空框。
 */
function MechCard({ mech, chapters, maker }: { mech: Mech; chapters: number; maker?: MechMaker }) {
  const wc = mechWeightClassOf(mech.armorType)

  return (
    <Link
      to={`/lore/mechs/${mech.id}`}
      className="group relative block aspect-[28/17] overflow-hidden rounded-lg border-2 border-[#1a1614]/70 bg-[#0a0c10] no-underline transition-[border-color,transform] duration-200 hover:border-[#b10000] hover:-translate-y-0.5"
    >
      <FallbackImage
        candidates={mechPortraitCandidates(mech)}
        alt={mech.name}
        loading="lazy"
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        fallback={
          <span className="absolute inset-0 flex items-center justify-center text-[11px] text-text-dim">
            尚無立繪
          </span>
        }
      />
      <span
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,12,16,0)_45%,rgba(10,12,16,0.9))]"
      />
      <span aria-hidden className={`absolute left-0 top-0 h-full w-[3px] ${wc?.bar ?? toneBar('')}`} />

      {maker?.logo && (
        <span className="absolute left-2 top-1.5 text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          <FactionLogo logoKey={maker.logo} size={22} label={maker.name || maker.id} />
        </span>
      )}

      {chapters > 0 && <ChapterBadge n={chapters} />}

      <span className="absolute bottom-1.5 left-2 right-2 flex flex-col text-left">
        <span className="truncate text-[13px] font-bold leading-tight text-white">{mech.name}</span>
        <span className="flex items-center gap-1 truncate text-[11px] leading-tight text-white/65">
          <MechTypeIcon type={mech.armorType} size={12} decorative className={wc?.text ?? ''} />
          {wc?.short ?? mech.armorType}
          {mech.debutVersion && ` · v${mech.debutVersion}`}
        </span>
      </span>
    </Link>
  )
}

function ChapterBadge({ n }: { n: number }) {
  return (
    <span className="absolute right-1.5 top-1.5 rounded bg-accent-orange px-1.5 py-0.5 text-[10px] font-bold text-bg-dark">
      {n} 章
    </span>
  )
}
