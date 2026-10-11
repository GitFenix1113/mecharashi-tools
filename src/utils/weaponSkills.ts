// 武器技能解析層（PLAN-032 M1）
//
// `Weapon.skills[]` 過渡期會同時存在兩種格式：
//   · WeaponSkillRef  `{ skillId, activation }` — 已引用化，技能本體住在技能庫（pilotSkills 集合）
//   · WeaponSkill     內嵌拷貝 — 爬蟲產出的原始形狀（見 types/weapon.ts）。
//     2026-10-11 起後台不再能建立此格式，殘留的由武器編輯器「轉入技能庫」（embeddedToSkillDoc）
// 這層把兩者攤平成同一個 ResolvedWeaponSkill，前端不需在意目前是哪種。
//
// 純函式、無 React / Firestore 依賴，可單測（npm test）。
//
// ── 與 backpackSkills.ts 的差異 ──────────────────────────────────────────────
// 背包掛的是 `bpskill_移動強化@1` 這種「id + 等級」字串，解析的是**等級覆寫**；
// 武器掛的是物件，解析的是**格式差異**，且掛載側額外帶一個 activation。
// 兩者同樣走「查不到就略過」的優雅降級，也同樣提供 hasXxxSkills() 取代裸 .length。

import type {
  Weapon, WeaponSkill, WeaponSkillRef, PilotSkillDoc, DescriptionRefs, SkillEffect,
} from '../types'
import { SkillType } from '../types/enums.ts'
import { isLibraryKey, keyFromValue } from './gameIcons.ts'

/** 解析後的單一武器技能：技能庫的共用定義 + 這把武器的掛載資訊，呼叫端直接拿來渲染。 */
export interface ResolvedWeaponSkill {
  /** 技能庫 doc id。**內嵌未遷移者為空字串**——不可拿來當 React key 或去查 skillMap */
  id: string
  name: string
  type: string
  /**
   * 生效方式。**一律取自掛載側**（WeaponSkillRef.activation），不是技能定義的一部分——
   * 實測 44 個重複技能名群組中 38 個在此欄衝突（赤狐·改 carry vs 魔笛 use）。
   */
  activation: 'carry' | 'equip' | 'use'
  description: string
  descriptionRefs?: DescriptionRefs
  icon?: string
  iconLocal?: string
  effects: SkillEffect[]
  buffIds: string[]
  /** 專武技能才有：此技能強化的天賦名 */
  enhancesTalentName?: string
  /** 專武技能才有：天賦被強化後的原文（與 descriptionRefs 一起消費，故同住定義側） */
  enhancedTalentDescription?: string
  /** 來源標籤，格式對齊 entityRefs 的 WEAPONS spec origin（模擬器 BuffSource.origin 用） */
  origin: string
}

/**
 * 判斷 skills 條目是否已是引用格式。
 * 鑑別鍵 `'skillId' in entry`——內嵌 WeaponSkill 沒有這個欄位（它用 name 當識別）。
 */
export function isWeaponSkillRef(
  entry: WeaponSkillRef | WeaponSkill,
): entry is WeaponSkillRef {
  return 'skillId' in entry
}

/** 內嵌 WeaponSkill → ResolvedWeaponSkill（原地攤平，不查表） */
function fromEmbedded(s: WeaponSkill): ResolvedWeaponSkill {
  return {
    id: '',                       // 未遷移：無技能庫 doc
    name: s.name,
    type: s.type,
    activation: s.activation,
    description: s.description,
    descriptionRefs: s.descriptionRefs,
    icon: s.icon,
    iconLocal: s.iconLocal,
    effects: s.effects ?? [],
    buffIds: s.buffIds ?? [],
    enhancesTalentName: s.enhancesTalentName,
    enhancedTalentDescription: s.enhancedTalentDescription,
    origin: `武器技能:${s.name}`,
  }
}

/** 技能庫 doc + 掛載側 activation → ResolvedWeaponSkill */
function fromRef(ref: WeaponSkillRef, doc: PilotSkillDoc): ResolvedWeaponSkill {
  return {
    id: doc.id,
    name: doc.name,
    type: doc.type,
    activation: ref.activation,   // ← 掛載側勝出，技能 doc 沒有這個欄位
    description: doc.description,
    descriptionRefs: doc.descriptionRefs,
    icon: doc.icon || undefined,
    effects: doc.effects ?? [],
    buffIds: doc.buffIds ?? [],
    enhancesTalentName: doc.enhancesTalentName,
    enhancedTalentDescription: doc.enhancedTalentDescription,
    origin: `武器技能:${doc.name}`,
  }
}

/**
 * 解析 weapon.skills → ResolvedWeaponSkill[]。
 *
 * ── 查不到的 skillId 一律略過 ────────────────────────────────────────────────
 * 沿用 resolvePilotSkills / resolveBackpackSkills 的優雅降級：技能庫尚未載入、
 * doc 被刪或 id 打錯時，前台少顯示一塊，而不是整頁炸掉。
 * 該被看見的是維護者（後台挑選器會標紅字），不是使用者。
 *
 * ⚠ 也因此**不可**用 `weapon.skills.length` 當顯示 gate ——
 * 那個長度只代表「掛了幾筆」，技能庫還沒載入時它仍 > 0，gate 會開、然後渲染出一塊空白區。
 * 用 hasWeaponSkills() 或直接 gate 在本函式的回傳陣列上。
 */
export function resolveWeaponSkills(
  skills: Weapon['skills'] | undefined,
  skillMap: Map<string, PilotSkillDoc>,
): ResolvedWeaponSkill[] {
  if (!Array.isArray(skills)) return []
  const out: ResolvedWeaponSkill[] = []
  for (const entry of skills) {
    if (!entry) continue
    if (isWeaponSkillRef(entry)) {
      const doc = skillMap.get(entry.skillId)
      if (doc) out.push(fromRef(entry, doc))   // 查不到 → 略過（見上）
    } else {
      out.push(fromEmbedded(entry))
    }
  }
  return out
}

/**
 * 武器是否有任何**解析得到**的技能。
 *
 * 刻意提供這支而非讓呼叫端寫 `weapon.skills.length > 0`——後者對 union 的兩個成員
 * 都合法，tsc 抓不到，是本計畫已知的 6 個靜默壞點（見進度表 M1）。
 */
export function hasWeaponSkills(
  skills: Weapon['skills'] | undefined,
  skillMap: Map<string, PilotSkillDoc>,
): boolean {
  return resolveWeaponSkills(skills, skillMap).length > 0
}

/**
 * 內嵌 WeaponSkill → 技能庫 doc（後台武器編輯器「轉入技能庫」用，2026-10-11）。
 *
 * 只產出**定義側**欄位；activation 是掛載側的（見 WeaponSkillRef），
 * 呼叫端換成 `{ skillId: id, activation: s.activation }` 時沿用原值。
 *
 * 圖示：內嵌格式的 iconLocal 多半還是 PLAN-055 前的舊路徑（`/images/skills/被動技能/Icon_skill_passive_5208.png`），
 * 技能庫只存官方檔名 key，這裡取檔名；兩欄都不是圖庫 key 就留空，交給維護者在編輯面板補。
 */
export function embeddedToSkillDoc(s: WeaponSkill, id: string): PilotSkillDoc {
  const icon = [s.iconLocal, s.icon].map(keyFromValue).find(isLibraryKey) ?? ''
  const refs = s.descriptionRefs && Object.keys(s.descriptionRefs).length > 0 ? s.descriptionRefs : undefined
  return {
    id,
    name: s.name.trim(),
    type: s.type || SkillType.PASSIVE,
    description: s.description ?? '',
    ...(refs && { descriptionRefs: refs }),
    icon,
    effects: s.effects ?? [],
    buffIds: s.buffIds ?? [],
    manual: true,
    domain: 'weapon',
    ...(s.enhancesTalentName && { enhancesTalentName: s.enhancesTalentName }),
    ...(s.enhancedTalentDescription && { enhancedTalentDescription: s.enhancedTalentDescription }),
  }
}

/** 掛載某技能的一把武器（反查結果的一筆） */
export interface WeaponSkillHolder {
  weaponId: string
  weaponName: string
}

/**
 * 技能 id → 掛載它的武器（只算引用格式；內嵌拷貝沒有 skillId，本來就不屬於任何技能庫 doc）。
 * 後台「武器技能」分頁標孤兒、武器編輯器標「另有 N 把武器共用」都吃這份。
 */
export function weaponSkillHolders(weapons: readonly Weapon[]): Map<string, WeaponSkillHolder[]> {
  const out = new Map<string, WeaponSkillHolder[]>()
  for (const w of weapons) {
    if (!Array.isArray(w.skills)) continue
    const seen = new Set<string>()
    for (const entry of w.skills) {
      if (!entry || !isWeaponSkillRef(entry) || seen.has(entry.skillId)) continue
      seen.add(entry.skillId)
      const list = out.get(entry.skillId)
      const holder = { weaponId: w.id, weaponName: w.name }
      if (list) list.push(holder)
      else out.set(entry.skillId, [holder])
    }
  }
  return out
}
