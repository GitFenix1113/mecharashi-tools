// PLAN-043 C-4：背包 / 背包技能刪除的模擬器整合測試
//
//   node --test --test-force-exit --import ./tests/emulator/register.mjs tests/emulator/suites/backpack-cascade.test.ts
//
// 為什麼要有這個檔案：hardRef 擋門是本計畫最高風險的**靜默失敗點**。
// 若它沒接好，刪掉一個被當前置的背包會「順利完成」，然後前台只是把
// 「前置主背包」降級成「待確認」——沒有錯誤訊息、沒有 log 異常，
// 維護者要很久以後才會從別的地方發現關係鏈斷了。單元測試守得住 findReferences
// 的分流，但守不住「blocker 有沒有真的傳到 planCascadeDelete、有沒有真的擋下寫入」。

import assert from 'node:assert/strict'
import {
  emuSuite, seedDocs, seedUser, signInAs,
  readDoc, listColl, allLogs, ADMIN_USER,
} from '../helpers.ts'

type Doc = Record<string, unknown>

// ─── Fixture ─────────────────────────────────────────────────────────────────
// 關係鏈：bp_ss（SS）──craft.prereq──▶ bp_sp（S+）
//         w_composite（複合武器）──upgrade.fusedBackpackId──▶ bp_fused
//         bp_free 無人引用 → 可安全刪除
const BACKPACKS: Doc[] = [
  { id: 'bp_ss',    name: '征服者背包', rarity: 'SS', type: 'Flow', weight: 300, slot: 'back',
    assemblableArmorType: [], repairAmount: 0, skillIds: ['bpskill_移動強化@1'],
    craft: { prereqBackpackId: 'bp_sp' } },
  { id: 'bp_sp',    name: '出力強化背包', rarity: 'S+', type: 'Flow', weight: 200, slot: 'back',
    assemblableArmorType: [], repairAmount: 0, skillIds: [] },
  { id: 'bp_fused', name: '裁決者背包', rarity: 'SS', type: 'Flow', weight: 250, slot: 'back',
    assemblableArmorType: [], repairAmount: 0, skillIds: [] },
  { id: 'bp_free',  name: '無人引用背包', rarity: 'S', type: 'Ammo', weight: 100, slot: 'back',
    assemblableArmorType: [], repairAmount: 0, skillIds: ['bpskill_移動強化@1'] },
]

const BACKPACK_SKILLS: Doc[] = [
  {
    id: 'bpskill_移動強化', name: '移動強化', skillType: '被動技能',
    description: '機甲移動力增加1格；附帶[過熱]',
    descriptionRefs: { 過熱: { refType: 'buff', refId: 'buff_過熱' } },
    icon: '/images/skills/背包技能/Icon_skill_passive_1.png',
    effects: [], buffIds: ['buff_過熱'],
    levels: [
      { level: 1, name: '移動強化Ⅰ', description: '移動力 +1', buffIds: ['buff_過熱@1'] },
      { level: 2, name: '移動強化Ⅱ', description: '移動力 +2', buffIds: ['buff_過熱@2'] },
    ],
  },
]

const WEAPONS: Doc[] = [
  { id: 'w_composite', name: '裁決者', upgrade: { fromWeaponId: 'w_base', station: 'specialBackpack', fusedBackpackId: 'bp_fused' } },
]

async function seedAll() {
  await seedUser(ADMIN_USER, 'OWNER')
  await seedDocs({
    backpacks: BACKPACKS,
    backpackSkills: BACKPACK_SKILLS,
    weapons: WEAPONS,
    buffs: [{ id: 'buff_過熱', name: '過熱', maxStack: 5 }],
  })
  await signInAs(ADMIN_USER)
}

// ─── ① 硬外鍵：被當前置的背包不可刪 ──────────────────────────────────────────

emuSuite('backpack: 被其他背包當前置 → 擋下刪除，資料毫髮無傷', async () => {
  await seedAll()
  const { planCascadeDelete } = await import('../../../src/lib/api/cascadeDelete.ts')
  const { deleteBackpack } = await import('../../../src/lib/api/backpacks.ts')

  const plan = await planCascadeDelete('backpack', 'bp_sp')
  assert.ok(plan, '目標存在 → 應回傳計畫')
  assert.equal(plan!.blockers.length, 1, '應恰有一個 blocker')
  assert.equal(plan!.blockers[0].kind, 'hardRef')
  assert.match(plan!.blockers[0].detail, /征服者背包/, 'blocker 應指名是誰在引用')
  // 硬外鍵刻意不進 plan.mutations —— 進了就會被自動清成 null，那正是要防的事
  assert.equal(plan!.plan.mutations.length, 0, '不應產生任何自動清除的改寫')

  await assert.rejects(
    () => deleteBackpack('bp_sp'),
    (e: Error) => e.name === 'CascadeBlockedError',
    '便利入口也必須擋下，不可只靠 UI 自律',
  )

  // ── 帶外驗證：拋錯發生在任何寫入之前 ────────────────────────────────────
  assert.ok(await readDoc('backpacks', 'bp_sp'), '目標背包應仍存在')
  const ss = await readDoc('backpacks', 'bp_ss')
  assert.deepEqual(ss?.craft, { prereqBackpackId: 'bp_sp' }, '前置鏈不應被動到')
  assert.equal((await allLogs()).length, 0, '被擋下的刪除不該留下任何 log')
})

// ─── ② 硬外鍵：被複合武器融合的背包不可刪 ────────────────────────────────────

emuSuite('backpack: 被複合武器融合 → 擋下刪除，武器的 fusedBackpackId 不被清空', async () => {
  await seedAll()
  const { planCascadeDelete } = await import('../../../src/lib/api/cascadeDelete.ts')

  const plan = await planCascadeDelete('backpack', 'bp_fused')
  assert.ok(plan)
  assert.equal(plan!.blockers.length, 1)
  assert.equal(plan!.blockers[0].kind, 'hardRef')
  assert.match(plan!.blockers[0].detail, /裁決者/, 'blocker 應指名是哪把武器')
  assert.equal(plan!.plan.mutations.length, 0)

  const w = await readDoc('weapons', 'w_composite')
  assert.equal((w?.upgrade as Doc).fusedBackpackId, 'bp_fused', '融合來源不應被清空')
})

// ─── ③ 對照組：無人引用的背包可正常刪除 ──────────────────────────────────────

emuSuite('backpack: 無硬外鍵引用 → 正常刪除，log 與版本 bump 全套落地', async () => {
  await seedAll()
  const { deleteBackpack } = await import('../../../src/lib/api/backpacks.ts')

  const res = await deleteBackpack('bp_free')
  assert.ok(res, '應回傳結果')
  assert.equal(await readDoc('backpacks', 'bp_free'), null, '目標應已刪除')

  // bp_free 掛著 bpskill_移動強化，但那是**背包指向技能**（出向），
  // 刪背包不該動到技能本身——反向才是級聯清除的方向。
  assert.ok(await readDoc('backpackSkills', 'bpskill_移動強化'), '被掛載的技能不應被連帶刪除')

  const logs = await allLogs()
  assert.equal(logs.length, 1)
  assert.equal(logs[0].target, 'backpack', 'log 的 target kind 應為 backpack')
  assert.equal(logs[0].targetName, '無人引用背包', '應記下顯示名（刪除後仍看得懂）')

  const versions = (await readDoc('meta', 'gameData'))?.versions as Record<string, string>
  assert.ok(versions.backpacks, '目標集合版本應被 bump')
})

// ─── ④ 刪背包技能：清掉所有背包的 skillIds 引用（含 @N 後綴）────────────────

emuSuite('backpackSkill: 刪除 → 各背包 skillIds 的 @N 元素被精確移除', async () => {
  await seedAll()
  const { deleteBackpackSkill } = await import('../../../src/lib/api/backpackSkills.ts')

  const res = await deleteBackpackSkill('bpskill_移動強化')
  assert.ok(res)
  assert.equal(await readDoc('backpackSkills', 'bpskill_移動強化'), null)

  // 地雷①在 scalarRef 路徑的翻版：若比對時沒拆 @N 後綴，這裡會留下孤兒引用且**不報錯**
  for (const id of ['bp_ss', 'bp_free']) {
    const bp = await readDoc('backpacks', id)
    assert.deepEqual(bp?.skillIds, [], `${id} 的 skillIds 應被清空（原值含 @1 後綴）`)
  }

  const snapshot = (await allLogs())[0].snapshot as { patches: Array<{ op: string; value: unknown }> }
  assert.equal(snapshot.patches.length, 2, '兩個背包各一筆修補單')
  assert.ok(
    snapshot.patches.every((p) => p.op === 'arrayRemove' && p.value === 'bpskill_移動強化@1'),
    '修補單必須存**原始元素字串**（含 @1）—— 存裸 id 會讓還原時補回錯的值',
  )

  // 無辜集合不該被波及（listColl 回傳 Map，不是陣列）
  const weapons = await listColl('weapons')
  assert.equal(weapons.size, 1, '武器不應被動到')
  assert.equal((weapons.get('w_composite')?.upgrade as Doc).fusedBackpackId, 'bp_fused')
})

// ─── ⑤ 刪 BUFF：背包技能的頂層與各級 buffIds 都要被清 ────────────────────────

emuSuite('buff: 刪除 → backpackSkills 的 buffIds 與 levels[].buffIds 都被清除', async () => {
  await seedAll()
  const { deleteBuff } = await import('../../../src/lib/api/buffs.ts')

  await deleteBuff('buff_過熱')

  const sk = await readDoc('backpackSkills', 'bpskill_移動強化')
  assert.deepEqual(sk?.buffIds, [], '頂層 buffIds 應被清空')
  const levels = sk?.levels as Array<Doc>
  // 漏掉 levels[].buffIds 站點的症狀：各級留下指空的 'buff_過熱@1'，模擬器靜默算不到
  assert.deepEqual(levels[0].buffIds, [], 'Lv1 的 buffIds 應被清空')
  assert.deepEqual(levels[1].buffIds, [], 'Lv2 的 buffIds 應被清空')
  assert.deepEqual(sk?.descriptionRefs, {}, 'descriptionRefs 的 key 應被清掉')
  assert.equal(sk?.description, '機甲移動力增加1格；附帶[過熱]', '正文不應被改動')
})
