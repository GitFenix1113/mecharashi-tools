// ─── 實體引用層（PLAN-019 Layer 1）──────────────────────────────────────────

/** 可被引用的實體類型。'stat' 指向屬性 key（如 'dmg'）；'term' 指向 glossaryTerms 詞條 */
export type RefType =
  | 'buff' | 'skill' | 'pilot' | 'mech' | 'weapon'
  | 'module' | 'backpack' | 'component' | 'stat' | 'term'

/**
 * 對另一個實體的型別化、可解析引用。
 * 用於 description 內 [xxx] 詞條，以及 BOSS 機制文字等跨實體連結。
 */
export interface EntityRef {
  refType: RefType
  /** 目標 ID：buffs/{id}、pilots/{id}、glossaryTerms/{id}，或 stat key 如 'dmg' */
  refId: string
  /** 顯示文字；預設取目標 name，可覆寫（原文用別名時） */
  label?: string
}

/**
 * description 內 [xxx] 標記 → 對應實體的側錄表。
 * key = 括號內文字（如 "虛粒子形態"）；顯示層據此把 [xxx] 渲染為可點擊引用。
 * 未命中的 [xxx] 原樣顯示，向後相容、優雅降級。
 */
export type DescriptionRefs = Record<string, EntityRef>

/**
 * 詞條庫文件（PLAN-019-C）。
 * 收「無專屬集合可放」的機制關鍵字（如 固定傷害 / 啟動 / 形態增益），
 * 作為 refType:'term' 引用的資料源。被任意 description 內的 [xxx] 引用。
 */
export interface GlossaryTerm {
  /** 文件 ID。格式 term_<名稱>（與 skill_/buff_ 一致） */
  id: string
  /** 詞條名稱（= [xxx] 內文字） */
  name: string
  /** 機制分類（傷害 / 狀態 / 資源 / 通用…）；自由字串 */
  category?: string
  /** 詞條解釋文字（可含 [xxx] 標記） */
  description: string
  /** 解釋內 [xxx] → 實體引用側錄（解釋本身也能再引用） */
  descriptionRefs?: DescriptionRefs
  /** 同義詞：別名 [xxx] 對應同一詞條 */
  aliases?: string[]
  /** 選填圖示（遠端 URL 或本地 /images/…） */
  icon?: string
}
