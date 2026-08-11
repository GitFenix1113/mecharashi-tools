import type { Timestamp } from 'firebase/firestore'

// ─── 資料變更歷史（PLAN-030）─────────────────────────────────────────────────
// 後台資料異動的稽核 log。獨立頂層集合 `changeHistory`，僅可新增（規則層 append-only），
// 且刻意「不」註冊進 CollectionKey / GameDataContext ——
// 它是持續成長、只查最近幾頁的資料，塞進「整包載入 + localStorage」的版本快取只會撐爆快取。

/**
 * 操作類型（分類軸二）。
 *
 * 注意 create 與 update 在寫入層是同一個 setDoc，靠「寫入前的 pre-image 是否存在」區分；
 * restore 是從刪除快照救回，會以 restoredFrom 指回來源 log 形成可追溯鏈。
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
 */
export type ChangeTargetKind =
  | 'buff' | 'pilotSkill' | 'glossaryTerm'
  | 'backpack' | 'backpackSkill'
  | 'form'

/** ChangeTargetKind → Firestore 集合名。級聯清除與還原都需要由 kind 反查集合。 */
export const TARGET_COLLECTION: Record<ChangeTargetKind, string> = {
  buff:          'buffs',
  pilotSkill:    'pilotSkills',
  glossaryTerm:  'glossaryTerms',
  backpack:      'backpacks',
  backpackSkill: 'backpackSkills',
  form:          'forms',
}

/** 顯示用中文標籤（歷史檢視頁的篩選器與記錄列共用）。 */
export const TARGET_LABEL: Record<ChangeTargetKind, string> = {
  buff:          'BUFF',
  pilotSkill:    '技能',
  glossaryTerm:  '詞條',
  backpack:      '背包',
  backpackSkill: '背包技能',
  form:          '形態',
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
 */
export interface RefAnchor {
  by: 'name' | 'level' | 'minSum'
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
  /** 僅 delete：文件本體 + 反向修補單 */
  snapshot?: DeleteSnapshot
  /** 僅 restore：來源 delete log 的文件 ID */
  restoredFrom?: string
}

/** log 保留期限（決策九：兩年，交由 Firestore 原生 TTL 執行）。 */
export const CHANGE_HISTORY_TTL_YEARS = 2
