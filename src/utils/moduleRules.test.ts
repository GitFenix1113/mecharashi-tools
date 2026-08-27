// PLAN-052-G A-5：模組候選池與接口 gate 的 CI 守門測試
//   npm test   →   node --test "src/**/*.test.ts"
//
// ── 這份測試守的是什麼 ──────────────────────────────────────────────────────
// `moduleCandidates()` 圈出來的 186 筆是**整個模組槽功能的入口**：挑選器列它、
// 分享碼編它、`canEquipModule()` 拿它當前提。而規則的三個判準（`boundMechId` /
// `slot` / 具名排除）全都建立在官方今天的資料組成上。
//
// ⚠ **任何一條掛掉，該修的是 `moduleRules.ts` 或資料，不是把數字改到剛好通過。**
//   數字對不上代表官方改了模組的分類方式，而候選池正建立在那個結構上。
//
// fixture 是 2026-08-27 正式 Firestore 的快照，由 `scripts/gen-module-fixture.mjs`
// 產出（官方改版後重跑）。測試不連線 —— CI 與離線開發都要跑得動。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ModuleSlot, PartInterface } from '../types/enums.ts'
import {
  EXCLUDED_MODULE_IDS, interfaceAcceptsRarity, interfaceState,
  isModuleCandidate, moduleCandidates,
  moduleLevelAt, moduleMaxLevel, moduleStatsAt, sumModuleStats,
  moduleFamilyKey, moduleStacks, stackLevelOf,
} from './moduleRules.ts'
import { buildShareIndex } from './loadoutCode/shareId.ts'

interface Fixture {
  id: string
  name: string
  slot: string
  rarity: string
  boundMechId: string | null
  boundPart: string[] | null
  available: boolean | null
  moduleAddLevel: number | null
  source: unknown
  managedBy: string | null
  levels: { level: number }[]
  /** 頂層那排平坦數值欄位是不是全 0（鍵空間 ＝ 全庫 levels[] 出現過的數值鍵聯集） */
  flatAllZero: boolean
}

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'modules.json',
)
const MODULES: Fixture[] = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))

/**
 * 別名表。**不 import `shareIdRegistry.ts`** —— 那一支 `import` JSON 模組，
 * 而 `node --test` 需要 import attribute、Vite 不需要，兩邊寫法無法共存。
 * 這裡直接讀同一份 JSON，讀的是同一個真相源。
 */
const REGISTRY = JSON.parse(fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'loadoutCode', 'shareIdRegistry.json'), 'utf8',
)) as { kinds: Record<string, { aliases: Record<string, number> }> }
const MODULE_ALIASES = REGISTRY.kinds.module?.aliases ?? {}
const POOL = moduleCandidates(MODULES)

// ─── 守門斷言（進度表 A-5 的四條）───────────────────────────────────────────

test('守門①：候選池恰為 186 筆', () => {
  assert.equal(MODULES.length, 241, 'fixture 筆數變了 —— 官方改版後請重跑 gen-module-fixture.mjs')
  assert.equal(MODULES.filter((m) => m.boundMechId == null).length, 198, '沒綁機甲的筆數')
  assert.equal(POOL.length, 186, '候選池 ＝ 198 − 副模組 11 − mod_2030 1')

  // 組成也一起釘住：特性 74 ／ 8級 50 ／ 通用 62（挑選器的分類就照這個分）
  const bySlot: Record<string, number> = {}
  for (const m of POOL) bySlot[m.slot] = (bySlot[m.slot] ?? 0) + 1
  assert.deepEqual(bySlot, { [ModuleSlot.SLOT_4]: 74, [ModuleSlot.SLOT_8]: 50, [ModuleSlot.UNIVERSAL]: 62 })
})

test('守門②：Ⅰ型接口候選（rarity A）恰為 42 筆', () => {
  const a = POOL.filter((m) => m.rarity === 'A')
  assert.equal(a.length, 42, 'Ⅰ型接口只收 A 級 —— 這個數字就是那 16 台 A 級機甲的可選範圍')
  assert.equal(POOL.filter((m) => m.rarity === 'S').length, 144)
  // 兩型接口實際收到的筆數，就是上面兩個數字的組合
  assert.equal(POOL.filter((m) => interfaceAcceptsRarity(PartInterface.TYPE_I, m.rarity)).length, 42)
  assert.equal(POOL.filter((m) => interfaceAcceptsRarity(PartInterface.TYPE_II, m.rarity)).length, 186)
})

test('守門③：副模組 11 筆與 mod_2030 都不在池裡', () => {
  const builtIn = MODULES.filter((m) => m.slot === ModuleSlot.BUILT_IN)
  assert.equal(builtIn.length, 11)
  for (const m of builtIn) assert.equal(isModuleCandidate(m), false, `${m.id} 不該進池`)

  // ⚠ `available` **不可**當唯一 gate：11 筆副模組裡有 10 筆是 true（值域已漂移）。
  //    這條斷言存在的理由就是攔住「改用 available 判比較直覺」那個念頭。
  assert.equal(builtIn.filter((m) => m.available === true).length, 10)

  for (const id of EXCLUDED_MODULE_IDS) {
    const doc = MODULES.find((m) => m.id === id)
    assert.ok(doc, `${id} 已不在庫裡 —— 排除清單該跟著清掉，留著就是一個沒有理由的死 id`)
    assert.equal(POOL.some((m) => m.id === id), false, `${id} 不該進池`)
  }
  // mod_2030 是官方廢案的證據：`source` 是字串而非陣列（其餘 240 筆都是陣列）
  assert.equal(typeof MODULES.find((m) => m.id === 'mod_2030')!.source, 'string')

  // 排掉 mod_2030 之後，池內不再有同名模組（計畫書決策九：同名消歧義已不需要）
  const names = POOL.map((m) => m.name)
  assert.equal(new Set(names).size, names.length, '候選池出現同名模組 —— 挑選器需要消歧義了')
})

test('守門④：候選池 levels[] 覆蓋率 100%，且長度只有 4 或 8', () => {
  const empty = POOL.filter((m) => !m.levels?.length)
  assert.deepEqual(empty.map((m) => m.id), [], '有候選模組沒有各階數值 —— 裝上去會沒有任何效果')

  const hist: Record<number, number> = {}
  for (const m of POOL) hist[m.levels.length] = (hist[m.levels.length] ?? 0) + 1
  // ⚠ **不可假設固定 8 階**：136 筆是 4 階（計畫書決策四）
  assert.deepEqual(hist, { 4: 136, 8: 50 })
})

// ─── 分享碼索引健康度（進度表 A-1 第三項）──────────────────────────────────

test('A-1：候選池 186/186 可分享、零撞號、零死別名', () => {
  const index = buildShareIndex('module', MODULES.map((m) => m.id), MODULE_ALIASES)

  assert.deepEqual(index.collisions, [], '模組 shareId 撞號 —— 分享碼會解成另一顆模組')
  assert.deepEqual(index.staleAliases, [], '別名指向已不存在的文件 —— 某些已流出的分享碼從此解不開')

  const unshareable = POOL.filter((m) => index.toShareId(m.id) === null)
  assert.deepEqual(
    unshareable.map((m) => `${m.id}｜${m.name}`), [],
    '有候選模組分享不出去 —— 官方新增了推導不出號碼的模組，該補別名（shareIdRegistry.json），'
    + '而不是讓它在分享碼裡靜默消失',
  )

  // 推導 145 ＋ 別名 41 ＝ 186（2026-08-27 盤點）。別名區的號碼一律 ≥ ALIAS_BASE。
  const aliased = POOL.filter((m) => index.toShareId(m.id)! >= 1_500_000)
  assert.equal(aliased.length, 41, '靠別名才分享得出去的候選模組筆數')
})

// ─── 接口 gate 的行為 ───────────────────────────────────────────────────────

test('interfaceState：空 ＝ 沒有接口，認不得 ＝ unknown，兩者不可混為一談', () => {
  assert.equal(interfaceState(''), 'none')
  assert.equal(interfaceState(null), 'none')
  assert.equal(interfaceState(undefined), 'none')
  assert.equal(interfaceState(PartInterface.TYPE_I), PartInterface.TYPE_I)
  assert.equal(interfaceState(PartInterface.TYPE_II), PartInterface.TYPE_II)
  // 星夜女神踩過的那個坑：兩個 U+2160 拼出來的假「Ⅱ」。它不是合法值，該被看見
  assert.equal(interfaceState('\u2160\u2160型接口'), 'unknown')
})

test('interfaceAcceptsRarity：Ⅰ型只收 A 級，Ⅱ型 A／S 皆可', () => {
  assert.equal(interfaceAcceptsRarity(PartInterface.TYPE_I, 'A'), true)
  assert.equal(interfaceAcceptsRarity(PartInterface.TYPE_I, 'S'), false)
  assert.equal(interfaceAcceptsRarity(PartInterface.TYPE_II, 'A'), true)
  assert.equal(interfaceAcceptsRarity(PartInterface.TYPE_II, 'S'), true)
})

test('候選池 boundPart 全為 null —— 部位 gate 今天不必做（計畫書「不在範圍內」）', () => {
  const bound = POOL.filter((m) => m.boundPart && m.boundPart.length > 0)
  assert.deepEqual(
    bound.map((m) => `${m.id}｜${m.name}`), [],
    '出現了限定部位的通用模組 —— 接口 gate 要多一條部位判定了',
  )
})

// ─── 讀數值一律走 levels[]（PLAN-052-G B-1）────────────────────────────────

test('B-1 的依據：候選池 186 筆裡有 131 筆的頂層平坦欄位全 0', () => {
  const zero = POOL.filter((m) => m.flatAllZero)
  assert.equal(zero.length, 131)

  // ⚠ 這個數字**不是**計畫書原先記的 163 —— 那個數字重算不出來（2026-08-27 複查，
  //   全庫任一種分母／鍵空間組合都得不到 163），已在計畫書與進度表更正。
  //   結論不變、而且更尖銳：讀頂層的話，候選池裡有 131 顆模組會顯示成
  //   「裝上去沒有任何效果」，而且不報錯 —— 0 是一個合法的數字。
  //   剩下的 55 筆頂層有值，其中 53 筆恰等於**滿階**值 ——
  //   也就是說讀頂層會得到「七成靜默歸零、三成剛好正確」這種最難查的分佈。
  assert.equal(POOL.length - zero.length, 55)
})

test('B-1：levels[i].level 恆為 i + 1 —— 索引寫法今天等價，但本層仍用欄位比對', () => {
  // 這條釘住的是**別處**的索引寫法（ModuleCard 的 `levels[level - 1]`）今天仍然安全。
  // 它掉了就代表官方塞進一筆缺階的模組，那時該改的是那些索引寫法。
  for (const m of MODULES) {
    m.levels.forEach((l, i) => assert.equal(l.level, i + 1, `${m.id} 的第 ${i} 階`))
  }
})

test('B-1：moduleMaxLevel / moduleLevelAt —— 不可假設固定 8 階', () => {
  const 四階 = { levels: [1, 2, 3, 4].map((level) => ({ level })) } as never
  const 八階 = { levels: [1, 2, 3, 4, 5, 6, 7, 8].map((level) => ({ level })) } as never
  assert.equal(moduleMaxLevel(四階), 4)
  assert.equal(moduleMaxLevel(八階), 8)
  assert.equal(moduleMaxLevel({ levels: [] } as never), 0)
  assert.equal(moduleMaxLevel({} as never), 0)

  assert.equal(moduleLevelAt(四階, 4)?.level, 4)
  // 4 階的模組問第 8 階 ⇒ null，不是 undefined 索引再 NaN 傳染整條加總
  assert.equal(moduleLevelAt(四階, 8), null)
  assert.equal(moduleLevelAt(四階, 0), null)
})

test('B-1：moduleStatsAt 只回非零欄位（30 欄裡 29 欄是 0 的表沒有人讀得下去）', () => {
  const mod = {
    levels: [
      { level: 1, dmg: 8, crit_rate: 0, acc_rate: 0, description: '第一階' },
      { level: 2, dmg: 15, crit_rate: 3, acc_rate: 0, description: '第二階' },
    ],
  } as never
  assert.deepEqual(moduleStatsAt(mod, 1), { dmg: 8 })
  assert.deepEqual(moduleStatsAt(mod, 2), { dmg: 15, crit_rate: 3 })
  // 查無此階回**空物件**而不是 null —— 空加成是 Σ 的恆等元，呼叫端不必各寫一次防呆
  assert.deepEqual(moduleStatsAt(mod, 9), {})
  assert.deepEqual(moduleStatsAt({ levels: [] } as never, 1), {})
})

test('B-1：sumModuleStats Σ 同名欄位，缺席的欄位不互相污染', () => {
  assert.deepEqual(
    sumModuleStats([{ dmg: 15 }, { dmg: 10, crit_rate: 3 }, { acc_rate: 5 }]),
    { dmg: 25, crit_rate: 3, acc_rate: 5 },
  )
  assert.deepEqual(sumModuleStats([]), {})
  assert.deepEqual(sumModuleStats([{}, {}]), {})
})

test('B-1：四個部位各自的等級 —— 同一顆模組在不同接口是不同階', () => {
  // 決策八逐字：加總的是「各自等級上的」值，不是把滿級值加一加。
  // 這裡用同一顆 4 階模組模擬「一格滿階、一格只到第 2 階」的情形。
  const mod = {
    levels: [
      { level: 1, dmg: 5 }, { level: 2, dmg: 8 }, { level: 3, dmg: 12 }, { level: 4, dmg: 15 },
    ],
  } as never
  const 四部位 = [4, 2].map((lv) => moduleStatsAt(mod, lv))
  assert.deepEqual(sumModuleStats(四部位), { dmg: 23 })
})

// ─── 分享碼帶得走模組（PLAN-052-G C-5，第一半）─────────────────────────────
//
// codec 的 §MODULES 段自 052-C 就寫好了，但**從來沒有被真實資料餵過** ——
// A-1 之前 `shareIndexes.module` 是空索引，encode 時 `toShareId()` 一律回 null，
// 那一段永遠編出零筆。這裡用**正式庫的 241 筆 doc id ＋ 真的別名表**建索引，
// 走完整條 encode → decode，補上那個從沒被走過的路徑。
//
// ⚠ 這仍然**取代不了瀏覽器實地驗收**（進度表 C-5 逐字）：壞掉的可能是頁面那一層的接線，
//   而測試自己建索引。它守的是「索引與 codec 對得起來」，不是「LoadoutPage 傳對了東西」。

test('C-5：四個接口的模組全部進得了分享碼、也解得回來（真實 doc id ＋ 真實別名表）', async () => {
  const { encodeLoadout, decodeLoadout } = await import('./loadoutCode/codec.ts')
  const ix = {
    pilot: buildShareIndex('pilot', ['pilot_049_海莉絲']),
    mech: buildShareIndex('mech', ['mech_052_彌造者']),
    weapon: buildShareIndex('weapon', []),
    component: buildShareIndex('component', []),
    backpack: buildShareIndex('backpack', []),
    module: buildShareIndex('module', MODULES.map((m) => m.id), MODULE_ALIASES),
  }

  // 刻意挑**一顆走推導、一顆走別名**（別名的號碼 ≥ ALIAS_BASE，吃滿 3 bytes varint）
  const derived = POOL.find((m) => ix.module.toShareId(m.id)! < 1_500_000)!
  const aliased = POOL.find((m) => ix.module.toShareId(m.id)! >= 1_500_000)!
  const others = POOL.filter((m) => m.id !== derived.id && m.id !== aliased.id).slice(0, 2)

  const draft = {
    activeSetKey: 'default',
    sets: {},
    pilotId: 'pilot_049_海莉絲',
    mechId: 'mech_052_彌造者',
    modules: {
      torso: derived.id,
      leftArm: aliased.id,
      rightArm: others[0].id,
      legs: others[1].id,
    },
  }

  const code = encodeLoadout(draft, { indexes: ix })
  const res = decodeLoadout(code, ix)
  assert.equal(res.ok, true)
  assert.deepEqual(res.ok && res.draft.modules, draft.modules)
  assert.deepEqual(res.ok && res.unresolved, [])
})

test('C-5：候選池 186 顆逐一走完 encode → decode，一顆都不掉', async () => {
  // 「四顆抽樣通過」不等於「186 顆都可以」—— 別名區與推導區的 varint 長度不同，
  // 而 codec 對 3 bytes 以上視為 bug。逐顆跑一次才問得出「有沒有哪一顆編不進去」。
  const { encodeLoadout, decodeLoadout } = await import('./loadoutCode/codec.ts')
  const ix = {
    pilot: buildShareIndex('pilot', []),
    mech: buildShareIndex('mech', ['mech_052_彌造者']),
    weapon: buildShareIndex('weapon', []),
    component: buildShareIndex('component', []),
    backpack: buildShareIndex('backpack', []),
    module: buildShareIndex('module', MODULES.map((m) => m.id), MODULE_ALIASES),
  }
  const bad: string[] = []
  for (const m of POOL) {
    const draft = { activeSetKey: 'default', sets: {}, mechId: 'mech_052_彌造者', modules: { torso: m.id } }
    const res = decodeLoadout(encodeLoadout(draft, { indexes: ix }), ix)
    if (!res.ok || res.draft.modules?.torso !== m.id) bad.push(`${m.id}｜${m.name}`)
  }
  assert.deepEqual(bad, [], '這些模組進不了分享碼 —— 玩家配得出來卻分享不了')
})

// ─── 同族堆疊與超限（PLAN-052-G C-7，使用者裁決 2026-08-27）────────────────
//
// 機制：同一顆模組可以裝在多個接口上，而那正是升它等級的方式 ——
// 每一顆 ＋`moduleAddLevel`，上限是該模組 `levels[]` 的階數。
// 使用者的例子：四顆刀劍模組Ⅱ ⇒ Σ 8，但它只有 4 階 ⇒ 生效 Lv4、白費 4 級。

test('C-7 守門：候選池去階後恰為 155 族，其中 31 個雙人族全部是 1＋2', () => {
  const fam = new Map<string, typeof POOL>()
  for (const m of POOL) {
    const k = moduleFamilyKey(m)
    if (!fam.has(k)) fam.set(k, [])
    fam.get(k)!.push(m)
  }
  assert.equal(fam.size, 155, '族數變了 —— 官方改了通用模組的 Ⅰ／Ⅱ 命名方式')

  const sizes: Record<number, number> = {}
  for (const v of fam.values()) sizes[v.length] = (sizes[v.length] ?? 0) + 1
  assert.deepEqual(sizes, { 1: 124, 2: 31 }, '124 個單人族（特性 74 ＋ 8級 50）＋ 31 個通用模組的 Ⅰ／Ⅱ 配對')

  for (const [key, v] of fam) {
    if (v.length !== 2) continue
    assert.deepEqual(
      v.map((m) => m.moduleAddLevel).sort(), [1, 2],
      `${key} 的兩名成員應該是 add 1（Ⅰ・A 級）與 add 2（Ⅱ・S 級）`,
    )
    // 兩者的階數必須一致 —— 它們是同一顆模組的兩個貢獻階，數值表本來就同一份
    assert.equal(v[0].levels.length, v[1].levels.length, `${key} 的兩名成員階數不一致`)
  }
})

test('C-7 守門：族鍵帶 slot 前綴，今天沒有跨槽位撞名（也不許有）', () => {
  const byBase = new Map<string, Set<string>>()
  for (const m of POOL) {
    const base = moduleFamilyKey(m).split(':').slice(1).join(':')
    if (!byBase.has(base)) byBase.set(base, new Set())
    byBase.get(base)!.add(m.slot)
  }
  const cross = [...byBase.entries()].filter(([, slots]) => slots.size > 1)
  assert.deepEqual(cross.map(([b]) => b), [], '有基底名跨兩種槽位 —— 幸好族鍵帶前綴，但要知道這件事發生了')
})

test('C-7 守門：三種槽位的 addLevel 與階數', () => {
  const g = (slot: string) => POOL.filter((m) => m.slot === slot)
  const shape = (slot: string) => {
    const t: Record<string, number> = {}
    for (const m of g(slot)) t[`add${m.moduleAddLevel}/lv${m.levels.length}`] = (t[`add${m.moduleAddLevel}/lv${m.levels.length}`] ?? 0) + 1
    return t
  }
  assert.deepEqual(shape(ModuleSlot.UNIVERSAL), { 'add1/lv4': 31, 'add2/lv4': 31 })
  assert.deepEqual(shape(ModuleSlot.SLOT_4), { 'add1/lv4': 74 })
  // ⚠ 8 級模組有 8 階但 add 恆為 1 ⇒ 四個接口最多只給得出 4 級。
  //   差額來自機甲自帶的那一顆（等級隨品質階），站上目前只算接口這一段 —— 見 EightLevelNote。
  assert.deepEqual(shape(ModuleSlot.SLOT_8), { 'add1/lv8': 50 })
})

test('C-7：使用者的例子 —— 四顆刀劍模組Ⅱ 合計 8 級，上限 4，白費 4 級', () => {
  const 刀劍Ⅱ = { id: 'mod_4090_2', name: '刀劍模組Ⅱ', slot: ModuleSlot.UNIVERSAL, rarity: 'S', moduleAddLevel: 2,
    levels: [1, 2, 3, 4].map((level) => ({ level })) } as never
  const stacks = moduleStacks(
    { torso: 'mod_4090_2', leftArm: 'mod_4090_2', rightArm: 'mod_4090_2', legs: 'mod_4090_2' },
    () => 刀劍Ⅱ,
  )
  assert.equal(stacks.size, 1)
  const st = [...stacks.values()][0]
  assert.equal(st.sum, 8)
  assert.equal(st.cap, 4)
  assert.equal(st.level, 4, '生效等級封頂')
  assert.equal(st.overflow, 4, '白費的級數 —— 這個數字就是要提醒玩家的那一個')
  assert.deepEqual(st.positions, ['torso', 'leftArm', 'rightArm', 'legs'])
})

test('C-7：兩顆就滿 —— 沒有 overflow 時不該誤報', () => {
  const 刀劍Ⅱ = { id: 'x2', name: '刀劍模組Ⅱ', slot: ModuleSlot.UNIVERSAL, rarity: 'S', moduleAddLevel: 2,
    levels: [1, 2, 3, 4].map((level) => ({ level })) } as never
  const st = [...moduleStacks({ torso: 'x2', legs: 'x2' }, () => 刀劍Ⅱ).values()][0]
  assert.equal(st.sum, 4)
  assert.equal(st.level, 4)
  assert.equal(st.overflow, 0)
})

test('C-7：Ⅰ 與 Ⅱ 混裝算同一族（1 ＋ 2 ＝ 3 級）', () => {
  // 兩者的 levels[] 完全相同，差別只在貢獻的等級 —— 它們是同一顆模組的兩個階
  const Ⅰ = { id: 'a', name: '校準模組Ⅰ', slot: ModuleSlot.UNIVERSAL, rarity: 'A', moduleAddLevel: 1,
    levels: [1, 2, 3, 4].map((level) => ({ level })) } as never
  const Ⅱ = { id: 'b', name: '校準模組Ⅱ', slot: ModuleSlot.UNIVERSAL, rarity: 'S', moduleAddLevel: 2,
    levels: [1, 2, 3, 4].map((level) => ({ level })) } as never
  const map: Record<string, unknown> = { a: Ⅰ, b: Ⅱ }
  const stacks = moduleStacks({ torso: 'a', leftArm: 'b' }, (id) => map[id] as never)
  assert.equal(stacks.size, 1, '混裝 Ⅰ／Ⅱ 應併成一族')
  const st = [...stacks.values()][0]
  assert.equal(st.sum, 3)
  assert.equal(st.level, 3)
  assert.equal(st.mod.name, '校準模組Ⅱ', '代表取貢獻高的那一顆')
})

test('C-7：不同族各自獨立計算，互不影響', () => {
  const a = { id: 'a', name: '校準模組Ⅱ', slot: ModuleSlot.UNIVERSAL, rarity: 'S', moduleAddLevel: 2,
    levels: [1, 2, 3, 4].map((level) => ({ level })) } as never
  const b = { id: 'b', name: '攻堅模組', slot: ModuleSlot.SLOT_8, rarity: 'S', moduleAddLevel: 1,
    levels: [1, 2, 3, 4, 5, 6, 7, 8].map((level) => ({ level })) } as never
  const map: Record<string, unknown> = { a, b }
  const stacks = moduleStacks({ torso: 'a', leftArm: 'a', rightArm: 'b', legs: 'b' }, (id) => map[id] as never)
  assert.equal(stacks.size, 2)
  assert.equal(stackLevelOf(stacks, a), 4)          // 2 ＋ 2，剛好滿
  assert.equal(stackLevelOf(stacks, b), 2)          // 1 ＋ 1，離 8 階還很遠
  assert.equal([...stacks.values()].filter((s) => s.overflow > 0).length, 0)
})

test('C-7：查不到的 id 跳過，不讓整份堆疊爛掉', () => {
  const stacks = moduleStacks({ torso: '不存在', leftArm: '也不存在' }, () => undefined)
  assert.equal(stacks.size, 0)
})

test('C-7：stackLevelOf 對沒裝的模組回 0（＝「沒裝」，不是 0 級）', () => {
  const stacks = moduleStacks({}, () => undefined)
  assert.equal(stackLevelOf(stacks, { name: '校準模組Ⅱ', slot: ModuleSlot.UNIVERSAL }), 0)
})

// ─── 資料守門：Ⅰ／Ⅱ 配對的滿階數值必須一致 ────────────────────────────────
//
// 2026-08-27 Phase C 實地驗收時抓到的：站上把「刀劍模組Ⅱ」的加成印成「浮游炮傷害 +10%」。
// 那不是渲染錯誤 —— Firestore 裡那一筆的滿階數值真的落在 `dmg_funnel` 上。
//
// Ⅰ 與 Ⅱ 是**同一顆模組的兩個貢獻階**，`levels[]` 本來就該逐欄相同（實測 31 族裡 27 族相同），
// 所以「兩者不一致」是一個抓得到抄錯的訊號。本測試把它釘住。
//
// ⚠ 已知的 4 族是**資料缺陷，不是規則問題** —— 要走 data-patch 流程改 Firestore 並 bump 版本，
//   不屬於 PLAN-052-G（本計畫只碰模擬器，不改資料）。列在具名白名單裡，修好之後把該行刪掉；
//   **不要為了讓測試變綠而放寬條件** —— 這張表的用途正是讓下一筆抄錯立刻被看見。

/** 已知不一致的族（`slot:基底名`）。每一筆都要寫清楚錯在哪，一個沒有理由的白名單沒有人敢動。 */
const KNOWN_TIER_MISMATCH: Record<string, string> = {
  '通用模組:刀劍模組':   'Ⅰ 滿階無數值；Ⅱ 的 10% 落在 dmg_funnel（應為 dmg_blade）',
  '通用模組:電鋸模組':   'Ⅱ 的 10% 落在 dmg_blade（應為 dmg_chainsaw）',
  '通用模組:拳套模組':   'Ⅰ 滿階無數值（Ⅱ 的 dmg_fist 是對的）',
  '通用模組:浮游炮模組': 'Ⅰ 滿階無數值（Ⅱ 的 dmg_funnel 是對的）',
}

test('資料守門：31 個 Ⅰ／Ⅱ 配對的滿階數值一致（4 族已知抄錯，待 data-patch）', () => {
  const fam = new Map<string, Fixture[]>()
  for (const m of POOL) {
    const k = moduleFamilyKey(m)
    if (!fam.has(k)) fam.set(k, [])
    fam.get(k)!.push(m)
  }

  // fixture 只留 level 不留數值（刻意的，見 gen-module-fixture.mjs），
  // 所以這一條守的是**階數**與**白名單本身**；數值的比對在產出 fixture 時做不到，
  // 由下面那條「白名單裡的族確實還在」＋ 人工的 data-patch 流程接手。
  const pairs = [...fam.entries()].filter(([, v]) => v.length === 2)
  assert.equal(pairs.length, 31)

  for (const [key, v] of pairs) {
    assert.equal(
      v[0].levels.length, v[1].levels.length,
      `${key}：Ⅰ 與 Ⅱ 的階數不一致 —— 它們是同一顆模組的兩個貢獻階，數值表該是同一份`,
    )
  }

  // 白名單裡的族必須都還在池裡：修好資料之後這裡不會掛，但**改名或下架**時會 ——
  // 那時該有人來決定這一行是要刪掉還是改指向新名字。
  for (const key of Object.keys(KNOWN_TIER_MISMATCH)) {
    assert.ok(fam.has(key), `${key} 已不在候選池 —— 白名單這一行該清掉了（原因：${KNOWN_TIER_MISMATCH[key]}）`)
  }
})
