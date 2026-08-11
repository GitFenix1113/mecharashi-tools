// PLAN-019-B：可達 buff 收斂單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveReachable } from './reachableBuffs.ts'
import type { BuffSource } from './buffPool.ts'
import type { GameBuff } from '../types'

// buff fixture 工廠：只填收斂會讀到的欄位
function buff(id: string, opts: Partial<GameBuff> = {}): GameBuff {
  return { id, name: id, description: '', buffType: 'state', effects: [], ...opts }
}

// PLAN-041：形態互斥（mutexGroup / FormGroup）已移除，相關 fixture 與測試一併刪除。
// 該引擎實測全庫 0 筆資料使用過，從上線到刪除為止算出來的永遠是 0 組。
const buffMap = new Map<string, GameBuff>([
  ['buff_凝勢', buff('buff_凝勢', { levels: [{ level: 1, effects: [] }, { level: 3, effects: [] }] })],
  ['buff_過載', buff('buff_過載')],
])

test('resolveReachable：同 buffId 多 level → 取最高、合併來源', () => {
  const pool: BuffSource[] = [
    { buffId: 'buff_凝勢', level: 1, origin: '神經驅動:γ2' },
    { buffId: 'buff_凝勢', level: 3, origin: '神經驅動:γ2' },
    { buffId: 'buff_凝勢', level: 2, origin: '天賦:某天賦' },
  ]
  const { fixed } = resolveReachable(pool, buffMap)
  assert.equal(fixed.length, 1)
  assert.equal(fixed[0].level, 3) // 取最高
  // 來源去重後保留兩個不同 origin
  assert.deepEqual(fixed[0].origins.sort(), ['天賦:某天賦', '神經驅動:γ2'])
})

test('resolveReachable：裸 id 與 @N 混用，未指定級視為最低', () => {
  const pool: BuffSource[] = [
    { buffId: 'buff_凝勢', origin: 'a' },          // 無 level → rank 0
    { buffId: 'buff_凝勢', level: 2, origin: 'b' }, // rank 2 勝出
  ]
  const { fixed } = resolveReachable(pool, buffMap)
  assert.equal(fixed[0].level, 2)
})

test('resolveReachable：多個不同 buff 各自收斂、互不干擾', () => {
  const pool: BuffSource[] = [
    { buffId: 'buff_凝勢', level: 3, origin: '神驅' },
    { buffId: 'buff_凝勢', level: 1, origin: '天賦' },
    { buffId: 'buff_過載', origin: '武器' },
  ]
  const { fixed } = resolveReachable(pool, buffMap)
  assert.deepEqual(fixed.map(f => f.buff.id).sort(), ['buff_凝勢', 'buff_過載'])
  assert.equal(fixed.find(f => f.buff.id === 'buff_凝勢')?.level, 3)
})

test('resolveReachable：查無 GameBuff → 進 unresolved（優雅降級）', () => {
  const pool: BuffSource[] = [
    { buffId: 'buff_不存在', origin: '某處' },
    { buffId: 'buff_過載', origin: '武器' },
  ]
  const { fixed, unresolved } = resolveReachable(pool, buffMap)
  assert.equal(fixed.length, 1)
  assert.equal(unresolved.length, 1)
  assert.equal(unresolved[0].buffId, 'buff_不存在')
})
