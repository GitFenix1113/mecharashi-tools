// PLAN-030 F-2：快照還原計算層單元測試
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這裡守的是「還原會不會把資料改壞、會不會加錯地方」。與 cascadePatch 同理：
// 正式資料的 buffIds / @N 幾乎全空，多數分支整合測試踩不到，單元測試是唯一防線。
// 最重要的是 R8 往返測試——刪除 plan 套用後再還原，必須 deepEqual 回原始文件。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRestorePlan, type RestoreScanData } from './restorePatch.ts'
import { buildCascadePlan, createNumRefFreezer } from './cascadePatch.ts'
import { findReferences, ALL_SCAN_COLLECTIONS, type RefScanData } from './entityRefs.ts'
import { freezeNumRefs, type NumRefSource } from './numRefs.ts'
import type { ReversePatch } from '../types/changeHistory'
import type { Pilot } from '../types'

const asPilot = (o: unknown) => o as unknown as Pilot

function scanData(partial: RefScanData): RefScanData {
  const full: Record<string, unknown[]> = {}
  for (const c of ALL_SCAN_COLLECTIONS) full[c] = []
  return { ...full, ...partial } as RefScanData
}

const patch = (p: Partial<ReversePatch>): ReversePatch => ({
  coll: 'pilots', docId: 'p1', path: '', segments: [], op: 'arrayRemove', value: 'buff_x',
  ...p,
})

const pilotDocs = (doc: object): RestoreScanData =>
  ({ pilots: [{ ...(doc as Record<string, unknown>), id: 'p1' }] })

// ─── R1~R2. arrayRemove 重加與冪等 ───────────────────────────────────────────

test('R1: arrayRemove 重加 —— 值缺席則補回，只寫回被動到的頂層欄位', () => {
  const plan = buildRestorePlan(
    [patch({ segments: ['talents', 0, 'buffIds'], op: 'arrayRemove', value: 'buff_x@3' })],
    pilotDocs({ name: '測試', lore: '簡介', talents: [{ name: 'A', buffIds: ['buff_y'] }] }),
  )
  assert.equal(plan.skipped.length, 0)
  assert.equal(plan.applied.length, 1)
  assert.equal(plan.mutations.length, 1)
  assert.deepEqual(Object.keys(plan.mutations[0].set), ['talents'])   // lore 不進 set
  assert.deepEqual(
    (plan.mutations[0].set.talents as { buffIds: string[] }[])[0].buffIds,
    ['buff_y', 'buff_x@3'],
  )
  assert.equal(plan.writeCount, 2)                    // 1 份 update + 1 份目標 setDoc
})

test('R2: 冪等 —— 值已在原位則歸入 alreadyPresent，不產生 mutation、不重複加', () => {
  const docs = pilotDocs({ name: '測試', talents: [{ name: 'A', buffIds: ['buff_x@3', 'buff_y'] }] })
  const plan = buildRestorePlan(
    [patch({ segments: ['talents', 0, 'buffIds'], op: 'arrayRemove', value: 'buff_x@3' })],
    docs,
  )
  assert.equal(plan.applied.length, 0)
  assert.equal(plan.alreadyPresent.length, 1)
  assert.equal(plan.mutations.length, 0)              // 無事可寫 → 不該有任何寫入
  assert.equal(plan.skipped.length, 0)
})

// ─── R3. mapKeyDelete 重加（含 map key 帶 '.' 的地雷）─────────────────────────

test('R3: mapKeyDelete 重加 —— segments 定位，map key 含 "." 不被切錯', () => {
  const ref = { refType: 'buff', refId: 'buff_x' }
  const plan = buildRestorePlan(
    [patch({
      segments: ['talents', 0, 'descriptionRefs', '凝勢.強化'],   // path split('.') 會切錯，segments 不會
      path: 'talents.0.descriptionRefs.凝勢.強化',
      op: 'mapKeyDelete', value: ref,
    })],
    pilotDocs({ name: '測試', talents: [{ name: 'A', descriptionRefs: { 其他: { refType: 'buff', refId: 'buff_o' } } }] }),
  )
  assert.equal(plan.skipped.length, 0)
  const refs = (plan.mutations[0].set.talents as { descriptionRefs: Record<string, unknown> }[])[0].descriptionRefs
  assert.deepEqual(refs['凝勢.強化'], ref)
  assert.ok(refs['其他'])                             // 既有 key 不受影響
})

test('R3b: mapKeyDelete 重加 —— 帶消歧後綴的 key 原樣還原，同名裸 key 不受影響（PLAN-039）', () => {
  const ref = { refType: 'skill', refId: 'skill_駐陣' }
  const plan = buildRestorePlan(
    [patch({
      segments: ['talents', 0, 'descriptionRefs', '駐陣|skill'],
      path: 'talents.0.descriptionRefs.駐陣|skill',
      op: 'mapKeyDelete', value: ref,
    })],
    pilotDocs({
      name: '測試',
      talents: [{ name: 'A', descriptionRefs: { 駐陣: { refType: 'buff', refId: 'buff_駐陣' } } }],
    }),
  )
  assert.equal(plan.skipped.length, 0)
  const refs = (plan.mutations[0].set.talents as { descriptionRefs: Record<string, unknown> }[])[0].descriptionRefs
  assert.deepEqual(refs['駐陣|skill'], ref)
  // 同名裸 key 必須完好——若還原時剝了後綴，這裡會被 skill ref 覆蓋掉
  assert.deepEqual(refs['駐陣'], { refType: 'buff', refId: 'buff_駐陣' })
})

// ─── R4. fieldClear：缺就補、有不同值就衝突跳過 ───────────────────────────────

test('R4: fieldClear —— 欄位缺席補回；已有不同值則 conflict 跳過不覆蓋', () => {
  const restore = (buffDoc: object) => buildRestorePlan(
    [patch({ coll: 'buffs', docId: 'b1', segments: ['termRef'], op: 'fieldClear', value: 'term_old' })],
    { buffs: [{ ...(buffDoc as Record<string, unknown>), id: 'b1' }] },
  )
  // 欄位已被 deleteField 移除 → 補回
  const a = restore({ name: 'B' })
  assert.equal(a.applied.length, 1)
  assert.equal(a.mutations[0].set.termRef, 'term_old')
  // 期間被指到別的詞條 → 衝突跳過
  const b = restore({ name: 'B', termRef: 'term_new' })
  assert.equal(b.applied.length, 0)
  assert.equal(b.skipped.length, 1)
  assert.equal(b.skipped[0].reason, 'conflict')
  assert.equal(b.mutations.length, 0)
})

// ─── R5. textFreeze：唯一非冪等的 op ─────────────────────────────────────────

test('R5: textFreeze —— 現值等於凍結產物才還原成 token；被編輯過則 conflict', () => {
  const source: NumRefSource = { maxStack: 5 }
  const original = '可疊加<buff_x.maxStack>層'
  const frozen = freezeNumRefs(original, 'buff_x', source).text   // '可疊加5層'
  const freezeText = (t: string) => freezeNumRefs(t, 'buff_x', source).text
  const restore = (currentText: string) => buildRestorePlan(
    [patch({ segments: ['talents', 0, 'description'], op: 'textFreeze', value: original })],
    pilotDocs({ name: '測試', talents: [{ name: 'A', description: currentText }] }),
    { freezeText },
  )
  // 現值仍是凍結產物 → 還原成 token 形式
  const a = restore(frozen)
  assert.equal(a.applied.length, 1)
  assert.equal((a.mutations[0].set.talents as { description: string }[])[0].description, original)
  // 已經是 token 形式（重複還原）→ 冪等
  assert.equal(restore(original).alreadyPresent.length, 1)
  // 期間被編輯 → conflict 跳過
  const c = restore('文字被改掉了')
  assert.equal(c.skipped[0].reason, 'conflict')
  assert.equal(c.mutations.length, 0)
})

test('R5b: 有 textFreeze 修補單但未提供 freezeText → 拋錯（比照 cascadePatch 失敗模式）', () => {
  assert.throws(() => buildRestorePlan(
    [patch({ segments: ['talents', 0, 'description'], op: 'textFreeze', value: '<t>' })],
    pilotDocs({ name: '測試', talents: [{ name: 'A', description: 'x' }] }),
  ), /freezeText/)
})

// ─── R6. 錨點重定位（地雷 c 的兌現）──────────────────────────────────────────

test('R6: 陣列被重排 —— index 指錯天賦時按 anchor 重新定位', () => {
  // 刪除當下 buff 掛在 talents[1]（天賦B）；還原前陣列被重排成 [B, A]
  const plan = buildRestorePlan(
    [patch({
      segments: ['talents', 1, 'buffIds'], op: 'arrayRemove', value: 'buff_x',
      anchor: { by: 'name', value: '天賦B' },
    })],
    pilotDocs({ name: '測試', talents: [
      { name: '天賦B', buffIds: [] },                 // 正確目標，現在在 index 0
      { name: '天賦A', buffIds: ['buff_other'] },     // index 1 現在是無辜鄰居
    ] }),
  )
  assert.equal(plan.skipped.length, 0)
  const talents = plan.mutations[0].set.talents as { name: string; buffIds: string[] }[]
  assert.deepEqual(talents[0].buffIds, ['buff_x'])    // 加到天賦B
  assert.deepEqual(talents[1].buffIds, ['buff_other']) // 鄰居毫髮無傷
})

test('R6b: 錨定元素已消失或同錨多個 → anchorMismatch 跳過，不寫錯地方', () => {
  const mk = (talents: object[]) => buildRestorePlan(
    [patch({
      segments: ['talents', 5, 'buffIds'], op: 'arrayRemove', value: 'buff_x',
      anchor: { by: 'name', value: '天賦B' },
    })],
    pilotDocs({ name: '測試', talents }),
  )
  const gone = mk([{ name: '天賦A', buffIds: [] }])
  assert.equal(gone.skipped[0].reason, 'anchorMismatch')
  assert.equal(gone.mutations.length, 0)
  const dup = mk([{ name: '天賦B', buffIds: [] }, { name: '天賦B', buffIds: [] }])
  assert.equal(dup.skipped[0].reason, 'anchorMismatch')
})

test('R6c: 巢狀路徑錨定最後一個數字索引（neuralDrive[].levels[] 以 level 錨定）', () => {
  const plan = buildRestorePlan(
    [patch({
      segments: ['neuralDrive', 0, 'levels', 0, 'abilityId'], op: 'fieldClear', value: 'nd_x',
      anchor: { by: 'level', value: 3 },
    })],
    pilotDocs({ name: '測試', neuralDrive: [{ name: 'ND', levels: [
      { level: 1 }, { level: 3 },                     // level 3 現在在 index 1
    ] }] }),
  )
  assert.equal(plan.skipped.length, 0)
  const nd = plan.mutations[0].set.neuralDrive as { levels: { level: number; abilityId?: string }[] }[]
  assert.equal(nd[0].levels[1].abilityId, 'nd_x')
  assert.equal(nd[0].levels[0].abilityId, undefined)
})

// ─── R7. 來源消失與舊格式防禦 ────────────────────────────────────────────────

test('R7: 引用來源文件已不存在 → docMissing 跳過；其餘文件照常套用', () => {
  const plan = buildRestorePlan(
    [
      patch({ docId: 'p_gone', segments: ['talents', 0, 'buffIds'], op: 'arrayRemove', value: 'buff_x' }),
      patch({ segments: ['talents', 0, 'buffIds'], op: 'arrayRemove', value: 'buff_x' }),
    ],
    pilotDocs({ name: '測試', talents: [{ name: 'A', buffIds: [] }] }),
  )
  assert.equal(plan.skipped.length, 1)
  assert.equal(plan.skipped[0].reason, 'docMissing')
  assert.equal(plan.applied.length, 1)                // p1 不受 p_gone 影響
})

test('R7b: 修補單缺 segments（舊格式 log）→ badPatch 跳過，不猜路徑', () => {
  const legacy = { coll: 'pilots', docId: 'p1', path: 'talents.0.buffIds', op: 'arrayRemove', value: 'buff_x' }
  const plan = buildRestorePlan(
    [legacy as unknown as ReversePatch],
    pilotDocs({ name: '測試', talents: [{ name: 'A', buffIds: [] }] }),
  )
  assert.equal(plan.skipped[0].reason, 'badPatch')
})

// ─── R8. 刪除 → 還原 往返（本檔最重要的測試）─────────────────────────────────

test('R8: buildCascadePlan 套用後再 buildRestorePlan，文件 deepEqual 回原始狀態', () => {
  const targetId = 'buff_凝勢'
  const targetDoc = { name: '凝勢', maxStack: 7, levels: [{ level: 3, maxStack: 5 }] }
  const pilot = {
    name: '艾達',
    talents: [
      { name: '悖想', buffIds: ['buff_凝勢@3', 'buff_他'],
        description: '可疊加<buff_凝勢.lv3.maxStack>層並觸發<buff_他.maxStack>層',
        descriptionRefs: { 凝勢: { refType: 'buff', refId: 'buff_凝勢' }, 他者: { refType: 'buff', refId: 'buff_他' } } },
      { name: '第二天賦', buffIds: ['buff_凝勢'] },
    ],
    neuralDrive: [{ name: 'ND', levels: [{ level: 2, buffIds: ['buff_凝勢@1'] }] }],
  }
  const data = scanData({
    pilots: [{ ...asPilot(pilot), id: 'p1' } as never],
    buffs: [{ ...(targetDoc as object), id: targetId } as never],
  })

  // ── 刪除端 ──
  const { hits } = findReferences('buff', targetId, data)
  const freezer = createNumRefFreezer(targetId, targetDoc as NumRefSource)
  const cascade = buildCascadePlan(hits, data, { freezeText: freezer.freezeText })
  assert.equal(cascade.problems.length, 0)
  assert.ok(cascade.patches.length >= 5)              // 3 buffIds + 1 refs + 1 textFreeze

  // 模擬 Firestore 寫回：套 mutations 到文件副本
  const afterDelete = structuredClone(pilot) as Record<string, unknown>
  for (const m of cascade.mutations) {
    if (m.docId !== 'p1') continue
    Object.assign(afterDelete, structuredClone(m.set))
  }
  // 快照經 Firestore 往返 = JSON 往返（U3 已證 segments 保型）
  const patches = JSON.parse(JSON.stringify(cascade.patches)) as ReversePatch[]

  // ── 還原端 ──
  const freezeText = (t: string) => freezeNumRefs(t, targetId, targetDoc as NumRefSource).text
  const restore = buildRestorePlan(
    patches.filter((p) => p.docId === 'p1'),
    { pilots: [{ ...afterDelete, id: 'p1' }] },
    { freezeText },
  )
  assert.equal(restore.skipped.length, 0)
  assert.equal(restore.alreadyPresent.length, 0)

  const restored = { ...afterDelete }
  for (const m of restore.mutations) Object.assign(restored, m.set)

  // buffIds 加回尾端 → 順序可能不同，逐陣列排序後比對；其餘結構必須完全一致
  const norm = (o: unknown): unknown => JSON.parse(JSON.stringify(o), (_k, v) =>
    Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...v].sort() : v)
  assert.deepEqual(norm(restored), norm(pilot))
})

test('R8b: 往返後重複還原一次 → 全數 alreadyPresent，零寫入（冪等收斂）', () => {
  const doc = { name: '測試', talents: [{ name: 'A', buffIds: ['buff_y'] }] }
  const p = patch({ segments: ['talents', 0, 'buffIds'], op: 'arrayRemove', value: 'buff_x' })
  const first = buildRestorePlan([p], pilotDocs(doc))
  const afterRestore = { ...doc, ...(first.mutations[0].set as object) }
  const second = buildRestorePlan([p], pilotDocs(afterRestore))
  assert.equal(second.alreadyPresent.length, 1)
  assert.equal(second.mutations.length, 0)
})

test('R9: 不改動輸入資料（copy-on-write 延伸到還原端）', () => {
  const docs = pilotDocs({ name: '測試', talents: [{ name: 'A', buffIds: [] }] })
  const before = JSON.stringify(docs)
  buildRestorePlan([patch({ segments: ['talents', 0, 'buffIds'], op: 'arrayRemove', value: 'buff_x' })], docs)
  assert.equal(JSON.stringify(docs), before)
})
