// ─── 陣營徽章註記 factionEmblems（PLAN-042-F）──────────────────────────────────
//
// 替「徽章本身」做的註記：這顆徽章叫什麼、圖上寫什麼字。**不是**「陣營 → 徽章」字典——
// 每位機師的徽章仍由管理員在故事館編輯台逐位挑選（pilotLore.factionLogos），這裡只讓選圖器看得懂。
// PLAN-059 決策六原本完全不做對照；2026-10-14 站長拍板改成這個形狀（PLAN-042-F 決策四）。
//
// 文件 ID＝徽章編號 4 碼（'0025'），單色 `_00`／彩色 `_01` 兩個變體共用一份。
// 圖庫裡有、DB 沒有文件的編號＝「未命名」，照樣能選。

export interface FactionEmblem {
  /** 徽章編號 4 碼，例 `'0025'`（＝ `Icon_logo_0025_00／_01`） */
  id: string
  /** 陣營名稱（中文），例「晨星同盟防衛軍」：選圖器卡片標題、卷宗的徽章提示 */
  name?: string
  /**
   * 陣營英文名，例 `DAWNSTAR LEAGUE ARMORED FORCE`（站長 2026-10-14：中英文都要留）。
   * 與 `inscription` 分開：圖上的字不一定就是名字（0025 還多一行 DEPARTMENT OF THE DEFENCE FORCE、
   * 0039 圖上是 AP · TALOS DEFENSE FORCE、中文卻是「亞太戰區精神力機甲作戰部隊」）。
   */
  nameEn?: string
  /** 圖上字樣（原文照抄）：辨識、搜尋與佐證用 */
  inscription?: string
  /**
   * 對應的陣營文字：機師 `pilots.faction` 的**原字串**（可多筆），例 `['亞太戰區']`。
   * 只用來把這顆徽章排到選圖器的建議區——**不會**自動寫進任何機師的 pilotLore。
   * 名稱本身和陣營文字一字不差時不必再填（`name` 也算比對對象）。
   */
  factions?: string[]
  /** 給管理員看的備註（例：看字樣猜的、待確認） */
  note?: string
}
