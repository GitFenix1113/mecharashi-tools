import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FallbackImage } from '../../components/common/FallbackImage'
import { pilotClassMeta } from '../../data/pilotClasses'
import { ClassIcon } from '../../components/icons/ClassIcon'
import { FactionLogo } from '../../components/icons/FactionLogo'
import { normalizeFactionLogos } from '../../utils/factionLogos'
import { toneBar } from '../../components/loadout/PickerVariants'
import { usePilotLore, usePilots } from '../../hooks/useFirestore'
import { assetUrl, pilotPortraitCandidates } from '../../utils/assets'
import type { Pilot } from '../../types'
import { buildLoreGroups, readLoreSort, writeLoreSort, type LoreSort } from '../../components/lore/loreRoster'
import { publishedChapters } from '../../components/lore/loreText'

/**
 * 機師故事館的館首頁（PLAN-042-A D-2）。
 *
 * ── 為什麼列 `pilots` 而不是 `pilotLore`（決策 D）──
 * 牆是「名冊」：名字、職業、版本、立繪都是 pilots 的身分欄位，pilotLore 只拿來疊章節數與陣營徽章。
 * 讀不到 pilotLore 時牆照樣完整（只少了角標）；改列 pilotLore 則等於把牆的完整性綁在故事資料上。
 * PLAN-042-E 搬遷時每位機師都建了一份 pilotLore（簡介、個人資料），所以點進去不會是空頁。
 *
 * ⚠ **89 張卡片、88 張縮圖是正確現象。** `public/images/pilots/` 只有 88 個資料夾——
 *   賽拉的 `portrait` 是空字串、沒有圖片資料夾。她要照樣出現在牆上、縮圖走
 *   `FallbackImage` 的佔位（比照全站「未建檔不留白」慣例）。
 *   **不要加過濾把她藏起來**，那才是真的 bug。
 */
export default function LoreHomePage() {
  const { data: pilots, loading, error } = usePilots()
  // ⚠ 刻意不取 usePilotLore 的 loading：ensureLoaded 的 catch 只寫 errorMap、不把 key 加進
  //   loadedKeys ⇒ 抓取失敗時它的 loading 永遠是 true，gate 在它身上會讓整面牆永遠轉圈。
  //   章節徽章消失是可接受的降級，牆不見不是。
  const { data: loreDocs, error: loreError } = usePilotLore()

  const [tab, setTab] = useState<LoreTab>('pilots')
  // 排序是「名冊順序」（PLAN-042-D A-2）：詳情頁的切換列、名冊、‹ › 都照這個走，所以記在 sessionStorage
  const [sort, setSortState] = useState<LoreSort>(readLoreSort)
  const setSort = (s: LoreSort) => { setSortState(s); writeLoreSort(s) }

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

  // ── 守衛順序一律 error → loading → 內容（地雷 M-04）──
  // 反過來寫的話，抓取失敗時 loading 恆為 true，`if (loading)` 先命中 ⇒ 永遠看不到錯誤分支：
  // 畫面一直轉圈、沒有紅字、沒有 console error。
  if (error) {
    return (
      <PageFrame>
        <div className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-sm text-accent-red">
          資料載入失敗：{error.message}
        </div>
      </PageFrame>
    )
  }

  if (loading) {
    return (
      <PageFrame>
        <div className={GRID}>
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-lg border border-border bg-bg-card" />
          ))}
        </div>
      </PageFrame>
    )
  }

  return (
    <PageFrame count={pilots.length}>
      {/* ── 分頁：機師｜機甲 ──
          機甲館（042-B）接上時只換這一頁的內容，不動本檔以外的任何檔案。 */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button type="button" className={tabBtn(tab === 'pilots')} onClick={() => setTab('pilots')}>
          機師
        </button>
        <button type="button" className={`${tabBtn(false)} cursor-not-allowed opacity-50`} disabled>
          機甲 · 籌備中
        </button>

        {tab === 'pilots' && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-text-dim">排序</span>
            {/* ⚠ 用 <button> 不用 <select>：紙色館內的 option 是由系統繪製的，
                色票覆寫不到（index.css 另有一條防禦式覆寫兜底，但不該依賴它）。 */}
            <button type="button" className={sortBtn(sort === 'class')} onClick={() => setSort('class')}>
              依職業
            </button>
            <button type="button" className={sortBtn(sort === 'debut')} onClick={() => setSort('debut')}>
              依登場版本
            </button>
          </div>
        )}
      </div>

      {/* loreError 不是致命：只讓章節徽章與陣營角標消失，牆照常渲染。 */}
      {loreError && (
        <p className="mb-4 text-xs text-text-dim">章節索引暫時讀不到，卡片上的章節數先不顯示。</p>
      )}

      {groups.map((g) => (
        <section key={g.key} className="mb-8 last:mb-0">
          <h2 className="mb-3 flex items-center gap-2">
            <span aria-hidden className={`h-4 w-[3px] ${toneBar(g.tone)}`} />
            {/* 依職業分組時標題前放職業圖示（PLAN-059 C-4）；依版本分組時 key 不是職業，ClassIcon 什麼都不畫 */}
            <span className={`inline-flex items-center gap-1.5 text-sm font-bold ${g.tone || 'text-text-secondary'}`}>
              <ClassIcon pilotClass={g.key} size={16} decorative />
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

// ─── 型別與常數 ──────────────────────────────────────────────────────────────

type LoreTab = 'pilots' | 'mechs'

interface LoreGroup {
  key: string
  label: string
  /** 區塊標題與色條共用的 `text-*` 類名；查無職業時是空字串 */
  tone: string
  items: Pilot[]
}

const GRID = 'grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7'

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
 * ⚠ 本頁不得開任何 `overflow-y-auto`：全館唯一的 scrollport 是 `LoreLayout` 的
 *   `.lore-scroll`，多開一層會讓兩條捲軸並存、館內的 sticky 相對錯誤的祖先定位。
 */
function PageFrame({ count, children }: { count?: number; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-8">
        {/* 官網素材切版（PLAN-042-C B-2／B-3／B-5）：左紅帶＋主視覺 KV＋「Pilots／操控指揮 機師出列」標題圖。
            三塊都是 CSS 背景或 <img>，樣式在 index.css 的 .lore-home-hero；標題圖有 alt，KV 是純裝飾。 */}
        <div className="lore-home-hero">
          <div className="lore-home-hero__kv" aria-hidden="true" />
          <div className="lore-home-hero__band" aria-hidden="true" />
          <div className="lore-home-hero__fade" aria-hidden="true" />
          <picture>
            <source media="(max-width: 1023px)" srcSet={assetUrl('/images/lore/title-pilots-m.webp')} />
            <img
              className="lore-home-hero__title"
              src={assetUrl('/images/lore/title-pilots.webp')}
              alt="Pilots — 操控指揮 機師出列 · ULTIMATE PILOTS"
              width={919}
              height={547}
            />
          </picture>
        </div>
        <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-[Orbitron,sans-serif] text-xs uppercase tracking-[3px] text-accent-orange">
            Archive
          </span>
          <h1 className="text-2xl font-bold sm:text-3xl">機師故事館</h1>
          <p className="text-sm leading-relaxed text-text-secondary">
            收錄機師的個人簡介與逸聞章節。
            {count !== undefined && `共 ${count} 位機師。`}
          </p>
        </div>
      </header>
      {children}
    </div>
  )
}

const tabBtn = (active: boolean) =>
  `rounded-lg border px-3.5 py-1.5 text-sm font-bold transition-colors ${
    active
      ? 'border-accent-orange/40 bg-accent-orange/15 text-accent-orange'
      : 'border-border bg-bg-card text-text-secondary hover:border-border-accent hover:text-text-primary cursor-pointer'
  }`

const sortBtn = (active: boolean) =>
  `rounded-lg border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
    active
      ? 'border-accent-orange/40 bg-accent-orange/15 text-accent-orange'
      : 'border-border bg-bg-card text-text-secondary hover:border-border-accent hover:text-text-primary'
  }`

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
      {chapters > 0 && (
        <span className="absolute right-1.5 top-1.5 rounded bg-accent-orange px-1.5 py-0.5 text-[10px] font-bold text-bg-dark">
          {chapters} 章
        </span>
      )}

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
