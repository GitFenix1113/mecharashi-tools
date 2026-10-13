import { PILOT_OFFICIAL_INDEX } from '../../data/artIndex.ts'

/**
 * 館首頁 hero 的立繪群像（2026-10-14 換掉官網 KV＋招募標語）：從有官網圖層的 8 位裡抽 4 位。
 *
 * 站位（index.css 的 `.lore-home-hero__figure[data-slot]`）：
 *   0 左後（緊貼紅帶）· 1 中前（最高）· 2 右 · 3 最右（半出畫）
 * 手機只留 1、2，平板拿掉 0。
 *
 * ⚠ **寬圖只排 3 號位**：官網彩圖是各自裁 bbox 的，三位的 bbox 是橫的（舉槍、抱文件板、披風）。
 *   排在 0～2 號會撐到紅帶上的標題，或在手機上一位就佔掉半張 hero；3 號位本來就半出畫，寬一點無妨。
 *   所以 0～2 號一律從直圖抽，3 號再從剩下的全部（含寬圖）抽——同一組最多一位寬圖。
 */
export const HERO_SLOTS = 4

/** 寬高比到這個值以上就算寬圖。實測 8 位：直圖 0.69–0.93，寬圖 1.18–1.32，中間沒有灰色地帶。 */
const WIDE_RATIO = 1.1

export function isWideOfficialArt(dir: string): boolean {
  const g = PILOT_OFFICIAL_INDEX.get(dir)
  return !!g && g.w / g.h >= WIDE_RATIO
}

/** 回傳 4 個圖片資料夾名（＝遊戲 ID），依站位 0～3 排好。`rand` 可注入，測試用。 */
export function pickHeroCast(rand: () => number = Math.random): string[] {
  const all = [...PILOT_OFFICIAL_INDEX.keys()]
  const narrow = shuffle(all.filter((d) => !isWideOfficialArt(d)), rand)
  const front = narrow.slice(0, HERO_SLOTS - 1)
  const rest = all.filter((d) => !front.includes(d))
  return [...front, rest[Math.floor(rand() * rest.length)]]
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
