// PLAN-052-D A-2：元件族的 CI 守門測試
//   npm test   →   node --test "src/**/*.test.ts"
//
// ── 這份測試守的是什麼 ──────────────────────────────────────────────────────
// `componentFamilyKey()` 由**名稱**推族（見該檔檔頭：判準就是名稱，落 Firestore 欄位
// 只會靜默不同步）。代價是它跟著官方的命名規則走，所以要有一組斷言在官方改規則時**立刻**掛掉。
//
// ⚠ **任何一條掛掉，該修的是 `componentRules.ts`，不是把數字改到剛好通過。**
//   數字對不上代表官方動了命名或元件庫的組成，而互斥規則正建立在那個結構上。
//
// fixture 是 2026-08-26 正式 Firestore 的快照，由 `scripts/gen-component-fixture.mjs`
// 產出（官方改版後重跑）。測試不連線 —— CI 與離線開發都要跑得動。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { componentFamilyKey, isSameFamily, parseComponentName } from './componentRules.ts'

interface Fixture {
  id: string
  name: string
  componentType: 'Condition' | 'Function'
  componentsWType: 'W' | 'Normal'
  rarity: string
  probabilityLevel: number
  allowedWeaponTypes: string[]
  condition?: string
}

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'components.json',
)
const COMPONENTS: Fixture[] = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))

// ─── 守門斷言 ───────────────────────────────────────────────────────────────

test('守門①：208 筆元件全部推得出族，0 例外', () => {
  assert.equal(COMPONENTS.length, 208, 'fixture 筆數變了 —— 官方改版後請重跑 gen-component-fixture.mjs')
  const orphans = COMPONENTS.filter((c) => componentFamilyKey(c) === null)
  assert.deepEqual(
    orphans.map((c) => `${c.id}｜${c.name}`), [],
    '有元件的名稱不吻合「觸元件｜應元件 ＋ 選配的 W ＋ 連字號 ＋ 後綴」—— 官方改了命名規則',
  )
})

test('守門②：族數恰為 56（觸 28 ＋ 應 28）', () => {
  const keys = new Set(COMPONENTS.map((c) => componentFamilyKey(c)!))
  const cond = new Set(COMPONENTS.filter((c) => c.componentType === 'Condition').map((c) => componentFamilyKey(c)!))
  const func = new Set(COMPONENTS.filter((c) => c.componentType === 'Function').map((c) => componentFamilyKey(c)!))

  // ⚠ 總綱決策五寫的是 28 —— 那個數字是**其中一半**（見 PLAN-052-D 計畫書決策二）。
  assert.equal(cond.size, 28, '觸元件的族數')
  assert.equal(func.size, 28, '應元件的族數')
  assert.equal(keys.size, 56, '總族數')

  // 分佈也一起釘住：24 族 6 筆 ＋ 12 族 3 筆 ＋ 8 族 2 筆 ＋ 12 族 1 筆 ＝ 208
  const sizes = new Map<string, number>()
  for (const c of COMPONENTS) {
    const k = componentFamilyKey(c)!
    sizes.set(k, (sizes.get(k) ?? 0) + 1)
  }
  const histogram: Record<number, number> = {}
  for (const n of sizes.values()) histogram[n] = (histogram[n] ?? 0) + 1
  assert.deepEqual(histogram, { 1: 12, 2: 8, 3: 12, 6: 24 }, '每族筆數的分佈')
})

test('守門③：觸元件的族與 condition 文字雙射', () => {
  const byFamily = new Map<string, Set<string>>()
  for (const c of COMPONENTS) {
    if (c.componentType !== 'Condition') continue
    const k = componentFamilyKey(c)!
    if (!byFamily.has(k)) byFamily.set(k, new Set())
    byFamily.get(k)!.add(c.condition ?? '')
  }

  // 單射：一族只有一種 condition
  const multi = [...byFamily.entries()].filter(([, set]) => set.size > 1)
  assert.deepEqual(multi.map(([k]) => k), [], '同一族出現了多種 condition 文字')

  // 滿射：一句 condition 不跨兩族
  const byCondition = new Map<string, string[]>()
  for (const [k, set] of byFamily) for (const t of set) {
    if (!byCondition.has(t)) byCondition.set(t, [])
    byCondition.get(t)!.push(k)
  }
  const shared = [...byCondition.entries()].filter(([, ks]) => ks.length > 1)
  assert.deepEqual(shared.map(([t, ks]) => `${t} → ${ks.join('、')}`), [], '同一句 condition 被多族共用')

  assert.equal(byFamily.size, 28)
  assert.equal(byCondition.size, 28)
})

test('守門④：名稱前綴與 componentType 一致', () => {
  // 互斥鍵由**名稱**推導，而可裝性規則（觸／應各自的槽數）讀的是 `componentType`。
  // 兩者一旦不同步，同一顆元件會被當成「觸元件的族」卻佔掉應元件的槽。
  const mismatched = COMPONENTS.filter((c) => parseComponentName(c.name)?.kind !== c.componentType)
  assert.deepEqual(mismatched.map((c) => `${c.id}｜${c.name}｜${c.componentType}`), [])
})

test('守門⑤：W 型 80 筆，且每個 W 型都有同族的 Normal 版本', () => {
  const w = COMPONENTS.filter((c) => c.componentsWType === 'W')
  assert.equal(w.length, 80)
  assert.equal(COMPONENTS.length - w.length, 128)

  // W 是「同效果但觸發機率等級更高」的變體，因此不該有孤兒 W 族 ——
  // 有的話代表官方出了一顆只存在 W 版的元件，那時互斥的跨變體判定要重新確認。
  const normalKeys = new Set(
    COMPONENTS.filter((c) => c.componentsWType !== 'W').map((c) => componentFamilyKey(c)!),
  )
  const orphanW = w.filter((c) => !normalKeys.has(componentFamilyKey(c)!))
  assert.deepEqual(orphanW.map((c) => c.name), [], '有 W 型元件找不到同族的 Normal 版本')
})

// ─── 函式行為 ───────────────────────────────────────────────────────────────

test('拆解名稱：三段結構', () => {
  assert.deepEqual(parseComponentName('觸元件W-憑逸'), { kind: 'Condition', wType: true, suffix: '憑逸' })
  assert.deepEqual(parseComponentName('觸元件-憑逸'), { kind: 'Condition', wType: false, suffix: '憑逸' })
  assert.deepEqual(parseComponentName('應元件W-戰慄'), { kind: 'Function', wType: true, suffix: '戰慄' })
  // 後綴含連字號時，只切第一個 —— `(.+)` 是貪婪的，切點由前面的錨定決定
  assert.deepEqual(parseComponentName('應元件-破-軀'), { kind: 'Function', wType: false, suffix: '破-軀' })
})

test('拆解名稱：破格一律回 null，不拋例外', () => {
  for (const bad of ['', '憑逸', '觸元件憑逸', '觸元件W憑逸', '元件-憑逸', '觸元件-']) {
    assert.equal(parseComponentName(bad), null, bad)
  }
})

test('互斥鍵跨 W／Normal 變體，也跨 S／A／B 三階', () => {
  // 實測：應元件W-戰慄 有 S／A／B 三個 doc，效果只差 BUFF 階級（Ⅴ／Ⅳ／Ⅲ）
  const 戰慄 = COMPONENTS.filter((c) => c.name.endsWith('-戰慄'))
  assert.equal(戰慄.length, 6, 'W 3 筆 ＋ Normal 3 筆')
  const keys = new Set(戰慄.map((c) => componentFamilyKey(c)!))
  assert.equal(keys.size, 1, '六筆同族')
  assert.equal([...keys][0], 'Function:戰慄')
})

test('互斥鍵帶觸／應前綴 —— 今天不需要，改版時才不會靜默併族', () => {
  assert.equal(componentFamilyKey({ name: '觸元件-憑逸' }), 'Condition:憑逸')
  assert.equal(componentFamilyKey({ name: '應元件-憑逸' }), 'Function:憑逸')
  assert.notEqual(componentFamilyKey({ name: '觸元件-憑逸' }), componentFamilyKey({ name: '應元件-憑逸' }))

  // 實測今天觸與應**沒有**共用任何後綴，所以上面那顆「應元件-憑逸」是假想的
  const suffixOf = (c: Fixture) => parseComponentName(c.name)!.suffix
  const condSuffix = new Set(COMPONENTS.filter((c) => c.componentType === 'Condition').map(suffixOf))
  const funcSuffix = new Set(COMPONENTS.filter((c) => c.componentType === 'Function').map(suffixOf))
  const shared = [...condSuffix].filter((s) => funcSuffix.has(s))
  assert.deepEqual(shared, [], '觸與應共用了後綴 —— 帶前綴的設計正好在此時發揮作用')
})

test('命名破格的元件永不互斥（null 族不與任何東西衝突）', () => {
  const 破格 = { name: '奇怪的元件' }
  assert.equal(componentFamilyKey(破格), null)
  assert.equal(isSameFamily(破格, 破格), false, 'null 族連自己都不算同族')
  assert.equal(isSameFamily(破格, { name: '觸元件-憑逸' }), false)
})

test('isSameFamily：同族為真、異族為假', () => {
  assert.equal(isSameFamily({ name: '觸元件W-憑逸' }, { name: '觸元件-憑逸' }), true)
  assert.equal(isSameFamily({ name: '觸元件-憑逸' }, { name: '觸元件-沉著' }), false)
})
