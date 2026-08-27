// 機甲模組接口的 CI 守門測試 —— 2026-08-27
//   npm test   →   node --test "src/**/*.test.ts"
//
// ── 這份測試守的是什麼 ──────────────────────────────────────────────────────
// 「接口 ＝ f(quality, position)」這條規則是**觀察**（官方 83 台 332 格零例外），
// 不是官方保證。所以我們**不**用它取代資料，而是用它守住資料：
// 全庫 360 格若有任何一格偏離，這裡立刻掛掉。
//
// ⚠ **掛掉時該做的是回官方對帳**，決定要改規則、還是把那台列進具名白名單 ——
//   **不是把斷言的數字改到剛好通過**。數字對不上代表官方動了接口的設計，
//   而 PLAN-052-G 的接口 gate（Ⅰ型只收 A 級模組）正建立在這個結構上。
//
// ── 為什麼需要這一層（下拉選單擋不住的錯）──────────────────────────────────
// 2026-08-27 修掉的 bug：星夜女神四格被存成 Ⅰ 型（原值是 `ⅠⅠ型接口`
// ＝ 兩個 U+2160 拼出來的假「Ⅱ」，PLAN-052-A D-1 正規化時收錯方向）。
// 後台的接口欄位**早就是下拉選單**，但選的是合法的 enum 值、只是選錯那一個 ——
// 型別擋不住、下拉擋不住，只有規則層擋得住。
//
// fixture 是正式 Firestore 的快照，由 `scripts/gen-mech-interface-fixture.mjs`
// 產出（新增機甲或改版動到 interface 後重跑）。測試不連線。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MechPartPosition, PartInterface } from '../types/enums.ts'
import {
  expectedInterface,
  expectedInterfaces,
  hasModuleInterface,
  isInterfaceOffRule,
} from './mechInterface.ts'

interface Fixture {
  id: string
  name: string
  quality: string
  armorType: string
  torso: string | null
  leftArm: string | null
  rightArm: string | null
  legs: string | null
}

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'mechInterfaces.json',
)
const MECHS: Fixture[] = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))

const POS = [
  MechPartPosition.TORSO,
  MechPartPosition.LEFT_ARM,
  MechPartPosition.RIGHT_ARM,
  MechPartPosition.LEGS,
] as const

/**
 * 已知且**刻意**偏離規則的機甲。今天是空的 —— 全庫 360 格零例外。
 *
 * ⚠ 往這裡加東西之前先回官方對帳。這張表的用途是「官方真的出了破格機甲」，
 *   不是「測試掛了想讓它綠」。每一筆都要附上對帳結論。
 */
const KNOWN_EXCEPTIONS: Record<string, string> = {}

// ─── 守門斷言 ───────────────────────────────────────────────────────────────

test('守門①：全庫每一格都符合 expectedInterface(quality, position)', () => {
  const off: string[] = []
  for (const m of MECHS) {
    if (KNOWN_EXCEPTIONS[m.id]) continue
    for (const pos of POS) {
      const actual = m[pos]
      if (actual === null) continue // 缺部位由 resolveChassis 的測試管，不是這裡的事
      if (isInterfaceOffRule(m.quality, pos, actual)) {
        off.push(`${m.id}｜${m.name}｜quality=${m.quality}｜${pos}｜實際=${JSON.stringify(actual)}｜應為=${JSON.stringify(expectedInterface(m.quality, pos))}`)
      }
    }
  }
  assert.deepEqual(
    off, [],
    '有機甲的接口偏離規則 —— 先回官方對帳，再決定改規則或加進 KNOWN_EXCEPTIONS，不要改數字',
  )
})

test('守門②：quality 的組成與各型接口的格數', () => {
  assert.equal(MECHS.length, 90, 'fixture 台數變了 —— 新增機甲後請重跑 gen-mech-interface-fixture.mjs')

  const byQuality = MECHS.reduce<Record<string, number>>((m, x) => ({ ...m, [x.quality]: (m[x.quality] ?? 0) + 1 }), {})
  assert.deepEqual(byQuality, { S: 64, A: 16, B: 10 }, 'quality 組成變了')

  const cells = MECHS.flatMap((m) => POS.map((p) => m[p]))
  const byValue = cells.reduce<Record<string, number>>((m, v) => {
    const k = v === '' ? '(空)' : v ?? '(缺部位)'
    return { ...m, [k]: (m[k] ?? 0) + 1 }
  }, {})
  assert.deepEqual(
    byValue,
    { [PartInterface.TYPE_II]: 288, [PartInterface.TYPE_I]: 32, '(空)': 40 },
    'Ⅱ288 ＝ S 級 64 台 × 4 ＋ A 級 16 台雙臂；Ⅰ32 ＝ A 級軀幹與腿部；空 40 ＝ B 級 10 台',
  )
})

test('守門③：空字串只出現在 B 品質 —— 「未建檔」這個狀態已不存在', () => {
  // 2026-08-27 起：美杜莎MK2 那 4 格已依 S 級規則補上 Ⅱ 型，
  // 空字串於是收斂成單一語意「這台沒有模組接口」。
  // 這條掛掉代表又有機甲的接口是空的，而它不是 B 級 —— 那是**漏建檔**，要去補。
  const emptyNonB = MECHS
    .filter((m) => m.quality !== 'B' && POS.some((p) => m[p] === ''))
    .map((m) => `${m.id}｜${m.name}｜quality=${m.quality}`)
  assert.deepEqual(
    emptyNonB, [],
    '非 B 品質的機甲出現空接口 —— 那是漏建檔，不是「沒有接口」（渲染層會把它講成「無模組接口」而那是錯的）',
  )
})

test('守門④：Ⅰ 型接口只存在於 A 品質機甲', () => {
  // PLAN-052-G 決策二直接依賴這一條：Ⅰ 型只收 rarity=A 的模組（候選 42 筆），
  // 而它今天只對 16 台 A 級機甲有意義。若 S 級也冒出 Ⅰ 型，那個候選池的
  // 適用範圍就變了 —— 屬於要重新裁決的事，不是靜默通過的事。
  const typeIOwners = MECHS.filter((m) => POS.some((p) => m[p] === PartInterface.TYPE_I))
  assert.deepEqual(
    [...new Set(typeIOwners.map((m) => m.quality))], ['A'],
    'Ⅰ 型接口出現在非 A 品質的機甲上 —— PLAN-052-G 的接口 gate 需要重新檢視',
  )
  assert.equal(typeIOwners.length, 16, 'A 品質機甲台數變了')
})

// ─── 純函式本身 ─────────────────────────────────────────────────────────────

test('expectedInterface：三個品質階的 pattern', () => {
  assert.deepEqual(expectedInterfaces('S'), {
    torso: PartInterface.TYPE_II, leftArm: PartInterface.TYPE_II,
    rightArm: PartInterface.TYPE_II, legs: PartInterface.TYPE_II,
  })
  assert.deepEqual(expectedInterfaces('A'), {
    torso: PartInterface.TYPE_I, leftArm: PartInterface.TYPE_II,
    rightArm: PartInterface.TYPE_II, legs: PartInterface.TYPE_I,
  })
  assert.deepEqual(expectedInterfaces('B'), {
    torso: '', leftArm: '', rightArm: '', legs: '',
  })
})

test('未知 quality 回 null，且不被判成偏離 —— 「不知道」不等於「錯」', () => {
  assert.equal(expectedInterface('SS', MechPartPosition.TORSO), null)
  assert.equal(expectedInterfaces('SS'), null)
  assert.equal(isInterfaceOffRule('SS', MechPartPosition.TORSO, '任何值'), false)
  assert.equal(isInterfaceOffRule('', MechPartPosition.TORSO, ''), false)
})

test('hasModuleInterface：只有 B 品質沒有接口', () => {
  assert.equal(hasModuleInterface('S'), true)
  assert.equal(hasModuleInterface('A'), true)
  assert.equal(hasModuleInterface('B'), false)
  // 未知 quality 回 true（expectedInterface 回 null ≠ ''）——
  // 呼叫端會走「有接口但值未知」的路徑，那比宣稱「這台沒有接口」安全。
  assert.equal(hasModuleInterface('SS'), true)
})

test('isInterfaceOffRule：undefined 與空字串等價', () => {
  assert.equal(isInterfaceOffRule('B', MechPartPosition.TORSO, undefined), false)
  assert.equal(isInterfaceOffRule('B', MechPartPosition.TORSO, ''), false)
  assert.equal(isInterfaceOffRule('S', MechPartPosition.TORSO, undefined), true)
  assert.equal(isInterfaceOffRule('S', MechPartPosition.TORSO, PartInterface.TYPE_I), true)
  assert.equal(isInterfaceOffRule('S', MechPartPosition.TORSO, PartInterface.TYPE_II), false)
})

test('回歸：星夜女神與美杜莎MK2 已修正（2026-08-27）', () => {
  // 這兩台是本規則的起因，釘住它們免得日後又被某支腳本改回去。
  for (const id of ['mech_089_星夜女神', 'mech_090_美杜莎MK2']) {
    const m = MECHS.find((x) => x.id === id)
    assert.ok(m, `${id} 不在 fixture 裡`)
    assert.equal(m.quality, 'S')
    for (const pos of POS) {
      assert.equal(m[pos], PartInterface.TYPE_II, `${id}.${pos} 應為 Ⅱ型接口`)
    }
  }
})
