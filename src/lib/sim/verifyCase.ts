// ─── 傷害模擬驗證台：實測、誤差、案例檔（PLAN-065-C C-3／C-4／C-5）──────────────────
//
// 驗證台頁面的純邏輯：解析站長輸入的實測、把實測與引擎預測逐項並排、組出要放進私有 repo 的案例檔。
// 這裡只做「同一個欄位的兩個數字相減」與格式轉換，不知道也不判斷數字是怎麼算出來的（決策 C3）。
// 完整拆解（L2）的結構不在公開 repo：單擊要比對 L2 的哪個數字，由站長在頁面上點選，存成 JSON Pointer。
//
// 純函式、無 React 依賴，可單測（npm test）。

import type { PartKey, SimRequestV1, SimResponseV1, SimResultV1, SimSegmentV1 } from './contract.ts'

// ─── 實測 ────────────────────────────────────────────────────────────────────

/** 「確認攻擊」預覽畫面上的數字（沒有隨機成分，一張截圖一筆）。百分比用 0–100。 */
export interface PreviewMeasure {
  perHit?: number
  hits?: number
  hitPct?: number
  critPct?: number
}

/** 實際出手的一擊。damage 為 null＝未命中。 */
export interface HitRecord {
  damage: number | null
  crit: boolean
  part?: PartKey
}

/** 一個 job 的實測輸入（頁面狀態，也原樣寫進案例檔）。 */
export interface JobMeasure {
  preview: PreviewMeasure
  /** 實際跳字的原始輸入（格式見 parseHitLog） */
  hitLog: string
  /** 預覽單擊要對 L2 的哪個數字（JSON Pointer）；省略＝不比對單擊 */
  perHitPointer?: string
  note?: string
}

export const emptyMeasure = (): JobMeasure => ({ preview: {}, hitLog: '' })

/** 部位前綴（中文、英文鍵都收）。 */
const PART_PREFIX: Readonly<Record<string, PartKey>> = {
  體: 'body', 身: 'body', 機體: 'body', body: 'body', b: 'body',
  左: 'larm', 左臂: 'larm', larm: 'larm', la: 'larm',
  右: 'rarm', 右臂: 'rarm', rarm: 'rarm', ra: 'rarm',
  腿: 'leg', 腿部: 'leg', 腳: 'leg', leg: 'leg', l: 'leg',
}
const MISS_TOKENS = new Set(['x', 'miss', '閃', '未中', '-'])

/**
 * 實際跳字的輸入格式：以空白或換行分隔，一個記號一擊。
 *   `1234` 一般命中；`1234!`（或 `1234*`）暴擊；`x`／`miss`／`閃` 未命中
 *   可加部位前綴：`體:1234`、`左:1234!`、`右:x`、`腿:980`（也收 body／larm／rarm／leg）
 * 數字不要加千分位。認不得的記號原樣列進 errors，不會被默默丟掉。
 */
export function parseHitLog(text: string): { hits: HitRecord[]; errors: string[] } {
  const hits: HitRecord[] = []
  const errors: string[] = []
  for (const raw of text.split(/[\s,，、]+/)) {
    const token = raw.trim()
    if (!token) continue
    let body = token
    let part: PartKey | undefined
    const m = /^([^:：]+)[:：](.*)$/.exec(token)
    if (m) {
      const p = PART_PREFIX[m[1].trim().toLowerCase()] ?? PART_PREFIX[m[1].trim()]
      if (!p) { errors.push(token); continue }
      part = p
      body = m[2].trim()
    }
    if (MISS_TOKENS.has(body.toLowerCase())) {
      hits.push(part ? { damage: null, crit: false, part } : { damage: null, crit: false })
      continue
    }
    const n = /^(\d+(?:\.\d+)?)([!！*]?)$/.exec(body)
    if (!n) { errors.push(token); continue }
    const rec: HitRecord = { damage: Number(n[1]), crit: n[2] !== '' }
    if (part) rec.part = part
    hits.push(rec)
  }
  return { hits, errors }
}

export interface HitSummary {
  attempts: number
  landed: number
  crits: number
  /** 0–1；沒有出手時為 null */
  hitRate: number | null
  /** 0–1，以命中數為分母；沒有命中時為 null */
  critRate: number | null
  /** 命中的平均單擊（含暴擊） */
  meanLanded: number | null
  meanNonCrit: number | null
  meanCrit: number | null
  /** 各部位的命中數（有標部位的才算） */
  byPart: Partial<Record<PartKey, number>>
}

const mean = (xs: readonly number[]): number | null =>
  xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null

export function summarizeHits(hits: readonly HitRecord[]): HitSummary {
  const landed = hits.filter((h) => h.damage !== null)
  const crit = landed.filter((h) => h.crit)
  const nonCrit = landed.filter((h) => !h.crit)
  const byPart: Partial<Record<PartKey, number>> = {}
  for (const h of landed) if (h.part) byPart[h.part] = (byPart[h.part] ?? 0) + 1
  return {
    attempts: hits.length,
    landed: landed.length,
    crits: crit.length,
    hitRate: hits.length > 0 ? landed.length / hits.length : null,
    critRate: landed.length > 0 ? crit.length / landed.length : null,
    meanLanded: mean(landed.map((h) => h.damage as number)),
    meanNonCrit: mean(nonCrit.map((h) => h.damage as number)),
    meanCrit: mean(crit.map((h) => h.damage as number)),
    byPart,
  }
}

// ─── L2 取值（JSON Pointer，RFC 6901）────────────────────────────────────────

const escapeSeg = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1')
const unescapeSeg = (s: string) => s.replace(/~1/g, '/').replace(/~0/g, '~')

export const toPointer = (path: readonly (string | number)[]): string =>
  path.map((p) => `/${escapeSeg(String(p))}`).join('')

/** 依 JSON Pointer 取值；路徑不存在回 undefined。 */
export function getAtPointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root
  if (!pointer.startsWith('/')) return undefined
  let cur: unknown = root
  for (const seg of pointer.slice(1).split('/').map(unescapeSeg)) {
    if (cur === null || typeof cur !== 'object') return undefined
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9]\d*)$/.test(seg)) return undefined
      cur = cur[Number(seg)]
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined
      cur = (cur as Record<string, unknown>)[seg]
    }
  }
  return cur
}

// ─── 誤差 ────────────────────────────────────────────────────────────────────

/** 單擊誤差的容許範圍（PLAN-065-C E-1 的驗收：±1）。 */
export const DAMAGE_TOLERANCE = 1
/** 機率欄位的容許範圍（百分點）。 */
export const RATE_TOLERANCE_PCT = 1

export interface CompareRow {
  key: 'previewPerHit' | 'previewHits' | 'previewHit' | 'previewCrit' | 'actualMean' | 'actualHit' | 'actualCrit'
  label: string
  /** 'pct' 的兩個值都是 0–100 */
  unit: 'dmg' | 'count' | 'pct'
  measured: number
  predicted: number
  /** measured − predicted */
  diff: number
  /** true／false＝在／不在容許範圍；null＝僅供參考（樣本統計，不判定） */
  ok: boolean | null
  /** 補充（樣本數、取值路徑） */
  note?: string
}

const within = (diff: number, tol: number) => Math.abs(diff) <= tol + 1e-9

/**
 * 一個 job 的實測 vs 預測。
 * 預覽的四個數字與第一段（segments[segment]）同名欄位相減；預覽單擊只在指定了 L2 路徑時比對。
 * 實際跳字的統計值列為參考（ok: null）：樣本數少時差異是抽樣誤差，不拿來判定。
 */
export function compareJob(result: SimResultV1, m: JobMeasure, segment = 0): CompareRow[] {
  const rows: CompareRow[] = []
  const seg: SimSegmentV1 | undefined = result.L0?.segments[segment]
  const p = m.preview
  const push = (row: Omit<CompareRow, 'diff' | 'ok'>, tol: number | null) => {
    const diff = row.measured - row.predicted
    rows.push({ ...row, diff, ok: tol === null ? null : within(diff, tol) })
  }

  if (p.perHit !== undefined && m.perHitPointer !== undefined) {
    const v = getAtPointer(result.L2, m.perHitPointer)
    if (typeof v === 'number' && Number.isFinite(v)) {
      push({ key: 'previewPerHit', label: '預覽單擊', unit: 'dmg', measured: p.perHit, predicted: v, note: `L2${m.perHitPointer}` }, DAMAGE_TOLERANCE)
    }
  }
  if (seg) {
    if (p.hits !== undefined) push({ key: 'previewHits', label: '預覽擊數', unit: 'count', measured: p.hits, predicted: seg.hits }, 0)
    if (p.hitPct !== undefined) push({ key: 'previewHit', label: '預覽命中率', unit: 'pct', measured: p.hitPct, predicted: seg.hitRate * 100 }, RATE_TOLERANCE_PCT)
    if (p.critPct !== undefined) push({ key: 'previewCrit', label: '預覽暴擊率', unit: 'pct', measured: p.critPct, predicted: seg.critRate * 100 }, RATE_TOLERANCE_PCT)

    const s = summarizeHits(parseHitLog(m.hitLog).hits)
    if (s.meanLanded !== null) push({ key: 'actualMean', label: '實際平均單擊（命中）', unit: 'dmg', measured: s.meanLanded, predicted: seg.perHitMean, note: `${s.landed} 擊` }, null)
    if (s.hitRate !== null) push({ key: 'actualHit', label: '實際命中率', unit: 'pct', measured: s.hitRate * 100, predicted: seg.hitRate * 100, note: `${s.landed}／${s.attempts}` }, null)
    if (s.critRate !== null) push({ key: 'actualCrit', label: '實際暴擊率', unit: 'pct', measured: s.critRate * 100, predicted: seg.critRate * 100, note: `${s.crits}／${s.landed}` }, null)
  }
  return rows
}

/** 有沒有任何一項判定為超出容許範圍。 */
export const hasMismatch = (rows: readonly CompareRow[]) => rows.some((r) => r.ok === false)

// ─── 案例檔 ──────────────────────────────────────────────────────────────────

export const SIM_CASE_KIND = 'mecharashi-sim-case'

/**
 * 案例檔 v1：驗證台下載、放進私有 repo（mecharashi-sim 的 tests/regression）後成為回歸測試。
 * 截圖與錄影不放進來（留在站長本機）。改格式時把 v 加一，私有端兩版都要讀得懂。
 */
export interface SimCaseFileV1 {
  kind: typeof SIM_CASE_KIND
  v: 1
  /** ISO 時間 */
  createdAt: string
  title: string
  note: string
  /** 這份請求是從哪套配裝組出來的（顯示與重現用；請求本身已自足） */
  source: { shareCode?: string }
  /** 站上的顯示名稱（給人看，不參與計算） */
  context: {
    pilot: string
    mech: string
    target: string
    /** SimWeaponV1.key → 武器名 */
    weapons: Record<string, string>
  }
  request: SimRequestV1
  /** 算出這份結果的引擎與資料版本 */
  engine: Pick<SimResponseV1, 'engineVersion' | 'dataVersion' | 'buildNum' | 'overridesVersion' | 'flagsDigest'>
  /** 管理者通道（結果含 L2）時為 true */
  admin: boolean
  results: SimResultV1[]
  /** 與 request.jobs 同序 */
  measurements: Array<JobMeasure & { job: number; hits: HitRecord[] }>
}

export interface CaseFileInput {
  createdAt: Date
  title: string
  note: string
  shareCode?: string
  context: SimCaseFileV1['context']
  request: SimRequestV1
  response: SimResponseV1
  measures: readonly JobMeasure[]
}

export function buildCaseFile(input: CaseFileInput): SimCaseFileV1 {
  const r = input.response
  const source: SimCaseFileV1['source'] = {}
  if (input.shareCode) source.shareCode = input.shareCode
  return {
    kind: SIM_CASE_KIND,
    v: 1,
    createdAt: input.createdAt.toISOString(),
    title: input.title.trim(),
    note: input.note.trim(),
    source,
    context: input.context,
    request: input.request,
    engine: {
      engineVersion: r.engineVersion,
      dataVersion: r.dataVersion,
      buildNum: r.buildNum,
      overridesVersion: r.overridesVersion,
      flagsDigest: r.flagsDigest,
    },
    admin: r.results.some((x) => x.L2 !== undefined),
    results: r.results,
    measurements: input.request.jobs.map((_, job) => {
      const m = input.measures[job] ?? emptyMeasure()
      return { ...m, job, hits: parseHitLog(m.hitLog).hits }
    }),
  }
}

/** 檔名不能用的字元換成底線。 */
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '')

/** `sim-case_2026-11-01_18-1_海莉絲.json`（日期取本地時間）。 */
export function caseFileName(createdAt: Date, label: string): string {
  const d = createdAt
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const tail = safeName(label)
  return `sim-case_${ymd}${tail ? `_${tail}` : ''}.json`
}
