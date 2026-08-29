// PLAN-052-K A-4：天生模組逐部位推導的 CI 守門測試
//   npm test   →   node --test "src/**/*.test.ts"
//
// ── 這份測試守的是什麼 ──────────────────────────────────────────────────────
// 天生模組的矩陣（90 台 × 4 部位 ≈ 1500 格）**不落盤、全部用算的**（決策一）。
// 所以規則本身就是資料 —— 規則錯了，1500 格一起錯，而且畫面上不會有任何錯誤訊息，
// 只會是一堆「看起來很合理但就是不對」的數字。
//
// ⚠ **任何一條掛掉，該修的是 `innateModules.ts` 或那台機甲的資料，
//   不是把斷言的數字改到剛好通過。**
//
// ── 期望值哪裡來 ────────────────────────────────────────────────────────────
// 下面八台的矩陣**不是從本檔的實作反推的**，而是 2026-08-28 由官方
// `aircraft_data/detail` 獨立解出來的（軀幹陣列是整台總表、其餘三部位是壓縮字串，
// 軀幹自身 ＝ 總表 − 其他三部位；全 83 台驗算無負值、無孤兒 id）。
// 每一台的註解都附上官方那側的合計數字，兩邊對得起來才是真的通過。
//
// 唯一的例外是**復仇女神那四顆〈模型-XX〉**：它們是彩甲「限制解除」後才啟動的隱藏模組，
// 官方的 `ModuleCarried` 從來不回傳，期望值來自站上人工資料 ＋ 站長的遊戲內截圖
// （限制解除說明逐字：軀幹[模型-武]／左臂[模型-月升]／右臂[模型-憐愛]／腿部[模型-無恙]）。
//
// fixture 由 `scripts/gen-innate-mech-fixture.mjs` 與 `gen-module-fixture.mjs` 產出。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MechPartPosition, ModuleSlot } from '../types/enums.ts'
import type { Module } from '../types/module.ts'
import {
  INNATE_LEVEL_RULE, innateRuleFor, exclusivePartLevel,
  resolveInnateModules, resolveInnateByPart, slotMultipliers,
  unlockBlocker, isModuleUnlocked,
  type InnateMechInput,
} from './innateModules.ts'
import { moduleStacks, moduleFamilyKey } from './moduleRules.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const load = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(here, '__fixtures__', f), 'utf8'))

/** 落盤 JSON 的原始形狀：沒有的欄位存成 null（InnateMechInput 那側是 undefined） */
interface MechFixtureRaw {
  id: string
  name: string
  quality: string
  module4Id: string | null
  module8Id: string | null
  moduleFixedIds: string[]
}
type MechFixture = InnateMechInput & { id: string; name: string; quality: string }
interface ModFixture {
  id: string; name: string; slot: string; rarity: string
  boundMechId: string | null; boundPart: string[] | null
  moduleAddLevel: number | null; levels: { level: number }[]
  // PLAN-052-K B-3 / B-4 落盤的兩個結構化欄位（241 筆裡各只有 6 / 2 筆有值）
  slotLevelMultiplier: string[] | null
  unlockCondition: { kind: string; moduleId?: string; pilotIds?: string[] } | null
}

// null → undefined：resolveInnateModules 兩者都當「沒有」，型別上則只認 undefined
const MECHS: MechFixture[] = load<MechFixtureRaw[]>('innateMechs.json').map((m) => ({
  ...m,
  module4Id: m.module4Id ?? undefined,
  module8Id: m.module8Id ?? undefined,
}))
const MODS = load<ModFixture[]>('modules.json')
const BY_ID = new Map<string, Module>(MODS.map((m) => [m.id, m as unknown as Module]))
const lookup = (id: string) => BY_ID.get(id)
const mechOf = (name: string): MechFixture => {
  const m = MECHS.find((x) => x.name === name)
  assert.ok(m, `fixture 裡找不到「${name}」—— 改名或刪檔了？請重跑 gen-innate-mech-fixture.mjs`)
  return m
}
const POS = Object.values(MechPartPosition)

/** 一台機甲的完整矩陣：部位 → { 模組 id: 該部位貢獻的級數 }。用物件而不是陣列，避免綁死順序。 */
function matrixOf(mech: InnateMechInput): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const pos of POS) {
    const cell: Record<string, number> = {}
    for (const e of resolveInnateModules(mech, pos, lookup).entries) cell[e.moduleId] = e.level
    out[pos] = cell
  }
  return out
}
/** 全機合計（四部位加總，未封頂）—— 拿來跟官方那側的數字對。 */
function totalsOf(mech: InnateMechInput): Record<string, number> {
  const out: Record<string, number> = {}
  for (const pos of POS) {
    for (const e of resolveInnateModules(mech, pos, lookup).entries) {
      out[e.moduleId] = (out[e.moduleId] ?? 0) + e.level
    }
  }
  return out
}

// ─── 規則表 ─────────────────────────────────────────────────────────────────

test('規則表：S／A／B 三階，滿階口徑', () => {
  assert.deepEqual(Object.keys(INNATE_LEVEL_RULE).sort(), ['A', 'B', 'S'])
  // 90 台的 quality 只有這三個值；多出第四種代表官方加了新階級，規則表要跟著補
  assert.deepEqual([...new Set(MECHS.map((m) => m.quality))].sort(), ['A', 'B', 'S'])
  for (const m of MECHS) assert.ok(innateRuleFor(m.quality), `${m.id} 的 quality「${m.quality}」不在規則表裡`)
  assert.equal(innateRuleFor('EX'), null)
  assert.equal(innateRuleFor(undefined), null)
})

test('規則表：A 級的 8 級模組只有軀幹與腿部（結構性上限 4/8）', () => {
  const a = INNATE_LEVEL_RULE.A
  assert.deepEqual(a.slot8, { torso: 1, leftArm: 0, rightArm: 0, legs: 1 })
  // 天生只給 2 級；而 A 級的軀幹與腿部接口停在 Ⅰ 型、Ⅰ 型只收 A 級模組、
  // 所有 8 級模組都是 S 級 ⇒ 只有雙臂兩格插得下，各 +1 ⇒ 上限 4/8。
  const innateSum = POS.reduce((s, p) => s + a.slot8[p], 0)
  assert.equal(innateSum, 2)
  const eightLevelAllS = MODS.filter((m) => m.slot === ModuleSlot.SLOT_8)
  assert.ok(eightLevelAllS.length > 0)
  assert.ok(eightLevelAllS.every((m) => m.rarity === 'S'), 'Ⅰ型接口只收 A 級 —— 一旦出現 A 級的 8 級模組，上述推論要重算')
  assert.ok(eightLevelAllS.every((m) => (m.moduleAddLevel ?? 1) === 1), '8 級模組的 addLevel 都是 1')
})

test('規則表：B 級全 0（10 台真的沒有這個槽，不是未建檔）', () => {
  for (const kind of ['trait', 'slot8', 'builtIn'] as const) {
    for (const p of POS) assert.equal(INNATE_LEVEL_RULE.B[kind][p], 0)
  }
  const b = MECHS.filter((m) => m.quality === 'B')
  assert.equal(b.length, 10)
  for (const m of b) assert.deepEqual(matrixOf(m), { torso: {}, leftArm: {}, rightArm: {}, legs: {} })
})

// ─── 專屬模組：boundPart × levels.length ────────────────────────────────────

test('exclusivePartLevel：24 顆專屬模組逐顆（levels.length > boundPart.length ⇒ 每部位 2）', () => {
  const ex = MODS.filter((m) => m.slot === ModuleSlot.EXCLUSIVE)
  assert.equal(ex.length, 24, '專屬模組筆數變了 —— 請重跑 gen-module-fixture.mjs 並複查下表')

  /** id → [綁定部位數, levels 階數, 每個綁定部位貢獻幾級]。第三欄是官方那側驗過的結果。 */
  const EXPECT: Record<string, [number, number, number]> = {
    // 一格一顆、只有 1 階 ⇒ 那一格出 1 級
    'mod_帕斯卡_fixed_1': [1, 1, 1], 'mod_帕斯卡_fixed_2': [1, 1, 1],
    'mod_帕斯卡_fixed_3': [1, 1, 1], 'mod_帕斯卡_fixed_4': [1, 1, 1],
    'mod_破曉者-02_fixed_1': [1, 1, 1], 'mod_破曉者-02_fixed_2': [1, 1, 1],
    'mod_破曉者-02_fixed_3': [1, 1, 1], 'mod_破曉者-02_fixed_4': [1, 1, 1],
    // 兩格湊 2 階 ⇒ 每格 1 級
    'mod_信仰之眼_fixed_1': [2, 2, 1], 'mod_2064': [2, 2, 1],
    // 一格扛 2 階 ⇒ 那一格出 2 級。輝龍四顆與影虎由官方兩端點驗出，
    // 彌造者〈帕姆斯陣列〉由站長實機確認（軀幹 LV1～3 為 1 級、LV4 彩才 2 級）
    'mod_輝龍_fixed_1': [1, 2, 2], 'mod_輝龍_fixed_2': [1, 2, 2],
    'mod_輝龍_fixed_3': [1, 2, 2], 'mod_輝龍_fixed_4': [1, 2, 2],
    'mod_影虎_fixed_1': [1, 2, 2], 'mod_彌造者_fixed_1': [1, 2, 2],
    // 星夜女神〈觀星者單元〉：B-2 由站長人工補上 torso（它不在官方那 83 台裡，腳本對不到帳）。
    // 與帕姆斯陣列同型（限制解除 ＋ 機師限定 ＋ 2 階綁一格）⇒ 那一格自己出 2 級。
    'mod_星夜女神_fixed_1': [1, 2, 2],
    // ── B-1 補完 levels[] 之後的階數（2026-08-28 由 patch-exclusive-module-levels.mjs 寫入）──
    // 三顆原本只存了 1 級、而且存的是**最高級**的文字；復仇女神四顆原本是空陣列。
    // ⚠ 第三欄（每部位貢獻）在補完前後**完全相同** —— Phase A 留的獨立測試守著這件事，
    //   所以這裡改動的只有中間那欄。改到第三欄就代表規則被資料帶著跑了。
    'mod_信仰之眼_fixed_2': [2, 2, 1],
    'mod_破曉者-01_fixed_1': [2, 2, 1], 'mod_破曉者-01_fixed_2': [2, 2, 1],
    'mod_復仇女神_fixed_1': [1, 1, 1], 'mod_復仇女神_fixed_2': [1, 1, 1],
    'mod_復仇女神_fixed_3': [1, 1, 1], 'mod_復仇女神_fixed_4': [1, 1, 1],
  }

  for (const m of ex) {
    const want = EXPECT[m.id]
    assert.ok(want, `專屬模組多了一顆沒登記的：${m.id}「${m.name}」—— 請查官方資料後補進 EXPECT`)
    const [nBound, nLevels, perPart] = want
    assert.equal((m.boundPart ?? []).length, nBound, `${m.id} 的 boundPart 數`)
    assert.equal(m.levels.length, nLevels, `${m.id} 的 levels 階數`)
    for (const p of POS) {
      const got = exclusivePartLevel(m as unknown as Module, p)
      assert.equal(got, (m.boundPart ?? []).includes(p) ? perPart : 0, `${m.id} 在 ${p}`)
    }
  }
})

test('exclusivePartLevel：boundPart 比對走集合，兩種順序等價', () => {
  // 正式庫裡 ["leftArm","rightArm"] 與 ["rightArm","leftArm"] **同時存在** ——
  // 任何「陣列相等」的比法都會漏掉其中一種。
  const a = { boundPart: ['leftArm', 'rightArm'], levels: [{ level: 1 }, { level: 2 }] } as unknown as Module
  const b = { boundPart: ['rightArm', 'leftArm'], levels: [{ level: 1 }, { level: 2 }] } as unknown as Module
  for (const p of POS) assert.equal(exclusivePartLevel(a, p), exclusivePartLevel(b, p))
  assert.equal(exclusivePartLevel(a, MechPartPosition.LEFT_ARM), 1)
  assert.equal(exclusivePartLevel(a, MechPartPosition.TORSO), 0)

  const orders = MODS.filter((m) => m.slot === ModuleSlot.EXCLUSIVE && (m.boundPart ?? []).length === 2)
    .map((m) => (m.boundPart ?? []).join(','))
  assert.ok(orders.includes('leftArm,rightArm') && orders.includes('rightArm,leftArm'),
    '兩種順序不再同時存在了 —— 這條測試的前提沒了，但集合比對仍然是對的做法')
})

test('exclusivePartLevel：Phase B 補齊 levels[] 之後結果不變', () => {
  // B-1 會把三顆只存 1 級的補成 2 級、復仇女神四顆的空陣列補成 1 級。
  // 補完之後 levels.length 會變，所以先確認那不會改變推導結果 ——
  // 否則 B-1 一跑，整張矩陣會靜默地換一組數字。
  const twoBoundTwoLevels = { boundPart: ['torso', 'legs'], levels: [{ level: 1 }, { level: 2 }] } as unknown as Module
  const twoBoundOneLevel = { boundPart: ['torso', 'legs'], levels: [{ level: 1 }] } as unknown as Module
  assert.equal(exclusivePartLevel(twoBoundTwoLevels, MechPartPosition.TORSO), 1)
  assert.equal(exclusivePartLevel(twoBoundOneLevel, MechPartPosition.TORSO), 1)

  const oneBoundOneLevel = { boundPart: ['torso'], levels: [{ level: 1 }] } as unknown as Module
  const oneBoundNoLevel = { boundPart: ['torso'], levels: [] } as unknown as Module
  assert.equal(exclusivePartLevel(oneBoundOneLevel, MechPartPosition.TORSO), 1)
  assert.equal(exclusivePartLevel(oneBoundNoLevel, MechPartPosition.TORSO), 1)
})

// ─── 代表機甲的完整矩陣 ─────────────────────────────────────────────────────

test('矩陣：帕斯卡（四顆專屬各據一格，沒有特性模組）', () => {
  // 官方合計：蓄能模組(3006)=8  出力模組(4026)=4  張量核心(20341)=1
  //           深採模型(20342)=1  彙編矩陣(20343)=1  追光框架(20344)=1
  assert.deepEqual(matrixOf(mechOf('帕斯卡')), {
    torso: { mod_3006: 2, 'mod_帕斯卡_fixed_4': 1, 'sub_mod_出力模組': 1 },
    leftArm: { mod_3006: 2, 'mod_帕斯卡_fixed_3': 1, 'sub_mod_出力模組': 1 },
    rightArm: { mod_3006: 2, 'mod_帕斯卡_fixed_2': 1, 'sub_mod_出力模組': 1 },
    legs: { mod_3006: 2, 'mod_帕斯卡_fixed_1': 1, 'sub_mod_出力模組': 1 },
  })
  assert.deepEqual(totalsOf(mechOf('帕斯卡')), {
    mod_3006: 8, 'sub_mod_出力模組': 4,
    'mod_帕斯卡_fixed_1': 1, 'mod_帕斯卡_fixed_2': 1, 'mod_帕斯卡_fixed_3': 1, 'mod_帕斯卡_fixed_4': 1,
  })
})

test('矩陣：輝龍（特性模組與專屬模組疊在同一部位）', () => {
  // 官方合計：勇氣核心(2057)=4  盈輝模組(3047)=8  火力模組(4027)=4
  //           龍威·啟明(30481)=2  無拘(30482)=2  守禦(30483)=2  揚鋒(30484)=2
  // ⇒ 每個部位的「特性位」是 2（特性 1 ＋ 專屬 1），滿階變 3 —— 這正是規則表
  //   「特性位 54/57」那三個例外的形狀，不是規律錯。
  assert.deepEqual(matrixOf(mechOf('輝龍')), {
    torso: { mod_2057: 1, mod_3047: 2, 'mod_輝龍_fixed_2': 2, 'sub_mod_火力模組': 1 },
    leftArm: { mod_2057: 1, mod_3047: 2, 'mod_輝龍_fixed_4': 2, 'sub_mod_火力模組': 1 },
    rightArm: { mod_2057: 1, mod_3047: 2, 'mod_輝龍_fixed_3': 2, 'sub_mod_火力模組': 1 },
    legs: { mod_2057: 1, mod_3047: 2, 'mod_輝龍_fixed_1': 2, 'sub_mod_火力模組': 1 },
  })
})

test('矩陣：燧石（A 級 —— 8 級模組只有軀幹與腿部）', () => {
  // 官方合計：猛擊裝置(1001)=4  運動模組(3005)=**2**  回避模組(4004)=4
  // ⚠ 特性模組不是只有 20xx：A 級這顆是 mod_1001。判準一律看 slot，不看 id 前綴。
  assert.deepEqual(matrixOf(mechOf('燧石')), {
    torso: { mod_1001: 1, mod_3005: 1, 'sub_mod_回避模組': 1 },
    leftArm: { mod_1001: 1, 'sub_mod_回避模組': 1 },
    rightArm: { mod_1001: 1, 'sub_mod_回避模組': 1 },
    legs: { mod_1001: 1, mod_3005: 1, 'sub_mod_回避模組': 1 },
  })
  assert.equal(totalsOf(mechOf('燧石')).mod_3005, 2)
})

test('矩陣：信仰之眼（兩顆專屬各佔兩格）', () => {
  // 官方合計：超容模組(3037)=8  暴擊模組(4002)=4  流態發生器(20481)=2  超限框架(20483)=2
  // 站長實測：超限框架「軀幹、腿部各一級，品質 LV1～LV4 從頭到尾不變」
  assert.deepEqual(matrixOf(mechOf('信仰之眼')), {
    torso: { mod_3037: 2, 'mod_信仰之眼_fixed_1': 1, 'sub_mod_暴擊模組': 1 },
    leftArm: { mod_3037: 2, 'mod_信仰之眼_fixed_2': 1, 'sub_mod_暴擊模組': 1 },
    rightArm: { mod_3037: 2, 'mod_信仰之眼_fixed_2': 1, 'sub_mod_暴擊模組': 1 },
    legs: { mod_3037: 2, 'mod_信仰之眼_fixed_1': 1, 'sub_mod_暴擊模組': 1 },
  })
})

test('矩陣：破曉者-02（兩顆同名〈匯流樞紐〉在不同部位）', () => {
  // 官方合計：獨行模組(3027)=8  火力模組(4027)=4  匯流樞紐(20391 軀幹)=1
  //           校準儲能核心(20392)=1  強壓儲能核心(20393)=1  匯流樞紐(20394 腿部)=1
  // ⚠ 兩顆同名而效果不同（20391「軀幹插槽…翻倍」／20394「腿部…」）——
  //   任何用名稱查表的做法都會撞在一起，這也是 slotLevelMultiplier 要落成欄位的理由。
  assert.deepEqual(matrixOf(mechOf('破曉者-02')), {
    torso: { mod_3027: 2, 'mod_破曉者-02_fixed_4': 1, 'sub_mod_火力模組': 1 },
    leftArm: { mod_3027: 2, 'mod_破曉者-02_fixed_3': 1, 'sub_mod_火力模組': 1 },
    rightArm: { mod_3027: 2, 'mod_破曉者-02_fixed_2': 1, 'sub_mod_火力模組': 1 },
    legs: { mod_3027: 2, 'mod_破曉者-02_fixed_1': 1, 'sub_mod_火力模組': 1 },
  })
})

test('矩陣：復仇女神（四顆彩甲隱藏模組，官方不回傳）', () => {
  // 官方合計只有三顆：鏡像矩陣(2045)=4  迸發模組(3034)=8  火力模組(4027)=4
  // 四顆〈模型-XX〉的部位來自站長截圖的「限制解除」說明逐字：
  //   軀幹啟動[模型-武]／左臂[模型-月升]／右臂[模型-憐愛]／腿部[模型-無恙]
  // ⇒ 官方 API 是**不完整的那一邊**，站上的 boundPart 才是對的。
  assert.deepEqual(matrixOf(mechOf('復仇女神')), {
    torso: { mod_2045: 1, mod_3034: 2, 'mod_復仇女神_fixed_1': 1, 'sub_mod_火力模組': 1 },
    leftArm: { mod_2045: 1, mod_3034: 2, 'mod_復仇女神_fixed_3': 1, 'sub_mod_火力模組': 1 },
    rightArm: { mod_2045: 1, mod_3034: 2, 'mod_復仇女神_fixed_2': 1, 'sub_mod_火力模組': 1 },
    legs: { mod_2045: 1, mod_3034: 2, 'mod_復仇女神_fixed_4': 1, 'sub_mod_火力模組': 1 },
  })
})

test('矩陣：影虎（專屬只在軀幹，且那一格自己出 2 級）', () => {
  // 官方合計：影襲鏈路(2058)=4  異態模組(3049)=8  校準模組(4001)=4  虎魄·無束(20581)=**2**
  assert.deepEqual(matrixOf(mechOf('影虎')), {
    torso: { mod_2058: 1, mod_3049: 2, 'mod_影虎_fixed_1': 2, 'sub_mod_校準模組': 1 },
    leftArm: { mod_2058: 1, mod_3049: 2, 'sub_mod_校準模組': 1 },
    rightArm: { mod_2058: 1, mod_3049: 2, 'sub_mod_校準模組': 1 },
    legs: { mod_2058: 1, mod_3049: 2, 'sub_mod_校準模組': 1 },
  })
})

test('矩陣：霸王（專屬模組的 id 是 4 位數 —— 不可用 id 位數判類別）', () => {
  // 官方合計：玄門磁極引擎·景(2062)=4  AI火控單元(2064)=**2**  覆蓋打擊模組(3053)=8  暴擊模組(4002)=4
  // ⚠ `mod_2064` 長得像特性模組（20xx）但 slot 是機甲專屬模組。
  assert.equal(BY_ID.get('mod_2064')?.slot, ModuleSlot.EXCLUSIVE)
  assert.deepEqual(matrixOf(mechOf('霸王')), {
    torso: { mod_2062: 1, mod_3053: 2, 'sub_mod_暴擊模組': 1 },
    leftArm: { mod_2062: 1, mod_3053: 2, mod_2064: 1, 'sub_mod_暴擊模組': 1 },
    rightArm: { mod_2062: 1, mod_3053: 2, mod_2064: 1, 'sub_mod_暴擊模組': 1 },
    legs: { mod_2062: 1, mod_3053: 2, 'sub_mod_暴擊模組': 1 },
  })
})

// ─── 資料缺口 ───────────────────────────────────────────────────────────────

test('missingBoundPart：星夜女神〈觀星者單元〉已補上軀幹（B-2）', () => {
  // 它與彌造者〈帕姆斯陣列〉是同一類（限制解除 ＋ 機師限定 ＋ 2 階綁一格），
  // 而星夜女神不在官方那 83 台裡 ⇒ **腳本對不到帳，只能人工填**，由站長補上 torso。
  // 補之前它會安靜地從每一格消失 —— 這條測試現在守的是「別再掉回去」。
  const r = resolveInnateModules(mechOf('星夜女神'), MechPartPosition.TORSO, lookup)
  assert.deepEqual(r.missingBoundPart, [])
  assert.ok(r.entries.some((e) => e.moduleId === 'mod_星夜女神_fixed_1' && e.level === 2),
    '〈觀星者單元〉應在軀幹出 2 級（同帕姆斯陣列）')
  // 其他三格不該有它
  for (const p of POS.filter((x) => x !== MechPartPosition.TORSO)) {
    const other = resolveInnateModules(mechOf('星夜女神'), p, lookup)
    assert.ok(!other.entries.some((e) => e.moduleId === 'mod_星夜女神_fixed_1'), `${p} 不該有觀星者單元`)
  }
})

test('全 90 台：沒有任何專屬模組缺 boundPart，等級一律為正整數', () => {
  const missing = new Set<string>()
  for (const m of MECHS) {
    for (const pos of POS) {
      const r = resolveInnateModules(m, pos, lookup)
      r.missingBoundPart.forEach((x) => missing.add(x))
      assert.equal(r.unknownQuality, false, `${m.id} 的品質認不得`)
      for (const e of r.entries) {
        assert.ok(Number.isInteger(e.level) && e.level > 0, `${m.id}/${pos} 的 ${e.moduleId} 等級是 ${e.level}`)
        assert.equal(e.source, 'rule')
      }
    }
  }
  assert.deepEqual([...missing], [],
    '有專屬模組沒填 boundPart —— 它會從每一格靜默消失。後台補上部位，或確認它真的不該出現')
})

// ─── 人工覆寫（決策三）─────────────────────────────────────────────────────

test('覆寫：整格取代，不與規則合併', () => {
  const base = mechOf('帕斯卡')
  const patched: InnateMechInput = {
    ...base,
    parts: { torso: { innateModules: [{ moduleId: 'mod_9999', level: 3 }] } },
  }
  const r = resolveInnateModules(patched, MechPartPosition.TORSO, lookup)
  assert.equal(r.source, 'override')
  assert.deepEqual(r.entries, [{ moduleId: 'mod_9999', level: 3, source: 'override' }])
  // 沒被覆寫的部位照舊走規則
  assert.equal(resolveInnateModules(patched, MechPartPosition.LEGS, lookup).source, 'rule')
})

test('覆寫：`[]` ＝ 這格沒有天生模組，與 undefined ＝ 照規則算 是兩件事', () => {
  const base = mechOf('帕斯卡')
  const emptied: InnateMechInput = { ...base, parts: { torso: { innateModules: [] } } }
  const r = resolveInnateModules(emptied, MechPartPosition.TORSO, lookup)
  assert.equal(r.source, 'override')
  assert.deepEqual(r.entries, [])
  // 對照組：undefined 要算得出東西來
  assert.ok(resolveInnateModules(base, MechPartPosition.TORSO, lookup).entries.length > 0)
})

test('覆寫：混搭時要傳「這個部位來自哪一台」', () => {
  // 換掉滿階帕斯卡的右臂 → 那一格改由來源機甲決定。
  // 〈彙編矩陣〉整顆消失、蓄能 8→6、出力 4→3 —— 這正是 052-G Phase D 之後一直錯的那一塊。
  const 帕斯卡 = mechOf('帕斯卡')
  const 輝龍 = mechOf('輝龍')
  const sourceOf = (p: MechPartPosition) => (p === MechPartPosition.RIGHT_ARM ? 輝龍 : 帕斯卡)
  const byPart = resolveInnateByPart(sourceOf, lookup)

  const total = (id: string) => POS.reduce(
    (s, p) => s + (byPart[p].entries.find((e) => e.moduleId === id)?.level ?? 0), 0)
  assert.equal(total('mod_帕斯卡_fixed_2'), 0, '〈彙編矩陣〉只掛右臂，換走就整顆消失')
  assert.equal(total('mod_3006'), 6, '蓄能模組 8 → 6')
  assert.equal(total('sub_mod_出力模組'), 3, '出力模組 4 → 3')
  assert.equal(total('mod_輝龍_fixed_3'), 2, '換上來的右臂帶著它原本那台的〈龍威·揚鋒〉')
})

// ─── 部位倍率與等級池（A-6）────────────────────────────────────────────────

test('slotMultipliers：〈匯流樞紐〉讓自己那一格的插槽貢獻翻倍', () => {
  // ⚠ 這裡刻意用 `lookup`（＝正式庫快照），不再自己捏 slotLevelMultiplier ——
  //   B-4 把值落盤之後，這條測試守的就是**那兩格資料**，而不只是函式邏輯。
  const byPart = resolveInnateByPart(() => mechOf('破曉者-02'), lookup)
  assert.deepEqual(slotMultipliers(byPart, lookup), { torso: 2, legs: 2 })
})

test('B-4：slotLevelMultiplier 只有兩顆同名的〈匯流樞紐〉有值，且各指自己那一格', () => {
  // 兩顆同名而效果不同（官方 20391 軀幹／20394 腿部）—— 任何用名稱查表的做法都會撞在一起。
  const withMul = MODS.filter((m) => m.slotLevelMultiplier?.length)
  assert.deepEqual(
    Object.fromEntries(withMul.map((m) => [m.id, m.slotLevelMultiplier])),
    { 'mod_破曉者-02_fixed_4': ['torso'], 'mod_破曉者-02_fixed_1': ['legs'] },
    '多／少了帶部位倍率的模組 —— 新的一顆要先實測「翻的是插槽貢獻、不含天生貢獻」再落盤',
  )
  assert.ok(withMul.every((m) => m.name === '匯流樞紐'))
})

test('B-3：unlockCondition 只有六顆有值，且指向存在的觸發者', () => {
  const cond = MODS.filter((m) => m.unlockCondition)
  assert.deepEqual(Object.fromEntries(cond.map((m) => [m.id, m.unlockCondition])), {
    // 復仇女神四顆〈模型-XX〉：觸發者是**別顆模組**〈迸發模組〉的 LV8 文本
    'mod_復仇女神_fixed_1': { kind: 'moduleAtMaxLevel', moduleId: 'mod_3034' },
    'mod_復仇女神_fixed_2': { kind: 'moduleAtMaxLevel', moduleId: 'mod_3034' },
    'mod_復仇女神_fixed_3': { kind: 'moduleAtMaxLevel', moduleId: 'mod_3034' },
    'mod_復仇女神_fixed_4': { kind: 'moduleAtMaxLevel', moduleId: 'mod_3034' },
    // 機師限定兩顆：描述末尾「※只有[X]能發動此模組※」
    'mod_彌造者_fixed_1': { kind: 'pilotOnly', pilotIds: ['pilot_049_海莉絲'] },
    'mod_星夜女神_fixed_1': { kind: 'pilotOnly', pilotIds: ['pilot_088_曜'] },
  })
  // ⚠ **不該進來的**：影虎〈虎魄·無束〉L2 與輝龍龍威 L2 的「當[某人]駕駛整套[某機]時…」——
  //   那是效果內的條件，模組本身照樣存在、照樣算等級。混進來的話那六顆會整顆消失。
  for (const id of ['mod_影虎_fixed_1', 'mod_輝龍_fixed_1', 'mod_輝龍_fixed_2', 'mod_輝龍_fixed_3', 'mod_輝龍_fixed_4']) {
    assert.equal(BY_ID.get(id)?.unlockCondition, null, `${id} 的是效果內條件，不該進 unlockCondition`)
  }
  // 斷鏈的觸發者會讓那顆模組**永遠**解不開，而畫面上沒有症狀 —— 這裡只驗模組那側（機師不在 fixture 裡）。
  const trigger = BY_ID.get('mod_3034')
  assert.ok(trigger && (trigger.levels?.length ?? 0) > 0, '〈迸發模組〉不存在或沒有階梯 ⇒ required=0 ⇒ 四顆永遠停用')
})

test('moduleStacks：破曉者-02 的實測配置（無瑕者 ×2、刀劍Ⅱ ×2）四條線全對', () => {
  // 站長遊戲畫面：無瑕者單元 LV.MAX／獨行模組 LV.MAX／火力模組 LV.MAX／刀劍模組 LV.MAX
  const byPart = resolveInnateByPart(() => mechOf('破曉者-02'), lookup)
  const innate = Object.fromEntries(POS.map((p) => [p, byPart[p].entries])) as unknown as Record<MechPartPosition, { moduleId: string; level: number }[]>

  const stacks = moduleStacks(
    { torso: 'mod_2042', legs: 'mod_2042', leftArm: 'mod_4030_2', rightArm: 'mod_4030_2' },
    lookup,
    { innate, positionMultiplier: slotMultipliers(byPart, lookup) },
  )
  const at = (id: string) => stacks.get(moduleFamilyKey(lookup(id)!))!

  // 無瑕者單元：特性模組、addLevel 1、4 階。本機沒有天生特性模組 ⇒ 純靠插槽，
  // 而軀幹與腿部各有一顆匯流樞紐 ⇒ 1×2 ＋ 1×2 ＝ 4 ＝ 滿級。
  assert.equal(at('mod_2042').innateSum, 0)
  assert.equal(at('mod_2042').sum, 4)
  assert.equal(at('mod_2042').level, 4)
  // 刀劍模組Ⅱ：addLevel 2、雙臂各一顆，**手臂沒有匯流樞紐** ⇒ 2 ＋ 2 ＝ 4 ＝ 滿級
  assert.equal(at('mod_4030_2').sum, 4)
  assert.equal(at('mod_4030_2').level, 4)
  // 天生那兩條：8 級模組 ＝ 四部位各 2、副模組 ＝ 四部位各 1
  assert.equal(at('mod_3027').innateSum, 8)
  assert.equal(at('mod_3027').level, 8)
  assert.equal(at('sub_mod_火力模組').innateSum, 4)
  assert.equal(at('sub_mod_火力模組').level, 4)
  // 四顆專屬各 1 級
  for (const id of ['mod_破曉者-02_fixed_1', 'mod_破曉者-02_fixed_2', 'mod_破曉者-02_fixed_3', 'mod_破曉者-02_fixed_4']) {
    assert.equal(at(id).level, 1, id)
  }
})

test('moduleStacks：天生與插槽共用同一個等級池，超限算在插槽那一側', () => {
  // 帕斯卡的天生蓄能模組已經 8 級（滿）；再插一顆同族的上去，多的就是白費。
  const 帕斯卡 = mechOf('帕斯卡')
  const byPart = resolveInnateByPart(() => 帕斯卡, lookup)
  const innate = Object.fromEntries(POS.map((p) => [p, byPart[p].entries])) as unknown as Record<MechPartPosition, { moduleId: string; level: number }[]>
  const stacks = moduleStacks({ torso: 'mod_3006' }, lookup, { innate })
  const st = stacks.get(moduleFamilyKey(BY_ID.get('mod_3006')!))!
  assert.equal(st.innateSum, 8)
  assert.equal(st.sum, 1)
  assert.equal(st.cap, 8)
  assert.equal(st.level, 8)
  assert.equal(st.overflow, 1, '插上去那一顆整顆白費')
  assert.deepEqual(st.positions, [MechPartPosition.TORSO])
  assert.deepEqual(st.innatePositions, POS)
})

test('moduleStacks：不傳 opts 時行為與 052-G 完全相同', () => {
  const stacks = moduleStacks({ torso: 'mod_4030_2', leftArm: 'mod_4030_2' }, lookup)
  const st = stacks.get(moduleFamilyKey(BY_ID.get('mod_4030_2')!))!
  assert.equal(st.sum, 4)
  assert.equal(st.innateSum, 0)
  assert.deepEqual(st.innatePositions, [])
  assert.equal(st.level, 4)
  assert.equal(st.overflow, 0)
})

// ─── 啟用條件（A-5）────────────────────────────────────────────────────────

test('unlockBlocker：沒有條件的模組恆為解鎖（241 筆裡 235 筆）', () => {
  const ctx = { levelOf: () => 0, maxLevelOf: () => 0 }
  const free = MODS.filter((m) => !m.unlockCondition)
  assert.equal(free.length, 235)
  for (const m of free) assert.equal(unlockBlocker(m as unknown as Module, ctx), null, m.id)
})

test('unlockBlocker：moduleAtMaxLevel —— 觸發者是**別顆**模組', () => {
  // 復仇女神四顆〈模型-XX〉自己的描述裡沒有「限制解除」四個字，
  // 那句話在〈迸發模組〉mod_3034 的 LV8 文本裡。
  const mod = { unlockCondition: { kind: 'moduleAtMaxLevel', moduleId: 'mod_3034' } } as unknown as Module
  const maxLevelOf = () => 8
  assert.equal(isModuleUnlocked(mod, { levelOf: () => 8, maxLevelOf }), true)
  assert.deepEqual(unlockBlocker(mod, { levelOf: () => 6, maxLevelOf }),
    { kind: 'moduleAtMaxLevel', moduleId: 'mod_3034', current: 6, required: 8 })
  // 混搭掉一個部位 ⇒ 迸發只剩 6 級 ⇒ 四顆一起失效。這正是 D-3 要顯示原因的那個情境。
})

test('unlockBlocker：查不到觸發者的階數時判為未解鎖，不靜默放行', () => {
  const mod = { unlockCondition: { kind: 'moduleAtMaxLevel', moduleId: 'mod_不存在' } } as unknown as Module
  // required 0 若當成「達標」，資料斷鏈會把條件模組變成無條件生效，而多算的加成沒有任何症狀。
  assert.deepEqual(unlockBlocker(mod, { levelOf: () => 0, maxLevelOf: () => 0 }),
    { kind: 'moduleAtMaxLevel', moduleId: 'mod_不存在', current: 0, required: 0 })
})

test('unlockBlocker：pilotOnly —— 帕姆斯陣列限海莉絲、觀星者單元限曜', () => {
  const mod = { unlockCondition: { kind: 'pilotOnly', pilotIds: ['pilot_海莉絲'] } } as unknown as Module
  const base = { levelOf: () => 0, maxLevelOf: () => 0 }
  assert.equal(isModuleUnlocked(mod, { ...base, pilotId: 'pilot_海莉絲' }), true)
  assert.deepEqual(unlockBlocker(mod, { ...base, pilotId: 'pilot_曜' }),
    { kind: 'pilotOnly', pilotIds: ['pilot_海莉絲'] })
  assert.deepEqual(unlockBlocker(mod, { ...base, pilotId: null }),
    { kind: 'pilotOnly', pilotIds: ['pilot_海莉絲'] }, '沒選機師時不能算解鎖')
})
