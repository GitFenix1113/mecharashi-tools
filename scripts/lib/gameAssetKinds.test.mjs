// 官方原檔命名規則的雙胞胎守門（PLAN-054）
//
// 同一套規則有兩份：scripts/lib/gameAssetKinds.mjs（build 腳本用，要能在 Node 20 跑）
// 與 src/utils/gameArt.ts（前台用）。這裡逐一比對兩份拼出來的檔名——改了一邊沒改另一邊就會掛。
// 也順便驗證「反向分類」：每個拼出來的檔名分類回去都得到原本的種類。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MECH_KINDS, PILOT_KINDS, SCENE_VIEW_SUFFIX, classifyMechFile, classifyNpcFile, classifyPilotFile, mechFileName, npcDirOf, parsePilotCard, pilotFileName, playableArtDirs } from './gameAssetKinds.mjs'
import { SCENE_VIEW_SUFFIX as SCENE_VIEW_SUFFIX_TS, mechGameFileName, pilotGameFileName } from '../../src/utils/gameArt.ts'

const PILOTS = [
  ['10103123', 'Pilot_10103123A'],
  ['10103144', 'Pilot_13019A'],   // 維娜：gameId 與 artKey 不同
  ['13037', 'Pilot_13037A'],      // 阿列娜：短碼
]
const WAPS = ['1011', '3032', '2071']

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

test('擷取裡的機師卡：8 碼與 NPC 轉正的 5 碼卡號都認得，道具卡不算', () => {
  // 每位測試機師拼出來的機師卡都要認得回同一個 gameId（含阿列娜的 5 碼）
  for (const [gameId] of PILOTS) assert.deepEqual(parsePilotCard(pilotFileName('card', gameId)), { gameId, skin: 'A' })
  // 摩根娜 13038：3.7 出卡時兩支腳本都只認 8 碼，差異報告沒列、整條匯入沒觸發（2026-10-19）
  assert.deepEqual(parsePilotCard('Icon_item_13038A'), { gameId: '13038', skin: 'A' })
  assert.deepEqual(parsePilotCard('Icon_item_11021A'), { gameId: '11021', skin: 'A' })
  assert.deepEqual(parsePilotCard('Icon_item_10103174B'), { gameId: '10103174', skin: 'B' })
  // 道具卡（Icon_item_<wap>_<n>）、沒有造型字母的道具、其他位數、圖框 → 不是機師卡
  for (const n of ['Icon_item_1071_1', 'Icon_item_10103174', 'Icon_item_1303A', 'Icon_item_130380A', 'Icon_item_frame_001', 'Icon_item_13038A_Raw', undefined]) {
    assert.equal(parsePilotCard(n), null, String(n))
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

test('場景外觀的鑑賞版：兩份尾碼一致，而且不會被當成立繪（否則 skins／npc 掃描會多出一種圖）', () => {
  assert.equal(SCENE_VIEW_SUFFIX, SCENE_VIEW_SUFFIX_TS)
  assert.equal(classifyPilotFile(`Pilot_10103159B${SCENE_VIEW_SUFFIX}`, '10103159'), null)
  assert.equal(classifyNpcFile(`Pilot_13046B${SCENE_VIEW_SUFFIX}`), null)
})

test('不屬於讀取端的檔案分類為 null（例：藍色魔鳥多出來的 Icon_mecha_wap2071_1）', () => {
  assert.equal(classifyMechFile('Icon_mecha_wap2071_1', '2071'), null)
  assert.equal(classifyMechFile('Icon_wap1011_5', '1011'), null)
  assert.equal(classifyPilotFile('Img_1_pilot_gacha_banner_Ada', '10103123'), null)
})

test('NPC 圖庫：檔名分類與資料夾（號碼段），機師卡與 3D 貼圖不算', () => {
  assert.deepEqual(classifyNpcFile('Pilot_13046B_Raw'), { kind: 'raw', key: 'Pilot_13046B' })
  assert.deepEqual(classifyNpcFile('Pilot_101031200_half'), { kind: 'half', key: 'Pilot_101031200' })
  assert.equal(classifyNpcFile('Icon_item_10103181A'), null)
  assert.equal(classifyNpcFile('Pilot_Verna'), null)               // 3D 貼圖（pilot_pilotbNN_abs）
  assert.equal(classifyNpcFile('T_Pilot_10103113A_Body_AG'), null)
  assert.equal(npcDirOf('Pilot_13046B'), '13046')
  assert.equal(npcDirOf('Pilot_101031200'), '101031200')
})

test('可抽機師的立繪號碼 → gameId（--npc 排除、--skins 落點）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playable-'))
  try {
    const put = (id, ...files) => {
      fs.mkdirSync(path.join(root, id), { recursive: true })
      for (const f of files) fs.writeFileSync(path.join(root, id, f), '')
    }
    put('10103144', 'Pilot_13019A_half.webp', 'Icon_item_10103144A.webp')   // 維娜：號碼與 gameId 不同
    put('10103174', 'Pilot_10103174A_Raw.webp', 'Pilot_10103174A_head.webp', 'Icon_item_10103174A.webp')
    put('10103999', 'Icon_item_10103999A.webp', 'notes.txt')                // 只有機師卡、沒有立繪 → 不算
    assert.deepEqual(Object.fromEntries(playableArtDirs(root)), { 13019: '10103144', 10103174: '10103174' })
    assert.deepEqual([...playableArtDirs(path.join(root, 'nope'))], [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
