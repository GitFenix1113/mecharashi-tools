import { useMemo, useState, useEffect } from 'react'
import type { EntityRef, RefType, DescriptionRefs } from '../../types'
import { useGameData, type CollectionKey } from '../../contexts/GameDataContext'
import { STAT_LABELS } from '../../utils/moduleStats'
import { RefText } from '../RefText'

/**
 * PLAN-019-C — 引用挑選器（後台填值 UI）。
 *
 * 給定一段描述文字 + 現有 descriptionRefs，自動 tokenize 出所有 [xxx]，
 * 讓維護者逐 token 指派要連到哪個實體（refType + refId）。候選清單直接讀
 * GameDataContext 的 in-memory 陣列 + STAT_LABELS；選定後寫回 descriptionRefs。
 * 旁附 RefText 即時預覽。讓非工程人員也能把描述裡的 [xxx] 標成可點引用。
 */

const REF_TYPE_OPTIONS: { value: RefType; label: string }[] = [
  { value: 'term',      label: '詞條 term' },
  { value: 'buff',      label: 'BUFF / 狀態 buff' },
  { value: 'skill',     label: '技能 skill' },
  { value: 'stat',      label: '屬性 stat' },
  { value: 'pilot',     label: '機師 pilot' },
  { value: 'mech',      label: '機甲 mech' },
  { value: 'weapon',    label: '武器 weapon' },
  { value: 'module',    label: '模組 module' },
  { value: 'backpack',  label: '背包 backpack' },
  { value: 'component', label: '元件 component' },
]

const REF_TYPE_LABEL: Record<RefType, string> = {
  buff: 'BUFF', skill: '技能', pilot: '機師', mech: '機甲', weapon: '武器',
  module: '模組', backpack: '背包', component: '元件', stat: '屬性', term: '詞條',
}

const REF_TO_COLLECTION: Partial<Record<RefType, CollectionKey>> = {
  pilot: 'pilots', mech: 'mechs', weapon: 'weapons', module: 'modules',
  backpack: 'backpacks', component: 'components', buff: 'buffs',
  skill: 'pilotSkills', term: 'glossaryTerms',
}

interface Candidate { id: string; name: string }

/** 取出描述中所有不重複的 [xxx] token（保留出現順序）。 */
function extractTokens(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /\[([^\]]+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]) }
  }
  return out
}

/** 依 refType 從 GameData 取候選實體（並懶載對應集合）。 */
function useCandidates(refType: RefType | ''): Candidate[] {
  const gd = useGameData()
  const collectionKey = refType ? REF_TO_COLLECTION[refType] : undefined
  useEffect(() => { if (collectionKey) gd.ensureLoaded([collectionKey]) }, [collectionKey, gd])

  return useMemo(() => {
    switch (refType) {
      case 'pilot':     return gd.pilots.map(p => ({ id: p.id, name: p.name }))
      case 'mech':      return gd.mechs.map(m => ({ id: m.id, name: m.name }))
      case 'weapon':    return gd.weapons.map(w => ({ id: w.id, name: w.name }))
      case 'module':    return gd.modules.map(m => ({ id: m.id, name: m.name }))
      case 'backpack':  return gd.backpacks.map(b => ({ id: b.id, name: b.name }))
      case 'component': return gd.components.map(c => ({ id: c.id, name: c.name }))
      case 'buff':      return gd.buffs.map(b => ({ id: b.id, name: b.name }))
      case 'skill':     return gd.pilotSkills.map(s => ({ id: s.id, name: s.name }))
      case 'term':      return gd.glossaryTerms.map(t => ({ id: t.id, name: t.name }))
      case 'stat':      return STAT_LABELS.map(s => ({ id: s.key, name: s.label }))
      default:          return []
    }
  }, [refType, gd.pilots, gd.mechs, gd.weapons, gd.modules, gd.backpacks, gd.components, gd.buffs, gd.pilotSkills, gd.glossaryTerms])
}

// ── 單一 token 的指派列 ────────────────────────────────────────────────────────
function TokenRow({
  token,
  assigned,
  onAssign,
  onClear,
}: {
  token: string
  assigned?: EntityRef
  onAssign: (ref: EntityRef) => void
  onClear: () => void
}) {
  const [open, setOpen]           = useState(false)
  const [pickerType, setPickerType] = useState<RefType | ''>(assigned?.refType ?? 'term')
  const [search, setSearch]       = useState('')

  const candidates = useCandidates(open ? pickerType : '')
  // 已指派實體所屬集合一律載入，使收合狀態的 chip 也能顯示名稱
  const assignedCandidates = useCandidates(assigned?.refType ?? '')

  // 已指派實體的顯示名稱（載入後查得到，查不到則退回 refId）
  const assignedName = useMemo(() => {
    if (!assigned) return ''
    const hit = assignedCandidates.find(c => c.id === assigned.refId)
    return hit?.name ?? assigned.refId
  }, [assigned, assignedCandidates])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? candidates.filter(c => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
      : candidates
    return list.slice(0, 50)
  }, [candidates, search])

  return (
    <div className="bg-bg-dark border border-border/60 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-accent-purple text-sm">[{token}]</span>
        <span className="text-text-dim text-xs">→</span>
        {assigned ? (
          <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border border-accent-cyan/30 bg-accent-cyan/10 text-accent-cyan">
            {REF_TYPE_LABEL[assigned.refType]} · {assignedName}
          </span>
        ) : (
          <span className="text-xs text-text-dim">未指派（前台原樣顯示 [{token}]）</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {assigned && (
            <button
              type="button"
              onClick={onClear}
              className="text-[12px] text-accent-red hover:text-accent-red/80"
            >清除</button>
          )}
          <button
            type="button"
            onClick={() => { setOpen(o => !o); setSearch('') }}
            className="text-[12px] text-accent-cyan hover:text-accent-cyan/80"
          >{open ? '收合' : assigned ? '變更' : '指派引用'}</button>
        </div>
      </div>

      {open && (
        <div className="mt-2.5 space-y-2">
          <div className="flex gap-2">
            <select
              value={pickerType}
              onChange={(e) => { setPickerType(e.target.value as RefType); setSearch('') }}
              className="input-field text-xs max-w-[160px]"
            >
              {REF_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋名稱 / ID…"
              className="input-field text-xs flex-1"
            />
          </div>
          <div className="max-h-40 overflow-y-auto rounded border border-border/40 divide-y divide-border/30">
            {filtered.length === 0 ? (
              <p className="text-xs text-text-dim text-center py-3">
                {pickerType ? '查無候選（集合載入中或無資料）' : '請先選擇引用類型'}
              </p>
            ) : filtered.map(c => {
              const active = assigned?.refType === pickerType && assigned?.refId === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onAssign({ refType: pickerType as RefType, refId: c.id }); setOpen(false) }}
                  className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-bg-card transition-colors flex items-center gap-2 ${active ? 'text-accent-cyan' : 'text-text-secondary'}`}
                >
                  <span className="flex-1 truncate">{c.name || <span className="text-text-dim">（未命名）</span>}</span>
                  <span className="text-text-dim font-mono text-[11px] truncate max-w-[45%]">{c.id}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── RefPicker 主體 ─────────────────────────────────────────────────────────────
export function RefPicker({
  text,
  value,
  onChange,
}: {
  text: string
  value?: DescriptionRefs
  onChange: (refs: DescriptionRefs) => void
}) {
  const tokens = useMemo(() => extractTokens(text || ''), [text])
  const refs = value ?? {}

  function assign(token: string, ref: EntityRef) {
    onChange({ ...refs, [token]: ref })
  }
  function clear(token: string) {
    const next = { ...refs }
    delete next[token]
    onChange(next)
  }

  const assignedCount = tokens.filter(t => refs[t]).length

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-text-dim font-medium uppercase tracking-wider">
          引用標記 descriptionRefs
        </span>
        {tokens.length > 0 && (
          <span className="text-[12px] text-text-dim">
            已指派 <span className={assignedCount === tokens.length ? 'text-accent-green' : 'text-accent-yellow'}>{assignedCount}</span> / {tokens.length}
          </span>
        )}
      </div>

      {tokens.length === 0 ? (
        <p className="text-xs text-text-dim py-2 text-center">
          描述中沒有 <code>[xxx]</code> 標記；在上方描述加入方括號詞即可在此指派引用。
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            {tokens.map(token => (
              <TokenRow
                key={token}
                token={token}
                assigned={refs[token]}
                onAssign={(ref) => assign(token, ref)}
                onClear={() => clear(token)}
              />
            ))}
          </div>

          {/* 即時預覽 */}
          <div className="mt-2 rounded-lg bg-bg-dark/60 border border-border/40 px-3 py-2">
            <div className="text-[11px] text-text-dim mb-1 uppercase tracking-wider">前台預覽</div>
            <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
              <RefText text={text} refs={refs} />
            </p>
          </div>
        </>
      )}
    </div>
  )
}
