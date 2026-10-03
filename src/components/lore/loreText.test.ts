// PLAN-042-A C-3：loreText 純函式單元測試
// 以 Node 內建測試執行器跑：npm test → node --test "src/**/*.test.ts"
// ⚠ 值匯入必須帶 `.ts` 副檔名：node 的 ESM 解析不補副檔名，漏了 tsc 全綠而 npm test 直接
//   ERR_MODULE_NOT_FOUND（全站測試檔慣例同此）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitParagraphs, isQuoteStyle, firstSentence, stripTrailingSource } from './loreText.ts'

// ── splitParagraphs ──────────────────────────────────────────────────────────

test('splitParagraphs：單一 \\n 分段（lore 實測的唯一形式）', () => {
  assert.deepEqual(splitParagraphs('第一段\n第二段\n第三段'), ['第一段', '第二段', '第三段'])
})

test('splitParagraphs：\\n\\n 與行尾空白不產生空段', () => {
  assert.deepEqual(splitParagraphs('第一段\n\n第二段  \n   \n\r\n第三段'), ['第一段', '第二段', '第三段'])
})

test('splitParagraphs：undefined / 空字串 → 空陣列', () => {
  assert.deepEqual(splitParagraphs(undefined), [])
  assert.deepEqual(splitParagraphs(''), [])
  assert.deepEqual(splitParagraphs('   \n  '), [])
})

// ── isQuoteStyle ─────────────────────────────────────────────────────────────

test('isQuoteStyle：四種起首引號都成立', () => {
  assert.equal(isQuoteStyle('「我從不後悔。」'), true)
  assert.equal(isQuoteStyle('『那一天的事，誰也沒提。』'), true)
  assert.equal(isQuoteStyle('"Roger that."'), true)
  assert.equal(isQuoteStyle('“Roger that.”'), true)
})

test('isQuoteStyle：前導空白先 trim 再看首字', () => {
  assert.equal(isQuoteStyle('   「有空白也算引文」'), true)
})

test('isQuoteStyle：一般敘述與空值為 false', () => {
  assert.equal(isQuoteStyle('那年冬天，米赫瑪下了第一場雪。'), false)
  assert.equal(isQuoteStyle('他說：「別回頭。」'), false) // 引號不在段首 → 不套 blockquote
  assert.equal(isQuoteStyle(undefined), false)
  assert.equal(isQuoteStyle(''), false)
})

// ── firstSentence ────────────────────────────────────────────────────────────

test('firstSentence：切在第一個 。！？（含標點本身）', () => {
  assert.equal(firstSentence('第一句。第二句。'), '第一句。')
  assert.equal(firstSentence('真的嗎？我不信。'), '真的嗎？')
  assert.equal(firstSentence('別動！他低聲說。'), '別動！')
})

test('firstSentence：句末標點後緊跟的收尾引號一併帶走', () => {
  assert.equal(firstSentence('「別回頭。」他說。'), '「別回頭。」')
})

test('firstSentence：整段沒有句末標點 → 截 max 字並補 …', () => {
  const long = '零'.repeat(80)
  assert.equal(firstSentence(long), `${'零'.repeat(60)}…`)
  assert.equal(firstSentence(long, 10), `${'零'.repeat(10)}…`)
  assert.equal(firstSentence('短句沒有句號'), '短句沒有句號') // 未超過 max → 不補 …
})

test('firstSentence：undefined / 空白 → 空字串', () => {
  assert.equal(firstSentence(undefined), '')
  assert.equal(firstSentence('   '), '')
})

// ── stripTrailingSource ──────────────────────────────────────────────────────

test('stripTrailingSource：—— / 一一 / -- 三種記號都切得掉（正文與 source 記號不同也成立）', () => {
  const src = '——《週刊米赫瑪·文娛版》'
  assert.equal(stripTrailingSource('她始終沒有回頭。——《週刊米赫瑪·文娛版》', src), '她始終沒有回頭。')
  // 尼爾／黑障：正文是 OCR 壞掉的記號，source 已正規化成 ——，endsWith 對這兩筆為 false
  assert.equal(stripTrailingSource('她始終沒有回頭。一一《週刊米赫瑪·文娛版》', src), '她始終沒有回頭。')
  assert.equal(stripTrailingSource('她始終沒有回頭。--《週刊米赫瑪·文娛版》', src), '她始終沒有回頭。')
  assert.equal(stripTrailingSource('她始終沒有回頭。──《週刊米赫瑪·文娛版》', src), '她始終沒有回頭。')
  assert.equal(stripTrailingSource('她始終沒有回頭。–《週刊米赫瑪·文娛版》', src), '她始終沒有回頭。')
})

test('stripTrailingSource：尾段超過 40 字 → 判定為正文，不切', () => {
  const body = `前段。——${'長'.repeat(45)}`
  assert.equal(stripTrailingSource(body, '——出處'), body)
})

test('stripTrailingSource：切最後一個記號（正文中段的破折號不受影響）', () => {
  assert.equal(
    stripTrailingSource('他停頓了很久——久到雪都停了。——《戰地手記》', '——《戰地手記》'),
    '他停頓了很久——久到雪都停了。',
  )
})

test('stripTrailingSource：source 未登記時原樣回傳（沒有署名就沒有東西該被切）', () => {
  const body = '他停頓了很久——久到雪都停了。'
  assert.equal(stripTrailingSource(body, undefined), body)
  assert.equal(stripTrailingSource(body, '   '), body)
})

test('stripTrailingSource：記號在開頭 → 不切（切完會變空字串）', () => {
  assert.equal(stripTrailingSource('——《週刊》', '——《週刊》'), '——《週刊》')
})

test('stripTrailingSource：undefined → 空字串；連續呼叫不受 regex lastIndex 影響', () => {
  assert.equal(stripTrailingSource(undefined, '——出處'), '')
  const body = '她始終沒有回頭。——《週刊米赫瑪·文娛版》'
  assert.equal(stripTrailingSource(body, '——出處'), '她始終沒有回頭。')
  assert.equal(stripTrailingSource(body, '——出處'), '她始終沒有回頭。')
})
