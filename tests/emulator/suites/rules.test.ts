// PLAN-030 模擬器整合測試：安全規則互動套件
//
// 核心問題：「規則會不會放過不該放的、擋住不該擋的？」
// 級聯刪除的關鍵防線是 changeHistory 的 create:isAdmin —— 決策十讓「先寫 log 成功
// 才動資料」，於是 log 寫入被規則擋下 = 整次刪除中止、資料毫髮無傷。本套件驗證：
//   a. role=USER 呼叫 deleteBuff → 中止、資料原封、無 log
//   b. 未登入 → 同樣中止
//   c. append-only：連管理員都不能 update / delete 既有 log（稽核價值核心）
//   d. 對照組：管理員正常刪除成功（級聯 + log + 版本 bump 全套）
//   e. 一般使用者直寫 buffs / meta/gameData / changeHistory → 全部被拒
//   f. 管理員完整 batch（資料更新 + meta/gameData 寫入）成功
//   g. create 綁定 actorUid（Phase C 發現③修正後）：冒名他人的 actorUid 被規則
//      擋下、actorUid==本人放行、append-only 仍擋 delete。防「偽造嫁禍」缺口。
//
// 執行順序刻意為 a → b → e → d → c → f → g：讓案例 c 竄改的是案例 d 經 client 路徑
// 真實寫入的 log（而非人造種子），更貼近「管理員想抹除自己操作記錄」的實際威脅。
//
//   timeout 240 node --test --test-force-exit --import ./tests/emulator/register.mjs tests/emulator/suites/rules.test.ts

import assert from 'node:assert/strict'
import {
  addDoc, collection, deleteDoc, doc, getDocsFromServer,
  serverTimestamp, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore'
import {
  emuSuite, seedDocs, seedUser, signInAs, signOutClient,
  readDoc, allLogs, ADMIN_USER, PLAIN_USER,
} from '../helpers.ts'
// client 通道的 db：案例 c / e / f 直接以 client SDK 探測規則（走完整規則路徑）
import { db } from '../firebase-stub.ts'

// ─── 共用斷言 ────────────────────────────────────────────────────────────────

/** 斷言 promise 以 Firestore permission-denied 拒絕（其他錯誤碼一律視為失敗）。 */
async function expectPermissionDenied(p: Promise<unknown>, label: string): Promise<void> {
  await assert.rejects(
    p,
    (err: unknown) => {
      const e = err as { code?: unknown; message?: unknown }
      assert.equal(
        e.code, 'permission-denied',
        `${label}：預期 permission-denied，實得 code=${String(e.code)} message=${String(e.message)}`,
      )
      return true
    },
    `${label}：應被安全規則拒絕，卻成功了`,
  )
}

// ─── 種子資料（宣告成常數，方便逐案例斷言「原封不動」）───────────────────────

const SEED_TALENT = {
  name: '天賦A',
  buffIds: ['buff_a', 'buff_target@2'],
  description: '賦予[甲盾]與[過熱]',
  descriptionRefs: {
    甲盾: { refType: 'buff', refId: 'buff_a' },
    過熱: { refType: 'buff', refId: 'buff_target' },
  },
}
const SEED_PILOT_DOC = { name: '測試機師', talents: [SEED_TALENT] }

emuSuite('rules: 安全規則互動 —— 級聯刪除每一步都受規則保護', async (t) => {
  // ADMIN（非 OWNER）：確實走到 isAdmin() 的 role in ['ADMIN','OWNER'] 分支
  const adminUid = await seedUser(ADMIN_USER, 'ADMIN')
  await seedUser(PLAIN_USER, 'USER')
  await seedDocs({
    buffs: [
      { id: 'buff_a', name: '甲盾', description: '護盾類' },
      { id: 'buff_target', name: '過熱', maxStack: 5 },
    ],
    pilots: [{ id: 'p1', ...SEED_PILOT_DOC }],
  })

  // 動態 import：loader 就位後才載入待測模組鏈（cascadeDelete → changeHistory → stub db）
  const { deleteBuff } = await import('../../../src/lib/api/buffs.ts')

  /** 帶外驗證「刪除攻擊後資料庫毫髮無傷」：目標在、引用在、無 log、無版本 bump。 */
  async function assertDatabasePristine(phase: string): Promise<void> {
    assert.deepEqual(
      await readDoc('buffs', 'buff_target'),
      { name: '過熱', maxStack: 5 },
      `${phase}：目標 buff 應原封不動`,
    )
    assert.deepEqual(
      await readDoc('pilots', 'p1'),
      SEED_PILOT_DOC,
      `${phase}：引用來源機師應原封不動（含 buffIds 與 descriptionRefs）`,
    )
    assert.equal((await allLogs()).length, 0, `${phase}：不應留下任何 changeHistory 記錄`)
    assert.equal(await readDoc('meta', 'gameData'), null, `${phase}：版本文件不應被建立（無 bump）`)
  }

  // ── a. role=USER 呼叫 deleteBuff ──────────────────────────────────────────
  await t.test('a. USER 呼叫 deleteBuff → changeHistory create:isAdmin 擋下、刪除中止', async () => {
    await signInAs(PLAIN_USER)
    // 決策十：log 先於資料 batch。USER 被 create:isAdmin 擋在 logChangeOrThrow，
    // 此時 batch 尚未組出，資料應完全沒動。
    await expectPermissionDenied(deleteBuff('buff_target'), 'USER deleteBuff')
    await assertDatabasePristine('案例a')
  })

  // ── b. 未登入呼叫 deleteBuff ──────────────────────────────────────────────
  await t.test('b. 未登入呼叫 deleteBuff → 同樣中止、資料原封', async () => {
    await signOutClient()
    // 掃描階段的 9 個集合都是 read:true，未登入也讀得到（公開遊戲資料，符合設計）；
    // 防線仍在 log 寫入：isAdmin() 的 isAuthenticated() 為 false → denied。
    await expectPermissionDenied(deleteBuff('buff_target'), '未登入 deleteBuff')
    await assertDatabasePristine('案例b')
  })

  // ── e. USER 直接用 client SDK 寫 batch 會觸及的每一類文件 ─────────────────
  await t.test('e. USER 直寫 buffs / meta/gameData / changeHistory → 全部被拒', async () => {
    await signInAs(PLAIN_USER)
    // 級聯 batch 的三種寫入形態逐一探測：create / update / delete 遊戲資料
    await expectPermissionDenied(
      setDoc(doc(db, 'buffs', 'buff_evil'), { name: '惡意植入' }),
      'USER create buffs',
    )
    await expectPermissionDenied(
      updateDoc(doc(db, 'buffs', 'buff_a'), { name: '竄改' }),
      'USER update buffs',
    )
    await expectPermissionDenied(
      deleteDoc(doc(db, 'buffs', 'buff_a')),
      'USER delete buffs',
    )
    // batch 的版本 bump 寫入
    await expectPermissionDenied(
      setDoc(doc(db, 'meta', 'gameData'), { versions: { buffs: 'hacked' } }, { merge: true }),
      'USER write meta/gameData',
    )
    // 直接偽造稽核記錄（logChangeOrThrow 的同一條路）
    await expectPermissionDenied(
      addDoc(collection(db, 'changeHistory'), {
        target: 'buff', action: 'delete', targetId: 'buff_a', targetName: '甲盾',
        actorUid: 'forged', actorName: '偽造者', at: serverTimestamp(), expireAt: new Date(),
      }),
      'USER create changeHistory',
    )
    // 讀取限管理員：刪除快照內含完整文件內容，不該讓一般使用者查詢
    await expectPermissionDenied(
      getDocsFromServer(collection(db, 'changeHistory')),
      'USER read changeHistory',
    )

    // 帶外驗證：所有被拒的寫入都沒有落地
    assert.equal(await readDoc('buffs', 'buff_evil'), null, 'buff_evil 不應存在')
    assert.equal((await readDoc('buffs', 'buff_a'))?.name, '甲盾', 'buff_a 應未被竄改')
    assert.equal(await readDoc('meta', 'gameData'), null, 'meta/gameData 不應被 USER 建立')
    assert.equal((await allLogs()).length, 0, '不應有任何偽造 log 落地')
  })

  // ── d. 對照組：管理員正常刪除成功 ─────────────────────────────────────────
  let cascadeLogId = ''
  await t.test('d. 對照組：ADMIN 正常刪除成功（級聯 + log + 版本 bump 全套落地）', async () => {
    await signInAs(ADMIN_USER)
    const res = await deleteBuff('buff_target')
    assert.ok(res, '目標存在，deleteBuff 應回傳結果而非 null')

    // 帶外驗證：不信任回傳值
    assert.equal(await readDoc('buffs', 'buff_target'), null, '目標文件應已刪除')

    const p1 = await readDoc('pilots', 'p1')
    const talent = (p1?.talents as Array<Record<string, unknown>>)[0]
    assert.deepEqual(talent.buffIds, ['buff_a'], 'buff_target@2 應被精確移除、buff_a 保留')
    assert.deepEqual(
      talent.descriptionRefs,
      { 甲盾: { refType: 'buff', refId: 'buff_a' } },
      'descriptionRefs 應只清掉指向目標的 key',
    )

    const logs = await allLogs()
    assert.equal(logs.length, 1, '應恰有一筆 delete log')
    const log = logs[0]
    assert.equal(log.action, 'delete')
    assert.equal(log.targetId, 'buff_target')
    assert.equal(log.actorUid, adminUid, 'actorUid 應是登入中的管理員')
    const snapshot = log.snapshot as { doc: Record<string, unknown>; patches: unknown[] }
    assert.equal(snapshot.doc.name, '過熱', '快照應含被刪文件本體')
    assert.equal(snapshot.patches.length, 2, '修補單應含 arrayRemove + mapKeyDelete 各一')
    cascadeLogId = log.id

    const meta = await readDoc('meta', 'gameData')
    const versions = meta?.versions as Record<string, string>
    assert.ok(versions?.buffs && versions?.pilots, '兩個受影響集合的版本應被 bump')
    assert.equal(versions.buffs, versions.pilots, '同一次刪除應共用同一版本時間戳')
  })

  // ── c. append-only：管理員也改不了既有 log ────────────────────────────────
  await t.test('c. append-only：ADMIN 用 client SDK update / delete 既有 log → 皆 permission-denied', async () => {
    assert.ok(cascadeLogId, '前置：案例 d 應已產生一筆真實 log')
    const before = await readDoc('changeHistory', cascadeLogId)
    assert.ok(before, '前置：log 應存在')

    // 身分仍是 ADMIN —— 正是「操作者想抹除自己記錄」的威脅模型
    await expectPermissionDenied(
      updateDoc(doc(db, 'changeHistory', cascadeLogId), { targetName: '竄改後的名字' }),
      'ADMIN update changeHistory',
    )
    await expectPermissionDenied(
      deleteDoc(doc(db, 'changeHistory', cascadeLogId)),
      'ADMIN delete changeHistory',
    )

    const after = await readDoc('changeHistory', cascadeLogId)
    assert.notEqual(after, null, 'log 應仍存在')
    assert.deepEqual(after, before, 'log 內容應一字未動（含快照與時間戳）')
  })

  // ── f. 管理員完整 batch（含 meta/gameData）成功 ───────────────────────────
  await t.test('f. ADMIN 完整 batch（遊戲資料更新 + meta/gameData merge 寫入）成功', async () => {
    // 身分仍是 ADMIN。組成比照級聯 batch：遊戲集合 update + meta/gameData set(merge)
    const metaBefore = await readDoc('meta', 'gameData')
    const pilotsVerBefore = (metaBefore?.versions as Record<string, string>)?.pilots
    assert.ok(pilotsVerBefore, '前置：案例 d 應已寫入 pilots 版本')

    const batch = writeBatch(db)
    batch.update(doc(db, 'buffs', 'buff_a'), { description: '對照組批次更新' })
    batch.set(
      doc(db, 'meta', 'gameData'),
      { versions: { buffs: 'v-case-f' }, updatedAt: serverTimestamp() },
      { merge: true },
    )
    await batch.commit()

    // 帶外驗證：兩筆寫入都落地，且 merge 沒有洗掉其他集合的版本號
    assert.equal(
      (await readDoc('buffs', 'buff_a'))?.description, '對照組批次更新',
      'batch 內的遊戲資料更新應落地',
    )
    const meta = await readDoc('meta', 'gameData')
    const versions = meta?.versions as Record<string, string>
    assert.equal(versions.buffs, 'v-case-f', 'meta 規則應允許 admin 寫入')
    assert.equal(versions.pilots, pilotsVerBefore, 'set(merge:true) 應保留 versions 內其他集合的版本號')
  })

  // ── g. 探針：create 只驗身分、不驗內容（documented-behavior）──────────────
  await t.test('g. create 綁定 actorUid：冒名他人被拒、actorUid==本人放行（防偽造嫁禍）', async () => {
    // Phase C 破壞性測試發現③的修正：create 規則加 request.resource.data.actorUid
    // == request.auth.uid。append-only 防「竄改既有記錄」，這條防「偽造新記錄」——
    // 否則管理員可 addDoc 冒名 log 嫁禍他人，且因 append-only 連本人也抹不掉、永久化。
    await signInAs(ADMIN_USER)

    // ① 冒名他人的 actorUid → 規則擋下（規則層，寫入前就拒絕）
    await expectPermissionDenied(
      addDoc(collection(db, 'changeHistory'), {
        target: 'buff', action: 'delete', targetId: 'buff_forged', targetName: '偽造目標',
        actorUid: 'someone-else-uid', actorName: '被嫁禍的人',
        at: serverTimestamp(), expireAt: new Date(),
      }),
      'ADMIN create 冒名 actorUid 的 log',
    )
    // 帶外確認偽造記錄根本沒落地（先前既有的 log 數量不受影響）
    const forgedGone = (await allLogs()).find((l) => l.targetId === 'buff_forged')
    assert.equal(forgedGone, undefined, '冒名 log 不應寫入資料庫')

    // ② actorUid == 本人 uid → 放行（buildEntry 走的正是這條，不可被誤擋）
    const ref = await addDoc(collection(db, 'changeHistory'), {
      target: 'buff', action: 'delete', targetId: 'buff_legit', targetName: '正當記錄',
      actorUid: adminUid, actorName: '測試管理員',
      at: serverTimestamp(), expireAt: new Date(),
    })
    const legit = await readDoc('changeHistory', ref.id)
    assert.equal(legit?.actorUid, adminUid, 'actorUid==本人 的 log 應正常寫入')

    // append-only 仍在：連本人的正當 log 也改不了、刪不掉
    await expectPermissionDenied(
      deleteDoc(doc(db, 'changeHistory', ref.id)),
      'ADMIN delete 自己的 log',
    )
  })
})
