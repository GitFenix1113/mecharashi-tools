// PLAN-019-B：配裝反向索引單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBuffPool, type BuffPoolInput } from './buffPool.ts'
import type { Pilot, Module, Weapon, Backpack, PilotSkillDoc } from '../types'

// 最小 fixture：只填 buildBuffPool 會讀到的欄位，其餘以 cast 略過
const pilot = {
  name: '海莉絲',
  talents: [{ name: '悖想先驅', buffIds: ['buff_虛粒子形態', 'buff_實粒子形態'] }],
  skills: [{ name: '粒子爆發', buffIds: ['buff_激發能@2'] }], // 嵌入物件
  neuralDrive: [
    { name: 'γ2', levels: [
      { buffIds: ['buff_凝勢@1'] },
      { buffIds: ['buff_凝勢@3'] }, // 多級，留待收斂取最高
    ] },
  ],
} as unknown as Pilot

test('buildBuffPool：收齊天賦/技能/神經驅動 buffIds 並拆 id@N', () => {
  const pool = buildBuffPool({ pilot })
  // 5 條：虛粒子、實粒子、激發能@2、凝勢@1、凝勢@3
  assert.equal(pool.length, 5)
  const 激發 = pool.find(p => p.buffId === 'buff_激發能')
  assert.deepEqual(激發, { buffId: 'buff_激發能', level: 2, origin: '技能:粒子爆發' })
  const 虛粒子 = pool.find(p => p.buffId === 'buff_虛粒子形態')
  assert.equal(虛粒子?.level, undefined)
  assert.equal(虛粒子?.origin, '天賦:悖想先驅')
})

test('buildBuffPool：模組/武器/武器技能/背包來源標註正確', () => {
  const modules = [{ name: '強襲核心', buffIds: ['buff_強襲'] }] as unknown as Module[]
  // 武器透過其技能（WeaponSkill）賦予 buff；Weapon 無頂層 buffIds
  const weapon = {
    name: '湮滅者',
    skills: [{ name: '貫穿', buffIds: ['buff_破甲'] }],
  } as unknown as Weapon
  const backpack = {
    name: '能源背包',
    mainSkill: { buffIds: ['buff_充能'] },
  } as unknown as Backpack

  const pool = buildBuffPool({ modules, weapon, backpack })
  assert.deepEqual(
    pool.map(p => [p.buffId, p.origin]),
    [
      ['buff_強襲', '模組:強襲核心'],
      ['buff_破甲', '武器技能:貫穿'],
      ['buff_充能', '背包:能源背包'],
    ],
  )
})

test('buildBuffPool：優先採已解析 skills，忽略 pilot.skills 的字串 ID', () => {
  const p = {
    name: 'x',
    talents: [],
    skills: ['skill_未解析字串ID'], // 未提供 skills 時應被略過
    neuralDrive: [],
  } as unknown as Pilot

  // 不傳 skills → 字串 ID 略過
  assert.equal(buildBuffPool({ pilot: p }).length, 0)

  // 傳已解析 skills → 採用之
  const skills = [{ name: '解析技能', buffIds: ['buff_a', 'buff_b'] }] as unknown as PilotSkillDoc[]
  const pool = buildBuffPool({ pilot: p, skills })
  assert.deepEqual(pool.map(s => s.buffId), ['buff_a', 'buff_b'])
  assert.equal(pool[0].origin, '技能:解析技能')
})

test('buildBuffPool：空配裝 / 缺欄位 → 空陣列，不丟錯', () => {
  assert.deepEqual(buildBuffPool({}), [])
  assert.deepEqual(buildBuffPool({ pilot: null, weapon: null, backpack: null } as BuffPoolInput), [])
})
