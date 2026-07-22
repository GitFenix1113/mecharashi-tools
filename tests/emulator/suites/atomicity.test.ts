// PLAN-030 模擬器整合測試：原子性與失敗注入
//
// 核心問題：「batch 中途失敗時，資料庫留下什麼？」
// 手法：在 planCascadeDelete 與 commitCascadeDelete 之間用 adminDb（帶外通道）
// 偷改資料或竄改 planned 物件，然後帶外驗證資料庫真實狀態——不信任回傳值。
//
//   timeout 240 node --test --test-force-exit --import ./tests/emulator/register.mjs tests/emulator/suites/atomicity.test.ts
//
// 案例：
//   a. plan 後刪掉「引用來源文件」→ batch.update 打到不存在文件 → CascadeCommitError；
//      目標仍在、其他引用文件一字未改、版本未 bump。孤兒 log 留下 =
//      cascadeDelete.ts CascadeCommitError 註解（「這是唯一會留下不一致的失敗模式」）
//      聲明的取捨 → documented-behavior。
//   d. CascadeCommitError 訊息帶 logId 且該 log 真的存在（接在 a 之後驗證）。
//   b. 竄改 planned.plan.problems 塞假 problem → CascadeBlockedError，零寫入
//      （安全閘在 log 之前，連 log 都不能有）。
//   c. plan 後用 adminDb 刪掉「目標本身」→ commit 靜默成功：batch.delete 對不存在
//      文件冪等、引用文件照樣被改寫、寫入第二筆 delete log、bump 版本。
//      如實記錄實際行為（planCascadeDelete 的「目標不存在 → null」防線只存在於
//      plan 時，commit 不重驗）。
//   e. 竄改 planned.blockers 塞一筆 problems 空陣列的 blocker（= plan 端 missingColls
//      防線產出的真實形狀）→ 依 CascadePlanResult.blockers 的文件契約
//      （「非空表示不可提交。commitCascadeDelete 會再檢一次，不倚賴呼叫端自律」）
//      commit 應拒絕。實際上 commit 只重跑 checkCascadeSafety(plan, snapshot)，
//      重建不出 missingColls 類 blocker → 照樣提交。斷言寫「正確期望」，
//      失敗即為真實缺陷（紅測試保留）。

import assert from 'node:assert/strict'
import {
  emuSuite, seedDocs, seedUser, signInAs,
  readDoc, allLogs, ADMIN_USER, adminDb,
} from '../helpers.ts'

// ─── 種子資料（形狀依 entityRefs.ts 的站點定義）───────────────────────────────
// buffIds 元素保留原始字串（可含 @N）；descriptionRefs 是 側錄表 map key → EntityRef。

const PILOT_A = {
  id: 'pa',
  name: '測試機師A',
  talents: [{
    name: '天賦A',
    buffIds: ['buff_a@2', 'buff_keep'],
    description: '賦予[甲]',
    descriptionRefs: { 甲: { refType: 'buff', refId: 'buff_a' } },
  }],
}

const PILOT_B = {
  id: 'pb',
  name: '測試機師B',
  talents: [{ name: '天賦B', buffIds: ['buff_b'] }],
}

const PILOT_C = {
  id: 'pc',
  name: '測試機師C',
  talents: [{
    name: '天賦C',
    buffIds: ['buff_c', 'buff_keep'],
    description: '賦予[丙]',
    descriptionRefs: { 丙: { refType: 'buff', refId: 'buff_c' } },
  }],
}

// 案例 a 的失敗注入對象：plan 之後、commit 之前被 adminDb 刪掉的引用來源
const SKILL_A = { id: 'sa', name: '技能甲', buffIds: ['buff_a'] }

// seedDocs 會把 id 抽掉當文件 ID；比對「一字未改」時用去掉 id 的版本
const stripId = <T extends { id: string }>(o: T): Omit<T, 'id'> => {
  const { id: _id, ...rest } = o
  return rest
}

emuSuite('atomicity: batch 中途失敗時資料庫留下什麼', async (t) => {
  await seedUser(ADMIN_USER, 'OWNER')
  await seedDocs({
    buffs: [
      { id: 'buff_a', name: '甲', maxStack: 3 },
      { id: 'buff_b', name: '乙' },
      { id: 'buff_c', name: '丙' },
      { id: 'buff_e', name: '戊' },
    ],
    pilots: [PILOT_A, PILOT_B, PILOT_C],
    pilotSkills: [SKILL_A],
  })
  await signInAs(ADMIN_USER)

  // 動態 import：確保 loader 已就位後才載入待測模組鏈（走 client 路徑 = 走規則）
  const {
    planCascadeDelete, commitCascadeDelete,
    CascadeBlockedError, CascadeCommitError,
  } = await import('../../../src/lib/api/cascadeDelete.ts')

  // 案例 a 捕獲的錯誤，供案例 d 驗證 logId
  let commitErrA: { logId: string; message: string } | undefined

  // ── a ──────────────────────────────────────────────────────────────────────
  await t.test('a. plan 後引用來源被刪 → CascadeCommitError、資料零改動、版本未 bump（孤兒 log = documented）', async () => {
    const planned = await planCascadeDelete('buff', 'buff_a')
    assert.ok(planned, 'plan 階段目標存在，應回傳計畫')
    assert.equal(planned!.blockers.length, 0, 'plan 當下應無 blocker')
    // planned 應同時涵蓋 pilots/pa 與 pilotSkills/sa 兩份引用來源
    assert.equal(planned!.plan.mutations.length, 2, '應有兩份引用來源文件要改寫')

    // 失敗注入：在 plan 與 commit 之間，把其中一份引用來源整份刪掉
    await adminDb.doc('pilotSkills/sa').delete()

    let err: unknown
    try {
      await commitCascadeDelete(planned!)
    } catch (e) {
      err = e
    }
    assert.ok(
      err instanceof CascadeCommitError,
      `batch.update 打到不存在文件應拋 CascadeCommitError，實得：${String(err)}`,
    )
    commitErrA = err as { logId: string; message: string }

    // ── 帶外驗證：batch 原子失敗 = 一筆都沒寫 ────────────────────────────────
    const buffA = await readDoc('buffs', 'buff_a')
    assert.ok(buffA, '目標 buff 應仍存在')
    assert.equal(buffA!.name, '甲')

    assert.deepEqual(
      await readDoc('pilots', 'pa'),
      stripId(PILOT_A),
      '另一份引用來源（pilots/pa）應一字未改',
    )

    assert.equal(await readDoc('meta', 'gameData'), null, 'meta/gameData 不應被建立（版本未 bump）')

    // 孤兒 log：cascadeDelete.ts CascadeCommitError 註解聲明的唯一不一致視窗
    // （「log 已寫入、但資料 batch 提交失敗…只是歷史頁會多一筆與事實不符的記錄」）
    // → 如實記錄 documented behavior，不視為缺陷。
    const logs = await allLogs()
    assert.equal(logs.length, 1, '應恰留下一筆孤兒 delete log（documented behavior）')
    assert.equal(logs[0].action, 'delete')
    assert.equal(logs[0].targetId, 'buff_a')
    const snapshot = logs[0].snapshot as { doc: Record<string, unknown> }
    assert.equal(snapshot.doc.name, '甲', '孤兒 log 的快照仍完整（可供人工核對）')
    console.log(`[a] 孤兒 log id=${logs[0].id}，meta/gameData=${JSON.stringify(await readDoc('meta', 'gameData'))}`)
  })

  // ── d ──────────────────────────────────────────────────────────────────────
  await t.test('d. CascadeCommitError 訊息帶 logId 且該 log 真的存在', async () => {
    assert.ok(commitErrA, '依賴案例 a 捕獲的 CascadeCommitError')
    assert.ok(typeof commitErrA!.logId === 'string' && commitErrA!.logId.length > 0, 'logId 應為非空字串')
    assert.ok(
      commitErrA!.message.includes(commitErrA!.logId),
      `錯誤訊息應內含 logId 供人工核對。訊息：${commitErrA!.message}`,
    )
    const logs = await allLogs()
    const orphan = logs.find((l) => l.id === commitErrA!.logId)
    assert.ok(orphan, `changeHistory 中應真的存在 id=${commitErrA!.logId} 的 log`)
    assert.equal(orphan!.action, 'delete')
    assert.equal(orphan!.targetId, 'buff_a')
    console.log(`[d] 錯誤訊息=${commitErrA!.message}`)
  })

  // ── b ──────────────────────────────────────────────────────────────────────
  await t.test('b. 竄改 plan.problems 塞假 problem → CascadeBlockedError、零寫入（連 log 都沒有）', async () => {
    const planned = await planCascadeDelete('buff', 'buff_b')
    assert.ok(planned)
    assert.equal(planned!.blockers.length, 0, 'plan 當下應無 blocker（假 problem 是等下注入的）')

    const logsBefore = (await allLogs()).length

    // 失敗注入：偽造一筆 CascadeProblem。commit 端的 checkCascadeSafety 直讀
    // plan.problems，非空必須整次中止。
    ;(planned!.plan.problems as unknown[]).push({
      hit: {
        coll: 'pilots', docId: 'ghost', docName: 'ghost', siteId: '注入',
        kind: 'buffIds', segments: ['talents', 0, 'buffIds'],
        path: 'talents.0.buffIds', origin: '注入', op: 'arrayRemove', value: 'buff_b',
      },
      reason: 'docMissing',
      detail: '測試注入的假 problem',
    })

    let err: unknown
    try {
      await commitCascadeDelete(planned!)
    } catch (e) {
      err = e
    }
    assert.ok(
      err instanceof CascadeBlockedError,
      `plan.problems 非空應拋 CascadeBlockedError，實得：${String(err)}`,
    )

    // ── 帶外驗證：安全閘在 log 之前 → 零寫入，連 log 都不能有 ────────────────
    const logsAfter = await allLogs()
    assert.equal(logsAfter.length, logsBefore, '不得新增任何 log（安全閘在 log 之前）')
    assert.ok(await readDoc('buffs', 'buff_b'), '目標 buff 應仍存在')
    assert.deepEqual(await readDoc('pilots', 'pb'), stripId(PILOT_B), '引用來源應一字未改')
    assert.equal(await readDoc('meta', 'gameData'), null, '版本仍未 bump')
    console.log(`[b] logs 前後筆數 ${logsBefore} → ${logsAfter.length}`)
  })

  // ── c ──────────────────────────────────────────────────────────────────────
  await t.test('c. plan 後目標本身被刪 → commit 靜默成功並寫入第二筆 delete log（如實記錄實際行為）', async () => {
    const planned = await planCascadeDelete('buff', 'buff_c')
    assert.ok(planned)

    // 失敗注入：把目標本身刪掉（模擬另一位管理員在確認對話框停留期間先刪了它）
    await adminDb.doc('buffs/buff_c').delete()
    const logsBefore = (await allLogs()).length

    // 實際行為：batch.delete 對不存在文件冪等，引用文件的 update 照常成功 → 不拋錯。
    // planCascadeDelete 的「目標不存在 → 回 null」防線只存在於 plan 時；
    // commit 端沒有對應的重驗（docblock 明寫「不會重新掃描」，但那段取捨談的是
    // 引用資料的變動，未涵蓋目標自身消失 → 是否構成缺陷見 defects 記錄）。
    const res = await commitCascadeDelete(planned!)
    assert.ok(res, 'commit 未拋錯並回傳結果（實際行為）')
    assert.equal(res.patchedDocs, 1)
    assert.equal(res.patchCount, 2)

    // ── 帶外驗證最終資料狀態 ─────────────────────────────────────────────────
    assert.equal(await readDoc('buffs', 'buff_c'), null, '目標仍是不存在（刪除冪等）')

    const pc = await readDoc('pilots', 'pc')
    const talent = (pc!.talents as Array<Record<string, unknown>>)[0]
    assert.deepEqual(talent.buffIds, ['buff_keep'], '引用照樣被清除')
    assert.deepEqual(talent.descriptionRefs, {}, 'descriptionRefs 的 key 照樣被清掉')

    const meta = await readDoc('meta', 'gameData')
    const versions = meta?.versions as Record<string, string>
    assert.ok(versions.buffs, '對已消失目標的刪除仍 bump 了 buffs 版本（實際行為）')
    assert.ok(versions.pilots, 'pilots 版本也被 bump')
    assert.equal(versions.buffs, versions.pilots, '共用同一版本時間戳')

    // 第二筆 delete log：快照是 plan 時的 preImage。若目標在視窗內被「刪掉後重建」，
    // 依此 log 還原會回到陳舊內容——這是缺陷面向的證據。
    const logs = await allLogs()
    assert.equal(logs.length, logsBefore + 1, '對已消失的目標仍寫入了一筆 delete log（實際行為）')
    const log = logs.find((l) => l.id === res.logId)
    assert.ok(log, '結果宣稱的 logId 存在')
    assert.equal(log!.action, 'delete')
    assert.equal(log!.targetId, 'buff_c')
    assert.equal((log!.snapshot as { doc: Record<string, unknown> }).doc.name, '丙', '快照是 plan 時的 preImage')
    console.log(`[c] commit 成功 logId=${res.logId}，versions=${JSON.stringify(versions)}，pc.talents[0]=${JSON.stringify(talent)}`)
  })

  // ── e ──────────────────────────────────────────────────────────────────────
  await t.test('e. planned.blockers 非空（missingColls 形狀）→ 依契約 commit 應拒絕', async () => {
    const planned = await planCascadeDelete('buff', 'buff_e')
    assert.ok(planned)

    // 注入：plan 端 missingColls 防線產出的**真實 blocker 形狀**（problems: []）。
    // planCascadeDelete 在 checkCascadeSafety 之後才 push 這種 blocker（cascadeDelete.ts
    // refs.missingColls 分支），所以 commit 端重跑 checkCascadeSafety(plan, snapshot)
    // 永遠重建不出它。CascadePlanResult.blockers 的契約寫明：
    // 「非空表示不可提交。commitCascadeDelete 會再檢一次，不倚賴呼叫端自律」。
    ;(planned!.blockers as unknown[]).push({
      kind: 'problems',
      detail: '以下集合未載入，無法確認是否有引用：pilots',
      problems: [],
    })

    const logsBefore = (await allLogs()).length
    let err: unknown
    try {
      await commitCascadeDelete(planned!)
    } catch (e) {
      err = e
    }

    // 正確的期望行為：blockers 非空 → CascadeBlockedError、零寫入。
    // 若此斷言失敗（commit 靜默成功）＝ commit 的最後一道閘重建不出 missingColls
    // 類 blocker，文件契約不成立 → 真實缺陷，紅測試保留。
    assert.ok(
      err instanceof CascadeBlockedError,
      `planned.blockers 非空應被 commit 最後一道閘擋下，實際：${err === undefined
        ? `未拋錯（buffs/buff_e 現況=${JSON.stringify(await readDoc('buffs', 'buff_e'))}，` +
          `log 筆數 ${logsBefore} → ${(await allLogs()).length}）`
        : String(err)}`,
    )
    assert.ok(await readDoc('buffs', 'buff_e'), '目標不應被刪除')
    assert.equal((await allLogs()).length, logsBefore, '不得新增 log')
  })
})
