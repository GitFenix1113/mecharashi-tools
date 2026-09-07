// ─── 故事館 lore（PLAN-042 總綱決策三）─────────────────────────────────────────
//
// **型別共用（本檔），集合分家（pilotLore / mechLore）。**
// 型別在兩館之間完全同構（speakerId → pilots 對機甲與機師都成立），但集合不可合一：
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
 * NPC 旁白列：某位機師對這一章的評註。
 *
 * speakerId 指向 `pilots` 文件 ID（總綱決策三：不開新 RefType，只准指 pilots）。
 * 查不到時渲染端必須降級為「只顯示 text」而不是整列消失——旁白的內容本身有價值，
 * 說話者頭像沒有就沒有。
 *
 * ⚠ 刻意**不開** textRefs：旁白是短句評註，全站今天沒有任何一段旁白需要 [xxx]。
 *   要開的時候補一個選填欄位是零成本的；先開則是 PLAN-041「0/5 定律」點名的那種
 *   投機性選填欄位（每一個都是空的）。
 */
export interface LoreCommentary {
  /** pilots 文件 ID */
  speakerId: string
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
  /** 正文。支援 PLAN-019 的 [xxx] 引用標記，由 <RefText> 解析 */
  body: string
  /** 正文內 [xxx] → 實體引用側錄（PLAN-019 Layer 1）。欄位名沿用 `<正文欄位>Refs` 慣例 */
  bodyRefs?: DescriptionRefs
  /** 出處署名，如 '——《週刊米赫瑪·文娛版》'。右對齊小字 ＋ 分隔細線 */
  source?: string
  /** NPC 旁白列 */
  commentary?: LoreCommentary[]
}

/**
 * 故事館文件（`pilotLore` / `mechLore` 共用）。文件 ID ＝ 對應實體的文件 ID。
 *
 * ⚠ **扉頁正文不住這裡。** `/lore/pilots/:id` 的扉頁渲染的是 `pilots.lore`
 *   （官方 `detail.Introduction` 的鏡像、爬蟲每次補丁都會重寫），依總綱決策二
 *   「誰是權威來源」判準留在 pilots。把它複製進本集合就是兩個真相源，而且
 *   圖鑑的 hover 浮窗（EntityRefView）與引用稽核（entityRefs 的「機師簡介」站點）
 *   仍會讀 pilots 那一份，兩邊漂移不會有任何機制發現。
 *   本集合只承載「編輯得動的展示文本」：章節、旁白，以及扉頁那段正文的**署名**。
 */
export interface LoreDoc {
  /** ＝ pilots / mechs 的文件 ID */
  id: string
  /**
   * 實體名稱快照。給 saveWithHistory 的 targetName 與後台列表用
   * （去正規化：目標被刪後仍看得懂 log 在講誰）。
   */
  name?: string
  /**
   * 扉頁署名：從 `pilots.lore` 尾端抽出的出處（實測 89 篇中 35 篇帶署名）。
   *
   * **正文本身不複製**（見上方型別註解）——這裡只存「原文的哪一段是署名」的編輯決策，
   * 由 A-3 的一次性草稿腳本產出初值 ＋ 人工複核。
   * 不在執行期即時 parse：啟發式命中 30／誤判 0／漏抓 3，把它放進渲染路徑等於
   * 讓 3 篇永遠排錯、而且每次渲染都重跑一次同樣的猜測。
   */
  frontSource?: string
  /** 逸聞章節（PART 1..N）。**不含扉頁**——扉頁由渲染端從 pilots 那一份 derive */
  chapters: LoreChapter[]
}
