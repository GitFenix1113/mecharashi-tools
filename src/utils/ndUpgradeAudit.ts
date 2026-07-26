// 升階家族的引用點稽核（PLAN-034 Phase D-1）
//
// 規則：**被 buffUpgrades 指到的 buff 家族，其所有引用站點必須 level 與 fixedLevel 二選一、
// 不得皆空。**
//
// 為什麼這是硬規則而非建議：
//   · effectiveLevel 的判定是 `覆寫階 > (ref.level ?? 0)`。沒填 level 的引用基準階是 **0**，
//     於是任何覆寫都必然抬升它——包含那些**不該**被抬升的地方。
//   · 而「不該被抬升」在本專案是真實存在的：實機確認過官方不同角色的文案由不同人撰寫，
//     有些機師的技能敘述會隨算力改寫、有些不會（計畫書地雷九）。
//   · 漏填的症狀是「本站顯示出遊戲裡看不到的階名」——不會報錯、不會當掉，
//     只會安靜地給出錯誤資訊，而技能區正是使用者對照官方 wiki 最頻繁的地方。
//
// 刻意獨立成檔而不放進 ndOverrides.ts：本規則需要 entityRefs 的全站掃描能力，
// 而 ndOverrides 被 RefChip（全站扇出最高的葉節點）匯入，不該把掃描器拖進那條 import 路徑。
//
// 純函式、可單測（npm test）。

import type { EntityRef } from '../types'
import { parseBuffRef } from './buffRef.ts'
import { findReferences, type RefScanData } from './entityRefs.ts'

export interface NdUpgradeViolation {
  /** 被 buffUpgrades 指到的家族 */
  buffId: string
  /** 宣告升階的能力（可能多個，逗號串接） */
  declaredBy: string
  coll: string
  docId: string
  docName: string
  /** 人類可讀位置，如 '技能:破勢' */
  origin: string
  /** 命中的 [xxx] 字面 */
  matched: string
  path: string
}

export interface NdUpgradeAuditResult {
  /** level 與 fixedLevel 皆空的引用點 */
  violations: NdUpgradeViolation[]
  /** 有宣告升階的家族清單 */
  upgradedBuffIds: string[]
  /**
   * 未載入而未掃描的集合。**非空時 violations 為空不代表沒問題**，
   * 呼叫端不得顯示「全部通過」。
   */
  missingColls: string[]
}

/**
 * 掃出所有「指向升階家族、卻既沒填 level 也沒 fixedLevel」的引用點。
 *
 * @param data 各集合已載入資料；neuralDriveAbilities 未提供時直接回空結果並列進 missingColls
 *             （沒有能力庫就無從得知哪些家族會升階，此時「零違規」是假象）。
 */
export function auditNdUpgradeRefs(data: RefScanData): NdUpgradeAuditResult {
  const abilities = data.neuralDriveAbilities
  if (!abilities) {
    return { violations: [], upgradedBuffIds: [], missingColls: ['neuralDriveAbilities'] }
  }

  // 家族 → 宣告它的能力們
  const declaredBy = new Map<string, string[]>()
  for (const a of abilities) {
    for (const raw of a.buffUpgrades ?? []) {
      const { buffId } = parseBuffRef(raw)
      if (!buffId) continue
      declaredBy.set(buffId, [...(declaredBy.get(buffId) ?? []), a.id])
    }
  }

  const violations: NdUpgradeViolation[] = []
  const missing = new Set<string>()

  for (const [buffId, byIds] of declaredBy) {
    // 只看 descriptionRefs：buffIds / numToken 站點沒有 level 與 fixedLevel 的概念，
    // 前者的階直接寫在 `id@N` 裡，後者寫在 token 的 .lvN 段裡。
    const { hits, missingColls } = findReferences('buff', buffId, data, { kinds: ['descriptionRefs'] })
    missingColls.forEach((c) => missing.add(c))

    for (const h of hits) {
      const ref = h.value as EntityRef | undefined
      if (ref?.level != null || ref?.fixedLevel) continue
      violations.push({
        buffId,
        declaredBy: byIds.join('、'),
        coll: h.coll,
        docId: h.docId,
        docName: h.docName,
        origin: h.origin,
        matched: h.matched ?? '',
        path: h.path,
      })
    }
  }

  return {
    violations,
    upgradedBuffIds: [...declaredBy.keys()],
    missingColls: [...missing],
  }
}

/** 把稽核結果整理成人看的多行字串（後台警示 / 腳本輸出共用）。 */
export function formatNdUpgradeViolations(r: NdUpgradeAuditResult): string {
  if (r.missingColls.length) {
    return `⚠ 未完整掃描（缺 ${r.missingColls.join('、')}），無法判定；請先載入這些集合再看結果。`
  }
  if (!r.upgradedBuffIds.length) return '（尚無任何 buffUpgrades 宣告）'
  if (!r.violations.length) return `✅ ${r.upgradedBuffIds.length} 個升階家族的引用點皆已指定 level 或 fixedLevel。`
  return [
    `⚠ ${r.violations.length} 筆引用點既沒填 level 也沒 fixedLevel（會被算力無條件抬升）：`,
    ...r.violations.map((v) => `  · ${v.coll}/${v.docId} ${v.origin} [${v.matched}] → ${v.buffId}（升階宣告：${v.declaredBy}）`),
  ].join('\n')
}
