// PLAN-030 模擬器破壞性測試：邊界與上限（batchLimit / snapshotSize）
//
// 核心問題：「安全閘算的邊界跟 Firestore 真實邊界一致嗎？」
//
//   a. 510 份引用 → ops=512 > 500 → CascadeBlockedError(batchLimit)，零寫入
//   b. 120 份引用 → 成功；帶外抽驗 + log patches 數
//   f. 498 份引用 → ops 恰好 = 500（閘門放行的極限）→ Firestore 真的收得下嗎？
//      （若模擬器把 serverTimestamp transform 另計一個 op，這裡會爆出閘門差一的缺陷）
//   c. 目標塞 950,000 個英文字符 → snapshotSize 擋下、零寫入
//   d. 目標塞 320,000 個中文字（String.length=32萬 < 90萬預算、UTF-8=96萬 bytes > 預算）
//      → 也要被擋——驗證閘門用 TextEncoder 而非 String.length
//   e. 校準：adminDb 直寫 ~950KB snapshot 假 log，模擬器收不收？
//      （另加 ~1.1MB 反向探針，確認模擬器是否真的 enforce 1MiB 上限）
//
//   timeout 240 node --test --test-force-exit --import ./tests/emulator/register.mjs tests/emulator/suites/limits.test.ts

import assert from 'node:assert/strict'
import {
  emuSuite, seedDocs, seedUser, signInAs, readDoc, allLogs,
  ADMIN_USER, adminDb, clearProject,
} from '../helpers.ts'

// ─── 種資料小工具 ────────────────────────────────────────────────────────────

const psId = (prefix: string, i: number) => `${prefix}${String(i).padStart(4, '0')}`

/**
 * 種 count 份 pilotSkills 文件，各含一筆對 targetBuffId 的頂層 buffIds 引用
 * （站點 `pilotSkills.buffIds`，一份文件恰好產生一個 DocMutation）。
 * admin WriteBatch 自己也有 500 上限，分批 400 一組。
 */
async function seedRefDocs(prefix: string, targetBuffId: string, count: number): Promise<void> {
  const CHUNK = 400
  for (let start = 0; start < count; start += CHUNK) {
    const batch = adminDb.batch()
    const end = Math.min(start + CHUNK, count)
    for (let i = start; i < end; i++) {
      batch.set(adminDb.collection('pilotSkills').doc(psId(prefix, i)), {
        name: `技能${prefix}${i}`,
        buffIds: [targetBuffId],
      })
    }
    await batch.commit()
  }
}

/** clearProject 連 Auth 帳號一起清，重置後必須重 seedUser + signInAs。 */
async function resetWithAdmin(): Promise<void> {
  await clearProject()
  await seedUser(ADMIN_USER, 'OWNER')
  await signInAs(ADMIN_USER)
}

// ─── 套件 ────────────────────────────────────────────────────────────────────

emuSuite('limits: 邊界與上限——安全閘 vs Firestore 真實邊界', async (t) => {
  await seedUser(ADMIN_USER, 'OWNER')
  await signInAs(ADMIN_USER)

  // 動態 import：確保 loader 已就位後才載入待測模組鏈
  const { deleteBuff } = await import('../../../src/lib/api/buffs.ts')
  const { CascadeBlockedError } = await import('../../../src/lib/api/cascadeDelete.ts')
  const { SNAPSHOT_SIZE_BUDGET_BYTES, FIRESTORE_BATCH_LIMIT } =
    await import('../../../src/utils/cascadePatch.ts')

  // ══ a. 510 份引用 → batchLimit 擋下且零寫入 ═══════════════════════════════
  await seedDocs({ buffs: [{ id: 'buff_batch_over', name: '批次超限' }] })
  await seedRefDocs('ps_a_', 'buff_batch_over', 510)

  await t.test('a. 510 份引用 → CascadeBlockedError(batchLimit)、零寫入', async (tc) => {
    await assert.rejects(deleteBuff('buff_batch_over'), (err: unknown) => {
      assert.ok(
        err instanceof CascadeBlockedError,
        `應拋 CascadeBlockedError，實得：${String(err)}`,
      )
      const blockers = (err as InstanceType<typeof CascadeBlockedError>).blockers
      assert.deepEqual(
        blockers.map((b) => b.kind), ['batchLimit'],
        '應恰有一個 batchLimit blocker（無 problems / snapshotSize 混入）',
      )
      const b = blockers[0] as { kind: 'batchLimit'; ops: number; limit: number }
      tc.diagnostic(`batchLimit blocker 實測：ops=${b.ops} limit=${b.limit}`)
      assert.equal(b.ops, 512, '510 份 update + 1 deleteDoc + 1 版本 bump = 512 ops')
      assert.equal(b.limit, FIRESTORE_BATCH_LIMIT)
      return true
    })

    // 帶外驗證：零寫入（資料原封、連 log 都沒有、版本文件不存在）
    const target = await readDoc('buffs', 'buff_batch_over')
    assert.equal(target?.name, '批次超限', '目標文件應原封不動')
    assert.deepEqual((await readDoc('pilotSkills', psId('ps_a_', 0)))?.buffIds,
      ['buff_batch_over'], '第一份引用來源應原封不動')
    assert.deepEqual((await readDoc('pilotSkills', psId('ps_a_', 509)))?.buffIds,
      ['buff_batch_over'], '最後一份引用來源應原封不動')
    assert.equal((await allLogs()).length, 0, '不得留下任何 changeHistory log')
    assert.equal(await readDoc('meta', 'gameData'), null, '版本文件不得被建立')
  })

  // ══ b. 120 份引用 → 成功；抽驗 + log patches 數 ═══════════════════════════
  await resetWithAdmin()
  await seedDocs({ buffs: [{ id: 'buff_batch_ok', name: '批次可行' }] })
  await seedRefDocs('ps_b_', 'buff_batch_ok', 120)

  await t.test('b. 120 份引用 → 成功；抽驗數份 + log patches 數正確', async (tc) => {
    const res = await deleteBuff('buff_batch_ok')
    assert.ok(res, '目標存在，應回傳結果')
    assert.equal(res!.patchedDocs, 120)
    assert.equal(res!.patchCount, 120)

    // 帶外驗證
    assert.equal(await readDoc('buffs', 'buff_batch_ok'), null, '目標應已刪除')
    for (const i of [0, 57, 119]) {
      const d = await readDoc('pilotSkills', psId('ps_b_', i))
      assert.deepEqual(d?.buffIds, [], `${psId('ps_b_', i)} 的 buffIds 應被清空`)
      assert.equal(d?.name, `技能ps_b_${i}`, '未涉及欄位不得被動到')
    }
    const logs = await allLogs()
    assert.equal(logs.length, 1, '應恰有一筆 delete log')
    assert.equal(logs[0].action, 'delete')
    assert.equal(logs[0].targetId, 'buff_batch_ok')
    const snapshot = logs[0].snapshot as { doc: Record<string, unknown>; patches: unknown[] }
    tc.diagnostic(`log snapshot.patches.length=${snapshot.patches.length}`)
    assert.equal(snapshot.patches.length, 120, '修補單應 120 筆（每份文件一筆 arrayRemove）')
    assert.equal(snapshot.doc.name, '批次可行', '快照應含被刪文件本體')

    const meta = await readDoc('meta', 'gameData')
    const versions = meta?.versions as Record<string, string>
    assert.ok(versions?.buffs && versions?.pilotSkills, '兩個受影響集合都應被 bump')
    assert.equal(versions.buffs, versions.pilotSkills, '同一次刪除應共用同一版本時間戳')
  })

  // ══ f. 邊界校準：498 份引用 → ops 恰好 = 500（閘門放行極限）═══════════════
  // 這是本套件核心問題的直接對決：閘門認為 500 ops 可行（只擋 > 500），
  // Firestore 上限也是 500 mutation/batch → 真實提交必須成功。
  // 若模擬器把 meta 寫入裡的 serverTimestamp transform 另計一個 op（舊版行為），
  // 這裡會以 CascadeCommitError 爆出「閘門差一」的真實缺陷。
  await resetWithAdmin()
  await seedDocs({ buffs: [{ id: 'buff_edge', name: '邊界五百' }] })
  await seedRefDocs('ps_f_', 'buff_edge', 498)

  await t.test('f. 498 份引用（恰好 500 ops）→ 閘門放行且 Firestore 真的收下', async (tc) => {
    const res = await deleteBuff('buff_edge')   // 498 update + 1 delete + 1 meta = 500
    assert.ok(res, '恰在邊界上的刪除應成功')
    assert.equal(res!.patchedDocs, 498)
    tc.diagnostic(`邊界提交成功：patchedDocs=${res!.patchedDocs}（batch 共 500 ops）`)

    assert.equal(await readDoc('buffs', 'buff_edge'), null, '目標應已刪除')
    for (const i of [0, 497]) {
      assert.deepEqual((await readDoc('pilotSkills', psId('ps_f_', i)))?.buffIds, [],
        `${psId('ps_f_', i)} 的 buffIds 應被清空`)
    }
    const logs = await allLogs()
    assert.equal(logs.length, 1)
    assert.equal((logs[0].snapshot as { patches: unknown[] }).patches.length, 498)
  })

  // ══ c / d. snapshotSize：英文 bytes vs 中文 bytes ═════════════════════════
  await resetWithAdmin()
  // 分兩次 seed：單一 admin batch 塞兩份近 1MB 文件沒必要冒 payload 風險
  await seedDocs({ buffs: [{ id: 'buff_size_en', name: '英文長文', lore: 'a'.repeat(950_000) }] })
  await seedDocs({ buffs: [{ id: 'buff_size_zh', name: '中文長文', lore: '中'.repeat(320_000) }] })

  await t.test('c. 950KB 英文 lore → snapshotSize 擋下、零寫入', async (tc) => {
    await assert.rejects(deleteBuff('buff_size_en'), (err: unknown) => {
      assert.ok(err instanceof CascadeBlockedError, `應拋 CascadeBlockedError，實得：${String(err)}`)
      const blockers = (err as InstanceType<typeof CascadeBlockedError>).blockers
      assert.deepEqual(blockers.map((b) => b.kind), ['snapshotSize'])
      const b = blockers[0] as { kind: 'snapshotSize'; bytes: number; limit: number }
      tc.diagnostic(`snapshotSize blocker 實測：bytes=${b.bytes} limit=${b.limit}`)
      assert.ok(b.bytes > SNAPSHOT_SIZE_BUDGET_BYTES,
        `量得 ${b.bytes} bytes 應超過預算 ${SNAPSHOT_SIZE_BUDGET_BYTES}`)
      assert.equal(b.limit, SNAPSHOT_SIZE_BUDGET_BYTES)
      return true
    })
    const back = await readDoc('buffs', 'buff_size_en')
    assert.equal((back?.lore as string)?.length, 950_000, '目標文件應原封不動')
    assert.equal((await allLogs()).length, 0, '不得留下任何 log')
    assert.equal(await readDoc('meta', 'gameData'), null, '版本文件不得被建立')
  })

  await t.test('d. 32 萬中文字（UTF-8 ≈ 960KB）→ 也要被擋（TextEncoder 而非 String.length）', async (tc) => {
    // 陷阱說明：'中'.repeat(320000) 的 String.length = 320,000 < 900,000 預算，
    // 若閘門誤用 length 這次刪除會被放行、log 寫入時才在 Firestore 1MiB 上爆掉。
    // UTF-8 真實位元組 = 320,000 × 3 = 960,000 > 900,000 → 必須在閘門就擋下。
    await assert.rejects(deleteBuff('buff_size_zh'), (err: unknown) => {
      assert.ok(err instanceof CascadeBlockedError, `應拋 CascadeBlockedError，實得：${String(err)}`)
      const blockers = (err as InstanceType<typeof CascadeBlockedError>).blockers
      assert.deepEqual(blockers.map((b) => b.kind), ['snapshotSize'])
      const b = blockers[0] as { kind: 'snapshotSize'; bytes: number; limit: number }
      tc.diagnostic(
        `中文快照實測：blocker.bytes=${b.bytes}（UTF-8）；` +
        `對照 String.length 口徑僅約 320,000 + 包裝 < ${SNAPSHOT_SIZE_BUDGET_BYTES}`,
      )
      assert.ok(b.bytes >= 960_000,
        `bytes 應以 UTF-8 計（≥ 960,000），實得 ${b.bytes}——若閘門用 String.length 根本不會走到這裡`)
      return true
    })
    const back = await readDoc('buffs', 'buff_size_zh')
    assert.equal((back?.lore as string)?.length, 320_000, '目標文件應原封不動')
    assert.equal((await allLogs()).length, 0, '不得留下任何 log')
    assert.equal(await readDoc('meta', 'gameData'), null, '版本文件不得被建立')
  })

  // ══ e. 校準安全邊際：模擬器對 ~950KB snapshot log 的實際受理 ══════════════
  await t.test('e. adminDb 直寫 ~950KB snapshot 假 log → 模擬器應收下（900KB 預算保守）', async (tc) => {
    // 950KB 介於預算（900,000）與 Firestore 文件上限（1,048,576）之間：
    // 收下 → 真實天花板在 950KB 之上 → 900KB 預算至少有 50KB 真實餘裕，保守成立。
    await adminDb.collection('changeHistory').doc('calib_950k').set({
      target: 'buff', action: 'delete',
      targetId: 'calib', targetName: '校準950K',
      actorUid: 'calib', actorName: '校準腳本',
      at: new Date(), expireAt: new Date(),
      snapshot: { doc: { lore: 'x'.repeat(950_000) }, patches: [] },
    })
    const back = await readDoc('changeHistory', 'calib_950k')
    const loreBack = (back?.snapshot as { doc?: { lore?: string } })?.doc?.lore ?? ''
    assert.equal(loreBack.length, 950_000, '950KB snapshot 應被收下且讀回保真')
    tc.diagnostic(`950KB 假 log：模擬器收下，讀回 lore.length=${loreBack.length}`)

    // 反向探針：~1.1MB（> 1MiB = 1,048,576）。模擬器若收下 = 它根本沒 enforce
    // 文件大小上限，上面的「收下」對正式環境的參考價值就要打折——結果記進報告。
    let probe: string
    try {
      await adminDb.collection('changeHistory').doc('calib_1m1').set({
        target: 'buff', action: 'delete',
        targetId: 'calib2', targetName: '校準1.1M',
        actorUid: 'calib', actorName: '校準腳本',
        at: new Date(), expireAt: new Date(),
        snapshot: { doc: { lore: 'y'.repeat(1_100_000) }, patches: [] },
      })
      probe = 'accepted（模擬器未 enforce 1MiB 上限）'
    } catch (err) {
      probe = `rejected：${err instanceof Error ? err.message : String(err)}`
    }
    tc.diagnostic(`1.1MB 反向探針：${probe}`)
    // 探針不做硬斷言：它量的是模擬器環境屬性，不是待測程式的行為；結果記入 notes
  })
})
