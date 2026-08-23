import type { MechLicense } from './enums'
// ─── 機師 ──────────────────────────────────────────────────────────────────

import type { DescriptionRefs } from './common'
import type { WeaponRequirement, SkillEffect } from './buff'

export interface PilotStats {
  melee: number
  assault: number
  shooting: number
  tactics: number
  defense: number
  engineering: number
}

export interface PilotSkill {
  name: string
  /** SkillType enum：被動技能 / 主動技能 / 指令技能 / 必殺技能 / 武器技能 */
  type: string
  /** biometicComputer 單元類型："0"=核心單元 "6"=職業單元 */
  unitType?: string
  ap?: string
  /** 冷卻回合數；指令技能（type=指令技能）才有 */
  cd?: string
  /** PP 消耗量；PP技能（type=PP技能）才有，如「勇氣」消耗 1PP */
  pp?: string
  /** 限定武器需求；武器技能、額外打擊（type=額外打擊）等須指定武器的技能才有 */
  weapon?: WeaponRequirement | string
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1） */
  descriptionRefs?: DescriptionRefs
  icon: string
  iconLocal: string
  effects:  SkillEffect[]
  buffIds:  string[]
  /**
   * 管理者手動新增的技能（PLAN：機師天生自帶、官網查無的技能）。
   * true = 後台手動建立，name/description 等欄位可在後台編輯；爬蟲補丁模式不會覆寫或刪除。
   * 未設定 / false = 由爬蟲腳本管理，後台僅能編輯 effects / buffIds。
   */
  manual?: boolean
}

/** 條件變體子技能（萬序擬合等：依形態/武器決定發動哪個）；PLAN-019 模擬層預留，暫不填 */
export interface SkillVariant {
  /** 觸發條件描述（如 "先鋒形態"）；未來可結構化 */
  condition: string
  /** 此變體引用的技能 refId（skill_xxx） */
  skillRefIds?: string[]
  description?: string
  effects?: SkillEffect[]
}

/**
 * pilotSkills 集合的技能文件（PLAN-004 技能庫抽離）。
 * 欄位與嵌入用 PilotSkill 相同，另有頂層 id；可被描述中的 [xxx] 引用（refType:'skill'）。
 * id 格式：skill_<技能名>，同名不同效時加 _<pilotId> 後綴。
 *
 * ⚠ 集合物理名 `pilotSkills` 是**歷史遺留的誤稱**（PLAN-032）。它的真實契約是
 * 「**全站技能字典**——收錄所有可被引用的技能定義，成員不限於機師持有」：
 * 實測全庫 89 個 refType:'skill' 引用目標中，75 個（84%）沒有任何機師持有。
 * 改集合實體名要做 rename migration 且同步所有 refId，純美觀不值得，故只在文件上正名為「技能庫」。
 */
export interface PilotSkillDoc {
  id: string
  name: string
  /** SkillType enum：被動技能 / 主動技能 / 指令技能 / 必殺技能 / 武器技能 */
  type: string
  /** biometicComputer 單元類型："0"=核心單元 "6"=職業單元 */
  unitType?: string
  ap?: string
  /** 冷卻回合數；指令技能才有 */
  cd?: string
  /** PP 消耗量；PP技能才有 */
  pp?: string
  /** 限定武器需求；武器技能才有 */
  weapon?: WeaponRequirement | string
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1） */
  descriptionRefs?: DescriptionRefs
  icon: string
  iconLocal: string
  effects: SkillEffect[]
  buffIds: string[]
  /** 管理者手動新增的技能；爬蟲補丁模式不會覆寫或刪除。詳見 PilotSkill.manual */
  manual?: boolean
  /**
   * 技能所屬領域（PLAN-032）。**未填 = 'pilot'**——既有 646 筆天然合法，零改動。
   * 純分類欄位：只影響後台技能庫頁的篩選，不影響解析、引用或任何前台行為。
   *
   * 刻意不用 `type` 表達：實測 170/170 武器技能的 type 全是「被動技能」，零鑑別力；
   * 而 type 是官方 SkillType enum，硬塞一個「武器技能」值會污染既有語意。
   */
  domain?: 'pilot' | 'weapon'
  /**
   * 此技能會強化的天賦名（PLAN-032，原 WeaponSkill.enhancesTalentName）。專武技能才有。
   * 前台以「此名稱是否在當前機師的天賦清單內」判定要不要顯示強化標記。
   */
  enhancesTalentName?: string
  /**
   * 天賦被此技能強化後的完整描述（遊戲原文），供與天賦原文做 DiffHighlight 差異對比。
   *
   * ⚠ 這兩欄**刻意放定義側而非 WeaponSkillRef 掛載側**（PLAN-032 補充決策）：
   * enhancedTalentDescription 與上方 descriptionRefs 是**一起被消費的**
   * （PilotDetailPage 用同一份 refs 解析這段文字的 [xxx] token）。拆到兩個文件會失同步，
   * 症狀是「強化後天賦文字裡的引用突然不會亮」。且專武與機師 1:1，此欄天然無跨武器變異——
   * 與 activation 的情況正好相反。
   */
  enhancedTalentDescription?: string
  /**
   * 模擬層預留：條件變體（萬序擬合）；暫不填。
   *
   * ⚠ 與同期被刪掉的 SkillArea 看似同類，**保留是刻意的**：PLAN-041 Phase G 就要開始填它
   * （形態 × 武器種類 → 子技能的 42 筆矩陣），且屆時 formId 分支的箭頭方向 skill → form
   * 正是為本次形態模型而定。SkillArea 則是 0/710、無 UI、無消費端、也無人要填。
   */
  variants?: SkillVariant[]
}

/**
 * 神經驅動算力改寫變體（PLAN-021）。
 * 當神經驅動算力跨過 minSum 門檻，遊戲把天賦正文就地改寫（引用更高階 buff、層數/數值變動）。
 * 以 minSum 鬆耦合到 NeuralDriveLevel.minSum；本變體 descriptionRefs 與天賦 descriptionRefs 合併解析。
 * 多階互斥、計算器取最高（對應的 buff 以 GameBuff.levels 表達）。
 */
export interface TalentNdVariant {
  /** 算力門檻（對應 NeuralDriveLevel.minSum） */
  minSum: number
  /**
   * 門檻所屬的神經驅動分區名（對應 NeuralDrive.name，如 'γ2'）。
   * 同機師多區可能有相同 minSum（艾達 γ1/γ2 各有 10/13），缺 zone 會歧義。
   */
  zone?: string
  /** 顯示用標籤；省略時前端以 zone+minSum 生成「γ2 算力 ≥ N」 */
  label?: string
  /** 改寫後天賦正文（token 用該階 buff 名，如 [凝勢III]） */
  description: string
  /**
   * 滿星版改寫正文（= talent.descriptionMax 被此算力階改寫後的樣子，含滿星專屬子句）。
   * 省略時前台退回顯示 description 並提示待補。
   */
  descriptionMax?: string
  /** 此正文的 [xxx]→buff 對照；與天賦 descriptionRefs 合併後解析 */
  descriptionRefs?: DescriptionRefs
}

export interface PilotTalent {
  name: string
  type: string
  description: string
  descriptionMax: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1）；適用 description 與 descriptionMax */
  descriptionRefs?: DescriptionRefs
  icon: string
  iconLocal: string
  effects:          SkillEffect[]
  enhancedEffects?: SkillEffect[]
  buffIds:          string[]
  /** 神經驅動算力改寫變體（PLAN-021）；建議依 minSum 升序排列 */
  ndVariants?:      TalentNdVariant[]
  /**
   * 手動修正過的天賦正文（PLAN-021）。官方 API 的天賦正文可能是「滿晶片狀態」文本
   * （艾達案例：7層/5AP/星爆 皆為 γ2≥16 才有的值），人工去污染後設 true，
   * 爬蟲補丁模式不再覆寫 description / descriptionMax。語意比照 PilotSkill.manual。
   */
  manual?:          boolean
}

/**
 * 神經驅動能力（PLAN-023）。從各機師 Pilot.neuralDrive[].levels[] 抽出去重的共用／專屬能力，
 * 以能力名為鍵（id: nd_<能力名 slug>）。分區 level 以 abilityId 引用本實體（單一資料源，
 * 共用能力改一次全機師生效）。zone / minSum / slots（門檻、所屬分區、插槽）仍留在
 * Pilot.neuralDrive，屬「機師如何取得此能力」的資訊，與能力本身解耦。
 * 結構比照 pilotSkills（PLAN-004）：collection + ID 引用 + resolve 雙格式。
 */
export interface NeuralDriveAbility {
  /** 文件 ID：nd_<能力名 slug> */
  id: string
  /** 能力名（= NeuralDriveLevel.skillName） */
  name: string
  /** 能力效果描述（= NeuralDriveLevel.effect） */
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1；本計畫 N2-1 接線 RefText） */
  descriptionRefs?: DescriptionRefs
  /** 圖示（= NeuralDriveLevel.skillIcon / iconLocal） */
  icon?: string
  iconLocal?: string
  /** 可計算效果（模擬器用；多數待後台 NeuralDriveAdmin 補填） */
  effects: SkillEffect[]
  /** 賦予的 buff（id 或 id@N，比照技能／天賦）。會進 buffPool。 */
  buffIds: string[]
  /**
   * 升階規則（PLAN-034）。語意是「**升階**」不是「**賦予**」：
   * 本能力生效時，該 buff 家族在「本機師頁」的生效階**至少**為 N。元素格式同 buffIds 的 `id@N`。
   *   nd_雙生星芒2（艾達 γ2 Lv4, minSum=10） → ['buff_凝勢@2']
   *   nd_金絲雀1  （梅利莎 γ2 Lv1, minSum=1）→ ['buff_常效維護@2']
   *
   * **刻意不存 zone / minSum**：門檻就是「本能力被掛在哪一個 NeuralDriveLevel」的 minSum，
   * 那個數字本來就在 Pilot.neuralDrive 裡了。同一條規則只存一份，漂移面積是 1 而不是 N。
   *
   * ⚠ 三條硬規則（決策五）：
   *   · 等級變更一律走這裡，ndVariants 只准表達非等級性變更（如艾達 γ2≥16 的 [星爆] 與 3AP→5AP）
   *   · 只能選**既有**等級，不得為了讓本欄位能用而在共享 buffs 集合裡憑空造級
   *   · 通用能力（nd_AP優化3 這類跨機師共享者）不得填——一填就改寫所有掛載機師的頁面
   *
   * **不進 buffPool**：模擬層維持滿級假設，由 Site.excludeFromPool 在 runSpec 內強制（決策七）。
   */
  buffUpgrades?: string[]
}

export interface NeuralDriveLevel {
  level: number
  minSum: number
  /**
   * PLAN-023 雙格式過渡：填了則本級能力內容改由 neuralDriveAbilities 集合的此 ID 提供
   * （單一資料源），以 resolveNeuralDriveAbilities() 解析；未填＝沿用下方嵌入欄位（舊格式）。
   * 嵌入欄位待 resolve 層（N1-4）與 PilotDetail 改寫（N1-5）就緒後才轉選填，供 flip（N1-6）寫最小 level。
   */
  abilityId?: string
  effect: string
  skillName: string
  skillIcon: string
  iconLocal: string
  effects: SkillEffect[]
  buffIds: string[]
  /** 描述內 [xxx] 引用側錄（PLAN-023 N2-1）；flip 後由 resolve 從 NeuralDriveAbility 帶入。 */
  descriptionRefs?: DescriptionRefs
}

export interface NeuralDrive {
  name: string
  icon: string
  slots: string[]
  levels: NeuralDriveLevel[]
}

export interface Pilot {
  id: string
  name: string
  fullName: string
  rarity: string
  class: string
  faction: string
  /** 機甲駕駛執照。PLAN-052-A D-1 由 `string` 收成 enum（實測值域乾淨：中型 37／重型 26／輕型 26）。
   *  ⚠ 值域與 `ArmorType` **不同**：執照是「中型」、機甲裝甲是「中甲」，兩者不可直接比較。 */
  license: MechLicense
  masterLevel: string
  /** 登場版本：機師首次實裝的遊戲版本號（對應 patchVersions，如 '3.3'）；未設定＝尚未回填 */
  debutVersion?: string
  profile: {
    gender: string
    bloodType: string
    height: string
    additionalInfo: Record<string, string>
  }
  stats: PilotStats
  statsBase: Record<string, number>
  ap: { init: number; max: number; recovery: number }
  apBase: { init: number; max: number; recovery: number }
  talents: PilotTalent[]
  /**
   * PLAN-004 過渡型別：技能可能是嵌入物件（舊格式）或 pilotSkills 集合的 ID 字串（新格式／單一資料源）。
   * 以 resolvePilotSkills() 解析；遷移與爬蟲改寫完成後可收斂為 string[]。
   */
  skills: (string | PilotSkill)[]
  neuralDrive: NeuralDrive[]
  portrait: string
  portraitUrl?: string
  lore?: string
  attack?: number
  defense?: number
  /**
   * 管理者手動新增的機師（PLAN-025：官方資料更新前由後台自建）。
   * true = 後台手動建立，爬蟲補丁模式（scrape-pilots-v3.js）整筆跳過、不覆寫或刪除；
   * 純作後端防覆寫用途，前台不因此顯示任何標記。語意比照 PilotSkill.manual / PilotTalent.manual。
   */
  manual?: boolean
}
