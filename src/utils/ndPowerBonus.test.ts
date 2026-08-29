// PLAN-052-M：模組給的神經驅動算力加成（ndPowerBonus / effectiveNdLevels）
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這一組釘的是三件「錯了不會報錯」的事：
//   ① 落點挑錯區（官方只說「最低的」，平手規則是實機測出來的 —— 改一個比較符就靜默漂走）；
//   ② 觸發條件挑錯（沒到 LV.MAX 就給、或漏掉天生貢獻 ⇒ 疾嘯永遠觸發不了）；
//   ③ 「+3 ＝ +1 級」這個前提本身（它成立是因為全庫 minSum 間距都是 3，不是定義）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Module, NeuralDrive } from '../types/index.ts'
import { ModuleSlot } from '../types/enums.ts'
import type { ModuleStack } from './moduleRules.ts'
import { moduleFamilyKey } from './moduleRules.ts'
import { ndPowerBonus, effectiveNdLevels, ND_POWER_MODULES } from './ndPowerBonus.ts'

// ─── fixtures ───────────────────────────────────────────────────────────────

/** 實測全庫兩種形狀：γ 一律 6 級 [1,4,7,10,13,16]、α／β 一律 3 級 [1,4,7]。 */
const zone = (name: string, minSums: number[]): NeuralDrive =>
  ({ name, icon: '', slots: [], levels: minSums.map((minSum, i) => ({ level: i + 1, minSum })) }) as unknown as NeuralDrive

const γ = (name: string) => zone(name, [1, 4, 7, 10, 13, 16])
const αβ = (name: string) => zone(name, [1, 4, 7])

/** 79 位的形狀 */
const PAIR = [αβ('α'), αβ('β'), γ('γ1'), γ('γ2')]
/** 10 位 1.0 老角的形狀：單一個 γ 區 */
const SOLO = [αβ('α'), αβ('β'), γ('γ')]

const mod = (id: string, name: string, levels: number, slot: ModuleSlot = ModuleSlot.SLOT_8): Module =>
  ({ id, name, slot, levels: Array.from({ length: levels }, (_, i) => ({ level: i + 1 })) }) as unknown as Module

const 強擊模組 = mod('mod_3041', '強擊模組', 8)
const 觀星者單元 = mod('mod_星夜女神_fixed_1', '觀星者單元', 2, ModuleSlot.EXCLUSIVE)
const 一般模組 = mod('mod_3001', '攻堅模組', 8)

/** 一份 `ctx.stacks`：`level` 給多少就是多少（本支不重算堆疊）。 */
const stacksOf = (...entries: [Module, number][]): Map<string, ModuleStack> =>
  new Map(entries.map(([m, level]) => [moduleFamilyKey(m), {
    mod: m, positions: [], sum: 0, innatePositions: [], innateSum: 0,
    cap: m.levels?.length ?? 0, level, overflow: 0,
  } as ModuleStack]))

/** 疾嘯那種情況：強擊模組靠天生湊到 8 ＝ LV.MAX */
const 滿級強擊 = stacksOf([強擊模組, 8])

// ─── 觸發條件 ───────────────────────────────────────────────────────────────

test('沒有任何加成模組 → null（絕大多數配裝走這條）', () => {
  assert.equal(ndPowerBonus(PAIR, { 'γ1': 6, 'γ2': 3 }, stacksOf([一般模組, 8])), null)
})

test('加成模組沒到 LV.MAX 就不給 —— 那句話只寫在最高階', () => {
  assert.equal(ndPowerBonus(PAIR, { 'γ1': 6, 'γ2': 3 }, stacksOf([強擊模組, 7])), null)
  assert.notEqual(ndPowerBonus(PAIR, { 'γ1': 6, 'γ2': 3 }, stacksOf([強擊模組, 8])), null)
})

test('解鎖條件不成立時不給（觀星者單元限曜駕駛）', () => {
  const stacks = stacksOf([觀星者單元, 2])
  const blocked = new Map([[moduleFamilyKey(觀星者單元), { kind: 'pilotOnly' }]])
  assert.equal(ndPowerBonus(PAIR, { 'γ1': 6, 'γ2': 3 }, stacks, blocked), null)
  assert.notEqual(ndPowerBonus(PAIR, { 'γ1': 6, 'γ2': 3 }, stacks, new Map()), null)
})

// ─── 落點 ───────────────────────────────────────────────────────────────────

test('加在算力較低的那一個 γ 區（16 ＋ 7 → γ2 拿到，變成 10）', () => {
  const b = ndPowerBonus(PAIR, { 'α': 3, 'β': 3, 'γ1': 6, 'γ2': 3 }, 滿級強擊)!
  assert.equal(b.zone, 'γ2')
  assert.equal(b.fromLevel, 3)
  assert.equal(b.level, 4)
  assert.equal(b.power, 10)
  assert.equal(b.moduleName, '強擊模組')
})

test('★ 平手時加在 γ1（使用者實機確認，官方文案沒講）', () => {
  const b = ndPowerBonus(PAIR, { 'α': 3, 'β': 3, 'γ1': 4, 'γ2': 4 }, 滿級強擊)!
  assert.equal(b.zone, 'γ1')
  assert.equal(b.level, 5)
})

test('α／β 恆滿級 ⇒ 永遠不會是落點，即使它們的算力（7）比 γ 低', () => {
  // γ1 13 ／ γ2 10：兩個 γ 都比 α／β 的 7 高，落點仍然是 γ2
  const b = ndPowerBonus(PAIR, { 'α': 3, 'β': 3, 'γ1': 5, 'γ2': 4 }, 滿級強擊)!
  assert.equal(b.zone, 'γ2')
  assert.equal(b.power, 13)
})

test('這就是會突破 23 的那一種：投入 23（16＋7）→ 生效 26（16＋10）', () => {
  const levels = { 'α': 3, 'β': 3, 'γ1': 6, 'γ2': 3 }
  const b = ndPowerBonus(PAIR, levels, 滿級強擊)!
  const eff = effectiveNdLevels(levels, b)
  const power = (name: string, lv: number) => PAIR.find(d => d.name === name)!.levels[lv - 1].minSum
  assert.equal(power('γ1', levels['γ1']) + power('γ2', levels['γ2']), 23)   // 投入
  assert.equal(power('γ1', eff['γ1']) + power('γ2', eff['γ2']), 26)          // 生效
})

test('γ 區全滿級時回一筆「沒有落點」的加成，而不是 null —— 圖上要講得出來', () => {
  // 單一 γ 區的老角：γ 點到 Lv6（算力 16，仍在 23 的預算內）⇒ 這 3 點沒地方去
  const b = ndPowerBonus(SOLO, { 'α': 3, 'β': 3, 'γ': 6 }, 滿級強擊)!
  assert.equal(b.zone, null)
  assert.equal(b.amount, 3)
  assert.equal(b.moduleName, '強擊模組')
})

test('單一 γ 區沒點滿時照樣加得上去', () => {
  const b = ndPowerBonus(SOLO, { 'α': 3, 'β': 3, 'γ': 5 }, 滿級強擊)!
  assert.equal(b.zone, 'γ')
  assert.equal(b.level, 6)
  assert.equal(b.power, 16)
})

// ─── 疊加 ───────────────────────────────────────────────────────────────────

test('effectiveNdLevels 只動落點那一區，其餘原樣', () => {
  const levels = { 'α': 3, 'β': 3, 'γ1': 6, 'γ2': 3 }
  const b = ndPowerBonus(PAIR, levels, 滿級強擊)
  assert.deepEqual(effectiveNdLevels(levels, b), { 'α': 3, 'β': 3, 'γ1': 6, 'γ2': 4 })
  // 原本那份不可被改動 —— 它是「玩家投入」，γ 預算閘門還要讀它
  assert.equal(levels['γ2'], 3)
})

test('沒有加成時原樣回傳同一個物件（下游 memo 靠參考相等）', () => {
  const levels = { 'γ1': 6, 'γ2': 3 }
  assert.equal(effectiveNdLevels(levels, null), levels)
  // 有加成但沒有落點時同理
  const wasted = ndPowerBonus(SOLO, { 'γ': 6 }, 滿級強擊)
  assert.equal(effectiveNdLevels(levels, wasted), levels)
})

// ─── 守門：本支成立的兩個資料前提 ───────────────────────────────────────────

test('守門：加成模組名單只有兩顆 —— 新增時要有人來改這裡', () => {
  // 2026-08-30 直讀正式庫：241 顆模組裡敘述提到算力／神經驅動／分區的就這兩顆。
  // 這條紅了代表有人加了第三顆而沒補說明，或誰手滑刪了一顆。
  assert.deepEqual(Object.keys(ND_POWER_MODULES).sort(), ['mod_3041', 'mod_星夜女神_fixed_1'])
  assert.equal(new Set(Object.values(ND_POWER_MODULES)).size, 1, '今天全部都是 +3')
})

test('守門：「+3 ＝ 恰好一級」的前提是 minSum 間距為 3', () => {
  // 實測 89 位機師、346 個分區，相鄰 minSum 間距**一律 3**，零例外。
  // 官方哪天改掉間距，這條會紅 —— 而 ndPowerBonus 本身用查表法，屆時仍然算得對。
  for (const d of [...PAIR, ...SOLO]) {
    const ms = d.levels.map(l => l.minSum)
    for (let i = 1; i < ms.length; i++) assert.equal(ms[i] - ms[i - 1], 3, `${d.name} Lv${i + 1}`)
  }
})
