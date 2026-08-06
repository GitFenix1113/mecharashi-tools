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
