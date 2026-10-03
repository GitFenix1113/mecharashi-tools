// 官方原檔讀取端 helper（PLAN-054 C-1）
//   npm test   →   node --test "src/**/*.test.ts"
//
// 用的是真的索引（src/data/gameArtIndex.ts，由 public/images/game 產生）——
// 這幾位是刻意挑的：例外 5 位要證明「資料夾用 gameId、檔名用 artKey、兩者不互推」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mechGameArt, mechGameFileName, pilotGameArt, pilotGameFileName } from './gameArt.ts'

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

test('凜騎士沒有全身大圖 → sn 回 undefined（版面走小尺寸），其餘照常', () => {
  const 凜騎士 = { gameId: '3132' }
  assert.equal(mechGameArt(凜騎士, 'sn'), undefined)
  assert.equal(mechGameArt(凜騎士, 'icon'), '/images/game/mechs/3132/Icon_mecha_wap3132.webp')
  assert.equal(mechGameArt({}, 'icon'), undefined)
  assert.equal(mechGameArt({ gameId: '0000' }, 'icon'), undefined)
})

test('檔名規則：card 不吃 artKey、缺參數回 undefined', () => {
  assert.equal(pilotGameFileName('card', '13037', undefined), 'Icon_item_13037A')
  assert.equal(pilotGameFileName('half', '13037', undefined), undefined)
  assert.equal(mechGameFileName('legs', undefined), undefined)
})
