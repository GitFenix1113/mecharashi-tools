// PLAN-020 A-1：makeEntityId / slugify 單元測試
// 以 Node 內建測試執行器跑（Node 24 原生 type stripping）：
//   npm test   →   node --test "src/**/*.test.ts"
// 本檔已從 tsconfig.app build 排除，不影響 vite/tsc 打包。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeEntityId, slugify, stripIdPrefix, idPrefixCasings, findEntityClash,
  stripNumberedIdPrefix, maxEntitySeq, makeNumberedEntityId,
} from './idSlug.ts'

test('一般中文名 → prefix_<name>', () => {
  assert.equal(makeEntityId('buff', '虛粒子形態'), 'buff_虛粒子形態')
  assert.equal(makeEntityId('state', '形態'), 'state_形態')
})

test('保留中英數混合', () => {
  assert.equal(makeEntityId('buff', '凝勢III'), 'buff_凝勢III')
  assert.equal(slugify('EX9強化'), 'EX9強化')
})

test('去除半形空白 / ASCII 標點 / 斜線', () => {
  assert.equal(slugify(' 星  爆 '), '星爆')
  assert.equal(slugify('a/b.c-d!'), 'abcd')
  assert.equal(makeEntityId('buff', '星-爆!'), 'buff_星爆')
})

test('保留全形字元（對齊 safeName 的 ＀-￯ 範圍）', () => {
  assert.equal(slugify('ＡＢＣ１２３'), 'ＡＢＣ１２３')
})

test('空 slug 邊界：清理後無有效字元 → 回傳空字串', () => {
  assert.equal(makeEntityId('buff', '!!!'), '')
  assert.equal(makeEntityId('buff', '   '), '')
  assert.equal(makeEntityId('buff', '///...'), '')
  assert.equal(slugify('@#$%^&*()'), '')
})

test('stripIdPrefix：剝除誤打的前綴（不分大小寫、可重複）', () => {
  assert.equal(stripIdPrefix('buff', 'buff_虛粒子形態'), '虛粒子形態')
  assert.equal(stripIdPrefix('buff', 'BUFF_事不宜遲'), '事不宜遲')
  assert.equal(stripIdPrefix('buff', 'Buff_buff_星爆'), '星爆')
  assert.equal(stripIdPrefix('buff', 'buff__凝勢'), '凝勢')      // 連續底線
  assert.equal(stripIdPrefix('buff', 'buff_ 星爆'), '星爆')      // 前綴後空白
})

test('stripIdPrefix：無底線前綴不誤剝', () => {
  assert.equal(stripIdPrefix('buff', 'buffalo'), 'buffalo')
  assert.equal(stripIdPrefix('buff', '虛粒子形態'), '虛粒子形態')
})

test('makeEntityId：自動消除使用者誤打的前綴（不產生 buff_buff_）', () => {
  assert.equal(makeEntityId('buff', 'buff_虛粒子形態'), 'buff_虛粒子形態')
  assert.equal(makeEntityId('buff', 'BUFF_事不宜遲'), 'buff_事不宜遲')   // 統一小寫前綴
  assert.equal(makeEntityId('buff', 'buff_buff_星爆'), 'buff_星爆')
  assert.equal(makeEntityId('buff', 'buff_'), '')                       // 只有前綴 → 無效
})

// ── 帶流水號的 ID（weapons 慣例：weapon_<3位>_<slug>）────────────────────────
test('stripNumberedIdPrefix：剝除前綴與流水號段', () => {
  assert.equal(stripNumberedIdPrefix('weapon', 'weapon_163_貝奧武夫'), '貝奧武夫')
  assert.equal(stripNumberedIdPrefix('weapon', 'WEAPON_007_千軍'), '千軍')     // 前綴不分大小寫
  assert.equal(stripNumberedIdPrefix('weapon', 'weapon_天燼審判'), '天燼審判')  // 無流水號
  assert.equal(stripNumberedIdPrefix('weapon', '163_貝奧武夫'), '貝奧武夫')     // 前綴漏打
  assert.equal(stripNumberedIdPrefix('weapon', '碎狼牙'), '碎狼牙')             // 乾淨名稱不動
  assert.equal(stripNumberedIdPrefix('weapon', 'HMG-29C'), 'HMG-29C')          // 數字在後不誤剝
})

test('maxEntitySeq：取最大流水號，忽略不合形狀者', () => {
  const ids = ['weapon_001_甲', 'weapon_163_乙', 'weapon_012_丙', '天燼審判', 'weapon_無號', '']
  assert.equal(maxEntitySeq('weapon', ids), 163)
  assert.equal(maxEntitySeq('weapon', []), 0)                    // 空集合 → 0（下一號為 1）
  assert.equal(maxEntitySeq('weapon', ['天燼審判']), 0)          // 全不合形狀 → 0
  assert.equal(maxEntitySeq('weapon', ['WEAPON_170_丁']), 170)   // 大小寫不影響
  assert.equal(maxEntitySeq('comp', ['weapon_999_甲']), 0)       // 別的前綴不算進來
})

test('makeNumberedEntityId：補零到指定位數', () => {
  assert.equal(makeNumberedEntityId('weapon', '天燼審判', 169), 'weapon_169_天燼審判')
  assert.equal(makeNumberedEntityId('weapon', '甲', 7), 'weapon_007_甲')
  assert.equal(makeNumberedEntityId('weapon', '甲', 1234), 'weapon_1234_甲')   // 超過位數不截斷
  assert.equal(makeNumberedEntityId('comp', '乙', 9, 4), 'comp_0009_乙')
})

test('makeNumberedEntityId：誤打完整舊 ID 不會疊加', () => {
  assert.equal(makeNumberedEntityId('weapon', 'weapon_163_貝奧武夫', 169), 'weapon_169_貝奧武夫')
  assert.equal(makeNumberedEntityId('weapon', '  星 爆  ', 5), 'weapon_005_星爆')   // 空白照樣清掉
})

test('makeNumberedEntityId：空 slug 邊界 → 空字串（呼叫端據此擋下）', () => {
  assert.equal(makeNumberedEntityId('weapon', '!!!', 1), '')
  assert.equal(makeNumberedEntityId('weapon', 'weapon_163_', 1), '')
})

// ── PLAN-032 M0：技能庫大小寫撞號防呆 ────────────────────────────────────────
test('idPrefixCasings：產出大小寫前綴變體，原值排首位', () => {
  // 這是本計畫實際踩到的地雷：makeEntityId 只產小寫，但技能庫有 SKILL_ 大寫 134 筆
  assert.deepEqual(idPrefixCasings('skill_故障植入'), ['skill_故障植入', 'SKILL_故障植入'])
  assert.deepEqual(idPrefixCasings('SKILL_態勢優化'), ['SKILL_態勢優化', 'skill_態勢優化'])
})

test('idPrefixCasings：無底線前綴 / 空字串邊界', () => {
  assert.deepEqual(idPrefixCasings('60102405'), ['60102405'])   // 數字 ID（背包/武器）原樣
  assert.deepEqual(idPrefixCasings('_開頭底線'), ['_開頭底線'])  // at === 0，無前綴可換
  assert.deepEqual(idPrefixCasings(''), [])                     // 空 ID 不要產出 ['']
})

test('idPrefixCasings：前綴無字母時不產生重複候選', () => {
  assert.deepEqual(idPrefixCasings('123_x'), ['123_x'])         // 大小寫相同 → 去重後單筆
})

// ── PLAN-032 follow-up 1b：撞名判定同時查 ID 與名稱 ──────────────────────────
//
// 這組測試守的是「後台會不會靜默建出同名第二份」。實測技能庫已經因為只查 ID
// 而長出 5 組大小寫孿生；另有 20 筆 id/name 漂移的 doc，ID 一律推不回來。

type Doc = { id: string; name: string }
const acc = { getId: (d: Doc) => d.id, getName: (d: Doc) => d.name }
const LIB: Doc[] = [
  { id: 'skill_先鋒型態', name: '先鋒形態' },      // 改名後 ID 留舊寫法（實測案例）
  { id: 'skill_ALL IN', name: 'ALL IN' },        // 名稱含空格，slugify 產不出此 ID
  { id: 'SKILL_重擊', name: '重擊' },             // 大寫前綴的歷史遺留
  { id: 'skill_正常', name: '正常' },
]

test('findEntityClash：ID 相符即命中，且不分大小寫', () => {
  assert.equal(findEntityClash(LIB, acc, 'skill_正常', '正常')?.by, 'id')
  // 大小寫孿生：makeEntityId 只產小寫，但庫裡是 SKILL_ 大寫 —— 必須擋下
  const c = findEntityClash(LIB, acc, 'skill_重擊', '重擊')
  assert.equal(c?.by, 'id')
  assert.equal(c?.item.id, 'SKILL_重擊')
})

test('findEntityClash：ID 推不回來時，靠名稱命中（本修正的核心）', () => {
  // 使用者輸入「先鋒形態」→ makeEntityId 產出 skill_先鋒形態，庫裡卻是 skill_先鋒型態
  const c = findEntityClash(LIB, acc, 'skill_先鋒形態', '先鋒形態')
  assert.equal(c?.by, 'name', '只查 ID 的話這裡會放行，建出同名第二份')
  assert.equal(c?.item.id, 'skill_先鋒型態')
})

test('findEntityClash：slugify 剝掉空格/符號的名稱同樣靠名稱擋下', () => {
  // 'ALL IN' → slugify 去空格 → skill_ALLIN，與庫裡的 'skill_ALL IN' 不符
  const c = findEntityClash(LIB, acc, 'skill_ALLIN', 'ALL IN')
  assert.equal(c?.by, 'name')
  assert.equal(c?.item.id, 'skill_ALL IN')
})

test('findEntityClash：名稱比對忽略大小寫與前後空白', () => {
  assert.equal(findEntityClash(LIB, acc, 'skill_x', '  all in  ')?.by, 'name')
})

test('findEntityClash：ID 優先於名稱（訊息才能精確指出是哪份文件）', () => {
  const items: Doc[] = [{ id: 'skill_a', name: 'B' }, { id: 'skill_b', name: 'A' }]
  const c = findEntityClash(items, { getId: (d) => d.id, getName: (d) => d.name }, 'skill_a', 'A')
  assert.equal(c?.by, 'id')
  assert.equal(c?.item.name, 'B')
})

test('findEntityClash：沒撞到回 null；未提供 getName 時退化成只查 ID', () => {
  assert.equal(findEntityClash(LIB, acc, 'skill_全新', '全新'), null)
  // 沒有 getName → 名稱相同也不擋（維持既有行為，供不需要此檢查的呼叫端）
  assert.equal(findEntityClash(LIB, { getId: acc.getId }, 'skill_先鋒形態', '先鋒形態'), null)
})

test('findEntityClash：空 id / 空 name 不誤判', () => {
  const items: Doc[] = [{ id: '', name: '' }, { id: 'skill_x', name: 'X' }]
  const a = { getId: (d: Doc) => d.id, getName: (d: Doc) => d.name }
  assert.equal(findEntityClash(items, a, '', ''), null)     // 兩者皆空 → 不該撞到那筆空 doc
  assert.equal(findEntityClash(items, a, 'skill_x', 'X')?.by, 'id')
})
