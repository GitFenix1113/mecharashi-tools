import { GAME_PILOT_CARDS } from '../../data/gameArtIndex.ts'

/**
 * 館首頁 hero 的招募插畫（2600×1080 卡池主視覺）：兩館都是每次進館從池子裡抽一張。
 * 決策 B-5：招募插畫不上展廳舞台（搶主題），只在卷宗附件與館首頁 hero 出現。
 *
 * 池子是 build 時的靜態索引（GAME_MECH_CARDS／GAME_PILOT_CARDS），匯入只收站上有的實體，
 * 所以不必等 pilots／mechs 資料就能抽、圖可以馬上開始抓。池子是空的回 undefined（hero 只剩紅帶與標題）。
 *
 * 沿革：機甲廳 E-1 的過渡版是兩台主視覺並排，F-2 招募插畫上站後換掉；
 * 機師廳 2026-10-14 起是官網立繪群像（8 位抽 4 位），2026-10-18 比照機甲廳換成招募插畫。
 */
export function pickHeroCard<T>(pool: readonly T[], rand: () => number = Math.random): T | undefined {
  return pool.length ? pool[Math.floor(rand() * pool.length)] : undefined
}

/**
 * 不進機師廳 hero 的卡池鍵：插畫裡直接畫了陸版的**簡體**活動標題（深层潜行、开工时刻、须臾的真相），
 * 擺在繁中的館名旁邊很突兀。卷宗的「卡池」卡照常收錄——那裡是檔案，原樣保存才對。
 * 機甲的招募插畫目前沒有這種圖。
 */
export const PILOT_HERO_EXCLUDED_CARDS: ReadonlySet<string> = new Set(['Naomi', 'Seven', 'Erisa'])

/** 機師廳 hero 的池子：有招募插畫的機師 gameId，扣掉帶簡體標題的那幾張 */
export const PILOT_HERO_POOL: readonly string[] = [...GAME_PILOT_CARDS]
  .filter(([, card]) => !PILOT_HERO_EXCLUDED_CARDS.has(card))
  .map(([gameId]) => gameId)
