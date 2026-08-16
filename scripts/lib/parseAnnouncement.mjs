/**
 * PLAN-048 任務 2-1b：台版公告解析器
 *
 * 輸入一則公告的純文字，輸出 0..n 筆待審活動（PendingActivity 的 extracted 部分）
 * 加上整篇層級的 unmatched / warnings。
 *
 * 契約的型別面在 src/types/announcementStaging.ts（本檔是純 JS，無法 import 型別）。
 *
 * ── 設計取捨（都有 266 篇歸檔語料的實測支撐）────────────────────────────────
 *
 * 1. **由「活動時間」錨點反向找名稱**，而不是由 【】 正向切塊。
 *    實測全語料有 3052 個 【】 區塊，其中 79.7% 是樣板噪音
 *    （【招募一次】【購置十次】【特選招募】補充說明…），正向切塊會產出四倍的垃圾。
 *    而 620 個時間錨點幾乎 1:1 對應真實活動 —— 從時間往回找名稱，噪音天然被跳過
 *    （樣板 【】 一律出現在時間行「之後」）。
 *
 * 2. **段落標題決定型別**，名稱關鍵字只在段落內二選一。
 *    「機師征招招募活動」「機甲獲取海運活動」「活動中心」「特殊活動」四個標題
 *    在 2024–2026 全程穩定（實測 78/79/102/107 次），比句型可靠得多 ——
 *    計畫書點名的漂移句型「本期機師征招『X』」2024/2025 出現 0 次。
 *
 * 3. **解析得出來 ≠ 要收錄**。儲值促銷（EXCLUDED_TYPES）擋在解析層，
 *    但仍計入產出量統計——不然「少收 30%」會被誤讀成「解析率掉了 30%」。
 *
 * 4. **抽不到就留 undefined，絕不填預設值**。填了預設值就再也分不出
 *    「官方真的是這樣」與「我沒抽到」。開放式檔期（「10:00 起」，實測 191 筆）
 *    的 weeks 因此是缺的，由後台表單預填建議值 —— 建議值不進資料。
 */

/**
 * 解析器版本。改動任何規則都要 +1 ——
 * AnnouncementDraft.parserVersion 靠它挑出「該重跑的舊公告」，
 * 沒有它就只能全量重跑或憑印象。
 */
export const PARSER_VERSION = 4

const DAY_MS = 86_400_000

// ── 文字正規化 ──────────────────────────────────────────────────────────────

/**
 * 官網正文夾雜大量 HTML 具名實體，且歸檔階段只解了最基本的六個。
 * 這裡補完剩下的 —— 尤其 `&ndash;` 是機師/機甲池標題的破折號分隔符，
 * 不解掉就抽不出「主題名 vs 實體名」。
 */
const ENTITIES = {
  ndash: '–', mdash: '—', middot: '·', hellip: '…', rarr: '→', larr: '←',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', times: '×', divide: '÷',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  bull: '•', deg: '°', plusmn: '±', trade: '™', reg: '®', copy: '©',
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? m)
}

// ── 段落標題 → 活動型別 ─────────────────────────────────────────────────────

/**
 * 段落標題登錄表。value 為 null 代表「認得這個段落，但它不產活動」——
 * 這與「不認得」是兩件事：認得才能把該段落的內容標成已認領，不去污染 unmatched。
 */
const SECTIONS = {
  機師征招招募活動: 'specificPilotBanner',
  機甲獲取海運活動: 'mechBannerSection',   // 依實體數量再分 specificMechBanner / crossShipping
  活動中心: 'eventCenter',                  // 依名稱關鍵字再分
  特殊活動: 'topUpEvent',
  限時活動: 'limitedEvent',

  // 認得但不產活動的段落
  維護時間: null,
  維護計畫: null,
  修正與優化: null,
  新增內容: null,          // 商店輪換，對應 PatchHalf 的 borderShop / arenaShop，非 TimedActivity
  新增商品: null,
  注意事項: null,
  特別提醒: null,
  已知問題: null,
  領獎範例: null,
  回報流程: null,
  參考格式: null,
  本週推出內容: null,      // 內容起點，本身不是型別
  米赫瑪島封鎖解除: null,
}

/**
 * 活動名關鍵字 → 型別。順序即優先序（先命中先算）。
 *
 * 這層**優先於段落標題**：同一個「機師征招招募活動」段落裡既有【特選】卡池
 * 也有【角雕特遣】，同一個「機甲獲取海運活動」段落裡既有單機卡池也有【跨域海運】。
 * 只看段落會把兩者一律歸成卡池 —— 名稱是比段落更精確的訊號，段落是它的預設值。
 */
const NAME_KEYWORDS = [
  [/轉盤|輪盤/, 'roulette'],
  [/刮刮樂/, 'skinGacha'],
  [/特遣/, 'pilotMission'],
  [/跨域海運/, 'crossShipping'],
  [/登錄|登入|簽到/, 'loginEvent'],
  // 「多爾沙龍」是台版對儲值滿額活動的固定專名 —— 正文寫「活動期間累計儲值達到
  // 指定額度，即可領取對應獎勵」，標題卻不出現「儲值」二字，於是漏進 limitedEvent。
  // 28 篇語料全是同一句，是穩定專名不是個案（同構於「環島密令」＝戰令）。
  // ⚠ 同一個活動頁上的「預熱衝刺」（戰術模擬演算次數 +2）與「火線重燃」
  //   （首領剿滅素材加成）是玩法活動，不是儲值，不能一起收進來。
  [/儲值|多爾沙龍/, 'topUpEvent'],
  // 台版把戰令叫「環島密令」，公告全程不出現「戰令」二字 —— 只認關鍵字會漏掉整個系統
  [/戰令|通行證|環島密令/, 'battlePass'],
]

/**
 * 【】 內是**系統名**而非活動名的清單。
 *
 * `【環島密令】「謀海魅影」賽季` 的文法與卡池相反：括號裡是系統名（＝型別），
 * 真正的活動名在 「」 裡，尾巴的「賽季」只是泛稱。不特別處理的話，
 * parseHeadingLine 會把殘留的「賽季」當名字 —— 實測產出的就是名為「賽季」、
 * 型別「限時活動」的一筆。
 *
 * 用**完全比對**而不是 includes：「角雕轉盤」也含型別關鍵字（轉盤），
 * 但它是完整的活動名，不能被當成系統標記剝掉。
 */
const SYSTEM_BRACKETS = /^(?:環島密令|戰令|通行證)$/

/** 剝掉 【】「」 後只剩這種泛稱詞 → 它不是名字（`…「謀海魅影」賽季` 的「賽季」） */
const GENERIC_HEAD = /^(?:賽季|活動|公告|開跑|開啟|上線|登場|來襲)$/

/**
 * **解析得出來、但刻意不收錄**的活動型別。
 *
 * `topUpEvent`（「指定方式儲值」／「物資空投活動」）是純儲值促銷，
 * 對「這版有什麼玩法、檔期多長」沒有任何資訊量，放進甘特只會佔掉一整列。
 * 實測它是產出量第 2 高的型別（96 筆裡 29 筆，30%）—— 不擋掉的話，
 * 每三筆待審就有一筆是要按忽略的，審核工作檯的訊噪比會被它拖垮。
 *
 * ⚠ 擋在**解析層**而不是顯示層：產出來再讓人逐筆忽略是白工。
 * 但它們仍會被算進產出量統計（見 excluded），否則「解析器是不是瞎了」
 * 的判斷會被自己的過濾規則污染 —— 少收 30% 不等於解析率掉了 30%。
 */
const EXCLUDED_TYPES = new Set(['topUpEvent'])

/**
 * 樣板 【】 名稱黑名單：這些是抽獎規則說明的小標，不是活動名。
 * 反向搜尋通常碰不到它們（它們在時間行之後），這是段落標題缺席時的第二道防線。
 */
const BOILERPLATE_NAMES = /^(特選招募|特選購置|招募一次|招募十次|購置一次|購置十次|版本前瞻|活動|公告|臨時公告|已知問題彙整|點此前往)$/

/**
 * 欄位行（`➤活動時間：…`／`活動內容：S級機師「薩普里婭」招募概率提升`）。
 *
 * ➤ 前綴**不能**當唯一判準：實測 2026/04 的公告有整批把 ➤ 漏掉的
 * （1625 等），結果「活動內容：…」被誤當成活動標題、產出
 * 「活動內容 招募概率提升」這種名字 —— 而且不會觸發任何 flag，
 * 是會靜默流進正式資料的那種錯。
 */
const RE_FIELD_LINE = /^[➤●▶※]?\s*活動(?:內容|說明|時間|方式|期間|規則)\s*[:：]?/

/** 整行即噪音，不進 unmatched */
const NOISE_LINE = /^(回新聞列表|《鋼嵐後勤小組》|〈後勤支援小組〉|活動說明[:：]?|活動內容[:：]?|活動方式[:：]?|活動時間[:：]?|兵馬不動糧草先行.*|以下是來自於米赫瑪島.*|戰況瞬息萬變.*|詳情可見官網活動公告|其餘.*說明請見遊戲.*)$/

// ── 日期／時間 ──────────────────────────────────────────────────────────────

const D = String.raw`(\d{4})[/-](\d{1,2})[/-](\d{1,2})`
const T = String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?`
/** 維護公告寫成 `2026/08/13(四) 04:50:00起`，日期與時刻之間夾一個星期註記 */
const DOW = String.raw`\s*(?:[（(]\s*(?:週|周|星期)?[一二三四五六日天]\s*[）)])?\s*`
// 實體已在 normalize 階段解碼，故分隔符只需收字面字元
const SEP = String.raw`\s*(?:[-~–—－至到])\s*`

const RE_RANGE = new RegExp(`${D}${DOW}${T}${SEP}${D}${DOW}${T}`)
const RE_OPEN = new RegExp(`${D}${DOW}${T}\\s*起`)
/** 「活動時間」錨點行；2024 年有 5 筆是裸日期，故錨點為選配 */
const RE_TIME_LINE = new RegExp(`(?:活動時間[:：]?\\s*)?(?:${D}${DOW}${T})`)

function toDate(y, m, d, hh = 0, mm = 0, ss = 0) {
  return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss))
}

function fmtDate(dt) {
  const p = n => String(n).padStart(2, '0')
  return `${dt.getFullYear()}/${p(dt.getMonth() + 1)}/${p(dt.getDate())}`
}

/**
 * 絕對起訖 → 既有的 startDate + weeks 模型。
 *
 * 為什麼不新增 endsAtExclusive 欄位（計畫書邊界一的預留）：實測 424 筆區間中
 * 93.2% 恰為整週、96.9% 落在 ±0.5 天內，而 ganttGeometry 的 weeks 早就吃小數
 * （日精度百分比長條）。加欄位只換到 3% 的精度，代價卻是全站顯示層多一條分支。
 *
 * ±0.5 天的吸附是必要的：「08/13 00:00 – 08/19 23:59」是 6.9993 天，
 * 不吸附就會變成 weeks: 1.0 的小數並誤標 nonWholeWeek。
 */
export function spanToWeeks(start, end) {
  const days = (end.getTime() - start.getTime()) / DAY_MS
  if (!(days > 0)) return { weeks: undefined, whole: false }
  const nearest = Math.round(days / 7)
  if (nearest >= 1 && Math.abs(days - nearest * 7) <= 0.5) {
    return { weeks: nearest, whole: true }
  }
  return { weeks: Math.round((days / 7) * 100) / 100, whole: false }
}

/** 從一行文字抽出檔期。回傳 null 代表這行沒有時間。 */
export function parseTimeLine(line) {
  const r = RE_RANGE.exec(line)
  if (r) {
    const start = toDate(r[1], r[2], r[3], r[4], r[5], r[6])
    const end = toDate(r[7], r[8], r[9], r[10], r[11], r[12])
    return { start, end, openEnded: false }
  }
  const o = RE_OPEN.exec(line)
  if (o) {
    return { start: toDate(o[1], o[2], o[3], o[4], o[5], o[6]), end: null, openEnded: true }
  }
  return null
}

// ── 名稱／實體 ──────────────────────────────────────────────────────────────

/**
 * 從標題行抽出「主題名」與「實體名」。
 *
 * 卡池標題的形狀是 `【特選】疾影成鋒 – S級守護者「佐伊」`，
 * 對應既有靜態資料的命名慣例 `revivedBanners: ['業火搖光（機師: 瑪阿特）']`：
 * 主題名進 name、實體名進 pilots/mechs。
 *
 * 一般活動的形狀是 `【角雕轉盤】`，整個括號內容就是名稱。
 */
export function parseHeadingLine(line) {
  const entities = [...line.matchAll(/[「『]([^」』]{1,20})[」』]/g)].map(m => m[1].trim())
  const brackets = [...line.matchAll(/【\s*([^【】]{1,40}?)\s*】/g)].map(m => m[1].trim())

  // 卡池標題的文法是 `【特選】<主題名> – S級<職業或機種>「<實體名>」`。
  // 用文法切（破折號之前即主題名）而不是把職業名逐個減掉 ——
  // 減法要維護一份永遠補不齊的職業清單，實測就漏掉了「機械師」「調構師」「戰術家」，
  // 產出「智械彌補論 機械師」這種半截名字。
  const rest = line
    .replace(/【[^【】]*】/g, ' ')
    .replace(/[「『][^」』]*[」』]/g, ' ')
    .trim()

  let name
  const dash = rest.search(/[–—－~]|(?<=\S)\s-\s/)
  const head = (dash >= 0 ? rest.slice(0, dash) : rest).replace(/\s+/g, ' ').trim()

  // 系統名開頭（【環島密令】…）：括號是型別標記不是名字，「」 裡的才是這一季的名字。
  // 限定「head 不成立」才走這條 —— 免得哪天出現 `【戰令】某某活動「獎勵」` 反而取錯。
  const systemBracket = brackets.some(b => SYSTEM_BRACKETS.test(b))
  const headUsable = head && !ONLY_ROLE_WORDS.test(head) && !GENERIC_HEAD.test(head)

  if (systemBracket && !headUsable && entities.length) {
    name = entities[0]
  } else if (headUsable) {
    name = head
  } else if (brackets.length) {
    // 只有 【】 沒有主題名 → 取第一個非樣板的括號內容
    name = brackets.find(b => !BOILERPLATE_NAMES.test(b))
  }
  if (!name && entities.length) name = entities[0]

  return { name: name || undefined, entities, brackets }
}

/**
 * 只由品階／職業／機種構成的字串（如 `S級守護者`）—— 它是實體的描述，不是活動名。
 * 只用在「破折號切出來的前半段是否可當名字」這一個判斷上，
 * 漏收某個職業名的後果只是多留一個候選，不會像減法那樣切壞名字。
 */
const ONLY_ROLE_WORDS = /^(?:S級|A級|B級|SSR|SR|新|輕型|中型|重型|機甲|機師|守護者|格鬥家|狙擊手|支援者|突擊兵|機械師|調構師|戰術家|\s)*$/

/**
 * 這一行有沒有資格當活動標題。
 *
 * 沒有這道閘的後果實測過：`凡於活動期間內透過官網儲值管道，指定使用支付
 * ［銀行轉帳」、「信用卡］方式…` 這種內文因為含「」而被當成活動名，
 * 真正的 `【物資空投活動】` 反而落進 unmatched。標題是短句、不帶逗號句號。
 */
export function isHeadingCandidate(line) {
  if (!/【|「/.test(line)) return false          // 名稱行一定帶 【】 或 「」
  if (RE_FIELD_LINE.test(line)) return false     // 欄位行，不是標題
  if (line.length > 40) return false             // 內文；實測最長的真標題 31 字
  if (/[，。；]/.test(line)) return false        // 有句讀＝內文
  if (Object.prototype.hasOwnProperty.call(SECTIONS, line)) return false
  return true
}

/**
 * 公告標題 → 活動名。用於沒有 【】 小標的單篇活動公告。
 * `【活動】官網指定方式儲值活動_07/30` → `官網指定方式儲值活動`
 */
export function titleAsName(title) {
  const s = String(title)
    .replace(/^【[^】]*】\s*/, '')
    .replace(/[_-]\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/, '')
    .trim()
  return s || undefined
}

/** 獎勵行 → 逐項字串。刻意保守：抽不出就不抽，寧缺勿錯。 */
export function parseRewards(text) {
  const m = /(?:稀有)?獎勵(?:包括|包含|有)[：:]?\s*([^\n]{4,200})/.exec(text)
  if (!m) return undefined
  const items = m[1]
    .replace(/等(?:多項|各項)?[^、]*$/, '')
    .split(/[、,，]/)
    .map(s => s.replace(/[「」『』]/g, '').trim())
    .filter(s => s.length >= 2 && s.length <= 40)
  return items.length ? items : undefined
}

// ── 主解析 ──────────────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {string} input.title       公告標題
 * @param {string} input.text        正規化純文字（正文）
 * @param {string} input.sourceUrl   官方公告網址，原樣抄進 TimedActivity.sourceUrl
 * @returns {{ activities: object[], unmatched: string[], warnings: string[] }}
 */
export function parseAnnouncement({ title = '', text = '', sourceUrl = '' } = {}) {
  const body = decodeEntities(text)
  const rawLines = body.split('\n')

  // 行號 → 在 body 內的字元位移（excerptStart 要用）
  const offsets = []
  let acc = 0
  for (const l of rawLines) { offsets.push(acc); acc += l.length + 1 }

  const lines = rawLines.map(l => l.trim())
  const claimed = new Array(lines.length).fill(false)
  const isWeekly = /版本前瞻/.test(title)

  // ① 標記段落標題，建立 行號 → 段落 的對照
  const sectionAt = new Array(lines.length).fill(null)
  let current = null
  let sawPilotSection = false, sawMechSection = false
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i]
    if (Object.prototype.hasOwnProperty.call(SECTIONS, key)) {
      current = { header: key, kind: SECTIONS[key], line: i }
      claimed[i] = true
      if (key === '機師征招招募活動') sawPilotSection = true
      if (key === '機甲獲取海運活動') sawMechSection = true
    }
    sectionAt[i] = current
  }

  // ② 找出所有時間行
  const timeHits = []
  for (let i = 0; i < lines.length; i++) {
    if (!RE_TIME_LINE.test(lines[i])) continue
    // 「維護計畫」段落的維護時間不是活動
    const sec = sectionAt[i]
    if (sec && sec.kind === null && /維護/.test(sec.header)) { claimed[i] = true; continue }
    const span = parseTimeLine(lines[i])
    if (!span) continue
    timeHits.push({ line: i, span })
    claimed[i] = true
  }

  // ③ 每個時間行往回找名稱，組成活動
  const activities = []
  let pilotNamed = 0, mechNamed = 0, excluded = 0
  for (const [seq, hit] of timeHits.entries()) {
    const prevTimeLine = seq > 0 ? timeHits[seq - 1].line : -1
    const sec = sectionAt[hit.line]
    const flags = []

    // 反向搜尋名稱：不跨過上一個時間行，也不跨過段落標題
    let headIdx = -1
    for (let i = hit.line - 1; i > prevTimeLine; i--) {
      if (sec && i <= sec.line) break
      if (!lines[i]) continue
      // 欄位行不是標題；一律吃掉往上找
      if (NOISE_LINE.test(lines[i]) || RE_FIELD_LINE.test(lines[i]) || /^➤/.test(lines[i])) {
        claimed[i] = true
        continue
      }
      if (!isHeadingCandidate(lines[i])) continue
      const h = parseHeadingLine(lines[i])
      const onlyBoilerplate = h.brackets.length > 0 && h.brackets.every(b => BOILERPLATE_NAMES.test(b))
      if (!h.name || onlyBoilerplate) continue
      headIdx = i
      break
    }

    const heading = headIdx >= 0 ? parseHeadingLine(lines[headIdx]) : { name: undefined, entities: [] }
    if (headIdx >= 0) {
      claimed[headIdx] = true
      // 標題行到時間行之間都屬於這個活動，一併認領，免得內文落進 unmatched
      for (let i = headIdx + 1; i < hit.line; i++) claimed[i] = true
    }

    // 單篇活動公告（實測 118 篇【活動】…）內文沒有 【】 小標 —— 公告標題本身就是活動名。
    // 週報不適用：一篇十個活動，標題不是其中任何一個的名字。
    if (!heading.name && !isWeekly) heading.name = titleAsName(title)
    if (!heading.name) flags.push('missingName')

    // 標題行沒帶實體名時，退而求其次讀 `➤活動內容：S級機師「科林」招募概率提升`
    if (heading.entities.length === 0) {
      for (let i = Math.max(headIdx, prevTimeLine) + 1; i < hit.line; i++) {
        const m = /(?:活動內容|概率提升|招募|購置)[^\n]*?[「『]([^」』]{1,20})[」』]/.exec(lines[i])
        if (m) { heading.entities = [m[1].trim()]; break }
      }
    }

    // 型別判定：活動名關鍵字 → 段落標題 → 公告標題關鍵字
    let type, typeLabel, rawTypeLabel
    const kind = sec?.kind
    // 比對範圍含 【】：型別關鍵字常只出現在括號裡而不在名字上
    // （`【環島密令】「謀海魅影」賽季` 的 name 是「謀海魅影」，看名字永遠認不出戰令）
    const typeText = [heading.name, ...(heading.brackets ?? [])].filter(Boolean).join(' ')
    const byName = typeText ? NAME_KEYWORDS.find(([re]) => re.test(typeText)) : undefined
    if (byName) {
      type = byName[1]
    } else if (kind === 'specificPilotBanner') {
      type = 'specificPilotBanner'
    } else if (kind === 'mechBannerSection') {
      // 單一機甲＝特定機甲池；多台＝跨域海運
      type = heading.entities.length >= 2 ? 'crossShipping' : 'specificMechBanner'
    } else if (kind === 'eventCenter' || kind === 'topUpEvent' || kind === 'limitedEvent') {
      type = kind === 'topUpEvent' ? 'topUpEvent' : 'limitedEvent'
    } else {
      // 段落與活動名都認不得 → 退到公告標題關鍵字 → 才認輸標未知型別。
      // 標題那層是為了單篇活動公告（實測 118 篇【活動】…）：它們沒有段落標題，
      // 活動名可能是「物資空投活動」這種代號，但標題寫得清楚（「官網指定方式儲值活動」）。
      const kw = NAME_KEYWORDS.find(([re]) => re.test(title))
      if (kw) {
        type = kw[1]
      } else {
        flags.push('unknownActivityType')
        rawTypeLabel = sec?.header
        typeLabel = heading.name
      }
    }

    // 檔期
    let startDate, weeks
    if (hit.span.start) startDate = fmtDate(hit.span.start)
    else flags.push('missingDate')
    if (hit.span.openEnded) {
      flags.push('openEnded')
    } else if (hit.span.end) {
      const r = spanToWeeks(hit.span.start, hit.span.end)
      weeks = r.weeks
      if (weeks === undefined) flags.push('missingDate')
      else if (!r.whole) flags.push('nonWholeWeek')
    }
    if (startDate && hit.span.start.getDay() !== 4) flags.push('nonThursdayStart')

    // 描述與獎勵：從名稱行到下一個時間行之間的段落
    // 區塊終點：下一個時間行，或先遇到的段落標題／下一個活動標題。
    //
    // 後兩者缺一不可：
    //   · 停在段落標題 → 不會把「注意事項／領獎範例」的尾巴樣板吞進 description
    //   · 停在活動標題 → 不會把**下一個活動的名字**吞進本活動的 description
    //     （下一個標題就在下一個時間行之前，只用時間行當界線必然越界）
    let blockEnd = seq + 1 < timeHits.length ? timeHits[seq + 1].line : lines.length
    for (let i = hit.line + 1; i < blockEnd; i++) {
      if (Object.prototype.hasOwnProperty.call(SECTIONS, lines[i]) || isHeadingCandidate(lines[i])) {
        blockEnd = i
        break
      }
    }
    const blockLines = []
    for (let i = hit.line + 1; i < blockEnd; i++) {
      if (!lines[i] || NOISE_LINE.test(lines[i])) { claimed[i] = true; continue }
      if (/^\d+[、.]|^[※➤]|^可獲得|概率|保障|請見遊戲/.test(lines[i])) { claimed[i] = true; continue }
      blockLines.push(lines[i])
      claimed[i] = true
    }
    const blockText = blockLines.join('\n')
    const description = blockText.slice(0, 400) || undefined
    const rewards = parseRewards(blockText)

    // 實體名：卡池段落才填，一般活動的 「」 多半是獎勵不是機師
    let pilots, mechs
    if (type === 'specificPilotBanner' && heading.entities.length) {
      pilots = heading.entities
      pilotNamed++
    }
    if ((type === 'specificMechBanner' || type === 'crossShipping') && heading.entities.length) {
      mechs = heading.entities
      mechNamed++
    }

    const excerptStart = offsets[headIdx >= 0 ? headIdx : hit.line]
    const excerpt = rawLines
      .slice(headIdx >= 0 ? headIdx : hit.line, Math.min(blockEnd, hit.line + 8))
      .join('\n')
      .slice(0, 800)

    const extracted = {
      name: heading.name,
      startDate,
      weeks,
      type,
      pilots,
      mechs,
      rewards,
      description,
      sourceUrl: sourceUrl || undefined,
      // 台版公告是官方一手來源 → 一律 confirmed。陸版靠人工推估，填 predicted。
      confidence: 'confirmed',
      typeLabel,
    }
    for (const k of Object.keys(extracted)) if (extracted[k] === undefined) delete extracted[k]

    // 刻意不收錄的型別：到這裡為止該認領的行都已認領完（所以不會漏進 unmatched），
    // 只是不產出待審項目。seq 仍取自 timeHits 的索引，故其餘項目的文件 ID 不受影響。
    if (type && EXCLUDED_TYPES.has(type)) {
      excluded++
      continue
    }

    activities.push({ seq, extracted, flags, excerpt, excerptStart, rawTypeLabel })
  }

  // ④ 未認領的「有意義」原文
  //    只收帶 【】「」 或日期的行 —— 全收會被抽獎規則說明淹沒，
  //    後台標紅的價值就沒了（滿頁都紅等於沒有紅）。
  const unmatched = []
  for (let i = 0; i < lines.length; i++) {
    if (claimed[i] || !lines[i]) continue
    if (NOISE_LINE.test(lines[i])) continue
    if (!/【|「|\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(lines[i])) continue
    if (/^\d+[、.]|^[※➤]/.test(lines[i])) continue
    const h = parseHeadingLine(lines[i])
    if (h.brackets.length && h.brackets.every(b => BOILERPLATE_NAMES.test(b))) continue
    unmatched.push(lines[i].slice(0, 200))
    if (unmatched.length >= 30) break
  }

  // ⑤ 整篇層級告警（任務 2-6）
  const warnings = []
  // 用「解析出來的總數」而非「收錄的數量」：不收錄是我們自己的決定，
  // 拿它去判斷解析器有沒有瞎掉，等於用自己的過濾規則污染自己的體檢報告。
  if (isWeekly && activities.length + excluded < 2) warnings.push('lowYield')
  if (sawPilotSection && pilotNamed === 0) warnings.push('pilotSectionNoName')
  if (sawMechSection && mechNamed === 0) warnings.push('mechSectionNoName')

  // 有 flag 的活動要人工看一眼；沒有的可直接放行
  for (const a of activities) a.status = a.flags.length ? 'needsReview' : 'parsed'

  return { activities, unmatched, warnings, excluded }
}
