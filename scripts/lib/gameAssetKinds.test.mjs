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
import { MECH_KINDS, PILOT_KINDS, classifyMechFile, classifyNpcFile, classifyPilotFile, loadPilotSkinMeta, mechFileName, npcDirOf, pilotFileName, playableArtDirs, skinOwnerOf } from './gameAssetKinds.mjs'
import { mechGameFileName, pilotGameFileName } from '../../src/utils/gameArt.ts'

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

test('造型歸屬（--skins 落點與差異報告共用）：預設依檔名號碼，pilotSkinMeta.json 的 owner 優先', () => {
  const playable = new Map([['10103107', '10103107'], ['10103154', '10103154'], ['13019', '10103144']])
  const meta = { Pilot_10103107B: { owner: '10103154' } }
  assert.deepEqual(skinOwnerOf('Pilot_10103154C', playable, meta), { gameId: '10103154', owner: '10103154' })
  assert.deepEqual(skinOwnerOf('Pilot_13019B', playable, meta), { gameId: '10103144', owner: '10103144' })     // 維娜：號碼與 gameId 不同
  assert.deepEqual(skinOwnerOf('Pilot_10103107B', playable, meta), { gameId: '10103107', owner: '10103154' })  // 定版判給洛莎·審判
  assert.equal(skinOwnerOf('Pilot_13046B', playable, meta), undefined)                                          // 不是可抽機師 → 歸 --npc
  // 真的那份註記檔：key 都是立繪鍵、owner 都是 gameId（數字字串）
  for (const [key, m] of Object.entries(loadPilotSkinMeta())) {
    assert.match(key, /^Pilot_\d+[A-Z]{1,2}$/)
    if (m.owner !== undefined) assert.match(m.owner, /^\d+$/)
  }
  assert.deepEqual(loadPilotSkinMeta('/nope/pilotSkinMeta.json'), {})
})
