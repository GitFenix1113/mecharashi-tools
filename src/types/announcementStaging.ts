import type { Timestamp } from 'firebase/firestore'
import type { TimedActivity } from '../data/patchVersions/types'

// ─── 台版公告 staging（PLAN-048 Phase 2）────────────────────────────────────
//
// 兩個獨立頂層集合 `announcementDrafts` / `pendingActivities`，前台**完全不讀**，
// 規則層一律 isAdmin()。刻意「不」註冊進 CollectionKey / GameDataContext ——
// 比照 changeHistory.ts：它們是持續成長、只查最近幾頁的資料，塞進
// 「整包載入 + localStorage」的版本快取只會撐爆快取。
//
// ⚠ 為什麼是獨立集合而不是 PatchVersion.inbox 欄位（計畫書邊界三）：
// AdminVersionEditorPage 存檔是整份 setDoc、沒有 merge:true。若 buffer 是
// PatchVersion 的欄位，腳本追加 → 管理員存檔 → 追加內容無聲消失。
// 同型事故已有前例（scrape-pilots-v3.js:117）。
//
// 執行期的產生端是 scripts/lib/parseAnnouncement.mjs（純 JS，無法 import 本檔型別）。
// 本檔是**契約的文件面**：後台 UI 依它讀，解析器依它寫。兩邊對不上時以本檔為準，
// 但 UI 對未知的 flag / status 一律走 fallback 顯示而非崩潰（同 activityTypeRegistry 的
// 未登錄型別策略）—— 解析器改版不該讓後台白畫面。

/** 資料來源。陸版公告頻道已廢棄故不解析，這個 union 目前只有一個值（見計畫書問題四）。 */
export type AnnouncementSource = 'tw'

/** 台版公告的四個頻道，對應 ma.tentree-games.com/jx/{channel}/ */
export type AnnouncementChannel = 'maAffiche' | 'maNews' | 'maGuide' | 'maOther'

/**
 * 公告草稿的生命週期。
 *
 * raw         已抓到原文，尚未解析（抓取與解析分離，解析器改版可單獨重跑）
 * parsed      解析完成，已產出 0..n 筆 PendingActivity
 * parseFailed 解析器拋錯或產出量觸發告警（見 ParseWarning）
 * triaged     其下所有 PendingActivity 都已 merged / rejected
 * superseded  官方改稿（contentHash 變了）後被新版本取代
 */
export type DraftStatus = 'raw' | 'parsed' | 'parseFailed' | 'triaged' | 'superseded'

/**
 * 待處理活動的生命週期。
 *
 * 審核的最小單位是「一個活動」而非「一則公告」（計畫書決策七）——
 * 一則公告十個活動，看得懂九個就先放行九個，剩一個留在 buffer。
 *
 * parsed      解析乾淨，無 flag，可直接放行
 * needsReview 有 flag，需人工看一眼（後台預設只顯示這個狀態）
 * approved    人工已編修完、尚未寫進 patchVersions（合併失敗時的中繼狀態）
 * merged      已寫入某版本，mergedInto 存收據
 * rejected    人工判定不需要進時間線（如純儲值檔次、重複公告）
 * superseded  來源公告改稿後重新解析，舊的這筆被新的取代
 * conflict    合併時發現目標版本已有 anchor 相同的活動（見 MergeReceipt.anchor）
 */
export type PendingStatus =
  | 'parsed' | 'needsReview' | 'approved'
  | 'merged' | 'rejected' | 'superseded' | 'conflict'

/**
 * 解析器對單筆活動的標記。有任何一個 flag → status 落在 needsReview。
 *
 * 這些名稱是**跨語言契約**：產生端是 scripts/lib/parseAnnouncement.mjs 的
 * FLAGS 常數。新增時兩邊都要動，漏改的後果是後台顯示原始英文字串（不會壞）。
 */
export type PendingFlag =
  /** type 不在 activityTypeRegistry 裡 —— 新玩法，需人工命名或補登錄 */
  | 'unknownActivityType'
  /** 該活動所屬段落有未被任何規則認領的原文，excerpt 內會標紅 */
  | 'unmatchedText'
  /** 持續時間非整週（實測 424 筆區間裡 29 筆，6.8%），weeks 會是小數 */
  | 'nonWholeWeek'
  /** 起始日非週四（實測 615 筆裡 13 筆，2.1%），與既有資料慣例不符 */
  | 'nonThursdayStart'
  /** 「YYYY/MM/DD HH:mm 起」沒有結束時刻，weeks 是依版本半期推的 */
  | 'openEnded'
  /** 抽不到起始日期 —— extracted.startDate 會是 undefined，絕不填預設值 */
  | 'missingDate'
  /** 抽不到活動名 —— extracted.name 會是 undefined */
  | 'missingName'
  /** 同一版本半期內已有 anchor 相同的活動（可能是重複公告或續期） */
  | 'duplicate'

/** 後台顯示用的 flag 中文標籤。未登錄的 flag 直接顯示原字串。 */
export const PENDING_FLAG_LABEL: Record<PendingFlag, string> = {
  unknownActivityType: '未知型別',
  unmatchedText:       '有未認領原文',
  nonWholeWeek:        '非整週',
  nonThursdayStart:    '非週四開始',
  openEnded:           '無結束時刻',
  missingDate:         '缺日期',
  missingName:         '缺名稱',
  duplicate:           '疑似重複',
}

/**
 * 解析器對整篇公告的告警（任務 2-6：產出量監控）。
 *
 * 為什麼需要：爬蟲失效時**不會報錯，只會靜默降低品質**。句型逐年漂移已實測 ——
 * 「本期機師征招『X』」2024/2025 出現 0 次、2026 才 1 次；「維護計畫」段落 2026 才有。
 * 只看 HTTP 200 完全看不出解析器已經瞎了。
 */
export type ParseWarning =
  /** 一篇【版本前瞻】抽出的活動數 < 2 —— 週報不可能只有一個活動 */
  | 'lowYield'
  /** 有「機師征招」段落卻抽不到機師名 —— 句型漂移的典型徵兆 */
  | 'pilotSectionNoName'
  /** 有「海運」段落卻抽不到機甲名 */
  | 'mechSectionNoName'
  /** 本次執行的整體解析成功率比前次低 20% 以上（跨篇統計，寫在每篇上供追溯） */
  | 'yieldRegression'
  /** 正文抓不到 <div class="content">，退回整頁去標籤 —— 官網改版的徵兆 */
  | 'contentSelectorMiss'

export const PARSE_WARNING_LABEL: Record<ParseWarning, string> = {
  lowYield:             '產出量過低',
  pilotSectionNoName:   '機師段落抽不到名字',
  mechSectionNoName:    '機甲段落抽不到名字',
  yieldRegression:      '解析率較前次下滑',
  contentSelectorMiss:  '正文選擇器失效',
}

/**
 * 一則官方公告的原文草稿。
 *
 * 文件 ID = `${source}_${officialId}`（如 `tw_1799`）—— 由公告 URL 推導、天然穩定，
 * 因此**重爬必然命中同一份文件 ＝ 冪等免費**，不需要查詢去重。
 */
export interface AnnouncementDraft {
  /** `${source}_${officialId}`，如 'tw_1799' */
  id: string

  source: AnnouncementSource
  channel: AnnouncementChannel
  /** 官方公告編號（清單 JSON 的 id 欄位），如 '1799' */
  officialId: string

  title: string
  /** 官方發佈日 YYYY/MM/DD（清單的 time 欄位是 'YYYY-MM.DD' 這種怪格式，已正規化） */
  publishedAt: string
  /** 官方公告完整網址，會原樣抄進 TimedActivity.sourceUrl */
  sourceUrl: string

  /**
   * 正規化後的公告純文字。
   *
   * 實測 266 篇最大 15.9 KB（p50 3.0 KB / p95 12.3 KB），離 Firestore 單文件 1 MB
   * 硬限很遠，因此**不做 Storage 分流**（原評估的 200KB 門檻是 YAGNI）。
   * 仍保留 MAX_RAW_TEXT_BYTES 截斷保險，避免官網某天塞進整頁 base64 圖片。
   */
  rawText: string
  /** rawText 被截斷過（超過 MAX_RAW_TEXT_BYTES） */
  rawTextTruncated?: boolean

  /**
   * sha256(rawText)。**冪等判斷的唯一依據** ——
   * 不比對 fetchedAt、不比對 ETag（官網的 ETag 實測不穩），只認內容。
   * 值變了 ＝ 官方改稿 ＝ 舊的 PendingActivity 標 superseded 後重新解析。
   */
  contentHash: string

  status: DraftStatus

  /**
   * 產生這份 parsed 結果的解析器版本。
   * 改規則後靠它挑出「該重跑的舊公告」——沒有它就只能全量重跑或憑印象。
   */
  parserVersion: number

  /** 本篇解析出的 PendingActivity 筆數（0 也是合法的，如純維護公告） */
  activityCount: number

  /**
   * 沒被任何規則認領的原文片段。
   *
   * 這是「這段我沒看懂」的自動浮現機制：後台把它標紅，維護者一眼看到解析器
   * 漏了什麼，而不必自己逐篇比對原文。空陣列代表整篇都被認領了。
   */
  unmatched: string[]

  /** 整篇層級的告警（任務 2-6） */
  warnings: ParseWarning[]

  /** 抓取時間 */
  fetchedAt: Timestamp | Date
  /** 最後一次解析時間；status='raw' 時不存在 */
  parsedAt?: Timestamp | Date
  /** fetchedAt + 6 個月，交給 Firestore 原生 TTL 清除（比照 changeHistory.expireAt） */
  expireAt: Timestamp | Date

  /** 條件式請求用；官網回什麼就存什麼，不存在也不影響冪等（contentHash 才是權威） */
  etag?: string
  lastModified?: string
}

/**
 * 合併收據：這筆待處理活動最後寫進了哪裡。
 *
 * ⚠ anchor 用 `{ name, startDate }` 而**不是陣列 index**：
 * twActivities 是陣列，管理員在後台增刪排序後 index 就指向別的活動了。
 * 這與 changeHistory.RefAnchor 是同一個教訓（「索引式路徑不是穩定識別子」）。
 */
export interface MergeReceipt {
  /** patchVersions 的文件 ID，如 'v3.3' */
  versionId: string
  half: 'upper' | 'lower'
  /** 目前一律 'twActivities'（台版公告只餵台服欄位） */
  field: 'twActivities'
  /** 重定位錨點，不用 index */
  anchor: { name: string; startDate: string }
  at: Timestamp | Date
  actorUid: string
  actorName: string
}

/**
 * 一筆待審的活動。
 *
 * 文件 ID = `${draftId}_${seq}`，seq 是該篇公告內的出現序（0-based）。
 * 決定性 ID 讓「重新解析同一篇」直接覆寫同一批文件，不會每跑一次就多一份垃圾。
 */
export interface PendingActivity {
  /** `${draftId}_${seq}`，如 'tw_1799_0' */
  id: string
  /** 來源 AnnouncementDraft 的文件 ID */
  draftId: string
  source: AnnouncementSource

  /** 該篇公告內的出現序，也是後台預設排序 */
  seq: number

  status: PendingStatus
  flags: PendingFlag[]

  /**
   * 解析器的原始產出，**人工永不修改**（保持原樣供 diff）。
   *
   * 是 Partial 而非完整 TimedActivity：抽不到的欄位一律留 undefined，
   * **絕不填預設值** —— 填了預設值就分不出「官方真的是這樣」與「我沒抽到」。
   */
  extracted: Partial<TimedActivity>

  /**
   * 人工編修後的版本。存在時以它為準寫入，不存在則直接用 extracted。
   * 兩份並存才能在後台顯示「解析器猜什麼 / 我改成什麼」的 diff。
   */
  reviewed?: Partial<TimedActivity>

  /**
   * 原文片段（不是整篇）。後台左欄只載這段，避免每開一筆就傳 16KB 全文。
   * 含活動名那一行往下到時間行為止的上下文。
   */
  excerpt: string
  /** excerpt 在 rawText 內的起始位元組位移，供「看完整原文」時捲到正確位置 */
  excerptStart?: number

  /**
   * 型別未命中 registry 時，解析器從公告抄下來的原始段落標題（如「特殊活動」）。
   * 對應 TimedActivity.typeLabel —— 讓新玩法零部署就能顯示得出名字。
   */
  rawTypeLabel?: string

  /**
   * 依 startDate 推測的目標版本與半期。**只是預填**，後台可改；
   * 推不出來（日期落在所有已知版本之外）時為 undefined，該筆會標 needsReview。
   */
  targetVersion?: string
  targetHalf?: 'upper' | 'lower'

  /** status='merged' 時的寫入收據 */
  mergedInto?: MergeReceipt
  /** status='rejected' 時的理由（選填，維護者想留就留） */
  rejectReason?: string

  /** 審核者。status 進入 merged / rejected 時寫入 */
  reviewerUid?: string
  reviewerName?: string
  reviewedAt?: Timestamp | Date

  createdAt: Timestamp | Date
  /** 與來源 draft 同步，TTL 到期一起清掉 */
  expireAt: Timestamp | Date
}

/** staging 資料保留期限：6 個月，交由 Firestore 原生 TTL 執行。 */
export const ANNOUNCEMENT_STAGING_TTL_MONTHS = 6

/**
 * rawText 的截斷上限。實測最大一篇 15.9 KB，這個值是給「官網某天改版塞進
 * 整頁 base64 圖片」的保險，不是常態路徑。
 */
export const MAX_RAW_TEXT_BYTES = 200_000

export const DRAFTS_COLLECTION = 'announcementDrafts'
export const PENDING_COLLECTION = 'pendingActivities'
