// 本機書架 —— PLAN-052-C D-1
//
// 這一層守的是「使用者的東西不會無聲消失」，所以測試的重點不在 happy path，
// 而在**壞掉的時候會怎樣**：壞資料、寫不進去、書架滿了、代碼解不開。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LoadoutDraft } from '../types/loadout'
import { buildShareIndex } from '../utils/loadoutCode/shareId.ts'
import { encodeLoadout, type ShareIndexes } from '../utils/loadoutCode/codec.ts'
import {
  readShelf, saveBuild, deleteBuild, SHELF_KEY, SHELF_LIMIT,
} from './localBuilds.ts'
// 052-E C-5：三態判定搬到 buildStatus.ts（本機與雲端書架共用同一支）
import { classifyBuild } from './buildStatus.ts'

// ─── 假的 storage ────────────────────────────────────────────────────────────

function fakeStore(seed?: string) {
  const map = new Map<string, string>()
  if (seed !== undefined) map.set(SHELF_KEY, seed)
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
  }
}

/** 寫入一律失敗（配額用盡／隱私模式）。 */
function fullStore() {
  return {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError') },
  }
}

// ─── 測試用的實體宇宙（形狀取自線上真實 doc id）──────────────────────────────

const UNIVERSE = {
  pilot: ['pilot_001_艾達', 'pilot_049_海莉絲'],
  mech: ['mech_001_初擊者', 'mech_052_彌造者'],
  weapon: ['weapon_016_藝術突襲EX', 'weapon_176_耀星'],
  component: ['comp_0001_應元件W_蓬勃'],
  backpack: ['60100104'],
  module: ['mod_4001'],
}

const indexesOf = (u: typeof UNIVERSE): ShareIndexes => ({
  pilot: buildShareIndex('pilot', u.pilot),
  mech: buildShareIndex('mech', u.mech),
  weapon: buildShareIndex('weapon', u.weapon),
  component: buildShareIndex('component', u.component),
  backpack: buildShareIndex('backpack', u.backpack),
  module: buildShareIndex('module', u.module),
})

const INDEXES = indexesOf(UNIVERSE)

const DRAFT: LoadoutDraft = {
  pilotId: 'pilot_049_海莉絲',
  mechId: 'mech_052_彌造者',
  activeSetKey: 'default',
  name: '主力',
  sets: {
    default: {
      mounts: [{ weaponId: 'weapon_176_耀星', bank: 'main', slot: 'singleHand', side: 'left' }],
    },
  },
}

const CODE = encodeLoadout(DRAFT, { indexes: INDEXES })

const named = (name: string) => encodeLoadout({ ...DRAFT, name }, { indexes: INDEXES })

// ─── 讀取：壞資料一律降級，不炸 ──────────────────────────────────────────────

test('readShelf：沒有 storage／空白／壞 JSON／不是陣列，一律回空陣列而不是丟例外', () => {
  assert.deepEqual(readShelf(undefined), [])
  assert.deepEqual(readShelf(fakeStore()), [])
  assert.deepEqual(readShelf(fakeStore('{{{')), [])
  assert.deepEqual(readShelf(fakeStore('{"a":1}')), [])
  assert.deepEqual(readShelf(fakeStore('null')), [])
})

test('readShelf：壞掉的那一筆丟掉、好的留著（一筆壞資料不該讓整個書架消失）', () => {
  const store = fakeStore(JSON.stringify([
    { id: 'a', code: CODE, savedAt: 1 },
    { id: 'b', code: CODE },                 // 缺 savedAt
    { id: '', code: CODE, savedAt: 2 },      // id 空字串
    { code: CODE, savedAt: 3 },              // 缺 id
    { id: 'c', code: '', savedAt: 4 },       // 代碼空字串 ＝ 沒有內容可還原
    { id: 'd', code: CODE, savedAt: Number.NaN },
    { id: 'e', code: CODE, savedAt: 5 },
    'not an object',
  ]))
  assert.deepEqual(readShelf(store).map((e) => e.id), ['a', 'e'])
})

test('readShelf：超過配額的舊資料只讀前 10 筆（配額縮小過也不會爆）', () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ id: `i${i}`, code: CODE, savedAt: i }))
  assert.equal(readShelf(fakeStore(JSON.stringify(many))).length, SHELF_LIMIT)
})

// ─── 存入 ────────────────────────────────────────────────────────────────────

test('saveBuild：新的排在最前面', () => {
  const store = fakeStore()
  const a = named('A')
  const b = named('B')
  saveBuild(a, { now: 1000, store })
  const r = saveBuild(b, { now: 2000, store })
  assert.equal(r.ok, true)
  assert.deepEqual(readShelf(store).map((e) => e.code), [b, a])
})

test('saveBuild：同一串代碼只佔一格，就地更新時間並移到最前（連按兩下不吃掉配額）', () => {
  const store = fakeStore()
  const first = saveBuild(CODE, { now: 1000, store })
  saveBuild(named('別套'), { now: 1500, store })
  const again = saveBuild(CODE, { now: 3000, store })

  assert.equal(again.ok && again.deduped, true)
  assert.equal(again.ok && again.id, first.ok && first.id, '同一筆的 id 不變')
  const shelf = readShelf(store)
  assert.equal(shelf.length, 2)
  assert.equal(shelf[0].code, CODE)
  assert.equal(shelf[0].savedAt, 3000)
})

test('saveBuild：滿了一律拒絕，不淘汰最舊的那一筆（「我明明存過」是最不能出現的一句話）', () => {
  const store = fakeStore()
  for (let i = 0; i < SHELF_LIMIT; i++) {
    assert.equal(saveBuild(named(`第${i}套`), { now: 1000 + i, store }).ok, true, `第 ${i} 套應該存得進去`)
  }
  const overflow = named('第十一套')
  const r = saveBuild(overflow, { now: 9999, store })
  assert.deepEqual(r, { ok: false, reason: 'full' })

  const shelf = readShelf(store)
  assert.equal(shelf.length, SHELF_LIMIT)
  assert.ok(shelf.every((e) => e.code !== overflow), '被拒絕的那一套不可以偷偷混進去')
  assert.ok(shelf.some((e) => e.savedAt === 1000), '最舊的那一筆必須還在')
})

test('saveBuild：滿了但存的是架上已有的那一串 ⇒ 仍然成功（去重不佔新格）', () => {
  const store = fakeStore()
  const codes = Array.from({ length: SHELF_LIMIT }, (_, i) => named(`第${i}套`))
  codes.forEach((c, i) => saveBuild(c, { now: 1000 + i, store }))
  const r = saveBuild(codes[0], { now: 9999, store })
  assert.equal(r.ok && r.deduped, true)
  assert.equal(readShelf(store).length, SHELF_LIMIT)
})

test('saveBuild：寫不進去時回報失敗，不可以假裝存好了', () => {
  assert.deepEqual(saveBuild(CODE, { now: 1, store: fullStore() }), { ok: false, reason: 'storage' })
})

test('saveBuild：空代碼不入架（編碼失敗時呼叫端傳進來的就是空字串）', () => {
  assert.deepEqual(saveBuild('', { now: 1, store: fakeStore() }), { ok: false, reason: 'empty' })
})

test('saveBuild：同一毫秒內存兩套也要有不同的 id（連點）', () => {
  const store = fakeStore()
  const a = saveBuild(named('A'), { now: 777, store })
  const b = saveBuild(named('B'), { now: 777, store })
  assert.notEqual(a.ok && a.id, b.ok && b.id)
})

// ─── 刪除 ────────────────────────────────────────────────────────────────────

test('deleteBuild：刪掉指定那一筆，其餘不動；刪不存在的 id 不是錯誤', () => {
  const store = fakeStore()
  const a = named('A')
  saveBuild(a, { now: 1, store })
  const rb = saveBuild(named('B'), { now: 2, store })
  const id = rb.ok ? rb.id : ''

  assert.deepEqual(deleteBuild(id, store).map((e) => e.code), [a])
  assert.deepEqual(deleteBuild('沒有這個 id', store).map((e) => e.code), [a])
})

// ─── 失效三態 ────────────────────────────────────────────────────────────────

test('classifyBuild：全部裝備都在 → ok', () => {
  const s = classifyBuild(CODE, INDEXES)
  assert.equal(s.state, 'ok')
  assert.deepEqual(s.missing, [])
  assert.equal(s.draft?.name, '主力')
})

test('classifyBuild：武器下架 → degraded，照樣給得出草稿（少一把好過整套不給看）', () => {
  const s = classifyBuild(CODE, indexesOf({ ...UNIVERSE, weapon: [] }))
  assert.equal(s.state, 'degraded')
  assert.equal(s.missing.length, 1)
  assert.equal(s.missing[0].kind, 'weapon')
  assert.deepEqual(s.missingIdentity, [])
  assert.equal(s.draft?.pilotId, 'pilot_049_海莉絲', '身分還在，草稿照常')
})

test('classifyBuild：機師不在了 → broken（套用只會得到空模擬器，而使用者會以為自己按錯）', () => {
  const s = classifyBuild(CODE, indexesOf({ ...UNIVERSE, pilot: [] }))
  assert.equal(s.state, 'broken')
  assert.deepEqual(s.missingIdentity, ['pilot'])
  assert.equal(s.draft?.name, '主力', 'broken 也要看得到原本是什麼')
})

test('classifyBuild：機甲不在了 → broken', () => {
  const s = classifyBuild(CODE, indexesOf({ ...UNIVERSE, mech: [] }))
  assert.equal(s.state, 'broken')
  assert.deepEqual(s.missingIdentity, ['mech'])
})

test('classifyBuild：代碼損毀 → broken 且帶著解碼器的中文說明，永不 throw', () => {
  for (const bad of ['', '!!!!', CODE.slice(0, -2), 'AAAA']) {
    const s = classifyBuild(bad, INDEXES)
    assert.equal(s.state, 'broken', `輸入：${bad}`)
    assert.equal(s.draft, undefined)
    assert.ok(s.message && s.message.length > 0, '損毀一定要說得出原因')
  }
})

test('classifyBuild：不修復也不刪除 —— 同一串壞代碼分類幾次都還在架上', () => {
  const store = fakeStore()
  saveBuild(CODE, { now: 1, store })
  const thin = indexesOf({ ...UNIVERSE, pilot: [] })
  classifyBuild(CODE, thin)
  classifyBuild(CODE, thin)
  assert.equal(readShelf(store).length, 1)
})
