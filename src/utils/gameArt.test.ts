// 官方原檔讀取端 helper（PLAN-054 C-1）
//   npm test   →   node --test "src/**/*.test.ts"
//
// 用的是真的索引（src/data/gameArtIndex.ts，由 public/images/game 產生）——
// 這幾位是刻意挑的：例外 5 位要證明「資料夾用 gameId、檔名用 artKey、兩者不互推」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MECH_CARD_NONE, mechAutoCardKey, mechCard, mechCardArt, mechCardCatalog, mechGameArt, mechGameFileName, mechGameIdFromPath, mechSkinCatalog, npcGameArt, pilotCardArt, pilotGameArt, pilotGameFileName, pilotGameIdFromPath, pilotSkinCatalog, pilotSkins } from './gameArt.ts'

const 維娜 = { gameId: '10103144', artKey: 'Pilot_13019A' }
const 葉夫根尼 = { gameId: '10103123', artKey: 'Pilot_10103123A' }

test('例外機師：資料夾是 gameId、檔名是 artKey（維娜 10103144／Pilot_13019A）', () => {
  assert.equal(pilotGameArt(維娜, 'half'), '/images/game/pilots/10103144/Pilot_13019A_half.webp')
  assert.equal(pilotGameArt(維娜, 'raw'), '/images/game/pilots/10103144/Pilot_13019A_Raw.webp')
  assert.equal(pilotGameArt(維娜, 'head'), '/images/game/pilots/10103144/Pilot_13019A_head.webp')
  // 機師卡吃 gameId，不吃 artKey
  assert.equal(pilotGameArt(維娜, 'card'), '/images/game/pilots/10103144/Icon_item_10103144A.webp')
})

test('一般機師四種圖都有', () => {
  assert.equal(pilotGameArt(葉夫根尼, 'half'), '/images/game/pilots/10103123/Pilot_10103123A_half.webp')
  assert.equal(pilotGameArt(葉夫根尼, 'card'), '/images/game/pilots/10103123/Icon_item_10103123A.webp')
})

test('沒有 gameId（索妮婭）、索引沒有、或 artKey 與檔案對不上 → undefined，交給下一個候選', () => {
  assert.equal(pilotGameArt({ portrait: '/images/pilots/索妮婭/half.webp' } as never, 'half'), undefined)
  assert.equal(pilotGameArt(null, 'half'), undefined)
  assert.equal(pilotGameArt({ gameId: '99999999', artKey: 'Pilot_99999999A' }, 'half'), undefined)
  // 拿 gameId 硬拼 artKey 是錯的——維娜的檔案不叫 Pilot_10103144A
  assert.equal(pilotGameArt({ gameId: '10103144', artKey: 'Pilot_10103144A' }, 'half'), undefined)
  assert.equal(pilotGameArt({ gameId: '10103144' }, 'raw'), undefined)
})

test('機甲：立繪、全身大圖、部件 1~4 依序對到軀幹／左臂／右臂／腿', () => {
  const 都卜勒 = { gameId: '1011' }
  assert.equal(mechGameArt(都卜勒, 'icon'), '/images/game/mechs/1011/Icon_mecha_wap1011.webp')
  assert.equal(mechGameArt(都卜勒, 'sn'), '/images/game/mechs/1011/Icon_mecha_wap1011_SN_Raw.webp')
  assert.equal(mechGameArt(都卜勒, 'torso'), '/images/game/mechs/1011/Icon_wap1011_1.webp')
  assert.equal(mechGameArt(都卜勒, 'leftArm'), '/images/game/mechs/1011/Icon_wap1011_2.webp')
  assert.equal(mechGameArt(都卜勒, 'rightArm'), '/images/game/mechs/1011/Icon_wap1011_3.webp')
  assert.equal(mechGameArt(都卜勒, 'legs'), '/images/game/mechs/1011/Icon_wap1011_4.webp')
})

test('沒有遊戲 ID（新機甲還沒擷取，例：凜騎士）或索引沒有這台 → 一律 undefined，交給舊欄位／佔位', () => {
  assert.equal(mechGameArt({}, 'icon'), undefined)
  assert.equal(mechGameArt({}, 'sn'), undefined)
  assert.equal(mechGameArt({ gameId: '0000' }, 'icon'), undefined)
  // wap3132 曾被誤對到凜騎士（2026-10-04 站長更正），素材已移出 core —— 索引裡不能再有它
  assert.equal(mechGameArt({ gameId: '3132' }, 'icon'), undefined)
})

test('檔名規則：card 不吃 artKey、缺參數回 undefined', () => {
  assert.equal(pilotGameFileName('card', '13037', undefined), 'Icon_item_13037A')
  assert.equal(pilotGameFileName('half', '13037', undefined), undefined)
  assert.equal(mechGameFileName('legs', undefined), undefined)
})

test('反推 ID：機師官方原檔夾與站上原稿夾都認，artKey 取資料夾實際主鍵（維娜不是 Pilot_10103144A）', () => {
  assert.deepEqual(pilotGameIdFromPath('/images/game/pilots/10103123/Pilot_10103123A_half.webp'), 葉夫根尼)
  assert.deepEqual(pilotGameIdFromPath('/images/game/pilots/10103144/Icon_item_10103144A.webp'), 維娜)
  assert.deepEqual(pilotGameIdFromPath('/images/pilots/10103123/art.webp'), 葉夫根尼)
  // BASE_URL／完整網址前綴不影響
  assert.deepEqual(pilotGameIdFromPath('/mecharashi-tools/images/game/pilots/10103123/Pilot_10103123A_Raw.webp'), 葉夫根尼)
})

test('反推 ID：名字資料夾、索引沒有的數字、遠端網址、空值 → undefined（只寫圖片，不動 ID）', () => {
  assert.equal(pilotGameIdFromPath('/images/pilots/索妮婭/half.webp'), undefined)
  assert.equal(pilotGameIdFromPath('/images/game/pilots/99999999/Pilot_99999999A_half.webp'), undefined)
  assert.equal(pilotGameIdFromPath('https://media.zlongame.com/media/pictures/cn/community/img/gl/gameInfo/characterHalf/Pilot_10103123A_half.png'), undefined)
  assert.equal(pilotGameIdFromPath(''), undefined)
  assert.equal(pilotGameIdFromPath(undefined), undefined)
  // 機師路徑不會被當成機甲，反之亦然
  assert.equal(mechGameIdFromPath('/images/game/pilots/10103123/Pilot_10103123A_half.webp'), undefined)
  assert.equal(pilotGameIdFromPath('/images/game/mechs/1011/Icon_mecha_wap1011.webp'), undefined)
})

test('反推 ID：機甲立繪、全身大圖、部件都推得回 wap；舊名字夾與已移出 core 的 3132 推不出來', () => {
  assert.equal(mechGameIdFromPath('/images/game/mechs/1011/Icon_mecha_wap1011.webp'), '1011')
  assert.equal(mechGameIdFromPath('/images/game/mechs/1011/Icon_mecha_wap1011_SN_Raw.webp'), '1011')
  assert.equal(mechGameIdFromPath('/images/game/mechs/1011/Icon_wap1011_3.webp'), '1011')
  assert.equal(mechGameIdFromPath('/images/mechs/凜騎士/portrait.webp'), undefined)
  assert.equal(mechGameIdFromPath('/images/game/mechs/3132/Icon_mecha_wap3132.webp'), undefined)
})

test('NPC 圖庫：沒有 gameId、artKey 指到 NPC 立繪 → 頭像／頭部／半身都有圖，機師卡沒有', () => {
  const npc = { artKey: 'Pilot_13046B' }
  assert.equal(pilotGameArt(npc, 'half'), '/images/game/npc/13046/Pilot_13046B_half.webp')
  assert.equal(pilotGameArt(npc, 'head'), '/images/game/npc/13046/Pilot_13046B_head.webp')
  assert.equal(pilotGameArt(npc, 'raw'), '/images/game/npc/13046/Pilot_13046B_Raw.webp')
  assert.equal(pilotGameArt(npc, 'card'), undefined)
  // 沒有字母造型碼的官方鍵照樣認得
  assert.equal(npcGameArt('Pilot_101031200', 'half'), '/images/game/npc/101031200/Pilot_101031200_half.webp')
})

test('NPC 圖庫：有 gameId 但 artKey 指到 NPC 立繪 → 立繪走 NPC 圖庫，機師卡照樣走 gameId 資料夾', () => {
  // 假想：維娜的卡號＋某張 NPC 立繪（例如官方之後換回 NPC 時期的造型）
  const mixed = { gameId: '10103144', artKey: 'Pilot_13046A' }
  assert.equal(pilotGameArt(mixed, 'half'), '/images/game/npc/13046/Pilot_13046A_half.webp')
  assert.equal(pilotGameArt(mixed, 'card'), '/images/game/pilots/10103144/Icon_item_10103144A.webp')
  // gameId 資料夾的主鍵對得上時優先用它，不會跑去 NPC 圖庫
  assert.equal(pilotGameArt(維娜, 'half'), '/images/game/pilots/10103144/Pilot_13019A_half.webp')
})

test('NPC 圖庫：缺的種類回 undefined，交給下一個候選（Pilot_11023B 只有半身 Raw）', () => {
  assert.equal(npcGameArt('Pilot_11023B', 'raw'), '/images/game/npc/11023/Pilot_11023B_Raw.webp')
  assert.equal(npcGameArt('Pilot_11023B', 'half'), undefined)
  assert.equal(npcGameArt('Pilot_99999999A', 'half'), undefined)
  assert.equal(npcGameArt(undefined, 'half'), undefined)
})

test('造型（PLAN-042-D）：skins/ 子資料夾以 gameId 查、NPC 圖庫的外觀以文件 ID 查，串成一份', () => {
  // 卡蜜拉：一套場景插畫
  const camilla = pilotSkins({ id: 'pilot_017_卡米拉', gameId: '10103146' })
  assert.equal(camilla.length, 1)
  assert.equal(camilla[0].key, 'Pilot_10103146B')
  assert.equal(camilla[0].scene, true)
  assert.equal(camilla[0].raw, '/images/game/pilots/10103146/skins/Pilot_10103146B_Raw.webp')
  assert.equal(camilla[0].view, '/images/game/pilots/10103146/skins/Pilot_10103146B_Raw_view.webp')   // 場景外觀的鑑賞版
  assert.equal(camilla[0].label, '外觀 1')
  // 洛莎·審判：Pilot_10103107B 依 pilotSkinMeta.json 的 owner 放在她這裡（owner 仍是 build 時決定的靜態層）
  assert.ok(pilotSkins({ id: 'pilot_032_洛莎審判', gameId: '10103154' }).some((s) => s.key === 'Pilot_10103107B' && !s.view))   // 去背的沒有鑑賞版
  assert.ok(!pilotSkins({ id: 'pilot_003_洛莎', gameId: '10103107' }).some((s) => s.key === 'Pilot_10103107B'))
  // 海莉絲：NPC 圖庫裡的那套（npcArtNotes owner＋外觀卡）
  const hailis = pilotSkins({ id: 'pilot_049_海莉絲', gameId: '10103174' })
  assert.ok(hailis.some((s) => s.key === 'Pilot_10103132A' && s.raw.startsWith('/images/game/npc/10103132/')))
  // 沒有外觀、沒有 ID → 空陣列
  assert.deepEqual(pilotSkins({ id: 'pilot_076_凱登', gameId: '10103101' }), [])
  assert.deepEqual(pilotSkins(undefined), [])
})

// ── PLAN-042-E E-1：pilotLore.skins 的名稱、隱藏、順序 ─────────────────────────
// 洛莎·審判（10103154）有三套：Pilot_10103107B／Pilot_10103154B／Pilot_10103154C（build 清單的原索引順序）
const ROSA_J = { id: 'pilot_032_洛莎審判', gameId: '10103154' }

test('外觀設定：依 skins 陣列排序並套用名稱，沒列到的依原索引接在後面、顯示「外觀 N」', () => {
  const list = pilotSkins(ROSA_J, { skins: [{ key: 'Pilot_10103154C', name: ' 審判之夜 ' }, { key: 'Pilot_10103107B' }] })
  assert.deepEqual(list.map((s) => s.key), ['Pilot_10103154C', 'Pilot_10103107B', 'Pilot_10103154B'])
  assert.deepEqual(list.map((s) => s.label), ['審判之夜', '外觀 1', '外觀 2'])
  // 「外觀 N」的 N 是原索引，不隨排序變動
  assert.deepEqual(list.map((s) => s.defaultLabel), ['外觀 3', '外觀 1', '外觀 2'])
})

test('外觀設定：hidden 的不列；空名稱當沒填', () => {
  const list = pilotSkins(ROSA_J, { skins: [{ key: 'Pilot_10103107B', hidden: true }, { key: 'Pilot_10103154B', name: '   ' }] })
  assert.deepEqual(list.map((s) => s.key), ['Pilot_10103154B', 'Pilot_10103154C'])
  assert.deepEqual(list.map((s) => s.label), ['外觀 2', '外觀 3'])
})

test('外觀設定：沒有圖的殘留 key 忽略、重複 key 只認第一筆；沒有設定 ＝ 圖檔層原樣', () => {
  const list = pilotSkins(ROSA_J, { skins: [
    { key: 'Pilot_99999999Z', name: '已經不存在的外觀' },
    { key: 'Pilot_10103154B', name: '第一筆' },
    { key: 'Pilot_10103154B', name: '第二筆', hidden: true },
  ] })
  assert.deepEqual(list.map((s) => s.key), ['Pilot_10103154B', 'Pilot_10103107B', 'Pilot_10103154C'])
  assert.equal(list[0].label, '第一筆')
  assert.deepEqual(pilotSkins(ROSA_J, null), pilotSkinCatalog(ROSA_J))
  assert.deepEqual(pilotSkins(ROSA_J, { skins: [] }), pilotSkinCatalog(ROSA_J))
  // 沒有外觀的機師，DB 設定再多也是空
  assert.deepEqual(pilotSkins({ id: 'pilot_076_凱登', gameId: '10103101' }, { skins: [{ key: 'Pilot_10103154B' }] }), [])
})

test('pilotSkinCatalog：含 DB 隱藏的外觀（後台外觀分頁要列全部）', () => {
  assert.equal(pilotSkinCatalog(ROSA_J).length, 3)
  assert.ok(pilotSkinCatalog(ROSA_J).every((s) => s.label === s.defaultLabel))
})

test('機甲塗裝：檔名＝Img_Skin_wap<wap>_<代碼>；兵裝組件（遊騎兵的龍膽 wap3132）保留官方檔名、代碼是 wap<兵裝號>', () => {
  const list = mechSkinCatalog({ gameId: '3032' })
  assert.deepEqual(list.map((s) => s.key), ['S1', 'wap3132'])
  assert.equal(list[0].raw, '/images/game/mechs/3032/skins/Img_Skin_wap3032_S1.webp')
  assert.equal(list[1].raw, '/images/game/mechs/3032/skins/Img_Skin_wap3132.webp')
  assert.equal(list[1].head, '/images/game/mechs/3032/skins/Img_Skin_wap3132_thumb.webp')
  assert.equal(list[1].label, '塗裝 2')
  // 兵裝號不是一台機甲：查不到自己的塗裝列
  assert.deepEqual(mechSkinCatalog({ gameId: '3132' }), [])
})

test('招募插畫（PLAN-042-A Phase J）：以 gameId 查，檔名是卡池鍵（插畫鍵不同名的例外照對照表）', () => {
  assert.equal(pilotCardArt({ gameId: '10103174' }), '/images/game/pilots/10103174/card/pilot_gacha_HailisMill.webp')
  assert.equal(pilotCardArt({ gameId: '10103121' }), '/images/game/pilots/10103121/card/pilot_gacha_Diracca1.webp')
  // 沒有 gameId（NPC 轉正、還沒連機師卡）、或沒開過專屬卡池（凱登）→ undefined
  assert.equal(pilotCardArt({}), undefined)
  assert.equal(pilotCardArt({ gameId: '10103101' }), undefined)
  assert.equal(pilotCardArt(null), undefined)
})

test('機甲招募插畫：依 gameId 自動對照；卡池鍵不一定是英文名（Ranger＝龍雀 3015，遊騎兵 3032 是 Ranger02）', () => {
  assert.equal(mechCardArt({ gameId: '3015' }), '/images/game/mechs/3015/card/mechcard_illustration_Ranger.webp')
  assert.equal(mechCardArt({ gameId: '3032' }), '/images/game/mechs/3032/card/mechcard_illustration_Ranger02.webp')
  assert.equal(mechAutoCardKey({ gameId: '3032' }), 'Ranger02')
  // 沒有 gameId、沒開過專屬卡池（3002）→ undefined
  assert.equal(mechCardArt({}), undefined)
  assert.equal(mechCardArt({ gameId: '3002' }), undefined)
  assert.equal(mechCardArt(null), undefined)
})

test('機甲招募插畫改選（cardKey）：圖與卡池動態的鍵都跟著卡池走、不跟這台的 gameId', () => {
  assert.deepEqual(mechCard({ gameId: '3032', cardKey: 'Ranger' }), {
    key: 'Ranger', wap: '3015', src: '/images/game/mechs/3015/card/mechcard_illustration_Ranger.webp',
  })
  // 沒開過專屬卡池的機甲也能改選
  assert.equal(mechCard({ gameId: '3002', cardKey: 'Rex' })?.wap, '1012')
  // 不顯示
  assert.equal(mechCard({ gameId: '3015', cardKey: MECH_CARD_NONE }), undefined)
  // 改選的鍵站上沒有圖 → 不顯示，不退回自動那張（會改選多半就是自動那張不對）
  assert.equal(mechCard({ gameId: '3015', cardKey: 'NoSuchPool' }), undefined)
})

test('mechCardCatalog：每組卡池一筆、依卡池鍵排序，且都對得回自動對照', () => {
  const list = mechCardCatalog()
  assert.ok(list.length > 60)
  assert.deepEqual(list.map((c) => c.key), [...list.map((c) => c.key)].sort((a, b) => a.localeCompare(b)))
  assert.equal(new Set(list.map((c) => c.key)).size, list.length)
  for (const c of list) assert.equal(mechAutoCardKey({ gameId: c.wap }), c.key)
})
