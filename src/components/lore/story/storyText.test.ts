// 劇情對白的標記解析（storyText.ts）
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStoryText, storyPlainText } from './storyText.ts'

test('沒有標記：整句一段', () => {
  assert.deepEqual(parseStoryText('別慌，一步步來。'), [{ text: '別慌，一步步來。' }])
})

test('<y> 強調：切成前、中、後三段，中段 em', () => {
  assert.deepEqual(parseStoryText('<y>凱登</y>！他們人太多了！'), [
    { text: '凱登', em: true },
    { text: '！他們人太多了！' },
  ])
  assert.deepEqual(parseStoryText('別慌，<y>黛娜</y>……'), [
    { text: '別慌，' },
    { text: '黛娜', em: true },
    { text: '……' },
  ])
})

test('<c=#rrggbb> 上色：與強調同一種 em（遊戲色配深底，紙色館內看不見）', () => {
  assert.deepEqual(parseStoryText('取得<c=#ffcc99>獵豹徽章</c>'), [
    { text: '取得' },
    { text: '獵豹徽章', em: true },
  ])
})

test('同一句多個標記、換行照留', () => {
  const segs = parseStoryText('<y>A</y>與<c=#f99999>B</c>\n下一行')
  assert.deepEqual(segs.map((s) => s.text), ['A', '與', 'B', '\n下一行'])
  assert.deepEqual(segs.map((s) => !!s.em), [true, false, true, false])
})

test('不認得的角括號只當文字，不吞字', () => {
  assert.deepEqual(parseStoryText('數值 <50 時'), [{ text: '數值 <50 時' }])
  assert.equal(storyPlainText('<y>甲</y><b>乙</b>'), '甲<b>乙</b>')
})
