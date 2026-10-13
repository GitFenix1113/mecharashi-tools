// PLAN-042-E A-3：人物檔案純函式
//   node --test src/utils/loreDossier.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dossierFieldCount, dossierRows, duplicateLabels, fromAdditionalInfo, normalizeDossier, unlabeledRows,
} from './loreDossier.ts'

test('dossierRows：固定三欄 → 陣營 → 自訂欄位，順序照陣列', () => {
  const rows = dossierRows({
    dossier: {
      gender: '女', height: '168cm', bloodType: 'O',
      extra: [{ label: '生日', value: '3月2日' }, { label: '出身', value: '北陸' }],
    },
  }, '北陸聯合')
  assert.deepEqual(rows, [
    ['性別', '女'], ['身高', '168cm'], ['血型', 'O'], ['陣營', '北陸聯合'], ['生日', '3月2日'], ['出身', '北陸'],
  ])
})

test('dossierRows：空值、純空白、空標籤一律濾掉；沒有 dossier 時只剩陣營', () => {
  const rows = dossierRows({
    dossier: {
      gender: '', height: '   ', bloodType: undefined,
      extra: [{ label: '', value: '沒有標籤的內容' }, { label: '喜好', value: '' }, { label: ' 興趣 ', value: ' 釣魚 ' }],
    },
  }, '')
  assert.deepEqual(rows, [['興趣', '釣魚']])
  assert.deepEqual(dossierRows(null, '灰燼之子'), [['陣營', '灰燼之子']])
  assert.deepEqual(dossierRows({}, undefined), [])
})

test('dossierRows：▇▇／■■時間 這類塗黑鍵名原樣當標籤', () => {
  const rows = dossierRows({ dossier: { extra: [{ label: '▇▇', value: '不明' }, { label: '■■時間', value: '1999' }] } })
  assert.deepEqual(rows, [['▇▇', '不明'], ['■■時間', '1999']])
})

test('duplicateLabels：trim 後比對，每個重複標籤回傳一次；空標籤不算', () => {
  assert.deepEqual(duplicateLabels([
    { label: '生日' }, { label: ' 生日' }, { label: '生日 ' }, { label: '出身' }, { label: '' }, { label: '' },
  ]), ['生日'])
  assert.deepEqual(duplicateLabels([{ label: '▇▇' }, { label: '■■' }]), [])
  assert.deepEqual(duplicateLabels(undefined), [])
})

test('unlabeledRows：有內容卻沒標籤的列（1 起算）', () => {
  assert.deepEqual(unlabeledRows([
    { label: '生日', value: '3月2日' }, { label: '', value: '孤兒內容' }, { label: ' ', value: '' }, { label: '  ', value: 'x' },
  ]), [2, 4])
})

test('normalizeDossier：trim、丟空列、整份空 → undefined；不排序也不去重', () => {
  assert.deepEqual(normalizeDossier({
    gender: ' 女 ', height: '', extra: [{ label: '', value: '' }, { label: ' 出身', value: '北陸 ' }, { label: '出身', value: '南方' }],
  }), { gender: '女', extra: [{ label: '出身', value: '北陸' }, { label: '出身', value: '南方' }] })
  assert.equal(normalizeDossier({ gender: ' ', extra: [{ label: '', value: '' }] }), undefined)
  assert.equal(normalizeDossier(undefined), undefined)
})

test('dossierFieldCount：有內容的欄位數，不含陣營', () => {
  assert.equal(dossierFieldCount({ gender: '女', bloodType: '', extra: [{ label: 'a', value: '1' }, { label: 'b', value: '' }] }), 2)
  assert.equal(dossierFieldCount(undefined), 0)
})

test('fromAdditionalInfo：照讀到的鍵序轉陣列，含塗黑鍵名；空標籤與非字串值丟掉', () => {
  const map: Record<string, unknown> = { '■■時間': '1999', '生日': '3月2日', ' ▇▇ ': '不明', '': '孤兒', '代號': 7 }
  assert.deepEqual(fromAdditionalInfo(map), [
    { label: '■■時間', value: '1999' }, { label: '生日', value: '3月2日' }, { label: '▇▇', value: '不明' },
  ])
  assert.deepEqual(fromAdditionalInfo(undefined), [])
  assert.deepEqual(fromAdditionalInfo({}), [])
})
