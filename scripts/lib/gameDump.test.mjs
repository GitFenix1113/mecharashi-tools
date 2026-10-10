import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localDate, parseCsv, preferTexture } from './gameDump.mjs'

test('parseCsv：一般欄位、CRLF、結尾沒換行', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n3,4'), [['a', 'b'], ['1', '2'], ['3', '4']])
})

test('parseCsv：新版擷取工具會替含逗號、引號的欄位加雙引號（舊寫法 split(",") 會切錯）', () => {
  const text = 'name,path\n"Img_a,b","x/""q""/y.png"\nplain,z.png\n'
  assert.deepEqual(parseCsv(text), [['name', 'path'], ['Img_a,b', 'x/"q"/y.png'], ['plain', 'z.png']])
})

test('parseCsv：空欄位保留、空行略過', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,,3\n\n'), [['a', 'b', 'c'], ['1', '', '3']])
})

test('preferTexture：Texture2D 優先於 Sprite（Sprite 是圖集切片，重新打包就變位元組）', () => {
  const sprite = { type: 'Sprite', width: 500, height: 500 }
  const tex = { type: 'Texture2D', width: 340, height: 340 }
  assert.equal(preferTexture([sprite, tex]), tex)
  assert.equal(preferTexture([tex, sprite]), tex)
})

test('preferTexture：同型別取面積大的', () => {
  const a = { type: 'Texture2D', width: 100, height: 100 }
  const b = { type: 'Texture2D', width: 200, height: 100 }
  assert.equal(preferTexture([a, b]), b)
})

test('localDate：本機時區的 YYYY-MM-DD（不是 UTC）', () => {
  assert.equal(localDate(new Date(2026, 9, 11, 0, 30)), '2026-10-11')
})
