export interface ArmamentRaid {
  name: string
  weapons?: string[]
  weaponPilots?: string[]  // parallel to weapons[], index-aligned exclusive pilot names
  backpacks?: string[]
}

export interface BattlePass {
  pilots?: string[]
  mechs?: string[]
}

// ── 活動型別：開放字串 + 靜態登錄表（PLAN-048 Phase 1）──────────────────────
//
// 為什麼不維持硬 union：新玩法（如「星海拓荒祭」）出現時，硬 union 會讓待處理
// buffer 塞住 —— 要等工程師改 code + build + deploy 才能把該筆合併進版本。
// 開放字串讓維護者當天就能上線（甘特以中性色顯示、名稱走 typeLabel），
// 之後在 activityTypeRegistry 補一列給它顏色即可，零資料遷移。
//
// `string & {}` 讓 TS 不把 union 塌成 string，IDE 仍會自動完成十個已知值。

export const KNOWN_ACTIVITY_TYPES = [
  'skinGacha',            // 角雕刮刮樂
  'roulette',             // 角雕輪盤
  'pilotMission',         // 角雕特遣（含複數機師）
  'crossShipping',        // 跨域海運（含複數機甲）
  'specificPilotBanner',  // 特定角色池
  'specificMechBanner',   // 特定機甲池
  'limitedEvent',         // 限時活動
  'loginEvent',           // 限時簽到活動
  'battlePass',           // 版本戰令
  'topUpEvent',           // 指定方式儲值（公告實測第 2 高頻，共 109 次）
] as const

export type KnownActivityType = typeof KNOWN_ACTIVITY_TYPES[number]

/** 活動型別；已知值有自動完成，未登錄的新玩法也收得下 */
export type ActivityTypeId = KnownActivityType | (string & {})

/** @deprecated 舊名保留讓既有 import 不炸；新程式碼請用 ActivityTypeId */
export type ActivityType = KnownActivityType

/** 資料成熟度。未填視同 'confirmed'。 */
export type ActivityConfidence = 'confirmed' | 'predicted'

export interface TimedActivity {
  // ── 既有欄位，語意不變 ────────────────────────────────────────────────────
  name: string          // 活動名稱，如「角雕刮刮樂」
  startDate: string     // 起始日 YYYY/MM/DD，慣例為星期四
  /**
   * 持續週數（1 = 當週四到下週三；結束時刻為 exclusive）。
   *
   * **選填的理由（PLAN-048 Phase 2）**：台版官方公告有 31% 只寫「10:00 起」、
   * 不寫結束時刻（實測 625 筆中 193 筆，幾乎都是卡池）。填一個「慣例上大概兩週」
   * 進來就再也分不出哪些是官方寫的、哪些是系統猜的 —— 所以缺就留空。
   *
   * ⚠ 不變式：`weeks` 為空的活動**必然** `hidden`。甘特沒有長度就畫不出長條，
   * 而畫一條長度是猜的長條，比不畫更糟。這條不變式由 `activitiesOfHalf` 這個
   * 唯一的前台讀取口強制執行（見 legacyActivities.ts），不倚賴寫入端自律。
   */
  weeks?: number
  type: ActivityTypeId
  pilots?: string[]     // pilotMission 時的機師列表
  mechs?: string[]      // crossShipping 時的機甲列表

  // ── PLAN-048 Phase 1 新增 ────────────────────────────────────────────────
  /**
   * 穩定識別子（後台新增時自動產生 `act_<base36 時戳><亂數>`）。
   *
   * 不是防禦性設計：甘特列與後台編輯器原本都以陣列 index 當 key，
   * 陣列一重排，React key 與「目前選取哪個活動」的狀態就一起錯位。
   * 甘特↔卡片雙向連動需要一個不隨排序改變的錨點。
   */
  id?: string

  /**
   * 關鍵獎勵，逐項純字串（`['輕型通用改裝模組×1', '仿生超導體×2']`）。
   *
   * 刻意**不**做成 `{ name, qty, refKey }`：實測 34 筆括號內容有四種形狀 ——
   * 獎勵 15 筆、外觀名 10 筆、機制說明 6 筆（「體力轉票券商店」）、空括號 1 筆。
   * 結構化接不住後三種，refKey 更會複製 iconUrls 那種 0% 填充的命運。
   *
   * 未填時前台 fallback 解析 name 的括號（見 activityText.ts）——那是 runtime
   * fallback 而非一次性遷移，所以未來有人又用老方法打字也照樣顯示得出來。
   */
  rewards?: string[]

  /** 活動說明／規則。純文字，換行即分段。刻意不支援 ［］引用標記（見計畫書）。 */
  description?: string

  /** 官方公告連結。卡片右下角「官方公告 ↗」。 */
  sourceUrl?: string

  /**
   * 資料成熟度。未填視同 'confirmed'。
   * 'predicted' → 長條虛線邊框 + 卡片標「推估」。
   *
   * 這是回應「陸版官網常漏維護公告」唯一能在顯示層兌現的東西：缺的公告仍然缺，
   * 但至少讀者分得出「查證過的」與「照慣例推的」。
   */
  confidence?: ActivityConfidence

  /**
   * type 不在 registry 時的顯示名（新玩法零部署上線用）。
   * 已登錄型別會被 registry 的 label 蓋過 → 日後補登錄時無需回頭清理。
   */
  typeLabel?: string

  /**
   * 前台一律不顯示這筆（甘特、卡片、首頁濃縮表全部略過）。
   *
   * 用途是「資料不完整但捨不得丟」：公告只寫了開始日、沒寫辦多久，
   * 那筆事實仍然有價值 —— 藏起來等補齊，好過整筆卡在待審清單裡被遺忘。
   * 補完資料後取消勾選即上線，不需要再跑一次爬蟲或審核流程。
   *
   * 這是**顯示閘門**，不是軟刪除：不想要的活動請直接刪掉。
   */
  hidden?: boolean

  /**
   * 後台備註：**缺什麼、為什麼藏起來、要去哪裡查**。前台永不顯示。
   *
   * 與 description 的分工很明確：description 是給讀者看的活動說明，
   * note 是給維護者看的待辦事項。混在一起的話，補完資料時就得先分辨
   * 哪一段是要刪掉的施工註記。
   */
  note?: string
}

/**
 * 通過前台顯示閘門的活動：保證有 `weeks`、且未被標記隱藏。
 *
 * 把「已檢查過」這件事編碼進型別，甘特與狀態計算就不必各自再防一次 undefined ——
 * 也讓「忘了過閘門」變成編譯錯誤而不是執行期的 NaN。
 * 閘門本身是 legacyActivities.ts 的 isVisibleActivity / activitiesOfHalf。
 */
export type VisibleActivity = TimedActivity & { weeks: number }

export interface PatchHalf {
  cnDate: string
  twDate?: string
  twIsPredicted?: boolean
  pilots?: string[]
  mechs?: string[]
  pilotSelection?: string[]
  mechSelection?: string[]
  armamentRaids?: ArmamentRaid[]
  battlePass?: BattlePass
  // 甘特圖活動（陸服 / 台服各自維護）
  cnActivities?: TimedActivity[]
  twActivities?: TimedActivity[]
  // 舊欄位保留，cnActivities/twActivities 優先；無新欄位時 fallback 顯示
  /** @deprecated 請改用 cnActivities / twActivities */
  skinGacha?: string
  /** @deprecated 請改用 cnActivities / twActivities */
  rouletteEvent?: boolean
  /** @deprecated 請改用 cnActivities / twActivities */
  specialEvents?: string[]
  /** @deprecated 請改用 cnActivities / twActivities */
  revivedBanners?: string[]
}

export interface GrayOpsUpdate {
  company: '武裝工坊' | '創新動力' | 'GeekX' | '火花塞'
  newMechs: string[]
}

export type GrayOpsCompany = '武裝工坊' | '創新動力' | 'GeekX' | '火花塞'

export interface VersionIconUrls {
  pilots?: Record<string, string>
  mechs?: Record<string, string>
  weapons?: Record<string, string>
  backpacks?: Record<string, string>
}

/**
 * 名稱 → Firestore 文件 ID。首頁版本濃縮表靠它把圖示接上引用浮窗（EntityRefView）。
 *
 * 為什麼要存而不是前台推導：三個集合的文件 ID 都帶建檔當下的流水號
 * （`pilot_001_亞瑟` / `mech_001_伊格尼特` / `weapon_003_xxx`），從名稱推不回來。
 * 由後台「自動同步」在既有的那趟 getDocs 裡順手記下，前台零額外讀取。
 *
 * 為什麼與 iconUrls 分成兩張表而不是合併成 { id, icon }：兩者**填入時機不同**。
 * 武器常常是資料先建檔、圖片素材晚幾天才處理好；分開存，同步時才能各自「只補空缺」，
 * 前台也才能做到「有 ID 就可點，有沒有圖是另一回事」。
 *
 * 值的格式：一般是純文件 ID；跨集合的條目（backpacks 列的複合武器）記成
 * `weapon:<docId>`。解析與寫入一律走 entityRef.ts 的 parse/formatEntityIdValue。
 */
export interface VersionEntityIds {
  pilots?: Record<string, string>
  mechs?: Record<string, string>
  weapons?: Record<string, string>
  backpacks?: Record<string, string>
}

export interface PatchVersion {
  version: string
  name?: string
  bannerImage?: string
  upper: PatchHalf
  lower: PatchHalf
  crisisShop?: string[]
  memoryStorm?: string
  borderShop?: string
  arenaShop?: string
  grayOpsUpdates?: GrayOpsUpdate[]
  notes?: string
  isTwCurrent?: boolean
  iconUrls?: VersionIconUrls
  entityIds?: VersionEntityIds
}
