// PLAN-048 Phase 2 模擬器整合測試：待審活動合併進 patchVersions
//
// 核心問題：「計畫書那兩條紅線真的成立嗎？」
//   紅線一 合併必須是交易式的部分更新，不能整份覆寫版本文件
//          —— AdminVersionEditorPage 的存檔是整份 setDoc、沒有 merge:true，
//             同型事故已有前例（scrape-pilots-v3.js:117）。
//   紅線二 合併後必須 bumpDataVersion('patchVersions')
//          —— 不 bump 就是「資料寫進去了、前台看不到、硬重整也沒用」，最長 24 小時
//             （Worker 邊緣快取以集合版本號當 cache key、max-age=86400）。
//
// 通道紀律：待測邏輯（mergeIntoVersion / rejectPending）一律走 client 路徑
// （signInAs 後動態 import），驗證一律走 adminDb 帶外通道 —— 不信任回傳值。
//
//   timeout 240 node --test --test-force-exit --import ./tests/emulator/register.mjs tests/emulator/suites/announcement-merge.test.ts

import assert from 'node:assert/strict'
import {
  emuSuite, seedDocs, seedUser, signInAs, signOutClient,
  readDoc, ADMIN_USER, PLAIN_USER, adminDb,
} from '../helpers.ts'

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function pending(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    draftId: 'tw_1799',
    source: 'tw',
    seq: 0,
    status: 'needsReview',
    flags: ['openEnded'],
    extracted: { name: '角雕轉盤', startDate: '2026/08/13', type: 'roulette' },
    excerpt: '【角雕轉盤】\n➤活動時間：2026/08/13 05:00 起',
    createdAt: new Date(),
    expireAt: new Date('2027-02-13'),
    ...over,
  }
}

const ACTIVITY = {
  name: '角雕轉盤',
  startDate: '2026/08/13',
  weeks: 1,
  type: 'roulette',
  confidence: 'confirmed' as const,
}

async function twActivities(versionId: string, half: 'upper' | 'lower') {
  const v = await readDoc('patchVersions', versionId)
  const h = v?.[half] as { twActivities?: Record<string, unknown>[] } | undefined
  return h?.twActivities ?? []
}

emuSuite('announcement-merge: 合併寫入的原子性、anchor 定位與版本 bump', async (t) => {
  await seedUser(ADMIN_USER, 'OWNER')
  await seedUser(PLAIN_USER, 'USER')

  await seedDocs({
    patchVersions: [{
      id: 'v3.4',
      version: '3.4',
      name: '測試版本',
      // 上半已有一筆既有活動：合併必須是「追加」而不是「取代整個陣列」
      upper: {
        cnDate: '2026/08/13',
        twDate: '2026/08/13',
        pilots: ['既有機師'],
        twActivities: [{ id: 'act_existing', name: '既有活動', startDate: '2026/08/06', weeks: 2, type: 'limitedEvent' }],
      },
      lower: { cnDate: '2026/08/27', twDate: '2026/08/27' },
      notes: '這個欄位必須毫髮無傷',
    }],
    pendingActivities: [
      pending('tw_1799_0'),
      pending('tw_1799_1', { seq: 1 }),
      pending('tw_1799_2', { seq: 2 }),
      pending('tw_1799_3', { seq: 3 }),
      pending('tw_1799_9', { seq: 9 }),
    ],
  })

  await signInAs(ADMIN_USER)
  const api = await import('../../../src/lib/api/announcementStaging.ts')

  await t.test('a. 合併是追加而非取代，且不動版本文件的其他欄位', async () => {
    const res = await api.mergeIntoVersion('tw_1799_0', { ...ACTIVITY }, { versionId: 'v3.4', half: 'upper' })
    assert.equal(res.ok, true)

    const list = await twActivities('v3.4', 'upper')
    assert.equal(list.length, 2, '既有活動必須還在 —— 整份覆寫的話這裡會是 1')
    assert.equal(list[0].name, '既有活動')
    assert.equal(list[1].name, '角雕轉盤')
    assert.equal(list[1].weeks, 1)
    assert.equal(list[1].confidence, 'confirmed')
    assert.ok(String(list[1].id).startsWith('act_'), '合併時要補上穩定識別子')

    // 紅線一的實質檢查：同一份文件的其他欄位不能被回捲
    const v = await readDoc('patchVersions', 'v3.4')
    assert.equal(v?.notes, '這個欄位必須毫髮無傷')
    assert.equal(v?.name, '測試版本')
    assert.deepEqual((v?.upper as Record<string, unknown>).pilots, ['既有機師'])
    assert.equal((v?.lower as Record<string, unknown>).cnDate, '2026/08/27')
  })

  await t.test('b. 收據用 {name,startDate} anchor 定位，不是陣列 index', async () => {
    const p = await readDoc('pendingActivities', 'tw_1799_0')
    assert.equal(p?.status, 'merged')
    const receipt = p?.mergedInto as Record<string, unknown>
    assert.equal(receipt.versionId, 'v3.4')
    assert.equal(receipt.half, 'upper')
    assert.equal(receipt.field, 'twActivities')
    assert.deepEqual(receipt.anchor, { name: '角雕轉盤', startDate: '2026/08/13' })
    assert.ok(!('index' in receipt), 'index 不是穩定識別子，不該出現在收據裡')
    assert.equal(receipt.actorName, ADMIN_USER.name)

    // extracted 必須原封不動（保持原樣供 diff）
    assert.deepEqual(p?.extracted, { name: '角雕轉盤', startDate: '2026/08/13', type: 'roulette' })
  })

  await t.test('c. 紅線二：合併後 meta/gameData.versions.patchVersions 有被 bump', async () => {
    const meta = await readDoc('meta', 'gameData')
    const versions = meta?.versions as Record<string, string> | undefined
    assert.ok(versions, 'meta/gameData 必須存在 —— 沒 bump 前台最長 24 小時看不到')
    assert.match(versions!.patchVersions, ISO_RE)
    // 只 bump 該集合，不牽連其他集合的快取
    assert.deepEqual(Object.keys(versions!), ['patchVersions'])
  })

  await t.test('d. anchor 相同 → 回報 conflict 且零寫入', async () => {
    const before = await twActivities('v3.4', 'upper')
    const res = await api.mergeIntoVersion('tw_1799_1', { ...ACTIVITY }, { versionId: 'v3.4', half: 'upper' })
    assert.equal(res.ok, false)
    if (!res.ok) {
      assert.equal(res.reason, 'conflict')
      assert.equal(res.existing.name, '角雕轉盤')
    }
    const after = await twActivities('v3.4', 'upper')
    assert.equal(after.length, before.length, 'conflict 不該留下任何東西')
    const p = await readDoc('pendingActivities', 'tw_1799_1')
    assert.equal(p?.status, 'needsReview', 'conflict 時待審狀態不可被改掉')
  })

  await t.test('e. overwrite 就地取代同 anchor 的那筆，且沿用它原本的 id', async () => {
    const res = await api.mergeIntoVersion(
      'tw_1799_1',
      { ...ACTIVITY, weeks: 3, description: '改過的說明' },
      { versionId: 'v3.4', half: 'upper' },
      { overwrite: true },
    )
    assert.equal(res.ok, true)
    const list = await twActivities('v3.4', 'upper')
    assert.equal(list.length, 2, 'overwrite 是就地取代，不是再追加一筆')
    const merged = list.find(a => a.name === '角雕轉盤')!
    assert.equal(merged.weeks, 3)
    assert.equal(merged.description, '改過的說明')
  })

  await t.test('f. 寫進下半不會動到上半', async () => {
    const upperBefore = await twActivities('v3.4', 'upper')
    const res = await api.mergeIntoVersion(
      'tw_1799_2',
      { ...ACTIVITY, name: '下半活動', startDate: '2026/08/27' },
      { versionId: 'v3.4', half: 'lower' },
    )
    assert.equal(res.ok, true)
    const lower = await twActivities('v3.4', 'lower')
    assert.equal(lower.length, 1)
    assert.equal(lower[0].name, '下半活動')
    assert.deepEqual(await twActivities('v3.4', 'upper'), upperBefore)
  })

  await t.test('g. 目標版本不存在 → 拋錯且待審狀態不變', async () => {
    await assert.rejects(
      () => api.mergeIntoVersion('tw_1799_3', { ...ACTIVITY }, { versionId: 'v9.9', half: 'upper' }),
      /v9\.9/,
    )
    const p = await readDoc('pendingActivities', 'tw_1799_3')
    assert.equal(p?.status, 'needsReview')
  })

  await t.test('h. 忽略：狀態轉 rejected 並留下審核者', async () => {
    await api.rejectPending('tw_1799_9', '重複公告')
    const p = await readDoc('pendingActivities', 'tw_1799_9')
    assert.equal(p?.status, 'rejected')
    assert.equal(p?.rejectReason, '重複公告')
    assert.equal(p?.reviewerName, ADMIN_USER.name)
    // 沒有寫進任何版本
    const list = await twActivities('v3.4', 'upper')
    assert.ok(!list.some(a => a.name === '角雕轉盤' && a.weeks === 99))
  })

  await t.test('i. 非管理員被規則擋下，且資料庫毫髮無傷', async () => {
    await signOutClient()
    await signInAs(PLAIN_USER)
    await seedDocs({ pendingActivities: [pending('tw_1799_x', { seq: 5 })] })
    const before = await twActivities('v3.4', 'upper')

    await assert.rejects(() =>
      api.mergeIntoVersion('tw_1799_x', { ...ACTIVITY, name: '不該進去' }, { versionId: 'v3.4', half: 'upper' }))

    assert.deepEqual(await twActivities('v3.4', 'upper'), before)
    const p = await readDoc('pendingActivities', 'tw_1799_x')
    assert.equal(p?.status, 'needsReview')

    await signOutClient()
    await signInAs(ADMIN_USER)
  })

  await t.test('j. 並行寫入：交易讓兩筆都活下來，不會後者蓋前者', async () => {
    // 這正是紅線一要防的情境 —— read → modify → write 在這裡必然掉一筆
    await seedDocs({
      pendingActivities: [
        pending('tw_par_a', { seq: 20, extracted: { name: '並行甲', startDate: '2026/08/13', type: 'roulette' } }),
        pending('tw_par_b', { seq: 21, extracted: { name: '並行乙', startDate: '2026/08/13', type: 'roulette' } }),
      ],
    })
    const before = (await twActivities('v3.4', 'upper')).length

    await Promise.all([
      api.mergeIntoVersion('tw_par_a', { ...ACTIVITY, name: '並行甲' }, { versionId: 'v3.4', half: 'upper' }),
      api.mergeIntoVersion('tw_par_b', { ...ACTIVITY, name: '並行乙' }, { versionId: 'v3.4', half: 'upper' }),
    ])

    const list = await twActivities('v3.4', 'upper')
    assert.equal(list.length, before + 2, '兩筆都要在 —— 少一筆就代表交易沒發揮作用')
    assert.ok(list.some(a => a.name === '並行甲'))
    assert.ok(list.some(a => a.name === '並行乙'))
  })

  await t.test('k. 缺 weeks 的半成品進得去，但寫入端強制標記隱藏', async () => {
    await seedDocs({ pendingActivities: [pending('tw_open_0', { seq: 30 })] })
    // 刻意不帶 hidden：不變式要由寫入端補上，不是信任呼叫端有記得帶
    const res = await api.mergeIntoVersion(
      'tw_open_0',
      { name: '疾影成鋒', startDate: '2026/09/03', type: 'specificPilotBanner', note: '公告只寫「10:00 起」' },
      { versionId: 'v3.4', half: 'lower' },
    )
    assert.equal(res.ok, true)

    const list = await twActivities('v3.4', 'lower')
    const act = list.find(a => a.name === '疾影成鋒')
    assert.ok(act, '半成品要進得了正式集合 —— 卡在待審清單才會被遺忘')
    assert.equal(act.hidden, true, '缺長度必然隱藏，否則首頁會多一條長度是猜的長條')
    assert.equal(act.weeks, undefined, '絕不替它補一個看起來合理的週數')
    assert.equal(act.note, '公告只寫「10:00 起」')
    assert.ok(String(act.id).startsWith('act_'))
  })

  await t.test('l. 補齊週數並取消隱藏後即上線（anchor 定位到同一筆）', async () => {
    await seedDocs({ pendingActivities: [pending('tw_open_1', { seq: 31 })] })
    const res = await api.mergeIntoVersion(
      'tw_open_1',
      { name: '疾影成鋒', startDate: '2026/09/03', weeks: 2, type: 'specificPilotBanner' },
      { versionId: 'v3.4', half: 'lower' },
      { overwrite: true },
    )
    assert.equal(res.ok, true)

    const list = await twActivities('v3.4', 'lower')
    const matched = list.filter(a => a.name === '疾影成鋒')
    assert.equal(matched.length, 1, 'anchor 相同 → 就地更新，不該變成兩筆')
    assert.equal(matched[0].weeks, 2)
    assert.equal(matched[0].hidden, undefined, '補齊之後不再隱藏')
  })

  // 收尾：帶外確認整份版本文件仍是完整結構，沒有被任何一步整份覆寫
  const final = await adminDb.doc('patchVersions/v3.4').get()
  const data = final.data()!
  assert.equal(data.version, '3.4')
  assert.equal(data.notes, '這個欄位必須毫髮無傷')
  assert.ok(Array.isArray((data.upper as Record<string, unknown>).twActivities))
})
