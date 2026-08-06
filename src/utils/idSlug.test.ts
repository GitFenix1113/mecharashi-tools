// PLAN-020 A-1：makeEntityId / slugify 單元測試
// 以 Node 內建測試執行器跑（Node 24 原生 type stripping）：
//   npm test   →   node --test "src/**/*.test.ts"
// 本檔已從 tsconfig.app build 排除，不影響 vite/tsc 打包。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeEntityId, slugify, stripIdPrefix, idPrefixCasings } from './idSlug.ts'

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
