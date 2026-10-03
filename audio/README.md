# 故事館背景音樂（PLAN-042-C E-2）

`lore-bgm.mp3`：鋼嵐台版官網 hero 區的 BGM（`https://media.tentree-games.com/tw/ma/officialsite/bgm.mp3`，
320kbps／175 秒／7MB）節錄前 96 秒，2 秒淡入、4 秒淡出，重編碼成 96kbps（1.1MB）。
取得日期 2026-09-17；使用前提同 `public/images/lore/README.md`（非營利共識）。

播放端：`src/components/lore/LoreBgmToggle.tsx` —— 預設關、`<audio preload="none">` 關著時不下載、
偏好存 `localStorage.mecharashi_lore_bgm`、離館（元件卸載）即停。

重新產生：`_local-notes/2026-09/2026-09-17_build-bgm.mjs`（這台沒有 ffmpeg；用 Chromium Web Audio 解碼＋
`@breezystack/lamejs` 重編碼，來源檔暫放本目錄 `_src_bgm.mp3` 由 dev server 供應、做完自動刪除）。
