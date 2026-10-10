// PLAN-055 D-1：BUFF 圖示底色與字形選擇
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buffGlyphKey, buffIconTone } from './buffGlyph.ts'

test('底色由 buffType 推：增益藍、減益／控制紅、狀態／資源紫', () => {
  assert.equal(buffIconTone({ buffType: 'statBoost' }), 'buff')
  assert.equal(buffIconTone({ buffType: 'debuff' }), 'debuff')
  assert.equal(buffIconTone({ buffType: 'control' }), 'debuff')
  assert.equal(buffIconTone({ buffType: 'state' }), 'special')
  assert.equal(buffIconTone({ buffType: 'resource' }), 'special')
})

test('人工覆寫優先：遊戲裡天賦專屬的增益是紫色，buffType 不必跟著改', () => {
  assert.equal(buffIconTone({ buffType: 'statBoost', iconTone: 'special' }), 'special')
})

test('未知 buffType 當特殊（紫）', () => {
  assert.equal(buffIconTone({ buffType: '' }), 'special')
  assert.equal(buffIconTone({ buffType: 'somethingNew' }), 'special')
})

test('字形：該級專屬優先，其次 BUFF 本身；都沒有回 undefined', () => {
  assert.equal(buffGlyphKey({ icon: 'Icon_buff_attack' }), 'Icon_buff_attack')
  assert.equal(buffGlyphKey({ icon: 'Icon_buff_attack' }, { icon: 'Icon_buff_4012' }), 'Icon_buff_4012')
  assert.equal(buffGlyphKey({ icon: 'Icon_buff_attack' }, { icon: '' }), 'Icon_buff_attack')
  assert.equal(buffGlyphKey({ icon: '  ' }), undefined)
  assert.equal(buffGlyphKey({}), undefined)
})
