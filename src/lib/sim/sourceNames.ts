// ─── 效果來源 → 站上名稱（PLAN-065-C C-4）──────────────────────────────────────
//
// 回應裡的效果來源只有 { kind, id }（遊戲 ID）。這裡把站上各集合的 gameRef 反查成名稱，
// 讓驗證台的「已計入／未計入」清單看得懂。查不到就顯示種類＋ID，不猜。
// kind 只用來決定同一個 ID 對到多個集合時優先顯示哪一個（純顯示用）。
//
// 純函式，可單測（npm test）。

import type { Backpack, Boss, Component, Mech, MechForm, Module, Pilot, PilotSkillDoc, Weapon } from '../../types/index.ts'
import type { GameId, ReasonCode, SourceRef } from './contract.ts'

export type SourceCollection =
  | 'pilots' | 'mechs' | 'weapons' | 'modules' | 'components' | 'backpacks' | 'pilotSkills' | 'forms' | 'bosses'

export interface SourceNameIndex {
  byId: ReadonlyMap<GameId, ReadonlyArray<{ collection: SourceCollection; name: string }>>
}

export interface SourceNameInput {
  pilots?: Iterable<Pilot>
  mechs?: Iterable<Mech>
  weapons?: Iterable<Weapon>
  modules?: Iterable<Module>
  components?: Iterable<Component>
  backpacks?: Iterable<Backpack>
  pilotSkills?: Iterable<PilotSkillDoc>
  forms?: Iterable<MechForm>
  bosses?: Iterable<Boss>
}

export function buildSourceNameIndex(input: SourceNameInput): SourceNameIndex {
  const byId = new Map<GameId, Array<{ collection: SourceCollection; name: string }>>()
  const add = (id: GameId | undefined, collection: SourceCollection, name: string) => {
    if (id === undefined || !Number.isFinite(id)) return
    const list = byId.get(id) ?? []
    if (!list.some((x) => x.collection === collection && x.name === name)) list.push({ collection, name })
    byId.set(id, list)
  }
  for (const x of input.pilots ?? []) add(x.gameRef?.pilotInfoId, 'pilots', x.name)
  for (const x of input.mechs ?? []) add(x.gameRef?.suitId, 'mechs', x.name)
  for (const x of input.weapons ?? []) add(x.gameRef?.weaponInfoId, 'weapons', x.name)
  for (const x of input.modules ?? []) {
    add(x.gameRef?.entryId, 'modules', x.name)
    add(x.gameRef?.itemId, 'modules', x.name)
  }
  for (const x of input.components ?? []) add(x.gameRef?.weaponEntryId, 'components', x.name)
  for (const x of input.backpacks ?? []) add(x.gameRef?.backpackInfoId, 'backpacks', x.name)
  for (const x of input.pilotSkills ?? []) {
    const r = x.gameRef
    for (const id of [...(r?.mainSkillIds ?? []), ...(r?.passiveSkillIds ?? []), ...(r?.activeSkillIds ?? [])]) add(id, 'pilotSkills', x.name)
  }
  for (const x of input.forms ?? []) add(x.gameRef?.passiveSkillId, 'forms', x.name)
  for (const x of input.bosses ?? []) {
    for (const v of Object.values(x.variants ?? {})) add(v?.templateId, 'bosses', x.name)
  }
  return { byId }
}

/** 效果來源的種類名稱。 */
export const SOURCE_KIND_LABEL: Readonly<Record<SourceRef['kind'], string>> = {
  pilotTpl: '機師',
  computerUnit: '電腦單元',
  talent: '天賦',
  ndEffect: '神經驅動',
  mainSkill: '主技能',
  activeSkill: '主動技能',
  part: '機甲部位',
  wapEntryLevel: '模組',
  weapon: '武器',
  weaponPassive: '武器被動',
  weaponRandomPassive: '武器隨機詞條',
  refit: '改裝',
  research: '科研',
  backpack: '背包',
  componentPair: '元件',
  form: '形態',
  raidEnhance: '討伐強化詞條',
  raidWeek: '討伐週詞條',
  mapGlobal: '地圖效果',
  bossTpl: '首領',
  bossTrigger: '首領觸發',
  override: '覆寫',
}

/** 同一個 ID 對到多個集合時，依種類優先顯示的集合（純顯示用）。 */
const PREFERRED: Partial<Record<SourceRef['kind'], SourceCollection[]>> = {
  pilotTpl: ['pilots'],
  part: ['mechs'],
  weapon: ['weapons'],
  backpack: ['backpacks'],
  componentPair: ['components'],
  wapEntryLevel: ['modules'],
  form: ['forms'],
  bossTpl: ['bosses'],
  bossTrigger: ['bosses'],
  mainSkill: ['pilotSkills'],
  activeSkill: ['pilotSkills'],
  talent: ['pilotSkills'],
  weaponPassive: ['pilotSkills', 'weapons'],
  weaponRandomPassive: ['pilotSkills', 'weapons'],
}

/** 「武器〈碎狼牙〉」；查不到時「武器 #10203」。有 slot 時附在後面。 */
export function sourceLabel(ref: SourceRef, idx: SourceNameIndex): string {
  const kind = SOURCE_KIND_LABEL[ref.kind] ?? ref.kind
  const hits = idx.byId.get(ref.id) ?? []
  const pref = PREFERRED[ref.kind] ?? []
  const pick = pref.map((c) => hits.find((h) => h.collection === c)).find(Boolean) ?? (hits.length === 1 ? hits[0] : undefined)
  const lv = ref.level !== undefined ? ` Lv.${ref.level}` : ''
  const at = ref.slot ? `（${ref.slot}）` : ''
  return pick ? `${kind}〈${pick.name}〉${lv}${at}` : `${kind} #${ref.id}${lv}${at}`
}

/** 未計入原因的說明（與契約的原因碼一一對應）。 */
export const REASON_LABEL: Readonly<Record<ReasonCode, string>> = {
  condUnsupported: '條件尚未支援',
  funcTypeUnsupported: '效果尚未支援',
  dynamicUnsupported: '需要戰鬥中的動態狀態',
  timingOutOfScope: '觸發時機不在這次行動內',
  unmappedEntity: '站上實體尚未連結遊戲 ID',
  notInEngineData: '引擎資料沒有這筆記錄',
  twOnly: '台版獨有，資料包沒有',
  serverState: '取決於伺服器端狀態',
  switchOff: '情境開關關閉',
  probabilityExcluded: '機率模式設為不發生',
  flagPending: '待驗證，預設不計',
  bossMechanicExcluded: '首領機制，刻意不計',
  undefinedProperty: '屬性未定義',
}
