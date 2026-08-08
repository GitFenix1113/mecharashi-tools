// classifyLogout 的分支覆蓋（PLAN-045 Phase A-1）
//
// 為什麼值得測：判定錯誤比沒有判定更糟——它會把排查引向錯誤方向。而要手動驗證
// 各種成因，得真的製造多次登出（清 localStorage、刪 IDB、Console 撤銷 token…）。
// 判定既然已抽成純函式，就用測試把全部組合一次釘死。
//
// ⚠ 本檔在實測後改寫過一次。初版讓「Firebase 的 IndexedDB 還在不在」參與判定，
//   瀏覽器實測才發現那顆探針**恆為 present**（SDK 初始化會自動重建 database），
//   導致 idbEvicted 永遠產生不出來，更嚴重的是讓每個匿名訪客被誤判成 storageCleared。
//   單元測試當初沒抓到，是因為它測的是「給定探針值 → 判定」，而錯的是
//   「探針值本身測不到真實狀態」——那一層只有真實瀏覽器測得出來。
//   教訓已寫進下方 authRecord 相關的測試註解。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyLogout, type ProbeResult, type Tri } from './sentinel.ts'

/** 組 ProbeResult 的簡寫，預設是「一切完好、被動登出」。 */
const probe = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  sentinel: 'present',
  cookie: 'present',
  authRecord: 'absent',
  authLocal: 'absent',
  explicit: false,
  ...over,
})

test('explicit 優先於一切環境探針', () => {
  assert.equal(classifyLogout(probe({ explicit: true })), 'explicit')
  assert.equal(
    classifyLogout(probe({ explicit: true, sentinel: 'absent', cookie: 'absent' })),
    'explicit',
  )
})

test('哨兵還在 → tokenRevoked（quota storage 沒被清，登出必來自憑證側）', () => {
  assert.equal(classifyLogout(probe()), 'tokenRevoked')
})

test('哨兵不見 + cookie 還在 → storageCleared', () => {
  // cookie 不屬於 quota-managed storage，Chrome eviction 清不到它。
  // 它還在就證明這台裝置登入過 → localStorage 的消失是被清而非從未寫入。
  assert.equal(classifyLogout(probe({ sentinel: 'absent' })), 'storageCleared')
})

test('查無任何登入痕跡 → neverSignedIn（匿名訪客，不可誤報成 storageCleared）', () => {
  // 最重要的一條：前台匿名訪客每次載入都會觸發 onAuthStateChanged(null)。
  // 判成 storageCleared 的話，每個第一次進站的訪客都會看到「你被登出了」的橫幅
  // ——初版就是這樣（靠 authIdb 恆 present 命中了「IDB 還在證明登入過」）。
  assert.equal(
    classifyLogout(probe({ sentinel: 'absent', cookie: 'absent' })),
    'neverSignedIn',
  )
})

test('哨兵不見 + cookie 測不到 → neverSignedIn（不敢定案）', () => {
  assert.equal(
    classifyLogout(probe({ sentinel: 'absent', cookie: 'unknown' })),
    'neverSignedIn',
  )
})

test('localStorage 本身不可用 → unknown', () => {
  // 隱私模式下 localStorage 可能直接拋 SecurityError。此時「沒有哨兵」與
  // 「讀不到哨兵」無法區分，不該硬猜。
  const tris: Tri[] = ['present', 'absent', 'unknown']
  for (const cookie of tris) {
    for (const authRecord of tris) {
      assert.equal(
        classifyLogout(probe({ sentinel: 'unknown', cookie, authRecord })),
        'unknown',
        `sentinel=unknown cookie=${cookie} authRecord=${authRecord} 應為 unknown`,
      )
    }
  }
})

test('authRecord / authLocal 都不影響判定 —— 它們只是佐證欄位', () => {
  // 這是實測踩坑後最該釘住的一條：任何與 Firebase 內部儲存有關的探針都可能
  // 因為 SDK 自動重建（authRecord）或舊鍵殘留（authLocal）而失去意義，
  // 故判定只採用不受 Firebase 干擾的兩顆哨兵。
  const tris: Tri[] = ['present', 'absent', 'unknown']
  const cases: Partial<ProbeResult>[] = [
    { sentinel: 'present', cookie: 'present' },
    { sentinel: 'present', cookie: 'absent' },
    { sentinel: 'absent', cookie: 'present' },
    { sentinel: 'absent', cookie: 'absent' },
    { sentinel: 'unknown', cookie: 'present' },
  ]
  for (const base of cases) {
    const results: string[] = []
    for (const authRecord of tris) {
      for (const authLocal of tris) {
        results.push(classifyLogout(probe({ ...base, authRecord, authLocal })))
      }
    }
    assert.equal(
      new Set(results).size, 1,
      `sentinel=${base.sentinel} cookie=${base.cookie} 的判定不該隨佐證探針改變，實得 ${[...new Set(results)].join('/')}`,
    )
  }
})

test('persistence 降級指紋不會被誤升格成判定依據', () => {
  // 「IDB 沒有、localStorage 有」是我們最想抓的組合，但它**刻意不參與判定**：
  // Firebase 切換 persistence 時不保證清乾淨舊鍵，殘留的舊鍵會讓這條變成永久誤報。
  // 這條測試就是防止日後有人「順手」把它接進 classifyLogout。
  assert.equal(
    classifyLogout(probe({ sentinel: 'present', authRecord: 'absent', authLocal: 'present' })),
    'tokenRevoked',
  )
  // 尤其不可以讓匿名訪客命中任何「登入過」的分支——這正是初版的致命傷。
  assert.equal(
    classifyLogout(probe({
      sentinel: 'absent', cookie: 'absent', authRecord: 'absent', authLocal: 'present',
    })),
    'neverSignedIn',
  )
})

test('全組合窮舉：每種輸入都有定義良好的輸出', () => {
  // 3 × 3 × 3 × 3 × 2 = 162 種組合。確保沒有任何一種掉進 undefined，
  // 且 explicit=true 的 81 種一律是 explicit。
  const tris: Tri[] = ['present', 'absent', 'unknown']
  const valid = new Set([
    'explicit', 'storageCleared', 'tokenRevoked', 'neverSignedIn', 'unknown',
  ])
  let count = 0
  for (const sentinel of tris) {
    for (const cookie of tris) {
      for (const authRecord of tris) {
        for (const authLocal of tris) {
          for (const explicit of [true, false]) {
            const r = classifyLogout({ sentinel, cookie, authRecord, authLocal, explicit })
            assert.ok(valid.has(r), `未定義的判定結果: ${r}`)
            if (explicit) assert.equal(r, 'explicit')
            count++
          }
        }
      }
    }
  }
  assert.equal(count, 162)
})

test('idbEvicted 已停用：判定不再產生它', () => {
  // 型別上保留（既有記錄仍需顯示標籤），但任何輸入組合都不該再產生。
  const tris: Tri[] = ['present', 'absent', 'unknown']
  for (const sentinel of tris) {
    for (const cookie of tris) {
      for (const authRecord of tris) {
        for (const authLocal of tris) {
          assert.notEqual(
            classifyLogout({ sentinel, cookie, authRecord, authLocal, explicit: false }),
            'idbEvicted',
          )
        }
      }
    }
  }
})
