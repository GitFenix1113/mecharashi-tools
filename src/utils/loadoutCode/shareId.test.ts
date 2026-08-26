// PLAN-052-C A-1：shareId 映射的驗收
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這裡的每一條斷言都對應一種「解成別人」的失敗模式，不是為了覆蓋率：
// 分享碼同時是儲存格式（總綱決策二），映射錯掉的症狀是**別人的配裝變成另一把武器**。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toShareId, buildShareIndex, assertNoCollisions, SHARE_ID_MAX, BACKPACK_ID_OFFSET, ALIAS_BASE,
} from './shareId.ts'

// ─── 正常路徑：六種實體（樣本取自 2026-08-25 線上實測的真實 doc id）────────────

test('六種實體都由 doc id 推出流水號，前導零不影響', () => {
  assert.equal(toShareId('pilot', 'pilot_001_葉夫根尼'), 1)
  assert.equal(toShareId('pilot', 'pilot_089_某機師'), 89)
  assert.equal(toShareId('mech', 'mech_090_美杜莎MK2'), 90)
  assert.equal(toShareId('weapon', 'weapon_182_某武器'), 182)
  assert.equal(toShareId('component', 'comp_0001_應元件W_蓬勃'), 1)
  assert.equal(toShareId('component', 'comp_0208_觸元件_警戒'), 208)
  assert.equal(toShareId('module', 'mod_1001'), 1001)
  assert.equal(toShareId('backpack', '60100102'), 100102)
})

test('背包：官方 8 位數字扣掉基底；站內 slug id 不吃', () => {
  assert.equal(toShareId('backpack', '60101706'), 101706)          // 強襲者背包
  assert.equal(toShareId('backpack', '61002705'), 1002705)         // 實測最大值
  assert.equal(toShareId('backpack', 'backpack_威能者背包'), null)  // 全庫唯一一筆 slug id
  assert.equal(toShareId('backpack', '6010102'), null)             // 7 位，不是官方形狀
  assert.equal(toShareId('backpack', '601017060'), null)           // 9 位
  assert.equal(toShareId('backpack', String(BACKPACK_ID_OFFSET)), null)  // 扣完是 0，不發號
})

// ─── 三個「寫錯了也不會報錯」的地雷 ─────────────────────────────────────────

test('地雷①：元件前綴是 comp_ 而不是 component_', () => {
  assert.equal(toShareId('component', 'comp_0042_應元件_憑逸'), 42)
  assert.equal(toShareId('component', 'component_0042_應元件_憑逸'), null)
})

test('地雷②：模組必須全字匹配 —— mod_4001 與 mod_4001_2 不可推出同一個號碼', () => {
  assert.equal(toShareId('module', 'mod_4001'), 4001)
  // 實測 31 筆「Ⅱ 型」模組長這樣；前綴匹配會讓它與 mod_4001 撞號 ⇒ 解成另一個模組
  assert.equal(toShareId('module', 'mod_4001_2'), null)
  assert.equal(toShareId('module', 'mod_迴避_fixed_1'), null)
  assert.equal(toShareId('module', 'sub_mod_出力模組'), null)
})

test('地雷③：大小寫敏感 —— MOD_ 不吃', () => {
  assert.equal(toShareId('module', 'MOD_折光陣列'), null)
  assert.equal(toShareId('weapon', 'WEAPON_001_碎鋼者'), null)
})

// ─── 永不 throw ─────────────────────────────────────────────────────────────

test('推導不出來一律回 null，不 throw —— 資料側隨時會新增形狀例外', () => {
  for (const kind of ['pilot', 'mech', 'weapon', 'component', 'backpack', 'module'] as const) {
    assert.equal(toShareId(kind, undefined), null)
    assert.equal(toShareId(kind, null), null)
    assert.equal(toShareId(kind, ''), null)
    assert.equal(toShareId(kind, '☠️'), null)
    assert.equal(toShareId(kind, 'weapon_'), null)
  }
  assert.equal(toShareId('weapon', 'weapon_0_零號'), null)   // 0 保留給「無此欄位」
})

test('超過 varint 3 bytes 上限的一律不可分享（塞進去會解成另一個實體）', () => {
  assert.equal(toShareId('weapon', `weapon_${SHARE_ID_MAX}_邊界`), SHARE_ID_MAX)
  assert.equal(toShareId('weapon', `weapon_${SHARE_ID_MAX + 1}_越界`), null)
  assert.equal(toShareId('backpack', '99999999'), null)      // 扣完 39,999,999 遠超上限
})

// ─── 索引 ───────────────────────────────────────────────────────────────────

test('buildShareIndex：雙向 round-trip，並列出今天不可分享的文件', () => {
  const idx = buildShareIndex('module', ['mod_1001', 'mod_1002', 'mod_4001_2', 'MOD_折光陣列'])
  assert.equal(idx.size, 2)
  assert.equal(idx.toDocId(1001), 'mod_1001')
  assert.equal(idx.toShareId('mod_1002'), 1002)
  assert.deepEqual([...idx.unshareable], ['mod_4001_2', 'MOD_折光陣列'])
  assert.equal(idx.toShareId('mod_4001_2'), null)
  assert.equal(idx.toDocId(9999), null)                      // 查不到 ⇒ 「已下架裝備 #9999」
})

test('撞號：兩邊都剔除，不先到先贏 —— 靜默取得別人的身分才是最糟的結果', () => {
  const idx = buildShareIndex('weapon', ['weapon_178_甲', 'weapon_178_乙', 'weapon_179_丙'])
  assert.equal(idx.toDocId(178), null)                       // 不是 '甲' 也不是 '乙'
  assert.equal(idx.toShareId('weapon_178_甲'), null)
  assert.equal(idx.toShareId('weapon_178_乙'), null)
  assert.equal(idx.toDocId(179), 'weapon_179_丙')             // 其餘不受影響
  assert.deepEqual(idx.collisions.map((c) => c.shareId), [178])
  assert.deepEqual([...idx.collisions[0].docIds], ['weapon_178_甲', 'weapon_178_乙'])
})

test('同一個 doc id 出現兩次不算撞號（呼叫端傳了重複清單而已）', () => {
  const idx = buildShareIndex('pilot', ['pilot_001_甲', 'pilot_001_甲'])
  assert.equal(idx.toDocId(1), 'pilot_001_甲')
  assert.equal(idx.collisions.length, 0)
})

test('assertNoCollisions：腳本／CI 用的大聲失敗，訊息要指得出是哪兩份文件', () => {
  const clean = buildShareIndex('mech', ['mech_001_甲', 'mech_002_乙'])
  assert.doesNotThrow(() => assertNoCollisions(clean))

  const dirty = buildShareIndex('mech', ['mech_003_丙', 'mech_003_丁'])
  assert.throws(() => assertNoCollisions(dirty), /mech_003_丙 \/ mech_003_丁/)
})

// ─── 實測快照：規則今天真的對得上線上資料 ───────────────────────────────────
//
// 完整對帳由 `scripts/check-share-ids.mjs`（A-1 第二列）跑；這裡固定住的是
// 2026-08-25 線上實測的**可解析率**，讓規則被改壞時測試先擋下來：
//   pilots 89/89・mechs 90/90・weapons 182/182・components 208/208
//   backpacks 180/181（`backpack_威能者背包`）・modules 162/242
test('實測形狀樣本：各集合的代表性 id 都推得出號碼', () => {
  const samples: [Parameters<typeof toShareId>[0], string, number][] = [
    ['pilot', 'pilot_001_葉夫根尼', 1],
    ['mech', 'mech_003_暮色之牙', 3],
    ['mech', 'mech_052_彌造者', 52],
    ['weapon', 'weapon_176_耀星', 176],
    ['weapon', 'weapon_016_藝術突襲EX', 16],
    ['weapon', 'weapon_049_炬塔_LW', 49],
    ['component', 'comp_0080_觸元件W_憑逸', 80],
    ['backpack', '60100104', 100104],
    ['module', 'mod_4032', 4032],
  ]
  for (const [kind, docId, expected] of samples) {
    assert.equal(toShareId(kind, docId), expected, `${kind} ${docId}`)
  }
})

// ─── 別名區（A-1 第二列）─────────────────────────────────────────────────────

test('別名補上推導不出號碼的文件，並且雙向都通', () => {
  const ids = ['mod_4001', 'mod_4001_2', 'mod_凌嘯框架']
  const idx = buildShareIndex('module', ids, { mod_4001_2: 1_500_001, mod_凌嘯框架: 1_500_032 })

  assert.equal(idx.toShareId('mod_4001'), 4001)          // 推導區照舊
  assert.equal(idx.toShareId('mod_4001_2'), 1_500_001)   // 別名區
  assert.equal(idx.toDocId(1_500_032), 'mod_凌嘯框架')
  assert.deepEqual(idx.unshareable, [])
  assert.equal(idx.size, 3)
})

test('推導優先於別名 —— 否則改掉 doc id 的號碼會被別名靜默吸收，lock 檔就抓不到回收', () => {
  // 有人替一份「推得出號碼」的文件也寫了別名：推導值必須贏
  const idx = buildShareIndex('module', ['mod_4001'], { mod_4001: 1_500_999 })
  assert.equal(idx.toShareId('mod_4001'), 4001)
  assert.equal(idx.toDocId(1_500_999), null)
})

test('別名與推導撞號一樣兩邊都剔除 —— 別名區不享有豁免', () => {
  // 手工把別名寫成 4001（落在推導區）就會與 mod_4001 相撞
  const idx = buildShareIndex('module', ['mod_4001', 'mod_4001_2'], { mod_4001_2: 4001 })
  assert.equal(idx.toDocId(4001), null, '撞號的號碼要整個拿掉')
  assert.equal(idx.collisions.length, 1)
  assert.deepEqual([...idx.collisions[0].docIds].sort(), ['mod_4001', 'mod_4001_2'])
})

test('別名指向不存在的文件 ⇒ 記進 staleAliases，但不 throw、也不算 unshareable', () => {
  const idx = buildShareIndex('module', ['mod_4001'], { mod_已刪除的東西: 1_500_500 })
  assert.deepEqual(idx.staleAliases, ['mod_已刪除的東西'])
  assert.deepEqual(idx.unshareable, [])
  assert.equal(idx.toDocId(1_500_500), null, '查不到就是「已下架裝備 #n」')
})

test('別名值超出 varint 上限或非正整數一律當作沒有 —— 不可產生解得開卻指錯的號碼', () => {
  const bad = { a: SHARE_ID_MAX + 1, b: 0, c: -5, d: 1.5, e: NaN }
  const idx = buildShareIndex('module', ['a', 'b', 'c', 'd', 'e'], bad)
  assert.deepEqual(idx.unshareable, ['a', 'b', 'c', 'd', 'e'])
  assert.equal(idx.size, 0)
})

test('ALIAS_BASE 高過所有 kind 的推導上限 —— 背包的百萬級推導值是這個門檻的成因', () => {
  // 實測（2026-08-25）背包最大推導值 1,002,705，模組最大 4,032
  assert.ok(ALIAS_BASE > 1_002_705, '別名區必須高過背包的推導上限')
  assert.ok(ALIAS_BASE < SHARE_ID_MAX, '別名區必須還在 varint 3 bytes 內')
})
