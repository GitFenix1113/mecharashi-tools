import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FallbackImage } from '../../components/common/FallbackImage'
import { CLASS_CONFIG } from '../../components/badges/PilotBadges'
import { toneBar } from '../../components/loadout/PickerVariants'
import { usePilotLore, usePilots } from '../../hooks/useFirestore'
import { assetUrl, imageCandidates } from '../../utils/assets'
import type { Pilot } from '../../types'

/**
 * 機師故事館的館首頁（PLAN-042-A D-2）。
 *
 * ── 為什麼列 `pilots` 而不是 `pilotLore`（決策 D）──
 * `pilotLore` 只承載「編輯得動的展示文本」（章節、旁白、扉頁署名），而扉頁正文住在
 * `pilots.lore`。改列 `pilotLore` 等於把牆縮成「已經有人手動建過檔的那幾位」——
 * 現階段是 34 份 `chapters: []` 的空殼，其中 0 位有章節，牆上會少掉 55 位有扉頁可讀的機師。
 * 故本頁一律列滿 89 位，未建檔者點進去看到的是扉頁（那本來就是官方簡介，不是空白頁）。
 *
 * ⚠ **89 張卡片、88 張縮圖是正確現象。** `public/images/pilots/` 只有 88 個資料夾——
 *   賽拉的 `portrait` 是空字串、沒有圖片資料夾。她要照樣出現在牆上、縮圖走
 *   `FallbackImage` 的佔位（比照全站「未建檔不留白」慣例）。
 *   **不要加過濾把她藏起來**，那才是真的 bug。
 */
export default function LoreHomePage() {
  const { data: pilots, loading, error } = usePilots()
  // ⚠ 刻意不取 usePilotLore 的 loading：ensureLoaded 的 catch 只寫 errorMap、不把 key 加進
  //   loadedKeys ⇒ 抓取失敗時它的 loading 永遠是 true。`/api/data/pilotLore` 在部署前就是 404，
  //   gate 在它身上會讓整面牆永遠轉圈。章節徽章消失是可接受的降級，牆不見不是。
  const { data: loreDocs, error: loreError } = usePilotLore()

  const [tab, setTab] = useState<LoreTab>('pilots')
  const [sort, setSort] = useState<LoreSort>('class')

  // ⚠ 泛型要自己標：`Object.fromEntries` 對 `(string | number)[]` 這種非 tuple 的 entry
  //   會落到回傳 any 的那條多載，不標就是把 any 一路傳進 <PilotCard>。
  //   `chapters?.` 的問號是防禦 Worker 回來的舊文件缺欄位（型別上它是必填）。
  const chapterCount = useMemo<Record<string, number>>(
    () => Object.fromEntries(loreDocs.map((d) => [d.id, d.chapters?.length ?? 0])),
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

      {/* loreError 不是致命：只讓章節徽章消失，牆照常渲染（部署前的主路徑就是這條）。 */}
      {loreError && (
        <p className="mb-4 text-xs text-text-dim">章節索引暫時讀不到，卡片上的章節數先不顯示。</p>
      )}

      {groups.map((g) => (
        <section key={g.key} className="mb-8 last:mb-0">
          <h2 className="mb-3 flex items-center gap-2">
            <span aria-hidden className={`h-4 w-[3px] ${toneBar(g.tone)}`} />
            <span className={`text-sm font-bold ${g.tone || 'text-text-secondary'}`}>{g.label}</span>
            <span className="text-xs text-text-dim">{g.items.length}</span>
          </h2>

          <div className={GRID}>
            {g.items.map((p) => (
              <PilotCard key={p.id} pilot={p} chapters={chapterCount[p.id] ?? 0} />
            ))}
          </div>
        </section>
      ))}
    </PageFrame>
  )
}

// ─── 型別與常數 ──────────────────────────────────────────────────────────────

/** 分組維度。`faction` 刻意不列入選項：89 人散在 30 個值、18 個只有 1 人，
 *  還含未正規化的重複與複合值，分出來的牆會是一堆單人區塊。`class` 是均勻的 7 類。 */
type LoreSort = 'class' | 'debut'
type LoreTab = 'pilots' | 'mechs'

interface LoreGroup {
  key: string
  label: string
  /** 區塊標題與色條共用的 `text-*` 類名；查無職業時是空字串 */
  tone: string
  items: Pilot[]
}

const GRID = 'grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7'

const CLASS_ORDER = Object.keys(CLASS_CONFIG)
const UNCLASSIFIED = '其他'
const UNVERSIONED = '未標註版本'

// ─── 分組與排序 ──────────────────────────────────────────────────────────────

/** `debutVersion` 轉可比較的數字；未填 → null（一律排最後，不當成 0）。 */
function versionValue(v: string | undefined): number | null {
  if (!v) return null
  const n = parseFloat(v)
  return Number.isNaN(n) ? null : n
}

/** 同一區塊內的次序：新版本在前，未標註版本殿後，最後以 id 穩定收尾。 */
function byDebutDesc(a: Pilot, b: Pilot): number {
  const va = versionValue(a.debutVersion)
  const vb = versionValue(b.debutVersion)
  if (va === null && vb === null) return a.id.localeCompare(b.id)
  if (va === null) return 1
  if (vb === null) return -1
  if (va !== vb) return vb - va
  return a.id.localeCompare(b.id)
}

function buildGroups(pilots: Pilot[], sort: LoreSort): LoreGroup[] {
  const buckets = new Map<string, Pilot[]>()
  for (const p of pilots) {
    const key = sort === 'class'
      ? (CLASS_CONFIG[p.class] ? p.class : UNCLASSIFIED)
      : (p.debutVersion || UNVERSIONED)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(p)
    else buckets.set(key, [p])
  }

  const keys = sort === 'class'
    // 職業依 CLASS_CONFIG 的宣告順序（＝全站徽章的順序），未知職業殿後
    ? [...CLASS_ORDER, UNCLASSIFIED].filter((k) => buckets.has(k))
    // 版本依數值遞減，未標註版本殿後
    : [...buckets.keys()].sort((a, b) => {
        if (a === UNVERSIONED) return 1
        if (b === UNVERSIONED) return -1
        return (versionValue(b) ?? 0) - (versionValue(a) ?? 0)
      })

  return keys.map((key) => {
    const items = [...(buckets.get(key) ?? [])].sort(byDebutDesc)
    return {
      key,
      label: sort === 'class' ? key : (key === UNVERSIONED ? key : `v${key}`),
      // ⚠ CLASS_CONFIG 的值是「文字色 底色 框線」三件一組，不 split 會把底色與框線一起套上
      tone: sort === 'class' ? (CLASS_CONFIG[key]?.split(' ')[0] ?? '') : '',
      items,
    }
  })
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
function PilotCard({ pilot, chapters }: { pilot: Pilot; chapters: number }) {
  const tone = CLASS_CONFIG[pilot.class]?.split(' ')[0] ?? ''

  return (
    <Link
      to={`/lore/pilots/${pilot.id}`}
      // 官網縮圖框的語彙（PLAN-042-C F-1）：黑底、hover 紅框 #b10000、微微上浮
      className="group relative block aspect-square overflow-hidden rounded-lg border-2 border-[#1a1614]/70 bg-[#0a0c10] no-underline transition-[border-color,transform] duration-200 hover:border-[#b10000] hover:-translate-y-0.5"
    >
      {/* 縮圖**本地 half.webp 優先**（PLAN-042-C F-1），官方 CDN 只當退路：遠端 media.zlongame.com
          在台灣線路上首屏會空一陣子（實測 5 秒後仍有 43 張 pending），本地檔走 Cloudflare 邊緣快取。
          代價是與 /pilots（遠端優先）不共用同一組 URL、瀏覽器快取不互通——88 張約 2.6MB，可接受。
          ⚠ 賽拉沒有 portrait 也沒有 portraitUrl ⇒ 候選為空 ⇒ 直接落到 fallback，卡片照樣在牆上。 */}
      <FallbackImage
        candidates={imageCandidates(pilot.portrait, pilot.portraitUrl)}
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

      {/* 章節徽章只在真的有章節時出現。目前 pilotLore 全是空殼 ⇒ 一個都不會出現，這是正確現象。 */}
      {chapters > 0 && (
        <span className="absolute right-1.5 top-1.5 rounded bg-accent-orange px-1.5 py-0.5 text-[10px] font-bold text-bg-dark">
          {chapters} 章
        </span>
      )}

      <span className="absolute bottom-1.5 left-2 right-2 flex flex-col text-left">
        <span className="truncate text-[13px] font-bold leading-tight text-white">{pilot.name}</span>
        <span className="truncate text-[11px] leading-tight text-white/65">
          {pilot.class}
          {pilot.debutVersion && ` · v${pilot.debutVersion}`}
        </span>
      </span>
    </Link>
  )
}
