// PLAN-052-K Phase D：天生模組接進模擬器的驗收測試
//   npm test   →   node --test "src/**/*.test.ts"
//
// ── 這份守的是什麼（與 innateModules.test.ts 的分工）──────────────────────────
//   innateModules.test.ts ：規則本身對不對（一個部位貢獻哪幾顆、各幾級）。
//   本檔                  ：那套規則**有沒有真的接到模擬器上**——
//                           `resolveChassis()` 逐部位取來源機甲（D-2）、
//                           `buildContext()` 把天生與插槽收成同一個等級池（D-1）、
//                           未解鎖的模組留在清單裡但不算加成（D-3）。
//
// ⚠ 這是 052-G Phase D 之後**一直錯著、而且不報錯**的那一塊：混搭換掉一個部位，
//   重量與火力會跟著動，「自帶」那一列卻一顆都不變。下面「帕斯卡換右臂」那三個數字
//   （彙編矩陣消失／蓄能 8→6／出力 4→3）就是計畫書寫死的驗收基準。
//
// 模組資料用**正式庫的 fixture**（`gen-module-fixture.mjs` 產出），機甲則是合成的
// —— 天生模組只吃 `quality` ＋ 三個頂層欄位，那四個欄位照抄正式庫即可，
// 而部位的重量／接口與本檔要驗的事無關，用最小值就好。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Mech, Module, Pilot } from '../types/index.ts'
import { ArmorType, MechPartPosition } from '../types/enums.ts'
import { resolveChassis } from './chassisStats.ts'
import { moduleFamilyKey } from './moduleRules.ts'
import { activeStacks, buildContext, buildWorld } from './loadoutRules.ts'
import { DEFAULT_EQUIP_SET_KEY } from './forms.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const MODS = JSON.parse(
  fs.readFileSync(path.join(here, '__fixtures__', 'modules.json'), 'utf8'),
) as Module[]
const MODULE_MAP = new Map<string, Module>(MODS.map((m) => [m.id, m]))
const nameOf = (id: string) => MODULE_MAP.get(id)?.name ?? id

// ─── 合成機甲 ───────────────────────────────────────────────────────────────

const part = (over: Record<string, unknown> = {}) => ({
  position: 'torso', durable: 0, armor: 0, firepower: 0, weight: 100,
  interface: 'Ⅱ型接口', ...over,
}) as never

const mech = (over: Partial<Mech> & Pick<Mech, 'id' | 'name'>): Mech => ({
  armorType: ArmorType.MEDIUM, quality: 'S',
  firepower: 0, armor: 0, evasion: 0, mobility: 0, weight: 400, output: 3000,
  parts: {
    torso: part({ output: 3000 }), leftArm: part(), rightArm: part(), legs: part(),
  },
  moduleFixedIds: [],
  ...over,
} as Mech)

/** 帕斯卡（正式庫）：無特性模組、8 級＝蓄能、副＝出力、四顆專屬各據一格 */
const 帕斯卡 = mech({
  id: 'mech_022_帕斯卡', name: '帕斯卡',
  module8Id: 'mod_3006',
  moduleFixedIds: [
    'mod_帕斯卡_fixed_1', 'mod_帕斯卡_fixed_2', 'mod_帕斯卡_fixed_3', 'mod_帕斯卡_fixed_4',
    'sub_mod_出力模組',
  ],
})

/** 輝龍（正式庫）：特性＝勇氣核心、8 級＝盈輝、副＝火力、四顆龍威各綁一格且**各 2 級** */
const 輝龍 = mech({
  id: 'mech_048_輝龍', name: '輝龍',
  module4Id: 'mod_2057', module8Id: 'mod_3047',
  moduleFixedIds: [
    'mod_輝龍_fixed_1', 'mod_輝龍_fixed_2', 'mod_輝龍_fixed_3', 'mod_輝龍_fixed_4',
    'sub_mod_火力模組',
  ],
})

/** 復仇女神（正式庫）：四顆〈模型-XX〉要〈迸發模組〉滿級才啟動 */
const 復仇女神 = mech({
  id: 'mech_034_復仇女神', name: '復仇女神',
  module4Id: 'mod_2045', module8Id: 'mod_3034',
  moduleFixedIds: [
    'mod_復仇女神_fixed_1', 'mod_復仇女神_fixed_2', 'mod_復仇女神_fixed_3', 'mod_復仇女神_fixed_4',
    'sub_mod_火力模組',
  ],
})

/** 彌造者（正式庫）：〈帕姆斯陣列〉只有海莉絲發動得了 */
const 彌造者 = mech({
  id: 'mech_052_彌造者', name: '彌造者',
  module4Id: 'mod_2065', module8Id: 'mod_3054',
  moduleFixedIds: ['mod_彌造者_fixed_1', 'sub_mod_火力模組'],
})

const 海莉絲 = { id: 'pilot_049_海莉絲', name: '海莉絲' } as unknown as Pilot
const 別人 = { id: 'pilot_001_誰', name: '誰' } as unknown as Pilot

const world = buildWorld({
  pilots: [海莉絲, 別人],
  mechs: [帕斯卡, 輝龍, 復仇女神, 彌造者],
  weapons: [], backpacks: [], modules: MODS,
})

/** 一套只有機甲與（可選）混搭部位、模組接口的 context。 */
const ctxOf = (opts: {
  mechId: string
  pilotId?: string
  parts?: Partial<Record<MechPartPosition, string>>
  modules?: Partial<Record<MechPartPosition, string>>
}) => buildContext(
  {
    pilotId: opts.pilotId, mechId: opts.mechId,
    sets: { [DEFAULT_EQUIP_SET_KEY]: { mounts: [] } },
    modules: opts.modules, parts: opts.parts,
  },
  DEFAULT_EQUIP_SET_KEY,
  world,
)

/** 「這一族現在幾級」。查無回 0 —— 與畫面上「這顆不在清單裡」是同一件事。 */
const levelOf = (ctx: ReturnType<typeof ctxOf>, moduleId: string) =>
  ctx.stacks.get(moduleFamilyKey(MODULE_MAP.get(moduleId)!))?.level ?? 0

/** 天生那一段各部位的貢獻，攤平成 `{ 模組名: 級數 }`（部位無關的總覽）。 */
const innateSumOf = (ctx: ReturnType<typeof ctxOf>) => {
  const out: Record<string, number> = {}
  for (const pos of Object.values(MechPartPosition)) {
    for (const e of ctx.chassis!.innateByPart[pos].entries) {
      out[nameOf(e.moduleId)] = (out[nameOf(e.moduleId)] ?? 0) + e.level
    }
  }
  return out
}

// ─── D-2：天生模組跟著部件走 ────────────────────────────────────────────────

test('D-2 原廠帕斯卡：四個部位都解得出天生模組，等級與規則一致', () => {
  const ctx = ctxOf({ mechId: 帕斯卡.id })
  assert.deepEqual(innateSumOf(ctx), {
    蓄能模組: 8,   // 8 級模組：每部位 2 × 四部位
    出力模組: 4,   // 副模組：每部位 1
    追光框架: 1, 彙編矩陣: 1, 深採模型: 1, 張量核心: 1,  // 四顆專屬各據一格、各 1 級
  })
  // 每一格都是規則算的（全庫今天 0 台有人工覆寫）
  for (const pos of Object.values(MechPartPosition)) {
    assert.equal(ctx.chassis!.innateByPart[pos].source, 'rule', pos)
    assert.deepEqual(ctx.chassis!.innateByPart[pos].missingBoundPart, [], pos)
    assert.deepEqual(ctx.chassis!.innateByPart[pos].unknownModuleIds, [], pos)
  }
})

test('D-2 帕斯卡換右臂 → 計畫書的三條驗收基準逐項成立', () => {
  const before = ctxOf({ mechId: 帕斯卡.id })
  const after = ctxOf({ mechId: 帕斯卡.id, parts: { rightArm: 輝龍.id } })

  // ① 綁在右臂的專屬模組**整顆消失**
  assert.equal(levelOf(before, 'mod_帕斯卡_fixed_2'), 1, '換之前〈彙編矩陣〉在')
  assert.equal(levelOf(after, 'mod_帕斯卡_fixed_2'), 0, '〈彙編矩陣〉應整顆消失')
  // ② 通用的降一格份：8 級模組 8 → 6（少了右臂那 2 級）
  assert.equal(levelOf(before, 'mod_3006'), 8)
  assert.equal(levelOf(after, 'mod_3006'), 6, '〈蓄能模組〉應 8→6')
  // ③ 副模組 4 → 3
  assert.equal(levelOf(before, 'sub_mod_出力模組'), 4)
  assert.equal(levelOf(after, 'sub_mod_出力模組'), 3, '〈出力模組〉應 4→3')
  // 其餘三格的專屬模組不受影響
  for (const id of ['mod_帕斯卡_fixed_1', 'mod_帕斯卡_fixed_3', 'mod_帕斯卡_fixed_4']) {
    assert.equal(levelOf(after, id), 1, id)
  }
})

test('D-2 換進來的部件**帶來它原本那台的**天生模組（這一半漏了就是只修一半）', () => {
  const after = ctxOf({ mechId: 帕斯卡.id, parts: { rightArm: 輝龍.id } })
  // 輝龍右臂帶進來的四條線
  assert.equal(levelOf(after, 'mod_3047'), 2, '輝龍〈盈輝模組〉：8 級模組每部位 2')
  assert.equal(levelOf(after, 'mod_2057'), 1, '輝龍〈勇氣核心〉：特性模組每部位 1')
  assert.equal(levelOf(after, 'sub_mod_火力模組'), 1, '輝龍〈火力模組〉：副模組每部位 1')
  assert.equal(levelOf(after, 'mod_輝龍_fixed_3'), 2, '〈龍威·揚鋒〉綁右臂、2 階綁一格 ⇒ 自己出 2 級')
  // 輝龍綁在**別的部位**的三顆龍威不該跟過來
  for (const id of ['mod_輝龍_fixed_1', 'mod_輝龍_fixed_2', 'mod_輝龍_fixed_4']) {
    assert.equal(levelOf(after, id), 0, `${nameOf(id)} 綁的不是右臂，不該出現`)
  }
  // 來源標記：只有換過的那一格會指向別台（`MechPartStrip` 的「◆來源機甲」靠它）
  assert.equal(after.chassis!.parts.rightArm.sourceMechId, 輝龍.id)
  assert.equal(after.chassis!.parts.torso.sourceMechId, 帕斯卡.id)
})

test('D-2 人工覆寫住在**部件**上：混搭時跟著那一格走，並保留 override 標記', () => {
  const 被覆寫的輝龍: Mech = {
    ...輝龍, id: 'mech_輝龍_覆寫', name: '輝龍（覆寫版）',
    parts: {
      ...輝龍.parts!,
      rightArm: { ...(輝龍.parts!.rightArm as object), innateModules: [{ moduleId: 'mod_3006', level: 5 }] } as never,
    },
  }
  const w = buildWorld({ pilots: [], mechs: [帕斯卡, 被覆寫的輝龍], weapons: [], backpacks: [], modules: MODS })
  const ctx = buildContext(
    { mechId: 帕斯卡.id, sets: { [DEFAULT_EQUIP_SET_KEY]: { mounts: [] } }, parts: { rightArm: 被覆寫的輝龍.id } },
    DEFAULT_EQUIP_SET_KEY, w,
  )
  const 右臂 = ctx.chassis!.innateByPart.rightArm
  assert.equal(右臂.source, 'override', '覆寫整格取代')
  assert.deepEqual(右臂.entries.map((e) => e.moduleId), ['mod_3006'])
  assert.equal(右臂.entries[0].source, 'override', 'UI 靠這個標橘色 ◆')
  // 覆寫的 5 級與其他三格的 2×3 ＝ 6 合流後封頂於 8
  assert.equal(ctx.stacks.get(moduleFamilyKey(MODULE_MAP.get('mod_3006')!))!.level, 8)
})

test('D-2 部位倍率一併從機體解出來（破曉者-02〈匯流樞紐〉之外今天全空）', () => {
  const c = resolveChassis(帕斯卡, { moduleMap: MODULE_MAP })!
  assert.deepEqual(c.positionMultiplier, {}, '帕斯卡沒有匯流樞紐')
})

// ─── D-1：天生與插槽共用同一個等級池 ────────────────────────────────────────

test('D-1 ctx.stacks 是全頁唯一的等級池：插槽貢獻疊在天生之上', () => {
  // 帕斯卡的天生出力模組已 4 級（＝滿），再插一顆同族的上去只會超限
  const ctx = ctxOf({ mechId: 帕斯卡.id, modules: { torso: 'sub_mod_出力模組' } })
  const st = ctx.stacks.get(moduleFamilyKey(MODULE_MAP.get('sub_mod_出力模組')!))!
  assert.equal(st.innateSum, 4)
  assert.equal(st.sum, 1, '插槽那一顆')
  assert.equal(st.level, 4, '已封頂')
  assert.equal(st.overflow, 1, '超限要算在插槽那一側，才不會變成在怪玩家')
})

test('D-1 換掉部位之後，原本超限的插槽模組會**開始生效**', () => {
  // 換掉右臂 ⇒ 天生蓄能只剩 6 ⇒ 插槽那一顆補得上第 7 級
  const ctx = ctxOf({
    mechId: 帕斯卡.id, parts: { rightArm: 輝龍.id }, modules: { torso: 'mod_3006' },
  })
  const st = ctx.stacks.get(moduleFamilyKey(MODULE_MAP.get('mod_3006')!))!
  assert.equal(st.innateSum, 6)
  assert.equal(st.level, 7)
  assert.equal(st.overflow, 0)
})

// ─── D-3：觸發式模組失效 ────────────────────────────────────────────────────

test('D-3 復仇女神原廠：迸發模組滿 8 級 ⇒ 四顆〈模型-XX〉全部啟動', () => {
  const ctx = ctxOf({ mechId: 復仇女神.id })
  assert.equal(levelOf(ctx, 'mod_3034'), 8, '〈迸發模組〉四部位各 2 ⇒ 滿級')
  assert.equal(ctx.moduleBlocks.size, 0)
  for (const id of ['mod_復仇女神_fixed_1', 'mod_復仇女神_fixed_2', 'mod_復仇女神_fixed_3', 'mod_復仇女神_fixed_4']) {
    assert.equal(levelOf(ctx, id), 1, nameOf(id))
  }
})

test('D-3 復仇女神換一個部位 ⇒ 迸發剩 6 級 ⇒ 其餘三顆轉為停用（不是消失）', () => {
  const ctx = ctxOf({ mechId: 復仇女神.id, parts: { legs: 輝龍.id } })
  assert.equal(levelOf(ctx, 'mod_3034'), 6)

  // 腿部那一顆隨部件走掉了（本來就不該在）；另外三顆**還在清單裡**，但被擋下
  assert.equal(levelOf(ctx, 'mod_復仇女神_fixed_4'), 0, '〈模型-無恙〉綁腿部，隨部件離開')
  for (const id of ['mod_復仇女神_fixed_1', 'mod_復仇女神_fixed_2', 'mod_復仇女神_fixed_3']) {
    const key = moduleFamilyKey(MODULE_MAP.get(id)!)
    assert.ok(ctx.stacks.has(key), `${nameOf(id)} 必須留在清單裡（直接消失＝玩家眼中的 bug）`)
    const block = ctx.moduleBlocks.get(key)
    assert.equal(block?.kind, 'moduleAtMaxLevel', nameOf(id))
    assert.deepEqual(
      block && block.kind === 'moduleAtMaxLevel' ? [block.moduleId, block.current, block.required] : null,
      ['mod_3034', 6, 8],
      'UI 要靠這三個數字講出「需要〈迸發模組〉達 LV.8（目前 LV.6）」',
    )
  }
  // 而且它們**不能算進加成**（否則清單灰了、數字沒動）
  const active = new Set(activeStacks(ctx).map((st) => st.mod.id))
  for (const id of ['mod_復仇女神_fixed_1', 'mod_復仇女神_fixed_2', 'mod_復仇女神_fixed_3']) {
    assert.ok(!active.has(id), `${nameOf(id)} 不該出現在 activeStacks`)
  }
  assert.ok(active.has('mod_3034'), '迸發模組本身照常生效')
})

test('D-3 機師限定：〈帕姆斯陣列〉只有海莉絲發動得了', () => {
  const key = moduleFamilyKey(MODULE_MAP.get('mod_彌造者_fixed_1')!)

  const 無機師 = ctxOf({ mechId: 彌造者.id })
  assert.equal(無機師.moduleBlocks.get(key)?.kind, 'pilotOnly', '沒選機師時視為未啟動')

  const 別人駕駛 = ctxOf({ mechId: 彌造者.id, pilotId: 別人.id })
  assert.equal(別人駕駛.moduleBlocks.get(key)?.kind, 'pilotOnly')

  const 海莉絲駕駛 = ctxOf({ mechId: 彌造者.id, pilotId: 海莉絲.id })
  assert.equal(海莉絲駕駛.moduleBlocks.get(key), undefined, '換上海莉絲就該啟動')
  assert.equal(levelOf(海莉絲駕駛, 'mod_彌造者_fixed_1'), 2, '2 階綁一格 ⇒ 軀幹自己出 2 級')
})

test('D-3 效果內條件不算未解鎖：輝龍四顆龍威在任何機師下都生效', () => {
  // 「當[某人]駕駛整套[某機]時…」是**效果內**的條件，模組本身照樣存在、照樣算等級。
  // 混進 unlockCondition 的話這六顆會在非專屬機師下整顆消失（B-3 已釘住，這裡從結果面再守一次）。
  const ctx = ctxOf({ mechId: 輝龍.id, pilotId: 別人.id })
  assert.equal(ctx.moduleBlocks.size, 0)
  for (const id of ['mod_輝龍_fixed_1', 'mod_輝龍_fixed_2', 'mod_輝龍_fixed_3', 'mod_輝龍_fixed_4']) {
    assert.equal(levelOf(ctx, id), 2, nameOf(id))
  }
})
