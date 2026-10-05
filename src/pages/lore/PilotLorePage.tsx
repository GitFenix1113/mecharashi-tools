import { useCallback, useRef } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import LoreArt from '../../components/lore/LoreArt'
import LoreChapterPager from '../../components/lore/LoreChapterPager'
import LoreChapterBody from '../../components/lore/LoreChapterBody'
import LoreSourceLine from '../../components/lore/LoreSourceLine'
import { useLoreParallax } from '../../components/lore/useLoreParallax'
import { splitParagraphs, isQuoteStyle, stripTrailingSource } from '../../components/lore/loreText'
import { CLASS_CONFIG, LicenseBadge } from '../../components/badges/PilotBadges'
import {
  hasPilotArt, pilotArtDir, pilotKeyArtPath, pilotFullArtPath, pilotOfficialArt,
  imageCandidates, assetUrl,
} from '../../utils/assets'
import { gameIconCandidates } from '../../utils/gameIcons'
import { FallbackImage } from '../../components/common/FallbackImage'
import { usePilot, usePilotLoreDoc } from '../../hooks/useFirestore'

/**
 * 機師故事館的扉頁與章節頁（PLAN-042-A / D-3）。
 *
 * `/lore/pilots/:id` 是扉頁，`/lore/pilots/:id/:part` 是章節頁 —— **同一個元件**。
 * 兩者共用同一份資料與同一套版面骨架，拆成兩個元件只會讓「立繪柱與扉頁排版」
 * 在兩邊各長一份、然後慢慢漂移。
 *
 * ── 三件事必須照著做，錯了都不會有錯誤訊息 ──────────────────────────────
 *
 * ① **守衛順序是 error → loading → 內容**（地雷 M-04）。
 *    `GameDataContext` 的 catch 只寫 errorMap、不把 key 加進 loadedKeys，
 *    而 `loading = !keys.every(k => loadedKeys.has(k))` ⇒ **抓取失敗時 loading 恆為 true**。
 *    把 `if (loading)` 排在前面，error 分支就永遠到不了，畫面只會一直轉圈。
 *
 * ② **不取 `usePilotLoreDoc` 的 loading**。`/api/data/pilotLore` 在部署完成前回 404，
 *    那是上線初期的**主路徑**不是邊界情況。章節讀不到時要優雅降級成「只有扉頁」
 *    （扉頁正文來自 `pilots.lore`，本來就不住 pilotLore），而不是轉圈或錯誤頁。
 *
 * ③ **立繪分流在渲染前決定**（`hasPilotArt`），不可等圖載失敗才換構圖 ——
 *    直式全身（863×1600）與橫式半身（1240×1080）的版面不同，
 *    等圖載完再換會讓整根立繪柱在那一刻跳動一次。
 *
 * ⚠ 館內唯一的 scrollport 是 `LoreLayout` 的 `.lore-scroll`，本頁**不得**開任何
 *   `overflow-y-auto`（地雷 M-08）：兩條垂直捲軸並存時外層永遠捲不動，
 *   而立繪柱與章節軸的 sticky 會相對錯誤的 scrollport，症狀是「有時黏有時不黏」。
 *
 * ⚠ 立繪柱高度吃 `.lore-portrait-col`（C-4a 提供）而不是 Tailwind 的 arbitrary calc：
 *   `h-[calc(100vh - var(--x))]` 只要有空格就會被切成三個 class，Tailwind 產不出
 *   任何東西**且不報錯**（地雷 M-27）。
 */

/** 立繪柱在手機上的高度上限。用 max-height 而不是 height —— `.lore-portrait-col`
 *  是無層級（unlayered）規則，特異性上贏過 Tailwind 的任何 `h-*`，改不動它的 height；
 *  max-height 是另一個屬性，夾得住。桌機用 `lg:max-h-none` 放開。 */
const PORTRAIT_MOBILE_CAP = 'max-h-[38vh] lg:max-h-none'

/**
 * 天賦徽記的圖片候選（PLAN-055：從圖示圖庫取，`icon`／`iconLocal` 任一個能解析就有圖）。
 *
 * ⚠ 地雷 M-16：有 3 位機師的 `icon`／`iconLocal` 都是**空字串**，空字串進 `<img src="">`
 *   在瀏覽器等同**重新載入當前頁面 URL**。`gameIconCandidates` 會先 trim、空值不產生候選，
 *   回空陣列時呼叫端**不渲染 <img>**。
 */
function talentIconCandidates(talent: { icon?: string; iconLocal?: string } | undefined): string[] {
  return talent ? gameIconCandidates(talent.icon, talent.iconLocal) : []
}

export default function PilotLorePage() {
  const { id, part } = useParams<{ id: string; part?: string }>()
  const navigate = useNavigate()
  const { data: pilot, loading, error } = usePilot(id)
  // ⚠ 刻意不解構 loading：見檔頭第 ② 條。
  const { data: lore } = usePilotLoreDoc(id)

  // 全部是 render 期純衍生值。**不得**用 useState + useEffect 同步網址與章節：
  // 那會多一幀「舊章節」，而且重整時第一幀永遠是第一章。
  const chapters = lore?.chapters ?? []
  const paramIndex = part ? chapters.findIndex((c) => c.key === part) : -1
  const activeIndex = paramIndex >= 0 ? paramIndex : 0
  const isChapterView = Boolean(part) && chapters.length > 0

  /**
   * 換章。扉頁→第一章用 push（回上一頁要能退回扉頁），章節之間用 replace
   * （否則讀完 8 章後按上一頁要按 8 次才離得開）。
   */
  const handleSelect = useCallback(
    (key: string) => {
      navigate(`/lore/pilots/${encodeURIComponent(id!)}/${encodeURIComponent(key)}`, {
        replace: Boolean(part),
      })
    },
    [navigate, id, part],
  )

  // 立繪柱的滑鼠微視差（PLAN-042-C F-6）：hook 只寫 CSS 變數，位移量在 index.css；
  // 桌機（pointer: fine）且非 reduced-motion 才掛。⚠ hook 要在下方的 early return 之前呼叫。
  const portraitRef = useRef<HTMLDivElement>(null)
  useLoreParallax(portraitRef, pilot?.id)

  // ① error → ② loading → ③ 查無（順序不可調換，見檔頭）
  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl px-4 py-3 text-sm text-accent-red">
          資料載入失敗：{error.message}
        </div>
        <Link to="/lore" className="mt-4 inline-block text-sm text-accent-orange no-underline">
          ← 回故事館
        </Link>
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

  if (!pilot) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center text-text-dim">
        <p>找不到機師資料</p>
        <Link to="/lore" className="text-accent-orange no-underline text-sm mt-4 inline-block">
          ← 回故事館
        </Link>
      </div>
    )
  }

  // ⚠ 渲染前分流（見檔頭第 ③ 條）。路徑一律由 `portrait` 推導，
  //   **不可**拿顯示名去組資料夾名（地雷 M-15：素材端與站上有簡繁／譯名差異）。
  // 立繪來源優先序（PLAN-042-C C-2）：官網 hero 圖層（8 位，含手繪線稿與名字書法層）→ 原稿全身 art.webp
  // → 半身 full.webp。三者構圖不同，一樣在渲染前分流。
  const official = pilotOfficialArt(pilot)
  const tall = hasPilotArt(pilot)
  const artCandidates = official
    ? imageCandidates(official.color)
    : imageCandidates(tall ? pilotKeyArtPath(pilot) : pilotFullArtPath(pilot))

  const classText = CLASS_CONFIG[pilot.class]?.split(' ')[0] ?? 'text-text-secondary'
  const talentIcons = talentIconCandidates(pilot.talents[0])
  const talentName = pilot.talents[0]?.name ?? ''

  // E-1 檔案感小字：流水號取自文件 id（pilot_003_洛莎 → 003）；紅標用身高（官網名字層上那顆是
  // 166cm/45kg），沒有身高就用駕駛許可。官網 8 位的紅標已烘在官方名字層裡，不再疊一顆。
  const serial = pilot.id.match(/^pilot_(\d+)/)?.[1] ?? '—'
  const fileTag = pilot.profile.height?.trim() || pilot.license

  // 扉頁正文住 `pilots.lore`（不是 pilotLore）；署名若還黏在正文尾端就切掉，
  // 改由 <LoreSourceLine> 單獨排版。**不可用 endsWith 比對**（地雷 M-17）。
  const frontParagraphs = splitParagraphs(stripTrailingSource(pilot.lore, lore?.frontSource))
  // profile / additionalInfo 都是**必填**欄位，判的是長度不是 undefined。
  // 鍵名是完全自由的中文字串（94 種、含 ▇▇／■■），只可當顯示文字與 React key。
  const info = Object.entries(pilot.profile.additionalInfo)

  /** 立繪柱。扉頁與章節頁共用同一棵子樹，換路由時 LoreArt 不會重播顯影。 */
  const portrait = (
    // ⚠ 不要再加 `relative`：`position: sticky` 本身就替 absolute 子孫建立定位脈絡，
    //   兩個 position 工具類同時掛在一個元素上，誰贏取決於 Tailwind 產出的順序。
    <div ref={portraitRef} className={`lore-portrait-col lore-parallax ${PORTRAIT_MOBILE_CAP} sticky top-0 self-start`}>
      {artCandidates.length > 0 ? (
        <LoreArt
          variant={official ? 'official' : tall ? 'tall' : 'wide'}
          candidates={artCandidates}
          sketchSrc={official ? assetUrl(official.line) : undefined}
          artKey={pilotArtDir(pilot)}
          revealDurationMs={1050}
          // 底緣溶解（F-5）：wide 是既有的 22% 噪點 mask，tall 由 CSS 覆寫成只溶最後 10%；
          // 官方變體的下緣本來就是出血裁切，不遮
          bottomMask={!official}
          alt={pilot.name}
          className="w-full h-full"
        />
      ) : (
        // 賽拉：portrait 是空字串、沒有圖片資料夾。照專案「未建檔不留白」慣例給佔位，
        // 不是把她整個藏起來。
        <div className="w-full h-full flex items-center justify-center rounded-xl border border-border-subtle bg-bg-card text-xs text-text-dim">
          立繪未建檔
        </div>
      )}

      {/* 直書姓名壓在立繪右緣。pointer-events-none：它蓋在圖上，不該吃掉任何點擊。
          ⚠ `flex-col` 在 vertical-rl 下走的是 block 軸（水平、由右往左），
             兩段字因此並排成兩行直書；寫成 `flex`（row，走 inline 軸）會變成上下接續。 */}
      {/* 名字層與草書包在自己的 wrapper 裡做反向微視差（F-6）：動畫元素本身的 transform 被 fill-mode both 佔住 */}
      <div className="lore-parallax-name absolute inset-0 pointer-events-none">
      {/* 名字層照官網 mechaData 節奏進場（scale 1.3→1 淡入、延遲 200ms）；key 讓換人時重播。
          官網 8 位用官方名字層（英文毛筆草書＋直書中文名＋紅標烘在同一張透明 PNG），
          其餘機師用直書文字。 */}
      {official ? (
        <img
          key={pilot.id}
          className="lore-enter lore-enter--pop lore-enter--2 absolute right-[4px] top-[10px] pointer-events-none w-[62%] max-w-[380px] h-auto"
          src={assetUrl(official.name)}
          alt={pilot.fullName && pilot.fullName !== pilot.name ? `${pilot.name}（${pilot.fullName}）` : pilot.name}
          width={official.geometry.nameW}
          height={official.geometry.nameH}
        />
      ) : (
        <div
          key={pilot.id}
          className="lore-enter lore-enter--pop lore-enter--2 absolute right-[8px] top-[16px] pointer-events-none [writing-mode:vertical-rl] flex flex-col gap-[6px]"
        >
          {/* 楷書子集（D-2）：字重 400 是字型只有 Regular，加粗會變成合成粗體 */}
          <span className="lore-name-font text-[26px] tracking-[0.2em] text-text-primary">{pilot.name}</span>
          {pilot.fullName && pilot.fullName !== pilot.name && (
            <span className="lore-name-font text-[13px] tracking-[0.15em] text-text-secondary">{pilot.fullName}</span>
          )}
        </div>
      )}

      {/* 英文毛筆草書（D-3）：照官網名字層的擺法——白字、逆時針約 72°、從右上往左下劃過立繪。
          只有非官方變體且有 nameEn 的機師才渲染（官方名字層已含草書）。
          字級依名字長度縮：官網對長名（Yevgeny Ivanovic Goman）也是縮小處理。 */}
      {!official && pilot.nameEn && (
        <span
          key={`${pilot.id}-en`}
          aria-hidden="true"
          className="lore-script-font lore-enter lore-enter--pop lore-enter--2 absolute right-[6%] top-[14%] pointer-events-none select-none whitespace-nowrap leading-none text-white/80 origin-top-right -rotate-[72deg]"
          style={{ fontSize: `clamp(56px, ${Math.min(11, 96 / Math.max(6, pilot.nameEn.length)).toFixed(2)}vw, 120px)` }}
        >
          {pilot.nameEn}
        </span>
      )}
      </div>

      {/* E-1 檔案感小字（桌機）：編號／登場版本，JetBrains Mono 小字＋細線，官網資料層的「566043-078」語彙 */}
      <div className="lore-enter lore-enter--3 absolute left-[8px] bottom-[10px] hidden lg:flex flex-col gap-[3px] pointer-events-none font-[JetBrains_Mono,monospace] text-[10px] tracking-[0.18em] text-text-dim">
        <span>PILOT FILE · NO.{serial}</span>
        {pilot.debutVersion && <span>DEBUT · v{pilot.debutVersion}</span>}
        <span aria-hidden="true" className="mt-1 h-px w-12 bg-border-accent" />
      </div>
      {!official && fileTag && (
        <span className="lore-enter lore-enter--3 lore-file-tag absolute right-[10px] top-[150px] hidden lg:inline-block px-[6px] py-[2px] text-[10px] font-bold tracking-[0.12em] pointer-events-none">
          {fileTag}
        </span>
      )}
    </div>
  )

  return (
    <div className="max-w-6xl mx-auto px-4 pb-16 lg:grid lg:grid-cols-[42fr_58fr] lg:gap-8 lg:px-6">
      {portrait}

      {/*
        手機：正文在立繪下方、帶半透明紙色底並拉高一層，捲動時像一張紙推過立繪。
        桌機：它是 grid 的第二欄，與立繪不重疊，**底色透明**——館的背景是整張紙紋圖
        （PLAN-042-C B-2），這一欄若塗不透明底會在紋理上壓出一塊平面矩形。
        ⚠ 這裡**不得**加 overflow（地雷 M-08），也不得加 @container
        （隱含 contain:layout 會讓 RefChip 的 fixed 浮層改對齊本容器而錯位）。
      */}
      <div className="relative z-10 bg-bg-dark/90 lg:bg-transparent pt-6 lg:pt-10">
        {isChapterView ? (
          <>
            <Link
              to={`/lore/pilots/${encodeURIComponent(id!)}`}
              className="inline-block mb-4 text-xs text-text-secondary no-underline hover:text-text-primary"
            >
              {`‹ ${pilot.name} · 扉頁`}
            </Link>

            {/* ⚠ LoreChapterBody 只吃具名 props，**不得** {...chapters[activeIndex]}：
                React 19 會把 spread 進來的 `key` 摘走當元素 key，元件內部拿不到，
                而且展開的物件沒有 index ⇒ eyebrow 的 `PART N` fallback 做不出來。 */}
            <LoreChapterPager
              chapters={chapters}
              activeKey={chapters[activeIndex].key}
              onSelect={handleSelect}
            >
              {/* key＝章節 key：換章重掛，正文才會播 180ms 的進場（F-2） */}
              <LoreChapterBody key={chapters[activeIndex].key} chapter={chapters[activeIndex]} index={activeIndex} className="pt-6" />
            </LoreChapterPager>
          </>
        ) : (
          // key 讓換人時右欄整塊重掛，三段進場動畫（A-4）才會重播
          <article key={pilot.id}>
            {/* 第二段（200ms）：職業／名字／徽記 */}
            <div className="lore-enter lore-enter--2">
            <p className={`text-xs font-semibold tracking-widest ${classText}`}>{pilot.class}</p>
            <h1 className="lore-name-font mt-1 text-3xl text-text-primary sm:text-4xl">{pilot.name}</h1>

            {/* 三枚徽記：陣營（文字刻在圓環內）／天賦／駕駛許可。
                陣營刻意不畫圖示：30 個值、18 個只有 1 人，畫圖是會增生的美術債。
                圓環直徑用 px（展示型尺寸），正文才用 rem。 */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span className="w-[68px] h-[68px] shrink-0 rounded-full border border-border-accent flex items-center justify-center px-[6px] text-center text-[11px] leading-tight text-text-secondary">
                {pilot.faction}
              </span>

              <span className="w-[68px] h-[68px] shrink-0 rounded-full border border-border-accent bg-bg-card flex items-center justify-center overflow-hidden">
                {talentIcons.length ? (
                  <FallbackImage
                    candidates={talentIcons}
                    alt={talentName}
                    className="w-[52px] h-[52px] rounded-full object-cover"
                    fallback={
                      <span className="px-[4px] text-center text-[11px] leading-tight text-text-dim">{talentName || '—'}</span>
                    }
                  />
                ) : (
                  // 兩者都是空字串的 3 位機師走這條。**不渲染 <img>**，
                  // 空 src 會讓瀏覽器重新請求本頁 URL（地雷 M-16）。
                  <span className="px-[4px] text-center text-[11px] leading-tight text-text-dim">
                    {talentName || '—'}
                  </span>
                )}
              </span>

              <LicenseBadge license={pilot.license} />
            </div>
            </div>

            {/* 第三段（350ms）：引文卡、鍵值列、章節入口 */}
            <div className="lore-enter lore-enter--3">
            {/* 引文卡。逐段 <p> 自備換行，不依賴 whitespace-pre-line —— 引文段要換成
                blockquote，整包 pre-line 會讓兩種排版無法混用。
                字級用 rem 類別（text-base / text-lg），館內 header 的字級三顆按鈕才吃得到。 */}
            {frontParagraphs.length > 0 && (
              <div className="mt-8 rounded-xl border border-border-subtle bg-bg-card px-5 py-6 sm:px-7">
                <div className="space-y-4 text-base leading-loose text-text-primary sm:text-lg">
                  {frontParagraphs.map((p, i) =>
                    isQuoteStyle(p) ? (
                      <blockquote
                        key={i}
                        className="border-l-2 border-border-accent pl-4 tracking-wide text-text-secondary"
                      >
                        {p}
                      </blockquote>
                    ) : (
                      <p key={i}>{p}</p>
                    ),
                  )}
                </div>
                <LoreSourceLine source={lore?.frontSource} />
              </div>
            )}

            {info.length > 0 && (
              <dl className="mt-8 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {info.map(([k, v]) => (
                  <div key={k} className="flex gap-3 border-b border-border-subtle py-1.5 text-sm">
                    <dt className="shrink-0 text-text-dim">{k}</dt>
                    <dd className="min-w-0 text-text-secondary">{v}</dd>
                  </div>
                ))}
              </dl>
            )}

            {/* 章節入口。pilotLore 讀不到（或這位機師還沒有章節）時整塊不出現 ——
                這是上線初期的常態，不是錯誤狀態，不要在這裡放「載入失敗」。
                標籤 fallback 與章節軸／eyebrow 三處一致（契約 §2.8）。 */}
            {chapters.length > 0 && (
              <button
                type="button"
                onClick={() => handleSelect(chapters[0].key)}
                className="mt-8 w-full text-left px-4 py-3 rounded-lg border border-border/60
                           text-text-secondary transition-colors cursor-pointer
                           hover:text-text-primary hover:border-border-accent hover:bg-bg-card"
              >
                <span className="block text-xs text-text-dim">共 {chapters.length} 章</span>
                <span className="block mt-0.5 text-sm">
                  {`閱讀 ${chapters[0].label ?? 'PART 1'} ▸`}
                </span>
              </button>
            )}
            </div>
          </article>
        )}
      </div>
    </div>
  )
}
