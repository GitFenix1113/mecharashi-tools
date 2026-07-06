// 配裝 → 可用 buff 池：反向索引（PLAN-019-B Layer 2）
//
// 模擬器把「會賦予 buff」的配裝實體之 buffIds[] 收集起來，逐個 parseBuffRef 拆 id@N，
// 輸出帶來源標註的 BuffSource[]。這是「可達 buff」的第一步——只有來源在配裝中的 buff 才會出現，
// 杜絕未來傷害模擬器發散出「不可能存在」的組合。收斂（互斥/取最高）交給 reachableBuffs.ts。
//
// 純函式、無副作用，可單測（npm test）。等級假設見下方 v1 註記。

import type { Pilot, PilotSkillDoc, Module, Weapon, Backpack } from '../types'
import { parseBuffRef } from './buffRef.ts'

/** 反向索引出的單一 buff 來源條目 */
export interface BuffSource {
  /** buff 文件 ID（不含等級尾綴） */
  buffId: string
  /** 指定等級（階梯 buff，來自 id@N）；未指定 = base / 預設級 */
  level?: number
  /** 來源描述（如 '天賦:悖想先驅'、'模組:強襲核心'），供面板顯示「這 buff 來自哪件裝備」 */
  origin: string
}

/**
 * 一份配裝的「會賦予 buff」實體。
 * - skills：建議由 resolvePilotSkills(pilot.skills, skillMap) 先解析好再傳入（處理 ID 字串/嵌入兩格式）；
 *   未傳則退而求其次，只取 pilot.skills 內的嵌入物件（字串 ID 會被略過）。
 * - 神經驅動：v1 採「滿級假設」——蒐集 pilot.neuralDrive[].levels[] 各級 buffIds，
 *   同 buffId 多級的取最高交給 reachableBuffs 收斂。等級選擇待後續加 SimState 欄位後再細化。
 */
export interface BuffPoolInput {
  pilot?: Pilot | null
  /** 已解析的機師技能（優先用此；省略時 fallback 取 pilot.skills 嵌入物件） */
  skills?: PilotSkillDoc[]
  modules?: Module[]
  weapon?: Weapon | null
  backpack?: Backpack | null
}

/** 把一組原始 buffIds（含 id@N）展開為帶來源的 BuffSource，推進 out */
function pushBuffIds(out: BuffSource[], buffIds: string[] | undefined, origin: string): void {
  if (!buffIds) return
  for (const raw of buffIds) {
    if (!raw) continue
    const { buffId, level } = parseBuffRef(raw)
    out.push({ buffId, level, origin })
  }
}

/**
 * 反向索引：配裝各實體 buffIds[] 的聯集（帶來源、已拆 id@N）。
 * 不做去重 / 互斥收斂——那是 reachableBuffs.resolveReachable 的職責。
 */
export function buildBuffPool(input: BuffPoolInput): BuffSource[] {
  const out: BuffSource[] = []
  const { pilot, skills, modules, weapon, backpack } = input

  if (pilot) {
    // 天賦（嵌入，恆為物件）
    for (const t of pilot.talents ?? []) {
      pushBuffIds(out, t.buffIds, `天賦:${t.name}`)
    }
    // 技能：優先用已解析的 skills；否則取 pilot.skills 內嵌入物件（字串 ID 略過）
    if (skills) {
      for (const s of skills) pushBuffIds(out, s.buffIds, `技能:${s.name}`)
    } else {
      for (const entry of pilot.skills ?? []) {
        if (typeof entry !== 'string') pushBuffIds(out, entry.buffIds, `技能:${entry.name}`)
      }
    }
    // 神經驅動（v1 滿級假設：各級 buffIds 全收，取最高交給收斂）
    for (const nd of pilot.neuralDrive ?? []) {
      for (const lv of nd.levels ?? []) {
        pushBuffIds(out, lv.buffIds, `神經驅動:${nd.name}`)
      }
    }
  }

  for (const m of modules ?? []) {
    pushBuffIds(out, m.buffIds, `模組:${m.name}`)
  }

  if (weapon) {
    // 武器透過其技能（WeaponSkill）賦予 buff；Weapon 無頂層 buffIds
    for (const ws of weapon.skills ?? []) {
      pushBuffIds(out, ws.buffIds, `武器技能:${ws.name}`)
    }
  }

  if (backpack?.mainSkill) {
    pushBuffIds(out, backpack.mainSkill.buffIds, `背包:${backpack.name}`)
  }

  return out
}
