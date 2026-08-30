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
  FMT_VERSION, TAG, LIMITS, loadoutIdentity,
  type ShareIndexes, type DecodeOk,
} from './codec.ts'
import { CLOUD_CODE_MAX_CHARS } from '../../types/loadout.ts'

// ─── 測試用的實體宇宙（取自 2026-08-25 線上實測的真實 doc id 形狀）──────────

const UNIVERSE = {
  pilot: ['pilot_001_艾達', 'pilot_049_海莉絲', 'pilot_088_曜', 'pilot_022_帕斯卡'],
  mech: ['mech_001_初擊者', 'mech_052_彌造者', 'mech_090_美杜莎MK2'],
  weapon: ['weapon_016_藝術突襲EX', 'weapon_049_炬塔_LW', 'weapon_176_耀星', 'weapon_182_夜燼'],
  component: ['comp_0001_應元件W_蓬勃', 'comp_0080_觸元件W_憑逸', 'comp_0208_觸元件_警戒'],
  backpack: ['60100104', '60101706', '61002705'],
  module: ['mod_4001', 'mod_4032', 'mod_4001_2'],
  // 技能的 doc id 是純名稱，一個號碼都推不出來 ⇒ 全部走別名（PLAN-052-L D-2）
  pilotSkill: ['skill_槍林彈雨', 'skill_一人成軍', 'skill_超導', 'SKILL_彈道收束'],
}

const ALIASES = { mod_4001_2: 1_500_001 }

/** 技能別名。線上是 853 筆由 `check-share-ids.mjs --accept` 續號，這裡取四筆代表 */
const SKILL_ALIASES: Record<string, number> = {
  skill_槍林彈雨: 1_500_010,
  skill_一人成軍: 1_500_011,
  skill_超導: 1_500_012,
  SKILL_彈道收束: 1_500_013,
}

const INDEXES: ShareIndexes = {
  pilot: buildShareIndex('pilot', UNIVERSE.pilot),
  mech: buildShareIndex('mech', UNIVERSE.mech),
  weapon: buildShareIndex('weapon', UNIVERSE.weapon),
  component: buildShareIndex('component', UNIVERSE.component),
  backpack: buildShareIndex('backpack', UNIVERSE.backpack),
  module: buildShareIndex('module', UNIVERSE.module, ALIASES),
  pilotSkill: buildShareIndex('pilotSkill', UNIVERSE.pilotSkill, SKILL_ALIASES),
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
  // 備註（PLAN-052-L C-3）。⚠ 這裡放的必須是**已經清洗過**的字串：codec 不清洗
  //   （那是 reconcile 的事），塞一個含換行尾巴的進去只會測到「codec 沒有幫我 trim」。
  if (chance(0.25)) {
    draft.note = [
      '對空優先',
      '手部留 300 換備用\n背包吃滿',
      'PvE 清場用\n\n手動控 AP',
      '🚀 速攻',
    ][Math.floor(r() * 4)]
  }
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
  // 攜帶技能（PLAN-052-L D-3）。
  // ⚠ 產生**去重後**的清單：codec 的 round-trip 是逐位元的，而重複的 id 在解碼側
  //   會原樣回來（codec 不去重 —— 那是 reconcile 的事），塞重複值只會讓這個測試
  //   在測「產生器有沒有去重」。
  if (chance(0.3)) {
    const n = 1 + Math.floor(r() * 3)
    const carried = [...new Set(Array.from({ length: n }, () => pick(UNIVERSE.pilotSkill)))]
    const skills: NonNullable<LoadoutDraft['skills']> = { carried }
    // 「改」技能今天沒有 UI，但欄位已開 ⇒ round-trip 必須涵蓋它，否則等資料建好了
    // 才發現它編不回來，而那時已經有人存了碼
    if (chance(0.3)) skills.mod = pick(UNIVERSE.pilotSkill)
    draft.skills = skills
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
  // ⚠ 這條**不必**為 §NOTE 重定基準（PLAN-052-L C-3 實測）：加了備註之後隨機最壞
  //   仍只有 291 字元。要重定的是下面 ④ 那條 —— 那裡的備註是刻意灌到 100 碼點上限的。
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

// ─── 元件層（PLAN-052-D D-1）─────────────────────────────────────────────────
//
// 隨機 round-trip（①）本來就會生出帶元件的 mount，但它的產生器**先把元件按號碼排好**
// 才塞進 draft —— 於是「順序會被正規化」這件事在那條測試裡是看不見的。
// 這一段補的是那些**特定形狀**：滿載、主備分離、亂序輸入。

const compIx = INDEXES.component
const byNum = (a: string, b: string) => (compIx.toShareId(a) ?? 0) - (compIx.toShareId(b) ?? 0)
const [C1, C2, C3] = UNIVERSE.component

const roundTrip = (draft: LoadoutDraft): LoadoutDraft => {
  const code = encodeLoadout(draft, { indexes: INDEXES, gameVersion: '3.3' })
  return ok(decodeLoadout(code, INDEXES)).draft
}

test('元件：滿載一把武器（觸 3 ＋ 應 1 ＝ componentLimit 上限）round-trip', () => {
  const trigger = [C1, C2, C3].sort(byNum)
  const draft: LoadoutDraft = {
    activeSetKey: 'default',
    pilotId: UNIVERSE.pilot[0],
    mechId: UNIVERSE.mech[0],
    sets: { default: { mounts: [{
      weaponId: UNIVERSE.weapon[0], bank: 'main', slot: 'dualHand',
      setup: { triggerComponentIds: trigger, effectComponentIds: [C1] },
    }] } },
  }
  assert.deepEqual(roundTrip(draft), draft)
})

test('元件：觸應數量不對稱（只有觸／只有應）各自 round-trip，空的那一條不會冒出來', () => {
  const base = (setup: LoadoutMount['setup']): LoadoutDraft => ({
    activeSetKey: 'default',
    sets: { default: { mounts: [{ weaponId: UNIVERSE.weapon[1], bank: 'main', slot: 'back', setup }] } },
  })
  const onlyTrigger = base({ triggerComponentIds: [C1] })
  const onlyEffect = base({ effectComponentIds: [C2] })
  assert.deepEqual(roundTrip(onlyTrigger), onlyTrigger)
  assert.deepEqual(roundTrip(onlyEffect), onlyEffect)
  // 「欄位不存在」與「空陣列」是兩件事：後者會讓 stripUndefined 之後再也清不掉
  assert.equal(roundTrip(onlyTrigger).sets.default.mounts[0].setup?.effectComponentIds, undefined)
  assert.equal(roundTrip(onlyEffect).sets.default.mounts[0].setup?.triggerComponentIds, undefined)
})

test('元件：主手與備用裝同一把武器、各帶不同元件 ⇒ 落盤之後仍然分離', () => {
  // 總綱決策十二點名的風險：兩段式的 mountKey 會讓「主手左手」與「備用左手」撞成同一個鍵，
  // 兩把武器的元件互相覆蓋。052-B 選擇把 setup **內嵌在 mount 上**，於是根本沒有鍵可撞 ——
  // 這一則就是那個設計在**落盤格式**這一層的證明（codec 是 mount 一筆一筆寫的）。
  const draft: LoadoutDraft = {
    activeSetKey: 'default',
    sets: { default: { mounts: ([
      { weaponId: UNIVERSE.weapon[0], bank: 'backup', slot: 'singleHand', side: 'left', setup: { triggerComponentIds: [C2] } },
      { weaponId: UNIVERSE.weapon[0], bank: 'main', slot: 'singleHand', side: 'left', setup: { triggerComponentIds: [C1] } },
    ] as LoadoutMount[]).sort((a, b) => `${a.bank}:${a.slot}:${a.side}`.localeCompare(`${b.bank}:${b.slot}:${b.side}`)) } },
  }
  const out = roundTrip(draft)
  const main = out.sets.default.mounts.find((m) => m.bank === 'main')
  const backup = out.sets.default.mounts.find((m) => m.bank === 'backup')
  assert.deepEqual(main?.setup?.triggerComponentIds, [C1])
  assert.deepEqual(backup?.setup?.triggerComponentIds, [C2])
})

test('元件：裝配順序不影響代碼 —— 同一組元件恆為同一串（canonical order）', () => {
  // ⚠ encode 會把元件**按號碼排序**。也就是說玩家「先裝 A 再裝 B」與「先裝 B 再裝 A」
  //   產生的是同一串代碼，而解回來的順序由號碼決定、不是當初裝的順序。
  //   那是刻意的：分享碼同時是儲存格式，同一套配裝有兩種碼就等於 canonical order 破功。
  //   要保留玩家的裝配順序，就得放棄這條 —— 兩者不可兼得，這則測試把選擇釘住。
  const mk = (trigger: string[]): LoadoutDraft => ({
    activeSetKey: 'default',
    sets: { default: { mounts: [{
      weaponId: UNIVERSE.weapon[0], bank: 'main', slot: 'dualHand',
      setup: { triggerComponentIds: trigger },
    }] } },
  })
  const asc = [C1, C2].sort(byNum)
  const desc = [...asc].reverse()
  const codeA = encodeLoadout(mk(asc), { indexes: INDEXES, gameVersion: '3.3' })
  const codeB = encodeLoadout(mk(desc), { indexes: INDEXES, gameVersion: '3.3' })
  assert.equal(codeA, codeB, '同一組元件的兩種輸入順序必須產生同一串代碼')
  assert.deepEqual(ok(decodeLoadout(codeB, INDEXES)).draft.sets.default.mounts[0].setup?.triggerComponentIds, asc)
})

test('元件：doc 被刪掉 ⇒ 那一顆進 unresolved，同一把武器上的其他元件照樣留著', () => {
  // 缺號的元件推不出 doc id。整把武器的元件不該一起消失 —— 那會讓「站上少了一顆元件」
  // 變成「我的四顆元件全沒了」。
  const draft: LoadoutDraft = {
    activeSetKey: 'default',
    sets: { default: { mounts: [{
      weaponId: UNIVERSE.weapon[0], bank: 'main', slot: 'dualHand',
      setup: { triggerComponentIds: [C1, C2].sort(byNum) },
    }] } },
  }
  const code = encodeLoadout(draft, { indexes: INDEXES, gameVersion: '3.3' })
  // 只認得其中一顆的世界
  const partial: ShareIndexes = { ...INDEXES, component: buildShareIndex('component', [C1]) }
  const res = ok(decodeLoadout(code, partial))
  assert.deepEqual(res.draft.sets.default.mounts[0].setup?.triggerComponentIds, [C1])
  assert.equal(res.unresolved.filter((u) => u.kind === 'component').length, 1)
})

// ─── §SKILLS（PLAN-052-L D-3）────────────────────────────────────────────────

/** 只有機師與機甲的骨架，給技能那幾條測試用 */
const skillBase: LoadoutDraft = {
  activeSetKey: 'default',
  sets: {},
  pilotId: UNIVERSE.pilot[0],
  mechId: UNIVERSE.mech[0],
}

test('技能：三格 ＋「改」技能 round-trip（號碼全在別名區，3 bytes varint）', () => {
  const draft: LoadoutDraft = {
    ...skillBase,
    skills: { carried: UNIVERSE.pilotSkill.slice(0, 3), mod: UNIVERSE.pilotSkill[3] },
  }
  const res = ok(decodeLoadout(encodeLoadout(draft, { indexes: INDEXES, gameVersion: '3.3' }), INDEXES))
  assert.deepEqual(res.draft.skills, draft.skills)
})

test('技能：只帶一格時不會冒出空的第二、三格（順序即顯示順序）', () => {
  const draft: LoadoutDraft = { ...skillBase, skills: { carried: [UNIVERSE.pilotSkill[1]] } }
  const res = ok(decodeLoadout(encodeLoadout(draft, { indexes: INDEXES, gameVersion: '3.3' }), INDEXES))
  assert.deepEqual(res.draft.skills, { carried: [UNIVERSE.pilotSkill[1]] })
  assert.equal('mod' in (res.draft.skills ?? {}), false, '沒有「改」技能時不可以生出一個 mod 鍵')
})

test('技能：順序照原樣保留 —— 三格是有序的，不可以像元件那樣排序', () => {
  // 元件走 canonical order（同一組元件恆為同一串），技能**不可以**：
  // 玩家排的順序就是他要的順序，重排等於默默改了他的配裝。
  const a = [UNIVERSE.pilotSkill[2], UNIVERSE.pilotSkill[0], UNIVERSE.pilotSkill[1]]
  const res = ok(decodeLoadout(
    encodeLoadout({ ...skillBase, skills: { carried: a } }, { indexes: INDEXES, gameVersion: '3.3' }),
    INDEXES,
  ))
  assert.deepEqual(res.draft.skills?.carried, a)
})

test('技能：沒帶技能的草稿完全不產生 §SKILLS 段（既有的碼一個位元都不變）', () => {
  const opts = { indexes: INDEXES, gameVersion: '3.3' }
  const bare = encodeLoadout(skillBase, opts)
  const empty = encodeLoadout({ ...skillBase, skills: { carried: [] } }, opts)
  assert.equal(empty, bare, '空的 carried 不可以生出一個段落 —— 那會讓每一份舊碼變長')
  const res = ok(decodeLoadout(bare, INDEXES))
  assert.equal('skills' in res.draft, false, '沒有段落就不該有欄位（未設定＝欄位不存在）')
})

test('技能：號碼查不到 ⇒ 那一格進 unresolved，其餘兩格照樣留著', () => {
  const draft: LoadoutDraft = { ...skillBase, skills: { carried: UNIVERSE.pilotSkill.slice(0, 3) } }
  const code = encodeLoadout(draft, { indexes: INDEXES, gameVersion: '3.3' })
  // 只認得其中兩個的世界（技能被下架／登錄簿還沒同步）
  const partial: ShareIndexes = {
    ...INDEXES,
    pilotSkill: buildShareIndex(
      'pilotSkill', UNIVERSE.pilotSkill.slice(0, 2),
      { [UNIVERSE.pilotSkill[0]]: SKILL_ALIASES[UNIVERSE.pilotSkill[0]], [UNIVERSE.pilotSkill[1]]: SKILL_ALIASES[UNIVERSE.pilotSkill[1]] },
    ),
  }
  const res = ok(decodeLoadout(code, partial))
  assert.deepEqual(res.draft.skills?.carried, UNIVERSE.pilotSkill.slice(0, 2))
  assert.equal(res.unresolved.filter((u) => u.kind === 'pilotSkill').length, 1)
})

test('技能：段落上限擋得住宣告一萬格的代碼（炸彈引信，不是遊戲規則）', () => {
  const bomb = new Uint8Array([
    FMT_VERSION, 0, 0, 0,
    TAG.SKILLS, 3, 0xff, 0xff, 0x7f,   // len=3、NCARRIED = 2,097,151
  ])
  const body = Uint8Array.from([...bomb, checksum8(bomb)])
  const res = decodeLoadout(toBase64Url(body), INDEXES)
  assert.equal(res.ok, false)
  assert.equal(res.ok ? '' : res.reason, 'too-many-items')
})

test('⚠ 技能不同的兩串碼，識別鍵必須不同 —— 技能是配裝的一部分，不是標籤', () => {
  // §NAME／§NOTE 被剝掉是因為它們不改變「這一套會怎麼打」。技能會，所以它必須留在鍵裡。
  // 剝掉的症狀：換三個技能存進書架，會就地覆蓋掉原本那一套。
  const opts = { indexes: INDEXES, gameVersion: '3.3' }
  const a = encodeLoadout({ ...skillBase, skills: { carried: [UNIVERSE.pilotSkill[0]] } }, opts)
  const b = encodeLoadout({ ...skillBase, skills: { carried: [UNIVERSE.pilotSkill[1]] } }, opts)
  assert.notEqual(loadoutIdentity(a), loadoutIdentity(b))
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
      // ⚠ 舊 fixture 沒有這兩個欄位 ⇒ 空索引。那是對的：它們是 §SKILLS 出現**之前**
      //   凍下來的碼，本來就不含技能，而空索引正好證明解碼器不會憑空生出一個。
      pilotSkill: buildShareIndex(
        'pilotSkill', fx.universe.pilotSkill ?? [], fx.universe.pilotSkillAliases ?? {},
      ),
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

// ─── ④ 雲端存檔的碼長上限（PLAN-052-E B-4）──────────────────────────────────
//
// 這一段守的不是 codec 而是 **firestore.rules**：規則裡有一條 `size() <= 4096`，
// 而規則語言讀不到 TS 常數，兩個數字只能手動同步。上限**只能放寬不能收緊**
// （收緊會讓已經存進去的存檔存不回去，症狀是「這一套存不了、別的可以」），
// 所以這裡把「最壞情況要塞得下」釘成常駐測試：日後有人加段落把碼撐大，先紅在這裡，
// 而不是等某個玩家存不了他的配裝。

/** 造一組「號碼吃滿 3 bytes varint」的索引 —— shareId 的極限就是 varint 的極限。 */
function maxIndexes(): { indexes: ShareIndexes; ids: Record<string, string[]> } {
  const MAXID = 2_097_151   // SHARE_ID_MAX
  const ids = {
    pilot: [`pilot_${MAXID}_極`],
    mech: [`mech_${MAXID}_極`],
    weapon: Array.from({ length: 7 }, (_, i) => `weapon_${MAXID - i}_極`),
    component: Array.from({ length: 4 }, (_, i) => `comp_${MAXID - i}_極`),
    backpack: [`${60_000_000 + MAXID}`],
    module: Array.from({ length: 4 }, (_, i) => `mod_${MAXID - i}`),
    // 三格 ＋ 一格「改」＝ 4 個號碼，全部吃滿 3 bytes varint（PLAN-052-L D-3）
    pilotSkill: Array.from({ length: 4 }, (_, i) => `skill_極${i}`),
  }
  return {
    ids,
    indexes: {
      pilot: buildShareIndex('pilot', ids.pilot),
      mech: buildShareIndex('mech', ids.mech),
      weapon: buildShareIndex('weapon', ids.weapon),
      component: buildShareIndex('component', ids.component),
      backpack: buildShareIndex('backpack', ids.backpack),
      module: buildShareIndex('module', ids.module),
      // 技能推不出號碼 ⇒ 別名，且刻意取滿 3 bytes 的值（見上方 ids.pilotSkill）
      pilotSkill: buildShareIndex(
        'pilotSkill', ids.pilotSkill,
        Object.fromEntries(ids.pilotSkill.map((id, i) => [id, MAXID - i])),
      ),
    },
  }
}

/**
 * **滿載**草稿：`n` 套形態 × 7 個 mount（雙手 2 ＋ 雙肩 2 ＋ 背 1 ＋ 備用 2）
 * × 4 個元件（`componentLimit` 上限）＋ 背包 ＋ 4 部件 ＋ 4 模組 ＋ 4 分區算力
 * ＋ 24 碼點名稱 ＋ 100 碼點備註。
 *
 * ⚠ 隨機產生器（① round-trip）**測不到這個**：它每個欄位都只有 20–50% 機率出現，
 *   一萬份裡不會湊出「全部欄位同時吃滿」的那一份。上限必須刻意造。
 */
function maxDraft(ids: Record<string, string[]>, setKeys: string[], name: string, note: string): LoadoutDraft {
  const SLOTS: Array<Pick<LoadoutMount, 'slot' | 'side' | 'bank'>> = [
    { slot: 'singleHand', side: 'left', bank: 'main' },
    { slot: 'singleHand', side: 'right', bank: 'main' },
    { slot: 'shoulder', side: 'left', bank: 'main' },
    { slot: 'shoulder', side: 'right', bank: 'main' },
    { slot: 'back', bank: 'main' },
    { slot: 'singleHand', side: 'left', bank: 'backup' },
    { slot: 'singleHand', side: 'right', bank: 'backup' },
  ]
  const sets: Record<string, EquipSet> = {}
  for (const key of setKeys) {
    const mounts: LoadoutMount[] = SLOTS.map((s, i) => ({
      weaponId: ids.weapon[i % ids.weapon.length],
      bank: s.bank,
      slot: s.slot,
      ...(s.side ? { side: s.side } : {}),
      setup: {
        triggerComponentIds: [ids.component[0], ids.component[1], ids.component[2]],
        effectComponentIds: [ids.component[3]],
      },
    }))
    mounts.sort((a, b) => {
      const k = (m: LoadoutMount) => (m.side ? `${m.bank}:${m.slot}:${m.side}` : `${m.bank}:${m.slot}`)
      return k(a).localeCompare(k(b))
    })
    sets[key] = { mounts, backpackId: ids.backpack[0] }
  }
  return {
    activeSetKey: setKeys[0],
    sets,
    pilotId: ids.pilot[0],
    mechId: ids.mech[0],
    name,
    note,
    ndLevels: { 'γ1': 24, 'γ2': 24, 'α': 24, 'β': 24 },
    parts: { torso: ids.mech[0], leftArm: ids.mech[0], rightArm: ids.mech[0], legs: ids.mech[0] },
    modules: { torso: ids.module[0], leftArm: ids.module[1], rightArm: ids.module[2], legs: ids.module[3] },
    // 三格全滿 ＋「改」技能（PLAN-052-L D-3）。號碼全吃滿 3 bytes ⇒ 這一段約 +14 bytes
    skills: { carried: ids.pilotSkill.slice(0, 3), mod: ids.pilotSkill[3] },
  } as LoadoutDraft
}

test('④ 雲端上限與 codec 的解碼上限必須是同一個數字', () => {
  // 不一致就會生出一段「解得開卻存不了」的落差 —— 那一段裡的配裝，
  // 使用者看得到、貼得出去、就是存不進雲端書架，而且沒有任何訊息說得出為什麼。
  assert.equal(
    CLOUD_CODE_MAX_CHARS, LIMITS.codeChars,
    'firestore.rules 的 size() 上限與 codec 的 codeChars 脫鉤了 —— 兩邊要一起改',
  )
})

test('④ 最壞情況的代碼必須塞得進雲端的一格（含未來多一套形態的餘裕）', () => {
  const max = maxIndexes()
  const emoji = '🚀'.repeat(24)          // 24 碼點 × 4 bytes ＝ 名稱的位元組上限
  // 100 碼點 × 4 bytes ＝ 備註的位元組上限（PLAN-052-L C-3）。
  // ⚠ 這一項是 052-L 加進來的，下面兩條長度門檻因此**有意識地重定過基準**——
  //   它們破掉不代表 bug，代表版面又長了一段，要重新確認上限撐不撐得住。
  const noteMax = '🚀'.repeat(100)
  const keys = (n: number) => Array.from({ length: n }, (_, i) => 'form_' + '極'.repeat(19) + i)

  // 今天的最壞：海莉絲 3 套獨立形態
  const c3 = encodeLoadout(maxDraft(max.ids, keys(3), emoji, noteMax), { indexes: max.indexes, gameVersion: '3.3' })
  assert.ok(
    c3.length <= CLOUD_CODE_MAX_CHARS,
    `3 套形態的最壞碼長 ${c3.length} 已超過雲端單格上限 ${CLOUD_CODE_MAX_CHARS}`,
  )
  assert.equal(decodeLoadout(c3, max.indexes).ok, true, '最壞碼自己要解得開')

  // 餘裕：每多一套形態約 +200 字元（號碼全滿時）。官方哪天多給兩套也要活得下來，
  // 因為上限只能放寬不能收緊，而放寬的那一刻已經有人存不進去了。
  const c5 = encodeLoadout(maxDraft(max.ids, keys(5), emoji, noteMax), { indexes: max.indexes, gameVersion: '3.3' })
  assert.ok(
    c5.length <= CLOUD_CODE_MAX_CHARS,
    `5 套形態的最壞碼長 ${c5.length} 超過上限 ${CLOUD_CODE_MAX_CHARS} —— 上限不夠用，放寬它（不可收緊）`,
  )

  // 把實測值釘住：日後 codec 加段落讓它逼近上限時，這一條會先說話
  // 基準重定於 PLAN-052-L C-3（加了 §NOTE，最壞備註 100 碼點的四位元組 emoji ≈ +540 字元）。
  // 實測：3 套 1010 → **1550**、5 套 1530 → **2070**。門檻取 1950／2450 留餘裕。
  // ⚠ 5 套的最壞已經越過 Discord 的 2000 字元上限 —— 那是**理論最壞**（號碼全滿 ＋
  //   四位元組 emoji 填滿名稱與備註 ＋ 五套形態），今天不存在（真實最壞是海莉絲 3 套 = 1550）。
  //   但它說明一件事：備註從此是這串碼裡最大的一塊，日後要再加段落前先量這裡。
  assert.ok(
    c3.length < 1950 && c5.length < 2450,
    `碼長比 PLAN-052-L C-3 重定基準時大幅膨脹（3 套 ${c3.length}、5 套 ${c5.length}）——`
    + 'codec 又加了新段落嗎？確認雲端上限與 Discord 的 2000 字元上限都還撐得住',
  )
})

// ─── 識別鍵（PLAN-052-L C-6）────────────────────────────────────────────────
//
// 「同一套配裝」的定義。錯的方向有兩個，而兩個都不會報錯：
//   · 太寬 ⇒ 兩套不同的配裝撞成同一個鍵 ⇒ 存第二套時就地覆蓋掉第一套
//   · 太窄 ⇒「只改了備註」被當成新的一套 ⇒ 佔掉第二格，而「已在雲端」徽章翻假

test('只差備註的兩串碼，識別鍵相同（C-6 存在的全部理由）', () => {
  const base: LoadoutDraft = {
    activeSetKey: 'default',
    sets: { default: { mounts: [{ weaponId: UNIVERSE.weapon[0], bank: 'main', slot: 'dualHand' }] } },
    pilotId: UNIVERSE.pilot[0],
    mechId: UNIVERSE.mech[0],
  }
  const opts = { indexes: INDEXES, gameVersion: '3.3' }
  const a = encodeLoadout(base, opts)
  const b = encodeLoadout({ ...base, note: '對空優先' }, opts)
  const c = encodeLoadout({ ...base, note: '改成打地面' }, opts)
  assert.notEqual(a, b, '前提：加了備註本來就是另一串碼')
  assert.equal(loadoutIdentity(a), loadoutIdentity(b))
  assert.equal(loadoutIdentity(b), loadoutIdentity(c))
})

test('只差方案名稱的兩串碼，識別鍵也相同（名稱是標籤，不是配裝）', () => {
  const base: LoadoutDraft = {
    activeSetKey: 'default', sets: {}, pilotId: UNIVERSE.pilot[1],
  }
  const opts = { indexes: INDEXES, gameVersion: '3.3' }
  const a = encodeLoadout({ ...base, name: '方案 A' }, opts)
  const b = encodeLoadout({ ...base, name: '方案 B', note: '換個說法' }, opts)
  assert.equal(loadoutIdentity(a), loadoutIdentity(b))
})

test('只差遊戲版本提示的兩串碼，識別鍵相同（那記的是「哪一版做的」，不是裝了什麼）', () => {
  const draft: LoadoutDraft = { activeSetKey: 'default', sets: {}, mechId: UNIVERSE.mech[2] }
  const a = encodeLoadout(draft, { indexes: INDEXES, gameVersion: '3.2' })
  const b = encodeLoadout(draft, { indexes: INDEXES, gameVersion: '3.3' })
  assert.notEqual(a, b)
  assert.equal(loadoutIdentity(a), loadoutIdentity(b))
})

test('⚠ 裝備真的不一樣時，識別鍵必須不同（太寬會就地覆蓋掉別人存的那一套）', () => {
  const opts = { indexes: INDEXES, gameVersion: '3.3' }
  const one = encodeLoadout({
    activeSetKey: 'default',
    sets: { default: { mounts: [{ weaponId: UNIVERSE.weapon[0], bank: 'main', slot: 'dualHand' }] } },
    note: '同一則備註',
  }, opts)
  const two = encodeLoadout({
    activeSetKey: 'default',
    sets: { default: { mounts: [{ weaponId: UNIVERSE.weapon[1], bank: 'main', slot: 'back' }] } },
    note: '同一則備註',
  }, opts)
  assert.notEqual(loadoutIdentity(one), loadoutIdentity(two))
})

test('未知段落要保留在識別鍵裡 —— 那是別的 client 加的配裝資料', () => {
  // 手工造一串「header ＋ 一段未知 tag 99」的碼，兩串只差那一段的內容
  const mk = (payload: number[]) => {
    const body = Uint8Array.from([1, 33, 0, 0, 99, payload.length, ...payload])
    return toBase64Url(Uint8Array.from([...body, checksum8(body)]))
  }
  assert.notEqual(loadoutIdentity(mk([1, 2])), loadoutIdentity(mk([3, 4])))
})

test('解不開時回 null（呼叫端退回比對原字串，那是改寫前的行為）', () => {
  assert.equal(loadoutIdentity(''), null)
  assert.equal(loadoutIdentity('!!!not base64!!!'), null)
  assert.equal(loadoutIdentity('AQ'), null, '比 header 還短')
})

test('識別鍵吃得下網址與被換行截斷的輸入（與 cleanCodeInput 同一條入口）', () => {
  const code = encodeLoadout(
    { activeSetKey: 'default', sets: {}, pilotId: UNIVERSE.pilot[0], note: '甲' },
    { indexes: INDEXES, gameVersion: '3.3' },
  )
  assert.equal(loadoutIdentity(`https://mecharashi.wiki/simulator?b=${code}`), loadoutIdentity(code))
})

test('識別鍵不是代碼：拿去解碼一定失敗（它沒有 checksum）', () => {
  const code = encodeLoadout(
    { activeSetKey: 'default', sets: {}, pilotId: UNIVERSE.pilot[0] },
    { indexes: INDEXES, gameVersion: '3.3' },
  )
  const id = loadoutIdentity(code)!
  assert.notEqual(id, code)
  assert.equal(decodeLoadout(id, INDEXES).ok, false, '識別鍵只用來比對，不可以被當成代碼存起來')
})

// ─── §TALENT：潛能等級（PLAN-052-N C-2）────────────────────────────────────

test('§TALENT：0–4 潛能 round-trip', () => {
  for (const potential of [0, 1, 2, 3, 4]) {
    const draft: LoadoutDraft = {
      activeSetKey: 'default',
      pilotId: UNIVERSE.pilot[0],
      mechId: UNIVERSE.mech[0],
      sets: { default: { mounts: [] } },
      potential,
    }
    assert.deepEqual(roundTrip(draft), draft, `潛能 ${potential}`)
  }
})

test('§TALENT：滿潛與未設定編出來的碼**完全相同**（滿潛不寫任何位元組）', () => {
  const base: LoadoutDraft = {
    activeSetKey: 'default',
    pilotId: UNIVERSE.pilot[0],
    mechId: UNIVERSE.mech[0],
    sets: { default: { mounts: [] } },
  }
  const opts = { indexes: INDEXES, gameVersion: '3.3' } as const
  assert.equal(
    encodeLoadout({ ...base, potential: 5 }, opts),
    encodeLoadout(base, opts),
    '滿潛是預設值 ⇒ 絕大多數的碼長度不受本段影響',
  )
  // 解回來也不該冒出一個 potential 欄位
  assert.equal('potential' in roundTrip(base), false)
  assert.equal('potential' in roundTrip({ ...base, potential: 5 }), false)
})

test('§TALENT：追加段不影響既有的碼 —— 不帶潛能的草稿位元組數不變', () => {
  const draft: LoadoutDraft = {
    activeSetKey: 'default',
    pilotId: UNIVERSE.pilot[0],
    mechId: UNIVERSE.mech[0],
    sets: { default: { mounts: [{ weaponId: UNIVERSE.weapon[0], bank: 'main', slot: 'dualHand' }] } },
  }
  const withP = encodeLoadout({ ...draft, potential: 2 }, { indexes: INDEXES, gameVersion: '3.3' })
  const without = encodeLoadout(draft, { indexes: INDEXES, gameVersion: '3.3' })
  assert.ok(withP.length > without.length, '帶了潛能才會多出那一段')
  // 舊碼（不含 §TALENT）照樣解得開，且沒有 unmodeled
  const dec = ok(decodeLoadout(without, INDEXES))
  assert.deepEqual(dec.unmodeled, [])
  assert.equal('potential' in dec.draft, false)
})
