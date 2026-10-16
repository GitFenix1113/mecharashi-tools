// PLAN-042-B C-1：故事館的「主角」轉接層——機師廳與機甲廳共用的元件只吃 LoreSubject，不認得 Pilot／Mech。
//
// 為什麼要這一層：042-A～E 的舞台、外觀列、切換列、名冊都直接吃 `Pilot`（序號從 `pilot_###` 切、
// 色調查職業、頭像走機師官方圖…），機甲廳要用同一套元件就得先把「怎麼呈現」抽出來。
// 形狀通用的元件（LoreStage／LoreSkinPicker／LoreSwitcher）改吃這裡；內容不同的另做（MechDossier，決策 B-12），
// 立繪構圖（loreStageArt）也各館各自算，不塞進 subject。
//
// ⚠ 機師廳的 DOM 要與泛化前一字不差（C-4 回歸基準：_local-notes/2026-10/2026-10-16_故事館泛化回歸/）。
//   pilotSubject() 產出的每個字串都照搬原本元件裡的算法，改這裡等於改機師廳的畫面。
//
// ⚠ 頭像候選是**函式**不是陣列：imageCandidates() 會讀 import.meta.env.BASE_URL，node --test 下不存在。
//   延遲到元件呼叫時才算，本檔才能單元測試。

import { pilotClassMeta } from '../../data/pilotClasses.ts'
import { mechPortraitCandidates } from '../../utils/assets.ts'
import { pilotHeadCandidates } from './loreStageArt.ts'
import type { Mech, MechLoreDoc, MechMaker, Pilot } from '../../types'

export type LoreKind = 'pilot' | 'mech'

export interface LoreSubject {
  kind: LoreKind
  /** 實體的文件 ID（pilots／mechs） */
  id: string
  name: string
  /** 直書姓名下方的小字（機師全名；與 name 相同就不給） */
  fullName?: string
  /** 英文名（pilotLore／mechLore.nameEn）。機師＝舞台上的毛筆簽名；兩館都進名冊搜尋 */
  nameEn?: string
  /** 舞台角落的大序號與檔案標籤，從文件 ID 的流水號切出（`pilot_003` → `003`） */
  serial: string
  /** 檔案標籤的前綴：`PILOT FILE`／`MECH FILE` */
  fileLabel: string
  debutVersion?: string
  /** 型號鋼印（機甲，決策 B-5）：取代機師的英文簽名。機師為 undefined */
  stamp?: string
  /** 圓形頭像的候選（切換列、名冊、外觀列的「預設」）。函式：見檔頭 */
  heads: () => string[]
  /** 切換列滑鼠提示的第二行，例「突擊手 · v1.0」 */
  meta: string
  /** 名冊卡片的 title，例「洛莎·迪亞茲 · Rosa Diaz · 突擊手 · v1.0」 */
  rosterTitle: string
  /** 名冊卡片的色調（CSS 值） */
  tone: string
  /** 名冊搜尋比對的欄位（不分大小寫、子字串） */
  searchFields: readonly (string | undefined)[]
  /** 回圖鑑的連結 */
  codexHref: string
}

const NEUTRAL_TONE = 'var(--lore-ink-2)'
const serialOf = (id: string, prefix: string) => id.match(new RegExp(`^${prefix}_(\\d+)`))?.[1] ?? ''
const vTag = (v?: string) => (v ? `v${v}` : undefined)

/** 機師 → 故事館主角。`nameEn` 來自 pilotLore（`withLoreNames` 併進來的那個欄位）。 */
export function pilotSubject(p: Pilot & { nameEn?: string }): LoreSubject {
  return {
    kind: 'pilot',
    id: p.id,
    name: p.name,
    fullName: p.fullName && p.fullName !== p.name ? p.fullName : undefined,
    nameEn: p.nameEn,
    serial: serialOf(p.id, 'pilot'),
    fileLabel: 'PILOT FILE',
    debutVersion: p.debutVersion || undefined,
    heads: () => pilotHeadCandidates(p),
    meta: `${p.class}${p.debutVersion ? ` · v${p.debutVersion}` : ''}`,
    rosterTitle: [p.fullName || p.name, p.nameEn, p.class, vTag(p.debutVersion)].filter(Boolean).join(' · '),
    tone: pilotClassMeta(p.class)?.paper ?? NEUTRAL_TONE,
    searchFields: [p.name, p.fullName, p.nameEn, p.faction, p.class, p.debutVersion, vTag(p.debutVersion)],
    codexHref: `/pilots/${encodeURIComponent(p.id)}`,
  }
}

/** 廠商未填或對不到文件時的顯示（決策 B-8：不留白） */
export const MAKER_UNKNOWN = '廠商未載'

/** 機甲 → 故事館主角。廠商傳進來是因為 mechLore 只存廠商 ID（mechMakers 的文件 ID）。 */
export function mechSubject(m: Mech, lore?: MechLoreDoc | null, maker?: MechMaker | null): LoreSubject {
  const makerName = maker?.name?.trim() || MAKER_UNKNOWN
  const nameEn = lore?.nameEn?.trim() || undefined
  const modelNo = lore?.modelNo?.trim() || undefined
  return {
    kind: 'mech',
    id: m.id,
    name: m.name,
    nameEn,
    serial: serialOf(m.id, 'mech'),
    fileLabel: 'MECH FILE',
    debutVersion: m.debutVersion || undefined,
    stamp: modelNo,
    heads: () => mechPortraitCandidates(m),
    meta: [makerName, m.armorType, vTag(m.debutVersion)].filter(Boolean).join(' · '),
    rosterTitle: [m.name, modelNo, nameEn, makerName, m.armorType, vTag(m.debutVersion)].filter(Boolean).join(' · '),
    tone: NEUTRAL_TONE,
    searchFields: [m.name, nameEn, modelNo, maker?.name, maker?.nameEn, m.armorType, m.debutVersion, vTag(m.debutVersion)],
    codexHref: `/mechs/${encodeURIComponent(m.id)}`,
  }
}

/** 名冊搜尋：空字串一律通過（同 loreRoster 的 matchesLoreQuery，只是欄位由 subject 自己決定）。 */
export function matchesSubjectQuery(s: Pick<LoreSubject, 'searchFields'>, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return s.searchFields.some((f) => typeof f === 'string' && f.toLowerCase().includes(q))
}
