// PLAN-030 模擬器整合測試：冒煙套件
//
// 驗證 harness 管線本身可用：loader 注入替身 → 真正的 deleteBuff 打模擬器 →
// 帶外斷言資料庫狀態。各攻擊維度的深度測試在同目錄其他套件。
//
//   node --test --test-force-exit --import ./tests/emulator/register.mjs tests/emulator/suites/smoke.test.ts

import assert from 'node:assert/strict'
import {
  emuSuite, seedDocs, seedUser, signInAs,
  readDoc, allLogs, ADMIN_USER,
} from '../helpers.ts'

emuSuite('smoke: 端到端刪除 buff —— 級聯清引用、寫 log、bump 版本', async () => {
  await seedUser(ADMIN_USER, 'OWNER')
  await seedDocs({
    buffs: [{ id: 'buff_過熱', name: '過熱', maxStack: 5 }],
    pilots: [{
      id: 'p1', name: '測試機師',
      talents: [{
        name: '天賦A',
        buffIds: ['buff_過熱@3', 'buff_留下'],
        description: '賦予[過熱]',
        descriptionRefs: { 過熱: { refType: 'buff', refId: 'buff_過熱' } },
      }],
    }],
  })
  await signInAs(ADMIN_USER)

  // 動態 import：確保 loader 已就位後才載入待測模組鏈
  const { deleteBuff } = await import('../../../src/lib/api/buffs.ts')
  const res = await deleteBuff('buff_過熱')

  assert.ok(res, 'deleteBuff 應回傳結果（目標存在）')

  // ── 帶外驗證：不信任回傳值，直接看資料庫 ──────────────────────────────────
  assert.equal(await readDoc('buffs', 'buff_過熱'), null, '目標文件應已刪除')

  const p1 = await readDoc('pilots', 'p1')
  const talent = (p1?.talents as Array<Record<string, unknown>>)[0]
  assert.deepEqual(talent.buffIds, ['buff_留下'], '@3 元素應被精確移除、無辜元素保留')
  assert.deepEqual(talent.descriptionRefs, {}, 'descriptionRefs 的 key 應被清掉')
  assert.equal(talent.description, '賦予[過熱]', '正文不應被改動（錨點與綁定分離）')

  const logs = await allLogs()
  assert.equal(logs.length, 1, '應恰有一筆 delete log')
  const log = logs[0]
  assert.equal(log.action, 'delete')
  assert.equal(log.targetId, 'buff_過熱')
  const snapshot = log.snapshot as { doc: Record<string, unknown>; patches: unknown[] }
  assert.equal(snapshot.doc.name, '過熱', '快照應含被刪文件本體')
  assert.equal(snapshot.patches.length, 2, '修補單應含 arrayRemove + mapKeyDelete 各一')

  const meta = await readDoc('meta', 'gameData')
  const versions = meta?.versions as Record<string, string>
  assert.ok(versions.buffs, '目標集合版本應被 bump')
  assert.ok(versions.pilots, '被改寫集合版本應被 bump')
  assert.equal(versions.buffs, versions.pilots, '同一次刪除應共用同一版本時間戳')

  assert.equal(res!.targetCollHasSiblingEdits, false, '無 buff→buff 引用時旗標應為 false')
  assert.equal(res!.patchedDocs, 1)
  assert.equal(res!.patchCount, 2)
})
