// 數值引用層核心 util (PLAN-022)
//
// 讓描述正文裡的「層數 / 回合數」綁定 buff 屬性，根除「正文寫 7、buff.maxStack 是 5」這類
// 同一個數字存兩份必然漂移的問題 (PLAN-021 驗收時抓到的真實 bug)。三層架構：
//
//   編輯期語法糖  →（compileSugar 編譯，按鈕觸發）→  儲存的正式 token  →（resolveNumRefs）→  顯示真值
//   可疊加$1層                                        可疊加<buff_凝勢I.maxStack>層            可疊加5層
//
//  · 語法糖 $n / %n 永不落地：n = 描述中第 n 個「有引用的 [xxx]」(見 orderRefsByFirstMention)，
//    僅在編輯當下成立，按鈕當場編譯成正式 token，「編號對齊」的脆弱性被限制在編輯期。
//  · 正式 token <refId.attr> 自描述：內含目標實體與屬性，每個 token 獨立解析、不靠出現位置與次數，
//    同一個 token 可重複出現不限次數。
//  · 顯示讀真值：前台從 GameDataContext (PLAN-016 已全量預載) 查 refId 取屬性，數字只有 buff 一份。
//
// ⚠ **不變式自 PLAN-034 起修訂**（地雷六）。上面第二點原本寫的是
//   「token 自描述、不靠出現位置」，自本計畫起精確化為：
//
//       token 自描述其**基準階**；實際顯示階可被情境層（神經驅動算力覆寫）抬升。
//
//   也就是資料庫寫 <buff_凝勢.lv1.maxStack>、buff lv1.maxStack=5，畫面卻可能顯示 7。
//   等級來源因此從兩個（token 的 .lvN、EntityRef.level）變成三個（多了 ND 覆寫）。
//   「不靠出現位置」本身仍然成立：抬升由 levelOf 這個**顯式參數**決定，不是由 token
//   在文中的次序決定；不傳 levelOf 的呼叫端（後台、其餘 19 個 RefText 站點）
//   行為與 PLAN-022 byte-identical。被抬升的 token 必須在 UI 標明來源，
//   否則使用者無從得知畫面數字與資料庫值不同（NumRefValue 的 title 負責這件事）。
//
// 純函式、無 React / Firestore 依賴，可單測 (npm test)。token 失效一律優雅降級，比照 [xxx] 慣例。

import type { DescriptionRefs } from '../types'
import { pickLevel, type NumLevelOf } from './ndOverrides.ts'

export type { NumLevelOf }

// ─── 屬性註冊表 (registry)：單一資料源，所有層都從它驅動 ──────────────────────────
// 新增一種可綁屬性 = 加一筆；解析、編譯、降級、(未來) 挑選器按鈕全部自動跟上。
// 語法糖符號 ($、% 之後難記) 是稀缺資源，故僅高頻屬性配 sigil；低頻屬性可省略 sigil，
// 改走「選取數字 → 下拉選屬性」的純 UI 路徑 (Phase C)，registry 兩邊通吃。

/** registry 取值對象的結構型別 (GameBuff 等實體可結構化代入)。新增屬性時於此補欄位。 */
export interface NumRefSource {
  /** 可疊加層數 */
  maxStack?: number
  /** 持續回合 */
  duration?: number
  /** 生效次數 */
  maxTriggers?: number
  /** 階梯 buff 各級（PLAN-024）；<id.lvN.attr> 以 level 值比對取屬性，見 pickLevel */
  levels?: NumRefLevel[]
}

/**
 * levels[] 的元素必須自帶 level 值（PLAN-034 B-3）。
 * 原本取級寫的是 levels[N-1]，但實測正式資料已有非連號／亂序的 levels
 * （buff_迴避率提升 levels=[3,4]、buff_迴避率降低 levels=[2,3,5,4]）——索引式取級是錯的。
 */
export interface NumRefLevel extends NumRefSource {
  level: number
}

/** 由 refId 取得可供取值的實體；查無 (被刪 / 改 ID) 回傳 undefined → 優雅降級。 */
export type NumRefLookup = (refId: string) => NumRefSource | undefined

export interface NumAttrDef {
  /** 語法糖符號；高頻屬性才配 (省略則僅能走 UI 選單代入)。 */
  sigil?: string
  /** 顯示 / 挑選器標籤。 */
  label: string
  /** 適用的 refType (如 ['buff'])，供挑選器過濾可綁對象。 */
  refTypes: string[]
  /** 從實體取出該屬性數值；無值回傳 undefined。 */
  get: (e: NumRefSource) => number | undefined
}

export const NUM_ATTRS: Record<string, NumAttrDef> = {
  maxStack: { sigil: '$', label: '可疊加層數', refTypes: ['buff'], get: (e) => e.maxStack },
  duration: { sigil: '%', label: '持續回合', refTypes: ['buff'], get: (e) => e.duration },
  maxTriggers: { sigil: '#', label: '生效次數', refTypes: ['buff'], get: (e) => e.maxTriggers },
  // 未來：cd: { label: '冷卻回合', refTypes: ['skill'], get: e => e.cd } —— 低頻可不配 sigil，走 UI 選單。
}

// ─── 正式 token 格式：<refId(.lvN)?.attr> ────────────────────────────────────────
// refId 為實體文件 ID (slugify 後，含中英數與底線、無 '.'，如 buff_凝勢I / buff_凝勢)；
// 選填 .lvN 段 (PLAN-024)：指定階梯 buff 第 N 級，如 <buff_凝勢.lv3.maxStack>；無 lv 段 = 取頂層 (普通 buff)。
// attr 為 NUM_ATTRS 的鍵 (ASCII)。token 自描述、可重複，不依賴出現位置。
const NUM_REF_RE = '<([^<>.]+)(?:\\.lv(\\d+))?\\.([A-Za-z][A-Za-z0-9]*)>'

/** [xxx] 實體引用標記 (對齊 RefText 的 tokenizer)。 */
const KEYWORD_RE = '\\[([^\\]]+)\\]'

/** 跳脫字串中的正則特殊字元，供動態組正則用。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── 解析 / 顯示 (供 RefText、DiffHighlight) ─────────────────────────────────────

/** 是否含至少一個 <refId.attr> 數值引用 token；供前台決定是否需懶載 buffs。 */
export function hasNumRef(text: string): boolean {
  return new RegExp(NUM_REF_RE).test(text)
}

export type NumRefSegment =
  | { type: 'text'; value: string }
  | { type: 'numRef'; raw: string; refId: string; attr: string; level?: number }

/**
 * 將正文切成 text / numRef 片段，供 RefText 結構化渲染 (每個 numRef 各自決定顯示真值或暗色 ?)。
 * 非 token 片段原樣保留，後續可再交給既有的 [xxx] / 數字高亮處理。
 */
export function parseNumRefs(text: string): NumRefSegment[] {
  const segments: NumRefSegment[] = []
  const re = new RegExp(NUM_REF_RE, 'g')
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) segments.push({ type: 'text', value: text.slice(lastIndex, m.index) })
    segments.push(
      m[2]
        ? { type: 'numRef', raw: m[0], refId: m[1], attr: m[3], level: Number(m[2]) }
        : { type: 'numRef', raw: m[0], refId: m[1], attr: m[3] },
    )
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < text.length) segments.push({ type: 'text', value: text.slice(lastIndex) })
  return segments
}

/**
 * 解析單一 token 的真值。attr 不在 registry、refId 查無、或屬性無值 → undefined (呼叫端決定降級樣式)。
 *
 * @param level  token 自帶的 .lvN，即**基準階**；省略 = 無 lv 段，取頂層（普通 buff）。
 * @param levelOf 情境層取級（PLAN-034 F-1）。省略 = 恆用基準階，行為與 PLAN-022 完全相同。
 */
export function resolveNumValue(
  refId: string,
  attr: string,
  lookup: NumRefLookup,
  level?: number,
  levelOf?: NumLevelOf,
): number | undefined {
  const def = NUM_ATTRS[attr]
  if (!def) return undefined
  const entity = lookup(refId)
  if (!entity) return undefined

  // 有 lvN 段 → 取該級（以 level 值比對，非索引）；查無 / 無 levels → undefined。無 lv 段取頂層。
  const read = (n: number | undefined): number | undefined => {
    const source = n != null ? pickLevel(entity.levels, n) : entity
    if (!source) return undefined
    const v = def.get(source)
    return typeof v === 'number' ? v : undefined
  }

  const eff = levelOf?.(refId, level)?.level ?? level
  const v = read(eff)
  // **抬升後查無該級、或該級缺該欄位 → 退回基準階的值，絕不劣化成 '?'。**
  // 階梯 buff 的各級不保證欄位齊全：實測 buff_隱形 lv1 有 duration:2 而 lv2/lv3 完全沒有。
  // 少了這行，抬升會把一個本來顯示得出數字的 token 變成暗色 ?——使用者的感受是
  // 「調高算力反而讓資料消失」，比不抬升更糟。
  if (v === undefined && eff !== level) return read(level)
  return v
}

/**
 * 將正文中所有 <refId.attr> 代換為解析後的真值字串，回傳純文字。
 * 供 DiffHighlight 前處理 (base / enhanced 先解析再 tokenize，5→7 照常被 LCS 標紅)。
 * 解析失敗的 token 代換為 fallback (預設 '?')；RefText 需要分辨降級樣式時改用 parseNumRefs。
 *
 * levelOf 必須與 RefText 傳的是同一份（PLAN-034 F-2），否則會出現
 * 「開高亮時顯示 7、關掉變 5」這種只在某個 UI 開關下才對的畫面。
 */
export function resolveNumRefs(
  text: string,
  lookup: NumRefLookup,
  fallback = '?',
  levelOf?: NumLevelOf,
): string {
  return parseNumRefs(text)
    .map((seg) => {
      if (seg.type === 'text') return seg.value
      const v = resolveNumValue(seg.refId, seg.attr, lookup, seg.level, levelOf)
      return v === undefined ? fallback : String(v)
    })
    .join('')
}

// ─── 凍結：來源即將被刪除時把真值烘焙進正文 (PLAN-030 C-3) ────────────────────────

/**
 * 把正文中**指向 targetId** 的 token 就地烘焙成常數，其餘 token 原樣保留。
 *   "可疊加<buff_凝勢.lv3.maxStack>層" → "可疊加7層"
 *
 * 這是刪除實體時唯一無法「外科手術式移除」的引用形態——另外四類都是結構化欄位，
 * 只有它內嵌在字串裡。解法是凍結而非移除：趁來源還在，先把值固定下來 (決策六)。
 *
 * **為什麼不直接用 resolveNumRefs**：那支無差別替換**所有** token。一段文案裡常有
 * 多個 token 指向不同 buff，全部烘焙會把無辜的引用一併變成死數字——日後那些 buff
 * 改了數值，正文就再也不會跟著更新，而且沒有任何跡象顯示它曾經是引用。
 *
 * @param source 被刪實體本身。**刻意收實體而非 NumRefLookup**：只有指向 targetId 的
 *               token 會被凍結，收 lookup 只是給呼叫端誤傳全站查詢、波及他人的機會。
 *               查無實體時傳 undefined，該實體的 token 全數降級為 fallback。
 * @returns text 凍結後正文；unresolved 取不到值而被寫成 fallback 的 token 原文
 */
export function freezeNumRefs(
  text: string,
  targetId: string,
  source: NumRefSource | undefined,
  fallback = '?',
): { text: string; unresolved: string[] } {
  const unresolved: string[] = []
  const frozen = parseNumRefs(text)
    .map((seg) => {
      if (seg.type === 'text') return seg.value
      if (seg.refId !== targetId) return seg.raw       // 指向別人的 token：原樣保留
      // 借用 resolveNumValue 以共用 registry / .lvN 取級邏輯，lookup 恆回同一實體。
      // **刻意不傳 levelOf（PLAN-034）**：抬升是「某位機師的某個算力配置」下才成立的情境值，
      // 而凍結寫回的是全站共用的正文。把抬升值烘焙進去，等於把一位機師的配裝狀態
      // 變成所有人看到的死數字。凍結一律取基準階。
      const v = source === undefined
        ? undefined
        : resolveNumValue(targetId, seg.attr, () => source, seg.level)
      if (v === undefined) {
        // 取不到值的 token 在刪除前就已經顯示為暗色 '?' (RefText 的優雅降級)，
        // 故寫成 fallback 視覺上等價；但仍回報，讓管理員知道有文案失去了數值。
        unresolved.push(seg.raw)
        return fallback
      }
      return String(v)
    })
    .join('')
  return { text: frozen, unresolved }
}

// ─── 編譯期：語法糖 → 正式 token (供 Phase C 的 RefPicker「代入數值」按鈕 / seed 腳本) ──────

/**
 * 取得正文中「有引用的 [xxx]」依首次出現排序的 refId 清單，作為 $n / %n 的 n 對照表
 * (對齊 RefPicker 顯示的編號清單)。
 *  · 依關鍵詞 (keyword) 去重：同一個 [xxx] 出現多次只算一次。
 *  · 略過 refs 查無的 [xxx] (無資料源、不可綁屬性)，使編號與「可綁清單」一致。
 *  · 階梯 buff (EntityRef.level) → refId 帶 .lvN 段，compileSugar 直接拼成 <refId.lvN.attr> (PLAN-024)。
 */
export function orderRefsByFirstMention(text: string, refs: DescriptionRefs): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const re = new RegExp(KEYWORD_RE, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const kw = m[1]
    if (seen.has(kw)) continue
    seen.add(kw)
    const ref = refs?.[kw]
    // 階梯 buff（ref.level）→ 帶 .lvN 段，使 compileSugar 直接拼出 <refId.lvN.attr>（PLAN-024）。
    if (ref?.refId) out.push(ref.level != null ? `${ref.refId}.lv${ref.level}` : ref.refId)
  }
  return out
}

/**
 * 把編輯期語法糖編譯成正式 token：依 registry 的 sigil，將 <sigil>n 換成 <orderedRefs[n-1].attr>。
 *  · n 超出 orderedRefs 範圍 (對不到引用) → 原樣保留，交給 detectLeftoverSugar 警告。
 *  · 僅符號後緊跟數字才算語法糖：'%1' 會被編譯，'15%' (百分比) 不會誤判。
 */
export function compileSugar(text: string, orderedRefs: string[]): string {
  let out = text
  for (const attr of Object.keys(NUM_ATTRS)) {
    const sigil = NUM_ATTRS[attr].sigil
    if (!sigil) continue
    const re = new RegExp(escapeRegExp(sigil) + '(\\d+)', 'g')
    out = out.replace(re, (whole, numStr: string) => {
      const refId = orderedRefs[parseInt(numStr, 10) - 1]
      return refId ? `<${refId}.${attr}>` : whole
    })
  }
  return out
}

/**
 * 偵測仍未代入的語法糖標記 (儲存前防呆：「尚有 N 個未代入的數值標記」)。
 * 同樣只認「符號 + 數字」，百分比 (50% / 15%) 不會被誤報。
 */
export function detectLeftoverSugar(text: string): string[] {
  const sigils = Object.values(NUM_ATTRS)
    .map((d) => d.sigil)
    .filter((s): s is string => !!s)
  if (sigils.length === 0) return []
  const cls = sigils.map((s) => s.replace(/[\]^\\-]/g, '\\$&')).join('')
  const re = new RegExp('[' + cls + ']\\d+', 'g')
  return text.match(re) ?? []
}
