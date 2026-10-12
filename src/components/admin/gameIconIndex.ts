// 圖示圖庫索引（images/game/icons/index.json）的型別與 lazy 載入 —— 後台選圖器共用
//
// 索引由 scripts/generate-icon-index.mjs 在 build／predev 產生；前台顯示不需要它（key → 路徑是確定的），
// 只有後台的選圖器（GameIconPicker、陣營徽章 FactionLogoPicker）在開啟時才抓，不進前台 bundle 的首屏。
// 從 GameIconPicker 抽出來（PLAN-059 D-2）：元件檔匯出非元件會撞 react-refresh/only-export-components。

export interface IconIndex {
  skill: string[]
  buff: string[]
  /** PLAN-056；舊版索引沒有這兩欄 */
  weapon?: string[]
  backpack?: string[]
  /** PLAN-059；舊版索引沒有這三欄。不參與以圖搜圖（features.bin 只有上面四族） */
  class?: string[]
  license?: string[]
  camp?: string[]
  legacy: string[]
  /** 站長確認過的圖示註記（scripts/lib/equipIconNotes.json） */
  notes?: Record<string, string>
  /** 以圖搜圖特徵（features.bin）：每張 dim×dim×3 bytes，順序＝[...skill, ...buff, ...weapon, ...backpack] */
  features?: { dim: number; hash: string }
}

let indexCache: IconIndex | null = null
let indexPromise: Promise<IconIndex> | null = null

/** 已載入就同步拿到（給 useState 初值，避免第二次開選圖器時先閃一下「載入中」） */
export const peekIconIndex = (): IconIndex | null => indexCache

export function loadIconIndex(): Promise<IconIndex> {
  if (indexCache) return Promise.resolve(indexCache)
  if (!indexPromise) {
    // ?v=__BUILD_ID__：同 manifest.json——網址不變、內容每次匯圖都會變，換 query 才換得掉 CDN 快取
    const url = `${import.meta.env.BASE_URL}images/game/icons/index.json?v=${__BUILD_ID__}`
    indexPromise = fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`圖示索引載入失敗（${r.status}）`); return r.json() })
      .then((m: IconIndex) => { indexCache = m; return m })
      .catch((err) => { indexPromise = null; throw err })
  }
  return indexPromise
}
