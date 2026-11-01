// ─── 傷害模擬 API 契約 v1（公開副本，PLAN-065-C B-1）─────────────────────────────
// 公開網站 ↔ `/sim/v1/*` Worker 之間的資料結構。純型別、無實作。
//
// 正本在私有 repo mecharashi-sim 的 contract/v1.ts；改契約時兩邊一起改。
// 兩份是否一致由私有 repo 的型別對照檢查；站上組出的請求樣本凍在 __fixtures__/sim-contract-samples.json
// （requestBuilder.test.ts 末段），私有端拿它驗 schema。
// 本檔只收站上會用到的部分，註解只寫欄位是什麼，不寫計算方式。
//
// 與正本刻意不同的三處：
//   · 分組小計的鍵（SimL1V1.zones[].key）在這裡是不透明的 string。
//   · NotCounted／ScenarioSwitch 沒有 condType（公開回應不帶）。
//   · 完整拆解 L2 一律是 unknown，結構不在公開 repo 定義。
//
// 原則（決策 C3）：前端只送「遊戲 ID＋養成假設＋目標＋情境」，不送展開後的數值。
// 遊戲 ID 一律取自站上實體的 gameRef（src/types/gameRef.ts），欄位名與之對齊。

// ─── 共用 ────────────────────────────────────────────────────────────────────

/** 遊戲設定表的記錄 ID。正整數。 */
export type GameId = number

/** 機甲部位。 */
export type PartKey = 'body' | 'larm' | 'rarm' | 'leg'

/** 瞄準部位；'auto'＝交給引擎依目標決定。 */
export type AimPart = 'auto' | PartKey

/** 效果歸屬：我方（攻擊方）或目標（防守方）。 */
export type Side = 'atk' | 'def'

/** 待驗證開關的值（鍵＝開關 ID，格式不透明）。只有管理者的請求會被採用。 */
export type FlagValues = Readonly<Record<string, string | number | boolean>>

// ─── GET /sim/v1/ping ────────────────────────────────────────────────────────

export interface SimPingV1 {
  ok: true
  /** 引擎版本（semver）。版本變更時前端清掉結果快取。 */
  engineVersion: string
  /** 引擎資料版本；尚未打包時為 'none'。 */
  dataVersion: string
  /** 資料包建置號 */
  buildNum?: string
  /** 待驗證開關預設值的摘要 */
  flagsDigest?: string
}

// ─── POST /sim/v1/run：請求 ──────────────────────────────────────────────────

/**
 * 一次請求可以帶多套配裝／目標／情境，由 `jobs` 明列要算哪些組合。
 * body 大小上限見 SimLimits.maxBodyBytes（超過回 413）。
 */
export interface SimRequestV1 {
  v: 1
  locale: 'zh-TW'
  /** 前端上次看到的版本。與 Worker 不同時照算，回應會帶新版本。 */
  clientEngineVersion?: string
  clientDataVersion?: string
  /** 'single'＝單擊快照；'rotation'＝回合序列（尚未開放）。 */
  mode: 'single' | 'rotation'
  loadouts: SimLoadoutV1[]
  targets: SimTargetV1[]
  scenarios: SimScenarioV1[]
  jobs: SimJobV1[]
  output: SimOutputV1
  /** 亂數種子；同請求同種子＝同結果。 */
  seed?: number
}

/** 一個計算組合；l／t／s 是 loadouts／targets／scenarios 的索引。 */
export interface SimJobV1 {
  l: number
  t: number
  s: number
  action: ActionSpecV1
  /** 一併回傳各開關的影響幅度（ScenarioSwitch.impact）；會計入工作量預算。 */
  wantSwitchImpact?: boolean
}

export interface SimOutputV1 {
  /**
   * 結果層級：
   * - 'L0' 最終結果
   * - 'L1' 再加分組小計與已計入／未計入清單
   * - 'L2' 完整拆解，只給管理者（一般請求會被降為 L1 並附 warning）
   */
  level: 'L0' | 'L1' | 'L2'
  /** 回傳每擊結果（只在 L2 有效）。 */
  perHit?: boolean
  /** 回傳行動時間軸（rotation 用）。 */
  timeline?: boolean
}

/** 一套配裝：全部是遊戲 ID 與養成選擇。 */
export interface SimLoadoutV1 {
  pilot: SimPilotV1
  mech: SimMechV1
  weapons: SimWeaponV1[]
  /** gameRef.backpackInfoId；沒有背包時省略。 */
  backpack?: { backpackInfoId: GameId }
  growth: SimGrowthV1
  /** 玩家手動覆寫的面板值。超出接受範圍時會被夾回並附 warning。 */
  panelOverrides?: PanelSnapshotV1
}

export interface SimPilotV1 {
  /** gameRef.pilotInfoId */
  pilotInfoId: GameId
  /** 機師等級 1–70；省略＝70。 */
  level?: number
  /** 潛能 0–5。 */
  potential: 0 | 1 | 2 | 3 | 4 | 5
  /** 神經驅動各分區實際生效的等級。 */
  ndEffective: Array<{ zoneIndex: number; level: number }>
  /** 攜帶技能，每支一筆；取該技能文件的 gameRef 原樣送出。 */
  carried: SkillCandidatesV1[]
  /** 形態：取 forms 文件的 gameRef；沒有形態時省略。 */
  form?: { passiveSkillId: GameId }
}

/** 與站上 SkillGameRef 同形；至少要有一個陣列。 */
export interface SkillCandidatesV1 {
  mainSkillIds?: GameId[]
  passiveSkillIds?: GameId[]
  activeSkillIds?: GameId[]
}

export interface SimMechV1 {
  /** 機甲品質階（站上一律送 'SS'）。 */
  quality: 'S' | 'S+' | 'S++' | 'SS'
  /** 四部位各自來自哪個套裝（gameRef.suitId），可混搭。 */
  parts: Record<PartKey, { suitId: GameId }>
  modules: SimModuleV1[]
}

export interface SimModuleV1 {
  /** 裝在哪個部位；'innate'＝天生模組。 */
  position: PartKey | 'innate'
  /** gameRef.entryId */
  entryId: GameId
  /** gameRef.itemId */
  itemId?: GameId
  /** 模組等級（從 1 起算）。 */
  level: number
}

/** 武器槽：左手、右手、雙手、左肩、右肩、背部。 */
export type WeaponSlot = 'lh' | 'rh' | 'dual' | 'ls' | 'rs' | 'back'

export interface SimWeaponV1 {
  /** 本請求內的武器識別字（ActionSpecV1.weaponKey、PanelKey 用它指向這把武器）；英數、底線、連字號 1–16 字，同一套配裝內不可重複。 */
  key: string
  slot: WeaponSlot
  /** 武器組：0＝第一組、1＝第二組。 */
  bank: 0 | 1
  /** gameRef.weaponInfoId */
  weaponInfoId: GameId
  /** 改裝；省略時採引擎預設。 */
  refit?: SimRefitV1
  /** 隨機詞條：詞條的效果 ID 與玩家抽到的值。 */
  randomEntries?: Array<{ bufId: GameId; value: number }>
  /** 元件（gameRef.weaponEntryId），觸元件與應元件各一個陣列。 */
  components?: { trigger: GameId[]; effect: GameId[] }
}

export interface SimRefitV1 {
  /** 一般改裝 0–8 */
  normal: number
  /** 進階改裝 0–4 */
  advanced: number
  /** 進階改裝數值 */
  advValue?: number
  /** 進階改裝選到的被動（最多 2 個）。 */
  advPassiveIds?: GameId[]
}

export interface SimGrowthV1 {
  /** 科研假設：'none' 不計、'full' 全滿、'raidUnlockAll' 武裝討伐科研全開、'custom' 逐項指定。 */
  research: 'none' | 'full' | 'raidUnlockAll' | 'custom'
  researchCustom?: Record<string, number>
}

/**
 * 面板鍵：機師六維（鍵名與站上 PilotStats 相同）、每把武器的攻擊／命中／暴擊
 * （`:` 後接 SimWeaponV1.key）、機甲火力。
 */
export type PanelKey =
  | 'melee' | 'assault' | 'shooting' | 'tactics' | 'engineering' | 'defense'
  | `weaponAttack:${string}` | `weaponHit:${string}` | `weaponCrit:${string}`
  | 'fire'

export type PanelSnapshotV1 = Partial<Record<PanelKey, number>>

// ─── 目標 ────────────────────────────────────────────────────────────────────

export type SimTargetV1 = SimRaidTargetV1 | SimTrainingTargetV1 | SimCustomTargetV1

/** 武裝討伐首領（對應站上 raidSeasons／stages／bosses）。 */
export interface SimRaidTargetV1 {
  kind: 'raid'
  /** 期數 */
  seasonNo: number
  /** 關卡序 */
  stageNo: number
  /** 難度編號 */
  difficulty: number
  battleMapId: GameId
  /** 首領模板 ID */
  templateId: GameId
  /** 同一關有多隻首領時的序號（從 0 起算）。 */
  bossIndex?: number
  part?: AimPart
}

/** 訓練木樁。 */
export interface SimTrainingTargetV1 {
  kind: 'training'
  battleMapId: GameId
  templateId: GameId
  part?: AimPart
}

/** 自訂目標面板：只給管理者，一般請求帶了回 403。 */
export interface SimCustomTargetV1 {
  kind: 'custom'
  vector: Record<string, number>
}

// ─── 攻擊動作 ────────────────────────────────────────────────────────────────

export interface ActionSpecV1 {
  /** 指向 SimWeaponV1.key */
  weaponKey: string
  /** 'default' 一般攻擊、'equipment' 武器技能、'command' 指令技能；數字＝直接指定技能 ID。 */
  skill: 'default' | 'equipment' | 'command' | GameId
  aimPart?: AimPart
  /** 與目標的距離（格）。 */
  distance?: number
}

// ─── 情境 ────────────────────────────────────────────────────────────────────

/**
 * 情境：單擊快照＋情境開關＋已觸發狀態宣告＋數值輸入。
 * switches／declared 只送與預設不同的項目；鍵一律是 ScenarioSwitch.id（前端不解析其格式）。
 */
export interface SimScenarioV1 {
  /** 開關目錄版本。對不上時，認不得的鍵會被忽略並附 warning 'unknownSwitch'。 */
  switchCatalog: string
  attack: {
    /** 'auto' 交給引擎、'first' 只算首擊、'firstPlusFollowUps' 首擊加後續追擊、'extraStrikeOnly' 只算額外打擊。 */
    timing: 'auto' | 'first' | 'firstPlusFollowUps' | 'extraStrikeOnly'
  }
  /** 情境開關的非預設值。 */
  switches: Record<string, boolean | number | string>
  /** 已觸發狀態宣告：「這個狀態目前存在／有幾層」。 */
  declared: Record<string, DeclaredStateV1>
  numeric: SimNumericInputsV1
  /** 機率型效果：'expected' 取期望值、'always' 視為必定發生、'never' 視為不發生。 */
  probability: 'expected' | 'always' | 'never'
  /** 武裝討伐專屬：第幾週、強化詞條（省略＝取關卡設定）。 */
  raid?: { week?: number; enhancements?: GameId[] }
  /** 首領狀態：從開場狀態算，可逐項覆寫。 */
  boss: { openingState: true; overrides?: Record<string, DeclaredStateV1> }
  /** 待驗證開關覆寫：只對管理者有效，一般請求帶了會被忽略並附 warning。 */
  flags?: FlagValues
}

export interface DeclaredStateV1 {
  present: boolean
  /** 層數；省略＝1。 */
  level?: number
}

/** 數值型情境輸入；省略的項目採引擎預設。 */
export interface SimNumericInputsV1 {
  /** 與目標距離（格） */
  distance?: number
  nearbyEnemies?: number
  nearbyAllies?: number
  /** 第幾回合（從 1 起算） */
  turn?: number
  /** 本回合已移動格數 */
  movedGrids?: number
  /** 我方血量百分比 0–100 */
  selfHpPct?: number
  /** 目標血量百分比 0–100 */
  targetHpPct?: number
  /** 我方各部位血量百分比 0–100 */
  partHpPct?: Partial<Record<PartKey, number>>
}

/** 引擎依「這套配裝×這個目標」產生的開關。 */
export interface ScenarioSwitch {
  /** 穩定鍵；前端存進 URL 與分享。格式不透明，前端不解析。 */
  id: string
  kind: 'bool' | 'enum' | 'int' | 'stacks' | 'percent'
  side: Side
  default: boolean | number | string
  min?: number
  max?: number
  /** kind＝'enum' 時的可選值。 */
  options?: string[]
  /** 這個開關來自哪些效果來源（UI 據此找站上實體顯示名稱）。 */
  sources: SourceRef[]
  /** UI 分區：'T1b' 情境開關、'T2b' 狀態存在宣告、'T2c' 狀態層數宣告、'num' 數值輸入。 */
  tier: 'T1b' | 'T2b' | 'T2c' | 'num'
  /** 切換這個開關造成的結果變化（%）；只在 wantSwitchImpact 時回傳。 */
  impact?: number
}

// ─── POST /sim/v1/run：回應 ──────────────────────────────────────────────────

export interface SimResponseV1 {
  contract: 'v1'
  engineVersion: string
  dataVersion: string
  buildNum: string
  overridesVersion: string
  flagsDigest: string
  limits: SimLimits
  /** 本次請求用掉的工作量與上限。 */
  budget: SimBudgetV1
  /** 與 jobs 一一對應。 */
  results: SimResultV1[]
}

export interface SimBudgetV1 {
  units: number
  max: number
}

/** Worker 目前的上限（前端依此分批）。 */
export interface SimLimits {
  maxJobs: number
  /** body 位元組上限 */
  maxBodyBytes: number
  maxUnits: number
  /** 抽樣次數上限；0＝不開放抽樣 */
  maxMcSamples: number
  /** rotation 的回合上限；0＝不開放 rotation */
  rotationMaxTurns: number
  /** 建議的每秒請求上限 */
  maxRps: number
}

export interface SimResultV1 {
  /** jobs 索引 */
  job: number
  /** 'partial'＝有效果未計入（見 L1.notCounted）；'unsupported'＝這個組合整體不支援。 */
  status: 'ok' | 'partial' | 'unsupported' | 'error'
  /** status 為 'ok'／'partial' 時必有。 */
  L0?: SimL0V1
  /** output.level 為 L1 以上時才有。 */
  L1?: SimL1V1
  /** 管理者限定；結構不在公開契約中定義。 */
  L2?: unknown
  switches: ScenarioSwitch[]
  derived: {
    /** 引擎算出的面板（顯示用，也是 panelOverrides 的對照基準）。 */
    panel: PanelSnapshotV1
    /** 適性名稱（顯示用） */
    adaptName?: string
    /** 開場 AP */
    apInit?: number
    /** 引擎實際採用的神經驅動等級（除錯用，結構不保證）。 */
    ndEffectiveEcho?: unknown
  }
  warnings: SimWarningV1[]
}

export interface SimL0V1 {
  /** 一次行動的傷害：期望值；需要抽樣時另給分位數。 */
  perAction: { mean: number; p10?: number; p50?: number; p90?: number }
  /** 這次行動內的各攻擊段。 */
  segments: SimSegmentV1[]
  /** 擊殺所需行動數 */
  killActions?: { p50: number; p90?: number }
  /** 結果為約略值（標「約」）。 */
  approx: boolean
  /** 'approx'＝推算；'verified'＝已與實測吻合。 */
  badge: 'approx' | 'verified'
}

export interface SimSegmentV1 {
  /** 攻擊段名稱（顯示用） */
  stage: string
  /** 這段發生的機率 0–1 */
  occurProb: number
  hits: number
  expected: number
  perHitMean: number
  hitRate: number
  critRate: number
}

export interface SimL1V1 {
  /** 分組小計（只有數字）。鍵格式不透明，顯示名稱由前端決定。 */
  zones: Array<{ key: string; value: number }>
  /** 已計入的效果來源。 */
  counted: Array<{ src: SourceRef; bufIds: GameId[] }>
  /** 未計入的效果與原因。 */
  notCounted: NotCounted[]
}

/** 效果來源：前端用 kind＋id 找回站上對應的實體與名稱。 */
export interface SourceRef {
  kind:
    | 'pilotTpl' | 'computerUnit' | 'talent' | 'ndEffect' | 'mainSkill' | 'activeSkill'
    | 'part' | 'wapEntryLevel' | 'weapon' | 'weaponPassive' | 'weaponRandomPassive'
    | 'refit' | 'research' | 'backpack' | 'componentPair' | 'form'
    | 'raidEnhance' | 'raidWeek' | 'mapGlobal' | 'bossTpl' | 'bossTrigger' | 'override'
  id: GameId
  level?: number
  owner: Side
  /** 裝在哪裡（部位、武器 key 等；顯示用）。 */
  slot?: string
}

/** 未計入原因碼（前端顯示成「未計入 N 項」清單的說明）。 */
export type ReasonCode =
  | 'condUnsupported'       // 條件尚未支援
  | 'funcTypeUnsupported'   // 效果尚未支援
  | 'dynamicUnsupported'    // 需要戰鬥中動態狀態，單擊快照算不了
  | 'timingOutOfScope'      // 觸發時機不在這次行動內
  | 'unmappedEntity'        // 站上實體尚未連結遊戲 ID（gameRef 未設定）
  | 'notInEngineData'       // 引擎資料沒有這筆記錄
  | 'twOnly'                // 台版獨有，資料包沒有
  | 'serverState'           // 取決於伺服器端狀態
  | 'switchOff'             // 情境開關關閉
  | 'probabilityExcluded'   // 機率模式設為 'never'
  | 'flagPending'           // 待驗證，預設不計
  | 'bossMechanicExcluded'  // 首領機制，刻意不計
  | 'undefinedProperty'     // 屬性未定義

export interface NotCounted {
  src: SourceRef
  bufId?: GameId
  reason: ReasonCode
  /** 玩家能否用情境開關或宣告把它強制算進去。 */
  forceable: boolean
}

/**
 * 結果附註。已知代碼：
 * - 'qualityAssumedSS'：機甲品質以 SS 計
 * - 'unknownSwitch'：開關目錄不符，有鍵被忽略
 * - 'panelOverrideClamped'：面板覆寫超出範圍、已夾回
 * - 'levelDowngraded'：要求 L2 但不是管理者，已降為 L1
 * - 'flagsIgnored'：一般請求帶了 flags，已忽略
 * - `flagPending:${開關 ID}`：結果受某個待驗證開關影響
 */
export interface SimWarningV1 {
  code: string
  detail?: string
}

// ─── 錯誤回應（非 200 時的 body）─────────────────────────────────────────────

/**
 * 錯誤碼 ↔ HTTP 狀態：
 *   400 badRequest · 403 forbidden · 404 notFound · 405 methodNotAllowed
 *   413 payloadTooLarge · 422 overBudget（附 limits 與 budget，前端依此分批）
 *   429 rateLimited（附 Retry-After）· 501 notImplemented · 503 disabled
 * 個別 job 的錯誤不走這裡，放在 SimResultV1.status（HTTP 仍是 200）。
 */
export type SimErrorCode =
  | 'badRequest'
  | 'forbidden'
  | 'notFound'
  | 'methodNotAllowed'
  | 'payloadTooLarge'
  | 'overBudget'
  | 'rateLimited'
  | 'notImplemented'
  | 'disabled'

export interface SimErrorV1 {
  error: SimErrorCode
  detail?: string
  limits?: SimLimits
  budget?: SimBudgetV1
}
