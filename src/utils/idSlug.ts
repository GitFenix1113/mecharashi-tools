// 文件 ID slug 工具 (PLAN-020)
// 後台建立實體時由系統依名稱自動生成 Firestore 文件 ID (如 buff_<slug(name)>), 維護者只輸入名稱.
//
// sanitize 規則對齊 scripts/scrape-pilots-v3.js 的 safeName，保留的字元範圍 (以 code point 表示，
// 維持源碼純 ASCII、避免全形空白 U+3000 觸發 no-irregular-whitespace)：
//   0x4e00-0x9fa5 中文、0x30-0x39 數字、0x41-0x5a / 0x61-0x7a 英文、
//   0x3000-0x303f CJK 符號與標點、0xff00-0xffef 半／全形變體區；
// 其餘 (半形空白、ASCII 標點、斜線等 Firestore 文件 ID 不合法或易歧異字元) 一律去除。

/** 該 code point 是否屬於允許保留的字元範圍。 */
function isKept(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fa5) || // CJK 中文
    (cp >= 0x30 && cp <= 0x39) ||     // 0-9
    (cp >= 0x41 && cp <= 0x5a) ||     // A-Z
    (cp >= 0x61 && cp <= 0x7a) ||     // a-z
    (cp >= 0x3000 && cp <= 0x303f) || // CJK 符號與標點
    (cp >= 0xff00 && cp <= 0xffef)    // 半／全形變體
  )
}

/** 將名稱轉成 slug (去除不合法字元)。名稱無有效字元時回傳空字串。 */
export function slugify(name: string): string {
  let out = ''
  for (const ch of name.trim()) {
    const cp = ch.codePointAt(0)
    if (cp !== undefined && isKept(cp)) out += ch
  }
  return out
}

/**
 * 剝除使用者在「名稱」欄位誤打的 ID 前綴（不分大小寫、可連續重複），保留其餘原樣。
 * 例：stripIdPrefix('buff', 'buff_虛粒子形態') -> '虛粒子形態'
 *     stripIdPrefix('buff', 'BUFF_buff_星爆') -> '星爆'
 *     stripIdPrefix('buff', 'buffalo')        -> 'buffalo'（無底線，不誤剝）
 * 必須在 slugify 之前呼叫——slugify 會去掉底線，之後就偵測不到前綴。
 */
export function stripIdPrefix(prefix: string, name: string): string {
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return name.trim().replace(new RegExp(`^(?:${esc}_+)+`, 'i'), '').trim()
}

/**
 * 依命名規則生成實體文件 ID：`${prefix}_${slugify(name)}`。
 * 會先剝除使用者誤打的前綴（避免 buff_buff_xxx），再 slugify。
 * 若名稱清理後為空 (無法產生有效 slug)，回傳空字串，方便呼叫端擋下，
 * 不會生出僅有前綴的 `buff_` 這類無效 ID。
 *
 * 例：makeEntityId('buff', '虛粒子形態')      -> 'buff_虛粒子形態'
 *     makeEntityId('buff', 'buff_虛粒子形態') -> 'buff_虛粒子形態'（誤打前綴自動消除）
 */
export function makeEntityId(prefix: string, name: string): string {
  const slug = slugify(stripIdPrefix(prefix, name))
  return slug ? `${prefix}_${slug}` : ''
}

// ─── 帶流水號的 ID（weapons 慣例）──────────────────────────────────────────────
//
// 多數集合是 `<prefix>_<slug>`，但 weapons 的既有 168 筆是 `weapon_<3位流水號>_<slug>`
// （`weapon_163_貝奧武夫_改_`），來自爬蟲當初以「API 清單位置 + 1」編號。
// 後台建立時沒有 API 清單可依循，改以「既有 ID 的最大流水號 + 1」續號，讓新舊長相一致。
//
// ⚠ 副作用：同一個名稱在不同流水號下會生出不同 ID（`weapon_169_X` vs `weapon_170_X`），
//   所以**撞 ID 檢查對重複建立完全無效**——擋重複的是 findEntityClash 的 **name** 維度。
//   呼叫端務必傳 getName，且 existingItems 要是全集合（非當前分頁）。

/**
 * 剝除 `<prefix>_` 前綴與其後的流水號段。
 * 例：stripNumberedIdPrefix('weapon', 'weapon_163_貝奧武夫') -> '貝奧武夫'
 *     stripNumberedIdPrefix('weapon', 'weapon_天燼審判')      -> '天燼審判'
 *     stripNumberedIdPrefix('weapon', '163_貝奧武夫')          -> '貝奧武夫'（前綴漏打也吃）
 */
export function stripNumberedIdPrefix(prefix: string, name: string): string {
  return stripIdPrefix(prefix, name).replace(/^\d+_+/, '').trim()
}

/**
 * 掃既有 ID，取出 `<prefix>_<數字>_` 的最大流水號；一筆都沒有時回傳 0。
 * 不合形狀的 ID（無前綴的 `天燼審判`、無流水號的 `weapon_X`）一律忽略，不影響續號。
 */
export function maxEntitySeq(prefix: string, ids: readonly string[]): number {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)_`, 'i')
  let max = 0
  for (const id of ids) {
    const m = re.exec(id ?? '')
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n }
  }
  return max
}

/**
 * 依命名規則生成帶流水號的實體 ID：`${prefix}_${seq}_${slugify(name)}`。
 * seq 由呼叫端算好傳入（通常是 `maxEntitySeq(...) + 1`），避免每次輸入都重掃全集合。
 * 名稱清理後為空時回傳空字串，讓呼叫端擋下。
 *
 * 例：makeNumberedEntityId('weapon', '天燼審判', 169) -> 'weapon_169_天燼審判'
 */
export function makeNumberedEntityId(prefix: string, name: string, seq: number, pad = 3): string {
  const slug = slugify(stripNumberedIdPrefix(prefix, name))
  return slug ? `${prefix}_${String(seq).padStart(pad, '0')}_${slug}` : ''
}

/**
 * 同一個名稱在「前綴大小寫」上的所有可能 ID（含原值，已去重、原值排首位）。
 *
 * 為什麼需要這支（PLAN-032 M0）：Firestore 文件 ID **區分大小寫**，
 * `SKILL_故障植入` 與 `skill_故障植入` 是兩份不同的文件；而技能庫是歷史遺留的混血
 * （`SKILL_` 大寫 134 筆 / `skill_` 小寫 512 筆），makeEntityId 卻只產得出小寫形式。
 * 後台建立前只用 makeEntityId 的結果去 docExists，等於對大寫那批完全沒有防呆，
 * 會放行建出同名第二份——正是引用化要消滅的東西。
 *
 * 這是**防呆用**的候選清單，不是 ID 正規化。把大寫那批真的改名（含同步所有引用它的
 * refId）成本高得多，另立 follow-up。
 *
 * 例：idPrefixCasings('skill_故障植入') -> ['skill_故障植入', 'SKILL_故障植入']
 *     idPrefixCasings('60102405')       -> ['60102405']（無底線前綴，原樣單筆）
 */
export function idPrefixCasings(id: string): string[] {
  const at = id.indexOf('_')
  if (at <= 0) return id ? [id] : []
  const prefix = id.slice(0, at)
  const rest   = id.slice(at)
  return [...new Set([prefix, prefix.toLowerCase(), prefix.toUpperCase()])].map((p) => p + rest)
}

// ─── 撞名判定（PLAN-032 follow-up 1b）────────────────────────────────────────

/** 撞名結果：命中的既有項目 + 是循哪個維度撞到的。 */
export interface EntityClash<T> {
  item: T
  by: 'id' | 'name'
}

/**
 * 後台建立新實體時的撞名判定。**同時查 ID 與名稱兩個維度。**
 *
 * 為什麼不能只查 ID：ID 是「建立當下」由名稱推導的快照，之後改名只會改 name 欄位、
 * **ID 留著舊寫法**。實測技能庫 852 筆裡有 20 筆這種 id/name 漂移：
 *   skill_先鋒型態 → name 已改成「先鋒形態」
 *   skill_嵐循環   → name 已改成「嵐迴圈」
 *   skill_ALL IN  → 名稱含空格，slugify 產出 skill_ALLIN，推不回來
 *   skill_∑-04Ω   → 符號全被 slugify 剝掉，產出無意義的 skill_04
 * 這些 doc 的 ID 都推不回來 → 只查 ID 就看不到 → 靜默建出同名第二份。
 *
 * 為什麼不改去正規化那 20 個 ID：要同步改所有引用它的 refId（實測 178 處），
 * 而且只要日後再有人改名，同樣的洞就會重新長出來。查 name 對 ID 長相完全免疫。
 *
 * ID 比對**不分大小寫**：Firestore 文件 ID 區分大小寫，`buff_x` 與 `BUFF_x` 是兩份文件，
 * 放行就會製造大小寫孿生（實測技能庫已有 5 組，正是這個洞的產物）。
 *
 * ID 優先於 name：ID 撞到時錯誤訊息能精確指出是哪一份文件。
 */
export function findEntityClash<T>(
  items: readonly T[],
  accessors: { getId: (item: T) => string; getName?: (item: T) => string },
  id: string,
  name: string,
): EntityClash<T> | null {
  const { getId, getName } = accessors
  const lowerId = id.trim().toLowerCase()
  if (lowerId) {
    const byId = items.find((it) => (getId(it) ?? '').trim().toLowerCase() === lowerId)
    if (byId) return { item: byId, by: 'id' }
  }
  if (!getName) return null
  const lowerName = name.trim().toLowerCase()
  if (!lowerName) return null
  const byName = items.find((it) => (getName(it) ?? '').trim().toLowerCase() === lowerName)
  return byName ? { item: byName, by: 'name' } : null
}
