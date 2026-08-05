// PLAN-034 D-1：升階家族引用點稽核單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditNdUpgradeRefs, formatNdUpgradeViolations } from './ndUpgradeAudit.ts'
import { ALL_SCAN_COLLECTIONS, type RefScanData } from './entityRefs.ts'
import type { NeuralDriveAbility, PilotSkillDoc } from '../types'

const ABILITIES = [
  { id: 'nd_雙生星芒2', name: '雙生星芒2', description: '', effects: [], buffIds: [], buffUpgrades: ['buff_凝勢@2'] },
] as unknown as NeuralDriveAbility[]

const skill = (id: string, refs: Record<string, unknown>) => ({
  id, name: id, type: '主動技能', description: `[x]`, icon: '', iconLocal: '',
  effects: [], buffIds: [], descriptionRefs: refs,
}) as unknown as PilotSkillDoc

/**
 * 補齊所有集合，避免 missingColls 讓結果變成「未完整掃描」。
 *
 * 清單自 ALL_SCAN_COLLECTIONS 導出而非手寫：手寫版在 PLAN-043 新增 backpackSkills 時
 * 悄悄腐化——本檔每個斷言都改測到「未完整掃描」那條分支，卻仍是綠的（只有一個
 * 恰好比對訊息字串的測試紅了）。導出版新增集合時自動跟上。
 */
const scanData = (over: Partial<RefScanData>): RefScanData => {
  const full: Record<string, unknown[]> = {}
  for (const c of ALL_SCAN_COLLECTIONS) full[c] = []
  return { ...full, ...over } as RefScanData
}

test('稽核：指向升階家族卻 level / fixedLevel 皆空 → 違規', () => {
  const r = auditNdUpgradeRefs(scanData({
    neuralDriveAbilities: ABILITIES,
    pilotSkills: [skill('skill_破勢', { 凝勢Ⅰ: { refType: 'buff', refId: 'buff_凝勢' } })],
  }))
  assert.equal(r.violations.length, 1)
  assert.equal(r.violations[0].buffId, 'buff_凝勢')
  assert.equal(r.violations[0].docId, 'skill_破勢')
  assert.equal(r.violations[0].matched, '凝勢Ⅰ')
  assert.equal(r.violations[0].declaredBy, 'nd_雙生星芒2')
})

test('稽核：填了 level 或 fixedLevel 皆算合規（二選一，不必兩者都有）', () => {
  const r = auditNdUpgradeRefs(scanData({
    neuralDriveAbilities: ABILITIES,
    pilotSkills: [
      skill('skill_有level', { 凝勢Ⅰ: { refType: 'buff', refId: 'buff_凝勢', level: 1 } }),
      skill('skill_有釘死', { 凝勢Ⅰ: { refType: 'buff', refId: 'buff_凝勢', fixedLevel: true } }),
    ],
  }))
  assert.deepEqual(r.violations, [])
  assert.deepEqual(r.upgradedBuffIds, ['buff_凝勢'])
})

test('稽核：沒有升階宣告的家族不受管（只有 buffUpgrades 指到的才適用）', () => {
  const r = auditNdUpgradeRefs(scanData({
    neuralDriveAbilities: ABILITIES,
    // 指向別的家族、沒填 level —— 不在規則範圍內
    pilotSkills: [skill('skill_無關', { 幹勁: { refType: 'buff', refId: 'BUFF_幹勁' } })],
  }))
  assert.deepEqual(r.violations, [])
})

test('稽核：term 引用不算違規（覆寫以 buffId 為 key，term chip 不加階名）', () => {
  const r = auditNdUpgradeRefs(scanData({
    neuralDriveAbilities: ABILITIES,
    // 實測艾達天賦同時有 [凝勢]→term_凝勢 與 [凝勢Ⅰ]→buff_凝勢
    pilotSkills: [skill('skill_term', { 凝勢: { refType: 'term', refId: 'term_凝勢' } })],
  }))
  assert.deepEqual(r.violations, [])
})

test('稽核：neuralDriveAbilities 未載入 → 回報 missingColls，不得被讀成「零違規」', () => {
  const r = auditNdUpgradeRefs({ pilotSkills: [] })
  assert.deepEqual(r.violations, [])
  assert.deepEqual(r.missingColls, ['neuralDriveAbilities'])
  assert.match(formatNdUpgradeViolations(r), /未完整掃描/)
})

test('稽核：部分集合未載入時，摘要必須說「無法判定」而不是「通過」', () => {
  const r = auditNdUpgradeRefs({ neuralDriveAbilities: ABILITIES, pilotSkills: [] })
  assert.ok(r.missingColls.length > 0)
  assert.match(formatNdUpgradeViolations(r), /未完整掃描/)
})

test('formatNdUpgradeViolations：全數合規與尚無宣告是兩種不同訊息', () => {
  const ok = auditNdUpgradeRefs(scanData({
    neuralDriveAbilities: ABILITIES,
    pilotSkills: [skill('s', { 凝勢Ⅰ: { refType: 'buff', refId: 'buff_凝勢', level: 1 } })],
  }))
  assert.match(formatNdUpgradeViolations(ok), /皆已指定/)

  const none = auditNdUpgradeRefs(scanData({ neuralDriveAbilities: [] }))
  assert.match(formatNdUpgradeViolations(none), /尚無任何 buffUpgrades 宣告/)
})
