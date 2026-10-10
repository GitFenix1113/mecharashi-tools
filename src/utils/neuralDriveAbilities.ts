import type { NeuralDriveLevel, NeuralDriveAbility } from '../types'

/**
 * PLAN-023 神經驅動能力庫 — 過渡期解析工具。
 *
 * NeuralDriveLevel 在遷移過程中可能是兩種格式：
 *   - 新：填了 abilityId → 內容由 neuralDriveAbilities 集合提供（單一資料源）
 *   - 舊：嵌入 skillName / effect / effects / buffIds（圖示副本 skillIcon／iconLocal 已於 PLAN-055 C 刪除，
 *     嵌入格式沒有圖示——2026-10-11 起全部 1,578 級都有 abilityId，這條路只剩防呆）
 * 本工具把兩種都解析成一致的 NeuralDriveAbility 形狀，前端不需在意目前是哪種格式。
 * abilityId 查不到（尚未載入 / 資料不一致）→ 回退嵌入欄位，優雅降級不報錯。
 */

/** 由 neuralDriveAbilities 集合建立 id→doc 快速查表 */
export function buildNdAbilityMap(abilities: NeuralDriveAbility[]): Map<string, NeuralDriveAbility> {
  return new Map(abilities.map(a => [a.id, a]))
}

/** 嵌入式 NeuralDriveLevel → NeuralDriveAbility 形狀（id 留空，標記為未遷移） */
function embeddedToAbility(lv: NeuralDriveLevel): NeuralDriveAbility {
  return {
    id: lv.abilityId ?? '',
    name: lv.skillName,
    description: lv.effect,
    effects: lv.effects ?? [],
    buffIds: lv.buffIds ?? [],
  }
}

/**
 * 解析單一 NeuralDriveLevel → NeuralDriveAbility（統一能力內容）。
 * level / minSum（門檻、所屬分區）屬「機師如何取得」資訊，不在此回傳，仍由呼叫端從 level 取。
 */
export function resolveNeuralDriveLevel(
  lv: NeuralDriveLevel,
  abilityMap: Map<string, NeuralDriveAbility>,
): NeuralDriveAbility {
  if (lv.abilityId) {
    const a = abilityMap.get(lv.abilityId)
    if (a) return a
  }
  return embeddedToAbility(lv)
}
