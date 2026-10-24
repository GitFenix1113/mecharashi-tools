// ─── BOSS / 關卡（PLAN-019 Layer 3；武裝討伐由 PLAN-064 以腳本匯入復用）──────────────
//
// PLAN-019-D（2026-06-28）把 bosses／stages 降級，理由是「人工建成結構化資料投報率低」。
// PLAN-064 改由遊戲參數資料包＋腳本產生（scripts/extract-raid-dungeons.py → import-raid-dungeons.mjs），
// 經後台 /admin/raids 審核發布；人工資料只存在譯名對照表（raidTerms）與欄位覆寫（raidOverrides，PLAN-064 H），
// 發布文件＝腳本產生的草稿 → 已校譯名 → 欄位覆寫。
//
// ⚠ 不要把 bosses／stages／raidSeasons 加進 entityRefs 的 SPECS、也不要寫 descriptionRefs：
//   寫進 SPECS 會自動連動 cascadeDelete 與 useRefScanData，規則沒部署時會弄壞既有的後台刪除。
//   日後若要讓說明文字引用站上實體，必須先補 SPECS 並部署規則（PLAN-019 留下的警告）。
// ⚠ 重裝征伐（RaidActivity，台版 v3.5）不在 PLAN-064：結構是「活動 → 4 個難度群組、各 3／4／5／6 關」，
//   與這裡的「期 → 4 難度 → 固定 4 關」不同；RaidStageInfo.kind 預留 'activity'，另開計畫時再加分支。
//   陸版的 EnhancementLevelReplaceId 是**玩家方**等級補正（拉到 Lv70、科研全解），不是敵人難度來源。

import type { DescriptionRefs } from './common'
import type { SkillEffect } from './buff'
import type { RaidDifficulty } from './enums'
import type { PilotStats } from './pilot'

/**
 * 說明文字裡的引用記號（匯入端把遊戲標籤轉成這個格式，前台 RaidRichText 解析）：
 *   ⟦buf:98321014⟧ ⟦buf:98321014|積怨⟧   → refDict['buf:98321014']，有 | 時以標籤文字顯示
 *   ⟦main:8820522⟧ ⟦passive:9840513⟧ ⟦active:98325020⟧ ⟦terrain:88329010⟧
 *   ⟦em:2⟧                               → 遊戲以顏色強調的數字／字詞
 * 名稱與說明都已轉成台版用字（譯名對照表＋簡→繁）。
 */
export interface RaidRefEntry {
  name: string
  desc?: string
}
export type RaidRefDict = Record<string, RaidRefEntry>

/** BOSS 技能（複用 SkillEffect 與引用層） */
export interface BossSkill {
  name: string
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1）。PLAN-064 匯入的首領不寫（見檔頭）。 */
  descriptionRefs?: DescriptionRefs
  effects?: SkillEffect[]
  icon?: string
  /** 主動／被動／天賦／機體固有／武器附帶／等級加成（PLAN-064） */
  kind?: 'main' | 'passive' | 'talent' | 'mech' | 'weapon' | 'level'
  /** 主動技能的 AP 消耗（原文字串，例 '2'） */
  ap?: string
}

/** 部位面板（複用 MechPart 概念，僅取數值面）。PLAN-064 的值是推算值。 */
export type BossParts = Partial<Record<'torso' | 'leftArm' | 'rightArm' | 'legs', { durable: number; armor: number }>>

/** 首領在某個難度的樣子（PLAN-064 決策四、六） */
export interface BossVariant {
  /** 戰場 ref=BOSS 的實際戰術單位模板（不是關卡表的 BossID） */
  templateId: number
  level: number
  mech?: string
  weapons: { name: string; level: number; attack?: number }[]
  /** 推算面板；推算段不在本機時整組不出現（見 estimated） */
  parts?: BossParts
  hpTotal?: number
  antiCrit?: number
  dodge?: number
  pilotStats?: Partial<PilotStats>
  /** 依難度完整存放（同名技能會隨難度改數值），不做跨難度去重 */
  skills: BossSkill[]
  /** 難度強化翻成的人讀文字（「耐久 +29.7%」…） */
  difficultyText?: string[]
  /** 未計入面板的效果（條件式 Buff、疊層護盾、機師適性…），前台列成「未計入」 */
  notCounted?: string[]
  /** 面板是推算值（未經遊戲內實測）。沒有面板時為 false。 */
  estimated: boolean
  /** 異常註記，例：「陸版資料中此關磨鍊未套用難度強化…」 */
  anomaly?: string
}

/** bosses Collection 文件 */
export interface Boss {
  id: string
  name: string
  icon?: string
  portrait?: string
  /** 複用 ArmorType enum 值（輕型 / 中甲 / 重型） */
  armorType?: string
  /** 各部件耐久 / 裝甲（複用 MechPart 概念，僅取數值面） */
  parts?: BossParts
  skills: BossSkill[]
  description?: string
  descriptionRefs?: DescriptionRefs
  /** 弱點標籤 */
  weakness?: string[]
  /** 後台資料維護標記（複用 Module.managedBy 慣例） */
  managedBy?: string
  updatedBy?: string
  updatedAt?: string

  // ── PLAN-064 武裝討伐 ──
  /** 陸版原名（簡中），譯名對照表的鍵 */
  nameCn?: string
  /** → raidSeasons，例 'raid-21' */
  seasonId?: string
  /** → stages，例 'raid-21-g1' */
  stageId?: string
  /** 依難度的面板與技能 */
  variants?: Partial<Record<RaidDifficulty, BossVariant>>
  /** 技能說明內 ⟦…⟧ 引用的名稱與說明 */
  refDict?: RaidRefDict
  /** 強敵圖鑑條目（人物層，決策十三） */
  atlasId?: number
  /** 強敵圖鑑台詞 */
  quote?: string
  /** 逸聞篇數；全文在故事館（決策十四），討伐頁只放入口 */
  anecdoteCount?: number
  /** 待校欄位（前台在名稱旁標「待校」） */
  i18nPending?: string[]
  /** 後台人工覆寫過的欄位路徑（PLAN-064 H；前台列成「人工修正」） */
  manualPaths?: string[]
}

/** 關卡掉落條目（取代 src/data/bossDrops.ts 的靜態索引） */
export interface StageDropEntry {
  /** → components Collection 的元件 ID */
  componentId?: string
  /** 掉落該物的 BOSS 在 bossIds 中的索引（對應遊戲關卡第幾個 BOSS） */
  bossIndex?: number
  note?: string
}

/** stages Collection 文件（高難度關卡） */
export interface Stage {
  id: string
  name: string
  /** StageCategory enum：危境 / 深淵 / 活動… */
  category: string
  recommendedPower?: number
  /** → bosses Collection */
  bossIds: string[]
  /** 關卡機制文字 */
  mechanics?: string
  /** 機制文字內的 [xxx] 引用側錄（PLAN-019 Layer 1） */
  mechanicsRefs?: DescriptionRefs
  /** 掉落表（取代 bossDrops.ts） */
  drops?: StageDropEntry[]
  /** → guides Collection（PLAN-010 攻略） */
  guideIds?: string[]
  managedBy?: string
  updatedBy?: string
  updatedAt?: string
  /** 武裝討伐的關卡組（PLAN-064）；category 為 '討伐' 時才有 */
  raid?: RaidStageInfo
  /** 後台人工覆寫過的欄位路徑（PLAN-064 H；前台列成「人工修正」） */
  manualPaths?: string[]
}

// ─── 武裝討伐（PLAN-064）────────────────────────────────────────────────────

/** 一個關卡組＝同一關的四個難度（四個獨立戰場，戰場 ID 連號） */
export interface RaidStageInfo {
  /** 'dungeon'＝武裝討伐；預留 'activity'（重裝征伐，另案） */
  kind: 'dungeon'
  seasonId: string
  /** 關卡組 1–4（4 通常是最終關） */
  group: number
  /** 遊戲內的顯示順序（ShowInOrder，4→1，1＝最終關） */
  order: number
  isFinal: boolean
  variants: Partial<Record<RaidDifficulty, RaidStageVariant>>
  /** 敵方單位字典：模板 ID → 名字、機體…（開場陣容與增援共用） */
  unitDict: Record<string, RaidUnitEntry>
  /** 說明文字內 ⟦…⟧ 引用的名稱與說明（Buff、技能、地形） */
  refDict: RaidRefDict
}

export interface RaidUnitEntry {
  name: string
  kind: 'unit' | 'vehicle'
  mech?: string
  /** 模板等級；戰場覆寫等級時以 RaidUnit.level 為準 */
  level?: number
  weapons?: string[]
  /** 名字是機轉、待校（前台標「待校」） */
  pending?: boolean
}

export interface RaidStageVariant {
  levelId: number
  battleId: number
  /** 關卡名（RaidDungeonLevelInfo） */
  name: string
  /** 關卡短述 */
  desc?: string
  /** 戰場名（BattleMapInfo） */
  battleName?: string
  winText?: string
  loseText?: string
  /** 回合上限（0＝無） */
  turnLimit: number
  /** → bosses；雙首領關有兩位 */
  bossIds: string[]
  /** 關卡特性（玩家看得到的那段：名稱＋說明） */
  features?: RaidRefEntry[]
  /** 戰場上的地形效果 */
  terrain?: RaidRefEntry[]
  /** 敵方難度強化的人讀文字 */
  difficultyText?: string[]
  /** 開場陣容（首領以外，含載具與友軍） */
  units: RaidUnit[]
  /** 增援時程 */
  reinforcements: RaidReinforcement[]
  /** 其他固定事件（每回合首領加護盾層數…） */
  events?: RaidEvent[]
  /** 懸賞（最終關 1 個、其餘 3 個）與對應線索 */
  bounties: RaidBounty[]
  /** 最終關的線索門檻：顯示／解鎖所需的累計線索數 */
  clueGate?: { show: number; unlock: number }
  /** 異常註記 */
  anomalies?: string[]
}

export interface RaidUnit {
  /** → RaidStageInfo.unitDict 的鍵（模板 ID 字串） */
  unit: string
  count: number
  /** 戰場覆寫的等級（第 20–21 期） */
  level?: number
  /** 友軍（我方 NPC）；未填＝敵方 */
  ally?: boolean
  /** 同名同等級合併進這一列的其他模板（例：五種機體的「老練傭兵」）；機體名從 unitDict 取 */
  merged?: string[]
}

/** 觸發時點（決策五：由觸發器的結構化條件推出，不用企劃備註） */
export type RaidWhen =
  | { kind: 'start' }                                                     // 開戰時
  | { kind: 'turn'; turns: number[]; timing: 'start' | 'end' }            // 第 N 回合開始／結束
  | { kind: 'everyTurn'; timing: 'start' | 'end'; from?: number }         // 每回合
  | { kind: 'condition'; text: string }                                   // 「自律戴亞斯被擊破時」
  | { kind: 'unknown' }                                                   // 特定條件觸發（對不到的型別）

export interface RaidReinforcement {
  when: RaidWhen
  /** 附帶條件（「若 V1-1 未被擊破」…），全部要成立才觸發 */
  also?: string[]
  /** 增援預警（召喚點在這個時點亮起）；沒有預警時省略 */
  warn?: RaidWhen
  units: RaidUnit[]
}

export interface RaidEvent {
  when: RaidWhen
  also?: string[]
  /** 人讀文字，可含 ⟦…⟧ 引用 */
  text: string
}

export interface RaidBounty {
  name: string
  desc?: string
  clue?: { name: string; desc?: string; details?: string }
}

/** 每週加成（支援協議Ⅰ～Ⅲ，只對部分難度有效） */
export interface RaidWeekBuff {
  week: number
  name: string
  desc?: string
  /** 屬性翻成的人讀文字（「我方耐久 +26.2%」…） */
  effects: string[]
  difficulties: RaidDifficulty[]
}

/** raidSeasons Collection 文件：一期武裝討伐 */
export interface RaidSeason {
  /** 'raid-21'（期 ID 兩位數） */
  id: string
  seq: number
  /** 台版期名 */
  name: string
  /** 陸版原名（簡中） */
  nameCn: string
  /** 陸版英文副標，例 The Lurking Shadow */
  subtitleEn?: string
  /** 強敵圖鑑的勢力（每期一個） */
  faction?: { name: string; emblemKey?: string }
  difficulties: RaidDifficulty[]
  /** 難度顯示名（台版用語，走對照表） */
  difficultyNames: Partial<Record<RaidDifficulty, string>>
  /** 陸版開放日 YYYY-MM-DD */
  cnOpenDate?: string
  /** 台版版本，例 'v3.2'（依期名對上時間線 armamentRaids） */
  twVersion?: string
  /** 台版開放日 YYYY/MM/DD（時間線該半期的 twDate） */
  twDate?: string
  /** 台版已開放／預計開放（決策九） */
  twStatus: 'open' | 'planned'
  groups: RaidSeasonGroup[]
  weekBuffs: RaidWeekBuff[]
  /** 每週規則（可設為目標的關卡組數等，數字取自遊戲設定，匯入時寫入） */
  rules?: string[]
  /** 公開開關：發布但先不在前台列出（D-3） */
  published: boolean
  parserVersion: number
  /** 資料包 BuildNum，例 '376_ZiLongA' */
  sourceBuild: string
  i18nPending?: string[]
  /** 後台人工覆寫過的欄位路徑（PLAN-064 H；前台列成「人工修正」） */
  manualPaths?: string[]
  updatedAt?: string
}

export interface RaidSeasonGroup {
  /** → stages */
  stageId: string
  group: number
  name: string
  isFinal: boolean
  bosses: { id: string; name: string }[]
}

// ─── 後台限定（PLAN-064 B-3）：匯入草稿與譯名對照表 ───────────────────────────────
// 只開規則（ADMIN 讀寫），不進 Worker、不進 GameDataContext；匯入腳本以 admin SDK 寫入。

/** 草稿用到的一筆譯名（PLAN-064 H：含已校，後台才能改正已確認過的條目） */
export interface RaidTermUse {
  /** 對照表種類＝raidTerms 文件 ID（unit、skill、text…） */
  kind: string
  /** 簡中原文（對照表的鍵） */
  cn: string
  /** 草稿裡用的譯文（匯入當下） */
  tw: string
  status: 'verified' | 'pending'
  /** manual／site／timeline／machine／infodata／screenshot… */
  source: string
  count: number
}

/** 一筆待校譯名（機轉或來源匯入、尚未人工確認）。2026-10-24 前的草稿只存這個 */
export interface RaidPendingTerm {
  /** 對照表種類＝raidTerms 文件 ID（unit、skill、text…） */
  kind: string
  /** 簡中原文（對照表的鍵） */
  cn: string
  /** 草稿裡目前用的譯文 */
  tw: string
  /** machine＝機轉；infodata／screenshot／table＝來源匯入但未校 */
  source: string
  count: number
}

/** 逸聞草稿（決策十四：本計畫只做到擷取＋翻譯＋審核預覽，呈現交故事館子計畫） */
export interface RaidAnecdoteDraft {
  bossId: string
  atlasId: number
  anecdoteId: number
  unlockLevel: number
  title: string
  body: string
  titleCn: string
  bodyCn: string
  /** 原文雜湊：日後原文變動、已校篇章不被覆蓋時用來比對 */
  hash: string
}

/** raidDrafts/{raid-21}：一期的匯入草稿（scripts/import-raid-dungeons.mjs --write 產生） */
export interface RaidDraft {
  id: string
  seq: number
  parserVersion: number
  estimateVersion: number | null
  sourceBuild: string
  sourcePackage: string
  generatedAt: string
  season: RaidSeason
  stages: Stage[]
  bosses: Boss[]
  anecdotes: RaidAnecdoteDraft[]
  /** 這一期用到的全部譯名（含已校） */
  terms?: RaidTermUse[]
  /** 舊草稿只有待校清單（新草稿改存 terms） */
  pending?: RaidPendingTerm[]
  anomalies: { levelId: number; code: string; type: string; registered: boolean }[]
  /** 匯入當下與已發布版本的比較 */
  diff: { status: 'new' | 'changed' | 'same'; changed: string[] }
  /** 最近一次從這份草稿發布的紀錄（摘要，不存全文） */
  lastPublished?: { at: string; by: string; parserVersion: number; sourceBuild: string; stages: number; bosses: number }
}

/** raidTerms/{kind} 裡的一筆對照 */
export interface RaidTermEntry {
  cn: string
  tw: string
  /** verified＝已校；pending＝來源匯入但未校 */
  status: 'verified' | 'pending'
  /** manual／screenshot／infodata／timeline／site */
  source: string
  firstSeason?: number
  updatedAt?: string
  updatedBy?: string
}

/** 一筆欄位覆寫（PLAN-064 H）：審核後發現的非文字錯誤（回合、陣容、數值…）或只改一處的文字 */
export interface RaidOverride {
  doc: 'season' | 'stage' | 'boss'
  docId: string
  /** 欄位路徑，點分隔、陣列用索引：'raid.variants.hell.turnLimit'、'variants.d4.parts.torso.durable' */
  path: string
  /** 建立時草稿原本的值；重跑匯入後草稿的值不同 → 暫停套用、標 ⚠ 等站長重新確認 */
  base: unknown
  value: unknown
  note?: string
  updatedAt: string
  updatedBy: string
}

/** raidOverrides/{raid-21}：一期的欄位覆寫，鍵是 termHash(doc:docId:path) */
export interface RaidOverrideDoc {
  id: string
  seasonId: string
  entries: Record<string, RaidOverride>
}

/** raidTerms/{kind}：一個種類的對照表分片，鍵是 termHash(簡中原文)（原文可能含 . / 等欄位路徑字元） */
export interface RaidTermDoc {
  id: string
  kind: string
  entries: Record<string, RaidTermEntry>
}
