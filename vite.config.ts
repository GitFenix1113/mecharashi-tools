import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 正式站已搬到自訂網域 mecharashi.wiki（根路徑）。保留 VITE_BASE_PATH 覆寫能力：
  // 回退到 GitHub Pages 子路徑時可設 VITE_BASE_PATH=/mecharashi-tools/（PLAN-029 Phase 1）。
  base: process.env.VITE_BASE_PATH || '/',
  define: {
    // 每次建置產生一組新識別碼，供程式碼替 public/ 底下的靜態檔加上 ?v= 破除 CDN 快取。
    // 起因：public/ 的檔案不像 assets/ 會帶內容雜湊，網址永遠不變；而 Cloudflare 以
    // 4 小時 TTL 邊緣快取它們（實測 manifest.json 回 cf-cache-status: HIT），使用者端
    // Ctrl+Shift+R 只清得掉瀏覽器快取、清不到邊緣節點，新內容因此最長 4 小時看不到。
    // 圖片只能經由部署上線，而每次部署必定重跑 build，故以建置識別碼當快取鍵即可保證新鮮。
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
})
