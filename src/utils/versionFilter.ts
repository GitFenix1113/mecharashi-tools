// 登場版本篩選（2026-10-11）—— 純函式，UI 在 components/common/VersionFilter.tsx
//
// 改版前兩個圖鑑把資料裡出現過的版本**逐一攤成按鈕**：26 個版本、兩列，而且每個版本只有 1～3 台／位
// （v1.0 例外，42 台）——按鈕越來越多，每顆的用處卻越來越小。改成兩層：
//   第一層：全部 ／ v3.x ／ v2.x ／ v1.x（大版本約一年才多一個）
//   第二層：選了大版本才展開它的小版本（最多約 9 顆），預設「整個 3.x」
//
// 篩選值是一個字串，三種形狀：
//   ''      全部
//   '3.x'   整個大版本
//   '3.6'   單一版本
// 用字串而不是物件：兩個頁面都把它當 useState 的值，比較與重設都直接。

export type VersionFilterValue = string

const MAJOR_SUFFIX = '.x'

/** '3.6' → '3'；格式不認得時原樣回傳（不 throw，資料是人工建檔的） */
export function versionMajor(version: string): string {
  return version.split('.')[0]
}

/** 大版本的篩選值：'3' → '3.x' */
export function majorFilterValue(major: string): VersionFilterValue {
  return `${major}${MAJOR_SUFFIX}`
}

/** 這個篩選值是「整個大版本」嗎 */
export function isMajorFilter(value: VersionFilterValue): boolean {
  return value.endsWith(MAJOR_SUFFIX)
}

/** 篩選值屬於哪個大版本：'3.x' → '3'、'3.6' → '3'、'' → null */
export function majorOfFilter(value: VersionFilterValue): string | null {
  if (!value) return null
  return versionMajor(value)
}

/**
 * 版本比較（**逐段比數字**，新的在前用 `-compareVersions`）。
 * ⚠ 不用 parseFloat：'3.10' 會被當成 3.1、排在 3.9 後面。今天最大的小版本是 .8，
 *   但大版本什麼時候進位是官方的事，不該把排序押在「小版本永遠不到兩位數」上。
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export interface VersionGroup {
  major: string
  /** 該大版本底下實際出現過的小版本，新 → 舊 */
  versions: string[]
}

/** 把出現過的版本依大版本分組；組與組、組內都是新 → 舊。空字串與重複值會被濾掉 */
export function groupVersionsByMajor(versions: readonly string[]): VersionGroup[] {
  const uniq = Array.from(new Set(versions.filter(Boolean))).sort((a, b) => compareVersions(b, a))
  const groups: VersionGroup[] = []
  for (const v of uniq) {
    const major = versionMajor(v)
    const last = groups[groups.length - 1]
    if (last?.major === major) last.versions.push(v)
    else groups.push({ major, versions: [v] })
  }
  return groups
}

/** 某筆資料的登場版本是否符合篩選。沒有登場版本的資料只在「全部」時出現 */
export function matchesVersionFilter(debutVersion: string | undefined | null, value: VersionFilterValue): boolean {
  if (!value) return true
  if (!debutVersion) return false
  if (isMajorFilter(value)) return versionMajor(debutVersion) === majorOfFilter(value)
  return debutVersion === value
}
