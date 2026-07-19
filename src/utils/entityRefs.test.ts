// PLAN-030 C-1/C-6：全站引用站點掃描器單元測試
//   npm test   →   node --test "src/**/*.test.ts"
//
// 為什麼這個檔案特別重要：實測正式資料顯示 buffIds 幾乎全空（705 份 pilotSkills 僅 1 份非空）、
// 全站 @N 等級後綴 0 個實例、pilots.skills[] 已 100% flip 成字串（嵌入分支是死碼）。
// 意即 F-4 整合測試**永遠踩不到**這幾條路徑——單元測試是唯一防線。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  findReferences, SPECS, ALL_SCAN_COLLECTIONS, REF_TYPE_OF,
  type RefScanData,
} from './entityRefs.ts'
import { buildBuffPool } from './buffPool.ts'
import { resolvePilotSkills } from './pilotSkills.ts'
import type { Pilot, PilotSkillDoc, GameBuff, Module, Weapon, Backpack } from '../types'

const asPilot = (o: unknown) => o as unknown as Pilot
const asBuff = (o: unknown) => o as unknown as GameBuff

/** 只給指定集合、其餘視為「已載入且為空」，避免 missingColls 干擾斷言 */
function scanData(partial: RefScanData): RefScanData {
  const full: Record<string, unknown[]> = {}
  for (const c of ALL_SCAN_COLLECTIONS) full[c] = []
  return { ...full, ...partial } as RefScanData
}

// ─── A. registry 完整性 ──────────────────────────────────────────────────────

test('A1: 所有 site.id 全域唯一（跨 spec 不重複）', () => {
  const ids: string[] = []
  for (const spec of Object.values(SPECS)) {
    for (const s of spec.buffIdSites) ids.push(s.id)
    for (const s of spec.scalarSites) ids.push(s.id)
    for (const s of spec.softSites) ids.push(s.id)
  }
  assert.equal(new Set(ids).size, ids.length, `重複的 site.id：${ids.filter((v, i) => ids.indexOf(v) !== i)}`)
})

test('A2: 集合清單與預期一致（新增集合未註冊時此測試會紅）', () => {
  assert.deepEqual([...ALL_SCAN_COLLECTIONS].sort(), [
    'backpacks', 'buffs', 'components', 'glossaryTerms', 'modules',
    'neuralDriveAbilities', 'pilotSkills', 'pilots', 'weapons',
  ])
})

test('A3: 每個 spec 的 coll 與 registry key 相符', () => {
  for (const [key, spec] of Object.entries(SPECS)) assert.equal(spec.coll, key)
})

// ─── B. @N 地雷（真實資料 0 實例，只有此處守得住）──────────────────────────

test('B1: buffIds 帶 @N 後綴仍被命中，且 value 保留原始字串', () => {
  const pilot = asPilot({
    name: '測試', talents: [{ name: '天賦A', buffIds: ['buff_傷害提升@3'] }],
  })
  const r = findReferences('buff', 'buff_傷害提升', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.equal(r.hits.length, 1)
  const h = r.hits[0]
  // value 必須是原始含 @N 字串——Firestore arrayRemove 要求元素完全相等，
  // 存拆解後的 'buff_傷害提升' 會移除失敗且**靜默無錯**
  assert.equal(h.value, 'buff_傷害提升@3')
  assert.equal(h.level, 3)
  assert.equal(h.op, 'arrayRemove')
  assert.equal(h.path, 'talents.0.buffIds')
})

test('B2: 不誤傷相似 id（前綴相同 / 非數字尾綴）', () => {
  const pilot = asPilot({
    name: '測試',
    talents: [{ name: 'A', buffIds: ['buff_傷害提升強化', 'buff_傷害', 'buff_傷害提升@x'] }],
  })
  const r = findReferences('buff', 'buff_傷害提升', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.equal(r.hits.length, 0)
})

test('B3: 舊式羅馬分級 id 不誤拆（buff_凝勢I ≠ buff_凝勢）', () => {
  const pilot = asPilot({ name: '測試', talents: [{ name: 'A', buffIds: ['buff_凝勢I'] }] })
  const r = findReferences('buff', 'buff_凝勢', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.equal(r.hits.length, 0)
})

test('B4: 同陣列多個等級 → 兩筆獨立 hit，path 同、value 不同', () => {
  const pilot = asPilot({ name: '測試', talents: [{ name: 'A', buffIds: ['buff_x@1', 'buff_x@3'] }] })
  const r = findReferences('buff', 'buff_x', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.equal(r.hits.length, 2)
  assert.deepEqual(r.hits.map(h => h.path), ['talents.0.buffIds', 'talents.0.buffIds'])
  assert.deepEqual(r.hits.map(h => h.value), ['buff_x@1', 'buff_x@3'])
  assert.deepEqual(r.hits.map(h => h.level), [1, 3])
})

// ─── C. 聯合型別地雷（seed 已 100% flip，嵌入分支是死碼）────────────────────

test('C1: skills[] 混合字串與嵌入物件，兩種形態各自命中且不拋錯', () => {
  const pilot = asPilot({
    name: '測試',
    skills: ['skill_a', { name: '嵌入技', buffIds: ['buff_z'], description: '含[凝勢]' }],
  })
  const data = scanData({ pilots: [{ ...pilot, id: 'p1' } as never] })

  const bySkill = findReferences('pilotSkill', 'skill_a', data)
  assert.equal(bySkill.hits.length, 1)
  assert.equal(bySkill.hits[0].path, 'skills.0')
  assert.equal(bySkill.hits[0].op, 'arrayRemove')
  assert.equal(bySkill.hits[0].value, 'skill_a')

  const byBuff = findReferences('buff', 'buff_z', data)
  assert.equal(byBuff.hits.length, 1)
  assert.equal(byBuff.hits[0].path, 'skills.1.buffIds')
})

test('C2: 純字串 skills 不會被當物件讀取（不產生 undefined 站點、不拋錯）', () => {
  const pilot = asPilot({ name: '測試', skills: ['skill_a', 'skill_b'] })
  const data = scanData({ pilots: [{ ...pilot, id: 'p1' } as never] })
  assert.doesNotThrow(() => findReferences('buff', 'buff_x', data))
  assert.equal(findReferences('buff', 'buff_x', data).hits.length, 0)
})

// ─── D. descriptionRefs 與型別映射（地雷 a：kind ≠ refType）──────────────────

test('D0: REF_TYPE_OF 映射正確（pilotSkill→skill、glossaryTerm→term）', () => {
  assert.deepEqual(REF_TYPE_OF, { buff: 'buff', pilotSkill: 'skill', glossaryTerm: 'term' })
})

test('D1: 找技能引用要比對 refType==="skill" 而非 "pilotSkill"', () => {
  const pilot = asPilot({
    name: '測試',
    talents: [{ name: 'A', description: '見[爆發]', descriptionRefs: { 爆發: { refType: 'skill', refId: 'skill_x' } } }],
  })
  const r = findReferences('pilotSkill', 'skill_x', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  // 若掃描器誤用 kind 直接比對 refType，這裡會是 0
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].op, 'mapKeyDelete')
})

test('D2: 找詞條引用要比對 refType==="term"', () => {
  const pilot = asPilot({
    name: '測試',
    talents: [{ name: 'A', description: '[固傷]', descriptionRefs: { 固傷: { refType: 'term', refId: 'term_固定傷害' } } }],
  })
  const r = findReferences('glossaryTerm', 'term_固定傷害', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.equal(r.hits.length, 1)
})

test('D3: 同 refId 不同 refType 不誤中', () => {
  const pilot = asPilot({
    name: '測試',
    talents: [{ name: 'A', description: '[凝勢]', descriptionRefs: { 凝勢: { refType: 'buff', refId: '凝勢' } } }],
  })
  const r = findReferences('glossaryTerm', '凝勢', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.equal(r.hits.length, 0)
})

test('D4: segments 是權威路徑——map key 含 "." 時 path.split 會拆錯（地雷 b）', () => {
  const pilot = asPilot({
    name: '測試',
    talents: [{ name: 'A', description: '[凝勢.Ⅰ]', descriptionRefs: { '凝勢.Ⅰ': { refType: 'buff', refId: 'buff_x' } } }],
  })
  const r = findReferences('buff', 'buff_x', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.equal(r.hits.length, 1)
  // segments 4 元素；path.split('.') 會得到 5 → C-2 只准用 segments
  assert.deepEqual(r.hits[0].segments, ['talents', 0, 'descriptionRefs', '凝勢.Ⅰ'])
  assert.equal(r.hits[0].segments.length, 4)
  assert.equal(r.hits[0].path.split('.').length, 5)
})

test('D5: value 是完整 EntityRef（含 label / level），非僅 refId', () => {
  const ref = { refType: 'buff' as const, refId: 'buff_x', label: '別名', level: 3 }
  const pilot = asPilot({ name: '測試', talents: [{ name: 'A', description: '[x]', descriptionRefs: { x: ref } }] })
  const r = findReferences('buff', 'buff_x', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.deepEqual(r.hits[0].value, ref)
  assert.equal(r.hits[0].level, 3)
})

test('D6: 雙層巢狀 ndVariants 的 descriptionRefs 有被掃到', () => {
  const pilot = asPilot({
    name: '測試',
    talents: [{
      name: 'A', description: 'x',
      ndVariants: [
        { minSum: 10, description: 'v0' },
        { minSum: 16, description: '[凝勢]', descriptionRefs: { 凝勢: { refType: 'buff', refId: 'buff_凝勢' } } },
      ],
    }],
  })
  const r = findReferences('buff', 'buff_凝勢', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].path, 'talents.0.ndVariants.1.descriptionRefs.凝勢')
  // refs 未填時前台會回退父層 → 需標記，對話框才不會誤判子項未受影響
  assert.equal(r.hits[0].inheritedFrom, 'talents.0')
})

// ─── E. numTokenText（文案內嵌 <id.lvN.attr>）──────────────────────────────

test('E1: 單欄位多 token → 1 筆 hit（非 2），value 為整段原文', () => {
  const text = '疊<buff_凝勢.lv3.maxStack>層，持續<buff_凝勢.duration>回合'
  const pilot = asPilot({ name: '測試', talents: [{ name: 'A', description: text }] })
  const r = findReferences('buff', 'buff_凝勢', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].op, 'textFreeze')
  // 逐 token 各發一筆會讓第二次凍結存到「已凍結」的字串 → 還原失真
  assert.equal(r.hits[0].value, text)
  assert.equal(r.hits[0].tokens?.length, 2)
})

test('E2: description 與 descriptionMax 各成一筆獨立 patch', () => {
  const pilot = asPilot({
    name: '測試',
    talents: [{ name: 'A', description: '<buff_x.maxStack>', descriptionMax: '<buff_x.duration>' }],
  })
  const r = findReferences('buff', 'buff_x', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.equal(r.hits.length, 2)
  assert.deepEqual(r.hits.map(h => h.path).sort(), ['talents.0.description', 'talents.0.descriptionMax'])
})

test('E3: 欄位名為 effect（非 description）的 token 有被掃到', () => {
  // 鎖住「以 /description/ 命名慣例掃描必漏」——NeuralDriveLevel 的正文欄位叫 effect
  const pilot = asPilot({
    name: '測試',
    neuralDrive: [{ name: 'γ2', levels: [{ level: 1, effect: '疊<buff_凝勢.lv1.maxStack>層' }] }],
  })
  const r = findReferences('buff', 'buff_凝勢', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].path, 'neuralDrive.0.levels.0.effect')
})

test('E4: token 指向他 buff → 0 hit', () => {
  const pilot = asPilot({ name: '測試', talents: [{ name: 'A', description: '<buff_other.maxStack>' }] })
  const r = findReferences('buff', 'buff_x', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.equal(r.hits.length, 0)
})

test('E5: 刪詞條時不會命中數值 token（NUM_ATTRS 的 refTypes 皆為 buff）', () => {
  const pilot = asPilot({ name: '測試', talents: [{ name: 'A', description: '<term_x.maxStack>' }] })
  const r = findReferences('glossaryTerm', 'term_x', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.equal(r.hits.filter(h => h.kind === 'numTokenText').length, 0)
})

// ─── F. scalarRef ───────────────────────────────────────────────────────────

test('F1: buffs.termRef → fieldClear', () => {
  const buff = asBuff({ name: '凝勢', description: '', effects: [], termRef: 'term_凝勢' })
  const r = findReferences('glossaryTerm', 'term_凝勢', scanData({ buffs: [{ ...buff, id: 'buff_凝勢' } as never] }))
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].op, 'fieldClear')
  assert.equal(r.hits[0].coll, 'buffs')
  assert.equal(r.hits[0].value, 'term_凝勢')
})

test('F2: termRef 未填 → 不產生空 patch', () => {
  const buff = asBuff({ name: 'x', description: '', effects: [] })
  const r = findReferences('glossaryTerm', 'term_凝勢', scanData({ buffs: [{ ...buff, id: 'b1' } as never] }))
  assert.equal(r.hits.length, 0)
})

// ─── G. 自我指涉與環 ────────────────────────────────────────────────────────

test('G1: buff 引用他 buff → 命中（級聯必須含 buffs 集合自身）', () => {
  const other = asBuff({
    name: '他', description: '[目標]', effects: [],
    descriptionRefs: { 目標: { refType: 'buff', refId: 'buff_target' } },
  })
  const r = findReferences('buff', 'buff_target', scanData({ buffs: [{ ...other, id: 'buff_other' } as never] }))
  assert.equal(r.hits.length, 1)
})

test('G2: 自我排除——目標自己的 descriptionRefs 指向自己時不產生 hit', () => {
  // 同一 WriteBatch 內對已 delete 的文件再 update 會把它復活成殘缺文件
  const self = asBuff({
    name: '自我', description: '[自己]', effects: [],
    descriptionRefs: { 自己: { refType: 'buff', refId: 'buff_self' } },
  })
  const r = findReferences('buff', 'buff_self', scanData({ buffs: [{ ...self, id: 'buff_self' } as never] }))
  assert.equal(r.hits.length, 0)
})

test('G3: 詞條互相引用成環 → 回傳有限、不遞迴爆棧', () => {
  const a = { id: 'term_a', name: 'A', description: '[B]', descriptionRefs: { B: { refType: 'term', refId: 'term_b' } } }
  const b = { id: 'term_b', name: 'B', description: '[A]', descriptionRefs: { A: { refType: 'term', refId: 'term_a' } } }
  const r = findReferences('glossaryTerm', 'term_a', scanData({ glossaryTerms: [a, b] as never }))
  assert.equal(r.hits.length, 1)          // 只有 b 引用 a；a 自己被排除
  assert.equal(r.hits[0].docId, 'term_b')
})

// ─── H. 未載入集合的安全性 ──────────────────────────────────────────────────

test('H1: 未提供的集合進 missingColls（對話框據此禁止顯示「無引用」）', () => {
  const r = findReferences('buff', 'buff_x', { pilots: [] })
  assert.ok(r.missingColls.length > 0)
  assert.ok(r.missingColls.includes('modules'))
  assert.ok(r.scannedColls.includes('pilots'))
})

test('H2: 已載入但為空的集合不進 missingColls', () => {
  const r = findReferences('buff', 'buff_x', scanData({}))
  assert.equal(r.missingColls.length, 0)
  assert.equal(r.scannedColls.length, ALL_SCAN_COLLECTIONS.length)
})

// ─── I. nameSoftRef（以名稱關聯，ID 型級聯修不了）──────────────────────────

test('I1: condition.hasBuff 命中 → 進 softWarnings，不進 hits', () => {
  const pilot = asPilot({
    name: '測試',
    talents: [{ name: 'A', effects: [{ stat: 'dmg', condition: { hasBuff: '凝勢' } }] }],
  })
  const buff = asBuff({ name: '凝勢', description: '', effects: [] })
  const r = findReferences('buff', 'buff_凝勢', scanData({
    pilots: [{ ...pilot, id: 'p1' } as never],
    buffs: [{ ...buff, id: 'buff_凝勢' } as never],
  }))
  assert.equal(r.hits.length, 0)
  assert.equal(r.softWarnings.length, 1)
  assert.equal(r.softWarnings[0].path, 'talents.0.effects.0.condition.hasBuff')
})

test('I2: 查不到目標名稱時不亂猜（softWarnings 為空）', () => {
  const pilot = asPilot({
    name: '測試',
    talents: [{ name: 'A', effects: [{ stat: 'dmg', condition: { hasBuff: '凝勢' } }] }],
  })
  // buffs 集合裡沒有 buff_凝勢 → 無從得知其 name
  const r = findReferences('buff', 'buff_凝勢', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.equal(r.softWarnings.length, 0)
})

// ─── J. buildBuffPool 行為不變回歸 ──────────────────────────────────────────

test('J1: pilot + resolved skills → 技能位置仍在天賦與神驅之間', () => {
  // 改寫最容易引入的回歸：把 skills 迴圈提到 pilot 區塊外會變成 天賦→神驅→技能
  const pilot = asPilot({
    name: '測試',
    talents: [{ name: '天賦A', buffIds: ['buff_t'] }],
    skills: ['skill_a'],
    neuralDrive: [{ name: 'γ2', levels: [{ level: 1, buffIds: ['buff_nd'] }] }],
  })
  const skills = [{ id: 'skill_a', name: '技能A', buffIds: ['buff_s'] }] as unknown as PilotSkillDoc[]
  const pool = buildBuffPool({ pilot, skills })
  assert.deepEqual(pool.map(p => p.buffId), ['buff_t', 'buff_s', 'buff_nd'])
  assert.deepEqual(pool.map(p => p.origin), ['天賦:天賦A', '技能:技能A', '神經驅動:γ2'])
})

test('J2: 嵌入技能不因提供 resolved skills 而雙計', () => {
  const embedded = { name: '嵌入技', buffIds: ['buff_z'] }
  const pilot = asPilot({ name: '測試', skills: [embedded] })
  const skillMap = new Map<string, PilotSkillDoc>()

  const withoutResolved = buildBuffPool({ pilot })
  assert.equal(withoutResolved.filter(p => p.buffId === 'buff_z').length, 1)

  const resolved = resolvePilotSkills(pilot.skills ?? [], skillMap)
  const withResolved = buildBuffPool({ pilot, skills: resolved })
  assert.equal(withResolved.filter(p => p.buffId === 'buff_z').length, 1, '嵌入技能被雙計')
})

test('J3: 無 pilot 時 skills 不產出（保留既有語意）', () => {
  const skills = [{ id: 'skill_a', name: '技能A', buffIds: ['buff_s'] }] as unknown as PilotSkillDoc[]
  assert.deepEqual(buildBuffPool({ skills }), [])
})

test('J4: 背包怪癖——origin 用 backpack.name 而非 mainSkill.name', () => {
  const backpack = { name: '能源背包', mainSkill: { name: '主技能', buffIds: ['buff_充能'] } } as unknown as Backpack
  const pool = buildBuffPool({ backpack })
  assert.equal(pool[0].origin, '背包:能源背包')
})

test('J5: 混合輸入的整體順序：天賦→技能→神驅→模組→武器技能→背包', () => {
  const pilot = asPilot({
    name: 'p',
    talents: [{ name: 'T', buffIds: ['b_t'] }],
    skills: [{ name: 'S', buffIds: ['b_s'] }],
    neuralDrive: [{ name: 'N', levels: [{ level: 1, buffIds: ['b_n'] }] }],
  })
  const modules = [{ name: 'M', buffIds: ['b_m'] }] as unknown as Module[]
  const weapon = { name: 'W', skills: [{ name: 'WS', buffIds: ['b_w'] }] } as unknown as Weapon
  const backpack = { name: 'B', mainSkill: { buffIds: ['b_b'] } } as unknown as Backpack
  const pool = buildBuffPool({ pilot, modules, weapon, backpack })
  assert.deepEqual(pool.map(p => p.buffId), ['b_t', 'b_s', 'b_n', 'b_m', 'b_w', 'b_b'])
})

// ─── K. 純函式契約 ──────────────────────────────────────────────────────────

test('K1: 同一輸入連呼叫兩次結果相同（無狀態污染）', () => {
  const pilot = asPilot({ name: '測試', talents: [{ name: 'A', buffIds: ['buff_x@2'] }] })
  const data = scanData({ pilots: [{ ...pilot, id: 'p1' } as never] })
  assert.deepEqual(findReferences('buff', 'buff_x', data), findReferences('buff', 'buff_x', data))
})

test('K2: findReferences 不改動輸入資料', () => {
  const pilot = asPilot({
    name: '測試',
    talents: [{ name: 'A', buffIds: ['buff_x'], description: '[x]', descriptionRefs: { x: { refType: 'buff', refId: 'buff_x' } } }],
  })
  const data = scanData({ pilots: [{ ...pilot, id: 'p1' } as never] })
  const before = JSON.stringify(data)
  findReferences('buff', 'buff_x', data)
  assert.equal(JSON.stringify(data), before)
})

test('K3: writeCount = hits + 1（目標本身的 deleteDoc），供 C-4 擋 batch 500 上限', () => {
  const pilot = asPilot({ name: '測試', talents: [{ name: 'A', buffIds: ['buff_x@1', 'buff_x@2'] }] })
  const r = findReferences('buff', 'buff_x', scanData({ pilots: [{ ...pilot, id: 'p1' } as never] }))
  assert.equal(r.hits.length, 2)
  assert.equal(r.writeCount, 3)
})
