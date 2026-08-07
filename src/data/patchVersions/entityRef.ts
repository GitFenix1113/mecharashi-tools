import type { RefType } from '../../types'

/** 版本表會出現的 refType（其餘類型不可能被 entityIds 記到）。 */
const KNOWN_REF_TYPES = new Set<RefType>(['pilot', 'mech', 'weapon', 'backpack'])

/**
 * 解析 `VersionEntityIds` 的值。
 *
 * 一般情況值就是文件 ID，refType 由所在類別決定（pilots → pilot、backpacks → backpack…）。
 * 但**「顯示在哪一列」不等於「實體在哪個集合」**：版本表的「背包製作」列會出現複合武器
 * （天燼審判、裁決者、糖衣毀滅者 — PLAN-031），它們在官方資料層是武器、住在 weapons 集合，
 * 玩家視角卻是特種背包製作的產物。這種條目以 `weapon:<docId>` 記下，兩件事各自表達；
 * 背包圖鑑早已用同一個結論處理它們（投影條目，連結指向 /weapons/{id}）。
 *
 * 冒號前若不是已知 refType（理論上文件 ID 自己含冒號）整串視為 ID，不誤拆。
 */
export function parseEntityIdValue(
  value: string,
  fallback: RefType,
): { refType: RefType; refId: string } {
  const at = value.indexOf(':')
  if (at > 0) {
    const prefix = value.slice(0, at) as RefType
    if (KNOWN_REF_TYPES.has(prefix)) return { refType: prefix, refId: value.slice(at + 1) }
  }
  return { refType: fallback, refId: value }
}

/** 寫入用：refType 與所在類別一致時存純 ID，跨集合時才加前綴（見 parseEntityIdValue）。 */
export function formatEntityIdValue(docId: string, refType: RefType, categoryDefault: RefType): string {
  return refType === categoryDefault ? docId : `${refType}:${docId}`
}
