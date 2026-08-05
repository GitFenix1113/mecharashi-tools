// 配裝 → 可用 buff 池：反向索引（PLAN-019-B Layer 2）
//
// 模擬器把「會賦予 buff」的配裝實體之 buffIds[] 收集起來，逐個 parseBuffRef 拆 id@N，
// 輸出帶來源標註的 BuffSource[]。這是「可達 buff」的第一步——只有來源在配裝中的 buff 才會出現，
// 杜絕未來傷害模擬器發散出「不可能存在」的組合。收斂（互斥/取最高）交給 reachableBuffs.ts。
//
// 純函式、無副作用，可單測（npm test）。等級假設見下方 v1 註記。

import type { Pilot, PilotSkillDoc, Module, Weapon, Backpack, BackpackSkillDoc } from '../types'
import { parseBuffRef } from './buffRef.ts'
import { SPECS, SKIP_WHEN_SKILLS_RESOLVED, type CollectionSpec } from './entityRefs.ts'
import { resolveBackpackSkills, buildBackpackSkillMap } from './backpackSkills.ts'

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
  /**
   * 背包技能庫（PLAN-043）。**背包的 buff 全部經由此處解析** ——
   * Phase E 移除內嵌 mainSkill 後，沒傳這個就等於背包完全不賦予 buff。
   * 這是刻意的失敗模式：症狀是「背包的增益全沒了」，比靜默拿到部分結果容易發現。
   * SIMULATOR_KEYS 已含 backpackSkills，正式路徑不會漏。
   *
   * 傳整包字典而非已解析結果，是因為等級解析必須在這裡做：
   * 背包掛的是 `id@N`，**只有該級的 buffIds 算數**。若改用 runSpec 跑整份技能 doc，
   * 會把所有等級的 buffIds 全部倒進池子——掛 Lv1 的背包會拿到 Lv3 的 buff，
   * 而且不會報錯，只是模擬結果偏高。
   */
  backpackSkills?: BackpackSkillDoc[]
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
/**
 * 跑一份 spec 的所有 buffIdSites，把 buffIds 推進 out。
 * 站點宣告順序即輸出順序——buffPool.test.ts 用 deepEqual 斷言整個陣列，順序是行為的一部分。
 *
 * 導出僅為測試：excludeFromPool 的保護必須直接對這支斷言。繞 buildBuffPool 寫的測試
 * 會因為「那條路徑本來就沒被走到」而恆綠、零資訊量（PLAN-034 決策七）。
 */
export function runSpec<T>(out: BuffSource[], spec: CollectionSpec<T>, doc: T): void {
  for (const site of spec.buffIdSites) {
    // 迴圈第一行就擋掉：站點自己宣告「我不是賦予」，不依賴任何呼叫端記得傳參數。
    // 原本這裡是 `if (site.id === skipSiteId) continue`，而 skipSiteId 實測從未被傳過——
    // 等於零保護。改成讀站點宣告後，將來有人補上對 neuralDriveAbilities 的 runSpec
    // （該檔 TODO 已預告），buffUpgrades 也不會被當成「賦予」掃進池子。
    if (site.excludeFromPool) continue
    for (const occ of site.enumerate(doc)) pushBuffIds(out, occ.buffIds, occ.origin)
  }
}

export function buildBuffPool(input: BuffPoolInput): BuffSource[] {
  const out: BuffSource[] = []
  const { pilot, skills, modules, weapon, backpack, backpackSkills } = input

  // ── 以下三處順序/條件都是既有行為，改寫時逐條複製，勿「順手整理」──
  //
  // ① 技能的位置在「天賦與神驅之間」，不是最後。把 skills 迴圈提到 pilot 區塊外
  //    會產出 天賦→神驅→技能，與既有 deepEqual 斷言不符。
  // ② skills 與嵌入技能站點互斥：resolvePilotSkills 會把嵌入物件也轉成 doc，
  //    兩邊都跑的話有嵌入技能的機師會雙計。
  // ③ skills 只在 pilot 存在時才處理——buildBuffPool({ skills }) 不帶 pilot
  //    在改寫前不會產出任何技能 buff，此語意一併保留。
  if (pilot) {
    for (const site of SPECS.pilots.buffIdSites) {
      if (site.id === SKIP_WHEN_SKILLS_RESOLVED) {
        if (skills) for (const s of skills) runSpec(out, SPECS.pilotSkills, s)
        else for (const occ of site.enumerate(pilot)) pushBuffIds(out, occ.buffIds, occ.origin)
        continue
      }
      for (const occ of site.enumerate(pilot)) pushBuffIds(out, occ.buffIds, occ.origin)
    }
  }

  for (const m of modules ?? []) runSpec(out, SPECS.modules, m)
  if (weapon) runSpec(out, SPECS.weapons, weapon)
  // PLAN-043 Phase E 後 SPECS.backpacks.buffIdSites 已是空陣列（背包不再直接賦予 buff）。
  // 呼叫仍保留：日後若真的給背包加了頂層 buffIds 站點，這裡會自動跟上；
  // 刪掉的話那個新站點會靜默不進池子，而症狀是「數值算不對」，極難追。
  if (backpack) runSpec(out, SPECS.backpacks, backpack)

  // PLAN-043：掛載技能。刻意**不**走 runSpec(SPECS.backpackSkills, doc) ——
  // 那會把 backpackSkills.buffIds 與 levels[].buffIds 兩個站點全部倒進池子，
  // 而背包實際只掛某一級。改用 resolveBackpackSkills 做等級解析後再推。
  // （findReferences 仍必須掃全部站點：刪 buff 時每一級的引用都得清掉，方向不同。）
  if (backpack && backpackSkills?.length) {
    const map = buildBackpackSkillMap(backpackSkills)
    for (const sk of resolveBackpackSkills(backpack, map)) {
      pushBuffIds(out, sk.buffIds, sk.origin)
    }
  }

  return out
}
