import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { LoadoutDraft } from '../../types/loadout'
import type { RaidDraft, RaidOverrideDoc, RaidTermDoc } from '../../types/boss'
import { useLoadoutGameData } from '../../hooks/useFirestore'
import { useGameData } from '../../contexts/GameDataContext'
import { buildWorld } from '../../utils/loadoutRules'
import { buildShareIndex } from '../../utils/loadoutCode/shareId'
import { shareIdAliases, shareIdRegisteredIds } from '../../utils/loadoutCode/shareIdRegistry'
import { decodeLoadout, type ShareIndexes } from '../../utils/loadoutCode/codec'
import { readShareCode } from '../../utils/loadoutCode/shareLink'
import { readShelf } from '../../lib/localBuilds'
import { getRaidDrafts, getRaidOverrides, getRaidTerms } from '../../lib/api/raids'
import { buildRaidDocs, indexTerms } from '../../utils/raidDraft'
import type { ActionSpecV1, PanelSnapshotV1, SimRequestV1, SimResponseV1, SimScenarioV1, WeaponSlot } from '../../lib/sim/contract'
import { buildSimLoadout, buildSingleRequest, defaultScenario, type GrowthAssumptions } from '../../lib/sim/requestBuilder'
import { pingSim, runSim, SimApiError } from '../../lib/sim/simClient'
import { buildCaseFile, caseFileName, emptyMeasure, type JobMeasure } from '../../lib/sim/verifyCase'
import { buildSourceNameIndex } from '../../lib/sim/sourceNames'
import { SimTargetPicker } from '../../components/admin/sim/SimTargetPicker'
import { resolveTarget, type RaidCatalogSeason, type TargetSelection } from '../../components/admin/sim/simTarget'
import { SimJobCard } from '../../components/admin/sim/SimJobCard'

// ─── 傷害模擬驗證台（PLAN-065-C Phase C）───────────────────────────────────────
//
// 站長對帳用：載入配裝 → 養成假設 → 選首領 → 送 /sim/v1/run（管理者帶登入憑證，拿完整拆解）
//   → 輸入遊戲內實測 → 逐項看誤差 → 匯出案例檔（放進私有 repo 成為回歸測試）。
// 頁面只負責輸入與排版；所有數字由 Worker 算（決策 C1／C3），完整拆解用通用的 JSON 樹呈現（決策三）。
// 管理者身分由 Worker 驗證；Worker 還沒設定允許名單時照常可用，只是結果停在 L1。
//
// 輸入（配裝代碼、假設、目標、實測、案例標題）存在本機 localStorage，重新整理不會丟；不寫 Firestore。

const STORE_KEY = 'mecharashi_sim_verify_v1'

type SkillChoice = Extract<ActionSpecV1['skill'], string>
interface JobRow { weaponKey: string; skill: SkillChoice }

interface Persisted {
  code: string
  potential: string
  research: GrowthAssumptions['research']
  refit: { mode: 'engine' | 'set'; normal: number; advanced: number }
  level: 'L1' | 'L2'
  perHit: boolean
  timing: SimScenarioV1['attack']['timing']
  probability: SimScenarioV1['probability']
  target: TargetSelection
  jobs: JobRow[]
  panel: Record<string, string>
  measures: JobMeasure[]
  title: string
  note: string
}

const DEFAULTS: Persisted = {
  code: '', potential: '', research: 'full', refit: { mode: 'engine', normal: 8, advanced: 4 },
  level: 'L2', perHit: false, timing: 'auto', probability: 'expected',
  target: { mode: 'raid', part: 'auto' }, jobs: [], panel: {}, measures: [], title: '', note: '',
}

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return DEFAULTS
    const v = JSON.parse(raw) as Partial<Persisted>
    return { ...DEFAULTS, ...v, refit: { ...DEFAULTS.refit, ...v.refit }, target: { ...DEFAULTS.target, ...v.target } }
  } catch {
    return DEFAULTS
  }
}

const SKILL_LABEL: Record<SkillChoice, string> = { default: '一般攻擊', equipment: '武器技能', command: '指令技能' }
const SLOT_LABEL: Record<WeaponSlot, string> = { lh: '左手', rh: '右手', dual: '雙手', ls: '左肩', rs: '右肩', back: '背部' }
const PILOT_PANEL: { key: string; label: string }[] = [
  { key: 'melee', label: '格鬥' }, { key: 'assault', label: '突擊' }, { key: 'shooting', label: '射擊' },
  { key: 'tactics', label: '戰術' }, { key: 'engineering', label: '工程' }, { key: 'defense', label: '防禦' }, { key: 'fire', label: '火力' },
]
const WEAPON_PANEL: { prefix: string; label: string }[] = [
  { prefix: 'weaponAttack', label: '攻擊' }, { prefix: 'weaponHit', label: '命中' }, { prefix: 'weaponCrit', label: '暴擊' },
]

const CARD = 'rounded border border-border bg-bg-card p-3'
const INPUT = 'px-1.5 py-0.5 rounded border border-border bg-bg-dark text-text-primary text-[12px]'
const BTN = 'px-2.5 py-1 text-[12px] rounded border border-border text-text-secondary hover:text-text-primary disabled:opacity-40'

const localTime = (d: Date) => d.toLocaleString('zh-TW', { hour12: false })

export default function AdminSimVerifyPage() {
  const [s, setS] = useState<Persisted>(loadPersisted)
  const patch = useCallback((p: Partial<Persisted>) => setS((prev) => ({ ...prev, ...p })), [])
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)) } catch { /* 隱私模式：只是不保留 */ }
  }, [s])

  // ── 遊戲資料（與模擬器同一組集合）──
  const { data, loading } = useLoadoutGameData('equip')
  const gd = useGameData()
  useEffect(() => { void gd.ensureLoaded(['pilotSkills', 'raidSeasons', 'stages', 'bosses']) }, [gd])
  const world = useMemo(() => buildWorld({ ...data, pilotSkills: gd.pilotSkills }), [data, gd.pilotSkills])
  // 分享碼索引：與 LoadoutPage／CloudBuildList 同一組（理由見 LoadoutPage 的 shareIndexes 註解）
  const shareIndexes = useMemo<ShareIndexes>(() => ({
    pilot: buildShareIndex('pilot', data.pilots.map((x) => x.id)),
    mech: buildShareIndex('mech', data.mechs.map((x) => x.id)),
    weapon: buildShareIndex('weapon', data.weapons.map((x) => x.id)),
    backpack: buildShareIndex('backpack', data.backpacks.map((x) => x.id)),
    component: buildShareIndex('component', data.components.map((x) => x.id)),
    module: buildShareIndex('module', data.modules.map((x) => x.id), shareIdAliases('module')),
    pilotSkill: buildShareIndex('pilotSkill', shareIdRegisteredIds('pilotSkill'), shareIdAliases('pilotSkill')),
  }), [data])

  // ── Worker 版本 ──
  const [ping, setPing] = useState<{ text: string; ok: boolean } | null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    pingSim({ signal: ctrl.signal })
      .then((p) => setPing({ ok: true, text: `引擎 ${p.engineVersion}・資料 ${p.dataVersion}・建置 ${p.buildNum}` }))
      .catch((e: unknown) => { if (!ctrl.signal.aborted) setPing({ ok: false, text: e instanceof Error ? e.message : String(e) }) })
    return () => ctrl.abort()
  }, [])

  // ── 配裝 ──
  const decoded = useMemo<{ draft?: LoadoutDraft; message?: string }>(() => {
    if (loading) return {}
    const code = readShareCode(s.code)
    if (!s.code.trim()) return {}
    if (!code) return { message: '認不得這段代碼或連結' }
    const res = decodeLoadout(code, shareIndexes)
    if (!res.ok) return { message: res.message }
    return { draft: res.draft, message: res.unresolved.length > 0 ? `有 ${res.unresolved.length} 項裝備站上查不到，那幾格是空的` : undefined }
  }, [s.code, shareIndexes, loading])

  const shelf = useMemo(() => (loading ? [] : readShelf().map((b) => {
    const r = decodeLoadout(b.code, shareIndexes)
    const d = r.ok ? r.draft : undefined
    const label = d ? `${world.pilots.get(d.pilotId ?? '')?.name ?? '？'}／${world.mechs.get(d.mechId ?? '')?.name ?? '？'}${d.name ? `「${d.name}」` : ''}` : '（解不開）'
    return { ...b, label }
  })), [loading, shareIndexes, world])

  const growth = useMemo<GrowthAssumptions>(() => {
    const g: GrowthAssumptions = { research: s.research }
    if (s.refit.mode === 'set') g.refit = { default: { normal: s.refit.normal, advanced: s.refit.advanced } }
    return g
  }, [s.research, s.refit])

  const draft = useMemo(() => {
    if (!decoded.draft) return undefined
    const p = s.potential.trim() === '' ? undefined : Number(s.potential)
    return p === undefined || !Number.isFinite(p) ? decoded.draft : { ...decoded.draft, potential: p }
  }, [decoded.draft, s.potential])

  const built = useMemo(() => (draft ? buildSimLoadout({ draft, world, growth }) : null), [draft, world, growth])
  const weaponName = useCallback((key: string) => {
    const e = built?.weaponKeys.find((w) => w.key === key)
    if (!e) return key
    return `${world.weapons.get(e.weaponDocId)?.name ?? e.weaponDocId}（${e.bank === 'backup' ? '第二組' : '第一組'}${SLOT_LABEL[e.simSlot]}）`
  }, [built, world])

  // 武器換了（換配裝）就把動作清單重設成「每把武器一般攻擊」
  const keySig = built?.weaponKeys.map((w) => w.key).join(',') ?? ''
  const lastSig = useRef<string | null>(null)
  useEffect(() => {
    if (!built) return
    const valid = new Set(built.weaponKeys.map((w) => w.key))
    if (lastSig.current === null && s.jobs.length > 0 && s.jobs.every((j) => valid.has(j.weaponKey))) { lastSig.current = keySig; return }
    if (lastSig.current === keySig) return
    lastSig.current = keySig
    patch({ jobs: built.weaponKeys.map((w) => ({ weaponKey: w.key, skill: 'default' as const })), measures: [] })
  }, [keySig, built, s.jobs, patch])

  // ── 目標 ──
  const [drafts, setDrafts] = useState<{ drafts: RaidDraft[]; terms: RaidTermDoc[]; overrides: RaidOverrideDoc[] } | null>(null)
  const [draftsBusy, setDraftsBusy] = useState(false)
  const [draftsError, setDraftsError] = useState<string | null>(null)
  const loadDrafts = async () => {
    setDraftsBusy(true); setDraftsError(null)
    try {
      const [d, terms, overrides] = await Promise.all([getRaidDrafts(), getRaidTerms(), getRaidOverrides()])
      setDrafts({ drafts: d, terms, overrides })
    } catch (e) {
      setDraftsError(e instanceof Error ? e.message : String(e))
    } finally {
      setDraftsBusy(false)
    }
  }
  const catalog = useMemo<RaidCatalogSeason[]>(() => {
    const out: RaidCatalogSeason[] = gd.raidSeasons.map((season) => ({
      season,
      stages: gd.stages.filter((x) => x.raid?.seasonId === season.id),
      bosses: gd.bosses.filter((x) => x.seasonId === season.id),
      source: 'published' as const,
    }))
    if (drafts) {
      const terms = indexTerms(drafts.terms)
      for (const d of drafts.drafts) {
        if (out.some((x) => x.season.id === d.id)) continue
        const ov = drafts.overrides.find((o) => o.id === d.id)
        const r = buildRaidDocs(d, terms, Object.values(ov?.entries ?? {}))
        out.push({ season: r.season, stages: r.stages, bosses: r.bosses, source: 'draft' })
      }
    }
    return out.sort((a, b) => b.season.seq - a.season.seq)
  }, [gd.raidSeasons, gd.stages, gd.bosses, drafts])
  const target = useMemo(() => resolveTarget(catalog, s.target), [catalog, s.target])

  // ── 面板覆寫 ──
  const panelOverrides = useMemo<PanelSnapshotV1 | undefined>(() => {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(s.panel)) {
      if (v.trim() === '') continue
      const n = Number(v)
      if (Number.isFinite(n)) out[k] = n
    }
    return Object.keys(out).length > 0 ? (out as PanelSnapshotV1) : undefined
  }, [s.panel])

  // ── 計算 ──
  const [run, setRun] = useState<{ request: SimRequestV1; response: SimResponseV1; at: Date } | null>(null)
  const [busy, setBusy] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)

  const request = useMemo<SimRequestV1 | null>(() => {
    if (!built?.loadout || !target.target || s.jobs.length === 0) return null
    const loadout = panelOverrides ? { ...built.loadout, panelOverrides } : built.loadout
    const scenario: SimScenarioV1 = { ...defaultScenario(), attack: { timing: s.timing }, probability: s.probability }
    return buildSingleRequest({
      loadout,
      target: target.target,
      actions: s.jobs.map((j) => ({ weaponKey: j.weaponKey, skill: j.skill })),
      level: s.level,
      perHit: s.level === 'L2' && s.perHit,
      scenario,
    })
  }, [built, target.target, s.jobs, s.level, s.perHit, s.timing, s.probability, panelOverrides])

  const execute = async () => {
    if (!request) return
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    setBusy(true); setRunError(null)
    try {
      const response = await runSim(request, { admin: true, signal: ctrl.signal })
      setRun({ request, response, at: new Date() })
      // 實測跟著 job 走：動作數變了就補齊／截斷，已輸入的保留
      setS((prev) => ({ ...prev, measures: request.jobs.map((_, i) => prev.measures[i] ?? emptyMeasure()) }))
    } catch (e) {
      if (ctrl.signal.aborted) return
      setRunError(e instanceof SimApiError ? `${e.message}${e.retryAfterMs ? `（${Math.ceil(e.retryAfterMs / 1000)} 秒後再試）` : ''}` : e instanceof Error ? e.message : String(e))
    } finally {
      if (ctrlRef.current === ctrl) setBusy(false)
    }
  }
  useEffect(() => () => ctrlRef.current?.abort(), [])

  const isAdminResult = run?.response.results.some((r) => r.L2 !== undefined) ?? false
  const downgraded = run?.response.results.some((r) => r.warnings.some((w) => w.code === 'levelDowngraded')) ?? false
  const stale = run !== null && request !== null && JSON.stringify(run.request) !== JSON.stringify(request)

  const names = useMemo(() => buildSourceNameIndex({
    pilots: data.pilots, mechs: data.mechs, weapons: data.weapons, modules: data.modules, components: data.components,
    backpacks: data.backpacks, pilotSkills: gd.pilotSkills, forms: data.forms, bosses: catalog.flatMap((c) => c.bosses),
  }), [data, gd.pilotSkills, catalog])

  /** 回應裡各結果的引擎面板合併（填入面板覆寫的起點） */
  const enginePanel = useMemo(() => Object.assign({}, ...(run?.response.results.map((r) => r.derived.panel) ?? [])) as Record<string, number>, [run])

  // ── 匯出 ──
  const exportCase = () => {
    if (!run) return
    const now = new Date()
    const pilot = world.pilots.get(draft?.pilotId ?? '')?.name ?? ''
    const file = buildCaseFile({
      createdAt: now,
      title: s.title || target.label,
      note: s.note,
      shareCode: readShareCode(s.code) ?? undefined,
      context: {
        pilot,
        mech: world.mechs.get(draft?.mechId ?? '')?.name ?? '',
        target: target.label,
        weapons: Object.fromEntries((built?.weaponKeys ?? []).map((w) => [w.key, world.weapons.get(w.weaponDocId)?.name ?? w.weaponDocId])),
      },
      request: run.request,
      response: run.response,
      measures: s.measures,
    })
    const label = run.request.targets[0]?.kind === 'raid' ? `${run.request.targets[0].seasonNo}-${run.request.targets[0].stageNo}_${pilot}` : pilot
    const blob = new Blob([JSON.stringify(file, null, 2) + '\n'], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = caseFileName(now, label)
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const setMeasure = (i: number, m: JobMeasure) =>
    setS((prev) => { const measures = [...prev.measures]; measures[i] = m; return { ...prev, measures } })

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/admin" className="text-accent-cyan hover:underline text-sm">← 管理後台</Link>
        <h1 className="text-2xl font-bold">傷害模擬驗證台</h1>
        {ping && <span className={`text-[12px] ${ping.ok ? 'text-text-dim' : 'text-accent-red'}`}>{ping.text}</span>}
      </div>

      {/* ── 1. 配裝 ── */}
      <section className={CARD}>
        <h2 className="text-[14px] font-bold text-text-primary mb-2">1. 配裝</h2>
        <textarea
          value={s.code}
          onChange={(e) => patch({ code: e.target.value })}
          rows={2}
          placeholder="貼上配裝分享連結或代碼（模擬器的「複製分享連結」）"
          className={`${INPUT} w-full font-mono`}
        />
        {shelf.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="text-text-dim">本機書架：</span>
            {shelf.map((b) => (
              <button key={b.id} type="button" className={BTN} onClick={() => patch({ code: b.code })}>{b.label}</button>
            ))}
          </div>
        )}
        {loading && <div className="mt-1 text-[12px] text-text-dim">遊戲資料載入中…</div>}
        {decoded.message && <div className="mt-1 text-[12px] text-accent-yellow">{decoded.message}</div>}
        {built && (
          <div className="mt-2 text-[12px] space-y-1">
            <div className="text-text-primary">
              {world.pilots.get(draft?.pilotId ?? '')?.name ?? '（未選機師）'}／{world.mechs.get(draft?.mechId ?? '')?.name ?? '（未選機甲）'}
              <span className="text-text-dim ml-2">武器 {built.weaponKeys.length} 把・攜帶技能 {built.loadout?.pilot.carried.length ?? 0} 支・模組 {built.loadout?.mech.modules.length ?? 0} 個</span>
            </div>
            {!built.loadout && <div className="text-accent-red">這套配裝送不出去（見下方未連結與附註）</div>}
            {built.unmapped.length > 0 && (
              <div className="text-accent-yellow">
                未連結 {built.unmapped.length} 項：{built.unmapped.map((u) => `${u.name}${u.where ? `（${u.where}）` : ''}${u.reason === 'notLoaded' ? '・未載入' : u.reason === 'notFound' ? '・查無' : ''}`).join('、')}
              </div>
            )}
            {built.notes.map((n, i) => <div key={i} className="text-text-dim">・{n}</div>)}
          </div>
        )}
      </section>

      {/* ── 2. 養成假設與情境 ── */}
      <section className={CARD}>
        <h2 className="text-[14px] font-bold text-text-primary mb-2">2. 養成假設與情境</h2>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-text-secondary items-center">
          <label className="flex items-center gap-1">潛能
            <input type="number" min={0} max={5} value={s.potential} placeholder={String(decoded.draft?.potential ?? '滿')} onChange={(e) => patch({ potential: e.target.value })} className={`${INPUT} w-14`} />
          </label>
          <label className="flex items-center gap-1">科研
            <select value={s.research} onChange={(e) => patch({ research: e.target.value as GrowthAssumptions['research'] })} className={INPUT}>
              <option value="full">全開</option><option value="none">不計</option>
            </select>
          </label>
          <span className="flex items-center gap-1">改裝
            <select value={s.refit.mode} onChange={(e) => patch({ refit: { ...s.refit, mode: e.target.value as 'engine' | 'set' } })} className={INPUT}>
              <option value="engine">交給引擎</option><option value="set">每把相同</option>
            </select>
            {s.refit.mode === 'set' && (
              <>
                一般 <input type="number" min={0} max={8} value={s.refit.normal} onChange={(e) => patch({ refit: { ...s.refit, normal: Number(e.target.value) } })} className={`${INPUT} w-12`} />
                進階 <input type="number" min={0} max={4} value={s.refit.advanced} onChange={(e) => patch({ refit: { ...s.refit, advanced: Number(e.target.value) } })} className={`${INPUT} w-12`} />
              </>
            )}
          </span>
          <label className="flex items-center gap-1">攻擊段
            <select value={s.timing} onChange={(e) => patch({ timing: e.target.value as Persisted['timing'] })} className={INPUT}>
              <option value="auto">自動</option><option value="first">只算首擊</option><option value="firstPlusFollowUps">首擊＋追擊</option><option value="extraStrikeOnly">只算額外打擊</option>
            </select>
          </label>
          <label className="flex items-center gap-1">機率效果
            <select value={s.probability} onChange={(e) => patch({ probability: e.target.value as Persisted['probability'] })} className={INPUT}>
              <option value="expected">期望值</option><option value="always">必定發生</option><option value="never">不發生</option>
            </select>
          </label>
          <label className="flex items-center gap-1">結果層級
            <select value={s.level} onChange={(e) => patch({ level: e.target.value as Persisted['level'] })} className={INPUT}>
              <option value="L2">L2 完整拆解</option><option value="L1">L1</option>
            </select>
          </label>
          {s.level === 'L2' && (
            <label className="flex items-center gap-1"><input type="checkbox" checked={s.perHit} onChange={(e) => patch({ perHit: e.target.checked })} />逐擊明細</label>
          )}
        </div>
      </section>

      {/* ── 3. 目標 ── */}
      <section className={CARD}>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <h2 className="text-[14px] font-bold text-text-primary">3. 目標</h2>
          {!drafts && (
            <button type="button" className={BTN} disabled={draftsBusy} onClick={() => void loadDrafts()}>
              {draftsBusy ? '載入草稿中…' : '加入未發布的匯入草稿'}
            </button>
          )}
          {drafts && <span className="text-[11px] text-text-dim">已加入草稿 {drafts.drafts.length} 期</span>}
          {draftsError && <span className="text-[11px] text-accent-red">{draftsError}</span>}
          {catalog.length === 0 && !draftsBusy && <span className="text-[11px] text-text-dim">前台還沒有已發布的期；可加入草稿或改用手動</span>}
        </div>
        <SimTargetPicker catalog={catalog} value={s.target} onChange={(target) => patch({ target })} />
      </section>

      {/* ── 4. 動作與面板覆寫 ── */}
      <section className={CARD}>
        <h2 className="text-[14px] font-bold text-text-primary mb-2">4. 動作與面板</h2>
        <div className="space-y-1">
          {s.jobs.map((j, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-text-dim w-6">#{i + 1}</span>
              <select value={j.weaponKey} onChange={(e) => patch({ jobs: s.jobs.map((x, k) => (k === i ? { ...x, weaponKey: e.target.value } : x)) })} className={INPUT}>
                {(built?.weaponKeys ?? []).map((w) => <option key={w.key} value={w.key}>{weaponName(w.key)}</option>)}
              </select>
              <select value={j.skill} onChange={(e) => patch({ jobs: s.jobs.map((x, k) => (k === i ? { ...x, skill: e.target.value as SkillChoice } : x)) })} className={INPUT}>
                {(Object.keys(SKILL_LABEL) as SkillChoice[]).map((k) => <option key={k} value={k}>{SKILL_LABEL[k]}</option>)}
              </select>
              <button type="button" className={BTN} onClick={() => patch({ jobs: s.jobs.filter((_, k) => k !== i), measures: s.measures.filter((_, k) => k !== i) })}>移除</button>
            </div>
          ))}
          {built && built.weaponKeys.length > 0 && (
            <button type="button" className={BTN} onClick={() => patch({ jobs: [...s.jobs, { weaponKey: built.weaponKeys[0].key, skill: 'default' }] })}>＋ 動作</button>
          )}
        </div>

        <details className="mt-3" open={Object.keys(s.panel).length > 0}>
          <summary className="cursor-pointer text-[12px] text-text-secondary">
            面板覆寫（填遊戲內面板，排除面板差異；留空＝用引擎算的）{panelOverrides && <span className="text-accent-cyan ml-2">已填 {Object.keys(panelOverrides).length} 項</span>}
          </summary>
          <div className="mt-2 space-y-2 text-[12px] text-text-secondary">
            <div className="flex flex-wrap gap-2">
              {PILOT_PANEL.map((f) => (
                <label key={f.key} className="flex items-center gap-1">{f.label}
                  <input type="number" value={s.panel[f.key] ?? ''} placeholder={enginePanel[f.key] !== undefined ? String(enginePanel[f.key]) : ''} onChange={(e) => patch({ panel: { ...s.panel, [f.key]: e.target.value } })} className={`${INPUT} w-20`} />
                </label>
              ))}
            </div>
            {(built?.weaponKeys ?? []).map((w) => (
              <div key={w.key} className="flex flex-wrap items-center gap-2">
                <span className="text-text-dim min-w-[10rem]">{weaponName(w.key)}</span>
                {WEAPON_PANEL.map((f) => {
                  const k = `${f.prefix}:${w.key}`
                  return (
                    <label key={k} className="flex items-center gap-1">{f.label}
                      <input type="number" value={s.panel[k] ?? ''} placeholder={enginePanel[k] !== undefined ? String(enginePanel[k]) : ''} onChange={(e) => patch({ panel: { ...s.panel, [k]: e.target.value } })} className={`${INPUT} w-20`} />
                    </label>
                  )
                })}
              </div>
            ))}
            <div className="flex gap-2">
              <button type="button" className={BTN} disabled={Object.keys(enginePanel).length === 0} onClick={() => patch({ panel: Object.fromEntries(Object.entries(enginePanel).map(([k, v]) => [k, String(v)])) })}>以引擎面板填入</button>
              <button type="button" className={BTN} onClick={() => patch({ panel: {} })}>清空</button>
            </div>
          </div>
        </details>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!request || busy}
            onClick={() => void execute()}
            className="px-4 py-1.5 text-[13px] font-bold rounded border border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 disabled:opacity-40"
          >
            {busy ? '計算中…' : `計算 ${s.jobs.length} 個動作`}
          </button>
          {!request && <span className="text-[12px] text-text-dim">{!built?.loadout ? '先載入可送出的配裝' : !target.target ? target.reason ?? '先選目標' : '至少要一個動作'}</span>}
          {runError && <span className="text-[12px] text-accent-red">{runError}</span>}
          {run && <span className="text-[11px] text-text-dim">上次計算 {localTime(run.at)}・引擎 {run.response.engineVersion}・資料 {run.response.dataVersion}{stale && <span className="text-accent-yellow">・輸入已變更，結果是舊的</span>}</span>}
        </div>
      </section>

      {/* ── 5. 結果、實測與誤差 ── */}
      {run && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[14px] font-bold text-text-primary">5. 結果與實測</h2>
            {isAdminResult
              ? <span className="text-[12px] text-accent-green">管理者通道：含完整拆解</span>
              : downgraded
                ? <span className="text-[12px] text-accent-yellow">未通過管理者驗證，結果停在 L1（Worker 還沒設定允許名單，或登入已過期——重新整理再試）</span>
                : null}
          </div>
          {run.response.results.map((r, i) => {
            const a = run.request.jobs[i]?.action
            return (
              <SimJobCard
                key={i}
                index={i}
                title={a ? `${weaponName(a.weaponKey)}・${typeof a.skill === 'string' ? SKILL_LABEL[a.skill] : `技能 #${a.skill}`}` : `job ${i}`}
                result={r}
                measure={s.measures[i] ?? emptyMeasure()}
                onMeasure={(m) => setMeasure(i, m)}
                names={names}
                panelOverridden={run.request.loadouts[0]?.panelOverrides !== undefined}
              />
            )
          })}

          {/* ── 6. 匯出案例 ── */}
          <div className={CARD}>
            <h2 className="text-[14px] font-bold text-text-primary mb-2">6. 匯出案例</h2>
            <div className="flex flex-wrap gap-2 items-center">
              <input value={s.title} onChange={(e) => patch({ title: e.target.value })} placeholder={target.label || '案例標題'} className={`${INPUT} flex-1 min-w-[16rem]`} />
              <button type="button" className={BTN} onClick={exportCase}>下載案例檔</button>
            </div>
            <textarea value={s.note} onChange={(e) => patch({ note: e.target.value })} rows={2} placeholder="備註（實測條件、截圖存放處…）" className={`${INPUT} w-full mt-2`} />
            <div className="mt-1 text-[11px] text-text-dim">
              下載的 JSON 放進私有 repo <code>mecharashi-sim</code> 的 <code>tests/regression/</code>；截圖與錄影留在本機，不放進任何 repo。
              {stale && <span className="text-accent-yellow ml-2">⚠ 輸入在上次計算後改過，案例會記錄上次計算時的請求</span>}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
