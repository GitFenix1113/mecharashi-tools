// 神經驅動給的 AP 加成（2026-11-21）
//
// ── 這一支在回答什麼 ────────────────────────────────────────────────────────
// 機師詳情頁 AP 三格的括號值：「神經驅動滿配後」初始／上限／回復各加多少。
// ＝該機師每一個神經驅動等級所掛能力的 `NeuralDriveAbility.apBonus` 加總。
//
// ── 為什麼不掃說明文字 ──────────────────────────────────────────────────────
// 以前是拿三條正規表示式（`AP的?回復[值量]?\+N` 之類）掃 description。條件句也會掃中：
// 天才4「[同步率]大於等於85%時，AP的回復值+1」、元氣滿滿2「使目標AP上限+1」（加的是隊友）……
// 2026-11-21 對官方資料包，92 位有 6 位多算（羅娜、明日香、羅斯瑪麗、戰部渡、安、黑障）。
// 官方本來就分得清楚——永久加成寫在被動技能的屬性上、條件式掛啟動條件——只是說明文字看不出來。
// 「有沒有這個加成」是規則，不靠官方文案判斷（同 ndPowerBonus.ts 的 ND_POWER_MODULES）。
//
// ── 「滿配」為什麼可以直接全加 ──────────────────────────────────────────────
// 永久加成全落在 α／β（恆滿級）或 γ ≥4 的低門檻：γ1≥4＋γ2≥4＝8，遠低於 γ 投入上限 23，
// 所以全部同時成立，不必看玩家的 γ 配點。哪天出現高門檻的永久加成，這裡要改成吃生效等級。
//
// 純函式、無 React／Firestore 依賴：前台、後台與 scripts/check-pilot-ap-drift.mjs 共用同一份。

import type { NeuralDrive, NeuralDriveAbility, PilotAp } from '../types/index.ts'
import { resolveNeuralDriveLevel } from './neuralDriveAbilities.ts'

export const AP_KEYS = ['init', 'max', 'recovery'] as const

export const zeroAp = (): PilotAp => ({ init: 0, max: 0, recovery: 0 })

/** 這份能力有沒有填 AP 加成（三格任一非 0） */
export function hasApBonus(a: Pick<NeuralDriveAbility, 'apBonus'> | undefined): boolean {
  return AP_KEYS.some((k) => (a?.apBonus?.[k] ?? 0) !== 0)
}

/**
 * 機師全部神經驅動等級的 AP 加成總和。
 * 查不到的能力（集合未載入／abilityId 斷鏈）與舊的嵌入格式都算 0——不回退去掃文字。
 */
export function sumNdApBonus(
  neuralDrive: readonly NeuralDrive[] | undefined,
  abilityMap: Map<string, NeuralDriveAbility>,
): PilotAp {
  const sum = zeroAp()
  for (const zone of neuralDrive ?? []) {
    for (const lv of zone.levels ?? []) {
      const b = resolveNeuralDriveLevel(lv, abilityMap).apBonus
      if (!b) continue
      for (const k of AP_KEYS) sum[k] += b[k] ?? 0
    }
  }
  return sum
}

/**
 * 說明文字**看起來**在講 AP 數值加成——只給後台當提示（「要不要填 apBonus？」），**不拿來算**。
 * 條件式的也會中，所以提示的語氣是「永久、自身的才填」。
 */
export function mentionsApBonus(description: string | undefined): boolean {
  return /AP的?(初始|上限|回[復覆])[值量]?\s*\+\s*\d/.test(description ?? '')
}
