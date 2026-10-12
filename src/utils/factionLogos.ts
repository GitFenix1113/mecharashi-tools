// 陣營徽章（pilotLore.factionLogos）的純函式 —— PLAN-059 D
//
// 型別註解（為什麼存在 pilotLore、為什麼不做陣營字典）在 src/types/lore.ts 的 LoreDoc.factionLogos。
// 純函式、無 React／Firestore 依賴，可 node --test。

/** 每位機師最多幾個徽章（站長 2026-10-13：目前最多的複合陣營就是兩個） */
export const FACTION_LOGO_MAX = 2

/** 陣營徽章的官方檔名：Icon_logo_<4 碼>_<00 單色｜01 彩色> */
const LOGO_RE = /^Icon_logo_(\d{4})_(0[01])$/

export function isFactionLogoKey(key: unknown): key is string {
  return typeof key === 'string' && LOGO_RE.test(key)
}

/** _00＝白色單色（前台用 mask 上色）；_01＝彩色（原樣） */
export function isMonoLogo(key: string): boolean {
  return key.endsWith('_00')
}

/** 編號（不含變體），選圖器分組與搜尋用：'Icon_logo_0025_01' → '0025' */
export function logoNumber(key: string): string | undefined {
  return key.match(LOGO_RE)?.[1]
}

/**
 * 讀進來的值 → 能畫的清單：只留合法檔名、去重、最多 FACTION_LOGO_MAX 個。
 * 讀取端與存檔前都走這裡——Firestore 沒有 schema，手改或舊資料裡什麼都可能有。
 */
export function normalizeFactionLogos(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter(isFactionLogoKey))].slice(0, FACTION_LOGO_MAX)
}

export interface LogoPair {
  num: string
  /** _00 白色單色 */
  mono?: string
  /** _01 彩色 */
  color?: string
}

/** 圖庫的檔名清單 → 依編號配對（有的編號只有彩色版），編號遞增 */
export function groupLogoPairs(keys: readonly string[]): LogoPair[] {
  const byNum = new Map<string, LogoPair>()
  for (const k of keys) {
    const m = k.match(LOGO_RE)
    if (!m) continue
    const pair = byNum.get(m[1]) ?? { num: m[1] }
    if (m[2] === '00') pair.mono = k
    else pair.color = k
    byNum.set(m[1], pair)
  }
  return [...byNum.values()].sort((a, b) => a.num.localeCompare(b.num))
}

export interface LogoSuggestion {
  logos: string[]
  /** 選了這一組的機師名 */
  pilots: string[]
}

/**
 * 「同樣寫『晨星同盟防衛軍』的其他機師已選：…」——後台一鍵套用的來源（PLAN-059 決策六）。
 * 只比對陣營文字完全相同（去頭尾空白）的機師；不猜「北陸聯合」與「北陸聯合·聯合安全總署」是不是同一個——那是站長的判斷。
 * 同一組徽章合併成一筆，選的人多的排前面。從已載入的 pilots／pilotLore 推導，不另存。
 */
export function factionLogoSuggestions(
  pilotId: string,
  faction: string | null | undefined,
  pilots: readonly { id: string; name: string; faction?: string }[],
  loreDocs: readonly { id: string; factionLogos?: unknown }[],
): LogoSuggestion[] {
  const target = faction?.trim()
  if (!target) return []
  const logosById = new Map(loreDocs.map((d) => [d.id, normalizeFactionLogos(d.factionLogos)]))
  const byCombo = new Map<string, LogoSuggestion>()
  for (const p of pilots) {
    if (p.id === pilotId || p.faction?.trim() !== target) continue
    const logos = logosById.get(p.id) ?? []
    if (!logos.length) continue
    const k = logos.join('|')
    const s = byCombo.get(k) ?? { logos, pilots: [] }
    s.pilots.push(p.name)
    byCombo.set(k, s)
  }
  return [...byCombo.values()].sort((a, b) => b.pilots.length - a.pilots.length)
}
