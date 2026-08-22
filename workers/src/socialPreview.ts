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

/**
 * 解析詳情頁路徑 → { collection, id }；不是這三種詳情頁則回 null。
 *
 * URL 裡的 id 是 Firestore 文件 ID（如 `pilot_001_葉夫根尼`），含中文，
 * 在網址上是 percent-encoded，故必須 decode 後才能拿去查 Firestore。
 */
export function parseEntityPath(pathname: string): { collection: OgCollection; id: string } | null {
  const m = pathname.match(/^\/(pilots|mechs|weapons)\/([^/]+)\/?$/)
  if (!m) return null
  let id: string
  try {
    id = decodeURIComponent(m[2])
  } catch {
    return null // 畸形的 percent-encoding：不是我們認得的 id，交給原始回應
  }
  // 文件 ID 不可能含這些字元（Firestore 文件 ID 本身就不允許斜線）；
  // 擋掉的同時也避免把奇怪字串當成文件路徑丟去 Firestore。
  if (id.length > 200 || /[/?#&\s]/.test(id)) return null
  return { collection: m[1] as OgCollection, id }
}

export interface OgMeta {
  title: string
  description: string
  image: string
}

/** 把文件裡的本地圖片路徑組成絕對網址；沒有值就回 null 交給呼叫端 fallback。 */
function absoluteImage(path: unknown): string | null {
  if (typeof path !== 'string' || !path.trim()) return null
  const p = path.trim()
  if (p.startsWith('http://') || p.startsWith('https://')) return p
  // 路徑含中文（/images/pilots/葉夫根尼/half.webp）→ 必須 encode 才是合法 URL。
  // encodeURI 而非 encodeURIComponent：要保留斜線。
  return encodeURI(`${SITE_ORIGIN}${p.startsWith('/') ? '' : '/'}${p}`)
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
 */
export function buildOgMeta(collection: OgCollection, doc: Record<string, unknown>): OgMeta | null {
  const name = str(doc.name)
  if (!name) return null // 連名字都沒有就沒有做卡片的意義，退回站名卡

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
