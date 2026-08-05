// 全站引用站點定義與掃描器（PLAN-030 C-1）
//
// 單一資料源：buildBuffPool（模擬器反向索引 PLAN-019-B）與 findReferences（級聯清除掃描）
// 走訪的是同一組站點定義。兩處各自維護 traversal 必然逐漸偏移造成漏清（PLAN-030 風險表 HIGH）。
//
// 純函式、無 React / Firestore 依賴，可單測（npm test）。
//
// ── 三個容易靜默出錯的地方（都有對應單元測試鎖住）──────────────────────────────
// (a) ChangeTargetKind 與 RefType 是兩套不同字串：pilotSkill↔skill、glossaryTerm↔term。
//     直接拿 kind 比對 EntityRef.refType → 所有技能/詞條引用靜默零命中。用 REF_TYPE_OF 映射。
// (b) descriptionRefs 的 map key 是使用者輸入的中文，理論上可含 '.'。故 segments 陣列才是
//     權威路徑，path 字串僅供顯示；C-2 組 Firestore FieldPath 只准用 segments。
// (c) 索引式路徑（talents.2.buffIds）不是穩定識別子——還原時陣列可能已被重排。
//     故每個站點盡量帶 anchor，讓 Phase F 能「先按 index 找、名稱不符則按 anchor 重新定位」。

import type {
  Pilot, PilotSkillDoc, GameBuff, GlossaryTerm, NeuralDriveAbility,
  Module, Weapon, Backpack, BackpackSkillDoc, Component,
  DescriptionRefs, RefType, SkillEffect,
} from '../types'
import type { ChangeTargetKind, ReversePatch, RefAnchor } from '../types/changeHistory'
import { parseBuffRef } from './buffRef.ts'
import { parseNumRefs, NUM_ATTRS } from './numRefs.ts'
import { isSkillId } from './pilotSkills.ts'

// ─── 目標型別映射（地雷 a）────────────────────────────────────────────────────

/**
 * ChangeTargetKind（changeHistory 的分類軸）→ RefType（EntityRef.refType 的值域）。
 * 兩套字串刻意不同名，直接比對 = 靜默零命中。新增 ChangeTargetKind 時務必補這裡。
 *
 * `null` = 該類型**不是**任何 descriptionRefs / 數值 token 的合法引用目標，
 * 故正文層永遠掃不到它（只走 scalarRef 路徑）。這與「忘了填」不同：值域是總的，
 * 漏填會編譯失敗，寫 null 是明示的編輯決策。
 */
export const REF_TYPE_OF: Record<ChangeTargetKind, RefType | null> = {
  buff:         'buff',
  pilotSkill:   'skill',
  glossaryTerm: 'term',
  backpack:     'backpack',
  // PLAN-043 決策七：本期只做「背包技能描述可引用 BUFF／詞條」的**出向**引用。
  // 讓別人寫 [移動強化] 反過來指向背包技能需新增 RefType + EntityRefView/RefChip/RefPicker
  // 四處分支，而全站目前沒有任何一段正文需要它——先加等於做出零消費端的休眠站點。
  backpackSkill: null,
}

/**
 * 站點可指向的目標類型。
 * 目前級聯只實作前三種（= ChangeTargetKind）；neuralDriveAbility 一併盤點，
 * 日後若開放刪除神驅能力可直接沿用。
 * 引用層外的外鍵（mech/module/weapon/pilot 互指）不在本檔範圍——PLAN-030 只刪這三類實體。
 */
export type RefTargetKind = ChangeTargetKind | 'neuralDriveAbility'

export type RefKind = 'buffIds' | 'descriptionRefs' | 'scalarRef' | 'numTokenText' | 'nameSoftRef'

/**
 * 還原時的重定位錨點（地雷 c）。
 * 定義已移至 types/changeHistory.ts —— 它會被序列化進刪除快照，屬持久化契約。
 */
export type { RefAnchor }

const pathOf = (segments: (string | number)[]): string => segments.join('.')

// ─── 四類站點的枚舉型別 ──────────────────────────────────────────────────────

/** buffIds[] 站點的一次出現。buffIds 保留**原始元素字串**（含 @N），arrayRemove 需精確相等。 */
export interface BuffIdOccurrence {
  segments: (string | number)[]
  /** 人類可讀來源標籤，如 '天賦:悖想先驅'。buildBuffPool 的 BuffSource.origin 直接用它。 */
  origin: string
  buffIds: string[]
  anchor?: RefAnchor
}

/**
 * 文案單元：一段（或多段）正文 + 其側錄表。
 *
 * descriptionRefs 與 numTokenText 兩種站點**都從這裡導出**——這是防「補了正文忘了補 refs」
 * 的機制核心。新增文案欄位只會改一處，不可能只補一半。
 */
export interface TextUnit {
  /** 單元所在物件的路徑，如 ['talents', 2] */
  segments: (string | number)[]
  origin: string
  /**
   * 正文欄位名 → 內容。刻意用 map 而非合併成一段：textFreeze 是逐欄位覆寫，
   * description 與 descriptionMax 必須各自成為獨立 patch。
   * 欄位名不一定叫 description（NeuralDriveLevel 是 effect、Mech 是 lore）。
   */
  texts: Record<string, string | undefined>
  refs?: DescriptionRefs
  /** 側錄表欄位名。預設 'descriptionRefs'。 */
  refsField?: string
  /**
   * refs 未填時前台回退取用的父單元路徑（ModuleLevel → 父 Module、ndVariant → 父 talent）。
   * 掃描器據此標記 inheritedFrom，避免對話框誤判「這個子項沒被影響」。
   */
  refsFallback?: (string | number)[]
  anchor?: RefAnchor
}

/** 純量外鍵站點（termRef / abilityId / skills[] 的字串元素）。 */
export interface ScalarOccurrence {
  segments: (string | number)[]
  origin: string
  /**
   * ReversePatch.value。陣列元素**必須是原始字串**（含 `@N` 等級後綴）——
   * Firestore arrayRemove 要求元素完全相等，存拆解後的裸 id 會移除失敗且靜默無錯。
   */
  value: string | null | undefined
  /**
   * 比對用的裸 id。省略則直接以 value 比對（絕大多數站點如此）。
   *
   * 只有「元素可帶 `@N` 等級後綴」的站點需要提供（backpacks.skillIds[]）——
   * 這是地雷①在 scalarRef 路徑上的翻版：字串相等會漏掉所有帶等級的引用。
   * 刻意做成顯式欄位而非在此路徑統一套 parseBuffRef：其餘站點（termRef / abilityId /
   * pilots.skills[]）的值域裡 '@' 不具語意，統一解析等於替它們憑空加上不存在的規則。
   */
  matchValue?: string
  /** 命中的等級（`@N` 的 N）。供對話框顯示，無等級語意的站點不填。 */
  level?: number
  /** 單一欄位 → fieldClear；陣列元素 → arrayRemove。決定 C-2 的移除方式。 */
  op: 'fieldClear' | 'arrayRemove'
  anchor?: RefAnchor
}

/** 名稱軟引用（condition.hasBuff）。只警示、**不自動清除**——以名稱關聯，ID 型級聯修不了。 */
export interface SoftOccurrence {
  segments: (string | number)[]
  origin: string
  name: string
}

export interface Site<T, O> {
  /** 穩定唯一鍵，供測試逐站點斷言與 buildBuffPool 選擇性排除。 */
  id: string
  targets: readonly RefTargetKind[]
  /** 型別在、但資料無或集合未接線。掃描照走，僅供報表分流。 */
  dormant?: boolean
  /**
   * true = 此站點的 buffIds **不代表「賦予」**，buildBuffPool 必須略過（PLAN-034 決策七）。
   *
   * 目前唯一的案例是 neuralDriveAbilities.buffUpgrades：它的語意是「把已存在的 buff 升階」，
   * 收進池子會讓模擬器誤判「這個高階 buff 可達」。
   *
   * **宣告式而非呼叫端傳參**是刻意的：runSpec 原本有個 skipSiteId 參數，但實測
   * buildBuffPool 從頭到尾沒有任何呼叫端傳過它——靠呼叫端記得傳＝零保護。
   * 寫在站點宣告上，新增呼叫路徑時不可能漏掉。
   */
  excludeFromPool?: boolean
  /**
   * true = 此站點的引用**不可機械清除**，命中即擋下整次刪除（PLAN-043）。
   *
   * 適用於「清成 null 會無聲破壞語意」的裸 id 硬外鍵，而非一般的引用側錄：
   *   · `backpacks.craft.prereqBackpackId` —— 清掉＝前置鏈斷裂，前台只會靜默降級成
   *     「前置主背包待確認」，沒有任何錯誤訊息，維護者要很久以後才會發現。
   *   · `weapons.upgrade.fusedBackpackId` —— 清掉＝複合武器失去融合來源（PLAN-031）。
   *
   * 與 softSites 的差別：軟引用是「以名稱關聯、ID 型級聯本來就修不了」，只警示；
   * 硬外鍵是「修得了但不該修」——正確做法是要求維護者先手動斷鏈再刪。
   *
   * 命中結果不進 hits（故 buildCascadePlan 不會為它產生 patch），改進 hardRefs，
   * 由 planCascadeDelete 轉成 blocker。
   */
  hardRef?: boolean
  enumerate: (doc: T) => O[]
}

export interface CollectionSpec<T> {
  coll: string
  nameOf: (doc: T) => string
  buffIdSites: Site<T, BuffIdOccurrence>[]
  textUnits: (doc: T) => TextUnit[]
  scalarSites: Site<T, ScalarOccurrence>[]
  softSites: Site<T, SoftOccurrence>[]
}

// ─── 共用小工具 ──────────────────────────────────────────────────────────────

type WithCondition = Pick<SkillEffect, never> & { condition?: { hasBuff?: string } | null }

/** 把 effects[].condition.hasBuff 這類名稱軟引用壓成 SoftOccurrence[]。 */
function condHits(
  base: (string | number)[],
  origin: string,
  effects?: readonly unknown[],
): SoftOccurrence[] {
  return (effects ?? []).flatMap((e, i) => {
    const hasBuff = (e as WithCondition)?.condition?.hasBuff
    return hasBuff
      ? [{ segments: [...base, i, 'condition', 'hasBuff'], origin, name: hasBuff }]
      : []
  })
}

const softSite = <T,>(id: string, enumerate: (d: T) => SoftOccurrence[]): Site<T, SoftOccurrence> =>
  ({ id, targets: ['buff'] as const, enumerate })

// ─── Collection specs ────────────────────────────────────────────────────────

const PILOTS: CollectionSpec<Pilot> = {
  coll: 'pilots',
  nameOf: (p) => p.name,

  buffIdSites: [
    {
      id: 'pilots.talents[].buffIds',
      targets: ['buff'],
      enumerate: (p) => (p.talents ?? []).map((t, i) => ({
        segments: ['talents', i, 'buffIds'],
        origin: `天賦:${t.name}`,            // ← buildBuffPool 既有字串，改一個字就改變去重行為
        buffIds: t.buffIds ?? [],
        anchor: { by: 'name' as const, value: t.name },
      })),
    },
    {
      // 地雷②：只取「嵌入物件」分支；字串 ID 分支見 scalarSites 的 pilots.skills[]。
      // 呼叫端已提供 resolved skills 時 buildBuffPool 必須排除本站點，否則雙計。
      id: 'pilots.skills[].buffIds',
      targets: ['buff'],
      enumerate: (p) => (p.skills ?? []).flatMap((entry, i) =>
        isSkillId(entry) ? [] : [{
          segments: ['skills', i, 'buffIds'],
          origin: `技能:${entry.name}`,
          buffIds: entry.buffIds ?? [],
          anchor: { by: 'name' as const, value: entry.name },
        }]),
    },
    {
      id: 'pilots.neuralDrive[].levels[].buffIds',
      targets: ['buff'],
      enumerate: (p) => (p.neuralDrive ?? []).flatMap((nd, i) =>
        (nd.levels ?? []).map((lv, j) => ({
          segments: ['neuralDrive', i, 'levels', j, 'buffIds'],
          origin: `神經驅動:${nd.name}`,      // ← 用分區名而非該級能力名，沿用既有語意
          buffIds: lv.buffIds ?? [],
          anchor: { by: 'level' as const, value: lv.level },
        }))),
    },
  ],

  textUnits: (p) => {
    const out: TextUnit[] = []
    ;(p.talents ?? []).forEach((t, i) => {
      out.push({
        segments: ['talents', i],
        origin: `天賦:${t.name}`,
        // 一份 refs 同時服務兩段正文，但 texts 分列 → 兩筆獨立 textFreeze patch
        texts: { description: t.description, descriptionMax: t.descriptionMax },
        refs: t.descriptionRefs,
        anchor: { by: 'name', value: t.name },
      })
      ;(t.ndVariants ?? []).forEach((v, k) => {
        out.push({
          segments: ['talents', i, 'ndVariants', k],
          origin: `天賦:${t.name}/算力≥${v.minSum}`,
          texts: { description: v.description, descriptionMax: v.descriptionMax },
          refs: v.descriptionRefs,
          // 前台以 {...talent.refs, ...variant.refs} 合併，清父層會影響此處顯示
          refsFallback: ['talents', i],
          anchor: { by: 'minSum', value: v.minSum },
        })
      })
    })
    ;(p.skills ?? []).forEach((entry, i) => {
      if (isSkillId(entry)) return                    // 地雷②：字串分支沒有 .description
      out.push({
        segments: ['skills', i],
        origin: `技能:${entry.name}`,
        texts: { description: entry.description },
        refs: entry.descriptionRefs,
        anchor: { by: 'name', value: entry.name },
      })
    })
    ;(p.neuralDrive ?? []).forEach((nd, i) =>
      (nd.levels ?? []).forEach((lv, j) =>
        out.push({
          segments: ['neuralDrive', i, 'levels', j],
          origin: `神經驅動:${nd.name} Lv${lv.level}`,
          texts: { effect: lv.effect },               // ← 欄位名是 effect 不是 description
          refs: lv.descriptionRefs,
          anchor: { by: 'level', value: lv.level },
        })))
    out.push({ segments: [], origin: '機師簡介', texts: { lore: p.lore } })
    return out
  },

  scalarSites: [
    {
      // 地雷②的另一半：union 的 string 分支就是 pilotSkill 引用，沒有欄位名可 grep
      id: 'pilots.skills[]',
      targets: ['pilotSkill'],
      enumerate: (p) => (p.skills ?? []).flatMap((entry, i) =>
        isSkillId(entry)
          ? [{ segments: ['skills', i], origin: '技能引用', value: entry, op: 'arrayRemove' as const }]
          : []),
    },
    {
      id: 'pilots.neuralDrive[].levels[].abilityId',
      targets: ['neuralDriveAbility'],
      enumerate: (p) => (p.neuralDrive ?? []).flatMap((nd, i) =>
        (nd.levels ?? []).flatMap((lv, j) => lv.abilityId
          ? [{
              segments: ['neuralDrive', i, 'levels', j, 'abilityId'],
              origin: `神經驅動:${nd.name} Lv${lv.level}`,
              value: lv.abilityId,
              op: 'fieldClear' as const,
              anchor: { by: 'level' as const, value: lv.level },
            }]
          : [])),
    },
  ],

  softSites: [
    softSite('pilots.talents[].effects[].condition.hasBuff', (p) =>
      (p.talents ?? []).flatMap((t, i) => condHits(['talents', i, 'effects'], `天賦:${t.name}`, t.effects))),
    softSite('pilots.talents[].enhancedEffects[].condition.hasBuff', (p) =>
      (p.talents ?? []).flatMap((t, i) =>
        condHits(['talents', i, 'enhancedEffects'], `天賦:${t.name}(專武)`, t.enhancedEffects))),
    softSite('pilots.skills[].effects[].condition.hasBuff', (p) =>
      (p.skills ?? []).flatMap((entry, i) =>
        isSkillId(entry) ? [] : condHits(['skills', i, 'effects'], `技能:${entry.name}`, entry.effects))),
    softSite('pilots.neuralDrive[].levels[].effects[].condition.hasBuff', (p) =>
      (p.neuralDrive ?? []).flatMap((nd, i) =>
        (nd.levels ?? []).flatMap((lv, j) =>
          condHits(['neuralDrive', i, 'levels', j, 'effects'], `神經驅動:${nd.name} Lv${lv.level}`, lv.effects)))),
  ],
}

const PILOT_SKILLS: CollectionSpec<PilotSkillDoc> = {
  coll: 'pilotSkills',
  nameOf: (s) => s.name,
  buffIdSites: [
    {
      id: 'pilotSkills.buffIds',
      targets: ['buff'],
      enumerate: (s) => [{ segments: ['buffIds'], origin: `技能:${s.name}`, buffIds: s.buffIds ?? [] }],
    },
  ],
  textUnits: (s) => [
    { segments: [], origin: `技能:${s.name}`, texts: { description: s.description }, refs: s.descriptionRefs },
    ...(s.variants ?? []).map((v, i) => ({
      segments: ['variants', i],
      origin: `技能:${s.name}/${v.condition}`,
      texts: { description: v.description },
    })),
  ],
  scalarSites: [
    {
      // 休眠站點：全 repo 零消費端、零 UI（PLAN-019 預留）。仍納入以防未來填值時漏掉。
      id: 'pilotSkills.variants[].skillRefIds',
      targets: ['pilotSkill'],
      dormant: true,
      enumerate: (s) => (s.variants ?? []).flatMap((v, i) =>
        (v.skillRefIds ?? []).map((rid, k) => ({
          segments: ['variants', i, 'skillRefIds', k],
          origin: `技能:${s.name}/${v.condition}`,
          value: rid,
          op: 'arrayRemove' as const,
        }))),
    },
  ],
  softSites: [
    softSite('pilotSkills.effects[].condition.hasBuff', (s) =>
      condHits(['effects'], `技能:${s.name}`, s.effects)),
    softSite('pilotSkills.variants[].effects[].condition.hasBuff', (s) =>
      (s.variants ?? []).flatMap((v, i) =>
        condHits(['variants', i, 'effects'], `技能:${s.name}/${v.condition}`, v.effects))),
  ],
}

const BUFFS: CollectionSpec<GameBuff> = {
  coll: 'buffs',
  nameOf: (b) => b.name,
  buffIdSites: [],                                    // GameBuff 不賦予其他 buff
  textUnits: (b) => [
    { segments: [], origin: `BUFF:${b.name}`, texts: { description: b.description }, refs: b.descriptionRefs },
    ...(b.levels ?? []).map((lv, i) => ({
      segments: ['levels', i],
      origin: `BUFF:${b.name} Lv${lv.level}`,
      texts: { description: lv.description },
      refs: lv.descriptionRefs,
      refsFallback: [] as (string | number)[],        // 未填時前台回退父層
      anchor: { by: 'level' as const, value: lv.level },
    })),
  ],
  scalarSites: [
    {
      id: 'buffs.termRef',
      targets: ['glossaryTerm'],
      enumerate: (b) => b.termRef
        ? [{ segments: ['termRef'], origin: `BUFF:${b.name}`, value: b.termRef, op: 'fieldClear' as const }]
        : [],
    },
  ],
  softSites: [
    softSite('buffs.effects[].condition.hasBuff', (b) => condHits(['effects'], `BUFF:${b.name}`, b.effects)),
    softSite('buffs.levels[].effects[].condition.hasBuff', (b) =>
      (b.levels ?? []).flatMap((lv, i) =>
        condHits(['levels', i, 'effects'], `BUFF:${b.name} Lv${lv.level}`, lv.effects))),
  ],
}

const GLOSSARY_TERMS: CollectionSpec<GlossaryTerm> = {
  coll: 'glossaryTerms',
  nameOf: (t) => t.name,
  buffIdSites: [],
  textUnits: (t) => [
    { segments: [], origin: `詞條:${t.name}`, texts: { description: t.description }, refs: t.descriptionRefs },
  ],
  scalarSites: [],
  softSites: [],
}

const NEURAL_DRIVE_ABILITIES: CollectionSpec<NeuralDriveAbility> = {
  coll: 'neuralDriveAbilities',
  nameOf: (a) => a.name,
  buffIdSites: [
    {
      id: 'neuralDriveAbilities.buffIds',
      targets: ['buff'],
      enumerate: (a) => [{ segments: ['buffIds'], origin: `神驅能力:${a.name}`, buffIds: a.buffIds ?? [] }],
    },
    {
      // PLAN-034：升階規則也是對 buff 的引用，必須進掃描——否則刪掉 buff_凝勢 時
      // 這些 `buff_凝勢@2` 會變成指空的孤兒，而覆寫層失效的症狀是「點算力沒反應」，
      // 沒有任何錯誤訊息。元素格式同 buffIds（`id@N`），故級聯清除（arrayRemove）
      // 與還原全部免費繼承 PLAN-030 既有機制。
      id: 'neuralDriveAbilities.buffUpgrades',
      targets: ['buff'],
      excludeFromPool: true,   // 「升階」不是「賦予」，不可進 buffPool
      enumerate: (a) => [{ segments: ['buffUpgrades'], origin: `神驅升階:${a.name}`, buffIds: a.buffUpgrades ?? [] }],
    },
  ],
  textUnits: (a) => [
    { segments: [], origin: `神驅能力:${a.name}`, texts: { description: a.description }, refs: a.descriptionRefs },
  ],
  scalarSites: [],
  softSites: [
    softSite('neuralDriveAbilities.effects[].condition.hasBuff', (a) =>
      condHits(['effects'], `神驅能力:${a.name}`, a.effects)),
  ],
}

const MODULES: CollectionSpec<Module> = {
  coll: 'modules',
  nameOf: (m) => m.name,
  buffIdSites: [
    {
      id: 'modules.buffIds',
      targets: ['buff'],
      enumerate: (m) => [{ segments: ['buffIds'], origin: `模組:${m.name}`, buffIds: m.buffIds ?? [] }],
    },
  ],
  textUnits: (m) => [
    { segments: [], origin: `模組:${m.name}`, texts: { description: m.description }, refs: m.descriptionRefs },
    ...(m.levels ?? []).map((lv, i) => ({
      segments: ['levels', i],
      origin: `模組:${m.name} Lv${lv.level}`,
      texts: { description: lv.description },
      refs: lv.descriptionRefs,
      refsFallback: [] as (string | number)[],        // 型別註解明寫：未設定時回退父模組
      anchor: { by: 'level' as const, value: lv.level },
    })),
  ],
  scalarSites: [],
  softSites: [],
}

const WEAPONS: CollectionSpec<Weapon> = {
  coll: 'weapons',
  nameOf: (w) => w.name,
  buffIdSites: [
    {
      // Weapon 無頂層 buffIds，只經 skills[]
      id: 'weapons.skills[].buffIds',
      targets: ['buff'],
      enumerate: (w) => (w.skills ?? []).map((ws, i) => ({
        segments: ['skills', i, 'buffIds'],
        origin: `武器技能:${ws.name}`,
        buffIds: ws.buffIds ?? [],
        anchor: { by: 'name' as const, value: ws.name },
      })),
    },
  ],
  textUnits: (w) => [
    { segments: [], origin: `武器:${w.name}`, texts: { description: w.description } },
    ...(w.skills ?? []).map((ws, i) => ({
      segments: ['skills', i],
      origin: `武器技能:${ws.name}`,
      // enhancedTalentDescription 無自己的 refs 表，但會經 DiffHighlight → resolveNumRefs
      texts: { description: ws.description, enhancedTalentDescription: ws.enhancedTalentDescription },
      refs: ws.descriptionRefs,
      anchor: { by: 'name' as const, value: ws.name },
    })),
  ],
  scalarSites: [
    {
      // PLAN-043 硬外鍵：複合武器融合來源的背包（PLAN-031）。清成 null ＝ 武器失去
      // 融合來源、詳情頁的「融合自 ○○背包」變空白，且無任何錯誤訊息。
      // 命中時擋下背包刪除，要求維護者先處理該武器。
      id: 'weapons.upgrade.fusedBackpackId',
      targets: ['backpack'],
      hardRef: true,
      enumerate: (w) => w.upgrade?.fusedBackpackId
        ? [{
            segments: ['upgrade', 'fusedBackpackId'],
            origin: `武器:${w.name} 的融合來源`,
            value: w.upgrade.fusedBackpackId,
            op: 'fieldClear' as const,
          }]
        : [],
    },
  ],
  softSites: [
    softSite('weapons.skills[].effects[].condition.hasBuff', (w) =>
      (w.skills ?? []).flatMap((ws, i) =>
        condHits(['skills', i, 'effects'], `武器技能:${ws.name}`, ws.effects))),
  ],
}

const BACKPACKS: CollectionSpec<Backpack> = {
  coll: 'backpacks',
  nameOf: (b) => b.name,
  // PLAN-043 Phase E：內嵌 mainSkill 已從 Firestore 與型別移除，其 buffIds／textUnits
  // 兩個站點隨之刪除。背包本身不再直接賦予 buff——buff 一律經 skillIds 指向的
  // backpackSkills doc（見 BACKPACK_SKILLS spec）。
  buffIdSites: [],
  textUnits: () => [],
  scalarSites: [
    {
      // PLAN-043：掛載的背包技能。元素可含 @N（`bpskill_移動強化@1`），故比對前要拆後綴——
      // 這正是地雷①在 buffIds 上的翻版，只是這裡走 scalarRef 路徑。
      id: 'backpacks.skillIds[]',
      targets: ['backpackSkill'],
      enumerate: (b) => (b.skillIds ?? []).flatMap((raw, i) => {
        if (!raw) return []
        const { buffId, level } = parseBuffRef(raw)   // 泛用的 `id@N` 拆解，非 buff 專用
        return [{
          segments: ['skillIds', i],
          origin: `背包:${b.name}`,
          value: raw,                                  // 原始元素（含 @N），arrayRemove 用
          matchValue: buffId,                          // 裸 id，比對用
          level,
          op: 'arrayRemove' as const,
        }]
      }),
    },
    {
      // PLAN-043 硬外鍵：清成 null ＝ PLAN-036 的前置鏈斷裂，且前台只會靜默降級
      // 成「前置主背包待確認」。命中時擋下刪除，要求維護者先斷鏈。
      id: 'backpacks.craft.prereqBackpackId',
      targets: ['backpack'],
      hardRef: true,
      enumerate: (b) => b.craft?.prereqBackpackId
        ? [{
            segments: ['craft', 'prereqBackpackId'],
            origin: `背包:${b.name} 的前置`,
            value: b.craft.prereqBackpackId,
            op: 'fieldClear' as const,
          }]
        : [],
    },
  ],
  softSites: [],
}

const BACKPACK_SKILLS: CollectionSpec<BackpackSkillDoc> = {
  coll: 'backpackSkills',
  nameOf: (s) => s.name,
  buffIdSites: [
    {
      id: 'backpackSkills.buffIds',
      targets: ['buff'],
      enumerate: (s) => [{ segments: ['buffIds'], origin: `背包技能:${s.name}`, buffIds: s.buffIds ?? [] }],
    },
    {
      id: 'backpackSkills.levels[].buffIds',
      targets: ['buff'],
      enumerate: (s) => (s.levels ?? []).map((lv, i) => ({
        segments: ['levels', i, 'buffIds'],
        origin: `背包技能:${s.name} Lv${lv.level}`,
        buffIds: lv.buffIds ?? [],
        anchor: { by: 'level' as const, value: lv.level },
      })),
    },
  ],
  textUnits: (s) => [
    { segments: [], origin: `背包技能:${s.name}`, texts: { description: s.description }, refs: s.descriptionRefs },
    ...(s.levels ?? []).map((lv, i) => ({
      segments: ['levels', i],
      origin: `背包技能:${s.name} Lv${lv.level}`,
      texts: { description: lv.description },
      refs: lv.descriptionRefs,
      refsFallback: [] as (string | number)[],        // 未填時前台回退父層（同 BUFF / 模組）
      anchor: { by: 'level' as const, value: lv.level },
    })),
  ],
  scalarSites: [],
  softSites: [
    softSite('backpackSkills.effects[].condition.hasBuff', (s) =>
      condHits(['effects'], `背包技能:${s.name}`, s.effects)),
    softSite('backpackSkills.levels[].effects[].condition.hasBuff', (s) =>
      (s.levels ?? []).flatMap((lv, i) =>
        condHits(['levels', i, 'effects'], `背包技能:${s.name} Lv${lv.level}`, lv.effects))),
  ],
}

const COMPONENTS: CollectionSpec<Component> = {
  coll: 'components',
  nameOf: (c) => c.name,
  buffIdSites: [],
  textUnits: (c) => [
    { segments: [], origin: `元件:${c.name}`, texts: { description: c.description }, refs: c.descriptionRefs },
  ],
  scalarSites: [],
  softSites: [],
}

/** 全站 spec registry。新增集合時在此補一筆——測試會斷言集合清單完整性。 */
export const SPECS = {
  pilots: PILOTS,
  pilotSkills: PILOT_SKILLS,
  buffs: BUFFS,
  glossaryTerms: GLOSSARY_TERMS,
  neuralDriveAbilities: NEURAL_DRIVE_ABILITIES,
  modules: MODULES,
  weapons: WEAPONS,
  backpacks: BACKPACKS,
  backpackSkills: BACKPACK_SKILLS,
  components: COMPONENTS,
} as const

export type ScanCollection = keyof typeof SPECS

export const ALL_SCAN_COLLECTIONS = Object.keys(SPECS) as ScanCollection[]

/** buildBuffPool 專用：呼叫端已提供 resolved skills 時要排除的站點（否則嵌入技能雙計）。 */
export const SKIP_WHEN_SKILLS_RESOLVED = 'pilots.skills[].buffIds'

// ─── findReferences ──────────────────────────────────────────────────────────

/**
 * 掃描資料來源。
 * **選填是刻意的**：undefined = 該集合未載入（必須警示，不可當成「無引用」）；
 * [] = 已載入且確實沒有資料。兩者語意完全不同。
 */
export interface RefScanData {
  pilots?: Pilot[]
  pilotSkills?: PilotSkillDoc[]
  buffs?: GameBuff[]
  glossaryTerms?: GlossaryTerm[]
  neuralDriveAbilities?: NeuralDriveAbility[]
  modules?: Module[]
  weapons?: Weapon[]
  backpacks?: Backpack[]
  backpackSkills?: BackpackSkillDoc[]
  components?: Component[]
}

export interface RefHit {
  coll: string
  docId: string
  /** 顯示用名稱（去正規化，比照 ChangeHistoryEntry.targetName） */
  docName: string
  siteId: string
  kind: RefKind
  /** 權威路徑。C-2 只准用它組 Firestore FieldPath——map key 可能含 '.'（地雷 b） */
  segments: (string | number)[]
  /** 顯示 / ReversePatch.path 用 */
  path: string
  /** 人類可讀位置，如 '天賦:悖想先驅' */
  origin: string
  op: ReversePatch['op']
  /**
   * ReversePatch.value：
   *   arrayRemove  → 原始元素字串（含 @N）
   *   mapKeyDelete → 完整 EntityRef 物件（含 label / level，還原需要）
   *   fieldClear   → 原純量值
   *   textFreeze   → **凍結前的完整原始字串**（非 token）
   */
  value: unknown
  /** 命中細節：buffIds 原始元素 / descriptionRefs 的 map key */
  matched?: string
  /** 命中的等級：@N 或 EntityRef.level 或 <id.lvN.attr> 的 N */
  level?: number
  /** textFreeze 專用：本欄位內命中的所有 token 原文 */
  tokens?: string[]
  anchor?: RefAnchor
  /** 此單元 refs 未填、實際沿用父層 → 清父層會影響此處顯示。對話框需提示。 */
  inheritedFrom?: string
}

export interface FindReferencesResult {
  /** 可機械清除的引用。C-2 逐筆轉 ReversePatch。 */
  hits: RefHit[]
  /**
   * 硬外鍵命中（PLAN-043）：**不清除、直接擋下刪除**。
   *
   * 與 softWarnings 的差別在「能不能修」而非「該不該提醒」：軟引用以名稱關聯、
   * ID 型級聯本來就修不了；硬外鍵修得了但不該修——自動清成 null 會無聲破壞
   * 前置鏈／融合關係，正確做法是要求維護者先斷鏈。planCascadeDelete 轉成 blocker。
   */
  hardRefs: RefHit[]
  /** 名稱軟引用的疑似命中：**不自動清除**，只列給管理員自行處理。 */
  softWarnings: RefHit[]
  /** 對話框摘要：{ pilots: 3, buffs: 5 } */
  byColl: Record<string, number>
  scannedColls: string[]
  /** 未提供而未掃描的集合。非空時對話框不得顯示「無引用」，只能顯示「未完整掃描」。 */
  missingColls: string[]
  /** hits.length + 1（目標本身 deleteDoc）；C-4 據此擋 Firestore batch 500 上限 */
  writeCount: number
}

/**
 * 掃描全站對某實體的引用。
 *
 * @param kind 被刪除的實體類型
 * @param id   被刪除的文件 ID
 * @param data 各集合的已載入資料；未提供的集合會列進 missingColls
 * @param opts.name 目標名稱，供 nameSoftRef 比對；省略時自 data 對應集合查
 */
export function findReferences(
  kind: ChangeTargetKind,
  id: string,
  data: RefScanData,
  opts?: { name?: string; kinds?: RefKind[] },
): FindReferencesResult {
  const wantType = REF_TYPE_OF[kind]                  // 地雷 a
  const selfColl = SPEC_COLL_OF[kind]
  const want = (k: RefKind) => !opts?.kinds || opts.kinds.includes(k)

  const hits: RefHit[] = []
  const hardRefs: RefHit[] = []
  const softWarnings: RefHit[] = []
  const scannedColls: string[] = []
  const missingColls: string[] = []

  // 目標名稱：供 nameSoftRef 比對。查不到就不猜——寧可不報也不誤報。
  const targetName = opts?.name ?? findSelfName(kind, id, data)

  for (const coll of ALL_SCAN_COLLECTIONS) {
    const docs = data[coll] as { id: string }[] | undefined
    if (docs === undefined) { missingColls.push(coll); continue }
    scannedColls.push(coll)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spec = SPECS[coll] as CollectionSpec<any>

    for (const doc of docs) {
      // 自我排除：即將被刪的文件不需要修補單。更硬的理由是同一個 WriteBatch 內
      // 對已 delete 的文件再 update 會把它復活成殘缺文件（C-4 的正確性前提）。
      if (coll === selfColl && doc.id === id) continue

      const base = { coll, docId: doc.id, docName: spec.nameOf(doc) }

      // ① buffIds —— 地雷①：必須 parseBuffRef 後比對，字串相等會漏 @N
      if (kind === 'buff' && want('buffIds')) {
        for (const site of spec.buffIdSites) {
          for (const occ of site.enumerate(doc)) {
            for (const raw of occ.buffIds) {
              if (!raw) continue
              const { buffId, level } = parseBuffRef(raw)
              if (buffId !== id) continue
              hits.push({
                ...base, siteId: site.id, kind: 'buffIds',
                segments: occ.segments, path: pathOf(occ.segments), origin: occ.origin,
                op: 'arrayRemove', value: raw, matched: raw, level, anchor: occ.anchor,
              })
            }
          }
        }
      }

      // ② descriptionRefs（側錄表）與 ③ numTokenText（文案內嵌 token）
      for (const unit of spec.textUnits(doc)) {
        const refsField = unit.refsField ?? 'descriptionRefs'

        if (want('descriptionRefs') && wantType) {
          for (const [key, ref] of Object.entries(unit.refs ?? {})) {
            if (ref.refType !== wantType || ref.refId !== id) continue
            const segments = [...unit.segments, refsField, key]
            hits.push({
              ...base, siteId: `${coll}.${pathOf(unit.segments)}${unit.segments.length ? '.' : ''}${refsField}`,
              kind: 'descriptionRefs',
              segments, path: pathOf(segments), origin: unit.origin,
              op: 'mapKeyDelete', value: ref, matched: key, level: ref.level,
              anchor: unit.anchor,
              inheritedFrom: unit.refsFallback ? pathOf(unit.refsFallback) : undefined,
            })
          }
        }

        // wantType === null（backpackSkill）→ 不是任何正文引用的合法目標，整段跳過
        if (want('numTokenText') && wantType) {
          for (const [field, text] of Object.entries(unit.texts)) {
            if (!text) continue
            const tokens = parseNumRefs(text)
              .filter((s) => s.type === 'numRef' && s.refId === id
                && (NUM_ATTRS[s.attr]?.refTypes ?? []).includes(wantType))
              .map((s) => (s as { raw: string }).raw)
            if (!tokens.length) continue
            const segments = [...unit.segments, field]
            hits.push({
              ...base, siteId: `${coll}.${pathOf(segments)}`, kind: 'numTokenText',
              segments, path: pathOf(segments), origin: unit.origin,
              // value = 整段原文。逐 token 各發一筆會讓第二次凍結存到「已凍結」的字串 → 還原失真
              op: 'textFreeze', value: text, tokens, anchor: unit.anchor,
            })
          }
        }
      }

      // ④ scalarRef（termRef / abilityId / skills[] 字串元素 / 硬外鍵）
      if (want('scalarRef')) {
        for (const site of spec.scalarSites) {
          if (!site.targets.includes(kind as RefTargetKind)) continue
          for (const occ of site.enumerate(doc)) {
            // matchValue 優先：帶 @N 後綴的站點以裸 id 比對，value 仍留原始字串
            if ((occ.matchValue ?? occ.value) !== id) continue
            const hit: RefHit = {
              ...base, siteId: site.id, kind: 'scalarRef',
              segments: occ.segments, path: pathOf(occ.segments), origin: occ.origin,
              op: occ.op, value: occ.value, matched: occ.value ?? undefined,
              level: occ.level, anchor: occ.anchor,
            }
            // hardRef 不進 hits：進了就會被 buildCascadePlan 產出 patch 自動清掉，
            // 而這類外鍵清成 null 會無聲破壞語意（見 Site.hardRef）。改交給 planCascadeDelete 轉 blocker。
            ;(site.hardRef ? hardRefs : hits).push(hit)
          }
        }
      }

      // ⑤ nameSoftRef —— 以「名稱」關聯，ID 型級聯修不了 → 只警示不清除
      if (kind === 'buff' && targetName && want('nameSoftRef')) {
        for (const site of spec.softSites) {
          for (const occ of site.enumerate(doc)) {
            if (occ.name !== targetName) continue
            softWarnings.push({
              ...base, siteId: site.id, kind: 'nameSoftRef',
              segments: occ.segments, path: pathOf(occ.segments), origin: occ.origin,
              op: 'fieldClear', value: occ.name, matched: occ.name,
            })
          }
        }
      }
    }
  }

  const byColl: Record<string, number> = {}
  for (const h of hits) byColl[h.coll] = (byColl[h.coll] ?? 0) + 1

  return { hits, hardRefs, softWarnings, byColl, scannedColls, missingColls, writeCount: hits.length + 1 }
}

/** ChangeTargetKind → 其自身所在集合（自我排除用）。 */
const SPEC_COLL_OF: Record<ChangeTargetKind, ScanCollection> = {
  buff: 'buffs',
  pilotSkill: 'pilotSkills',
  glossaryTerm: 'glossaryTerms',
  backpack: 'backpacks',
  backpackSkill: 'backpackSkills',
}

/** 從 data 反查目標自身的 name（nameSoftRef 比對用）。查不到回 undefined，不猜。 */
function findSelfName(kind: ChangeTargetKind, id: string, data: RefScanData): string | undefined {
  const coll = SPEC_COLL_OF[kind]
  const docs = data[coll] as { id: string; name?: string }[] | undefined
  return docs?.find((d) => d.id === id)?.name
}
