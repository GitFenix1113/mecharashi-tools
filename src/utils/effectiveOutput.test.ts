// PLAN-052-A A-2：有效出力的 golden fixture
//   npm test   →   node --test "src/**/*.test.ts"
//
// 官方整備截圖（海莉絲 × 彌造者）：先鋒／突擊形態 3675、戰術／虛粒子形態 3375。
// 差值 300 來自**強襲者背包**（不是形態本身——形態身上沒有任何數值）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  effectiveOutput, backpackOutputBonus, hasUnknownBackpackBonus, moduleOutputBonus,
  BACKPACK_OUTPUT_BONUS,
} from './effectiveOutput.ts'

/** 彌造者 parts.torso.output ＝ 3375（只有軀幹有出力） */
const 彌造者 = { output: 3375 }

const 強襲者背包 = { id: '60101706', type: 'BackupEquipment' }
const 出力背包Ⅲ  = { id: '60100104', type: 'PowerAdd' }
const 出力強化背包_首攻 = { id: '60102405', type: 'PowerAdd' }   // 15 筆複合出力背包之一，數值未建檔
const 炬塔       = { id: 'weapon_049_炬塔', type: '戰術' }        // 背部武器，無出力加成

test('golden fixture 先鋒／突擊形態 ＝ 3675（3375 ＋ 強襲者背包 300）', () => {
  const r = effectiveOutput(彌造者, { back: 強襲者背包 })
  assert.equal(r.total, 3675)
  assert.equal(r.base, 3375)
  assert.equal(r.backpack, 300)
  assert.equal(r.hasUnknownBackpackBonus, false)
})

test('golden fixture 戰術／虛粒子形態 ＝ 3375（背部是武器或空，無加成）', () => {
  assert.equal(effectiveOutput(彌造者, { back: 炬塔 }).total, 3375)
  assert.equal(effectiveOutput(彌造者, { back: null }).total, 3375)
  assert.equal(effectiveOutput(彌造者, {}).total, 3375)
})

test('出力背包三階 ＝ +200/250/300', () => {
  assert.equal(backpackOutputBonus({ id: '60100102' }), 200)
  assert.equal(backpackOutputBonus({ id: '60100103' }), 250)
  assert.equal(backpackOutputBonus({ id: '60100104' }), 300)
  assert.equal(effectiveOutput(彌造者, { back: 出力背包Ⅲ }).total, 3675)
})

test('數值未建檔的複合出力背包：加成回 0，但要標成「未知」而不是「沒有」', () => {
  const r = effectiveOutput(彌造者, { back: 出力強化背包_首攻 })
  assert.equal(r.backpack, 0)
  assert.equal(r.total, 3375)
  // 這個旗標就是為了讓 UI 講得出差別 —— 少了它，未知會被渲染成一個肯定的 0
  assert.equal(r.hasUnknownBackpackBonus, true)
  // 對照組：背部武器與空背部都不是「未知」，是真的沒有
  assert.equal(hasUnknownBackpackBonus(炬塔), false)
  assert.equal(hasUnknownBackpackBonus(null), false)
  assert.equal(hasUnknownBackpackBonus(強襲者背包), false)
})

test('模組出力加成走 levels[] 的滿級（N3：全站一律滿級）', () => {
  const 出力模組Ⅱ = {
    output_bonus: 100,
    levels: [
      { level: 1, output_bonus: 25 }, { level: 2, output_bonus: 50 },
      { level: 3, output_bonus: 75 }, { level: 4, output_bonus: 100 },
    ],
  } as never
  assert.equal(moduleOutputBonus(出力模組Ⅱ), 100)
  // levels 亂序也要取到最高階（不是取陣列最後一個）
  const 亂序 = { output_bonus: 0, levels: [{ level: 4, output_bonus: 100 }, { level: 1, output_bonus: 25 }] } as never
  assert.equal(moduleOutputBonus(亂序), 100)
  // 沒有 levels（副模組以外的舊資料）退回頂層值
  assert.equal(moduleOutputBonus({ output_bonus: 100, levels: [] } as never), 100)
  assert.equal(moduleOutputBonus(null), 0)
  // 242 筆模組中只有 2 筆非 0，其餘一律不影響出力
  assert.equal(moduleOutputBonus({ output_bonus: 0, levels: [{ level: 4, output_bonus: 0 }] } as never), 0)
})

test('三個來源疊加：軀幹 ＋ 背包 ＋ Σ 模組', () => {
  const 四階 = [25, 50, 75, 100].map((output_bonus, i) => ({ level: i + 1, output_bonus }))
  const 出力模組 = { output_bonus: 100, levels: 四階 } as never
  // ⚠ 一族一筆。同族兩顆是「疊成更高的等級」而不是兩份加成（052-G C-7），
  //   收斂成 level 是 `moduleStacks()` 的事，本檔只負責照著給的等級取值。
  const r = effectiveOutput(彌造者, { back: 強襲者背包 }, [{ mod: 出力模組, level: 4 }, null])
  assert.equal(r.modules, 100)
  assert.equal(r.total, 3375 + 300 + 100)
})

test('不同族的兩顆才是兩份加成，而且各取各自的生效等級', () => {
  const 四階 = [25, 50, 75, 100].map((output_bonus, i) => ({ level: i + 1, output_bonus }))
  const a = { output_bonus: 100, levels: 四階 } as never
  const b = { output_bonus: 100, levels: 四階 } as never
  const r = effectiveOutput(彌造者, { back: null }, [{ mod: a, level: 2 }, { mod: b, level: 3 }])
  assert.equal(r.modules, 50 + 75)
})

test('省略 level ⇒ 取滿級（未接堆疊的呼叫端沿用舊語意）', () => {
  const 四階 = [25, 50, 75, 100].map((output_bonus, i) => ({ level: i + 1, output_bonus }))
  const m = { output_bonus: 100, levels: 四階 } as never
  assert.equal(effectiveOutput(彌造者, { back: null }, [{ mod: m }]).modules, 100)
  // 指定一個不存在的階 ⇒ 0，不可悄悄退回滿級（那會讓算錯的等級看起來是對的）
  assert.equal(effectiveOutput(彌造者, { back: null }, [{ mod: m, level: 9 }]).modules, 0)
})

test('加成表只收已由官方畫面確認的四筆，避免用 weight 去猜', () => {
  assert.deepEqual(Object.keys(BACKPACK_OUTPUT_BONUS).sort(), ['60100102', '60100103', '60100104', '60101706'])
})
