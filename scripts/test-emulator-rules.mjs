#!/usr/bin/env node
/**
 * 安全規則驗證（PLAN-030 A-3）—— 對本地模擬器執行
 *
 * 重點：**不能用 Admin SDK 測規則**。Admin SDK 對模擬器送的是 `Authorization: Bearer owner`，
 * 會直接繞過所有規則，測起來永遠是綠的。這裡改用 Auth 模擬器換真實 ID token，
 * 再打 Firestore REST API —— 這條路徑才會實際執行 firestore.rules。
 *
 * 驗證 changeHistory 的 append-only 契約：
 *   · 管理員可新增、可讀取
 *   · 管理員「不可」修改、「不可」刪除自己的 log ← 稽核價值的核心
 *   · 一般使用者完全不可讀、不可寫
 *
 * 驗證雲端書架 `users/{uid}/builds/{pilotId}` 的四條 gate（PLAN-052-E B-5）：
 *   · 身分：本人可讀寫；他人（含管理員）一律 403
 *   · 形狀：頂層只准 slots / updatedAt；updatedAt 必須是字串
 *   · 格數：slots 的 key 只准 '0'～'4'，第六格被擋
 *   · 大小：4096 字元放行、4097 被擋（**兩側都驗** —— 只驗被擋那一側的話，
 *     一條永遠為假的規則也會讓測試變綠）
 *   · 外加：doc id 正規式、空字串格位、局部合併不會洗掉其他格
 *
 * 驗證故事館協作編輯 LORE_EDITOR 的授權邊界（PLAN-042-H）：
 *   · 故事館四個集合可讀寫、不可刪；遊戲資料一律碰不到
 *   · changeHistory 只能寫 lore 兩類、只能署自己的名；meta/gameData 只能 bump 故事館四個鍵
 *   · 不能自己提權；systemLog 寫得進去（維護者）
 *   · 存檔交易（文件＋帶前一版快照的 log 同一筆 commit）：log 被擋時整筆失敗、文件不變
 *
 * 前置：`npm run emu:fresh`（或 `npm run emu`）要先跑起來，然後
 *   npm run emu:test-rules
 */

const PROJECT = 'mecharashi-tools'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
/** `:commit` 的 writes 要完整資源名（不是 URL） */
const DOC_ROOT = `projects/${PROJECT}/databases/(default)/documents`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts'

const ADMIN = { email: 'dev-admin@local.test', password: 'devadmin' }
const PLAIN = { email: 'dev-plain@local.test', password: 'devplain' }
const LORE  = { email: 'dev-lore@local.test',  password: 'devlore' }

/**
 * 模擬器專用的「繞過規則」憑證：Firestore 模擬器把 `Bearer owner` 當成 Admin。
 * 只用來**佈置前置狀態**（給協作編輯帳號設 role、確保 meta/gameData 存在），
 * 被測的請求一律用真實 ID token —— 用這個測規則永遠是綠的（見檔頭）。
 */
const BYPASS = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }

let pass = 0
let fail = 0

function check(name, actual, expected) {
  const ok = actual === expected
  ok ? pass++ : fail++
  const mark = ok ? '✓' : '✗'
  const detail = ok ? `${actual}` : `得到 ${actual}，預期 ${expected}`
  console.log(`  ${mark} ${name.padEnd(46)} ${detail}`)
}

/** 用 Auth 模擬器登入／註冊，取得真實 ID token（模擬器不驗 apiKey，隨便給） */
async function account({ email, password }) {
  for (const path of ['signInWithPassword', 'signUp']) {
    const res = await fetch(`${AUTH}:${path}?key=fake-api-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    })
    if (res.ok) {
      const j = await res.json()
      return { idToken: j.idToken, uid: j.localId }
    }
  }
  throw new Error(`無法取得 ${email} 的 token（模擬器有在跑嗎？）`)
}

/** 只要 token 時用這個（雲端書架那一段還要 uid，走 `account()`）。 */
const token = async (cred) => (await account(cred)).idToken

const authed = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })

/**
 * changeHistory 的一筆。
 *
 * ⚠ `actorUid` 必須是**呼叫者本人的 uid**：規則的 create 那條綁了
 *   `request.resource.data.actorUid == request.auth.uid`（PLAN-030 Phase C 發現③，
 *   防的是「管理員用 client SDK 寫一筆冒名記錄嫁禍他人」）。
 *   本檔原本寫死 `'test'` —— 那條規則收緊之後就沒有人再跑過這個腳本，
 *   於是連「管理員可新增」這一項都是紅的（052-E B-5 順手修）。
 */
const logBody = (actorUid) => ({
  fields: {
    target:     { stringValue: 'buff' },
    action:     { stringValue: 'create' },
    targetId:   { stringValue: 'buff_規則測試' },
    targetName: { stringValue: '規則測試' },
    actorUid:   { stringValue: actorUid },
    actorName:  { stringValue: '規則測試' },
  },
})

// ── 雲端書架（PLAN-052-E B-3／B-5）─────────────────────────────────────────────
//
// 規則那四條 gate 要**真的被執行過**才算數。這裡每一條「應被擋」都驗 HTTP 403，
// 不是「沒有拋錯」——寫進去卻沒生效與被規則擋掉，在 client SDK 上看起來一模一樣。

/** `slots` 是巢狀 map，REST 要自己包 mapValue。 */
const buildBody = (slots, over = {}) => ({
  fields: {
    slots: {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(slots).map(([k, v]) => [k, typeof v === 'string' ? { stringValue: v } : v]),
        ),
      },
    },
    updatedAt: { stringValue: '2026-08-29T00:00:00.000Z' },
    ...over,
  },
})

// ── 故事館協作編輯 LORE_EDITOR（PLAN-042-H）────────────────────────────────────
//
// 每一條「應放行」都配一條相鄰的「應被擋」：只驗被擋那側的話，canEditLore() 寫成永遠為假
// 也會全綠；只驗放行那側的話，把整個集合開成 isAuthenticated() 也會全綠。

const str = (v) => ({ stringValue: v })
const fieldsOf = (obj) => ({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, str(v)])) })
const mask = (...paths) => paths.map((p) => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&')

/** bumpDataVersion 的 REST 等價形狀：merge 寫 versions.<key> 與 updatedAt */
const bump = (tok, key) => fetch(`${FS}/meta/gameData?${mask(`versions.${key}`, 'updatedAt')}`, {
  method: 'PATCH',
  headers: authed(tok),
  body: JSON.stringify({
    fields: {
      versions: { mapValue: { fields: { [key]: str(new Date().toISOString()) } } },
      updatedAt: str(new Date().toISOString()),
    },
  }),
})

async function loreEditorSuite(adminTok, plainTok) {
  console.log('\n故事館協作編輯 role: LORE_EDITOR（PLAN-042-H）')

  const editor = await account(LORE)
  const tok = editor.idToken

  // 前置：role 只能由 OWNER 指派，這裡用繞過規則的憑證直接佈置；meta/gameData 也要先存在
  //（isLoreVersionBump 比對的是 resource.data，文件不存在時規則會評估失敗＝被擋，測不到放行那側）。
  await fetch(`${FS}/users/${editor.uid}/profile/main`, {
    method: 'PATCH', headers: BYPASS,
    body: JSON.stringify(fieldsOf({ uid: editor.uid, displayName: '故事館測試', email: LORE.email, role: 'LORE_EDITOR' })),
  })
  await fetch(`${FS}/meta/gameData?${mask('versions.pilotLore')}`, {
    method: 'PATCH', headers: BYPASS,
    body: JSON.stringify({ fields: { versions: { mapValue: { fields: { pilotLore: str('seed') } } } } }),
  })

  const put = (t, path, obj) => fetch(`${FS}/${path}`, { method: 'PATCH', headers: authed(t), body: JSON.stringify(fieldsOf(obj)) })
  const get = (t, path) => fetch(`${FS}/${path}`, { headers: authed(t) })
  const del = (t, path) => fetch(`${FS}/${path}`, { method: 'DELETE', headers: authed(t) })
  const st = async (p) => (await p).status

  // ① 故事館四個集合：可讀可寫、不可刪 ──────────────────────────────────────
  check('寫 pilotLore', await st(put(tok, 'pilotLore/rules_test', { name: '規則測試' })), 200)
  check('讀 pilotLore（存檔交易比對版本號）', await st(get(tok, 'pilotLore/rules_test')), 200)
  check('刪 pilotLore（應被擋）', await st(del(tok, 'pilotLore/rules_test')), 403)
  check('寫 mechLore', await st(put(tok, 'mechLore/rules_test', { name: '規則測試' })), 200)
  check('寫 factionEmblems', await st(put(tok, 'factionEmblems/rules_test', { name: '規則測試' })), 200)
  check('寫 mechMakers', await st(put(tok, 'mechMakers/rules_test', { name: '規則測試' })), 200)
  check('管理者刪 pilotLore（對照：應可刪）', await st(del(adminTok, 'pilotLore/rules_test')), 200)
  check('一般使用者寫 pilotLore（應被擋）', await st(put(plainTok, 'pilotLore/rules_test', { name: '越權' })), 403)

  // ② 遊戲資料：一律碰不到 ────────────────────────────────────────────────
  check('寫 pilots（應被擋）', await st(put(tok, 'pilots/rules_test', { name: '越權' })), 403)
  check('讀 pilots（應被擋，前台走 Worker）', await st(get(tok, 'pilots/rules_test')), 403)
  check('寫 buffs（應被擋）', await st(put(tok, 'buffs/rules_test', { name: '越權' })), 403)
  // PLAN-064：武裝討伐的譯名對照表與草稿只給管理者（決策：審核頁權限只開 ADMIN，不放行 LORE_EDITOR）
  check('寫 raidTerms（應被擋）', await st(put(tok, 'raidTerms/rules_test', { kind: '越權' })), 403)
  check('讀 raidDrafts（應被擋）', await st(get(tok, 'raidDrafts/rules_test')), 403)
  check('管理者寫 raidTerms（對照：應可寫）', await st(put(adminTok, 'raidTerms/rules_test', { kind: '規則測試' })), 200)

  // ③ 稽核記錄：只能寫 lore 兩類、只能署自己的名、不能讀 ─────────────────────
  const log = (target, actorUid) => fetch(`${FS}/changeHistory`, {
    method: 'POST', headers: authed(tok),
    body: JSON.stringify({ fields: { ...logBody(actorUid).fields, target: str(target) } }),
  })
  const ok = await log('pilotLore', editor.uid)
  check('寫 changeHistory（target=pilotLore）', ok.status, 200)
  check('寫 changeHistory（target=mechLore）', await st(log('mechLore', editor.uid)), 200)
  check('寫 changeHistory（target=buff，應被擋）', await st(log('buff', editor.uid)), 403)
  check('冒名寫 changeHistory（應被擋）', await st(log('pilotLore', 'someone-else')), 403)
  if (ok.ok) {
    const id = (await ok.json()).name.split('/').pop()
    check('讀 changeHistory（應被擋）', await st(get(tok, `changeHistory/${id}`)), 403)
  }

  // ③-b 存檔交易：資料＋帶前一版快照的稽核記錄，同一筆 commit（saveWithRevision）──────
  // 故事館存檔改成交易內「寫文件＋寫 log」原子提交：log 承載唯一的前一版內容，
  // 所以 log 被規則擋下時，整筆存檔必須一起失敗——不能留下一次「沒有快照的覆寫」。
  const save = (t, actorUid, target, name, rev) => fetch(`${FS}:commit`, {
    method: 'POST', headers: authed(t),
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: `${DOC_ROOT}/pilotLore/rules_tx`,
            fields: { name: str(name), rev: { integerValue: String(rev) }, chapters: { arrayValue: {} } },
          },
        },
        {
          update: {
            name: `${DOC_ROOT}/changeHistory/rules_tx_${rev}_${Math.random().toString(36).slice(2, 8)}`,
            fields: {
              ...logBody(actorUid).fields,
              target: str(target),
              action: str('update'),
              targetId: str('rules_tx'),
              snapshot: { mapValue: { fields: {
                doc: { mapValue: { fields: { name: str('前一版'), rev: { integerValue: String(rev - 1) } } } },
                patches: { arrayValue: {} },
              } } },
            },
          },
          currentDocument: { exists: false },
        },
      ],
    }),
  })
  await fetch(`${FS}/pilotLore/rules_tx`, { method: 'PATCH', headers: BYPASS, body: JSON.stringify(fieldsOf({ name: '前一版' })) })
  check('存檔交易：文件＋帶快照的 log', await st(save(tok, editor.uid, 'pilotLore', '第 1 版', 1)), 200)
  check('存檔交易：log 冒名（整筆應被擋）', await st(save(tok, 'someone-else', 'pilotLore', '不該寫進去', 2)), 403)
  check('存檔交易：log target=buff（整筆應被擋）', await st(save(tok, editor.uid, 'buff', '不該寫進去', 2)), 403)
  const after = await (await fetch(`${FS}/pilotLore/rules_tx`, { headers: BYPASS })).json()
  check('被擋的存檔沒有寫進文件（原子性）', after.fields?.name?.stringValue, '第 1 版')
  check('一般使用者的存檔交易（應被擋）', await st(save(plainTok, 'x', 'pilotLore', '越權', 2)), 403)

  // ④ 版本號：只能 bump 故事館那四個鍵 ───────────────────────────────────────
  check('bump versions.pilotLore', await st(bump(tok, 'pilotLore')), 200)
  check('bump versions.mechMakers', await st(bump(tok, 'mechMakers')), 200)
  check('bump versions.pilots（應被擋）', await st(bump(tok, 'pilots')), 403)
  check('改 meta/gameData 全域欄位（應被擋）',
    await st(fetch(`${FS}/meta/gameData?${mask('version')}`, {
      method: 'PATCH', headers: authed(tok), body: JSON.stringify(fieldsOf({ version: '越權' })),
    })), 403)
  check('寫 meta 其他文件（應被擋）', await st(put(tok, 'meta/rules_test', { versions: '越權' })), 403)
  check('管理者 bump versions.pilots（對照：應可寫）', await st(bump(adminTok, 'pilots')), 200)

  // ⑤ 提權與診斷日誌 ─────────────────────────────────────────────────────
  check('自己把 role 改成 ADMIN（應被擋）',
    await st(fetch(`${FS}/users/${editor.uid}/profile/main?${mask('role')}`, {
      method: 'PATCH', headers: authed(tok), body: JSON.stringify(fieldsOf({ role: 'ADMIN' })),
    })), 403)
  check('改自己的暱稱（對照：應可寫）',
    await st(fetch(`${FS}/users/${editor.uid}/profile/main?${mask('gameNickname')}`, {
      method: 'PATCH', headers: authed(tok), body: JSON.stringify(fieldsOf({ gameNickname: '測試' })),
    })), 200)
  check('寫 systemLog（本人 uid）',
    await st(fetch(`${FS}/systemLog`, {
      method: 'POST', headers: authed(tok), body: JSON.stringify(fieldsOf({ uid: editor.uid, kind: 'rules_test' })),
    })), 200)
  check('寫 systemLog（一般使用者，應被擋）',
    await st(fetch(`${FS}/systemLog`, {
      method: 'POST', headers: authed(plainTok), body: JSON.stringify(fieldsOf({ uid: 'x', kind: 'rules_test' })),
    })), 403)

  // 清理：用繞過規則的憑證收掉測試文件（changeHistory／systemLog 是 append-only，留著無妨）
  await Promise.all([
    ...['mechLore', 'factionEmblems', 'mechMakers', 'raidTerms'].map((c) => fetch(`${FS}/${c}/rules_test`, { method: 'DELETE', headers: BYPASS })),
    fetch(`${FS}/pilotLore/rules_tx`, { method: 'DELETE', headers: BYPASS }),
  ])
}

async function cloudBuildsSuite() {
  console.log('\n雲端書架 users/{uid}/builds/{pilotId}（PLAN-052-E）')

  const owner = await account(PLAIN)
  const other = await account(ADMIN)
  const col = (uid) => `${FS}/users/${uid}/builds`
  const url = (uid, id) => `${col(uid)}/${encodeURIComponent(id)}`
  const post = (tok, uid, id, body) =>
    fetch(`${col(uid)}?documentId=${encodeURIComponent(id)}`, {
      method: 'POST', headers: authed(tok), body: JSON.stringify(body),
    })
  const status = async (p) => (await p).status

  const PILOT = 'pilot_049_海莉絲'
  const CODE = 'AQMhI0-_'

  // ⚠ **每次跑都要先清乾淨**。`POST ?documentId=` 對已存在的文件回 409（ALREADY_EXISTS），
  //   而 409 不是 200 也不是 403 —— 上一輪留下的文件會讓「應放行」那幾項在第二次執行時
  //   變紅，看起來像規則壞了。模擬器可能是長時間開著的（emu 會 --import 上次的匯出）。
  const SCRATCH = [
    PILOT, 'pilot_001_邊界', 'pilot_002_過長', 'pilot_003_六格',
    'pilot_004_空格', 'pilot_005_多欄', 'pilot_006_型別', 'pilot_007_越權',
  ]
  const wipe = () => Promise.all(
    SCRATCH.map((id) => fetch(url(owner.uid, id), { method: 'DELETE', headers: authed(owner.idToken) })),
  )
  await wipe()

  // ① 本人：建立、讀取 ────────────────────────────────────────────────────────
  const created = await post(owner.idToken, owner.uid, PILOT, buildBody({ 0: CODE, 1: CODE }))
  check('本人建立自己的存檔', created.status, 200)
  if (!created.ok) {
    console.log('    ↳ 回應：', (await created.text()).slice(0, 400))
    console.log('    ⚠ 連合法寫入都被擋 ⇒ 規則寫壞了，後面的「應被擋」全部沒有意義')
    fail++
    return
  }
  check('本人讀自己的存檔', await status(fetch(url(owner.uid, PILOT), { headers: authed(owner.idToken) })), 200)

  // ② 大小上限的兩側 —— 只驗「太長被擋」不夠，還要證明剛好等於上限是放行的，
  //    否則一條 `size() < 0` 的規則也會讓「太長被擋」這一項變綠 ───────────────
  const atLimit = 'A'.repeat(4096)
  check('剛好 4096 字元（應放行）',
    await status(post(owner.idToken, owner.uid, 'pilot_001_邊界', buildBody({ 0: atLimit }))), 200)
  check('4097 字元（應被擋）',
    await status(post(owner.idToken, owner.uid, 'pilot_002_過長', buildBody({ 0: 'A'.repeat(4097) }))), 403)

  // ③ 形狀四條 ───────────────────────────────────────────────────────────────
  check('第 6 個格位 slots.5（應被擋）',
    await status(post(owner.idToken, owner.uid, 'pilot_003_六格', buildBody({ 0: CODE, 5: CODE }))), 403)
  check('空字串的格子（應被擋）',
    await status(post(owner.idToken, owner.uid, 'pilot_004_空格', buildBody({ 0: '' }))), 403)
  check('多餘的頂層 key（應被擋）',
    await status(post(owner.idToken, owner.uid, 'pilot_005_多欄', buildBody({ 0: CODE }, { note: { stringValue: '偷渡' } }))), 403)
  check('updatedAt 不是字串（應被擋）',
    await status(post(owner.idToken, owner.uid, 'pilot_006_型別', buildBody({ 0: CODE }, { updatedAt: { integerValue: '123' } }))), 403)
  check('doc id 不合正規式（應被擋）',
    await status(post(owner.idToken, owner.uid, 'not_a_pilot', buildBody({ 0: CODE }))), 403)

  // ④ 別人的書架 —— 拿 ADMIN 當入侵者：順帶證明「管理員也讀不到別人的存檔」，
  //    那是 users 子集合與其他集合最大的不同 ─────────────────────────────────
  check('他人讀（應被擋，管理員也一樣）',
    await status(fetch(url(owner.uid, PILOT), { headers: authed(other.idToken) })), 403)
  check('他人寫（應被擋）',
    await status(post(other.idToken, owner.uid, 'pilot_007_越權', buildBody({ 0: CODE }))), 403)

  // ⑤ 局部合併 —— buildsApi 最容易寫錯的一行的底層語意：
  //    只更新 slots.0 時，slots.1 必須原封不動 ──────────────────────────────
  const patched = await fetch(
    `${url(owner.uid, PILOT)}?updateMask.fieldPaths=${encodeURIComponent('slots.`0`')}`,
    { method: 'PATCH', headers: authed(owner.idToken), body: JSON.stringify(buildBody({ 0: 'ZZZZ' })) },
  )
  check('只更新第 0 格（應放行）', patched.status, 200)
  const after = await (await fetch(url(owner.uid, PILOT), { headers: authed(owner.idToken) })).json()
  const slotsAfter = after.fields?.slots?.mapValue?.fields ?? {}
  check('第 0 格已更新', slotsAfter['0']?.stringValue, 'ZZZZ')
  check('第 1 格沒有被洗掉 ← 整份覆寫會靜默弄丟它', slotsAfter['1']?.stringValue, CODE)

  // ⑥ 刪除：本人可刪（形狀不對的舊文件也要刪得掉）────────────────────────────
  check('本人刪除自己的存檔',
    await status(fetch(url(owner.uid, PILOT), { method: 'DELETE', headers: authed(owner.idToken) })), 200)

  await wipe()   // 留給下一輪一個乾淨的模擬器（見上面 409 的說明）
}

async function main() {
  console.log('🔒 安全規則驗證：changeHistory append-only 契約\n')

  const admin = await account(ADMIN)
  const plain = await account(PLAIN)
  const adminTok = admin.idToken
  const plainTok = plain.idToken

  // ── 管理員：可新增、可讀 ──────────────────────────────────────────────────
  console.log('管理員（role: OWNER）')
  const created = await fetch(`${FS}/changeHistory`, {
    method: 'POST', headers: authed(adminTok), body: JSON.stringify(logBody(admin.uid)),
  })
  check('新增 log', created.status, 200)
  if (!created.ok) {
    console.log('\n❌ 管理員連新增都失敗，後續測試無意義。回應：', await created.text())
    process.exit(1)
  }
  const docId = (await created.json()).name.split('/').pop()

  check('讀取 log', (await fetch(`${FS}/changeHistory/${docId}`, { headers: authed(adminTok) })).status, 200)

  // ── 管理員：不可修改、不可刪除（append-only 的核心）──────────────────────
  const patched = await fetch(`${FS}/changeHistory/${docId}?updateMask.fieldPaths=targetName`, {
    method: 'PATCH',
    headers: authed(adminTok),
    body: JSON.stringify({ fields: { targetName: { stringValue: '被竄改' } } }),
  })
  check('修改自己的 log（應被擋）', patched.status, 403)

  const deleted = await fetch(`${FS}/changeHistory/${docId}`, {
    method: 'DELETE', headers: authed(adminTok),
  })
  check('刪除自己的 log（應被擋）', deleted.status, 403)

  // ── 一般使用者：完全不可讀寫 ──────────────────────────────────────────────
  console.log('\n一般使用者（無 profile 文件 → 非管理員）')
  check('讀取 log（應被擋）',
    (await fetch(`${FS}/changeHistory/${docId}`, { headers: authed(plainTok) })).status, 403)
  check('新增 log（應被擋）',
    (await fetch(`${FS}/changeHistory`, {
      method: 'POST', headers: authed(plainTok), body: JSON.stringify(logBody(plain.uid)),
    })).status, 403)

  // ── 對照組：確認既有規則沒有被誤傷 ────────────────────────────────────────
  //
  // ⚠ 這一段原本斷言「一般使用者讀 buffs 應得 200」。**那個預期已經過期**：
  //   PLAN-029 把遊戲資料的讀取收成 `allow read: if isAdmin()`，前台改由 Cloudflare
  //   Worker 代讀（同源 /api），client 直連 Firestore 讀遊戲資料一律 403。
  //   本腳本自那次改動後就沒再跑過，所以這一項一直是紅的（052-E B-5 順手修）。
  //   對照組的價值不變，只是「對照」的方向反過來了：管理員讀得到、一般使用者讀不到。
  console.log('\n對照組（確認沒有誤傷既有規則）')
  check('管理員讀 buffs（應可讀）',
    (await fetch(`${FS}/buffs?pageSize=1`, { headers: authed(adminTok) })).status, 200)
  check('一般使用者讀 buffs（PLAN-029 後應被擋）',
    (await fetch(`${FS}/buffs?pageSize=1`, { headers: authed(plainTok) })).status, 403)
  check('一般使用者寫 buffs（應被擋）',
    (await fetch(`${FS}/buffs?documentId=buff_越權測試`, {
      method: 'POST', headers: authed(plainTok),
      body: JSON.stringify({ fields: { name: { stringValue: '越權' } } }),
    })).status, 403)

  await loreEditorSuite(adminTok, plainTok)
  await cloudBuildsSuite()

  // 清理：測試留下的 log 只能用 Admin SDK 繞過規則刪（這正是 append-only 生效的證明）
  console.log(`\n（測試 log ${docId} 依規則無法從 client 刪除，符合預期；模擬器資料本就是拋棄式的）`)

  console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項，失敗 ${fail} 項`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\n❌ 執行失敗：', err.message)
  process.exit(1)
})
