// 官方原檔命名規則的雙胞胎守門（PLAN-054）
//
// 同一套規則有兩份：scripts/lib/gameAssetKinds.mjs（build 腳本用，要能在 Node 20 跑）
// 與 src/utils/gameArt.ts（前台用）。這裡逐一比對兩份拼出來的檔名——改了一邊沒改另一邊就會掛。
// 也順便驗證「反向分類」：每個拼出來的檔名分類回去都得到原本的種類。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MECH_KINDS, PILOT_KINDS, classifyMechFile, classifyPilotFile, mechFileName, pilotFileName } from './gameAssetKinds.mjs'
import { mechGameFileName, pilotGameFileName } from '../../src/utils/gameArt.ts'

const PILOTS = [
  ['10103123', 'Pilot_10103123A'],
  ['10103144', 'Pilot_13019A'],   // 維娜：gameId 與 artKey 不同
  ['13037', 'Pilot_13037A'],      // 阿列娜：短碼
]
const WAPS = ['1011', '3132', '2071']

test('機師檔名：腳本版與前台版一致，且分類回去得到原本的種類', () => {
  for (const [id, key] of PILOTS) {
    for (const kind of PILOT_KINDS) {
      const name = pilotFileName(kind, id, key)
      assert.equal(name, pilotGameFileName(kind, id, key), `${id} ${kind}`)
      const c = classifyPilotFile(name, id)
      assert.equal(c?.kind, kind)
      if (kind !== 'card') assert.equal(c?.key, key)
    }
  }
})

test('機甲檔名：腳本版與前台版一致，且分類回去得到原本的種類', () => {
  for (const wap of WAPS) {
    for (const kind of MECH_KINDS) {
      const name = mechFileName(kind, wap)
      assert.equal(name, mechGameFileName(kind, wap), `${wap} ${kind}`)
      assert.equal(classifyMechFile(name, wap)?.kind, kind)
    }
  }
})

test('不屬於讀取端的檔案分類為 null（例：藍色魔鳥多出來的 Icon_mecha_wap2071_1）', () => {
  assert.equal(classifyMechFile('Icon_mecha_wap2071_1', '2071'), null)
  assert.equal(classifyMechFile('Icon_wap1011_5', '1011'), null)
  assert.equal(classifyPilotFile('Img_1_pilot_gacha_banner_Ada', '10103123'), null)
})
