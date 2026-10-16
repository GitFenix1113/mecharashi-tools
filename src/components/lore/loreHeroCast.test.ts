import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HERO_SLOTS, isWideOfficialArt, pickHeroCast, pickMechHeroCard } from './loreHeroCast.ts'
import { PILOT_OFFICIAL_INDEX } from '../../data/artIndex.ts'

/** 可重現的亂數（mulberry32），讓 500 組抽樣每次跑都一樣 */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('索引裡要同時有直圖與寬圖，而且直圖夠排滿 0～2 號位', () => {
  const dirs = [...PILOT_OFFICIAL_INDEX.keys()]
  const wide = dirs.filter(isWideOfficialArt)
  assert.ok(wide.length > 0, '沒有寬圖：WIDE_RATIO 或索引變了，站位規則要重想')
  assert.ok(dirs.length - wide.length >= HERO_SLOTS - 1)
})

test('每組 4 位、不重複、都有官網圖層；寬圖只會出現在 3 號位', () => {
  const rand = seeded(42)
  for (let i = 0; i < 500; i++) {
    const cast = pickHeroCast(rand)
    assert.equal(cast.length, HERO_SLOTS)
    assert.equal(new Set(cast).size, HERO_SLOTS)
    for (const d of cast) assert.ok(PILOT_OFFICIAL_INDEX.has(d), d)
    assert.ok(cast.slice(0, 3).every((d) => !isWideOfficialArt(d)), `寬圖跑到前排：${cast.join(',')}`)
  }
})

test('8 位都抽得到（3 號位要給寬圖機會）', () => {
  const rand = seeded(7)
  const seen = new Set<string>()
  for (let i = 0; i < 500; i++) pickHeroCast(rand).forEach((d) => seen.add(d))
  assert.equal(seen.size, PILOT_OFFICIAL_INDEX.size)
})

test('機甲廳：只從池子裡抽、每台都抽得到；池子空的回 undefined', () => {
  const rand = seeded(3)
  const pool = Array.from({ length: 30 }, (_, i) => `mech_${i}`)
  const seen = new Set<string>()
  for (let i = 0; i < 500; i++) {
    const m = pickMechHeroCard(pool, rand)
    assert.ok(m && pool.includes(m), m)
    seen.add(m!)
  }
  assert.equal(seen.size, pool.length, '每台都要有機會上 hero')
  assert.equal(pickMechHeroCard(['a'], rand), 'a')
  assert.equal(pickMechHeroCard([], rand), undefined)
})
