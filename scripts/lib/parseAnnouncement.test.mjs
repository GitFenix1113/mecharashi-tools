import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseAnnouncement,
  parseTimeLine,
  parseHeadingLine,
  parseRewards,
  isHeadingCandidate,
  titleAsName,
  spanToWeeks,
  decodeEntities,
  PARSER_VERSION,
} from './parseAnnouncement.mjs'

// PLAN-048 任務 2-1b：解析器單元測試
//
// 每一組「回歸」測試都對應一個在 266 篇歸檔語料上實際踩到的錯，
// 註解寫的是「錯的時候會怎樣」而不是「這個函式做什麼」—— 前者才擋得住重蹈覆轍。

test('decodeEntities：補完歸檔階段沒解的具名實體', () => {
  assert.equal(decodeEntities('A&ndash;B'), 'A–B')
  assert.equal(decodeEntities('特選晶片套裝&gamma;'), '特選晶片套裝γ')
  assert.equal(decodeEntities('官網儲值&rarr;信用卡'), '官網儲值→信用卡')
  assert.equal(decodeEntities('&amp;&lt;&gt;'), '&<>')
  assert.equal(decodeEntities('&#65;&#x42;'), 'AB')
  // 不認得的實體原樣保留，不要吃掉字元
  assert.equal(decodeEntities('&notARealEntity;'), '&notARealEntity;')
})

test('spanToWeeks：整週吸附', () => {
  const d = (s) => new Date(s)
  // 恰好 7 天
  assert.deepEqual(spanToWeeks(d('2026-08-06T05:00'), d('2026-08-13T05:00')), { weeks: 1, whole: true })
  // 6.9993 天（00:00 → 23:59）—— 不吸附就會變成 1.0 的小數並誤標 nonWholeWeek
  assert.deepEqual(spanToWeeks(d('2026-08-13T00:00'), d('2026-08-19T23:59')), { weeks: 1, whole: true })
  // 42 天 = 6 週
  assert.deepEqual(spanToWeeks(d('2026-07-09T05:00'), d('2026-08-20T05:00')), { weeks: 6, whole: true })
  // 40 天：真正的非整週，要保留小數並回報 whole:false
  const r = spanToWeeks(d('2026-07-02T05:00'), d('2026-08-11T05:00'))
  assert.equal(r.whole, false)
  assert.ok(Math.abs(r.weeks - 5.71) < 0.01, `weeks=${r.weeks}`)
  // 結束早於開始（官方打錯字）→ 不產出 weeks，交給 missingDate flag
  assert.deepEqual(spanToWeeks(d('2026-08-13T05:00'), d('2026-08-06T05:00')), { weeks: undefined, whole: false })
})

test('parseTimeLine：三種實測句型', () => {
  // 2025／2026 主流：➤活動時間 + 區間
  const a = parseTimeLine('➤活動時間：2026/08/06 05:00 - 2026/08/13 05:00')
  assert.equal(a.start.getFullYear(), 2026)
  assert.equal(a.start.getMonth(), 7)
  assert.equal(a.start.getDate(), 6)
  assert.equal(a.openEnded, false)

  // 開放式（卡池）
  const b = parseTimeLine('➤活動時間：2026/08/06 10:00 起')
  assert.equal(b.openEnded, true)
  assert.equal(b.end, null)

  // 2024 風格：沒有「活動時間」錨點的裸日期，且用 ~ 分隔、帶秒
  const c = parseTimeLine('2026-07-30 00:00:00~2026-08-05 23:59:59 止')
  assert.equal(c.openEnded, false)
  assert.equal(c.end.getDate(), 5)

  assert.equal(parseTimeLine('本週計畫暫停封鎖登島入口一次'), null)
})

test('回歸：維護時間的 (四) 星期註記不能讓日期解析失效', () => {
  // 錯的時候：`2026/08/13(四) 04:50:00起` 整行認不出來 → 沒被認領 → 灌進 unmatched，
  // 每篇公告都多一行雜訊，「這段我沒看懂」的標紅就失去意義。
  const r = parseTimeLine('2026/08/13(四) 04:50:00起')
  assert.ok(r, '帶星期註記的日期時間要解得出來')
  assert.equal(r.openEnded, true)
  assert.equal(r.start.getDate(), 13)
})

test('parseHeadingLine：卡池標題用文法切，不是把職業名逐個減掉', () => {
  // 錯的時候：職業清單漏了「機械師」→ name 變成「智械彌補論 機械師」
  const a = parseHeadingLine('【特選】智械彌補論– S級機械師「薩普里婭」')
  assert.equal(a.name, '智械彌補論')
  assert.deepEqual(a.entities, ['薩普里婭'])

  const b = parseHeadingLine('【特選】疾影成鋒 – S級守護者「佐伊」')
  assert.equal(b.name, '疾影成鋒')
  assert.deepEqual(b.entities, ['佐伊'])

  const c = parseHeadingLine('【特選】破陣強襲 – S級輕型機甲「赫克托爾」')
  assert.equal(c.name, '破陣強襲')
  assert.deepEqual(c.entities, ['赫克托爾'])

  // 沒有主題名，整個 【】 就是活動名
  assert.equal(parseHeadingLine('【角雕轉盤】').name, '角雕轉盤')
  assert.equal(parseHeadingLine('【乞巧望秋月】').name, '乞巧望秋月')

  // 樣板小標不該被當成活動名
  assert.equal(parseHeadingLine('【特選招募】補充說明').name, '補充說明')
})

test('isHeadingCandidate：內文不能冒充標題', () => {
  // 錯的時候：這行因為含「」被當成活動名，真正的【物資空投活動】反而落進 unmatched
  assert.equal(isHeadingCandidate('凡於活動期間內透過官網儲值管道，指定使用支付［銀行轉帳」、「信用卡］方式，成功儲值後即可獲得回饋。'), false)
  // 錯的時候：➤ 被漏打的公告（實測 2026/04 整批）會產出「活動內容 招募概率提升」這種名字，
  // 而且不觸發任何 flag —— 會靜默流進正式資料
  assert.equal(isHeadingCandidate('活動內容：S級機師「薩普里婭」招募概率提升'), false)
  assert.equal(isHeadingCandidate('➤活動時間：2026/08/06 10:00 起'), false)
  assert.equal(isHeadingCandidate('【角雕轉盤】'), true)
  assert.equal(isHeadingCandidate('【特選】疾影成鋒 – S級守護者「佐伊」'), true)
  assert.equal(isHeadingCandidate('本週推出內容'), false)   // 段落標題不是活動名
  assert.equal(isHeadingCandidate('沒有任何標記的一行'), false)
})

test('titleAsName：單篇活動公告的標題就是活動名', () => {
  assert.equal(titleAsName('【活動】官網指定方式儲值活動_07/30'), '官網指定方式儲值活動')
  assert.equal(titleAsName('【活動】赤馬奔騰新春指定面額加碼活動_02/16'), '赤馬奔騰新春指定面額加碼活動')
  assert.equal(titleAsName('【公告】'), undefined)
})

test('parseRewards：抽不出就不抽', () => {
  assert.deepEqual(
    parseRewards('稀有獎勵包括「S機甲改進模組自選箱」、「王牌機師信物自選箱」等多項珍稀道具。'),
    ['S機甲改進模組自選箱', '王牌機師信物自選箱'],
  )
  assert.equal(parseRewards('活動期間每天登錄即可領取對應獎勵'), undefined)
})

// ── 端對端 ──────────────────────────────────────────────────────────────────

const WEEKLY = `【版本前瞻】2026年08月06日搶先報
兵馬不動糧草先行，掌握情報必得先機！
維護計畫
2026/08/13(四) 04:50:00起
預計將封鎖登島入口 1.5小時 。
本週推出內容
機師征招招募活動
【特選】疾影成鋒 &ndash; S級守護者「佐伊」
➤活動內容：S級機師「佐伊」招募概率提升
➤活動時間：2026/08/06 10:00 起
【特選招募】補充說明
1. 【招募一次】時必會獲得1名隨機機師
機甲獲取海運活動
【特選】破陣強襲 &ndash; S級輕型機甲「赫克托爾」
➤活動時間：2026/08/06 10:00 起
活動中心
【角雕轉盤】
➤活動時間：2026/08/06 05:00 - 2026/08/13 05:00
稀有獎勵包括「王牌機師信物自選箱」等多項珍稀道具。
特殊活動
【指定方式儲值】
➤活動時間：2026/08/06 00:00 - 2026/08/12 23:59
《鋼嵐後勤小組》
回新聞列表`

test('端對端：一篇週報抽出三筆活動；維護時間不算活動、儲值不收錄', () => {
  const r = parseAnnouncement({
    title: '【版本前瞻】2026年08月06日搶先報',
    text: WEEKLY,
    sourceUrl: 'https://example.invalid/1789.html',
  })

  // 四個時間錨點：卡池 ×2、轉盤、儲值。儲值解析得出來但刻意不收錄（EXCLUDED_TYPES）
  assert.equal(r.activities.length, 3, '維護計畫的時間不該被當成活動；儲值不收錄')
  assert.equal(r.excluded, 1, '不收錄的仍要計數 —— 否則產出量監控會被自己的過濾規則污染')
  const [pilot, mech, roulette] = r.activities

  assert.equal(pilot.extracted.name, '疾影成鋒')
  assert.equal(pilot.extracted.type, 'specificPilotBanner')
  assert.deepEqual(pilot.extracted.pilots, ['佐伊'])
  assert.equal(pilot.extracted.startDate, '2026/08/06')
  // 開放式檔期抽不到 weeks —— 留 undefined，絕不填預設值
  assert.equal(pilot.extracted.weeks, undefined)
  assert.ok(pilot.flags.includes('openEnded'))
  assert.equal(pilot.status, 'needsReview')

  assert.equal(mech.extracted.name, '破陣強襲')
  assert.equal(mech.extracted.type, 'specificMechBanner')
  assert.deepEqual(mech.extracted.mechs, ['赫克托爾'])

  assert.equal(roulette.extracted.name, '角雕轉盤')
  assert.equal(roulette.extracted.type, 'roulette')
  assert.equal(roulette.extracted.weeks, 1)
  assert.equal(roulette.flags.length, 0)
  assert.equal(roulette.status, 'parsed', '零 flag 才可直接放行')
  assert.deepEqual(roulette.extracted.rewards, ['王牌機師信物自選箱'])

  assert.ok(!r.activities.some(a => a.extracted.type === 'topUpEvent'), '儲值促銷不進待審清單')

  // 台版公告是官方一手來源
  for (const a of r.activities) {
    assert.equal(a.extracted.confidence, 'confirmed')
    assert.equal(a.extracted.sourceUrl, 'https://example.invalid/1789.html')
  }
  assert.deepEqual(r.warnings, [])
})

test('端對端：seq 取自原始順序，不因為過濾而重編（文件 ID 靠它冪等）', () => {
  const r = parseAnnouncement({ title: '【版本前瞻】x', text: WEEKLY })
  // seq 來自「所有時間錨點」的索引，不是收錄後的索引 —— 所以被濾掉的第 3 筆
  // 留下缺口是**正確的**：日後若把儲值改回收錄，其餘項目的文件 ID 不會整批位移。
  assert.deepEqual(r.activities.map(a => a.seq), [0, 1, 2])
  // 重跑同一份輸入必須得到同樣的 seq，否則每次重新解析都會多出一批孤兒文件
  const again = parseAnnouncement({ title: '【版本前瞻】x', text: WEEKLY })
  assert.deepEqual(again.activities.map(a => a.extracted.name), r.activities.map(a => a.extracted.name))
})

test('端對端：單篇儲值公告解析得出來，但整篇都不收錄', () => {
  const r = parseAnnouncement({
    title: '【活動】官網指定方式儲值活動_07/30',
    text: `【活動】官網指定方式儲值活動_07/30
官網儲值［銀行轉帳、信用卡］限定活動
【物資空投活動】
活動方式
凡於活動期間內透過官網儲值管道，指定使用支付［銀行轉帳」、「信用卡］方式，成功儲值後即可獲得回饋。
活動時間
2026-07-30 00:00:00~2026-08-05 23:59:59
※獎勵將於活動期間滿足條件後即時發送。`,
  })
  // 實測 15 篇【活動】獨立公告 100% 都是儲值促銷 —— 整篇歸零是預期結果
  assert.equal(r.activities.length, 0)
  assert.equal(r.excluded, 1)
  // 但原文仍被認領（不會冒充成「解析器沒看懂」灌進 unmatched）
  assert.equal(r.unmatched.length, 0, `unmatched=${JSON.stringify(r.unmatched)}`)
})

test('不收錄的型別仍計入產出量，否則體檢報告會被自己的過濾規則污染', () => {
  // 一篇只有儲值的週報：收錄 0 筆，但「解析器看懂了 1 筆」是事實，
  // 不該因此誤報 lowYield 說解析器瞎了
  const r = parseAnnouncement({
    title: '【版本前瞻】x',
    text: `本週推出內容
特殊活動
【指定方式儲值】
➤活動時間：2026/08/06 00:00 - 2026/08/12 23:59
活動中心
【角雕轉盤】
➤活動時間：2026/08/06 05:00 - 2026/08/13 05:00`,
  })
  assert.equal(r.activities.length, 1)
  assert.equal(r.excluded, 1)
  assert.ok(!r.warnings.includes('lowYield'), '1 收錄 + 1 排除 = 解析出 2 筆，不算產出過低')
})

test('端對端：名稱關鍵字優先於段落標題', () => {
  // 錯的時候：【角雕特遣】和【跨域海運】因為都在卡池段落底下，
  // 會一律被歸成 specificPilotBanner / specificMechBanner
  const r = parseAnnouncement({
    title: '【版本前瞻】x',
    text: `本週推出內容
機師征招招募活動
【角雕特遣】
➤活動時間：2026/07/09 10:00 起
機甲獲取海運活動
【跨域海運】
➤活動時間：2026/07/09 10:00 起`,
  })
  assert.equal(r.activities[0].extracted.type, 'pilotMission')
  assert.equal(r.activities[1].extracted.type, 'crossShipping')
})

test('回歸：台版戰令叫「環島密令」，括號是系統名、「」裡才是賽季名', () => {
  // 錯的時候（實測 20260729/1780）：括號與實體名都被剝掉，只剩泛稱的「賽季」
  // 當名字，型別則因為公告全程不出現「戰令」二字而退到段落標題「限時活動」——
  // 產出一筆名為「賽季」的限時活動，整個戰令系統在時間線上是缺的。
  const r = parseAnnouncement({
    title: '【環島密令】「謀海魅影」賽季',
    text: `限時活動
【環島密令】「謀海魅影」賽季
➤活動時間：2026/07/30 10:00 - 2026/09/10 10:00`,
  })
  assert.equal(r.activities.length, 1)
  assert.equal(r.activities[0].extracted.name, '謀海魅影')
  assert.equal(r.activities[0].extracted.type, 'battlePass')
})

test('回歸：多爾沙龍是儲值促銷（專名不含「儲值」二字），不收錄', () => {
  // 錯的時候：標題只有【多爾沙龍】，段落是限時活動 → 歸成 limitedEvent 進了待審佇列，
  // 而它每期都有、對「這版有什麼玩法」零資訊量，維護者每次都得手動忽略一筆。
  const r = parseAnnouncement({
    title: '【版本前瞻】x',
    text: `限時活動
【多爾沙龍】
➤活動時間：2026/07/30 05:00 - 2026/08/20 04:59
活動期間累計儲值達到指定額度，即可領取對應獎勵。`,
  })
  assert.equal(r.activities.length, 0, '儲值促銷擋在解析層，不產生待審')
  assert.equal(r.excluded, 1, '但要計入產出量分母，否則回歸偵測被自己的過濾規則污染')
})

test('回歸：同一活動頁的玩法活動不能被當成儲值一起排除', () => {
  // 「預熱衝刺」＝戰術模擬演算次數 +2、「火線重燃」＝首領剿滅素材加成，
  // 它們與多爾沙龍並列在遊戲內同一個「活動」頁，但性質完全不同，要照常收錄
  const r = parseAnnouncement({
    title: '【版本前瞻】x',
    text: `限時活動
【預熱衝刺】
➤活動時間：2026/07/30 05:00 - 2026/08/06 05:00
活動期間【戰術模擬】自動演算次數增加2次。
【火線重燃】
➤活動時間：2026/07/30 05:00 - 2026/08/06 05:00
活動期間首領剿滅精粹素材獎勵增加`,
  })
  assert.equal(r.activities.length, 2)
  assert.deepEqual(r.activities.map(a => a.extracted.type), ['limitedEvent', 'limitedEvent'])
})

test('回歸：系統名的完全比對不能誤傷含同字的正常活動名', () => {
  // 「角雕轉盤」含型別關鍵字（轉盤）但它是完整活動名，不是系統標記 ——
  // 若 SYSTEM_BRACKETS 寫成 includes，名字會被剝成獎勵名「艾達」
  const r = parseAnnouncement({
    title: '【活動】x',
    text: `【角雕轉盤】「艾達」\n➤活動時間：2026/08/06 05:00 - 2026/08/13 05:00`,
  })
  assert.equal(r.activities[0].extracted.name, '角雕轉盤')
  assert.equal(r.activities[0].extracted.type, 'roulette')
})

test('端對端：抽不到型別時標 unknownActivityType 而不是猜一個', () => {
  const r = parseAnnouncement({
    title: '【公告】星海拓荒祭開跑',
    text: `【星海拓荒祭】
➤活動時間：2026/08/06 05:00 - 2026/08/13 05:00`,
  })
  assert.equal(r.activities.length, 1)
  assert.equal(r.activities[0].extracted.type, undefined, '猜不到就不要填')
  assert.ok(r.activities[0].flags.includes('unknownActivityType'))
  assert.equal(r.activities[0].extracted.typeLabel, '星海拓荒祭')
})

test('端對端：起始日非週四、非整週要各自標記', () => {
  // 2026/07/11 是週六
  const a = parseAnnouncement({
    title: '【活動】x',
    text: `【某活動】\n➤活動時間：2026/07/11 05:00 - 2026/08/15 05:00`,
  }).activities[0]
  assert.ok(a.flags.includes('nonThursdayStart'))
  // 35 天正好 5 週 —— 起始日歪掉不代表長度歪掉，兩個 flag 是獨立的
  assert.equal(a.extracted.weeks, 5)
  assert.ok(!a.flags.includes('nonWholeWeek'))

  const b = parseAnnouncement({
    title: '【活動】x',
    text: `【某活動】\n➤活動時間：2026/07/09 05:00 - 2026/08/14 05:00`,
  }).activities[0]
  assert.ok(b.flags.includes('nonWholeWeek'), '36 天不是整週')
  assert.ok(!b.flags.includes('nonThursdayStart'))
})

test('產出量監控：週報抽不到活動要告警（任務 2-6）', () => {
  // 爬蟲失效時不會報錯，只會靜默降低品質 —— 只看 HTTP 200 看不出解析器已經瞎了
  const r = parseAnnouncement({ title: '【版本前瞻】2027年01月01日搶先報', text: '本週推出內容\n（官網改版後的新排版）' })
  assert.deepEqual(r.activities, [])
  assert.ok(r.warnings.includes('lowYield'))

  // 有機師征招段落卻抽不到機師名
  const s = parseAnnouncement({
    title: '【版本前瞻】x',
    text: `本週推出內容
機師征招招募活動
【某某卡池】
➤活動時間：2026/08/06 05:00 - 2026/08/13 05:00
活動中心
【角雕轉盤】
➤活動時間：2026/08/06 05:00 - 2026/08/13 05:00`,
  })
  assert.ok(s.warnings.includes('pilotSectionNoName'))
})

test('unmatched 只收有訊號的行，不收樣板', () => {
  const r = parseAnnouncement({ title: '【版本前瞻】x', text: WEEKLY })
  // 滿頁都紅等於沒有紅：抽獎規則樣板不該進 unmatched
  assert.equal(r.unmatched.length, 0, `unmatched=${JSON.stringify(r.unmatched)}`)

  const s = parseAnnouncement({
    title: '【版本前瞻】x',
    text: `本週推出內容
活動中心
【角雕轉盤】
➤活動時間：2026/08/06 05:00 - 2026/08/13 05:00
【全新玩法】某個解析器沒看懂的東西`,
  })
  assert.ok(s.unmatched.some(u => u.includes('全新玩法')), '沒被認領的 【】 段落要浮出來')
})

test('PARSER_VERSION 是整數（AnnouncementDraft.parserVersion 靠它挑重跑對象）', () => {
  assert.ok(Number.isInteger(PARSER_VERSION) && PARSER_VERSION >= 2, '加了不收錄規則就要進版')
})
