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

/**
 * 機甲廳 hero 的陣容（PLAN-042-B E-1）：從有主視覺（`_SN_Raw`）的機甲裡抽 2 台，0 號後排、1 號前排。
 *
 * 池子由頁面給（站上真的有的機甲 ∩ 有主視覺），不從圖片索引拿：索引裡有已匯入、還沒建檔的機甲，
 * 讓牆上找不到的機甲站在 hero 上很怪。池子不足 2 台就回傳全部（0 台＝hero 只剩紅帶與標題）。
 *
 * ⚠ 這是過渡陣容：計畫書的 hero 是招募插畫或廠商舞台輪播，那兩種素材要等 F-2 上站。
 */
export const MECH_HERO_SLOTS = 2

export function pickMechHeroCast<T>(pool: readonly T[], rand: () => number = Math.random): T[] {
  return shuffle([...pool], rand).slice(0, MECH_HERO_SLOTS)
}

/**
 * 可重現的亂數（mulberry32）。機甲廳的池子要等資料到了才有：頁面在進館時抽一次種子，
 * 池子從空變滿的那一刻用同一顆種子抽，之後重繪不會換陣容。
 */
export function seededRandom(seed: number): () => number {
  let a = Math.floor(seed * 0x100000000) | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
