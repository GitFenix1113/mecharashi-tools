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
// 純函式、無 React / Firestore 依賴，可單測 (npm test)。token 失效一律優雅降級，比照 [xxx] 慣例。

import type { DescriptionRefs } from '../types'

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
  /** 階梯 buff 各級（PLAN-024）；<id.lvN.attr> 從 levels[N-1] 取屬性 */
  levels?: NumRefSource[]
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
 */
export function resolveNumValue(refId: string, attr: string, lookup: NumRefLookup, level?: number): number | undefined {
  const def = NUM_ATTRS[attr]
  if (!def) return undefined
  const entity = lookup(refId)
  if (!entity) return undefined
  // 有 lvN 段 → 取該級 (levels[N-1])；超範圍 / 無 levels → 降級 undefined。無 lv 段取頂層。
  const source = level != null ? entity.levels?.[level - 1] : entity
  if (!source) return undefined
  const v = def.get(source)
  return typeof v === 'number' ? v : undefined
}

/**
 * 將正文中所有 <refId.attr> 代換為解析後的真值字串，回傳純文字。
 * 供 DiffHighlight 前處理 (base / enhanced 先解析再 tokenize，5→7 照常被 LCS 標紅)。
 * 解析失敗的 token 代換為 fallback (預設 '?')；RefText 需要分辨降級樣式時改用 parseNumRefs。
 */
export function resolveNumRefs(text: string, lookup: NumRefLookup, fallback = '?'): string {
  return parseNumRefs(text)
    .map((seg) => {
      if (seg.type === 'text') return seg.value
      const v = resolveNumValue(seg.refId, seg.attr, lookup, seg.level)
      return v === undefined ? fallback : String(v)
    })
    .join('')
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
