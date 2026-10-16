// ─── 機甲廠商 mechMakers（PLAN-042-B 決策 B-8）────────────────────────────────
//
// 機甲故事館的廠商：名冊依廠商分組、卷宗標題列出廠商、鑑賞模式用廠商舞台當背景。
// 遊戲目前沒有任何廠商相關的機制或加成（站長 10-16 確認），所以住故事館、不住 mechs。
// 站長要能在後台編輯、日後隨改版新增，因此是集合而不是靜態表；做法比照 factionEmblems（PLAN-042-F）。
//
// 文件 ID＝官方舞台背景鍵（`Doll`、`Laniakea`、`UKB`…），與 `Skynet_Wap_BG_<key>_Raw` 一致；
// 每台機甲在 `mechLore.maker` 存這個 ID。
//
// 不違反 042-F「不做陣營字典」：陣營會隨劇情變，機甲的出廠廠商不會變。

export interface MechMaker {
  /** 官方舞台背景鍵，例 `'Doll'`（＝ `Skynet_Wap_BG_Doll_Raw`） */
  id: string
  /** 中文名，例「多爾」。空＝前台顯示「廠商未載」（UKB 目前就是） */
  name?: string
  /** 英文名，例 `DOLL` */
  nameEn?: string
  /**
   * 徽章：官方檔名、**含變體**，例 `'Icon_logo_0021_00'`。圖在 `public/images/game/icons/camp/`，
   * 選圖沿用 `FactionLogoPicker`；`_00` 單色／`_01` 彩色的顯示規則同 `PilotLoreDoc.factionLogos`。
   */
  logo?: string
  /**
   * 舞台背景鍵。空＝用 `id`（官方 12 家都是這樣）。
   * 只有後台手動新增、ID 不是官方背景鍵的廠商才需要填，例如沿用別家的背景。
   */
  stage?: string
  /**
   * 型號前綴，例 `['DD']`、`['KX', 'KXM']`。只給草稿腳本與編輯台做**建議**，不做自動指派——
   * 前綴對不上廠商的例外約 15 台（REV／NED／聯動機甲等），一律人工判。
   */
  modelPrefixes?: string[]
  /** 名冊分組的排序，小的在前。空＝排在有值的後面、依 id 排 */
  order?: number
  /** 給管理員看的備註（例：中文名待確認） */
  note?: string
}
