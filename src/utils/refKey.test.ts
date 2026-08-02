// PLAN-039 A-1：引用標記消歧鍵單元測試
// 以 Node 內建測試執行器跑：npm test → node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  splitRefKey, displayKeyword, formatRefKey, DISAMBIG_SEP,
  countKeywordOccurrences, rewriteOccurrence,
} from './refKey.ts'
import { detectLeftoverSugar, compileSugar, orderRefsByFirstMention } from './numRefs.ts'

// ─── 核心不變式：舊資料零回歸 ──────────────────────────────────────────────────
// 這組斷言是本計畫的地基。任何一條掛掉，代表全站既有 descriptionRefs 的顯示會改變。

test('無後綴 key 一律原樣回傳（含既有的含 . / 空白 / 全形 key）', () => {
  for (const k of ['駐陣', '凝勢.強化', '虛粒子形態', '固定傷害', 'AP 消耗', '護盾（大）', 'Overdrive']) {
    assert.deepEqual(splitRefKey(k), { display: k })
    assert.equal(displayKeyword(k), k)
  }
})

// ─── 拆解 ────────────────────────────────────────────────────────────────────

test('帶後綴：切出 display 與 disambig', () => {
  assert.deepEqual(splitRefKey('駐陣|skill'), { display: '駐陣', disambig: 'skill' })
  assert.equal(displayKeyword('駐陣|skill'), '駐陣')
})

test('只切第一個分隔符：後綴內的 | 一併歸入 disambig', () => {
  assert.deepEqual(splitRefKey('駐陣|a|b'), { display: '駐陣', disambig: 'a|b' })
  assert.equal(displayKeyword('駐陣|a|b'), '駐陣')
})

test('消歧鍵可為中文', () => {
  assert.deepEqual(splitRefKey('駐陣|技能'), { display: '駐陣', disambig: '技能' })
})

// ─── 退化輸入：display 恆非空 ─────────────────────────────────────────────────
// 空 chip 比露出 [駐陣|skill] 這種內部語法更糟，故兩種退化輸入都歸一化為「無後綴」。

test('空後綴 "駐陣|" 視同無後綴', () => {
  assert.deepEqual(splitRefKey('駐陣|'), { display: '駐陣' })
  assert.equal(displayKeyword('駐陣|'), '駐陣')
})

test('前綴為空 "|skill" → 整串當 display，不剝', () => {
  assert.deepEqual(splitRefKey('|skill'), { display: '|skill' })
  assert.equal(displayKeyword('|skill'), '|skill')
})

test('displayKeyword 對任何非空輸入都不回傳空字串', () => {
  for (const k of ['駐陣', '駐陣|skill', '駐陣|', '|skill', '|', '||']) {
    assert.notEqual(displayKeyword(k), '', `displayKeyword(${JSON.stringify(k)}) 不得為空`)
  }
})

test('空字串輸入不拋錯', () => {
  assert.deepEqual(splitRefKey(''), { display: '' })
})

// ─── 互逆 ────────────────────────────────────────────────────────────────────

test('formatRefKey 與 splitRefKey 互逆', () => {
  for (const [d, s] of [['駐陣', 'skill'], ['駐陣', '技能'], ['凝勢.強化', 'buff']] as const) {
    const key = formatRefKey(d, s)
    assert.deepEqual(splitRefKey(key), { display: d, disambig: s })
  }
  assert.equal(formatRefKey('駐陣'), '駐陣')
  assert.equal(formatRefKey('駐陣', undefined), '駐陣')
})

// ─── 決策二守門：分隔符與數值語法糖不得衝突 ────────────────────────────────────
// 這組測試存在的唯一理由是擋住「把分隔符換成 # 或 $ / %」這個提案。
// 換掉 DISAMBIG_SEP 使其落入 NUM_ATTRS 的 sigil 集合，下面會立刻紅。

test('分隔符不得是任何 NUM_ATTRS 的語法糖 sigil', () => {
  // detectLeftoverSugar 掃的是 [$%#]\d+；用 sep + 數字構成最危險的形狀
  assert.deepEqual(detectLeftoverSugar(`[駐陣${DISAMBIG_SEP}2]`), [],
    `分隔符 ${DISAMBIG_SEP} 被誤判為未代入語法糖 —— 換用 # 就會發生（PLAN-039 決策二）`)
})

test('含消歧後綴的正文不被 compileSugar 改壞', () => {
  const text = '獲得[駐陣]，施放[駐陣|skill]'
  assert.equal(compileSugar(text, ['buff_駐陣', 'skill_駐陣']), text)
})

test('反例存證：若分隔符用 # 會被當成 maxTriggers 語法糖', () => {
  assert.deepEqual(detectLeftoverSugar('[駐陣#2]'), ['#2'])
  assert.equal(compileSugar('[駐陣#2]', ['x', 'buff_駐陣']), '[駐陣<buff_駐陣.maxTriggers>]')
})

// ─── 與引用編號的整合：兩個 key 各自成為獨立引用 ────────────────────────────────

test('orderRefsByFirstMention：同名兩 key 得到兩個獨立編號', () => {
  const refs = {
    駐陣: { refType: 'buff' as const, refId: 'buff_駐陣' },
    '駐陣|skill': { refType: 'skill' as const, refId: 'skill_駐陣' },
  }
  assert.deepEqual(
    orderRefsByFirstMention('獲得[駐陣]，施放[駐陣|skill]', refs),
    ['buff_駐陣', 'skill_駐陣'],
  )
})

// ─── 正文掃描：countKeywordOccurrences（B-2 同名偵測）─────────────────────────

// 真實案例（PLAN-039 C-1）：第一個 [駐陣] 是「可使用指令」＝技能，
// 第二個是「若處於…狀態」＝BUFF。同一段正文、同一個詞、兩種語意。
const 駐陣原文 = '同時裝備大盾和噴火器時,可使用指令[駐陣];行動開始時,若處於[駐陣]狀態,'
  + '使用噴火器對攻擊範圍內所有目標,造成0.5倍傷害;使用噴火器攻擊時,每命中1個目標,獲得1層[戎火]。'

test('countKeywordOccurrences：數完整 key，保留首次出現序', () => {
  assert.deepEqual([...countKeywordOccurrences(駐陣原文)], [['駐陣', 2], ['戎火', 1]])
})

test('countKeywordOccurrences：已消歧的兩個 key 各算 1，不該再被視為重複', () => {
  const done = rewriteOccurrence(駐陣原文, '駐陣', 1, 'skill')
  assert.deepEqual([...countKeywordOccurrences(done)], [['駐陣|skill', 1], ['駐陣', 1], ['戎火', 1]])
})

test('countKeywordOccurrences：無標記正文回空表，不拋錯', () => {
  assert.equal(countKeywordOccurrences('沒有任何標記').size, 0)
  assert.equal(countKeywordOccurrences('').size, 0)
})

test('countKeywordOccurrences：連續呼叫不受正則 lastIndex 污染', () => {
  const a = countKeywordOccurrences(駐陣原文)
  const b = countKeywordOccurrences(駐陣原文)
  assert.deepEqual([...a], [...b])
})

// ─── 正文改寫：rewriteOccurrence（B-3 一鍵拆分）───────────────────────────────

test('rewriteOccurrence：只改指定次序那一處，其餘同名出現不動', () => {
  const out = rewriteOccurrence(駐陣原文, '駐陣', 1, 'skill')
  assert.equal(out,
    '同時裝備大盾和噴火器時,可使用指令[駐陣|skill];行動開始時,若處於[駐陣]狀態,'
    + '使用噴火器對攻擊範圍內所有目標,造成0.5倍傷害;使用噴火器攻擊時,每命中1個目標,獲得1層[戎火]。')
  // 其他 keyword 完全不受影響
  assert.ok(out.includes('[戎火]'))
})

test('rewriteOccurrence：改第 2 次出現', () => {
  assert.equal(rewriteOccurrence('得[A]後再[A]', 'A', 2, 'buff'), '得[A]後再[A|buff]')
})

test('rewriteOccurrence：occurrence 超出出現次數 → 原樣回傳', () => {
  assert.equal(rewriteOccurrence('只有[A]一次', 'A', 2, 'skill'), '只有[A]一次')
  assert.equal(rewriteOccurrence('沒有這個詞', 'A', 1, 'skill'), '沒有這個詞')
})

test('rewriteOccurrence：keyword 含正則特殊字元仍正確（indexOf 而非動態正則）', () => {
  // 既有資料就有 '凝勢.強化' 這種 key；若組動態正則沒跳脫，'.' 會變成任意字元
  assert.equal(rewriteOccurrence('[凝勢.強化]與[凝勢X強化]', '凝勢.強化', 1, 'buff'),
    '[凝勢.強化|buff]與[凝勢X強化]')
  assert.equal(rewriteOccurrence('[護盾（大）]', '護盾（大）', 1, 'buff'), '[護盾（大）|buff]')
})

test('rewriteOccurrence：不誤傷「已帶後綴」的同名出現', () => {
  // [駐陣|skill] 不是 [駐陣]，indexOf('[駐陣]') 不會命中它
  assert.equal(rewriteOccurrence('[駐陣|skill]與[駐陣]', '駐陣', 1, 'buff'), '[駐陣|skill]與[駐陣|buff]')
})

test('rewriteOccurrence 產物可被 splitRefKey 正確拆回', () => {
  const out = rewriteOccurrence(駐陣原文, '駐陣', 1, 'skill')
  const keys = [...countKeywordOccurrences(out).keys()]
  assert.deepEqual(keys.map(splitRefKey), [
    { display: '駐陣', disambig: 'skill' },
    { display: '駐陣' },
    { display: '戎火' },
  ])
})

test('$n 語法糖在消歧後仍對到正確實體', () => {
  const refs = {
    駐陣: { refType: 'buff' as const, refId: 'buff_駐陣' },
    '駐陣|skill': { refType: 'skill' as const, refId: 'skill_駐陣' },
  }
  const text = '獲得[駐陣]可疊加$1層，施放[駐陣|skill]'
  const ordered = orderRefsByFirstMention(text, refs)
  assert.equal(compileSugar(text, ordered), '獲得[駐陣]可疊加<buff_駐陣.maxStack>層，施放[駐陣|skill]')
})
