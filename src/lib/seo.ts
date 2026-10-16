// 搜尋引擎可見度：頁面標題與 sitemap 的單一來源 —— PLAN-061
//
// 本檔刻意不碰 DOM、也不 import React：
//   · vite.config.ts 在 build 時 import 這裡產 sitemap.xml（Node 環境，沒有 window）。
//   · seo.test.ts 用 node --test 直接跑。
//
// 路由樣板沿用 src/lib/analytics/routeKeys.ts 的 ROUTE_PATTERNS（它已由測試與 App.tsx 綁住）。
// 新增路由時，seo.test.ts 會要求你在本檔做兩個決定：
//   ① PAGE_TITLES 給它一個頁名
//   ② 它要不要進 sitemap（SITEMAP_STATIC_PATHS 或 SITEMAP_EXCLUDED 擇一）

import { SITE_DOC_TITLE, SITE_ORIGIN } from './siteMeta.ts'

/** 「頁名｜SITE_DOC_TITLE」。沒有頁名（首頁）時只回 SITE_DOC_TITLE。 */
export function formatDocTitle(page?: string | null): string {
  return page ? `${page}｜${SITE_DOC_TITLE}` : SITE_DOC_TITLE
}

type RouteParams = Record<string, string | undefined>
type TitleSpec = string | null | ((params: RouteParams) => string)

/**
 * 路由樣板 → 頁名。`null` = 不加頁名（首頁）。
 *
 * 詳情頁（:id）這裡寫的是**資料載入前**的暫用頁名；載入後由頁面呼叫
 * usePageTitle()（src/contexts/PageTitleContext.tsx）換成「海莉絲 機師資料」這種帶名字的版本。
 */
export const PAGE_TITLES: Record<string, TitleSpec> = {
  '/':                            null,
  '/pilots':                      '機師圖鑑',
  '/pilots/:id':                  '機師資料',
  '/mechs':                       '機甲圖鑑',
  '/mechs/:id':                   '機甲資料',
  '/weapons':                     '武器圖鑑',
  '/weapons/:id':                 '武器資料',
  '/backpacks':                   '背包圖鑑',
  '/modules':                     '模組圖鑑',
  '/components':                  '元件圖鑑',
  '/versions':                    '版本情報',
  '/versions/quick':              '版本速覽',
  '/versions/grayops':            '灰燼行動',
  '/versions/timeline':           '版本時間線',
  '/versions/timeline/:version':  (p) => (p.version ? `${p.version} 版本時間線` : '版本時間線'),
  '/lore':                        '機師故事館',
  '/lore/pilots/:id':             '機師故事館',
  '/lore/pilots/:id/:part':       '機師故事館',
  '/lore/mechs/:id':              '機甲故事館',
  '/lore/mechs/:id/:part':        '機甲故事館',
  '/simulator':                   '配裝模擬器',
  '/research':                    '研究所',
  '/news':                        '最新消息',
  '/guides':                      '攻略',
  '/tools':                       '工具',
  '/documents':                   '開發文件',
  '/tools/rainbow-planner':       '彩虹機規劃器',
  '/guides/component-drops':      '元件掉落查詢',
  '/debug/storage':               '儲存空間診斷',
  '/connectivity':                '連線診斷',
  '/profile':                     '個人中心',
  '/admin':                       '管理後台',
  '/admin/versions':              '版本管理',
  '/admin/versions/:versionId':   '版本編輯',
  '/admin/history':               '編輯紀錄',
  '/admin/system-log':            '系統日誌',
  '/admin/analytics':             '使用統計',
  '/admin/announcements':         '公告審核',
  '/admin/lore':                  '故事館編輯台',
  '*':                            '找不到頁面',
}

/** 樣板＋參數 → 完整 document.title。未登記的樣板退回站台標題（測試會先擋下這種情況）。 */
export function routeDocTitle(pattern: string, params: RouteParams = {}): string {
  const spec = PAGE_TITLES[pattern]
  const page = typeof spec === 'function' ? spec(params) : spec
  return formatDocTitle(page)
}

// ── sitemap.xml ──────────────────────────────────────────────────────────────

/**
 * 進 sitemap 的固定頁面。
 *
 * 只放「有內容、對外公開、網址不會變」的頁。詳情頁（:id）不在這裡：
 * 列表頁裡都是 <a href> 連結，搜尋引擎會順著爬到；之後若要把詳情頁直接列進 sitemap，
 * 見 PLAN-061 計畫書的後續選項。
 */
export const SITEMAP_STATIC_PATHS: readonly string[] = [
  '/',
  '/pilots',
  '/mechs',
  '/weapons',
  '/backpacks',
  '/modules',
  '/components',
  '/versions/quick',
  '/versions/grayops',
  '/versions/timeline',
  '/lore',
  '/news',
  '/guides',
  '/tools',
  '/tools/rainbow-planner',
  '/guides/component-drops',
]

/** 不進 sitemap 的樣板與理由。新增路由時二選一：放進上面，或在這裡寫下理由。 */
export const SITEMAP_EXCLUDED: Record<string, string> = {
  '/pilots/:id':                 '詳情頁，由列表頁的連結被爬到',
  '/mechs/:id':                  '詳情頁，由列表頁的連結被爬到',
  '/weapons/:id':                '詳情頁，由列表頁的連結被爬到',
  '/versions':                   '只做轉址到 /versions/quick',
  '/versions/timeline/:version': '單一版本深連結，由時間線頁連到',
  '/lore/pilots/:id':            '故事館扉頁，由館首頁的連結被爬到',
  '/lore/pilots/:id/:part':      '故事館章節，由扉頁的連結被爬到',
  '/lore/mechs/:id':             '機甲故事館扉頁，由館首頁與機甲圖鑑的連結被爬到',
  '/lore/mechs/:id/:part':       '機甲故事館章節，由扉頁的連結被爬到',
  '/simulator':                  '內部測試中，一般訪客看不到入口（useSimulatorEntryVisible）',
  '/research':                   '模擬器的子工具，隨模擬器一起開放',
  '/documents':                  '開發文件，不是給玩家搜尋的內容',
  '/debug/storage':              '診斷工具',
  '/connectivity':               '診斷工具',
  '/profile':                    '登入後的個人頁',
  '/admin':                      '後台',
  '/admin/versions':             '後台',
  '/admin/versions/:versionId':  '後台',
  '/admin/history':              '後台',
  '/admin/system-log':           '後台',
  '/admin/analytics':            '後台',
  '/admin/announcements':        '後台',
  '/admin/lore':                 '後台',
  '*':                           '404 頁',
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 站內路徑（未編碼）→ 絕對網址。逐段編碼：sitemap 規範要求 URL 已編碼，而詳情頁的 id 含中文。 */
export function absoluteUrl(path: string): string {
  return SITE_ORIGIN + path.split('/').map(encodeURIComponent).join('/')
}

/** 產出 sitemap.xml 全文。不寫 lastmod／priority：沒有可靠的資料來源，Google 也表明會忽略 priority。 */
export function buildSitemapXml(paths: readonly string[]): string {
  const urls = paths.map((p) => `  <url><loc>${escapeXml(absoluteUrl(p))}</loc></url>`)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}
