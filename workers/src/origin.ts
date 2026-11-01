// /api 反爬守門的來源判斷（index.ts 的 antiScrapeBlock 用）。
//
// Origin 要完全相同；Referer 先取 origin 再完全比對。舊寫法 `referer.startsWith(白名單)` 是前綴比對，
// 會放過 https://mecharashi.wiki.evil.example/ 這種相似網域（白名單每一筆都沒有結尾斜線）。
// 與 /sim Worker（私有 repo mecharashi-sim 的 worker/src/index.ts）的 originOf 同語意。

/** Referer → origin；空字串或解析失敗視為沒有 Referer。 */
export function originOf(referer: string): string | null {
  if (!referer) return null
  try {
    return new URL(referer).origin
  } catch {
    return null
  }
}

/** Origin 或 Referer 的 origin 落在白名單（完全相同）。白名單裡的空字串一律不算。 */
export function isAllowedSource(allowed: readonly string[], origin: string, referer: string): boolean {
  const refOrigin = originOf(referer)
  return allowed.some((a) => a !== '' && (origin === a || refOrigin === a))
}
