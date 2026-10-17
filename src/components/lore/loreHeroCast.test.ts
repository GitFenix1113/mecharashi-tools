import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PILOT_HERO_EXCLUDED_CARDS, PILOT_HERO_POOL, pickHeroCard } from './loreHeroCast.ts'
import { GAME_PILOT_CARDS } from '../../data/gameArtIndex.ts'

/** 可重現的亂數（mulberry32），讓 500 組抽樣每次跑都一樣 */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('只從池子裡抽、每張都抽得到；池子空的回 undefined', () => {
  const rand = seeded(3)
  const pool = Array.from({ length: 30 }, (_, i) => `card_${i}`)
  const seen = new Set<string>()
  for (let i = 0; i < 500; i++) {
    const m = pickHeroCard(pool, rand)
    assert.ok(m && pool.includes(m), m)
    seen.add(m!)
  }
  assert.equal(seen.size, pool.length, '每張都要有機會上 hero')
  assert.equal(pickHeroCard(['a'], rand), 'a')
  assert.equal(pickHeroCard([], rand), undefined)
})

test('機師廳池子：排除名單的卡池鍵都真的存在（防打錯字而靜默失效），扣掉後池子仍有圖', () => {
  const cards = new Set(GAME_PILOT_CARDS.values())
  for (const key of PILOT_HERO_EXCLUDED_CARDS) assert.ok(cards.has(key), `排除名單的 ${key} 不在 GAME_PILOT_CARDS`)
  assert.equal(PILOT_HERO_POOL.length, GAME_PILOT_CARDS.size - PILOT_HERO_EXCLUDED_CARDS.size)
  assert.ok(PILOT_HERO_POOL.length > 0)
  for (const id of PILOT_HERO_POOL) assert.ok(!PILOT_HERO_EXCLUDED_CARDS.has(GAME_PILOT_CARDS.get(id)!), id)
})
