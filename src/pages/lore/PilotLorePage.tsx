import { useCallback } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import LoreArt from '../../components/lore/LoreArt'
import LoreChapterPager from '../../components/lore/LoreChapterPager'
import LoreChapterBody from '../../components/lore/LoreChapterBody'
import LoreSourceLine from '../../components/lore/LoreSourceLine'
import { splitParagraphs, isQuoteStyle, stripTrailingSource } from '../../components/lore/loreText'
import { CLASS_CONFIG, LicenseBadge } from '../../components/badges/PilotBadges'
import {
  hasPilotArt, pilotArtDir, pilotKeyArtPath, pilotFullArtPath, imageCandidates, resolveIconSrc,
} from '../../utils/assets'
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
 * 天賦徽記的圖片來源。
 *
 * ⚠ **一律 `?.trim() || … || null`，不可用 `??` 或 `!== undefined`**（地雷 M-16）：
 *   `icon` / `iconLocal` 的型別是必填 `string`，但有 3 位機師兩者都是**空字串**，
 *   `??` 不會觸發 fallback、tsc 也不會抱怨，而空字串進 `<img src="">`
 *   在瀏覽器等同**重新載入當前頁面 URL**（Network 面板會看到對本頁的重複請求）。
 */
function talentIconSrc(talent: { icon?: string; iconLocal?: string } | undefined): string | null {
  if (!talent) return null
  return talent.iconLocal?.trim() || talent.icon?.trim() || null
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
  const tall = hasPilotArt(pilot)
  const artCandidates = imageCandidates(tall ? pilotKeyArtPath(pilot) : pilotFullArtPath(pilot))

  const classText = CLASS_CONFIG[pilot.class]?.split(' ')[0] ?? 'text-text-secondary'
  const talentIcon = talentIconSrc(pilot.talents[0])
  const talentName = pilot.talents[0]?.name ?? ''

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
    <div className={`lore-portrait-col ${PORTRAIT_MOBILE_CAP} sticky top-0 self-start`}>
      {artCandidates.length > 0 ? (
        <LoreArt
          variant={tall ? 'tall' : 'wide'}
          candidates={artCandidates}
          artKey={pilotArtDir(pilot)}
          revealDelayMs={450}
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
      <div className="absolute right-[8px] top-[16px] pointer-events-none [writing-mode:vertical-rl] flex flex-col gap-[6px]">
        <span className="text-[22px] font-bold tracking-[0.2em] text-text-primary">{pilot.name}</span>
        {pilot.fullName && pilot.fullName !== pilot.name && (
          <span className="text-[12px] tracking-[0.15em] text-text-secondary">{pilot.fullName}</span>
        )}
      </div>
    </div>
  )

  return (
    <div className="max-w-6xl mx-auto px-4 pb-16 lg:grid lg:grid-cols-[42fr_58fr] lg:gap-8 lg:px-6">
      {portrait}

      {/*
        手機：正文在立繪下方、帶紙色底並拉高一層，捲動時像一張紙推過立繪。
        桌機：它是 grid 的第二欄，與立繪不重疊，底色同色不影響。
        ⚠ 這裡**不得**加 overflow（地雷 M-08），也不得加 @container
        （隱含 contain:layout 會讓 RefChip 的 fixed 浮層改對齊本容器而錯位）。
      */}
      <div className="relative z-10 bg-bg-dark pt-6 lg:pt-10">
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
              <LoreChapterBody chapter={chapters[activeIndex]} index={activeIndex} className="pt-6" />
            </LoreChapterPager>
          </>
        ) : (
          <article>
            <p className={`text-xs font-semibold tracking-widest ${classText}`}>{pilot.class}</p>
            <h1 className="mt-1 text-2xl font-bold text-text-primary sm:text-3xl">{pilot.name}</h1>

            {/* 三枚徽記：陣營（文字刻在圓環內）／天賦／駕駛許可。
                陣營刻意不畫圖示：30 個值、18 個只有 1 人，畫圖是會增生的美術債。
                圓環直徑用 px（展示型尺寸），正文才用 rem。 */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span className="w-[68px] h-[68px] shrink-0 rounded-full border border-border-accent flex items-center justify-center px-[6px] text-center text-[11px] leading-tight text-text-secondary">
                {pilot.faction}
              </span>

              <span className="w-[68px] h-[68px] shrink-0 rounded-full border border-border-accent bg-bg-card flex items-center justify-center overflow-hidden">
                {talentIcon ? (
                  <img
                    src={resolveIconSrc(talentIcon)}
                    alt={talentName}
                    className="w-[52px] h-[52px] rounded-full object-cover"
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
          </article>
        )}
      </div>
    </div>
  )
}
