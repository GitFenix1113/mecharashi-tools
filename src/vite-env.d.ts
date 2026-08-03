/// <reference types="vite/client" />

/**
 * 建置識別碼，由 vite.config.ts 的 define 在編譯期替換成字面值。
 * 用途：替 public/ 底下無內容雜湊的靜態檔（如 images/manifest.json）加上 ?v=，
 * 讓每次部署換一個 CDN 快取鍵，避免讀到邊緣節點的舊檔。
 */
declare const __BUILD_ID__: string
