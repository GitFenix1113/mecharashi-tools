// ─── 故事館 lore（PLAN-042 總綱決策三）─────────────────────────────────────────
//
// **型別共用（本檔），集合分家（pilotLore / mechLore）。**
// 章節、旁白、外觀設定在兩館之間完全同構（speakerId → pilots 對機甲與機師都成立）；
// 文件本身拆成共同底座 `LoreDocBase` ＋ 兩館擴充（PLAN-042-B 決策 B-3）——
// 人物檔案、陣營徽章只屬於機師，型號、廠商、系譜只屬於機甲。但集合不可合一：
// 版本 gate 是集合級（lib/api/versions.ts）、Worker 也只有整包端點（無單文件路由）。
// 合一的後果是「改一台機甲的 PART 2 → 機師故事館的快取一起失效」
// 「看一位機師的故事 → 連 90 台機甲的逸聞一起下載」。
//
// ⚠ 本檔**刻意沒有** subject / kind 之類的 discriminated union 欄位。
//   「這份逸聞屬於機師還是機甲」已由**它住在哪個集合**完整表達，再存一次就是第二個真相源，
//   而且 repo 內沒有 exhaustive 檢查的既有慣例（要自己補 assertNever）。
//   union 的成本會在沒有任何消費端的情況下先付掉。
//
// ⚠ 故事館全程**不新增 RefType**。common.ts 逐字列出新增 RefType 要補五處窮舉消費端，
//   其中 RefPicker 的 REF_TYPE_OPTIONS 是手寫陣列、漏了不報錯。
//   故 speakerId 只允許指向 pilots，且沒有任何欄位可以指向「一篇逸聞」。

import type { DescriptionRefs } from './common'

/**
 * 自訂說話者（2026-10-14）：說這句旁白的不是任何一位機師——遊戲裡的「匿名使用者」、劇情 NPC 這類。
 *
 * 名稱是**純文字快照**、頭像只存 NPC 圖庫的立繪鍵，兩者都不是引用：
 * 總綱決策三「不開新 RefType、speakerId 只准指 pilots」照舊成立，這裡沒有任何東西指向另一份文件。
 * 同一位 NPC 在多篇故事裡重複出現時，靠後台的名稱建議（`customSpeakerPresets()`）維持寫法一致，
 * 不另開「NPC 說話者」集合——今天只有零星幾句，集合會是 0/5 定律說的那種空殼。
 */
export interface LoreCustomSpeaker {
  /** 顯示名稱，如「匿名使用者」。照遊戲畫面逐字填 */
  name: string
  /**
   * 頭像：NPC 圖庫（`public/images/game/npc/`）的官方立繪鍵，如 `Pilot_99999`（匿名使用者的聲波圖）。
   * DB 只存鍵、不存路徑（同 PLAN-055 圖示慣例），讀取端走 `npcGameArt()`。空＝不顯示頭像。
   */
  art?: string
}

/**
 * NPC 旁白列：某位機師（或自訂說話者）對這一章的評註。
 *
 * 說話者二選一：
 *   - **機師**：speakerId 指向 `pilots` 文件 ID（總綱決策三：不開新 RefType，只准指 pilots）。
 *   - **自訂**：有 `speaker` 物件就是自訂說話者，此時 speakerId 是空字串、渲染端不讀。
 *     後台切換模式時會清掉另一邊，不會兩者並存。
 *
 * 查不到說話者時渲染端必須降級為「只顯示 text」而不是整列消失——旁白的內容本身有價值，
 * 說話者頭像沒有就沒有。
 *
 * ⚠ 刻意**不開** textRefs：旁白是短句評註，全站今天沒有任何一段旁白需要 [xxx]。
 *   要開的時候補一個選填欄位是零成本的；先開則是 PLAN-041「0/5 定律」點名的那種
 *   投機性選填欄位（每一個都是空的）。
 */
export interface LoreCommentary {
  /** pilots 文件 ID；自訂說話者時為空字串 */
  speakerId: string
  /** 自訂說話者（非機師）。有值時優先於 speakerId */
  speaker?: LoreCustomSpeaker
  text: string
}

/**
 * 逸聞的一章（官方遊戲內的一個 PART）。
 *
 * ⚠ `key` **必填**（總綱決策五）。網址是唯一真相（`/lore/pilots/:id/:part`），
 *   而網址不可以用陣列索引：日後在 PART 2 後插一章，所有已分享的連結會集體指向
 *   錯誤章節，**而且不報錯**。
 *   也不做 `key?: string` ＋ 索引 fallback —— 加了 fallback 的選填鍵實務上沒人填，
 *   上線跑的就會是那個以索引為底的 fallback。正解是由後台編輯器在新增章節當下
 *   自動產生並寫入（Phase E-1），讓「不填」在資料上不可能發生。
 */
export interface LoreChapter {
  /** 穩定鍵，進網址。後台新增章節時自動產生，必填 */
  key: string
  /** 章節標籤，如 'PART 1'。未設定則由渲染端依索引生成（`PART ${i + 1}`） */
  label?: string
  /** 章節標題，如 '光環遍身' */
  title: string
  /** 正文。支援 PLAN-019 的 [xxx] 引用標記，由 <LoreRichText> 解析（PLAN-042-A 決策 A：
   *  渲染器與 RefText 分家、[xxx] 解析規則逐字相同——不要改回 RefText，那會把數字紅字帶進散文） */
  body: string
  /** 正文內 [xxx] → 實體引用側錄（PLAN-019 Layer 1）。欄位名沿用 `<正文欄位>Refs` 慣例 */
  bodyRefs?: DescriptionRefs
  /**
   * 出處署名，如 '——《週刊米赫瑪·文娛版》'。右對齊小字 ＋ 分隔細線。
   * 一章引了多份資料時，這裡放**最後一份**的出處；中間各份寫在 body 裡、另起一行以 `——` 開頭
   * （行內署名，`inlineSource()`，components/lore/loreText.ts）。
   * 編輯台把這兩處合成「引文段卡片」，每張一個署名欄，存檔時才序列化回來（`joinSections()`，admin/lore/loreEditText.ts）。
   */
  source?: string
  /** NPC 旁白列 */
  commentary?: LoreCommentary[]
  /**
   * 草稿章（PLAN-042-E 決策五）：前台不列出、章節網址導回扉頁、館首頁章節數不計入。
   * 前台一律經 `publishedChapters()`（components/lore/loreText.ts）過濾，不要各自寫 `.filter`。
   *
   * ⚠ 只防「沒寫完的章被讀者看到」，**不是保密**：資料仍整包下載（站長：外洩無妨），
   *   所以不另開只有編輯者讀得到的集合。值只有 `true`——取消草稿就是拿掉欄位，不存 `false`。
   */
  draft?: true
}

/** 人物檔案的一列自訂欄位（原 `pilots.profile.additionalInfo` 的一個鍵）。 */
export interface LoreDossierField {
  /** 標籤，前台直接當顯示文字。完全自由的中文字串（含 ▇▇、■■時間 這類鍵名），同一份檔案內不可重複 */
  label: string
  value: string
}

/**
 * 人物檔案（PLAN-042-E，原 `pilots.profile`）。
 *
 * 性別／身高／血型保留固定欄位：卷宗拿身高當紅色標籤（LoreDossier），編輯台也固定排在最前面。
 * 其餘一律進 `extra`。顯示順序固定三欄 → 陣營（取自 pilots）→ extra，由 `dossierRows()` 統一組出。
 */
export interface LoreDossierInfo {
  gender?: string
  height?: string
  bloodType?: string
  /**
   * 自訂欄位，**陣列順序＝顯示順序**（決策四：原本的 map 不保證鍵序）。
   * 存檔前用 `duplicateLabels()` 擋同名標籤——同名兩列在前台會撞 React key、而且讀者分不出哪個才對。
   */
  extra?: LoreDossierField[]
}

/**
 * 一套外觀的顯示設定（PLAN-042-E 決策六的「動態層」）。
 *
 * 圖檔本身、歸屬哪位機師、清單有哪些 key 都是 build 時決定的（gameArtIndex.ts）；
 * 這裡只管名稱、隱藏、順序，後台存檔就生效。合併規則見 `pilotSkins()`（utils/gameArt.ts）：
 * 沒列在這裡的外觀照舊接在後面、顯示「外觀 N」；列了但圖不存在的 key 直接忽略。
 */
export interface LoreSkinSetting {
  /** 官方圖檔鍵，＝網址 `?skin=` 的值。機師＝立繪鍵（`Pilot_10103146B`）；機甲＝塗裝鍵（`Img_Skin_wap*`） */
  key: string
  /** 顯示名稱；空＝「外觀 N」 */
  name?: string
  /**
   * 前台不列出（例：台版還沒推出）。
   * ⚠ 意思與舊的 pilotSkinMeta.json 不同：以前是「不寫進 build 清單」，現在圖仍在打包檔裡，只是不列——
   *   依「劇透不是顧慮」可以接受（計畫書地雷）。值只有 `true`。
   */
  hidden?: true
}

/**
 * 故事館文件的共同底座（`pilotLore` / `mechLore` 都有的欄位，PLAN-042-B 決策 B-3）。
 * 文件 ID ＝ 對應實體（pilots / mechs）的文件 ID。
 *
 * ── 什麼住這裡（PLAN-042-E 決策一，取代總綱決策二）──────────────────────────
 * 判準是「**與數值、機制有沒有關係**」：有關的留在 pilots／mechs（圖鑑讀），其餘全部住這裡（故事館讀）。
 * 所以簡介、英文名、外觀名稱都在本集合；全名、陣營、職業、立繪、品質留在實體集合（兩館共用的身分欄位）。
 * 總綱原本的「誰是權威來源」判準已經分不出任何東西：官網爬蟲 2026-10-11 退場，所有資料都是人寫的。
 *
 * 依賴是**單向**的（決策二）：故事館讀實體集合的身分欄位，圖鑑不讀本集合。
 * 故事館壞掉、資料還沒填，都不會影響圖鑑。
 */
export interface LoreDocBase {
  /** ＝ pilots / mechs 的文件 ID */
  id: string
  /**
   * 實體名稱快照。給 saveWithHistory 的 targetName 與後台列表用
   * （去正規化：目標被刪後仍看得懂 log 在講誰）。
   */
  name?: string
  /**
   * 扉頁簡介。純文字、換行即分段。
   * 機師：原 `pilots.lore`（PLAN-042-E B-2 搬來）；機甲：原 `mechs.lore`（PLAN-042-B Q2，首行型號已切到 `modelNo`）。
   * 欄位名刻意不叫 `lore`：會和集合名、型別名混在一起（042-E 決策四）。
   * 署名**不在這裡**：搬遷時已從尾端切掉、改存 `frontSource`，所以執行期不必再猜。
   */
  intro?: string
  /**
   * 扉頁署名，例 `——《週刊米赫瑪·文娛版》`。右對齊小字、與正文分開排版。
   * 機師的初值是 042-A 從 `pilots.lore` 尾端抽出的（89 篇中 34 篇帶署名）＋人工複核；
   * 機甲則記介紹文的譯本來源（台版公告譯文 vs 陸版原文，042-B 決策 B-9）。
   */
  frontSource?: string
  /**
   * 英文名（機師原 `pilots.nameEn`）。機師：扉頁壓在立繪旁的毛筆草書、卷宗副標；機甲：卷宗標題副標。兩館都進名冊搜尋。
   * 官方資料沒有這個欄位，人工輸入（「有全名就用全名」）；空值＝不渲染。
   */
  nameEn?: string
  /** 外觀（機師）／塗裝（機甲）的名稱、隱藏、順序（PLAN-042-E E 段）。**陣列順序＝顯示順序** */
  skins?: LoreSkinSetting[]
  /**
   * 卡池名稱：這位機師／這台機甲專屬卡池的活動標題，例「可能性的彼端」（莫比烏斯X）——卷宗最後那張招募插畫卡的標題，
   * 也是鑑賞時的圖名。台版公告「【特選】<卡池名> – S級…機甲「<機甲>」」的那一段，照錄不改字。
   * 空＝前台標題退回「卡池」。新卡池的建議由後台從版本活動（機甲 `specificMechBanner`、機師 `specificPilotBanner`）帶出，站長按一下採用。
   * 機甲 PLAN-042-B 起；機師 PLAN-042-A Phase J（2026-10-17）起，欄位從 MechLoreDoc 移到底座、兩館同義。
   */
  gachaTitle?: string
  /** 逸聞章節（PART 1..N）。**不含扉頁**——扉頁是上面的 intro／frontSource。草稿章見 `LoreChapter.draft` */
  chapters: LoreChapter[]
  /**
   * 版本號（PLAN-042-H 後續：存檔衝突檢查，2026-10-17）。每經編輯台存檔一次 +1，**只由 `saveWithRevision()` 寫**，表單不編它。
   * 編輯面板的表單整份複製文件，所以這個數字就是「我是從第幾版改起的」：存檔時交易內與伺服器現值比對，
   * 不一致＝開啟之後有人存過 → 擋下，不整份蓋掉對方。從草稿還原的表單也帶著當時的版本號，照樣擋得住。
   * 沒有這個欄位＝第 0 版（功能上線前建的文件）。
   *
   * ⚠ 用腳本（Admin SDK）改這兩個集合時**要順手 +1**，否則開著的編輯面板偵測不到、存檔會把腳本的修改蓋回去。
   */
  rev?: number
  /** 最後一次經編輯台存檔的時間（ISO 字串，用戶端時鐘）。只給衝突提示顯示「對方何時存的」，不參與比對 */
  updatedAt?: string
}

/** 機師故事館文件（`pilotLore` 集合）。 */
export interface PilotLoreDoc extends LoreDocBase {
  /** 人物檔案（原 `pilots.profile`）。沒有就不出現個人資料卡 */
  dossier?: LoreDossierInfo
  /**
   * 陣營徽章（PLAN-059 D）：官方檔名、**含變體**，最多 2 個，例 `['Icon_logo_0025_00']`。
   * 圖在 `public/images/game/icons/camp/`；讀寫一律經 `utils/factionLogos.ts`。
   *
   *   `_00`＝白色單色 → 前台用 CSS mask 吃文字色：紙色扉頁上是墨色（像蓋上去的印章）、暗底縮圖上是白色
   *   `_01`＝彩色 → 原樣顯示
   *
   * ⚠ 只有故事館讀（扉頁徽記、館首頁卡片角標），圖鑑不讀——站長指定，圖鑑頁也不載入 pilotLore。
   * ⚠ **刻意不做「陣營 → 徽章」字典**：`pilots.faction` 是自由文字（31 種寫法，含「北陸聯合·聯合安全總署」
   *   「獵豹物流、電鰻傭兵團」這種複合值），字典等於替站長決定誰跟誰算同一個陣營。改成編輯故事時逐位挑，
   *   後台把「同陣營文字的其他機師選了什麼」列成一鍵套用。最多 2 個就是為了複合值。
   * ⚠ 沒有官方資料能把陣營文字對到徽章編號 → 開發端不預填；看字樣猜的不寫進 DB。
   */
  factionLogos?: string[]
}

/**
 * 機師版的舊名。042-B 拆底座之前只有這一種故事館文件，既有呼叫端（約 50 處）沿用、不必改。
 * 新寫的程式碼若要同時處理兩館，吃 `LoreDocBase`；只處理機師的照舊用這個或 `PilotLoreDoc`。
 */
export type LoreDoc = PilotLoreDoc

/**
 * 系譜關係的種類（PLAN-042-B 決策 B-10），一律**從本文件的角度**讀：「`mechId` 是這台的 ___」。
 *   `base`    原型——這台衍生自它
 *   `variant` 改型——它是這台的改型
 *   `rival`   競品
 *   `series`  同系列
 */
export type MechRelationKind = 'base' | 'variant' | 'rival' | 'series'

/**
 * 系譜的一條（PLAN-042-B 決策 B-10）。**一律人工連**——總綱明文「交叉連結自動生成不做」，
 * 渲染路徑不做任何文字比對；介紹文裡的互提只在一次性草稿腳本當候選。
 *
 * 單向存：A 寫了「B 是原型」不會自動在 B 寫「A 是改型」。
 */
export interface MechRelation {
  /** mechs 文件 ID */
  mechId: string
  /** 空＝僅提及（草稿腳本抓到、還沒人判種類；模擬頁實測 36 條裡有 20 條只能判到這一步） */
  kind?: MechRelationKind
  /** 補充說明，例「同一套骨架、換裝重型裝甲」 */
  note?: string
}

/**
 * 機甲故事館文件（`mechLore` 集合，PLAN-042-B）。
 *
 * 官配機師**不存**：沿用 `pairedPilotOf()` 從 `pilots.pairedMechId` 反查（決策 B-7）。
 * armorType、quality、debutVersion、gameId 與數值有關或是識別鍵，留在 mechs，故事館唯讀引用。
 */
export interface MechLoreDoc extends LoreDocBase {
  /**
   * 型號，例 `DD-117`、`OS-07X`：卷宗標題與舞台上的型號鋼印（取代機師的英文簽名，決策 B-5）。
   * 初值由草稿腳本從介紹文首行切出（92 篇中 90 篇首行即型號）＋人工複核。
   */
  modelNo?: string
  /**
   * 廠商：`mechMakers` 的文件 ID（＝官方舞台背景鍵，如 `Doll`、`UKB`，決策 B-8）。
   * 空或對不到文件＝前台顯示「廠商未載」，不留白。
   */
  maker?: string
  /** 系列，例「破曉者」「KX 系列」。選填 */
  series?: string
  /**
   * 非數值諸元（量產狀態、搭載核心…），**陣列順序＝顯示順序**。
   * 形狀與機師人物檔案的自訂欄位相同，存檔前一樣要擋同名標籤。
   */
  specs?: LoreDossierField[]
  /** 系譜。**陣列順序＝顯示順序** */
  relations?: MechRelation[]
}
