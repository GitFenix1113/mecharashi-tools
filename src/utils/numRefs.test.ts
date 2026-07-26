// PLAN-022 A-2：numRefs 數值引用層單元測試
// 以 Node 內建測試執行器跑（Node 24 原生 type stripping）：
//   npm test   →   node --test "src/**/*.test.ts"
// 本檔已從 tsconfig.app build 排除（exclude: src/**/*.test.ts），不影響 vite/tsc 打包。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NUM_ATTRS,
  hasNumRef,
  parseNumRefs,
  resolveNumValue,
  resolveNumRefs,
  orderRefsByFirstMention,
  compileSugar,
  detectLeftoverSugar,
  freezeNumRefs,
} from './numRefs.ts'
import type { NumRefSource, NumLevelOf } from './numRefs.ts'

// 模擬 GameDataContext 的 buff 查詢
const BUFFS: Record<string, NumRefSource> = {
  buff_凝勢I: { maxStack: 5, duration: 2 },
  buff_凝勢II: { maxStack: 7, duration: 3 },
  buff_凝勢III: { maxStack: 7 }, // 無 duration
  buff_星爆: { maxStack: 3 },
  // PLAN-024 階梯 buff：各級收進 levels[]（凝勢 5/7/7、lv3 無 duration）
  // PLAN-034 B-3：levels 元素自帶 level 值，取級改以值比對而非索引
  buff_凝勢: { levels: [
    { level: 1, maxStack: 5, duration: 2 },
    { level: 2, maxStack: 7, duration: 3 },
    { level: 3, maxStack: 7 },
  ] },
  // 非連號 levels（實測 buff_迴避率提升 就是 [3,4]）：索引式取級在此必錯
  buff_迴避率提升: { levels: [{ level: 3, maxStack: 3 }, { level: 4, maxStack: 4 }] },
}
const lookup = (refId: string) => BUFFS[refId]

// [xxx] → 引用對照（DescriptionRefs 形狀）
const refs = {
  凝勢I: { refType: 'buff', refId: 'buff_凝勢I' },
  星爆: { refType: 'buff', refId: 'buff_星爆' },
}

// ─── registry ────────────────────────────────────────────────────────────────

test('NUM_ATTRS：maxStack / duration / maxTriggers sigil 不重複', () => {
  assert.equal(NUM_ATTRS.maxStack.sigil, '$')
  assert.equal(NUM_ATTRS.duration.sigil, '%')
  assert.equal(NUM_ATTRS.maxTriggers.sigil, '#')
  const sigils = Object.values(NUM_ATTRS).map((d) => d.sigil)
  assert.equal(new Set(sigils).size, sigils.length)
})

test('maxTriggers：語法糖 #n → token，解析回真值', () => {
  assert.equal(NUM_ATTRS.maxTriggers.get({ maxTriggers: 3 }), 3)
  assert.equal(compileSugar('可生效#1次', ['buff_自動模組']), '可生效<buff_自動模組.maxTriggers>次')
  const triggerLookup = (id: string) => (id === 'buff_自動模組' ? { maxTriggers: 3 } : undefined)
  assert.equal(resolveNumRefs('可生效<buff_自動模組.maxTriggers>次', triggerLookup), '可生效3次')
  assert.deepEqual(detectLeftoverSugar('可生效#2次'), ['#2'])
})

test('hasNumRef：偵測 <refId.attr> token，[xxx] / 純文字不誤判', () => {
  assert.equal(hasNumRef('可疊加<buff_凝勢I.maxStack>層'), true)
  assert.equal(hasNumRef('攜帶[凝勢I]觸發'), false)
  assert.equal(hasNumRef('可疊加5層'), false)
})

// ─── resolveNumValue / resolveNumRefs（顯示讀真值） ──────────────────────────────

test('resolveNumValue：取真值 / 查無 / 無值 / 未知屬性皆優雅降級', () => {
  assert.equal(resolveNumValue('buff_凝勢I', 'maxStack', lookup), 5)
  assert.equal(resolveNumValue('buff_凝勢I', 'duration', lookup), 2)
  assert.equal(resolveNumValue('buff_不存在', 'maxStack', lookup), undefined) // refId 失效
  assert.equal(resolveNumValue('buff_凝勢III', 'duration', lookup), undefined) // 屬性無值
  assert.equal(resolveNumValue('buff_凝勢I', 'cd', lookup), undefined) // 未在 registry
})

test('resolveNumRefs：token 換成真值，原文逐字還原', () => {
  assert.equal(resolveNumRefs('可疊加<buff_凝勢I.maxStack>層', lookup), '可疊加5層')
  assert.equal(
    resolveNumRefs('可疊加<buff_凝勢II.maxStack>層，持續<buff_凝勢II.duration>回合', lookup),
    '可疊加7層，持續3回合',
  )
})

test('resolveNumRefs：同一 token 不限出現次數', () => {
  assert.equal(resolveNumRefs('<buff_凝勢I.maxStack>+<buff_凝勢I.maxStack>', lookup), '5+5')
})

test('resolveNumRefs：失效 token → fallback（預設 ?，可自訂）', () => {
  assert.equal(resolveNumRefs('上限<buff_不存在.maxStack>層', lookup), '上限?層')
  assert.equal(resolveNumRefs('<buff_凝勢III.duration>', lookup), '?') // 屬性無值
  assert.equal(resolveNumRefs('<buff_凝勢I.cd>', lookup), '?') // 未知屬性
  assert.equal(resolveNumRefs('<buff_不存在.maxStack>', lookup, '—'), '—') // 自訂 fallback
})

test('resolveNumRefs：純文字 / 無 token 原樣回傳', () => {
  assert.equal(resolveNumRefs('攜帶5層及以上時觸發', lookup), '攜帶5層及以上時觸發')
  assert.equal(resolveNumRefs('', lookup), '')
})

// ─── parseNumRefs（結構化片段，供 RefText） ────────────────────────────────────

test('parseNumRefs：text / numRef 片段交錯，refId 含中文+底線、attr 為 ASCII', () => {
  assert.deepEqual(parseNumRefs('可疊加<buff_凝勢I.maxStack>層'), [
    { type: 'text', value: '可疊加' },
    { type: 'numRef', raw: '<buff_凝勢I.maxStack>', refId: 'buff_凝勢I', attr: 'maxStack' },
    { type: 'text', value: '層' },
  ])
})

test('parseNumRefs：連續 token / 開頭即 token / refId 含羅馬數字', () => {
  assert.deepEqual(parseNumRefs('<buff_凝勢III.maxStack>'), [
    { type: 'numRef', raw: '<buff_凝勢III.maxStack>', refId: 'buff_凝勢III', attr: 'maxStack' },
  ])
  assert.equal(parseNumRefs('純文字').length, 1)
})

// ─── orderRefsByFirstMention（編號 = [xxx] 首次出現順序） ─────────────────────────

test('orderRefsByFirstMention：依首次出現排序、去重、略過無引用者', () => {
  assert.deepEqual(orderRefsByFirstMention('攜帶[凝勢I]再引爆[星爆]', refs), [
    'buff_凝勢I',
    'buff_星爆',
  ])
  // 反序出現 → 依文字順序
  assert.deepEqual(orderRefsByFirstMention('[星爆]與[凝勢I]', refs), ['buff_星爆', 'buff_凝勢I'])
  // 同一個 [xxx] 多次 → 只算一次
  assert.deepEqual(orderRefsByFirstMention('[凝勢I]…[凝勢I]…[凝勢I]', refs), ['buff_凝勢I'])
  // refs 查無的 [xxx] 略過（不佔編號）
  assert.deepEqual(orderRefsByFirstMention('[未知詞][凝勢I]', refs), ['buff_凝勢I'])
})

// ─── compileSugar（語法糖 → 正式 token，編輯期一次性） ──────────────────────────

test('compileSugar：$n → maxStack、%n → duration token', () => {
  assert.equal(compileSugar('可疊加$1層', ['buff_凝勢I']), '可疊加<buff_凝勢I.maxStack>層')
  assert.equal(compileSugar('持續%1回合', ['buff_凝勢I']), '持續<buff_凝勢I.duration>回合')
  assert.equal(
    compileSugar('可疊加$1層，持續%1回合', ['buff_凝勢I']),
    '可疊加<buff_凝勢I.maxStack>層，持續<buff_凝勢I.duration>回合',
  )
})

test('compileSugar：$n 指向第 n 個引用', () => {
  assert.equal(compileSugar('$1與$2', ['buff_凝勢I', 'buff_星爆']), '<buff_凝勢I.maxStack>與<buff_星爆.maxStack>')
})

test('compileSugar：n 超出範圍 → 原樣保留（交給殘留偵測）', () => {
  assert.equal(compileSugar('可疊加$3層', ['buff_凝勢I']), '可疊加$3層')
})

test('compileSugar：%n 編譯、百分比 15% 不誤判', () => {
  assert.equal(
    compileSugar('造成15%傷害，最多疊$1層持續%1回合', ['buff_凝勢I']),
    '造成15%傷害，最多疊<buff_凝勢I.maxStack>層持續<buff_凝勢I.duration>回合',
  )
})

test('compileSugar → resolveNumRefs round-trip：原文一份、數字讀 buff（5 vs 7 漂移消失）', () => {
  // 同一句語法糖，綁不同階 buff → 顯示各自真值，正文不需重抄
  const sugar = '可疊加$1層'
  assert.equal(resolveNumRefs(compileSugar(sugar, ['buff_凝勢I']), lookup), '可疊加5層')
  assert.equal(resolveNumRefs(compileSugar(sugar, ['buff_凝勢II']), lookup), '可疊加7層')
})

// ─── detectLeftoverSugar（儲存前防呆） ──────────────────────────────────────────

test('detectLeftoverSugar：偵測未代入的 $n / %n', () => {
  assert.deepEqual(detectLeftoverSugar('可疊加$1層持續%2回合'), ['$1', '%2'])
})

test('detectLeftoverSugar：百分比 50% / 15% 不誤報', () => {
  assert.deepEqual(detectLeftoverSugar('造成50%傷害，再提升15%'), [])
})

test('detectLeftoverSugar：已編譯成 token 的正文無殘留', () => {
  assert.deepEqual(detectLeftoverSugar('可疊加<buff_凝勢I.maxStack>層'), [])
  assert.deepEqual(detectLeftoverSugar(compileSugar('可疊加$1層', ['buff_凝勢I'])), [])
})

test('detectLeftoverSugar：引用不足時，未代入者仍被抓出', () => {
  assert.deepEqual(detectLeftoverSugar(compileSugar('$1與$2', ['buff_凝勢I'])), ['$2'])
})

// ─── .lvN 段：階梯 buff 等級化（PLAN-024 A-2） ──────────────────────────────────

test('parseNumRefs：解析 .lvN 段為 level；無 lv 段不帶 level 屬性（向後相容）', () => {
  assert.deepEqual(parseNumRefs('可疊加<buff_凝勢.lv3.maxStack>層'), [
    { type: 'text', value: '可疊加' },
    { type: 'numRef', raw: '<buff_凝勢.lv3.maxStack>', refId: 'buff_凝勢', attr: 'maxStack', level: 3 },
    { type: 'text', value: '層' },
  ])
  assert.deepEqual(parseNumRefs('<buff_凝勢I.maxStack>'), [
    { type: 'numRef', raw: '<buff_凝勢I.maxStack>', refId: 'buff_凝勢I', attr: 'maxStack' },
  ])
})

test('hasNumRef：含 .lvN 段也偵測得到', () => {
  assert.equal(hasNumRef('可疊加<buff_凝勢.lv2.maxStack>層'), true)
})

test('resolveNumValue：.lvN 以 level 值取級；查無 / 無值 / leveled buff 無頂層值皆降級', () => {
  assert.equal(resolveNumValue('buff_凝勢', 'maxStack', lookup, 1), 5)
  assert.equal(resolveNumValue('buff_凝勢', 'maxStack', lookup, 2), 7)
  assert.equal(resolveNumValue('buff_凝勢', 'duration', lookup, 2), 3)
  assert.equal(resolveNumValue('buff_凝勢', 'duration', lookup, 3), undefined) // lv3 無 duration
  assert.equal(resolveNumValue('buff_凝勢', 'maxStack', lookup, 9), undefined) // 沒有第 9 級
  assert.equal(resolveNumValue('buff_凝勢', 'maxStack', lookup), undefined)    // leveled buff 無頂層 maxStack
})

test('resolveNumValue：非連號 levels 取得到（PLAN-034 B-3 修正的既有 bug）', () => {
  // levels=[3,4]。舊的索引式取級：lv3 → levels[2] → undefined（畫面顯示暗色 ?）、
  // lv4 → levels[3] → undefined；改以 level 值比對後兩者都正確。
  assert.equal(resolveNumValue('buff_迴避率提升', 'maxStack', lookup, 3), 3)
  assert.equal(resolveNumValue('buff_迴避率提升', 'maxStack', lookup, 4), 4)
  assert.equal(resolveNumValue('buff_迴避率提升', 'maxStack', lookup, 1), undefined) // 真的沒有第 1 級
})

test('resolveNumRefs：一份正文、級別由 .lvN token 決定真值（取代三份獨立 token）', () => {
  assert.equal(resolveNumRefs('可疊加<buff_凝勢.lv1.maxStack>層', lookup), '可疊加5層')
  assert.equal(resolveNumRefs('可疊加<buff_凝勢.lv2.maxStack>層', lookup), '可疊加7層')
  assert.equal(
    resolveNumRefs('base <buff_凝勢.lv1.maxStack> / 強化 <buff_凝勢.lv2.maxStack>', lookup),
    'base 5 / 強化 7',
  )
})

test('resolveNumRefs：.lvN 失效 token 優雅降級為 fallback', () => {
  assert.equal(resolveNumRefs('上限<buff_凝勢.lv9.maxStack>層', lookup), '上限?層') // 超範圍
  assert.equal(resolveNumRefs('<buff_不存在.lv1.maxStack>', lookup), '?')           // refId 查無
})

// ─── PLAN-034 F-1：情境層取級（levelOf）─────────────────────────────────────────

// 模擬「γ2 算力把凝勢抬到 lv3」的覆寫。凝勢 lv3 有 maxStack:7 但**沒有 duration**——
// 這正是需要「退回 base」的實測形狀（buff_隱形 lv1 有 duration:2 而 lv2/lv3 完全沒有）。
const liftTo3: NumLevelOf = (refId, base) =>
  refId === 'buff_凝勢' && (base ?? 0) < 3 ? { level: 3, lifted: true, zone: 'γ2' } : { level: base, lifted: false }

test('resolveNumValue：levelOf 抬升後取新階的值（token 寫 lv1，畫面顯示 lv3 的 7）', () => {
  assert.equal(resolveNumValue('buff_凝勢', 'maxStack', lookup, 1), 5)             // 不傳 levelOf = 今日行為
  assert.equal(resolveNumValue('buff_凝勢', 'maxStack', lookup, 1, liftTo3), 7)     // 抬升後
})

test('resolveNumValue：抬升後該級缺該欄位 → 退回基準階，絕不劣化成 ?', () => {
  // lv1 有 duration:2、lv3 沒有。少了退回機制，調高算力會讓一個本來顯示得出數字的
  // token 變成暗色 ?——使用者的感受是「調高算力反而讓資料消失」，比不抬升更糟。
  assert.equal(resolveNumValue('buff_凝勢', 'duration', lookup, 1), 2)
  assert.equal(resolveNumValue('buff_凝勢', 'duration', lookup, 1, liftTo3), 2)
})

test('resolveNumValue：抬升到不存在的級也退回基準階', () => {
  const liftTo9: NumLevelOf = () => ({ level: 9, lifted: true, zone: 'γ2' })
  assert.equal(resolveNumValue('buff_凝勢', 'maxStack', lookup, 1, liftTo9), 5)
})

test('resolveNumValue：基準階本來就取不到值時，不因 levelOf 而變得取得到假值', () => {
  // 基準階不存在且抬升目標也不存在 → 仍是 undefined（降級為 ?），不會憑空生出數字
  const liftTo9: NumLevelOf = () => ({ level: 9, lifted: true, zone: 'γ2' })
  assert.equal(resolveNumValue('buff_凝勢', 'maxStack', lookup, 8, liftTo9), undefined)
})

test('resolveNumValue：levelOf 回不抬升時 byte-identical 等於不傳', () => {
  const noop: NumLevelOf = (_id, base) => ({ level: base, lifted: false })
  for (const n of [undefined, 1, 2, 3, 9]) {
    assert.equal(
      resolveNumValue('buff_凝勢', 'maxStack', lookup, n, noop),
      resolveNumValue('buff_凝勢', 'maxStack', lookup, n),
    )
  }
})

test('resolveNumRefs：整段正文一起抬升（DiffHighlight 走這條，必須與 RefText 同結果）', () => {
  const text = '可疊加<buff_凝勢.lv1.maxStack>層，持續<buff_凝勢.lv1.duration>回合'
  assert.equal(resolveNumRefs(text, lookup), '可疊加5層，持續2回合')
  // maxStack 抬到 lv3 的 7；duration 因 lv3 無值而退回 lv1 的 2（不是 ?）
  assert.equal(resolveNumRefs(text, lookup, '?', liftTo3), '可疊加7層，持續2回合')
})

test('resolveNumRefs：抬升只作用於被覆寫的家族，同段其他 token 原樣', () => {
  assert.equal(
    resolveNumRefs('<buff_凝勢.lv1.maxStack> / <buff_星爆.maxStack>', lookup, '?', liftTo3),
    '7 / 3',
  )
})

test('freezeNumRefs：刻意不吃 levelOf —— 凍結寫回全站正文，不可烘焙單一機師的情境值', () => {
  // 凍結的輸出會取代所有人看到的字串。若它跟著抬升，等於把某位機師的算力配置
  // 變成全站的死數字。這裡斷言凍結恆取基準階。
  const { text } = freezeNumRefs('可疊加<buff_凝勢.lv1.maxStack>層', 'buff_凝勢', BUFFS.buff_凝勢)
  assert.equal(text, '可疊加5層')
})

test('orderRefsByFirstMention + compileSugar：EntityRef.level → 產生 .lvN token（PLAN-024 B-2）', () => {
  const leveledRefs = { 凝勢: { refType: 'buff', refId: 'buff_凝勢', level: 3 } }
  const ordered = orderRefsByFirstMention('攜帶[凝勢]觸發', leveledRefs)
  assert.deepEqual(ordered, ['buff_凝勢.lv3'])
  assert.equal(compileSugar('可疊加$1層', ordered), '可疊加<buff_凝勢.lv3.maxStack>層')
  // 端到端：代入後解析回該級真值（lv3 maxStack = 7）
  assert.equal(resolveNumRefs(compileSugar('可疊加$1層', ordered), lookup), '可疊加7層')
})

test('orderRefsByFirstMention：無 level 的 ref 仍回純 refId（向後相容）', () => {
  assert.deepEqual(orderRefsByFirstMention('攜帶[凝勢I]', refs), ['buff_凝勢I'])
})

// ─── 凍結（PLAN-030 C-3）────────────────────────────────────────────────────

test('freezeNumRefs：只烘焙指向 targetId 的 token，其他實體的原樣保留', () => {
  // 這是 C-3 的核心正確性——用 resolveNumRefs 會把 buff_星爆 也一起烘焙成死數字
  const text = '疊<buff_凝勢I.maxStack>層並使[星爆]上限<buff_星爆.maxStack>層'
  const r = freezeNumRefs(text, 'buff_凝勢I', BUFFS.buff_凝勢I)
  assert.equal(r.text, '疊5層並使[星爆]上限<buff_星爆.maxStack>層')
  assert.deepEqual(r.unresolved, [])
})

test('freezeNumRefs：.lvN 取該級真值（階梯 buff）', () => {
  assert.equal(
    freezeNumRefs('可疊加<buff_凝勢.lv3.maxStack>層', 'buff_凝勢', BUFFS.buff_凝勢).text,
    '可疊加7層',
  )
})

test('freezeNumRefs：同一 token 重複出現全部烘焙', () => {
  const r = freezeNumRefs('<buff_星爆.maxStack>與<buff_星爆.maxStack>', 'buff_星爆', BUFFS.buff_星爆)
  assert.equal(r.text, '3與3')
})

test('freezeNumRefs：取不到值降級為 ? 並回報，不靜默吞掉', () => {
  // 屬性無值（凝勢III 無 duration）／ lv 超範圍 —— 兩者在刪除前就已顯示為暗色 ?
  const a = freezeNumRefs('持續<buff_凝勢III.duration>回合', 'buff_凝勢III', BUFFS.buff_凝勢III)
  assert.equal(a.text, '持續?回合')
  assert.deepEqual(a.unresolved, ['<buff_凝勢III.duration>'])

  const b = freezeNumRefs('<buff_凝勢.lv9.maxStack>', 'buff_凝勢', BUFFS.buff_凝勢)
  assert.deepEqual(b.unresolved, ['<buff_凝勢.lv9.maxStack>'])
})

test('freezeNumRefs：source 為 undefined（實體已查無）→ 全數降級但仍不動別人的 token', () => {
  const r = freezeNumRefs('<buff_x.maxStack>與<buff_y.maxStack>', 'buff_x', undefined)
  assert.equal(r.text, '?與<buff_y.maxStack>')
  assert.deepEqual(r.unresolved, ['<buff_x.maxStack>'])
})

test('freezeNumRefs：無 token 的文字原樣返回', () => {
  assert.equal(freezeNumRefs('純文字沒有引用', 'buff_x', BUFFS.buff_星爆).text, '純文字沒有引用')
})
