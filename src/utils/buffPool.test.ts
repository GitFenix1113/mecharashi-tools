// PLAN-019-B：配裝反向索引單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBuffPool, runSpec, type BuffPoolInput, type BuffSource } from './buffPool.ts'
import { SPECS } from './entityRefs.ts'
import type { Pilot, Module, Weapon, Backpack, BackpackSkillDoc, PilotSkillDoc, NeuralDriveAbility } from '../types'

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

// ─── PLAN-034 D-2：buffUpgrades 不得被當成「賦予」掃進池子 ──────────────────────
//
// 這組測試**刻意直接對 runSpec 斷言**，不繞 buildBuffPool。理由：實測 buildBuffPool
// 只跑 pilots / pilotSkills / modules / weapons / backpacks，從不 traverse
// SPECS.neuralDriveAbilities —— 繞它寫的斷言會因為「測到一條本來就沒被走過的路徑」
// 而恆綠、零資訊量。等哪天有人補上對 neuralDriveAbilities 的 runSpec（該檔 TODO 已預告），
// 保護必須當場就在，而不是那時才發現沒有。

test('runSpec：excludeFromPool 的站點被略過，buffUpgrades 不進池（red-case 見下一則）', () => {
  const ability = {
    id: 'nd_雙生星芒2', name: '雙生星芒2',
    buffIds: [],
    buffUpgrades: ['buff_凝勢@2'],   // 「升階」語意：凝勢已經在了，只是變成第 2 階
  } as unknown as NeuralDriveAbility

  const out: BuffSource[] = []
  runSpec(out, SPECS.neuralDriveAbilities, ability)
  assert.deepEqual(out, [], 'buffUpgrades 被收進池子 → 模擬器會誤判「凝勢Ⅱ 可達」')
})

test('runSpec red-case：拿掉 excludeFromPool，同一份資料就會漏進池子', () => {
  // 先證明上一則不是恆綠：把站點的 excludeFromPool 拆掉後，同樣的輸入必須「變紅」。
  // 沒有這一則的話，哪天 runSpec 的略過邏輯被改壞，上面那則仍會通過（因為輸出本來就是空的）。
  const ability = {
    id: 'nd_雙生星芒2', name: '雙生星芒2',
    buffIds: [],
    buffUpgrades: ['buff_凝勢@2'],
  } as unknown as NeuralDriveAbility

  const spec = SPECS.neuralDriveAbilities
  const unguarded = {
    ...spec,
    buffIdSites: spec.buffIdSites.map((s) => ({ ...s, excludeFromPool: false })),
  }

  const out: BuffSource[] = []
  runSpec(out, unguarded, ability)
  assert.deepEqual(out, [{ buffId: 'buff_凝勢', level: 2, origin: '神驅升階:雙生星芒2' }],
    '拆掉守衛後仍是空的 → 代表這條路徑根本沒被走到，上一則測試沒有意義')
})

test('runSpec：同一份 spec 的一般 buffIds 站點照常收（略過是逐站點、不是整份 spec）', () => {
  const ability = {
    id: 'nd_x', name: 'X',
    buffIds: ['buff_賦予的東西'],
    buffUpgrades: ['buff_凝勢@2'],
  } as unknown as NeuralDriveAbility

  const out: BuffSource[] = []
  runSpec(out, SPECS.neuralDriveAbilities, ability)
  assert.deepEqual(out, [{ buffId: 'buff_賦予的東西', level: undefined, origin: '神驅能力:X' }])
})

// ─── PLAN-043：背包掛載技能（等級解析）────────────────────────────────────────

test('背包掛載技能：只算掛的那一級，不可把所有等級倒進池子', () => {
  const backpack = { id: 'bp1', name: '移動背包', skillIds: ['bpskill_移動強化@1'] } as unknown as Backpack
  const skills = [{
    id: 'bpskill_移動強化', name: '移動強化', skillType: '被動技能', description: '', effects: [],
    buffIds: ['buff_父層'],
    levels: [
      { level: 1, name: '移動強化Ⅰ', buffIds: ['buff_一'] },
      { level: 2, name: '移動強化Ⅱ', buffIds: ['buff_二'] },
    ],
  }] as unknown as BackpackSkillDoc[]

  const pool = buildBuffPool({ backpack, backpackSkills: skills })
  // 若改用 runSpec(SPECS.backpackSkills, doc)，這裡會多出 buff_父層 與 buff_二 ——
  // 掛 Lv1 的背包拿到 Lv2 的 buff，而且不報錯，只是模擬結果偏高。
  assert.deepEqual(pool, [{ buffId: 'buff_一', level: undefined, origin: '背包技能:移動強化 Lv1' }])
})

test('背包掛載技能：未指定級 → 用技能頂層 buffIds', () => {
  const backpack = { id: 'bp1', name: 'B', skillIds: ['bpskill_x'] } as unknown as Backpack
  const skills = [{
    id: 'bpskill_x', name: 'X', skillType: '被動技能', description: '', effects: [], buffIds: ['buff_頂層@3'],
  }] as unknown as BackpackSkillDoc[]
  const pool = buildBuffPool({ backpack, backpackSkills: skills })
  assert.deepEqual(pool, [{ buffId: 'buff_頂層', level: 3, origin: '背包技能:X' }])
})

test('背包掛載技能：未提供字典時只取舊的內嵌 mainSkill（過渡期行為不變）', () => {
  const backpack = {
    id: 'bp1', name: '能源背包', skillIds: ['bpskill_x'], mainSkill: { buffIds: ['buff_充能'] },
  } as unknown as Backpack
  const pool = buildBuffPool({ backpack })
  assert.deepEqual(pool.map(p => p.buffId), ['buff_充能'])
})

test('背包掛載技能：斷鏈的 id 靜默略過，不產生空來源', () => {
  const backpack = { id: 'bp1', name: 'B', skillIds: ['bpskill_不存在'] } as unknown as Backpack
  const skills = [{ id: 'bpskill_x', name: 'X', skillType: '被動技能', description: '', effects: [], buffIds: ['buff_a'] }] as unknown as BackpackSkillDoc[]
  assert.deepEqual(buildBuffPool({ backpack, backpackSkills: skills }), [])
})
