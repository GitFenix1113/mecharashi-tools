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
 *   npm run emu:test-rules
 */

const PROJECT = 'mecharashi-tools'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts'

const ADMIN = { email: 'dev-admin@local.test', password: 'devadmin' }
const PLAIN = { email: 'dev-plain@local.test', password: 'devplain' }

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
async function token({ email, password }) {
  for (const path of ['signInWithPassword', 'signUp']) {
    const res = await fetch(`${AUTH}:${path}?key=fake-api-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    })
    if (res.ok) return (await res.json()).idToken
  }
  throw new Error(`無法取得 ${email} 的 token（模擬器有在跑嗎？）`)
}

const authed = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })

const LOG_BODY = {
  fields: {
    target:     { stringValue: 'buff' },
    action:     { stringValue: 'create' },
    targetId:   { stringValue: 'buff_規則測試' },
    targetName: { stringValue: '規則測試' },
    actorUid:   { stringValue: 'test' },
    actorName:  { stringValue: '規則測試' },
  },
}

async function main() {
  console.log('🔒 安全規則驗證：changeHistory append-only 契約\n')

  const adminTok = await token(ADMIN)
  const plainTok = await token(PLAIN)

  // ── 管理員：可新增、可讀 ──────────────────────────────────────────────────
  console.log('管理員（role: OWNER）')
  const created = await fetch(`${FS}/changeHistory`, {
    method: 'POST', headers: authed(adminTok), body: JSON.stringify(LOG_BODY),
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
      method: 'POST', headers: authed(plainTok), body: JSON.stringify(LOG_BODY),
    })).status, 403)

  // ── 對照組：確認一般使用者仍讀得到公開的遊戲資料（規則沒有寫壞）──────────
  console.log('\n對照組（確認沒有誤傷既有規則）')
  check('一般使用者讀 buffs（應可讀）',
    (await fetch(`${FS}/buffs?pageSize=1`, { headers: authed(plainTok) })).status, 200)
  check('一般使用者寫 buffs（應被擋）',
    (await fetch(`${FS}/buffs?documentId=buff_越權測試`, {
      method: 'POST', headers: authed(plainTok),
      body: JSON.stringify({ fields: { name: { stringValue: '越權' } } }),
    })).status, 403)

  // 清理：測試留下的 log 只能用 Admin SDK 繞過規則刪（這正是 append-only 生效的證明）
  console.log(`\n（測試 log ${docId} 依規則無法從 client 刪除，符合預期；模擬器資料本就是拋棄式的）`)

  console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項，失敗 ${fail} 項`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\n❌ 執行失敗：', err.message)
  process.exit(1)
})
