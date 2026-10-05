// 官方圖示的讀取端 helper —— PLAN-055
//
// ── 一句話 ──────────────────────────────────────────────────────────────────
// 技能、模組詞條、研發、BUFF 圖示全部住在扁平圖庫 `/images/game/icons/{skill,buff}/<官方檔名>.webp`，
// 一張圖只存一份。讀取端一律寫：
//
//     <FallbackImage candidates={gameIconCandidates(skill.icon, skill.iconLocal)} … />
//
// ── 檔名即 key ───────────────────────────────────────────────────────────────
// DB 裡的圖示值有四種寫法（裸 key、扁平路徑、子資料夾路徑、完整路徑），內嵌 WeaponSkill 還有官方 CDN 的遠端 URL。
// 這裡不管哪一種都取**檔名**當 key → 新圖庫路徑排第一候選，原值（舊路徑）排第二。
// 所以舊資料不必先改也有圖；DB 遷移（PLAN-055 C）只是整理，不是「有沒有圖」的前提。
// 中文佔位名（Icon_skill_main_凱登01）不是圖庫 key，只走舊路徑；遠端 URL 不當後備（不為了一張圖示打第三方網域）。
//
// ⚠ 命名規則與 scripts/lib/gameIconKinds.mjs 是同一套（build 腳本要能在 Node 20 跑，不能 import .ts），
//   兩邊由 scripts/lib/gameIconKinds.test.mjs 交叉比對。改一邊就要改另一邊。
// ⚠ 圖示不等於技能：同一張圖常被多個技能共用，key 只代表外觀，不能當主鍵（PLAN-032）。
// ⚠ 本檔不碰 import.meta.env（可以 node --test）；套 BASE_URL 的是 gameIconCandidates 內呼叫的 imageCandidates。

import { imageCandidates } from './assets.ts'
import { GAME_ICON_ALIASES } from '../data/gameIconAliases.ts'

const ICON_ROOT = '/images/game/icons'

export type IconFamily = 'skill' | 'buff'
export type SkillIconKind = 'main' | 'order' | 'passive' | 'talent' | 'pp' | 'entry' | 'rnd' | 'command' | 'refactoring' | 'other'
export type BuffIconKind = 'generic' | 'debuff' | 'stat' | 'status' | 'repair' | 'unique' | 'stack' | 'misc'
export type IconKind = SkillIconKind | BuffIconKind

export interface ParsedIconKey {
  key: string
  family: IconFamily
  kind: IconKind
  /** 只有 main／order／passive／talent：首位數 1–5、9（聯動） */
  color?: number
  /** 編號（排序用；流水號倒序＝最新在前） */
  num?: number
}

/** 屬於圖庫的官方前綴（武器 Icon_weapon_*、背包 Icon_backpack_* 不在此列：它們本來就一夾一份） */
const LIBRARY_RE = /^Icon_(?:skill_|entry_|RnD_|commandskill_|zoneskill_|roguelike_|coopclimb_|buff_|debuff_)[A-Za-z0-9_]+$/

/** 是不是圖庫裡的官方檔名（ASCII；中文佔位名一律 false） */
export function isLibraryKey(key: string | null | undefined): key is string {
  return typeof key === 'string' && LIBRARY_RE.test(key)
}

/** 圖庫子資料夾：BUFF 字形一夾，其餘一夾——照官方的分法 */
export function iconFamily(key: string): IconFamily {
  return /^Icon_(?:de)?buff_/.test(key) ? 'buff' : 'skill'
}

/**
 * 舊編號 → 現行編號（src/data/gameIconAliases.ts，匯入腳本產生）。
 * 官方重新編號前的舊圖跟現行圖幾乎逐像素相同，圖庫只存現行那一份；DB 與爬蟲快照裡的舊編號靠這裡解析。
 */
export function canonicalIconKey(key: string): string {
  return Object.hasOwn(GAME_ICON_ALIASES, key) ? GAME_ICON_ALIASES[key] : key
}

/** 圖庫路徑（含開頭斜線、不含 BASE_URL；舊編號會先換成現行編號）；不是圖庫 key 回 undefined */
export function gameIconPath(key: string | null | undefined): string | undefined {
  if (!isLibraryKey(key)) return undefined
  const k = canonicalIconKey(key)
  return `${ICON_ROOT}/${iconFamily(k)}/${k}.webp`
}

/**
 * 任何舊寫法（裸 key、扁平路徑、子資料夾路徑、完整路徑、遠端 URL、帶副檔名）→ 檔名（不含副檔名）。
 * 不驗證是不是圖庫 key——中文佔位名也會原樣回傳，呼叫端自己用 isLibraryKey 判斷。
 */
export function keyFromValue(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  if (!s) return undefined
  const base = s.split(/[?#]/)[0].split('/').pop() ?? ''
  const key = base.replace(/\.(png|webp|jpe?g)$/i, '')
  return key || undefined
}

const BUFF_SERIES: Record<string, BuffIconKind> = { 1: 'stat', 2: 'status', 3: 'repair', 4: 'unique', 5: 'stack', 9: 'misc' }

/** 解析官方檔名；不是圖庫 key 回 null。規則與 scripts/lib/gameIconKinds.mjs 的 parseIconKey 相同。 */
export function parseIconKey(key: string | null | undefined): ParsedIconKey | null {
  if (!isLibraryKey(key)) return null
  const family = iconFamily(key)
  let m: RegExpMatchArray | null
  if (family === 'buff') {
    if (key.startsWith('Icon_debuff_')) return { key, family, kind: 'debuff' }
    if ((m = key.match(/^Icon_buff_(\d)(\d{3})$/))) return { key, family, kind: BUFF_SERIES[m[1]] ?? 'misc', num: Number(m[1] + m[2]) }
    if (/^Icon_buff_1_\d{3}$/.test(key)) return { key, family, kind: 'stat' }
    return { key, family, kind: 'generic' }
  }
  if ((m = key.match(/^Icon_skill_(main|order|passive|talent)_(\d{4})$/))) {
    return { key, family, kind: m[1] as SkillIconKind, color: Number(m[2][0]), num: Number(m[2]) }
  }
  if ((m = key.match(/^Icon_skill_pp_(\d+)$/))) return { key, family, kind: 'pp', num: Number(m[1]) }
  if ((m = key.match(/^Icon_entry_(\d+)$/))) return { key, family, kind: 'entry', num: Number(m[1]) }
  if ((m = key.match(/^Icon_(?:skill_)?RnD_[A-Z]_(\d+)$/))) return { key, family, kind: 'rnd', num: Number(m[1]) }
  if ((m = key.match(/^Icon_(?:command|zone)skill_(\d+)$/))) return { key, family, kind: 'command', num: Number(m[1]) }
  if ((m = key.match(/^Icon_skill_refactoring_(\d+)$/))) return { key, family, kind: 'refactoring', num: Number(m[1]) }
  return { key, family, kind: 'other' }
}

/** 以圖搜圖特徵的邊長（12×12 RGB＝432 bytes／張；與 scripts/lib/gameIconKinds.mjs 相同） */
export const ICON_FEATURE_DIM = 12

/**
 * 以圖搜圖的特徵（PLAN-055 B-4）：RGBA 像素 → 裁到不透明區域外框 → 切 dim×dim 區塊、墊黑平均。
 * 與 scripts/lib/gameIconKinds.mjs 的 iconFeature 逐位元相同（gameIconKinds.test.mjs 交叉比對）：
 * build 時替圖庫每張圖算一份（features.bin），選圖器把貼上的截圖算成同樣格式來比。
 */
export function iconFeature(data: ArrayLike<number>, w: number, h: number, dim = ICON_FEATURE_DIM): Uint8Array {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1 }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1
  const sum = new Float64Array(dim * dim * 3), cnt = new Float64Array(dim * dim)
  for (let y = y0; y <= y1; y++) {
    const by = Math.min(dim - 1, Math.floor(((y - y0) * dim) / bh))
    for (let x = x0; x <= x1; x++) {
      const bx = Math.min(dim - 1, Math.floor(((x - x0) * dim) / bw))
      const i = (y * w + x) * 4, a = data[i + 3] / 255, c = by * dim + bx
      sum[c * 3] += data[i] * a; sum[c * 3 + 1] += data[i + 1] * a; sum[c * 3 + 2] += data[i + 2] * a; cnt[c]++
    }
  }
  const out = new Uint8Array(dim * dim * 3)
  for (let c = 0; c < dim * dim; c++) for (let k = 0; k < 3; k++) out[c * 3 + k] = cnt[c] ? Math.round(sum[c * 3 + k] / cnt[c]) : 0
  return out
}

/** 兩份特徵的平均差（0–255）——越小越像 */
export function featureDistance(a: ArrayLike<number>, b: ArrayLike<number>, offsetB = 0): number {
  let d = 0
  for (let j = 0; j < a.length; j++) d += Math.abs(a[j] - b[offsetB + j])
  return d / a.length
}

/** 本機路徑（不是裸 key、不是遠端 URL）才當舊路徑後備 */
const isLocalPath = (v: string) => v.includes('/') && !/^https?:\/\//i.test(v)

/**
 * 候選路徑（未套 BASE_URL，給測試與 gameIconCandidates 用）。
 * 先放每個值對應的圖庫路徑，再放每個值原本的本機路徑：
 *   ('Icon_skill_passive_5010', '/images/skills/Icon_skill_passive_5010.png')
 *   → ['/images/game/icons/skill/Icon_skill_passive_5010.webp', '/images/skills/Icon_skill_passive_5010.png']
 */
export function gameIconSources(...values: (string | null | undefined)[]): string[] {
  const out: string[] = []
  const push = (u: string | undefined) => { if (u && !out.includes(u)) out.push(u) }
  for (const v of values) push(gameIconPath(keyFromValue(v ?? undefined)))
  for (const v of values) { const s = v?.trim(); if (s && isLocalPath(s)) push(s) }
  return out
}

/** 交給 <FallbackImage> 的候選清單（已套 BASE_URL；舊路徑會經過 normalizeSkillPath 並展開 .webp 變體）。 */
export function gameIconCandidates(...values: (string | null | undefined)[]): string[] {
  return imageCandidates(...gameIconSources(...values))
}

// ── 介面標籤（只給後台選圖器用；不寫進資料）─────────────────────────────────────
//
// ⚠ 色系的「功能」是對照站上技能描述歸納出來的，官方沒有文件——當篩選標籤用，不當資料分類。

export const ICON_COLOR_FAMILIES: { color: number; label: string; hint: string; hex: string }[] = [
  { color: 1, label: '紅', hint: '攻擊／輸出', hex: '#e05a5a' },
  { color: 2, label: '藍', hint: '防禦／生存', hex: '#4a90d9' },
  { color: 3, label: '綠', hint: '修理／治療', hex: '#6aa84f' },
  { color: 4, label: '金', hint: '暴擊／AP／自我強化', hex: '#e0a43a' },
  { color: 5, label: '紫', hint: '戰術／機制', hex: '#8e6bd6' },
  { color: 9, label: '聯動', hint: '聯動角色專用', hex: '#d946ef' },
]

/** 選圖器開啟時依技能類型預選種類（主動技能 → ▲ main…）；認不得的類型回 undefined（不預選） */
export function iconKindsForSkillType(type: string | null | undefined): IconKind[] | undefined {
  switch ((type ?? '').trim()) {
    case '主動技能': return ['main']
    case '指令技能': return ['order']
    case '被動技能': return ['passive']
    case 'PP技能': case 'pp技能': return ['pp']
    default: return undefined
  }
}

export const ICON_KIND_LABELS: Record<IconKind, string> = {
  main: '▲ 主動', order: '■ 指令', passive: '● 被動', talent: '◆ 天賦', pp: 'pp',
  entry: '模組詞條', rnd: '研發', command: '指揮官', refactoring: '重構', other: '其他',
  generic: '通用增益', debuff: '通用減益', stat: '屬性／資源', status: '控制／異常', repair: '修理',
  unique: '專屬徽記', stack: '層數', misc: '其他',
}
