// PLAN-064 E：武裝討伐頁的純顯示邏輯（RaidSeasonView 與後台預覽共用；node:test 可直接測）。

import type { Boss, BossSkill, RaidReinforcement, RaidSeason, RaidStageVariant, RaidUnit, RaidWhen } from '../types/boss'
import type { RaidDifficulty } from '../types/enums'

// ── ⟦…⟧ 引用記號 ──────────────────────────────────────────────────────────────
//   ⟦buf:1⟧ ⟦buf:1|標籤⟧ ⟦main:1⟧ ⟦passive:1⟧ ⟦active:1⟧ ⟦terrain:1⟧ ⟦unit:853501⟧ ⟦em:2⟧

export type RaidToken =
  | { t: 'text'; v: string }
  | { t: 'em'; v: string }
  | { t: 'ref'; key: string; label?: string }
  | { t: 'unit'; key: string }

const TOKEN_RE = /⟦(buf|main|passive|active|terrain|unit|em):([^|⟧]*)(?:\|([^⟧]*))?⟧/g

export function parseRaidText(text: string | undefined | null): RaidToken[] {
  if (!text) return []
  const out: RaidToken[] = []
  let last = 0
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m.index! > last) out.push({ t: 'text', v: text.slice(last, m.index) })
    const [, kind, id, label] = m
    if (kind === 'em') out.push({ t: 'em', v: id })
    else if (kind === 'unit') out.push({ t: 'unit', key: id })
    else out.push({ t: 'ref', key: `${kind}:${id}`, ...(label ? { label } : {}) })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) })
  return out
}

/** 純文字版（比對差異、搜尋、title 屬性用）：記號換成名稱 */
export function plainRaidText(
  text: string | undefined | null,
  names: { ref?: (key: string) => string | undefined; unit?: (key: string) => string | undefined } = {},
): string {
  return parseRaidText(text).map((tk) => {
    switch (tk.t) {
      case 'text': case 'em': return tk.v
      case 'unit': return names.unit?.(tk.key) ?? ''
      case 'ref': return tk.label ?? names.ref?.(tk.key) ?? ''
    }
  }).join('')
}

// ── 時點 ──────────────────────────────────────────────────────────────────────

/** RaidWhen → 標籤（condition 的 text 可能含 ⟦unit:…⟧，交給 RaidRichText 畫）。unknown → 「特定條件觸發」 */
export function whenLabel(w: RaidWhen | undefined): string {
  if (!w) return ''
  switch (w.kind) {
    case 'start': return '開戰時'
    case 'turn': return `第 ${w.turns.join('、')} 回合${w.timing === 'end' ? '結束' : '開始'}`
    case 'everyTurn': return `${w.from ? `第 ${w.from} 回合起` : ''}每回合${w.timing === 'end' ? '結束' : '開始'}`
    case 'condition': return w.text
    case 'unknown': return '特定條件觸發'
  }
}

// ── 回合格（增援時程的主視覺）────────────────────────────────────────────────

export interface TurnCell {
  turn: number
  /** 這回合開始時亮起預警的增援（下一次才會出現） */
  warns: RaidReinforcement[]
  /** 這回合開始／結束出現的增援 */
  arrivals: { rf: RaidReinforcement; timing: 'start' | 'end' }[]
  /** 懸賞期限（「6回合勝利」→ 第 6 格） */
  bounties: string[]
  /** 回合上限 */
  isLimit: boolean
}

export interface TurnTimeline {
  cells: TurnCell[]
  /** 不是「第 N 回合」的增援：每回合、條件觸發、開戰、未知 */
  others: RaidReinforcement[]
}

const BOUNTY_TURN_RE = /(\d+)\s*回合(?:內)?(?:勝利|獲勝|擊敗|完成)/

/** 增援與懸賞排成回合格；格數＝max(回合上限, 最後一次增援)，至少 1 */
export function turnTimeline(v: Pick<RaidStageVariant, 'reinforcements' | 'turnLimit' | 'bounties'>): TurnTimeline {
  const turnRfs = v.reinforcements.filter((r) => r.when.kind === 'turn')
  const others = v.reinforcements.filter((r) => r.when.kind !== 'turn')
  const bountyTurns = v.bounties.map((b) => {
    const m = BOUNTY_TURN_RE.exec(b.desc || '')
    return m ? { turn: Number(m[1]), name: b.name } : null
  }).filter((x): x is { turn: number; name: string } => !!x)
  const lastTurn = Math.max(
    v.turnLimit || 0,
    ...turnRfs.flatMap((r) => (r.when.kind === 'turn' ? r.when.turns : [])),
    ...turnRfs.flatMap((r) => (r.warn?.kind === 'turn' ? r.warn.turns : [])),
    ...bountyTurns.map((b) => b.turn),
    1,
  )
  const cells: TurnCell[] = Array.from({ length: lastTurn }, (_, i) => ({
    turn: i + 1, warns: [], arrivals: [], bounties: [], isLimit: v.turnLimit === i + 1,
  }))
  for (const r of turnRfs) {
    if (r.when.kind !== 'turn') continue
    for (const t of r.when.turns) cells[t - 1]?.arrivals.push({ rf: r, timing: r.when.timing })
    if (r.warn?.kind === 'turn') for (const t of r.warn.turns) cells[t - 1]?.warns.push(r)
  }
  for (const b of bountyTurns) cells[b.turn - 1]?.bounties.push(b.name)
  return { cells, others }
}

/** 一列單位（含合併進來的同名模板）用到的機體名，去重 */
export function unitMechs(u: RaidUnit, unitDict: Record<string, { mech?: string }>): string[] {
  return [...new Set([u.unit, ...(u.merged ?? [])].map((k) => unitDict[k]?.mech).filter((m): m is string => !!m))]
}

/** 單位列合計數量（「老練傭兵 ×2、精英傭兵 ×1」的 ×N） */
export const unitCount = (units: RaidUnit[]) => units.reduce((a, u) => a + u.count, 0)

// ── 獎勵（取自版本時間線 armamentRaids；以台版期名比對，同匯入端 matchTimeline）─────────

interface HalfLike { armamentRaids?: { name: string; weapons?: string[]; weaponPilots?: string[]; backpacks?: string[] }[] }

export function raidRewardsFromTimeline(
  versions: { upper?: HalfLike; lower?: HalfLike }[],
  seasonName: string,
): { weapons: { name: string; pilot?: string }[]; backpacks: string[] } | null {
  const norm = (s: string) => s.replace(/\s+/g, '')
  for (const v of versions) {
    for (const half of [v.upper, v.lower]) {
      const r = half?.armamentRaids?.find((x) => norm(x.name) === norm(seasonName))
      if (r) {
        return {
          weapons: (r.weapons ?? []).map((name, i) => ({ name, ...(r.weaponPilots?.[i] ? { pilot: r.weaponPilots[i] } : {}) })),
          backpacks: r.backpacks ?? [],
        }
      }
    }
  }
  return null
}

// ── 難度 ──────────────────────────────────────────────────────────────────────

/** 難度色（初試白、磨鍊黃、死境紅、煉獄深紅），配合站上的 accent token */
export const DIFFICULTY_TONE: Record<RaidDifficulty, { dot: string; text: string; ring: string }> = {
  normal: { dot: 'bg-text-secondary', text: 'text-text-primary', ring: 'border-text-secondary/60' },
  hard: { dot: 'bg-accent-yellow', text: 'text-accent-yellow', ring: 'border-accent-yellow/60' },
  hell: { dot: 'bg-accent-red', text: 'text-accent-red', ring: 'border-accent-red/60' },
  d4: { dot: 'bg-accent-red', text: 'text-accent-red', ring: 'border-accent-red' },
}

/**
 * 技能是否「與初試不同」：同名技能的說明文字不同（同名不同數值，例：皮普「无畏前行Ⅰ」初試 3 格、死境 4 格），
 * 或初試沒有這個技能。初試本身一律 false。
 */
export function skillChangedFromNormal(skill: BossSkill, normalSkills: BossSkill[] | undefined, isNormal: boolean): 'changed' | 'new' | null {
  if (isNormal || !normalSkills) return null
  const same = normalSkills.find((s) => s.name === skill.name && s.kind === skill.kind)
  if (!same) return 'new'
  return same.description === skill.description ? null : 'changed'
}

/** 首領卡的技能排序：主動在前、天賦、被動、機體固有、武器附帶、等級加成 */
const SKILL_ORDER: Record<string, number> = { main: 0, talent: 1, passive: 2, mech: 3, weapon: 4, level: 5 }
export const sortBossSkills = (skills: BossSkill[]) =>
  [...skills].sort((a, b) => (SKILL_ORDER[a.kind ?? 'passive'] ?? 9) - (SKILL_ORDER[b.kind ?? 'passive'] ?? 9))

export const SKILL_KIND_LABEL: Record<string, string> = {
  main: '主動', talent: '天賦', passive: '被動', mech: '機體', weapon: '武器', level: '等級',
}

// ── 首領在其他期的出場（E-4「也出現在」）────────────────────────────────────────
//
// 同名＝同一角色：資料包每一期的強敵圖鑑條目 ID 都不同（曼恩在第 1／16／20 期是三個條目），能串起來的只有名字。
// 在前台推導、不存進 bosses 文件——新增一期時，舊期的首領不必重新發布就會多一條連結。

export interface RaidSeasonLink { id: string; seq: number; name: string }

export function relatedSeasons(
  seasonId: string,
  bosses: Pick<Boss, 'id' | 'name' | 'seasonId'>[],
  seasons: Pick<RaidSeason, 'id' | 'seq' | 'name' | 'published'>[],
): Record<string, RaidSeasonLink[]> {
  const pub = new Map(seasons.filter((s) => s.published).map((s) => [s.id, s]))
  const byName = new Map<string, Set<string>>()
  for (const b of bosses) {
    if (!b.seasonId || !pub.has(b.seasonId)) continue
    let set = byName.get(b.name)
    if (!set) byName.set(b.name, (set = new Set()))
    set.add(b.seasonId)
  }
  const out: Record<string, RaidSeasonLink[]> = {}
  for (const b of bosses) {
    if (b.seasonId !== seasonId) continue
    const links = [...(byName.get(b.name) ?? [])].filter((id) => id !== seasonId)
      .map((id) => pub.get(id)!).sort((a, c) => a.seq - c.seq)
      .map((s) => ({ id: s.id, seq: s.seq, name: s.name }))
    if (links.length) out[b.id] = links
  }
  return out
}
