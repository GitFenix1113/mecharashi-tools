// ── 社群連結預覽 Tier 2（PLAN-038 Phase B）────────────────────────────────────
//
// index.html 的靜態 og:*（Tier 1）已經讓每個頁面都有一張站名卡；本模組讓
// 機師／機甲／武器詳情頁**分享時顯示該實體自己的名稱與立繪**。
//
// 為什麼要在邊緣做：Discord／LINE 的預覽爬蟲不執行 JS，React 掛載後才寫進 DOM 的
// 標題對它們不存在。唯一能讓爬蟲看到實體資料的位置，就是回應離開 CDN 之前。
//
// 三條鐵律（本檔所有分支都必須守住）：
//   ① **非爬蟲一律不進來**。真人訪客的 HTML 必須逐位元組原樣通過，SPA 才掛得上去。
//   ② **任何失敗都退回原始 HTML**，不是錯誤頁。最壞情況是「分享卡片退回站名卡」，
//      也就是 Tier 1 的狀態；絕不能因為預覽卡片而讓頁面本身壞掉。
//   ③ **圖片一律絕對網址**。爬蟲讀不到 /images/... 這種相對路徑（PLAN-038 Pitfalls）。

/** 有詳情頁、因此值得做逐頁卡片的三個集合（計畫書決策五）。 */
export type OgCollection = 'pilots' | 'mechs' | 'weapons'

/** 正式站 origin。組絕對網址用，不從 request 取——爬蟲可能從任何主機名進來。 */
export const SITE_ORIGIN = 'https://mecharashi.wiki'

/** 全站預設圖（Tier 1 產物）。實體圖片欄位缺值時的 fallback（計畫書決策四）。 */
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/images/og/default.jpg`

const SITE_NAME = '米赫瑪超吉情豹站'

/**
 * 社群預覽爬蟲的 UA 特徵（一律小寫比對）。
 *
 * 刻意**只收社群平台的連結預覽爬蟲**，不含 Googlebot／Bingbot 等搜尋引擎——
 * 搜尋引擎會執行 JS，且 SEO 是另一個問題（計畫書「不在範圍內」）。
 *
 * ⚠ 寧可漏判也不要誤判：漏判＝那個平台退回 Tier 1 站名卡（可接受），
 *   誤判＝真人訪客拿到爬蟲路徑的回應。因此這裡只列足夠明確的特徵字串，
 *   不用 'line' / 'bot' 這類會誤傷一般瀏覽器 UA 的寬鬆片段。
 */
const CRAWLER_UA_MARKERS = [
  'discordbot',
  'linebot', 'line-poker', 'line-podcast',   // LINE 的三種預覽抓取器
  'slackbot', 'slack-imgproxy',
  'twitterbot',
  'facebookexternalhit', 'facebookcatalog',
  'telegrambot',
  'whatsapp',
  'skypeuripreview',
  'redditbot',
  'pinterest',
  'embedly',
  'applebot',                                 // iMessage 的連結預覽
  'vkshare',
  'bitlybot',
  'iframely',
]

/** 這個 UA 是不是社群連結預覽爬蟲。 */
export function isSocialCrawler(userAgent: string | null): boolean {
  if (!userAgent) return false
  const ua = userAgent.toLowerCase()
  return CRAWLER_UA_MARKERS.some(m => ua.includes(m))
}

/** `parseEntityPath` 的解析結果。 */
export interface EntityTarget {
  collection: OgCollection
  id: string
  /**
   * 來自機師故事館路徑（`/lore/pilots/…`，PLAN-042-A）。
   *
   * ⚠ **選填、且只有故事館分支才建這個鍵**：`socialPreview.test.ts` 有三處
   *   `assert.deepEqual(parseEntityPath(…), { collection, id })`，而 `assert/strict`
   *   的 deepEqual 比對自有可列舉鍵集合 —— 多一個 `lore` 鍵就失敗，
   *   **連 `lore: undefined` 都失敗**。故回傳物件一律條件建構。
   */
  lore?: true
  /** 章節 key（`/lore/pilots/:id/:part` 四段路徑才有）。 */
  part?: string
}

/**
 * ⚠ 刻意分成**兩條**正則，不要合併。
 *
 * 若把 `ENTITY_RE` 放寬成「選填第三段」來一併吃故事館路徑，圖鑑側的 `/pilots/a/b`
 * 也會跟著命中 —— 而 `socialPreview.test.ts` 明確斷言它是 null（放寬之後任何
 * `/pilots/x/y` 都會去 Firestore 查一次不存在的文件）。
 *
 * ⚠ `LORE_RE` 的字面值被 `src/lib/analytics/routeKeys.test.ts` 以字串比對綁住
 *   （URL 形狀跨檔一致的絆線），改這一行必須同時改 `ROUTE_PATTERNS`。
 */
const LORE_RE = /^\/lore\/(pilots)\/([^/]+)(?:\/([^/]+))?\/?$/
const ENTITY_RE = /^\/(pilots|mechs|weapons)\/([^/]+)\/?$/

/**
 * 文件 ID 的解碼與防護。畸形或不可能是文件 ID 的字串一律回 null，
 * 避免把奇怪字串當成文件路徑丟去 Firestore（Firestore 文件 ID 本身就不允許斜線）。
 */
function decodeSegment(raw: string): string | null {
  let s: string
  try {
    s = decodeURIComponent(raw)
  } catch {
    return null // 畸形的 percent-encoding：不是我們認得的 id，交給原始回應
  }
  if (s.length > 200 || /[/?#&\s]/.test(s)) return null
  return s
}

/**
 * 解析詳情頁路徑 → `EntityTarget`；不是詳情頁／故事館頁則回 null。
 *
 * URL 裡的 id 是 Firestore 文件 ID（如 `pilot_001_葉夫根尼`），含中文，
 * 在網址上是 percent-encoded，故必須 decode 後才能拿去查 Firestore。
 */
export function parseEntityPath(pathname: string): EntityTarget | null {
  const lore = pathname.match(LORE_RE)
  if (lore) {
    const id = decodeSegment(lore[2])
    if (id === null) return null
    // ⚠ 型別上 `lore[3]` 是 string（三份 tsconfig 都沒開 noUncheckedIndexedAccess），
    //   但選填 capture group 未命中時執行期是 undefined —— 而 decodeURIComponent(undefined)
    //   不丟錯、回傳字串 'undefined'，那會讓三段式路徑靜默帶上一個假 part。
    const rawPart: string | undefined = lore[3]
    let part: string | undefined
    if (rawPart !== undefined) {
      const decoded = decodeSegment(rawPart)
      if (decoded === null) return null
      part = decoded
    }
    return { collection: 'pilots', id, lore: true, ...(part !== undefined ? { part } : {}) }
  }

  const m = pathname.match(ENTITY_RE)
  if (!m) return null
  const id = decodeSegment(m[2])
  if (id === null) return null
  return { collection: m[1] as OgCollection, id }
}

export interface OgMeta {
  title: string
  description: string
  image: string
}

/** 產出 JPEG 立繪的鏡射根目錄，見 scripts/generate-og-entity-images.mjs。 */
const PREVIEW_JPEG_ROOT = '/images/og/entities'

/**
 * WebP 換成預先轉好的 JPEG。
 *
 * 為什麼：**WebP 在連結預覽器裡幾乎沒人支援** —— Facebook 的 OGP 只吃 JPEG/PNG/GIF，
 * LINE 實測是「標題與描述都正常、就是沒有圖」；Discord 是少數支援的，所以只有它看起來沒問題。
 * 站上的機師／機甲立繪 175/177 是 WebP，等於絕大多數卡片在 LINE 都沒有圖。
 *
 * build 前置的 scripts/generate-og-entity-images.mjs 會把這些立繪各轉一份 JPEG 到鏡射路徑：
 *   /images/pilots/曜/half.webp → /images/og/entities/pilots/曜/half.jpg
 *
 * ⚠ 這裡的推導規則與那支腳本的 SOURCES 是一組的，改一邊要改另一邊。
 *   萬一推導出來的檔案不存在，handleSocialPreview 會探測到並退回預設圖（不會留下破圖）。
 */
function toPreviewSafeImage(localPath: string): string {
  if (!localPath.toLowerCase().endsWith('.webp')) return localPath
  if (!localPath.startsWith('/images/')) return localPath
  return `${PREVIEW_JPEG_ROOT}/${localPath.slice('/images/'.length).replace(/\.webp$/i, '.jpg')}`
}

/** 這個 og:image 是不是本模組推導出來的 JPEG 路徑（值得驗證存在性的那種）。 */
export function isDerivedPreviewImage(url: string): boolean {
  return url.startsWith(`${SITE_ORIGIN}${PREVIEW_JPEG_ROOT}/`)
}

/** 把文件裡的本地圖片路徑組成絕對網址；沒有值就回 null 交給呼叫端 fallback。 */
function absoluteImage(path: unknown): string | null {
  if (typeof path !== 'string' || !path.trim()) return null
  const p = path.trim()
  if (p.startsWith('http://') || p.startsWith('https://')) return p
  const local = toPreviewSafeImage(p.startsWith('/') ? p : `/${p}`)
  // 路徑含中文（/images/pilots/葉夫根尼/half.webp）→ 必須 encode 才是合法 URL。
  // encodeURI 而非 encodeURIComponent：要保留斜線。
  return encodeURI(`${SITE_ORIGIN}${local}`)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** 描述欄位截斷。社群卡片本來就只顯示兩三行，過長只是浪費頻寬。 */
function truncate(s: string, max = 110): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

/**
 * 依集合組出這個實體的卡片內容。
 *
 * 欄位來源全部是既有的實體欄位（計畫書決策二：不為分享卡片另開美術維護線）：
 *   pilots  → portrait（88/88 有值）
 *   mechs   → portrait ?? halfPortrait（portrait 僅 1 筆缺，halfPortrait 缺 32 筆故當備位）
 *   weapons → icon（178 筆中 6 筆缺）
 *
 * `opts.lore`（PLAN-042-A）：這張卡片是機師故事館的分享卡。只換 title 與 description，
 * **og:image 沿用同一張 half.jpg** —— 故事館不另開一條美術維護線（計畫書決策二）。
 * 刻意做成選填參數：既有呼叫點與既有測試一個字都不必改。
 */
export function buildOgMeta(
  collection: OgCollection,
  doc: Record<string, unknown>,
  opts?: { lore?: boolean },
): OgMeta | null {
  const name = str(doc.name)
  if (!name) return null // 連名字都沒有就沒有做卡片的意義，退回站名卡

  if (collection === 'pilots' && opts?.lore) {
    // 章節不各自成卡：`part` 只是同一位機師故事的第幾段，分享出去的仍是「這位機師的故事」。
    return {
      title: `${name} 的故事`,
      description: truncate(str(doc.lore)) || `${name}｜機師故事館`,
      image: absoluteImage(doc.portrait) ?? DEFAULT_OG_IMAGE,
    }
  }

  if (collection === 'pilots') {
    const rarity = str(doc.rarity)
    const cls = str(doc.class)
    const faction = str(doc.faction)
    const fullName = str(doc.fullName)
    const parts = [
      fullName && fullName !== name ? fullName : '',
      faction ? `陣營：${faction}` : '',
      cls ? `職業：${cls}` : '',
    ].filter(Boolean)
    return {
      title: `${name}${rarity || cls ? ` · ${[rarity, cls].filter(Boolean).join(' ')}` : ''}`,
      description: truncate(parts.length ? `${parts.join('｜')}｜天賦、技能、神經驅動與數值一覽` : `${name} 的天賦、技能、神經驅動與數值一覽`),
      image: absoluteImage(doc.portrait) ?? DEFAULT_OG_IMAGE,
    }
  }

  if (collection === 'mechs') {
    const quality = str(doc.quality)
    const debut = str(doc.debutVersion)
    const lore = str(doc.lore)
    const fallbackDesc = [quality ? `${quality} 級機甲` : '機甲', debut ? `登場版本 v${debut}` : '']
      .filter(Boolean).join('｜')
    return {
      title: `${name}${quality ? ` · ${quality} 機甲` : ''}`,
      description: truncate(lore || `${fallbackDesc}｜部件、模組槽與數值一覽`),
      image: absoluteImage(doc.portrait) ?? absoluteImage(doc.halfPortrait) ?? DEFAULT_OG_IMAGE,
    }
  }

  // weapons
  const rarity = str(doc.rarity)
  const type = str(doc.type)
  const desc = str(doc.description)
  return {
    title: `${name}${rarity || type ? ` · ${[rarity, type].filter(Boolean).join(' ')}武器` : ''}`,
    description: truncate(desc || `${[rarity, type].filter(Boolean).join(' ')}武器｜數值、技能與改造一覽`),
    image: absoluteImage(doc.icon) ?? DEFAULT_OG_IMAGE,
  }
}

/**
 * 用 HTMLRewriter 把 Tier 1 的靜態標籤換成這個實體的內容。
 *
 * 只動 content 屬性、不動 HTML 結構——回應仍是同一份 index.html，
 * 萬一哪天有爬蟲其實會執行 JS，SPA 照樣跑得起來。
 *
 * `<title>` 也一起換：LINE 等平台在 og:title 缺失時會退而抓 title，
 * 兩邊一致才不會出現「卡片標題是實體、瀏覽器分頁是站名」的落差。
 */
export function rewriteHtmlWithOg(response: Response, meta: OgMeta, canonicalUrl: string): Response {
  const setContent = (value: string) => ({
    element(el: { setAttribute(name: string, value: string): void }) {
      el.setAttribute('content', value)
    },
  })
  const fullTitle = `${meta.title}｜${SITE_NAME}`

  return new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(fullTitle) // 預設會做 HTML escape，實體名稱不需自行處理
      },
    })
    .on('meta[property="og:title"]', setContent(fullTitle))
    .on('meta[property="og:description"]', setContent(meta.description))
    .on('meta[property="og:image"]', setContent(meta.image))
    .on('meta[property="og:image:alt"]', setContent(meta.title))
    .on('meta[property="og:url"]', setContent(canonicalUrl))
    // og:image:width／height 描述的是 Tier 1 那張 1200×630；實體立繪／圖示比例都不同，
    // 留著等於告訴平台一組錯的尺寸（有平台會據此預留版位）→ 整個移除，讓平台自己量。
    .on('meta[property="og:image:width"]', { element(el) { el.remove() } })
    .on('meta[property="og:image:height"]', { element(el) { el.remove() } })
    .on('meta[name="twitter:title"]', setContent(fullTitle))
    .on('meta[name="twitter:description"]', setContent(meta.description))
    .on('meta[name="twitter:image"]', setContent(meta.image))
    // 立繪是直式、圖示是方形，用大圖卡會被裁得很難看 → 換成方形小卡。
    .on('meta[name="twitter:card"]', setContent('summary'))
    .on('meta[name="description"]', setContent(meta.description))
    .transform(response)
}
