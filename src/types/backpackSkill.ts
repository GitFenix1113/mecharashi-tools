// ─── 背包技能 backpackSkills（PLAN-043）──────────────────────────────────────
//
// 可共用、可等級化的背包技能定義庫。與 pilotSkills（技能庫）**刻意分開**：
//
//  · 欄位形狀不同 —— 背包技能沒有 ap / cd / pp / unitType / weapon（遊戲內顯示為
//    「消耗 —／武器 —」），反過來需要 levels[]，那是 PilotSkillDoc 沒有的。
//    塞進同一份 doc 只會讓兩邊的必填語意再稀釋一次。
//  · ID 命名空間獨立 —— pilotSkills 現存 `SKILL_` 大寫 134 筆／`skill_` 小寫 512 筆，
//    後台撞號防呆只查小寫形式，以 name 去重會建出同名兩份。獨立集合直接繞開該洞。
//
// ⚠ 與 PLAN-032（武器技能併入 pilotSkills）的裁決相反，這是刻意的；理由與代價
//   明細見 docs/05_階段性開發計畫/執行中/PLAN-043_背包技能集合/計畫書.html 決策一。

import type { DescriptionRefs } from './common'
import type { SkillEffect } from './buff'

/**
 * 階梯背包技能的單一等級（PLAN-043，比照 PLAN-024 的 BuffLevel）。
 *
 * 遊戲內的「移動強化Ⅰ／Ⅱ／Ⅲ」是同一族技能的不同強度階，由掛載它的背包決定給哪一級。
 * level 是「靜態強度階」，與執行期狀態無關。
 */
export interface BackpackSkillLevel {
  /** 等級序號 1,2,3…（對應原羅馬尾碼） */
  level: number
  /**
   * 該級顯示名（'移動強化Ⅰ'）。**必須手填，刻意不做羅馬數字自動推導**——
   * PLAN-024 實測既有資料已知損壞（'失穩ⅠⅠⅠ' 是三個重複的 U+2160），推導在髒資料上必然失敗。
   * 遊戲內沒有階名的技能族，填與 skill.name 相同的原字（明示「此級顯示為原名」的編輯決策，
   * 而非留空漏填）。
   */
  name?: string
  /** 該級描述；未填時前台回退父層 description */
  description?: string
  descriptionRefs?: DescriptionRefs
  /** 該級的結構化效果數值（移動力 +1 格、傷害 +5%…）；模擬加總 */
  effects?: SkillEffect[]
  /** 該級賦予的 BUFF（元素格式同 buffIds，可含 `id@N` 指定級） */
  buffIds?: string[]
  /** 該級專屬圖示（選填；不填沿用 skill.icon） */
  icon?: string
}

/** backpackSkills Collection 文件 */
export interface BackpackSkillDoc {
  /** id 格式：`bpskill_<技能名>`；同名不同效時加背包 id 後綴 */
  id: string
  name: string
  /**
   * 技能類型（enums.ts 的 SkillType 字串）。實務上背包技能幾乎全為 '被動技能'，
   * 但保留欄位——遊戲內背包技能欄位本身標有「類型：被動技能」，不該由前端硬編。
   */
  skillType: string
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1） */
  descriptionRefs?: DescriptionRefs
  /** 圖示路徑。慣例存 `/images/skills/背包技能/<檔名>`（PLAN-043 獨立圖庫資料夾） */
  icon?: string
  /** 結構化效果數值（管理員手填） */
  effects: SkillEffect[]
  /** 賦予的 BUFF（元素格式 `id` 或 `id@N`） */
  buffIds: string[]
  /**
   * 階梯技能各等級（PLAN-043）。無 = 普通技能，沿用上方頂層欄位、行為不變。
   * 有 levels：各級 description / effects / buffIds 由此提供；掛載側以 `id@N` 指定級。
   */
  levels?: BackpackSkillLevel[]
  /**
   * 官方 API 的數字技能 ID（如 '62304'），由 PLAN-043 遷移自 `Backpack.mainSkill.id`。
   *
   * 純備查、**無任何程式邏輯讀取**。保留的理由是它是回連官方資料的唯一線索，
   * 而 Phase E 的 flip 會把 mainSkill 整個刪掉——屆時就再也找不回來。
   * 新建的技能不必填（人工維護的技能本來就沒有官方 id）。
   */
  officialId?: string
}
