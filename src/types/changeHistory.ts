import type { Timestamp } from 'firebase/firestore'

// ─── 資料變更歷史（PLAN-030）─────────────────────────────────────────────────
// 後台資料異動的稽核 log。獨立頂層集合 `changeHistory`，僅可新增（規則層 append-only），
// 且刻意「不」註冊進 CollectionKey / GameDataContext ——
// 它是持續成長、只查最近幾頁的資料，塞進「整包載入 + localStorage」的版本快取只會撐爆快取。

/**
 * 操作類型（分類軸二）。
 *
 * 注意 create 與 update 在寫入層是同一個 setDoc，靠「寫入前的 pre-image 是否存在」區分；
 * restore 是從刪除快照救回（或把版本號 target 寫回某一版），會以 restoredFrom 指回來源 log 形成可追溯鏈。
 */
export type ChangeAction = 'create' | 'update' | 'delete' | 'restore'

/**
 * 目標集合類型（分類軸一）。
 *
 * PLAN-030 本期只接 BUFF / 技能 / 詞條三個；日後擴充其餘集合時在此 union 加值即可，
 * 底層 helper 是集合無關設計，不需重構。
 * PLAN-043 追加 backpack / backpackSkill（背包後台的刪除與新的背包技能庫）。
 * PLAN-041 追加 form（機師形態）：它有 12 處 inbound 引用（帕姆斯陣列 7 條、粒子爆發／
 * 虛粒子程式／嵐循環各 1、海莉絲天賦 1），不進這條 union ＝ 刪一筆形態靜默留下 12 條懸空引用。
 * PLAN-042-A 追加 pilotLore（機師逸聞）：理由與前述各項**相反** —— 它沒有任何 inbound 引用，
 * 進這條 union 是為了 **outbound**：那是全站唯一人工逐字輸入、重跑爬蟲也生不回來的長文，
 * 寫壞一章而沒有稽核記錄＝永久失去。
 */
export type ChangeTargetKind =
  | 'buff' | 'pilotSkill' | 'glossaryTerm'
  | 'backpack' | 'backpackSkill'
  | 'form'
  | 'pilotLore'
  // PLAN-042-B：機甲逸聞，理由同 pilotLore。但它**還沒進 entityRefs SPECS**（章節開始有 [xxx] 引用才登記，
  // 042-B H-6），所以 entityRefs 的 SPEC_COLL_OF 對它是 null。
  | 'mechLore'

/**
 * 有**版本號與存檔衝突檢查**的 target（PLAN-042-H 後續，2026-10-17）。
 *
 * 只有故事館兩館：它們開給多位協作者同時編（LORE_EDITOR），而存檔是整份覆寫——
 * 沒有這層，後存者會靜默蓋掉先存者（2026-10-14 克洛伊的三個欄位就是被舊分頁這樣洗掉的）。
 * 這兩類走 `saveWithRevision()`：文件內帶 `rev`，交易內比對；update／restore 的 log 帶前一版整份快照。
 * 其餘 target 只有管理者在編，維持 `saveWithHistory()`（PLAN-030 決策五：update 不存快照）。
 */
export const REVISIONED_TARGETS = ['pilotLore', 'mechLore'] as const
export type RevisionedTargetKind = (typeof REVISIONED_TARGETS)[number]
export const isRevisionedTarget = (t: ChangeTargetKind): t is RevisionedTargetKind =>
  (REVISIONED_TARGETS as readonly string[]).includes(t)

/** ChangeTargetKind → Firestore 集合名。級聯清除與還原都需要由 kind 反查集合。 */
export const TARGET_COLLECTION: Record<ChangeTargetKind, string> = {
  buff:          'buffs',
  pilotSkill:    'pilotSkills',
  glossaryTerm:  'glossaryTerms',
  backpack:      'backpacks',
  backpackSkill: 'backpackSkills',
  form:          'forms',
  pilotLore:     'pilotLore',
  mechLore:      'mechLore',
}

/** 顯示用中文標籤（歷史檢視頁的篩選器與記錄列共用）。 */
export const TARGET_LABEL: Record<ChangeTargetKind, string> = {
  buff:          'BUFF',
  pilotSkill:    '技能',
  glossaryTerm:  '詞條',
  backpack:      '背包',
  backpackSkill: '背包技能',
  form:          '形態',
  pilotLore:     '機師逸聞',
  mechLore:      '機甲逸聞',
}

export const ACTION_LABEL: Record<ChangeAction, string> = {
  create:  '新增',
  update:  '修改',
  delete:  '刪除',
  restore: '還原',
}

/**
 * 還原時的重定位錨點。
 *
 * 索引式路徑（`talents.2.buffIds`）**不是穩定識別子**：刪除與還原之間，陣列可能被
 * 重排或在前面插入元素，屆時 `talents[2]` 已經是另一個天賦。還原的正確做法是
 * 「先按 index 找、對不上則按 anchor 重新定位」——沒有錨點就只能靜默寫到錯的地方。
 *
 * 定義在 types 而非 utils，是因為它會被序列化進 changeHistory 快照，屬持久化契約。
 *
 * `by` 是**被錨定元素身上真的存在的欄位名**，不是隨便取的標籤：
 * `restorePatch.ts` 的 `ANCHOR_FIELD` 把它映成欄位去比對 `el[field] === value`，
 * 錨到不存在的欄位會恆為 `undefined`，連「索引仍正確」的捷徑都走不到，
 * 每一筆都變成 `anchorMismatch`（PLAN-042-A 的 `pilotLore` 章節就踩過這個坑：
 * `LoreChapter` 只有 `key` 沒有 `name`，故新增 `'key'`）。
 */
export interface RefAnchor {
  by: 'name' | 'level' | 'minSum' | 'key'
  value: string | number
}

/**
 * 反向修補單的一筆：記錄「某處引用被移除」，用於還原時反向套用。
 *
 * 關鍵設計：前三種 op 的還原都是「把元素加回集合」，**天然冪等** ——
 * 還原時只需檢查「該欄位現在還缺不缺這個值」，缺就補、已有就跳過，
 * 不需要比對整份文件是否未被改動（那等於做時光機）。
 * textFreeze 是唯一非冪等的（覆寫字串），還原時需比對現值再決定。
 */
export interface ReversePatch {
  /** 引用來源集合，如 'pilots' */
  coll: string
  /** 引用來源文件 ID，如 'pilot_038_艾達' */
  docId: string
  /**
   * 欄位路徑的**顯示形式**（以 . 分隔）。例：'talents.2.buffIds'。
   *
   * ⚠ **還原時不可用它定位**：descriptionRefs 的 map key 是使用者輸入的中文、可含 '.'，
   * 例如 key 為 '凝勢.強化' 時 path 會是 'talents.2.descriptionRefs.凝勢.強化'，
   * split('.') 切回來是錯的。定位一律用 segments。
   */
  path: string
  /**
   * 權威路徑（陣列形式），path 是它 join('.') 的產物。
   *
   * 型別上必填（產生端一定有），但讀 Firestore 回來的舊資料無型別保障，
   * 還原端仍應對 undefined 做防禦性處理。
   */
  segments: (string | number)[]
  /** 重定位錨點；部分站點無錨可用（如 pilotSkills 頂層 buffIds）故為選填 */
  anchor?: RefAnchor
  /**
   * arrayRemove   — 從陣列移除一個元素（如 buffIds）
   * mapKeyDelete  — 從 map 刪除一個 key（如 descriptionRefs）
   * fieldClear    — 清空純量欄位（如 termRef / abilityId）
   * textFreeze    — 把文案內的數值 token 烘焙成常數（value 存「凍結前」的原始文字）
   */
  op: 'arrayRemove' | 'mapKeyDelete' | 'fieldClear' | 'textFreeze'
  /** 被移除的原值；textFreeze 時存凍結前的完整原始字串 */
  value: unknown
}

/**
 * 刪除快照：不只被刪的文件本身，還包含「每一處被移除的引用」。
 * 只存被刪文件是不夠的——那樣還原得回文件，卻還原不回引用關係。
 *
 * 版本號 target（`REVISIONED_TARGETS`）的 update／restore 也沿用這個形狀存「被覆寫的前一版」：
 * `doc` ＝前一版整份、`patches` 恆為空陣列（整份覆寫不動任何引用）。不另開型別，
 * 是為了讓歷史檢視頁與 Firestore 裡的記錄只有一種快照長相。
 */
export interface DeleteSnapshot {
  /** 被刪文件的完整內容（不含 id，id 記在 entry.targetId） */
  doc: Record<string, unknown>
  /** 級聯清除過程中每一處移除的反向修補單 */
  patches: ReversePatch[]
}

/** changeHistory 集合的單筆記錄。 */
export interface ChangeHistoryEntry {
  /** Firestore 自動 ID（log 沒有自然 slug，是全專案少數用 addDoc 的地方） */
  id: string

  /** 分類軸一：目標集合類型 */
  target: ChangeTargetKind
  /** 分類軸二：操作類型 */
  action: ChangeAction

  /** 被異動的文件 ID，如 'buff_過熱' */
  targetId: string
  /** 當下的顯示名稱（去正規化，查 log 時免去 join，且目標被刪後仍看得懂） */
  targetName: string

  actorUid: string
  /** 操作者 displayName 快照（改名後仍看得出是誰） */
  actorName: string

  /** 伺服器時間戳。剛寫入、尚未回傳伺服器值時可能短暫為 null */
  at: Timestamp | null
  /** at + 2 年。由 Firestore 原生 TTL 政策讀取後自動清除（見 PLAN-030 決策九） */
  expireAt: Timestamp | Date

  /** 僅 update：淺層比對出的變動欄位名 */
  changedFields?: string[]
  /**
   * delete：文件本體 + 反向修補單。
   * 版本號 target（pilotLore／mechLore）的 update／restore：**被這次覆寫掉的前一版**整份（patches 為空），
   * 歷史檢視頁憑它「還原成這一版」（`planRevert()`）。其餘 target 的 update 不存快照（PLAN-030 決策五）。
   */
  snapshot?: DeleteSnapshot
  /** 僅 restore：來源 log 的文件 ID（delete 記錄，或版本號 target 的 update／restore 記錄） */
  restoredFrom?: string
}

/** log 保留期限（決策九：兩年，交由 Firestore 原生 TTL 執行）。 */
export const CHANGE_HISTORY_TTL_YEARS = 2
