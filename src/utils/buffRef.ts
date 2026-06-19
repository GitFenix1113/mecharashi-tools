// buffIds 帶等級解析（PLAN-024 A-3）
//
// buffIds 元素可帶等級尾綴 <buffId>@<level>，表達「賦予指定等級的 buff」（如 buff_傷害提升@3）。
// 分隔符 '@'（code point 0x40）不在 idSlug 的保留字元範圍內 → 不可能出現在 buff id slug 中，
// 故 split 無歧義（見 src/utils/idSlug.ts isKept）。未帶尾綴 = 賦予 base / 該 buff 預設級，與既有裸 id 完全相容。
// 純函式、無依賴，可單測（npm test）。

export interface BuffRef {
  /** buff 文件 ID（不含等級尾綴） */
  buffId: string
  /** 指定等級（階梯 buff）；未指定 = base / 預設級 */
  level?: number
}

// 結尾 @<數字>；非貪婪 buffId，僅最後的 @N 視為等級。非數字尾綴不匹配 → 不誤拆。
const BUFF_REF_RE = /^(.+?)@(\d+)$/

/** 解析 buffIds 元素為 { buffId, level? }。無合法 @N 尾綴 → 整串視為 buffId（向後相容）。 */
export function parseBuffRef(ref: string): BuffRef {
  const m = ref.match(BUFF_REF_RE)
  return m ? { buffId: m[1], level: Number(m[2]) } : { buffId: ref }
}

/** 組回 buffIds 字串：有 level → `id@N`，否則裸 id。與 parseBuffRef 互逆。 */
export function formatBuffRef(buffId: string, level?: number): string {
  return level != null ? `${buffId}@${level}` : buffId
}
