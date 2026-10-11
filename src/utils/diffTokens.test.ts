// 差異高亮 tokenizer 單元測試
// 以 Node 內建測試執行器跑：npm test → node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenizeForDiff } from './diffTokens.ts'

test('不變式：切完接回去等於原字串（不可漏任何字元）', () => {
  for (const s of [
    '裝備電鋸時每移動1格行動後獲得1層[鋒勢|buff_2],單次最多獲得5層',
    'snake_case 與 __雙底線__',
    '提升1.5%傷害，最多20%',
    '[凝勢Ⅲ]（全形括號）與 AP 消耗',
    '表情 😀 與 㐀 擴充區漢字',
    '',
  ]) {
    assert.equal(tokenizeForDiff(s).join(''), s)
  }
})

test('含底線的消歧鍵：括號內的 token 接回去能查到 refs key', () => {
  const t = tokenizeForDiff('獲得[鋒勢|buff_2]')
  const inner = t.slice(t.indexOf('[') + 1, t.indexOf(']')).join('')
  assert.equal(inner, '鋒勢|buff_2')
})

test('既有切法不變：數字（含小數、%）獨立成 token 以便標紅', () => {
  assert.deepEqual(tokenizeForDiff('提升1.5%傷害'), ['提升', '1.5%', '傷害'])
  assert.deepEqual(tokenizeForDiff('[駐陣|skill]'), ['[', '駐陣', '|', 'skill', ']'])
})
