// codec v1 的驗收測試 —— PLAN-052-C B-1
//
// 計畫書決策六逐字：「測試是驗收條件，不是加分項」。三組缺一不可：
//   ① round-trip：10,000 份隨機合法配裝，`decode(encode(x)).draft` 深等於 `x`
//   ② 模糊測試：10,000 次隨機位元翻轉，不 throw、不無窮迴圈、checksum 攔截率 > 99%
//   ③ golden fixture：每個 FMT 版本凍一組代碼字串 ＋ 期望解碼結果，**舊版解碼器永不刪除**
// 外加邊界：空碼、只有 header、超長、非法字元、未來版本號。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LoadoutDraft, EquipSet, LoadoutMount } from '../../types/loadout'
import { buildShareIndex } from './shareId.ts'
import {
  encodeLoadout, decodeLoadout, cleanCodeInput, checksum8,
  toBase64Url, fromBase64Url, packGameVersion, unpackGameVersion,
  FMT_VERSION, TAG, LIMITS,
  type ShareIndexes, type DecodeOk,
} from './codec.ts'

// ─── 測試用的實體宇宙（取自 2026-08-25 線上實測的真實 doc id 形狀）──────────

const UNIVERSE = {
  pilot: ['pilot_001_艾達', 'pilot_049_海莉絲', 'pilot_088_曜', 'pilot_022_帕斯卡'],
  mech: ['mech_001_初擊者', 'mech_052_彌造者', 'mech_090_美杜莎MK2'],
  weapon: ['weapon_016_藝術突襲EX', 'weapon_049_炬塔_LW', 'weapon_176_耀星', 'weapon_182_夜燼'],
  component: ['comp_0001_應元件W_蓬勃', 'comp_0080_觸元件W_憑逸', 'comp_0208_觸元件_警戒'],
  backpack: ['60100104', '60101706', '61002705'],
  module: ['mod_4001', 'mod_4032', 'mod_4001_2'],
}

const ALIASES = { mod_4001_2: 1_500_001 }

const INDEXES: ShareIndexes = {
  pilot: buildShareIndex('pilot', UNIVERSE.pilot),
  mech: buildShareIndex('mech', UNIVERSE.mech),
  weapon: buildShareIndex('weapon', UNIVERSE.weapon),
  component: buildShareIndex('component', UNIVERSE.component),
  backpack: buildShareIndex('backpack', UNIVERSE.backpack),
  module: buildShareIndex('module', UNIVERSE.module, ALIASES),
}

const ok = (r: ReturnType<typeof decodeLoadout>): DecodeOk => {
  assert.equal(r.ok, true, r.ok ? '' : `期望成功卻失敗：${r.reason} / ${r.message}`)
  return r as DecodeOk
}

// ─── 低階零件 ────────────────────────────────────────────────────────────────

test('base64url：round-trip，且不補 =', () => {
  for (const len of [0, 1, 2, 3, 4, 5, 17, 64, 255]) {
    const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff)
    const s = toBase64Url(bytes)
    assert.ok(!s.includes('='), '不可補 padding')
    assert.deepEqual(fromBase64Url(s), bytes, `長度 ${len}`)
  }
})

test('base64url：認不得的字元回 null，不 throw、也不靜默跳過', () => {
  for (const bad of ['AAA=', 'AA+A', 'AA/A', 'AA A', 'AA中A']) {
    assert.equal(fromBase64Url(bad), null, bad)
  }
})

test('checksum8：內容差一個位元就換一個值', () => {
  const a = Uint8Array.from([1, 2, 3, 4, 5])
  const b = Uint8Array.from([1, 2, 3, 4, 4])
  assert.notEqual(checksum8(a), checksum8(b))
})

test('遊戲版本：3.3 ↔ 33；認不得或超出 v25.5 一律記 0（未知）', () => {
  assert.equal(packGameVersion('3.3'), 33)
  assert.equal(unpackGameVersion(33), '3.3')
  assert.equal(packGameVersion(undefined), 0)
  assert.equal(packGameVersion('不是版本'), 0)
  assert.equal(packGameVersion('3.10'), 0, 'minor ≥ 10 表達不了，記 0 比記錯誠實')
  assert.equal(packGameVersion('26.0'), 0, '超過 1 byte')
  assert.equal(unpackGameVersion(0), undefined)
})

test('輸入清洗：吃得下裸碼／?b=／完整網址／被換行截斷的貼上', () => {
  const code = 'AQMhI0-_'
  assert.equal(cleanCodeInput(code), code)
  assert.equal(cleanCodeInput(`?b=${code}`), code)
  assert.equal(cleanCodeInput(`https://mecharashi.wiki/simulator?b=${code}`), code)
  assert.equal(cleanCodeInput(`https://mecharashi.wiki/simulator?b=${code}&x=1`), code)
  assert.equal(cleanCodeInput('AQMh\nI0-_'), code, 'Discord 會在 ~70 字元處插入換行')
  assert.equal(cleanCodeInput('  AQMh I0-_  '), code)
  assert.equal(cleanCodeInput(''), '')
})

// ─── ① round-trip property test ──────────────────────────────────────────────

/** 固定種子的 xorshift32。用它而不用 Math.random：測試失敗時要能重現同一份輸入。 */
function rng(seed: number) {
  let x = seed >>> 0 || 1
  return () => {
    x ^= x << 13; x >>>= 0
    x ^= x >>> 17
    x ^= x << 5; x >>>= 0
    return x / 0x1_0000_0000
  }
}

/**
 * 產生一份 **canonical** 的草稿。
 *
 * 「canonical」在這裡有明確定義：**encode 之後再 decode 會原樣長回來的形狀**。
 * 具體是四條 —— mounts 依 slotKey 排序、元件依 shareId 排序、
 * 選填欄位「沒有值就不要有那個 key」（不是 `undefined`）、`activeSetKey` 必為 sets 的鍵之一。
 * 產生器刻意自己遵守這四條，因為 round-trip 測試若對非 canonical 輸入放水，
 * 它就從「內容有沒有保住」退化成「Object.keys 的順序有沒有保住」。
 */
function randomDraft(r: () => number): LoadoutDraft {
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]
  const chance = (p: number) => r() < p

  const draft: LoadoutDraft = { activeSetKey: 'default', sets: {} }
  if (chance(0.9)) draft.pilotId = pick(UNIVERSE.pilot)
  if (chance(0.85)) draft.mechId = pick(UNIVERSE.mech)

  const setKeys = chance(0.25)
    ? ['form_海莉絲_先鋒', 'form_海莉絲_突擊', 'form_海莉絲_戰術'].slice(0, 1 + Math.floor(r() * 3))
    : chance(0.9) ? ['default'] : []

  for (const key of [...setKeys].sort()) {
    const slots: Array<{ bank: 'main' | 'backup'; slot: LoadoutMount['slot']; side?: 'left' | 'right' }> = [
      { bank: 'main', slot: 'singleHand', side: 'left' },
      { bank: 'main', slot: 'singleHand', side: 'right' },
      { bank: 'main', slot: 'shoulder', side: 'left' },
      { bank: 'main', slot: 'shoulder', side: 'right' },
      { bank: 'main', slot: 'back' },
      { bank: 'main', slot: 'dualHand' },
      { bank: 'backup', slot: 'singleHand', side: 'left' },
      { bank: 'backup', slot: 'singleHand', side: 'right' },
    ]
    const mounts: LoadoutMount[] = []
    for (const s of slots) {
      if (!chance(0.45)) continue
      const m: LoadoutMount = { weaponId: pick(UNIVERSE.weapon), bank: s.bank, slot: s.slot }
      if (s.side) m.side = s.side
      if (chance(0.3)) {
        const nt = Math.floor(r() * 3), ne = Math.floor(r() * 3)
        const byNum = (a: string, b: string) =>
          (INDEXES.component.toShareId(a) ?? 0) - (INDEXES.component.toShareId(b) ?? 0)
        const trig = [...new Set(Array.from({ length: nt }, () => pick(UNIVERSE.component)))].sort(byNum)
        const eff = [...new Set(Array.from({ length: ne }, () => pick(UNIVERSE.component)))].sort(byNum)
        if (trig.length || eff.length) {
          m.setup = {}
          if (trig.length) m.setup.triggerComponentIds = trig
          if (eff.length) m.setup.effectComponentIds = eff
        }
      }
      mounts.push(m)
    }
    // decode 依 slotKey 排序回傳；產生器先排好，否則測到的是順序不是內容
    mounts.sort((a, b) => {
      const k = (m: LoadoutMount) => (m.side ? `${m.bank}:${m.slot}:${m.side}` : `${m.bank}:${m.slot}`)
      return k(a).localeCompare(k(b))
    })
    const set: EquipSet = { mounts }
    if (chance(0.5)) set.backpackId = pick(UNIVERSE.backpack)
    draft.sets[key] = set
  }

  const keys = Object.keys(draft.sets)
  if (keys.length) draft.activeSetKey = pick(keys)

  if (chance(0.4)) {
    const zones = ['γ1', 'γ2', 'α', 'β'].slice(0, 1 + Math.floor(r() * 4)).sort()
    const nd: Record<string, number> = {}
    for (const z of zones) nd[z] = Math.floor(r() * 24)
    draft.ndLevels = nd
  }
  if (chance(0.3)) draft.name = ['我的配裝', 'アサルト', 'Build #7', '甲乙丙丁戊'][Math.floor(r() * 4)]
  if (chance(0.2)) {
    const parts: Record<string, string> = {}
    for (const p of ['torso', 'leftArm', 'rightArm', 'legs']) if (chance(0.5)) parts[p] = pick(UNIVERSE.mech)
    if (Object.keys(parts).length) draft.parts = parts as LoadoutDraft['parts']
  }
  if (chance(0.2)) {
    const mods: Record<string, string> = {}
    for (const p of ['torso', 'leftArm', 'rightArm', 'legs']) if (chance(0.5)) mods[p] = pick(UNIVERSE.module)
    if (Object.keys(mods).length) draft.modules = mods as LoadoutDraft['modules']
  }
  return draft
}

test('① round-trip：10,000 份隨機合法配裝，decode(encode(x)) 深等於 x', () => {
  const r = rng(0x052c0001)
  let maxChars = 0
  for (let i = 0; i < 10_000; i++) {
    const draft = randomDraft(r)
    const code = encodeLoadout(draft, { indexes: INDEXES, gameVersion: '3.3' })
    maxChars = Math.max(maxChars, code.length)
    const res = decodeLoadout(code, INDEXES)
    assert.equal(res.ok, true, `第 ${i} 份解不開：${res.ok ? '' : res.reason}`)
    const out = res as DecodeOk
    assert.deepEqual(out.draft, draft, `第 ${i} 份不相等\ncode=${code}`)
    assert.deepEqual(out.unresolved, [], `第 ${i} 份不該有解不開的引用`)
    assert.deepEqual(out.unmodeled, [], `第 ${i} 份不該有未知段落`)
    assert.equal(out.gameVersion, '3.3')
  }
  // 決策一估的是「典型 ≈130 字元、最壞 ≈743 bytes」。這裡把實測最壞值釘住，
  // 之後有人加段落把碼撐爆 Discord 的 2000 字元上限時，這條會先紅
  assert.ok(maxChars < 900, `最長代碼 ${maxChars} 字元，超出預期`)
})

test('canonical order：mounts 的順序不影響產出的代碼（否則同一套配裝會有兩種碼）', () => {
  const mk = (mounts: LoadoutMount[]): LoadoutDraft => ({
    activeSetKey: 'default', sets: { default: { mounts } },
  })
  const a: LoadoutMount = { weaponId: 'weapon_176_耀星', bank: 'main', slot: 'singleHand', side: 'left' }
  const b: LoadoutMount = { weaponId: 'weapon_049_炬塔_LW', bank: 'main', slot: 'back' }
  const opts = { indexes: INDEXES }
  assert.equal(encodeLoadout(mk([a, b]), opts), encodeLoadout(mk([b, a]), opts))
})

test('canonical order：sets 的鍵插入順序不影響產出的代碼', () => {
  const s1: EquipSet = { mounts: [] }
  const s2: EquipSet = { mounts: [], backpackId: '60100104' }
  const d1: LoadoutDraft = { activeSetKey: 'a', sets: { a: s1, b: s2 } }
  const d2: LoadoutDraft = { activeSetKey: 'a', sets: { b: s2, a: s1 } }
  const opts = { indexes: INDEXES }
  assert.equal(encodeLoadout(d1, opts), encodeLoadout(d2, opts))
})

// ─── ② 模糊測試 ──────────────────────────────────────────────────────────────

test('② 模糊測試：10,000 次位元翻轉，不 throw、不無窮迴圈，攔截率 > 99%', () => {
  const r = rng(0x052c0002)
  const seed = encodeLoadout(randomDraft(rng(0x052c0003)), { indexes: INDEXES, gameVersion: '3.3' })
  const bytes = fromBase64Url(seed)!

  let caught = 0, accepted = 0
  const started = Date.now()
  for (let i = 0; i < 10_000; i++) {
    const copy = Uint8Array.from(bytes)
    // 翻 1–3 個位元：單一位元最常見（換行、手打錯字），多位元模擬惡意竄改
    const flips = 1 + Math.floor(r() * 3)
    for (let f = 0; f < flips; f++) {
      const at = Math.floor(r() * copy.length)
      copy[at] ^= 1 << Math.floor(r() * 8)
    }
    const res = decodeLoadout(toBase64Url(copy), INDEXES)
    if (res.ok) accepted++
    else caught++
  }
  const elapsed = Date.now() - started
  assert.ok(elapsed < 20_000, `10,000 次解碼花了 ${elapsed}ms —— 疑似有迴圈沒有收斂`)
  const rate = caught / 10_000
  assert.ok(rate > 0.99, `攔截率只有 ${(rate * 100).toFixed(2)}%（被接受 ${accepted} 次）`)
})

test('② 模糊測試：完全隨機的位元組永遠不 throw', () => {
  const r = rng(0x052c0004)
  for (let i = 0; i < 2_000; i++) {
    const n = 1 + Math.floor(r() * 80)
    const bytes = Uint8Array.from({ length: n }, () => Math.floor(r() * 256))
    // 不應 throw；ok 與否都可以接受
    const res = decodeLoadout(toBase64Url(bytes), INDEXES)
    assert.ok(typeof res.ok === 'boolean')
  }
})

test('② varint 炸彈：一串 0x80 不可以讓解碼器跑不完', () => {
  const bomb = new Uint8Array(64).fill(0x80)
  bomb[0] = FMT_VERSION
  const res = decodeLoadout(toBase64Url(bomb), INDEXES)
  assert.equal(res.ok, false)
})

test('② 數量炸彈：宣告十萬個 mount 的小代碼必須被拒絕，不可真的去配置', () => {
  // 手工組一段合法 header ＋ SETS 段，段內宣告一個超大的 set 數
  const body = [FMT_VERSION, 0, 0, 0, TAG.SETS, 3, 0xff, 0xff, 0x7f]
  const all = Uint8Array.from([...body, checksum8(Uint8Array.from(body))])
  const res = decodeLoadout(toBase64Url(all), INDEXES)
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.reason, 'too-many-items')
})

// ─── 邊界（決策四②）────────────────────────────────────────────────────────

test('邊界：空碼／只有 header／超長／非法字元／未來版本，各有各的說法', () => {
  const cases: Array<[string, string]> = [
    ['', 'empty'],
    ['A', 'truncated'],
    ['AAAA中文', 'charset'],
    ['A'.repeat(LIMITS.codeChars + 1), 'too-long'],
  ]
  for (const [input, reason] of cases) {
    const res = decodeLoadout(input, INDEXES)
    assert.equal(res.ok, false, input.slice(0, 12))
    assert.equal(res.ok === false && res.reason, reason, input.slice(0, 12))
  }
})

test('邊界：checksum 對不上要說「被截斷」而不是「代碼無效」', () => {
  const code = encodeLoadout({ activeSetKey: 'default', sets: {}, pilotId: 'pilot_001_艾達' }, { indexes: INDEXES })
  const bytes = fromBase64Url(code)!
  bytes[bytes.length - 1] ^= 0xff
  const res = decodeLoadout(toBase64Url(bytes), INDEXES)
  assert.equal(res.ok === false && res.reason, 'checksum')
  assert.match(res.ok === false ? res.message : '', /截斷/)
})

test('邊界：來自更新版本的代碼要叫人重新整理，而不是說代碼無效', () => {
  const body = Uint8Array.from([FMT_VERSION + 1, 0, 0, 0])
  const all = Uint8Array.from([...body, checksum8(body)])
  const res = decodeLoadout(toBase64Url(all), INDEXES)
  assert.equal(res.ok === false && res.reason, 'future-version')
  assert.match(res.ok === false ? res.message : '', /重新整理/)
})

test('邊界：空草稿 round-trip（沒有機師、沒有機甲、沒有任何一套）', () => {
  const empty: LoadoutDraft = { activeSetKey: 'default', sets: {} }
  const out = ok(decodeLoadout(encodeLoadout(empty, { indexes: INDEXES }), INDEXES))
  assert.deepEqual(out.draft, empty)
})

// ─── 語意層：一律放行並標警示（決策四④）──────────────────────────────────

test('查無此號的武器 ⇒ 那一格空著並記進 unresolved，其餘照樣套用', () => {
  const draft: LoadoutDraft = {
    activeSetKey: 'default',
    pilotId: 'pilot_001_艾達',
    sets: { default: { mounts: [{ weaponId: 'weapon_176_耀星', bank: 'main', slot: 'back' }] } },
  }
  const code = encodeLoadout(draft, { indexes: INDEXES })
  // 換一個「沒有 176 這把武器」的宇宙來解（模擬武器下架）
  const thin: ShareIndexes = { ...INDEXES, weapon: buildShareIndex('weapon', ['weapon_016_藝術突襲EX']) }
  const out = ok(decodeLoadout(code, thin))
  assert.equal(out.draft.pilotId, 'pilot_001_艾達', '其餘內容必須照樣套用')
  assert.deepEqual(out.draft.sets.default.mounts, [])
  assert.deepEqual(out.unresolved, [{ kind: 'weapon', shareId: 176, at: 'main:back' }])
})

test('查無此號的機師／機甲不影響整串代碼', () => {
  const draft: LoadoutDraft = { activeSetKey: 'default', sets: {}, pilotId: 'pilot_088_曜', mechId: 'mech_052_彌造者' }
  const code = encodeLoadout(draft, { indexes: INDEXES })
  const thin: ShareIndexes = { ...INDEXES, pilot: buildShareIndex('pilot', []) }
  const out = ok(decodeLoadout(code, thin))
  assert.equal(out.draft.pilotId, undefined)
  assert.equal(out.draft.mechId, 'mech_052_彌造者')
  assert.deepEqual(out.unresolved, [{ kind: 'pilot', shareId: 88, at: 'header' }])
})

test('推不出號碼的武器編成空格，不讓整套配裝分享不出去', () => {
  const draft: LoadoutDraft = {
    activeSetKey: 'default',
    sets: { default: { mounts: [{ weaponId: '這不是合法的武器 id', bank: 'main', slot: 'back' }] } },
  }
  const out = ok(decodeLoadout(encodeLoadout(draft, { indexes: INDEXES }), INDEXES))
  assert.deepEqual(out.draft.sets.default.mounts, [])
  assert.deepEqual(out.unresolved, [], '編碼時就知道它沒號碼，不是解碼時才發現')
})

test('模組走別名區也能 round-trip（1,500,001 是 3 bytes varint）', () => {
  const draft: LoadoutDraft = { activeSetKey: 'default', sets: {}, modules: { torso: 'mod_4001_2' } }
  const out = ok(decodeLoadout(encodeLoadout(draft, { indexes: INDEXES }), INDEXES))
  assert.deepEqual(out.draft.modules, { torso: 'mod_4001_2' })
})

test('未知 tag 一律跳過並記入 unmodeled —— 舊 client 讀得懂新 client 的碼', () => {
  const draft: LoadoutDraft = { activeSetKey: 'default', sets: {}, pilotId: 'pilot_001_艾達' }
  const bytes = fromBase64Url(encodeLoadout(draft, { indexes: INDEXES }))!
  // 在 checksum 之前插入一段 tag=99 的未知段落
  const head = Array.from(bytes.subarray(0, bytes.length - 1))
  const body = Uint8Array.from([...head, 99, 3, 0xaa, 0xbb, 0xcc])
  const all = Uint8Array.from([...body, checksum8(body)])
  const out = ok(decodeLoadout(toBase64Url(all), INDEXES))
  assert.equal(out.draft.pilotId, 'pilot_001_艾達', '未知段落不可影響認得的內容')
  assert.deepEqual(out.unmodeled, [{ tag: 99, bytes: 3 }])
})

test('已知 tag 但段內多出讀不完的位元組 ⇒ 當作 additive 新欄位記下來，不是錯誤', () => {
  const draft: LoadoutDraft = { activeSetKey: 'default', sets: { default: { mounts: [] } } }
  const bytes = fromBase64Url(encodeLoadout(draft, { indexes: INDEXES }))!
  const head = Array.from(bytes.subarray(0, bytes.length - 1))
  // 把 SETS 段的長度加 2 並補兩個位元組（模擬未來版本在段尾加欄位）
  const tagAt = head.indexOf(TAG.SETS, 4)
  head[tagAt + 1] += 2
  head.splice(tagAt + 2 + (head[tagAt + 1] - 2), 0, 0x77, 0x88)
  const body = Uint8Array.from(head)
  const all = Uint8Array.from([...body, checksum8(body)])
  const out = ok(decodeLoadout(toBase64Url(all), INDEXES))
  assert.equal(out.unmodeled.length, 1)
  assert.equal(out.unmodeled[0].tag, TAG.SETS)
})

// ─── ③ golden fixture（舊版解碼器永不刪除）──────────────────────────────────

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__')

test('③ golden fixture：凍住的代碼字串必須永遠解得回同一份草稿', () => {
  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort()
  assert.ok(files.length > 0, '至少要有一個 FMT 版本的 fixture')

  for (const file of files) {
    const fx = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'))
    const ix: ShareIndexes = {
      pilot: buildShareIndex('pilot', fx.universe.pilot),
      mech: buildShareIndex('mech', fx.universe.mech),
      weapon: buildShareIndex('weapon', fx.universe.weapon),
      component: buildShareIndex('component', fx.universe.component),
      backpack: buildShareIndex('backpack', fx.universe.backpack),
      module: buildShareIndex('module', fx.universe.module, fx.universe.moduleAliases ?? {}),
    }
    for (const c of fx.cases) {
      const res = decodeLoadout(c.code, ix)
      assert.equal(res.ok, true, `${file} / ${c.name}：解不開`)
      assert.deepEqual((res as DecodeOk).draft, c.draft, `${file} / ${c.name}：解出來的草稿變了`)
      // 反向也釘住：同一份草稿必須編回同一串代碼（canonical order 沒有漂移）
      assert.equal(
        encodeLoadout(c.draft, { indexes: ix, gameVersion: c.gameVersion }), c.code,
        `${file} / ${c.name}：編碼結果變了 —— 這會讓同一套配裝產生兩種代碼`,
      )
    }
  }
})

test('③ fixture 的版本號必須與本 client 一致，否則代表有人改了版面卻沒凍新 fixture', () => {
  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'))
  assert.ok(files.includes(`v${FMT_VERSION}.json`), `缺少 v${FMT_VERSION}.json`)
})
