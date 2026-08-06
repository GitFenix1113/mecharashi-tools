// PLAN-030 C-2：級聯清除計算層單元測試
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這裡守的是「刪除會不會把資料改壞」。整欄改寫策略讓每次刪除都在重寫整個 talents /
// skills / neuralDrive 陣列，算錯一個索引就是靜默資料損毀，而且 changeHistory 的
// 修補單同時也會記錯 —— 連還原都救不回來。
//
// 正式資料現況（C-1 實測）：buffIds 幾乎全空、@N 零實例、pilots.skills[] 已全面
// flip 成字串。多數分支整合測試永遠踩不到，單元測試是唯一防線。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCascadePlan, createNumRefFreezer, checkCascadeSafety,
  FIRESTORE_BATCH_LIMIT, BATCH_OVERHEAD_OPS, SNAPSHOT_SIZE_BUDGET_BYTES,
  type CascadePlan,
} from './cascadePatch.ts'
import { findReferences, ALL_SCAN_COLLECTIONS, type RefHit, type RefScanData } from './entityRefs.ts'
import type { Pilot, GameBuff } from '../types'

const asPilot = (o: unknown) => o as unknown as Pilot
const asBuff = (o: unknown) => o as unknown as GameBuff

/** 只給指定集合、其餘視為「已載入且為空」（與 entityRefs.test.ts 同款） */
function scanData(partial: RefScanData): RefScanData {
  const full: Record<string, unknown[]> = {}
  for (const c of ALL_SCAN_COLLECTIONS) full[c] = []
  return { ...full, ...partial } as RefScanData
}

const pilotData = (p: object, id = 'p1') => scanData({ pilots: [{ ...asPilot(p), id } as never] })

// ─── M. 基本轉換 ─────────────────────────────────────────────────────────────

test('M1: buffIds 命中 → 改寫整個頂層 talents，並產出對應修補單', () => {
  const data = pilotData({
    name: '測試',
    talents: [{ name: '天賦A', buffIds: ['buff_x@3', 'buff_y'] }],
  })
  const { hits } = findReferences('buff', 'buff_x', data)
  const plan = buildCascadePlan(hits, data)

  assert.equal(plan.problems.length, 0)
  assert.equal(plan.mutations.length, 1)

  const m = plan.mutations[0]
  assert.equal(m.coll, 'pilots')
  assert.equal(m.docId, 'p1')
  // 只寫回被動到的頂層欄位，name 不該出現
  assert.deepEqual(Object.keys(m.set), ['talents'])
  assert.deepEqual(m.unset, [])
  assert.deepEqual((m.set.talents as { buffIds: string[] }[])[0].buffIds, ['buff_y'])

  assert.deepEqual(plan.patches, [{
    coll: 'pilots', docId: 'p1',
    segments: ['talents', 0, 'buffIds'],          // 權威形式，F-2 定位用
    path: 'talents.0.buffIds',                    // 顯示用
    op: 'arrayRemove', value: 'buff_x@3',
    anchor: { by: 'name', value: '天賦A' },       // 陣列被重排時據此重新定位
  }])
})

test('M2: 不改動輸入資料（copy-on-write）', () => {
  const data = pilotData({
    name: '測試',
    talents: [{ name: 'A', buffIds: ['buff_x'], descriptionRefs: { x: { refType: 'buff', refId: 'buff_x' } } }],
  })
  const before = JSON.stringify(data)
  buildCascadePlan(findReferences('buff', 'buff_x', data).hits, data)
  assert.equal(JSON.stringify(data), before)
})

test('M3: 未被觸及的頂層欄位不進 set（避免整份文件覆寫）', () => {
  const data = pilotData({
    name: '測試', lore: '簡介', rarity: 'SSR',
    talents: [{ name: 'A', buffIds: ['buff_x'] }],
    neuralDrive: [{ name: 'ND', levels: [{ level: 1, buffIds: ['buff_other'] }] }],
  })
  const plan = buildCascadePlan(findReferences('buff', 'buff_x', data).hits, data)
  assert.deepEqual(Object.keys(plan.mutations[0].set), ['talents'])
})

test('M4: 同一文件多處命中合併成單一 mutation；writeCount = 文件數 + 1', () => {
  const data = scanData({
    pilots: [{ ...asPilot({
      name: '測試',
      talents: [{ name: 'A', buffIds: ['buff_x'] }],
      neuralDrive: [{ name: 'ND', levels: [{ level: 1, buffIds: ['buff_x'] }] }],
    }), id: 'p1' } as never],
    buffs: [{ ...asBuff({ name: 'B', description: '[x]', descriptionRefs: { x: { refType: 'buff', refId: 'buff_x' } } }), id: 'b1' } as never],
  })
  const { hits } = findReferences('buff', 'buff_x', data)
  const plan = buildCascadePlan(hits, data)

  assert.equal(hits.length, 3)
  assert.equal(plan.mutations.length, 2)              // 兩份文件，不是三筆寫入
  assert.equal(plan.patches.length, 3)                // 修補單仍逐處記錄
  assert.equal(plan.writeCount, 3)                    // 2 份 update + 1 份 deleteDoc
  assert.equal(plan.mutations[0].appliedCount, 2)
})

// ─── N. arrayRemove 的兩種 segments 形狀（地雷 b）────────────────────────────

test('N1: pilots.skills[] 元素移除 —— 修補單 path 正規化為陣列本身', () => {
  const data = pilotData({ name: '測試', skills: ['skill_dead', 'skill_keep'] })
  const { hits } = findReferences('pilotSkill', 'skill_dead', data)
  assert.equal(hits[0].path, 'skills.0')              // hit 指向元素

  const plan = buildCascadePlan(hits, data)
  // 修補單指向陣列 —— F-2 要把元素加回「哪個陣列」，而非「哪個索引」（索引會位移）
  assert.equal(plan.patches[0].path, 'skills')
  assert.equal(plan.patches[0].value, 'skill_dead')
  assert.deepEqual(plan.mutations[0].set.skills, ['skill_keep'])
})

test('N2: @N 精確移除，不誤傷同 id 其他等級以外的元素', () => {
  const data = pilotData({ name: '測試', talents: [{ name: 'A', buffIds: ['buff_x@1', 'buff_x@2', 'buff_xy', 'buff_y'] }] })
  const plan = buildCascadePlan(findReferences('buff', 'buff_x', data).hits, data)
  assert.deepEqual((plan.mutations[0].set.talents as { buffIds: string[] }[])[0].buffIds, ['buff_xy', 'buff_y'])
  assert.equal(plan.patches.length, 2)
})

// ─── O. 索引錯位（地雷 a）——本檔案最重要的一組 ─────────────────────────────

test('O1: 陣列元素移除不會讓同文件其他 hit 打到錯的物件（且與 hits 順序無關）', () => {
  // skills[0] 是被刪技能的 ID 引用；skills[1] 是嵌入技能，其 descriptionRefs 也指向被刪技能。
  // 若邊解析邊套用：先移除 skills[0] → 嵌入技能位移到索引 0 → 針對 skills.1 的
  // mapKeyDelete 會落空（或在更長的陣列上刪到無辜的鄰居）。
  const build = () => pilotData({
    name: '測試',
    skills: [
      'skill_dead',
      { name: '嵌入', description: '[參照]', descriptionRefs: { 參照: { refType: 'skill', refId: 'skill_dead' } } },
    ],
  })

  const data = build()
  const { hits } = findReferences('pilotSkill', 'skill_dead', data)
  assert.equal(hits.length, 2)

  const expected = [{ name: '嵌入', description: '[參照]', descriptionRefs: {} }]

  const forward = buildCascadePlan(hits, data)
  assert.equal(forward.problems.length, 0)
  assert.deepEqual(forward.mutations[0].set.skills, expected)

  // 反序餵入：hits 的順序不是 C-2 的契約，結果必須一致
  const reversed = buildCascadePlan([...hits].reverse(), build())
  assert.equal(reversed.problems.length, 0)
  assert.deepEqual(reversed.mutations[0].set.skills, expected)
})

test('O2: 巢狀 buffIds 與外層陣列同時被改，兩者互不干擾', () => {
  const data = pilotData({
    name: '測試',
    skills: [
      { name: '嵌入', buffIds: ['buff_x'] },
      { name: '嵌入2', buffIds: ['buff_x', 'buff_keep'] },
    ],
  })
  const plan = buildCascadePlan(findReferences('buff', 'buff_x', data).hits, data)
  assert.deepEqual(plan.mutations[0].set.skills, [
    { name: '嵌入', buffIds: [] },                    // 清空後保留空陣列，不刪欄位
    { name: '嵌入2', buffIds: ['buff_keep'] },
  ])
})

// ─── P. mapKeyDelete / fieldClear ────────────────────────────────────────────

test('P1: descriptionRefs 的 key 含 "." 仍正確刪除（path 字串在此不可信）', () => {
  const data = pilotData({
    name: '測試',
    talents: [{
      name: 'A',
      description: '[凝勢.強化]',
      descriptionRefs: {
        '凝勢.強化': { refType: 'buff', refId: 'buff_x' },
        其他:       { refType: 'buff', refId: 'buff_z' },
      },
    }],
  })
  const plan = buildCascadePlan(findReferences('buff', 'buff_x', data).hits, data)
  const refs = (plan.mutations[0].set.talents as { descriptionRefs: Record<string, unknown> }[])[0].descriptionRefs
  assert.deepEqual(Object.keys(refs), ['其他'])
  // 修補單的 value 是完整 EntityRef 物件，F-2 才還原得回 label / level
  assert.deepEqual(plan.patches[0].value, { refType: 'buff', refId: 'buff_x' })
})

test('P2: 頂層純量欄位清除走 unset（C-4 轉 deleteField），不是寫入 undefined', () => {
  const data = scanData({
    buffs: [{ ...asBuff({ name: 'B', termRef: 'term_x' }), id: 'b1' } as never],
  })
  const plan = buildCascadePlan(findReferences('glossaryTerm', 'term_x', data).hits, data)
  assert.deepEqual(plan.mutations[0].set, {})
  assert.deepEqual(plan.mutations[0].unset, ['termRef'])
  // 頂層純量站點無錨可用（不在任何陣列裡，路徑天然穩定）→ 不帶 anchor 欄位
  assert.deepEqual(plan.patches[0], {
    coll: 'buffs', docId: 'b1', segments: ['termRef'], path: 'termRef', op: 'fieldClear', value: 'term_x',
  })
})

test('P3: 巢狀純量欄位清除 → 改寫其頂層欄位，不進 unset', () => {
  const data = pilotData({
    name: '測試',
    neuralDrive: [{ name: 'ND', levels: [{ level: 1, abilityId: 'nda_x' }] }],
  })
  // neuralDriveAbility 不在 ChangeTargetKind 內（C-1 已盤點、尚未開放刪除），手工造 hit
  const hit: RefHit = {
    coll: 'pilots', docId: 'p1', docName: '測試',
    siteId: 'pilots.neuralDrive[].levels[].abilityId', kind: 'scalarRef',
    segments: ['neuralDrive', 0, 'levels', 0, 'abilityId'],
    path: 'neuralDrive.0.levels.0.abilityId', origin: 'ND Lv1',
    op: 'fieldClear', value: 'nda_x',
  }
  const plan = buildCascadePlan([hit], data)
  assert.deepEqual(plan.mutations[0].set, { neuralDrive: [{ name: 'ND', levels: [{ level: 1 }] }] })
  assert.deepEqual(plan.mutations[0].unset, [])
})

// ─── Q. textFreeze 的 C-3 接縫 ───────────────────────────────────────────────

test('Q1: 未提供 freezeText 時遇到數值 token 必須拋錯，不得默默跳過', () => {
  const data = pilotData({
    name: '測試',
    talents: [{ name: 'A', description: '可疊加<buff_x.lv3.maxStack>層' }],
  })
  const { hits } = findReferences('buff', 'buff_x', data)
  assert.equal(hits[0].op, 'textFreeze')
  // 跳過 = token 指向已刪實體、修補單也沒記 → 靜默壞掉又救不回
  assert.throws(() => buildCascadePlan(hits, data), /C-3/)
})

test('Q2: 提供 freezeText 時覆寫文字，但修補單存的是凍結前原文', () => {
  const data = pilotData({
    name: '測試',
    talents: [{ name: 'A', description: '可疊加<buff_x.lv3.maxStack>層' }],
  })
  const { hits } = findReferences('buff', 'buff_x', data)
  const plan = buildCascadePlan(hits, data, { freezeText: (t) => t.replace(/<[^>]+>/g, '5') })

  assert.equal((plan.mutations[0].set.talents as { description: string }[])[0].description, '可疊加5層')
  assert.equal(plan.patches[0].op, 'textFreeze')
  assert.equal(plan.patches[0].value, '可疊加<buff_x.lv3.maxStack>層')   // 還原要回到 token 形式
})

// ─── R. 去重與問題回報 ───────────────────────────────────────────────────────

test('R1: 同陣列同值的重複命中只記一筆修補單（arrayRemove 移除所有相等元素）', () => {
  const data = pilotData({ name: '測試', talents: [{ name: 'A', buffIds: ['buff_x', 'buff_x'] }] })
  const { hits } = findReferences('buff', 'buff_x', data)
  assert.equal(hits.length, 2)

  const plan = buildCascadePlan(hits, data)
  assert.equal(plan.deduped, 1)
  assert.equal(plan.patches.length, 1)
  assert.equal(plan.problems.length, 0)               // 第二筆是去重，不是 valueMissing 假問題
  assert.deepEqual((plan.mutations[0].set.talents as { buffIds: string[] }[])[0].buffIds, [])
})

test('R2: 引用來源文件不在 data 中 → docMissing，且不產出 mutation', () => {
  const data = pilotData({ name: '測試', talents: [{ name: 'A', buffIds: ['buff_x'] }] })
  const { hits } = findReferences('buff', 'buff_x', data)
  const plan = buildCascadePlan(hits, scanData({}))    // 掃描與套用之間資料變了

  assert.equal(plan.mutations.length, 0)
  assert.equal(plan.problems.length, 1)
  assert.equal(plan.problems[0].reason, 'docMissing')
  assert.equal(plan.patches.length, 0)                // 沒套用就不能記修補單
})

test('R3: 路徑已被改掉 → pathMissing / valueMissing，不靜默略過', () => {
  const stale: RefHit = {
    coll: 'pilots', docId: 'p1', docName: '測試',
    siteId: 'pilots.talents[].buffIds', kind: 'buffIds',
    segments: ['talents', 5, 'buffIds'], path: 'talents.5.buffIds', origin: '天賦:不存在',
    op: 'arrayRemove', value: 'buff_x',
  }
  const gone: RefHit = { ...stale, segments: ['talents', 0, 'buffIds'], path: 'talents.0.buffIds' }
  const data = pilotData({ name: '測試', talents: [{ name: 'A', buffIds: ['buff_other'] }] })

  const plan = buildCascadePlan([stale, gone], data)
  assert.deepEqual(plan.problems.map((p) => p.reason), ['pathMissing', 'valueMissing'])
  assert.equal(plan.mutations.length, 0)
})

// ─── S. 純函式契約 ───────────────────────────────────────────────────────────

test('S1: 同一輸入連呼叫兩次結果相同（無狀態污染）', () => {
  const data = pilotData({
    name: '測試',
    talents: [{ name: 'A', buffIds: ['buff_x@2'], descriptionRefs: { x: { refType: 'buff', refId: 'buff_x' } } }],
  })
  const { hits } = findReferences('buff', 'buff_x', data)
  assert.deepEqual(buildCascadePlan(hits, data), buildCascadePlan(hits, data))
})

// ─── T. 凍結器端到端（C-3 接上 C-2 的接縫）─────────────────────────────────

test('T1: createNumRefFreezer 端到端 —— 只烘焙被刪 buff，其他 token 存活', () => {
  const data = pilotData({
    name: '測試',
    talents: [{
      name: 'A',
      description: '疊<buff_x.maxStack>層並使[星爆]上限<buff_y.maxStack>層',
    }],
  })
  const { hits } = findReferences('buff', 'buff_x', data)
  const freezer = createNumRefFreezer('buff_x', { maxStack: 5 })
  const plan = buildCascadePlan(hits, data, { freezeText: freezer.freezeText })

  const desc = (plan.mutations[0].set.talents as { description: string }[])[0].description
  // buff_y 的 token 必須原封不動 —— 烘焙掉它等於讓一個活著的引用變成死數字
  assert.equal(desc, '疊5層並使[星爆]上限<buff_y.maxStack>層')
  assert.deepEqual(freezer.unresolved, [])
  // 修補單存凍結前原文，Phase F 才還原得回 token 形式
  assert.equal(plan.patches[0].value, '疊<buff_x.maxStack>層並使[星爆]上限<buff_y.maxStack>層')
})

test('T2: 階梯 buff 的 .lvN token 取該級真值', () => {
  const data = pilotData({
    name: '測試',
    talents: [{ name: 'A', description: '可疊加<buff_x.lv3.maxStack>層' }],
  })
  // levels 元素須自帶 level 值：取級以值比對而非索引（PLAN-034 B-3）
  const freezer = createNumRefFreezer('buff_x', {
    levels: [{ level: 1, maxStack: 5 }, { level: 2, maxStack: 6 }, { level: 3, maxStack: 7 }],
  })
  const plan = buildCascadePlan(findReferences('buff', 'buff_x', data).hits, data, { freezeText: freezer.freezeText })
  assert.equal((plan.mutations[0].set.talents as { description: string }[])[0].description, '可疊加7層')
})

test('T3: 取不到值的 token 進 unresolved 但不中止刪除', () => {
  const data = pilotData({
    name: '測試',
    talents: [{ name: 'A', description: '持續<buff_x.duration>回合' }],
  })
  const { hits } = findReferences('buff', 'buff_x', data)
  const freezer = createNumRefFreezer('buff_x', { maxStack: 5 })   // 沒有 duration
  const plan = buildCascadePlan(hits, data, { freezeText: freezer.freezeText })

  assert.equal(plan.problems.length, 0)                            // 不是錯誤，刪除照走
  assert.equal(freezer.unresolved.length, 1)
  assert.equal(freezer.unresolved[0].token, '<buff_x.duration>')
  assert.equal(freezer.unresolved[0].hit.origin, '天賦:A')          // 帶得出是哪一處
  assert.equal((plan.mutations[0].set.talents as { description: string }[])[0].description, '持續?回合')
})

test('T4: 同一單元的兩段正文各自成為獨立 patch（description / descriptionMax）', () => {
  const data = pilotData({
    name: '測試',
    talents: [{ name: 'A', description: '疊<buff_x.maxStack>層', descriptionMax: '滿級疊<buff_x.maxStack>層' }],
  })
  const { hits } = findReferences('buff', 'buff_x', data)
  const freezer = createNumRefFreezer('buff_x', { maxStack: 5 })
  const plan = buildCascadePlan(hits, data, { freezeText: freezer.freezeText })

  assert.equal(plan.patches.length, 2)
  assert.deepEqual(plan.patches.map((p) => p.path), ['talents.0.description', 'talents.0.descriptionMax'])
  const t = (plan.mutations[0].set.talents as { description: string; descriptionMax: string }[])[0]
  assert.equal(t.description, '疊5層')
  assert.equal(t.descriptionMax, '滿級疊5層')
})

// ─── U. 修補單的持久化契約（F-2 的還原前提）──────────────────────────────────

test('U1: map key 含 "." 時 segments 保有正確切分，path 字串則不可信', () => {
  const data = pilotData({
    name: '測試',
    talents: [{
      name: 'A',
      descriptionRefs: { '凝勢.強化': { refType: 'buff', refId: 'buff_x' } },
    }],
  })
  const plan = buildCascadePlan(findReferences('buff', 'buff_x', data).hits, data)
  const p = plan.patches[0]

  assert.deepEqual(p.segments, ['talents', 0, 'descriptionRefs', '凝勢.強化'])
  // path 切回來會多切一刀 —— 這正是 segments 必須進快照的原因
  assert.equal(p.path, 'talents.0.descriptionRefs.凝勢.強化')
  assert.notDeepEqual(p.path.split('.'), p.segments.map(String))
})

test('U2: 索引式路徑一律帶 anchor，供還原時重新定位', () => {
  const data = pilotData({
    name: '測試',
    talents: [
      { name: '天賦甲', buffIds: ['buff_keep'] },
      { name: '天賦乙', buffIds: ['buff_x'] },
    ],
    neuralDrive: [{ name: 'ND', levels: [{ level: 4, buffIds: ['buff_x'] }] }],
  })
  const plan = buildCascadePlan(findReferences('buff', 'buff_x', data).hits, data)

  // talents[1] 的錨是天賦名；若日後天賦被重排，F-2 靠它找回正確的那一個
  const t = plan.patches.find((p) => p.segments[0] === 'talents')
  assert.deepEqual(t?.anchor, { by: 'name', value: '天賦乙' })

  // 神驅等級的錨是 level 值，不是索引
  const nd = plan.patches.find((p) => p.segments[0] === 'neuralDrive')
  assert.deepEqual(nd?.anchor, { by: 'level', value: 4 })
})

test('U3: 修補單可被 JSON 往返（快照要存進 Firestore）', () => {
  const data = pilotData({
    name: '測試',
    talents: [{ name: 'A', buffIds: ['buff_x@2'], descriptionRefs: { k: { refType: 'buff', refId: 'buff_x', level: 2 } } }],
  })
  const plan = buildCascadePlan(findReferences('buff', 'buff_x', data).hits, data)
  // segments 混有 string 與 number，JSON 往返後型別必須保持（number 索引不可變字串）
  assert.deepEqual(JSON.parse(JSON.stringify(plan.patches)), plan.patches)
})

// ─── V. 送出前的安全閘（C-4）─────────────────────────────────────────────────

/** 造一份只有 writeCount / problems 有意義的假 plan，專測閘門 */
const fakePlan = (over: Partial<CascadePlan> = {}): CascadePlan => ({
  mutations: [], patches: [], problems: [], deduped: 0, writeCount: 1, ...over,
})

test('V1: 一切正常時無阻擋', () => {
  assert.deepEqual(checkCascadeSafety(fakePlan()), [])
})

test('V2: problems 非空必定阻擋（不可只跳過有問題的那幾筆）', () => {
  const data = pilotData({ name: '測試', talents: [{ name: 'A', buffIds: ['buff_x'] }] })
  const { hits } = findReferences('buff', 'buff_x', data)
  const plan = buildCascadePlan(hits, scanData({}))          // 文件不在 → docMissing

  const blockers = checkCascadeSafety(plan)
  assert.equal(blockers.length, 1)
  assert.equal(blockers[0].kind, 'problems')
  assert.match(blockers[0].detail, /docMissing/)
})

test('V3: batch 上限用 writeCount + 版本 bump 計算，剛好 500 放行、501 擋下', () => {
  // writeCount = mutations + 1(deleteDoc)；再 +1 是併進同一 batch 的 meta/gameData 版本寫入。
  // 少算那一筆會讓「剛好 500 個 update」在 Firestore 端整批被拒
  const ok = checkCascadeSafety(fakePlan({ writeCount: FIRESTORE_BATCH_LIMIT - BATCH_OVERHEAD_OPS }))
  assert.deepEqual(ok, [])

  const over = checkCascadeSafety(fakePlan({ writeCount: FIRESTORE_BATCH_LIMIT - BATCH_OVERHEAD_OPS + 1 }))
  assert.equal(over.length, 1)
  assert.equal(over[0].kind, 'batchLimit')
  assert.equal(over[0].kind === 'batchLimit' && over[0].ops, FIRESTORE_BATCH_LIMIT + 1)
})

test('V4: 快照過大時擋下（單文件 1 MiB 上限）', () => {
  const small = { doc: { name: 'x' }, patches: [] }
  assert.deepEqual(checkCascadeSafety(fakePlan(), small), [])

  // 中文 1 字 3 bytes，故 UTF-8 長度必須實測而非用 .length
  const huge = { doc: { lore: '鋼'.repeat(SNAPSHOT_SIZE_BUDGET_BYTES / 3) }, patches: [] }
  const blockers = checkCascadeSafety(fakePlan(), huge)
  assert.equal(blockers.length, 1)
  assert.equal(blockers[0].kind, 'snapshotSize')
})

test('V5: 省略 snapshot 時跳過大小檢查（僅預覽影響範圍的情境）', () => {
  assert.deepEqual(checkCascadeSafety(fakePlan()), [])
})

test('V6: 多個問題同時存在時全部回報，不是只回第一個', () => {
  const plan = fakePlan({
    writeCount: 9999,
    problems: [{ hit: { coll: 'pilots', docId: 'p1', path: 'x' } as never, reason: 'docMissing', detail: 'd' }],
  })
  const kinds = checkCascadeSafety(plan, { doc: {}, patches: [] }).map((b) => b.kind)
  assert.deepEqual(kinds.sort(), ['batchLimit', 'problems'])
})

// ─── S. PLAN-032：物件型陣列元素的 arrayRemove ────────────────────────────────
//
// 為什麼這組測試是必要的：`weapons.skills[].skillId` 是全站**第一個**元素為物件的
// arrayRemove 站點（元素 = { skillId, activation }）。在它之前所有站點的元素都是字串，
// 於是 removeAll 用 `===` 的參照相等一直沒被觸發。
// 對抗審查以兩份獨立重現腳本證實：DocDraft 的 copy-on-write 會在 resolveHit 走訪
// `['skills', i]` 時把該元素換成私有副本，`arr[i] === hit.value` 恆為 false
// → 每次刪除武器技能都全數 valueMissing，級聯刪除完全不能用。

const weaponData = (w: object, id = 'w1') =>
  scanData({ weapons: [{ ...(w as object), id } as never] })

test('S1: flip 後刪技能庫的武器技能 —— 掛載物件被正確移除（深層相等，非參照相等）', () => {
  const data = weaponData({
    name: '魔笛',
    skills: [
      { skillId: 'skill_凝神待發', activation: 'use' },
      { skillId: 'skill_起爆', activation: 'carry' },
    ],
  })
  const { hits } = findReferences('pilotSkill', 'skill_凝神待發', data)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].siteId, 'weapons.skills[].skillId')

  const plan = buildCascadePlan(hits, data)
  assert.deepEqual(plan.problems, [])          // ← 修正前這裡是 1 筆 valueMissing
  assert.equal(plan.mutations.length, 1)
  assert.deepEqual(plan.mutations[0].set.skills, [
    { skillId: 'skill_起爆', activation: 'carry' },
  ])
  // 修補單存整個掛載物件（含 activation）——只存裸 skillId 的話還原會少掉生效方式
  assert.deepEqual(plan.patches[0].value, { skillId: 'skill_凝神待發', activation: 'use' })
  assert.equal(plan.patches[0].path, 'skills')
})

test('S2: 同一技能以不同 activation 掛在兩把武器 —— 各自移除，不互相誤傷', () => {
  const data = scanData({
    weapons: [
      { id: 'w1', name: '赤狐·改', skills: [{ skillId: 'skill_凝神待發', activation: 'carry' }] } as never,
      { id: 'w2', name: '魔笛', skills: [{ skillId: 'skill_凝神待發', activation: 'use' }] } as never,
    ],
  })
  const { hits } = findReferences('pilotSkill', 'skill_凝神待發', data)
  assert.equal(hits.length, 2)
  const plan = buildCascadePlan(hits, data)
  assert.deepEqual(plan.problems, [])
  assert.equal(plan.mutations.length, 2)
  // 深層相等必須夠精確：activation 不同的兩筆是不同的值，不可被同一次 removeAll 一起清掉
  assert.deepEqual(plan.mutations[0].set.skills, [])
  assert.deepEqual(plan.mutations[1].set.skills, [])
})

test('S3: 深層相等不可過寬 —— 同 skillId 但 activation 不同者不被誤刪', () => {
  // 資料上不會出現（同一把武器不會掛同技能兩次），但這是 removeAll 的行為契約：
  // 若改成「只比 skillId」，這裡會連帶刪掉第二筆，而修補單只記了一筆 → 還原不回去。
  const data = weaponData({
    name: '測試',
    skills: [
      { skillId: 'skill_x', activation: 'carry' },
      { skillId: 'skill_x', activation: 'use' },
    ],
  })
  const { hits } = findReferences('pilotSkill', 'skill_x', data)
  assert.equal(hits.length, 2)                 // 兩筆掛載各自成為一個 hit
  const plan = buildCascadePlan(hits, data)
  assert.deepEqual(plan.problems, [])
  assert.deepEqual(plan.mutations[0].set.skills, [])   // 兩筆各自被自己那個 hit 移除
})

test('S4: 內嵌格式不被此站點命中（它是拷貝不是引用）', () => {
  const data = weaponData({
    name: '凱旋·改',
    skills: [{ name: '凝神待發', type: '被動技能', activation: 'carry', description: 'x', effects: [], buffIds: [] }],
  })
  const { hits } = findReferences('pilotSkill', 'skill_凝神待發', data)
  assert.deepEqual(hits, [])
})

test('S5: 字串元素的既有站點行為不變（深層相等對純量退化成 ===）', () => {
  const data = pilotData({ name: '測試', skills: ['skill_dead', 'skill_keep'] })
  const { hits } = findReferences('pilotSkill', 'skill_dead', data)
  const plan = buildCascadePlan(hits, data)
  assert.deepEqual(plan.problems, [])
  assert.deepEqual(plan.mutations[0].set.skills, ['skill_keep'])
})
