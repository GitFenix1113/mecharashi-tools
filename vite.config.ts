import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { SITEMAP_STATIC_PATHS, buildSitemapXml } from './src/lib/seo.ts'

const basePath = process.env.VITE_BASE_PATH || '/'

/**
 * build 時產出 dist/sitemap.xml（PLAN-061）。頁面清單的正本在 src/lib/seo.ts，
 * 由 seo.test.ts 綁住 ROUTE_PATTERNS，新增路由時測試會要求決定要不要收進來。
 *
 * PR 預覽（base 不是根路徑）不產：預覽站整個被 robots.txt 擋掉，
 * 而 sitemap 只在網站根目錄才有效。
 */
function sitemapPlugin(): Plugin {
  return {
    name: 'mecharashi-sitemap',
    apply: 'build',
    generateBundle() {
      if (basePath !== '/') return
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: buildSitemapXml(SITEMAP_STATIC_PATHS) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), sitemapPlugin()],
  // 正式站已搬到自訂網域 mecharashi.wiki（根路徑）。保留 VITE_BASE_PATH 覆寫能力：
  // 回退到 GitHub Pages 子路徑時可設 VITE_BASE_PATH=/mecharashi-tools/（PLAN-029 Phase 1）。
  base: basePath,
  define: {
    // 每次建置產生一組新識別碼，供程式碼替 public/ 底下的靜態檔加上 ?v= 破除 CDN 快取。
    // 起因：public/ 的檔案不像 assets/ 會帶內容雜湊，網址永遠不變；而 Cloudflare 以
    // 4 小時 TTL 邊緣快取它們（實測 manifest.json 回 cf-cache-status: HIT），使用者端
    // Ctrl+Shift+R 只清得掉瀏覽器快取、清不到邊緣節點，新內容因此最長 4 小時看不到。
    // 圖片只能經由部署上線，而每次部署必定重跑 build，故以建置識別碼當快取鍵即可保證新鮮。
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
})
