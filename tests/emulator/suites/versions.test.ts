// PLAN-030 模擬器整合測試：版本快取語意套件
//
// 核心問題：「meta/gameData 的版本 bump 是否精確、原子、不多不少？」
// 其他 client 的 localStorage 快取失效全靠這份文件——bump 漏鍵 = 某集合的快取
// 永遠供應已刪除的資料；bump 多鍵 = 無辜集合被迫全站重抓；merge 洗掉既有鍵 =
// 先前編輯的失效訊號被抹除。
//
// 通道紀律：待測邏輯（deleteBuff / planCascadeDelete / commitCascadeDelete）一律
// 走 client 路徑（signInAs 後動態 import），驗證一律走 adminDb 帶外通道。
//
//   timeout 240 node --test --test-force-exit --import ./tests/emulator/register.mjs tests/emulator/suites/versions.test.ts

import assert from 'node:assert/strict'
import {
  emuSuite, seedDocs, seedUser, signInAs,
  readDoc, allLogs, ADMIN_USER, PLAIN_USER, adminDb,
} from '../helpers.ts'

/** commitCascadeDelete 的版本值是 new Date().toISOString()：毫秒精度、Z 結尾。 */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** 帶外讀 meta/gameData 的 versions map（無文件回 undefined）。 */
async function metaVersions(): Promise<Record<string, string> | undefined> {
  const meta = await readDoc('meta', 'gameData')
  return meta?.versions as Record<string, string> | undefined
}

emuSuite('versions: meta/gameData 版本 bump 的精確性、原子性與 merge 語意', async (t) => {
  await seedUser(ADMIN_USER, 'OWNER')
  await seedUser(PLAIN_USER, 'USER')

  await seedDocs({
    buffs: [
      // a+f：被 pilots + weapons 引用 → 一次刪除觸及三個集合
      { id: 'buff_a', name: '甲' },
      // b：無任何引用 → 只觸及 buffs 自己
      { id: 'buff_b', name: '乙' },
      // e：連續兩次刪除的版本遞增
      { id: 'buff_e1', name: '戊一' },
      { id: 'buff_e2', name: '戊二' },
      // d1：只有 pilot 引用 → 無兄弟改寫
      { id: 'buff_d1', name: '丁單' },
      // d2：buff_d_sib.descriptionRefs 指向 buff_d_tgt → buff→buff 兄弟改寫
      { id: 'buff_d_tgt', name: '丁目標' },
      {
        id: 'buff_d_sib', name: '丁兄弟',
        description: '賦予[丁目標]',
        descriptionRefs: { 丁目標: { refType: 'buff', refId: 'buff_d_tgt' } },
      },
      // c1：PLAIN 使用者嘗試刪除（會被規則擋下，必須毫髮無傷）
      { id: 'buff_c1', name: '丙一' },
      // c2：plan 與 commit 之間引用來源被刪 → batch 原子失敗
      { id: 'buff_c2', name: '丙二' },
    ],
    pilots: [
      { id: 'p_a',  name: '機師A', talents: [{ name: '天賦A', buffIds: ['buff_a'] }] },
      { id: 'p_d1', name: '機師D', talents: [{ name: '天賦D', buffIds: ['buff_d1'] }] },
      { id: 'p_c2', name: '機師C', talents: [{ name: '天賦C', buffIds: ['buff_c2'] }] },
    ],
    weapons: [
      { id: 'w_a', name: '武器A', skills: [{ name: '武技A', buffIds: ['buff_a'] }] },
    ],
    // 有文件、但完全沒有引用任何目標 → 它的版本鍵永遠不該出現在 bump 裡
    modules: [
      { id: 'm_bystander', name: '旁觀模組', buffIds: [], description: '無引用' },
    ],
  })

  await signInAs(ADMIN_USER)

  // 動態 import：loader 就位後才載入待測模組鏈（client SDK 路徑，走安全規則）
  const { deleteBuff } = await import('../../../src/lib/api/buffs.ts')
  const { planCascadeDelete, commitCascadeDelete } = await import('../../../src/lib/api/cascadeDelete.ts')

  /** buffs 集合的版本時間軸：每次成功刪除後帶外讀回，供 e 案例斷言全程嚴格遞增。 */
  const buffsTimeline: string[] = []

  // ── a. 觸及 buffs+pilots+weapons → 三鍵同值；未觸及集合鍵不得出現 ───────────
  await t.test('a. 刪除觸及三集合 → versions 恰好三鍵、同一時間戳；modules 不得出現', async () => {
    const res = await deleteBuff('buff_a')
    assert.ok(res, 'buff_a 存在，刪除應回傳結果')

    const versions = await metaVersions()
    assert.ok(versions, 'meta/gameData.versions 應已建立')
    console.log('[a] meta.versions =', JSON.stringify(versions))

    // 不多不少：恰好 buffs / pilots / weapons 三鍵（modules 有文件但無引用，不得被 bump）
    assert.deepEqual(
      Object.keys(versions!).sort(),
      ['buffs', 'pilots', 'weapons'],
      '受影響集合恰好三個；未觸及的集合鍵（modules 等）不得出現',
    )
    assert.match(versions!.buffs, ISO_RE, '版本值應為毫秒精度 ISO 時間戳')
    assert.equal(versions!.pilots, versions!.buffs, '同一次刪除的所有鍵應共用同一時間戳')
    assert.equal(versions!.weapons, versions!.buffs, '同一次刪除的所有鍵應共用同一時間戳')

    // 回傳值必須與 DB 一致：呼叫端拿它就地同步 localStorage，寫錯版本號會讓快取永不自癒
    assert.deepEqual(res!.versions, versions, '回傳的 versions 應與 meta/gameData 實際內容一致')

    buffsTimeline.push(versions!.buffs)
  })

  // ── f. updatedAt 為 serverTimestamp 產生的 Timestamp ─────────────────────────
  await t.test('f. updatedAt 欄位存在且為 serverTimestamp 產生的 Timestamp', async () => {
    const meta = await readDoc('meta', 'gameData')
    const updatedAt = meta!.updatedAt as { toDate?: () => Date; toMillis?: () => number } | undefined
    assert.ok(updatedAt, 'updatedAt 欄位應存在')
    assert.equal(typeof updatedAt!.toDate, 'function', '應為 Firestore Timestamp（有 toDate）')
    assert.equal(typeof updatedAt!.toMillis, 'function', '應為 Firestore Timestamp（有 toMillis）')
    assert.equal(updatedAt!.constructor.name, 'Timestamp', '型別應為 Timestamp 而非序列化物件')
    const drift = Math.abs(updatedAt!.toMillis!() - Date.now())
    console.log('[f] updatedAt =', updatedAt!.toDate!().toISOString(), 'drift(ms) =', drift)
    assert.ok(drift < 5 * 60_000, `updatedAt 應接近現在（伺服器時間），實測偏差 ${drift}ms`)
  })

  // ── b. merge 不洗掉既有版本鍵 ────────────────────────────────────────────────
  await t.test('b. 預先種既有版本鍵 → 刪除後 merge 不得洗掉既有鍵與全域版本', async () => {
    // 模擬「先前有人 bump 過 modules」＋舊版全域 fallback 版本
    await adminDb.doc('meta/gameData').set(
      { version: 'global-v0', versions: { modules: '2020-01-01T00:00:00.000Z' } },
      { merge: true },
    )

    const res = await deleteBuff('buff_b')   // 無任何引用 → 只觸及 buffs
    assert.ok(res)
    assert.deepEqual(Object.keys(res!.versions), ['buffs'], '無引用的刪除應只 bump 目標集合')

    const meta = await readDoc('meta', 'gameData')
    const versions = meta!.versions as Record<string, string>
    console.log('[b] meta =', JSON.stringify({ version: meta!.version, versions }))

    assert.equal(versions.modules, '2020-01-01T00:00:00.000Z', '既有的 modules 版本鍵不得被洗掉')
    assert.equal(meta!.version, 'global-v0', '全域 fallback version 欄位不得被動')
    assert.equal(versions.pilots, buffsTimeline[0], '未觸及的 pilots 鍵應維持前次值')
    assert.equal(versions.weapons, buffsTimeline[0], '未觸及的 weapons 鍵應維持前次值')
    assert.deepEqual(
      Object.keys(versions).sort(),
      ['buffs', 'modules', 'pilots', 'weapons'],
      '鍵集合 = 既有鍵 ∪ 本次觸及，不多不少',
    )
    assert.ok(versions.buffs > buffsTimeline[0], 'buffs 應被 bump 成更新的時間戳')

    buffsTimeline.push(versions.buffs)
  })

  // ── e. 連續刪除 → 版本字串嚴格遞增 ──────────────────────────────────────────
  await t.test('e. 連續兩次刪除 → 版本字串嚴格遞增（ISO 字典序）', async () => {
    assert.ok(await deleteBuff('buff_e1'))
    const v3 = (await metaVersions())!.buffs
    assert.ok(await deleteBuff('buff_e2'))
    const v4 = (await metaVersions())!.buffs

    buffsTimeline.push(v3, v4)
    console.log('[e] buffs 版本時間軸 =', JSON.stringify(buffsTimeline))
    for (let i = 1; i < buffsTimeline.length; i++) {
      assert.ok(
        buffsTimeline[i - 1] < buffsTimeline[i],
        `第 ${i} 次與第 ${i + 1} 次刪除的版本應嚴格遞增：${buffsTimeline[i - 1]} !< ${buffsTimeline[i]}`,
      )
    }
  })

  // ── d. targetCollHasSiblingEdits ────────────────────────────────────────────
  await t.test('d. targetCollHasSiblingEdits：無兄弟改寫 false / buff→buff 引用 true', async () => {
    // d1：只有 pilots 引用 → 目標集合（buffs）內沒有兄弟文件被改寫
    const r1 = await deleteBuff('buff_d1')
    assert.ok(r1)
    assert.equal(r1!.targetCollHasSiblingEdits, false, '引用全在其他集合時旗標應為 false')

    // d2：buff_d_sib.descriptionRefs 指向 buff_d_tgt → 兄弟 BUFF 會被級聯改寫
    const r2 = await deleteBuff('buff_d_tgt')
    assert.ok(r2)
    assert.equal(
      r2!.targetCollHasSiblingEdits, true,
      'buff→buff 引用時旗標應為 true（呼叫端不可只用 removeCollectionItem）',
    )

    // 帶外證據：兄弟文件真的被改寫、目標真的被刪
    const sib = await readDoc('buffs', 'buff_d_sib')
    console.log('[d] buff_d_sib after =', JSON.stringify(sib))
    assert.deepEqual(sib!.descriptionRefs, {}, '兄弟 BUFF 的 descriptionRefs 應被清空')
    assert.equal(await readDoc('buffs', 'buff_d_tgt'), null, '目標應已刪除')
    assert.deepEqual(Object.keys(r2!.versions), ['buffs'], '目標與兄弟同屬 buffs → 只 bump 一鍵')
  })

  // ── c1. 規則擋下（PLAIN 使用者）→ 不 bump ───────────────────────────────────
  await t.test('c1. 規則擋下（PLAIN 使用者）→ meta 維持原值、無 log、目標無恙', async () => {
    await signInAs(PLAIN_USER)

    const before = await readDoc('meta', 'gameData')
    const logsBefore = (await allLogs()).length

    await assert.rejects(
      () => deleteBuff('buff_c1'),
      (err: unknown) => {
        const text = String((err as Error)?.message) + String((err as { code?: string })?.code)
        console.log('[c1] rejected with:', text)
        return /permission|denied|insufficient/i.test(text)
      },
      '非管理員的刪除應被安全規則拒絕',
    )

    const after = await readDoc('meta', 'gameData')
    console.log('[c1] versions before =', JSON.stringify(before!.versions),
      '/ after =', JSON.stringify(after!.versions))
    assert.deepEqual(after!.versions, before!.versions, 'meta.versions 必須維持原值')
    assert.equal(
      (after!.updatedAt as { toMillis: () => number }).toMillis(),
      (before!.updatedAt as { toMillis: () => number }).toMillis(),
      'updatedAt 不得變動 → meta 文件完全沒被寫入',
    )
    assert.ok(await readDoc('buffs', 'buff_c1'), '目標 BUFF 應原封不動')
    assert.equal((await allLogs()).length, logsBefore, '規則在 log 階段就擋下 → 不得留任何 log')

    await signInAs(ADMIN_USER)
  })

  // ── c2. commit 失敗（plan 後引用來源被刪）→ 不 bump ─────────────────────────
  await t.test('c2. plan 後引用來源被刪 → batch 原子失敗、meta 維持原值', async () => {
    const planned = await planCascadeDelete('buff', 'buff_c2')
    assert.ok(planned, 'buff_c2 存在，plan 應成功')
    assert.equal(planned!.blockers.length, 0, 'plan 當下無 blocker')

    // 失敗注入：plan 與 commit 之間，引用來源文件被別人刪掉
    // → batch.update(pilots/p_c2) 打在不存在的文件上 → 整個 batch 原子失敗
    await adminDb.doc('pilots/p_c2').delete()

    const before = await readDoc('meta', 'gameData')
    const logsBefore = (await allLogs()).length

    let caught: unknown
    try {
      await commitCascadeDelete(planned!)
    } catch (err) {
      caught = err
    }
    assert.ok(caught, 'commit 應失敗')
    assert.equal((caught as Error).name, 'CascadeCommitError', '應以 CascadeCommitError 失敗')
    console.log('[c2] error =', (caught as Error).message)

    const after = await readDoc('meta', 'gameData')
    assert.deepEqual(after!.versions, before!.versions, 'batch 原子失敗 → meta.versions 必須維持原值')
    assert.equal(
      (after!.updatedAt as { toMillis: () => number }).toMillis(),
      (before!.updatedAt as { toMillis: () => number }).toMillis(),
      'updatedAt 不得變動 → 版本 bump 與資料變更同批失敗',
    )
    assert.ok(await readDoc('buffs', 'buff_c2'), '目標 BUFF 不得被刪（batch 原子性）')

    // 聲明行為（cascadeDelete.ts CascadeCommitError 註解：「log 已寫入、但資料 batch
    // 提交失敗……只是歷史頁會多一筆與事實不符的記錄」）：孤兒 log 存在且 id 與錯誤一致
    const logsAfter = await allLogs()
    assert.equal(logsAfter.length, logsBefore + 1, '聲明行為：留下恰好一筆孤兒 delete log')
    const orphan = logsAfter.find((l) => l.id === (caught as { logId?: string }).logId)
    assert.ok(orphan, '孤兒 log 的文件 ID 應與 CascadeCommitError.logId 一致')
    assert.equal(orphan!.action, 'delete')
    assert.equal(orphan!.targetId, 'buff_c2')
  })
})
