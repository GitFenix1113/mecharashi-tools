import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 正式站已搬到自訂網域 mecharashi.wiki（根路徑）。保留 VITE_BASE_PATH 覆寫能力：
  // 回退到 GitHub Pages 子路徑時可設 VITE_BASE_PATH=/mecharashi-tools/（PLAN-029 Phase 1）。
  base: process.env.VITE_BASE_PATH || '/',
})
