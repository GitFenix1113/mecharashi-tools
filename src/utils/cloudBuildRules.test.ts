// 雲端書架純規則的驗收測試 —— PLAN-052-E B-2
//
// 這裡守的是「規則會拒絕的，client 先說得出原因」。每一條都對應 firestore.rules 的
// 一條 gate；規則那側由 `npm run emu:test-rules`（B-5）用真 ID token 打 REST 驗，
// 兩邊都要綠才算數 —— 只驗 client 等於只驗了「我們自己的禮貌」，沒驗到「別人闖不進來」。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateCloudSave, freeSlots, sanitizeSlots, CLOUD_BUILD_ID_RE, BASE64URL_RE,
  planCloudImport, summarizeImportPlan,
} from './cloudBuildRules.ts'
import { CLOUD_CODE_MAX_CHARS, CLOUD_SLOTS, CLOUD_SLOTS_PER_PILOT, isCloudSlot, type CloudSlot } from '../types/loadout.ts'

const PILOT = 'pilot_049_海莉絲'
const CODE = 'AQMhI0-_'

test('格位白名單就是 5 格，多一個少一個都不行', () => {
  assert.equal(CLOUD_SLOTS.length, CLOUD_SLOTS_PER_PILOT)
  for (const s of CLOUD_SLOTS) assert.ok(isCloudSlot(s), s)
  for (const bad of ['5', '-1', '00', 0, '', ' 0', null, undefined, '０']) {
    assert.equal(isCloudSlot(bad), false, `${String(bad)} 不該是合法格位`)
  }
})

test('doc id 正規式：89 位機師的形狀全過，其餘擋掉', () => {
  for (const good of ['pilot_001_葉夫根尼', 'pilot_049_海莉絲', 'pilot_089_某', 'pilot_999_x']) {
    assert.ok(CLOUD_BUILD_ID_RE.test(good), good)
  }
  for (const bad of [
    'pilot_49_海莉絲',        // 兩位數
    'pilot_0049_海莉絲',      // 四位數
    'pilots_049_x',
    'mech_001_初擊者',
    '../../../etc/passwd',
    'pilot_049',              // 少了尾底線
    '',
  ]) {
    assert.equal(CLOUD_BUILD_ID_RE.test(bad), false, `${bad} 不該通過`)
  }
})

test('validateCloudSave：合法輸入回 null', () => {
  assert.equal(validateCloudSave(PILOT, '0', CODE), null)
  assert.equal(validateCloudSave(PILOT, '4', 'A'.repeat(CLOUD_CODE_MAX_CHARS)), null, '剛好等於上限要放行')
})

test('validateCloudSave：先驗身分再驗內容 —— 順序錯了會回報錯誤的原因', () => {
  // 一串空代碼配一個壞 pilotId：要說「pilotId 不對」，不能說「代碼是空的」，
  // 否則使用者會去改代碼，然後還是存不進去。
  assert.equal(validateCloudSave('mech_001_初擊者', '0', ''), 'invalid-pilot-id')
  assert.equal(validateCloudSave(PILOT, '9', ''), 'invalid-slot')
})

test('validateCloudSave：每一條 gate 各有各的說法', () => {
  assert.equal(validateCloudSave(PILOT, '0', ''), 'code-empty')
  assert.equal(validateCloudSave(PILOT, '0', 'A'.repeat(CLOUD_CODE_MAX_CHARS + 1)), 'code-too-long')
  // 中文會讓「字元數 == 位元組數」不成立 ⇒ 規則的 size() 上限悄悄變成四倍
  assert.equal(validateCloudSave(PILOT, '0', 'AQ中文'), 'code-charset')
  assert.equal(validateCloudSave(PILOT, '0', 'AQ=='), 'code-charset', 'base64url 不補 =')
  assert.equal(validateCloudSave(PILOT, '0', 'AQ+/'), 'code-charset', '+ 與 / 是標準 base64，不是 url 版')
  assert.equal(validateCloudSave(PILOT, '0', 'AQ MI'), 'code-charset', '空白（貼上時很常見）')
  assert.equal(validateCloudSave(PILOT, '0', 'AQ\nMI'), 'code-charset', '換行（Discord 會插）')
})

test('BASE64URL_RE 與 codec 產出的字元集一致', () => {
  // codec 的 B64 表：A-Z a-z 0-9 - _
  assert.ok(BASE64URL_RE.test('ABCdef012-_'))
  assert.equal(BASE64URL_RE.test(''), false, '空字串由 code-empty 負責，不該在這裡放行')
})

test('freeSlots：空的回全部五格，滿的回空陣列，順序恆為 0→4', () => {
  assert.deepEqual(freeSlots(null), ['0', '1', '2', '3', '4'])
  assert.deepEqual(freeSlots({}), ['0', '1', '2', '3', '4'])
  assert.deepEqual(freeSlots({ '0': CODE, '2': CODE }), ['1', '3', '4'])
  assert.deepEqual(freeSlots({ '0': CODE, '1': CODE, '2': CODE, '3': CODE, '4': CODE }), [])
})

test('sanitizeSlots：壞掉的那一格丟掉、其餘留著', () => {
  assert.deepEqual(
    sanitizeSlots({ '0': CODE, '1': '', '2': 42, '3': null, '4': CODE, '5': CODE, foo: CODE }),
    { '0': CODE, '4': CODE },
    '空字串／非字串／白名單外的 key 一律不要，合法的兩格照樣留著',
  )
  for (const junk of [null, undefined, 'x', 42, []]) {
    assert.deepEqual(sanitizeSlots(junk), {}, `${String(junk)} 應回空物件而不是 throw`)
  }
})

// ─── 匯入計畫（PLAN-052-E D-2／D-5）──────────────────────────────────────────

const item = (id: string, pilotId: string | null, code: string, selected = true) =>
  ({ id, code, pilotId, selected })
const cloudOf = (m: Record<string, Partial<Record<CloudSlot, string>>>) =>
  new Map(Object.entries(m))

test('匯入計畫：空雲端 ⇒ 同一位機師依顯示順序填 0、1、2…', () => {
  const rows = planCloudImport(
    [item('a', PILOT, 'AAA'), item('b', PILOT, 'BBB'), item('c', PILOT, 'CCC')],
    cloudOf({}),
  )
  assert.deepEqual(rows.map((r) => r.outcome), [
    { kind: 'import', slot: '0' },
    { kind: 'import', slot: '1' },
    { kind: 'import', slot: '2' },
  ])
})

test('匯入計畫：雲端已佔用的格子跳過，不覆寫（匯入不該蓋掉手動存的）', () => {
  const rows = planCloudImport(
    [item('a', PILOT, 'AAA'), item('b', PILOT, 'BBB')],
    cloudOf({ [PILOT]: { '0': 'ZZZ', '2': 'YYY' } }),
  )
  assert.deepEqual(rows.map((r) => r.outcome), [
    { kind: 'import', slot: '1' },
    { kind: 'import', slot: '3' },
  ])
})

test('匯入計畫：同機師超過 5 套 ⇒ 第 6 筆起是 full，留在本機書架上', () => {
  const rows = planCloudImport(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => item(id, PILOT, `code-${id}`)),
    cloudOf({}),
  )
  assert.deepEqual(rows.slice(0, 5).map((r) => r.outcome.kind), ['import', 'import', 'import', 'import', 'import'])
  assert.deepEqual(rows.slice(5).map((r) => r.outcome), [{ kind: 'full' }, { kind: 'full' }])
})

test('匯入計畫：整批一起算 —— 同機師的第二筆知道第一筆佔走了哪一格', () => {
  // 逐筆各算各的話，兩筆都會挑到 '1'，後寫的把先寫的蓋掉而且不會報錯
  const rows = planCloudImport(
    [item('a', PILOT, 'AAA'), item('b', PILOT, 'BBB')],
    cloudOf({ [PILOT]: { '0': 'ZZZ' } }),
  )
  const slots = rows.map((r) => (r.outcome.kind === 'import' ? r.outcome.slot : null))
  assert.deepEqual(slots, ['1', '2'])
  assert.notEqual(slots[0], slots[1], '兩筆不可以挑到同一格')
})

test('匯入計畫：不同機師各有各的 5 格（配額是 per-pilot 不是全站）', () => {
  const OTHER = 'pilot_088_曜'
  const rows = planCloudImport(
    [item('a', PILOT, 'AAA'), item('b', OTHER, 'BBB'), item('c', PILOT, 'CCC')],
    cloudOf({}),
  )
  assert.deepEqual(rows.map((r) => r.outcome), [
    { kind: 'import', slot: '0' },
    { kind: 'import', slot: '0' },
    { kind: 'import', slot: '1' },
  ])
})

test('匯入是 idempotent：同一串代碼已在雲端 ⇒ duplicate，不佔第二格', () => {
  const rows = planCloudImport(
    [item('a', PILOT, 'AAA'), item('b', PILOT, 'BBB')],
    cloudOf({ [PILOT]: { '3': 'AAA' } }),
  )
  assert.deepEqual(rows.map((r) => r.outcome), [
    { kind: 'duplicate', slot: '3' },
    { kind: 'import', slot: '0' },
  ])
})

test('匯入是 idempotent：連按兩次，第二次全部是 duplicate（雲端筆數不變）', () => {
  const items = [item('a', PILOT, 'AAA'), item('b', PILOT, 'BBB'), item('c', PILOT, 'CCC')]
  const first = planCloudImport(items, cloudOf({}))

  // 把第一次的結果併進雲端狀態，再跑一次
  const after: Partial<Record<CloudSlot, string>> = {}
  for (const r of first) if (r.outcome.kind === 'import') after[r.outcome.slot] = r.code
  const second = planCloudImport(items, cloudOf({ [PILOT]: after }))

  assert.deepEqual(second.map((r) => r.outcome.kind), ['duplicate', 'duplicate', 'duplicate'])
  assert.equal(summarizeImportPlan(second).willImport, 0, '第二次不該再寫任何一筆')
  assert.equal(Object.keys(after).length, 3, '雲端仍然只有三格')
})

test('匯入計畫：五格滿了但這一套本來就在裡面 ⇒ 說「已經有了」而不是「滿了」', () => {
  const full = { '0': 'A', '1': 'B', '2': 'C', '3': 'D', '4': 'AAA' } as Partial<Record<CloudSlot, string>>
  const rows = planCloudImport([item('a', PILOT, 'AAA')], cloudOf({ [PILOT]: full }))
  assert.deepEqual(rows[0].outcome, { kind: 'duplicate', slot: '4' })
})

test('匯入計畫：解不開／沒有機師的一律 broken，且不佔格也不影響其他筆', () => {
  const rows = planCloudImport(
    [item('bad', null, 'XXX'), item('a', PILOT, 'AAA')],
    cloudOf({}),
  )
  assert.deepEqual(rows[0].outcome, { kind: 'broken' })
  assert.deepEqual(rows[1].outcome, { kind: 'import', slot: '0' }, 'broken 的那一筆不該佔走第 0 格')
})

test('匯入計畫：沒勾的不進去，但也不佔格', () => {
  const rows = planCloudImport(
    [item('a', PILOT, 'AAA', false), item('b', PILOT, 'BBB')],
    cloudOf({}),
  )
  assert.deepEqual(rows.map((r) => r.outcome), [
    { kind: 'unselected' },
    { kind: 'import', slot: '0' },
  ])
})

test('summarizeImportPlan：五種下場各自數對', () => {
  const rows = planCloudImport(
    [
      item('a', PILOT, 'AAA'), item('b', PILOT, 'BBB'), item('c', PILOT, 'CCC'),
      item('d', PILOT, 'DDD'), item('e', PILOT, 'EEE'), item('f', PILOT, 'FFF'),
      item('dup', PILOT, 'ZZZ'), item('bad', null, 'XXX'), item('no', PILOT, 'NNN', false),
    ],
    cloudOf({ [PILOT]: { '4': 'ZZZ' } }),
  )
  assert.deepEqual(summarizeImportPlan(rows), {
    willImport: 4, duplicate: 1, full: 2, broken: 1, unselected: 1,
  })
})
