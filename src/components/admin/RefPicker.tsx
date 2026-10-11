import { useMemo, useState, useEffect, useRef, type ReactNode } from 'react'
import type { EntityRef, RefType, DescriptionRefs } from '../../types'
import { useGameData, type CollectionKey } from '../../contexts/GameDataContext'
import { STAT_LABELS } from '../../utils/moduleStats'
import { RefText } from '../refs/RefText'
import { compileSugar, orderRefsByFirstMention, detectLeftoverSugar, NUM_ATTRS } from '../../utils/numRefs'
import {
  splitRefKey, formatRefKey, countKeywordOccurrences, findOrphanRefKeys,
  renameKeyword, renameRefEntry, nextLevel,
} from '../../utils/refKey'
import { RefOccurrenceText, type OccurrenceSel } from './RefOccurrenceText'

// PLAN-022 Phase C：語法糖速查（registry 驅動）。$n=可疊加層數、%n=持續回合，n=已指派 [xxx] 的首次出現序。
const SIGIL_HINTS = Object.values(NUM_ATTRS)
  .filter((d) => !!d.sigil)
  .map((d) => `${d.sigil}n = ${d.label}`)

/**
 * PLAN-019-C — 引用挑選器（後台填值 UI）。
 *
 * 給定一段描述文字 + 現有 descriptionRefs，自動 tokenize 出所有 [xxx]，
 * 讓維護者逐 token 指派要連到哪個實體（refType + refId）。候選清單直接讀
 * GameDataContext 的 in-memory 陣列 + STAT_LABELS；選定後寫回 descriptionRefs。
 * 旁附 RefText 即時預覽。讓非工程人員也能把描述裡的 [xxx] 標成可點引用。
 */

const REF_TYPE_OPTIONS: { value: RefType; label: string }[] = [
  { value: 'term',       label: '詞條 term' },
  { value: 'buff',       label: 'BUFF / 狀態 buff' },
  { value: 'skill',      label: '技能 skill' },
  { value: 'neuralDrive', label: '神經驅動 neuralDrive' },
  { value: 'stat',       label: '屬性 stat' },
  { value: 'pilot',      label: '機師 pilot' },
  { value: 'mech',       label: '機甲 mech' },
  { value: 'weapon',     label: '武器 weapon' },
  { value: 'module',     label: '模組 module' },
  { value: 'backpack',   label: '背包 backpack' },
  { value: 'component',  label: '元件 component' },
  // PLAN-041：這個陣列是**手寫**的，不是從 REF_TYPE_LABEL derive——漏一筆不會有任何
  // 編譯錯誤，症狀是「後台的引用型別下拉選單裡根本選不到它」，只能靠腳本改資料。
  { value: 'form',       label: '形態 form' },
]

const REF_TYPE_LABEL: Record<RefType, string> = {
  buff: 'BUFF', skill: '技能', pilot: '機師', mech: '機甲', weapon: '武器',
  module: '模組', backpack: '背包', component: '元件', stat: '屬性', term: '詞條', neuralDrive: '神經驅動',
  form: '形態',
}

const REF_TO_COLLECTION: Partial<Record<RefType, CollectionKey>> = {
  pilot: 'pilots', mech: 'mechs', weapon: 'weapons', module: 'modules',
  backpack: 'backpacks', component: 'components', buff: 'buffs',
  skill: 'pilotSkills', term: 'glossaryTerms', neuralDrive: 'neuralDriveAbilities',
  form: 'forms',
}

interface Candidate { id: string; name: string }

/**
 * 取出描述中所有不重複的 [xxx] token（保留出現順序）。
 * Map 保留插入序，故與原先自行 tokenize 的行為完全相同——tokenizer 收斂到 refKey 一處（PLAN-039）。
 */
const extractTokens = (text: string): string[] => [...countKeywordOccurrences(text).keys()]

/**
 * 多段正文面板的段落定義（PLAN-057）。與 RefPicker 的 `text` 陣列**逐索引對齊**。
 */
export interface RefTextSection {
  /** 段落名稱，如「初始」「最大強化」 */
  label: string
  /**
   * 「依段落分開指派」產生的消歧後綴（PLAN-057 B）。有值才提供該段的一鍵分開按鈕。
   * 用段落語意命名（強化 / 專武），**不要用序號**——理由見 refKey.ts 開頭。
   */
  splitKey?: string
}

/**
 * key 色票（PLAN-057 A）。依 key 首次出現序循環取用；正文標註檢視與引用清單列用同一色，兩邊一眼對得上。
 * 同顯示字的兩個 key（[鋒勢] / [鋒勢|強化]）因此落在不同色——這正是此檢視要讓人看見的東西。
 * 必須是完整的字面 class 字串（Tailwind 只掃描字面值，不能用模板字串拼）。
 */
const KEY_COLORS = [
  'border-accent-purple/50 bg-accent-purple/15 text-accent-purple',
  'border-accent-cyan/50 bg-accent-cyan/15 text-accent-cyan',
  'border-accent-orange/50 bg-accent-orange/15 text-accent-orange',
  'border-accent-green/50 bg-accent-green/15 text-accent-green',
  'border-accent-pink/50 bg-accent-pink/15 text-accent-pink',
  'border-accent-yellow/50 bg-accent-yellow/15 text-accent-yellow',
  'border-accent-blue/50 bg-accent-blue/15 text-accent-blue',
  'border-accent-red/50 bg-accent-red/15 text-accent-red',
] as const

/** 改 key 的範圍。section / occurrence 皆省略＝全部出現處。 */
interface RenameScope { section?: number; occurrence?: number }

/** 消歧後綴不可含的字元：括號會破壞 token 邊界、'|' 會多切一刀、#$% 是語法糖 sigil、<> 是數值 token */
const SUFFIX_FORBIDDEN = /[[\]|#$%<>\s]/g

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
      case 'neuralDrive': return gd.neuralDriveAbilities.map(a => ({ id: a.id, name: a.name }))
      case 'form':      return gd.forms.map(f => ({ id: f.id, name: f.name }))
      case 'stat':      return STAT_LABELS.map(s => ({ id: s.key, name: s.label }))
      default:          return []
    }
  }, [refType, gd.pilots, gd.mechs, gd.weapons, gd.modules, gd.backpacks, gd.components, gd.buffs, gd.pilotSkills, gd.glossaryTerms, gd.neuralDriveAbilities, gd.forms])
}

// ── 單一 token 的指派列 ────────────────────────────────────────────────────────
function TokenRow({
  token,
  assigned,
  onAssign,
  onClear,
  colorClass,
  countsLabel,
  selected,
  onSelect,
  children,
}: {
  token: string
  assigned?: EntityRef
  onAssign: (ref: EntityRef) => void
  onClear: () => void
  /** PLAN-057：與正文標註檢視同一色，兩邊對得上 */
  colorClass: string
  /** 出現位置摘要，如「初始 2 · 最大強化 0」 */
  countsLabel?: string
  selected: boolean
  onSelect: () => void
  /** 選取時展開的工具（改 key / 依段落分開指派） */
  children?: ReactNode
}) {
  const [open, setOpen]           = useState(false)
  const [pickerType, setPickerType] = useState<RefType | ''>(assigned?.refType ?? 'term')
  const [search, setSearch]       = useState('')

  // 從正文點膠囊選到這一列時，把它捲進視野（清單可能在正文下方很遠）
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])

  // PLAN-039：token 可能是帶消歧後綴的 key（'駐陣|skill'）。列標題顯示前台實際看到的字，
  // 後綴另掛徽章——兩列同名並排時，一眼看得出「這是同一個詞的第二種語意」。
  const { display, disambig } = splitRefKey(token)

  const gd = useGameData()
  const candidates = useCandidates(open ? pickerType : '')
  // 已指派實體所屬集合一律載入，使收合狀態的 chip 也能顯示名稱
  const assignedCandidates = useCandidates(assigned?.refType ?? '')

  // 階梯 buff（PLAN-024）：指派為帶 levels 的 buff 時，提供「引用哪一級」下拉 → 寫進 ref.level。
  const buffLevels = useMemo(() => {
    if (assigned?.refType !== 'buff') return []
    return (gd.buffs.find((b) => b.id === assigned.refId)?.levels ?? []).map((l) => l.level)
  }, [assigned, gd.buffs])

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
    <div
      ref={rowRef}
      className={`bg-bg-dark border rounded-lg px-3 py-2.5 ${selected ? 'border-text-primary/40 ring-1 ring-text-primary/30' : 'border-border/60'}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onSelect}
          className={`font-semibold text-sm px-1.5 rounded border cursor-pointer hover:brightness-125 ${colorClass} ${assigned ? '' : 'border-dashed'}`}
          title="在正文中標出這筆引用的所有出現處"
        >[{display}]</button>
        {disambig && (
          <span
            className="text-[10px] font-mono text-text-dim"
            title={`同名消歧鍵：此標記在資料中的 key 為「${token}」，前台顯示時會剝除後綴`}
          >key：{token}</span>
        )}
        {countsLabel && <span className="text-[11px] text-text-dim">{countsLabel}</span>}
        <span className="text-text-dim text-xs">→</span>
        {assigned ? (
          <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border border-accent-cyan/30 bg-accent-cyan/10 text-accent-cyan">
            {REF_TYPE_LABEL[assigned.refType]} · {assignedName}
          </span>
        ) : (
          // 前台的未命中降級也會剝後綴（PLAN-039 A-3），故此處顯示 display 而非完整 key
          <span className="text-xs text-text-dim">未指派（前台原樣顯示 [{display}]）</span>
        )}
        {assigned && buffLevels.length > 0 && (
          <select
            value={assigned.level ?? ''}
            onChange={(e) => onAssign({ ...assigned, level: e.target.value === '' ? undefined : Number(e.target.value) })}
            className="text-[11px] bg-bg-card border border-border rounded px-1.5 py-0.5 text-text-secondary focus:outline-none focus:border-accent-cyan"
            title="引用此階梯 buff 的哪一級（數值代入時產生 .lvN）"
          >
            <option value="">不限級</option>
            {buffLevels.map((lv) => <option key={lv} value={lv}>Lv{lv}</option>)}
          </select>
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

      {selected && children}
    </div>
  )
}

// ── 改 key 工具（PLAN-057 A / B）──────────────────────────────────────────────
// 取代 PLAN-039 的頂部「同名引用標記」面板。舊面板有三個問題：已消歧過的 key 仍被報成重複、
// 預設後綴一律 skill、只能改「各段的第 N 處」——做不到「最大強化段整段換一個 key」。
// 改成掛在被選取的那一筆引用底下：先選到詞，再決定要拆哪些出現處。
function KeyTools({
  token,
  sel,
  counts,
  sections,
  refs,
  assigned,
  buffLevels,
  blocked,
  isLive,
  onRename,
}: {
  token: string
  sel: OccurrenceSel
  /** 各段的出現次數（與 sections 逐索引對齊） */
  counts: number[]
  sections: RefTextSection[]
  refs: DescriptionRefs
  assigned?: EntityRef
  /** 已指派為階梯 buff 時的可用等級（B 的自動 +1 級用） */
  buffLevels: number[]
  /** 仍有未代入的語法糖：改 key 會改變 $n 的編號基準（PLAN-039 決策五） */
  blocked: boolean
  /** key 是否仍有正文在用；否＝殘留引用（改 key 併入時的規則不同，見 RefPicker.rename） */
  isLive: (key: string) => boolean
  onRename: (from: string, to: string, scope: RenameScope, opts: { carry: boolean; level?: number }) => void
}) {
  const { display, disambig } = splitRefKey(token)
  const [suffix, setSuffix] = useState(disambig ?? '')
  const target = formatRefKey(display, suffix)
  const total = counts.reduce((a, b) => a + b, 0)
  const multi = counts.length > 1
  const targetExists = target !== token && !!refs[target]
  const targetIsOrphan = targetExists && !isLive(target)

  // B：依段落分開指派。只在「這段有、別段也有」時才有意義——只出現在單一段的 key 本來就是獨立的
  const splits = sections.flatMap((sec, i) => {
    if (!sec.splitKey || !counts[i] || total === counts[i]) return []
    const to = formatRefKey(display, sec.splitKey)
    if (to === token) return []
    const bumped = assigned?.refType === 'buff' ? nextLevel(assigned.level, buffLevels) : undefined
    return [{ i, label: sec.label, to, n: counts[i], bumped }]
  })

  const btn = 'px-2 py-0.5 rounded border text-[11px] disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="mt-2.5 pt-2.5 border-t border-border/40 space-y-2.5 text-[11px]">
      {splits.map(({ i, label, to, n, bumped }) => (
        <div key={i} className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={blocked}
            onClick={() => onRename(token, to, { section: i }, { carry: true, level: bumped })}
            className={`${btn} border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20`}
          >「{label}」段分開指派（{n} 處）</button>
          <span className="text-text-dim">
            → <code className="text-text-secondary">[{to}]</code>
            {refs[to] && isLive(to)
              ? '，併入既有設定'
              : assigned
                ? `，沿用目前目標${bumped !== undefined ? `、等級 Lv${assigned.level ?? '—'} → Lv${bumped}` : ''}`
                : '，待指派'}
          </span>
        </div>
      ))}

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-text-dim">改 key：</span>
          <code className="text-text-secondary">[{display}|</code>
          <input
            value={suffix}
            onChange={(e) => setSuffix(e.target.value.replace(SUFFIX_FORBIDDEN, ''))}
            placeholder="留空＝不帶後綴"
            // 與 TokenRow 的 buff 級數下拉同一組緊湊樣式（行內小控件，不用 .input-field 的表單尺寸）
            className="w-28 text-[11px] bg-bg-card border border-border rounded px-1.5 py-0.5 text-text-primary focus:outline-none focus:border-accent-cyan"
          />
          <code className="text-text-secondary">]</code>
          {sel.section !== undefined && sel.occurrence !== undefined && total >= 2 && (
            <button
              type="button"
              disabled={blocked || target === token}
              onClick={() => onRename(token, target, { section: sel.section, occurrence: sel.occurrence }, { carry: false })}
              className={`${btn} border-accent-orange/40 bg-accent-orange/10 text-accent-orange hover:bg-accent-orange/20`}
              title="只改寫你在正文點到的那一處；新 key 留白待指派"
            >只改這一處</button>
          )}
          {multi && sel.section !== undefined && counts[sel.section] > 0 && counts[sel.section] < total && (
            <button
              type="button"
              disabled={blocked || target === token}
              onClick={() => onRename(token, target, { section: sel.section }, { carry: false })}
              className={`${btn} border-accent-orange/40 bg-accent-orange/10 text-accent-orange hover:bg-accent-orange/20`}
              title="只改寫這一段的所有出現處；新 key 留白待指派"
            >只改「{sections[sel.section]?.label}」段（{counts[sel.section]}）</button>
          )}
          <button
            type="button"
            disabled={blocked || target === token}
            onClick={() => onRename(token, target, {}, { carry: true })}
            className={`${btn} border-accent-orange/40 bg-accent-orange/10 text-accent-orange hover:bg-accent-orange/20`}
            title="改寫所有出現處，目前的指派一併帶過去"
          >全部改（{total}）</button>
        </div>
        <div className="text-text-dim leading-relaxed">
          key 只供後台區分，前台一律顯示 <code>[{display}]</code>。
          {targetIsOrphan ? (
            <span className="text-accent-yellow">
              {' '}<code>[{target}]</code> 目前是殘留引用：「全部改」會以這筆的設定取代它；只改部分出現處則沿用它的舊設定。
            </span>
          ) : targetExists ? (
            <span className="text-accent-yellow"> <code>[{target}]</code> 已存在 → 會併入它、沿用它的設定。</span>
          ) : ' 改成已存在的 key 會併入它、沿用它的設定。'}
        </div>
        {blocked && (
          <div className="text-accent-yellow">← 請先代入下方的數值語法糖（改 key 會改變 $n 的編號基準）</div>
        )}
      </div>
    </div>
  )
}

// ── 孤兒引用列（PLAN-039 follow-up）────────────────────────────────────────────
// 正文已不存在的殘留 key。與 TokenRow 刻意不共用：孤兒沒有「指派 / 變更」語意
// （正文裡根本沒有這個標記可指），能做的只有清除；沿用 TokenRow 會讓維護者
// 以為可以把它改指到別的實體，而那只會再留一筆看不見的殘留。
function OrphanRow({ token, entry, onClear }: {
  token: string
  entry: EntityRef
  onClear: () => void
}) {
  const candidates = useCandidates(entry.refType)
  const name = candidates.find((c) => c.id === entry.refId)?.name ?? entry.refId
  const { display, disambig } = splitRefKey(token)

  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px] pt-1.5 border-t border-accent-red/15">
      <span className="font-semibold text-text-dim line-through">[{display}]</span>
      {disambig && <span className="font-mono text-accent-orange">|{disambig}</span>}
      <span className="text-text-dim">→</span>
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-border/60 bg-bg-card text-text-dim">
        {REF_TYPE_LABEL[entry.refType]} · {name}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto px-2 py-0.5 rounded border border-accent-red/40 bg-accent-red/10 text-accent-red hover:bg-accent-red/20"
        title={`從 descriptionRefs 移除 key「${token}」（存檔後生效）`}
      >清除殘留</button>
    </div>
  )
}

// ── RefPicker 主體 ─────────────────────────────────────────────────────────────
export function RefPicker({
  text,
  sections,
  siblingTexts,
  value,
  onChange,
  onCompileText,
}: {
  /**
   * 正文。多欄位面板（天賦的 description + descriptionMax）**應傳陣列**：
   * join 後的單一字串無法分辨「同一個 [xxx] 在兩個版本各出現一次」與「在同一版本出現兩次」，
   * 而改 key 的「只改這一段」必須知道每一處落在哪一段（PLAN-057）。傳字串 = 單段，既有行為不變。
   * 陣列元素可為 undefined（選填欄位如 descriptionMax 直接傳即可）；**索引保持對齊**，
   * 空段只是不顯示——transform 的 part 參數靠的就是這個索引。
   */
  text: string | (string | undefined)[]
  /**
   * 各段的名稱與「依段落分開指派」後綴（PLAN-057），與 `text` 逐索引對齊。
   * 未傳時多段面板顯示「第 N 段」，且不提供一鍵分開。
   */
  sections?: RefTextSection[]
  /**
   * 共用同一份 `value`、但**不在本面板編輯**的正文。只用於孤兒偵測（含改 key 後判斷舊 key 是否還有人用）。
   *
   * 全站有兩種共用型態，漏傳就會把活引用誤報成殘留（而使用者一按清除就真的刪掉）：
   *   · 子項未填 refs 時回退父層 —— 模組 / BUFF / 背包技能的 `levels[].description`
   *   · 唯讀的姊妹欄位 —— 技能的 `enhancedTalentDescription`（PLAN-032 決策七）
   * 判不準時寧可多傳：多傳只會少報幾筆孤兒，少傳會讓維護者刪錯東西。
   */
  siblingTexts?: (string | undefined)[]
  value?: DescriptionRefs
  onChange: (refs: DescriptionRefs) => void
  /**
   * **正文改寫管道**：RefPicker 算出一個 transform，交給消費端對自己擁有的各正文欄位
   * （如 description / descriptionMax）分別套用 —— 邏輯集中、消費端只接一行。
   * 未傳則相關按鈕不顯示（既有面板零回歸）。
   *
   *   · `part`：該正文在 `text` 陣列中的索引。多段消費端**必須逐段傳入**（`tf(descriptionMax, 1)`），
   *     否則「只改這一段」會改到每一段；單段消費端可省略（視為 0）。
   *   · `nextRefs`：改 key 會同時改正文與引用表（PLAN-057）。有值時**必須與正文在同一次更新寫入**——
   *     天賦編輯器的 `upd` 是 `onChange({ ...talent, ... })` 的閉包，分兩次呼叫的話後一次會蓋掉前一次。
   *
   * 用途：① PLAN-022 Phase C 語法糖代入；② PLAN-057 改 key / 依段落分開指派。
   * 名稱沿用 compile 是歷史因素；它描述的是機制（交出 transform）而非特定用途。
   */
  onCompileText?: (transform: (s: string, part?: number) => string, nextRefs?: DescriptionRefs) => void
}) {
  // 陣列 → 各段（索引對齊、空段為 ''）；字串 → 單段。joined 供 tokenize / 語法糖 / 預覽沿用既有邏輯。
  const parts  = useMemo(
    () => (Array.isArray(text) ? text.map((s) => s ?? '') : [text || '']),
    [text],
  )
  const joined = useMemo(() => parts.filter(Boolean).join('\n'), [parts])

  const tokens = useMemo(() => extractTokens(joined), [joined])
  const refs = value ?? {}
  const gd = useGameData()

  function assign(token: string, ref: EntityRef) {
    onChange({ ...refs, [token]: ref })
  }
  function clear(token: string) {
    const next = { ...refs }
    delete next[token]
    onChange(next)
  }

  const assignedCount = tokens.filter(t => refs[t]).length

  // ── PLAN-022 Phase C：數值語法糖代入 ───────────────────────────────────────────
  // orderedRefs：已指派 [xxx] 依首次出現序的 refId 清單，作為 $n/%n 的 n 對照（對齊 numbered 顯示）。
  const orderedRefs   = useMemo(() => orderRefsByFirstMention(joined, value ?? {}), [joined, value])
  const leftoverSugar = useMemo(() => detectLeftoverSugar(joined), [joined])
  const numberedRefs  = useMemo(
    () => tokens.filter(t => (value ?? {})[t]).map((t, i) => ({ n: i + 1, token: t })),
    [tokens, value],
  )
  const [previewing, setPreviewing] = useState(false)

  // ── PLAN-057：標註檢視與改 key ────────────────────────────────────────────────
  const secs: RefTextSection[] = parts.map((_, i) => sections?.[i] ?? { label: `第 ${i + 1} 段` })
  const multi = parts.length > 1
  const partCounts = useMemo(() => parts.map((p) => countKeywordOccurrences(p)), [parts])
  const countsOf = (key: string) => partCounts.map((m) => m.get(key) ?? 0)
  const colorIndex = useMemo(() => new Map(tokens.map((t, i) => [t, i])), [tokens])
  const colorOf = (key: string) => KEY_COLORS[(colorIndex.get(key) ?? 0) % KEY_COLORS.length]
  const [sel, setSel] = useState<OccurrenceSel | null>(null)
  // 改 key / 清掉正文後，選取的 key 可能已不在正文裡 → 視同未選取
  const activeSel = sel && tokens.includes(sel.key) ? sel : null
  // 改 key 會改變 orderRefsByFirstMention 的編號基準 → 未代入的 $n 會指到錯誤的引用（PLAN-039 決策五）
  const renameBlocked = leftoverSugar.length > 0

  function countsLabel(key: string): string | undefined {
    const c = countsOf(key)
    if (multi) return secs.map((s, i) => (parts[i] ? `${s.label} ${c[i]}` : null)).filter(Boolean).join(' · ')
    return c[0] > 1 ? `出現 ${c[0]} 次` : undefined
  }

  function levelsOf(ref?: EntityRef): number[] {
    if (ref?.refType !== 'buff') return []
    return (gd.buffs.find((b) => b.id === ref.refId)?.levels ?? []).map((l) => l.level)
  }

  /** key 是否仍有正文在用（本面板各段＋共用同一份引用表的姊妹正文）。否＝殘留引用。 */
  const isLive = (key: string) =>
    [...parts, ...(siblingTexts ?? [])].some((t) => !!t && t.includes(`[${key}]`))

  function rename(from: string, to: string, scope: RenameScope, opts: { carry: boolean; level?: number }) {
    if (!onCompileText || from === to) return
    const tf = (s: string, part = 0) =>
      scope.section === undefined || scope.section === part ? renameKeyword(s, from, to, scope.occurrence) : s
    const after = parts.map((p, i) => tf(p, i))
    const fromStillUsed = [...after, ...(siblingTexts ?? [])].some((t) => !!t && t.includes(`[${from}]`))
    // 目標只是殘留引用時，「搬家」要以來源的設定取代它——殘留是死資料，來源才是維護者正在用的。
    // 實際案例：珂賽特把 [鋒勢|buff_1]（Lv1）改回 [鋒勢]，而 [鋒勢] 是拆分前留下、沒設等級的殘留；
    // 照「併入既有」的規則，Lv1 會被它默默蓋掉。只拆出一部分（carry=false）則沿用殘留——那通常是想找回舊設定。
    const base = { ...refs }
    if (opts.carry && to in base && !isLive(to)) delete base[to]
    onCompileText(tf, renameRefEntry(base, from, to, { ...opts, fromStillUsed }))
    setSel({ key: to, section: scope.section })
  }

  // ── 孤兒引用：refs 有、正文沒有 ───────────────────────────────────────────────
  // siblingTexts 一併納入判斷（見 prop 說明）。join 成字串當 deps：呼叫端多半直接寫
  // 陣列字面量，用陣列本身當 deps 等於每次 render 都重算。
  const siblingKey = (siblingTexts ?? []).filter(Boolean).join('\n')
  const orphanKeys = useMemo(
    () => findOrphanRefKeys([...parts, siblingKey], refs),
    // refs 是 `value ?? {}`，未指派時每次 render 都是新物件 → 用 value 當 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parts, siblingKey, value],
  )

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

      {/* 殘留引用：正文改字後留下的死 key。放在 tokens 判斷之外——正文的標記全被刪光時
          殘留反而最多，而那正是最需要看見它的時候。 */}
      {orphanKeys.length > 0 && (
        <div className="rounded-lg border border-accent-red/30 bg-accent-red/5 px-3 py-2.5 space-y-1">
          <div className="text-[12px] font-semibold text-accent-red">
            🧹 殘留引用 {orphanKeys.length} 筆（正文中已無此標記）
          </div>
          <div className="text-[11px] text-text-dim leading-relaxed">
            清除後需<strong className="text-text-secondary">按下儲存</strong>才會寫回資料庫。
            專武強化敘述、其他等級的文本若共用這份引用表，清除前先確認那邊沒有用到。
            {/* PLAN-057 C：長說明收合——每次開面板都要讀完一整段，真正要做的決定反而被淹沒 */}
            <details className="mt-1">
              <summary className="cursor-pointer select-none hover:text-text-secondary">為什麼會有殘留？</summary>
              <div className="mt-1">
                引用表的 key 就是括號內的字，所以<strong className="text-text-secondary">改動標記用字等於換一個 key</strong>
                （如 <code>[機兵型態]</code> → <code>[機兵形態]</code>），舊那筆會留下來且不會出現在下面的清單裡。
                殘留本身不影響前台顯示，但<strong className="text-text-secondary">刪除該實體時仍會被算成一處引用</strong>。
              </div>
            </details>
          </div>
          {orphanKeys.map((key) => (
            <OrphanRow key={key} token={key} entry={refs[key]} onClear={() => clear(key)} />
          ))}
        </div>
      )}

      {tokens.length === 0 ? (
        <p className="text-xs text-text-dim py-2 text-center">
          描述中沒有 <code>[xxx]</code> 標記；在上方描述加入方括號詞即可在此指派引用。
        </p>
      ) : (
        <>
          {/* PLAN-057 A：標註檢視。正文原樣顯示，每個 [xxx] 換成與下方清單同色的膠囊 */}
          <div className="rounded-lg border border-border/60 bg-bg-dark/40 px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px] text-text-dim">
              <span>點正文裡的詞即可編輯 · 同色＝同一筆引用 · 虛線＝未指派</span>
              {activeSel && (
                <button type="button" onClick={() => setSel(null)} className="hover:text-text-secondary">取消選取</button>
              )}
            </div>
            {parts.map((p, i) => p && (
              <div key={i}>
                {multi && <div className="text-[11px] text-text-dim mb-0.5">{secs[i].label}</div>}
                <p className="text-xs text-text-secondary leading-6 whitespace-pre-wrap">
                  <RefOccurrenceText
                    text={p}
                    section={i}
                    refs={refs}
                    colorOf={colorOf}
                    selected={activeSel}
                    onSelect={setSel}
                  />
                </p>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            {tokens.map(token => (
              <TokenRow
                key={token}
                token={token}
                assigned={refs[token]}
                onAssign={(ref) => assign(token, ref)}
                onClear={() => clear(token)}
                colorClass={colorOf(token)}
                countsLabel={countsLabel(token)}
                selected={activeSel?.key === token}
                onSelect={() => setSel(activeSel?.key === token ? null : { key: token })}
              >
                {onCompileText && activeSel?.key === token && (
                  <KeyTools
                    // 換選另一處時重置後綴輸入
                    key={`${token}:${activeSel.section}:${activeSel.occurrence}`}
                    token={token}
                    sel={activeSel}
                    counts={countsOf(token)}
                    sections={secs}
                    refs={refs}
                    assigned={refs[token]}
                    buffLevels={levelsOf(refs[token])}
                    blocked={renameBlocked}
                    isLive={isLive}
                    onRename={rename}
                  />
                )}
              </TokenRow>
            ))}
          </div>

          {/* PLAN-022 Phase C：數值語法糖待代入（僅編輯期；存檔前需編譯為 <refId.attr> token）*/}
          {onCompileText && leftoverSugar.length > 0 && (
            <div className="rounded-lg border border-accent-yellow/30 bg-accent-yellow/5 px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] font-semibold text-accent-yellow">⚡ 數值語法糖待代入</span>
                <span className="text-[11px] text-text-dim">
                  尚有 <span className="text-accent-yellow font-semibold">{leftoverSugar.length}</span> 個未代入：
                  <code className="text-accent-yellow ml-1">{leftoverSugar.join('  ')}</code>
                </span>
              </div>
              <div className="text-[11px] text-text-dim leading-relaxed">
                <div>語法糖 <code className="text-text-secondary">{SIGIL_HINTS.join('、')}</code>（n = 下列引用編號）</div>
                {numberedRefs.length > 0 ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    {numberedRefs.map(({ n, token }) => (
                      <span key={token}><span className="text-accent-cyan font-semibold">{n}</span>. [{token}]</span>
                    ))}
                  </div>
                ) : (
                  <div className="text-accent-red mt-1">尚未指派任何引用 —— 請先在上方把 [xxx] 指派到實體，再代入數值。</div>
                )}
              </div>
              {!previewing ? (
                <button
                  type="button"
                  onClick={() => setPreviewing(true)}
                  disabled={numberedRefs.length === 0}
                  className="text-[12px] px-2.5 py-1 rounded border border-accent-yellow/40 bg-accent-yellow/10 text-accent-yellow hover:bg-accent-yellow/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >預覽代入結果</button>
              ) : (
                <div className="space-y-1.5">
                  <div className="text-[11px] text-text-dim">代入後（<code>&lt;refId.attr&gt;</code> token，存檔後前台顯示屬性真值）：</div>
                  <pre className="text-[11px] whitespace-pre-wrap break-all rounded bg-bg-dark border border-border/40 px-2.5 py-2 text-text-secondary">{compileSugar(joined, orderedRefs)}</pre>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { onCompileText((s) => compileSugar(s, orderedRefs)); setPreviewing(false) }}
                      className="text-[12px] px-2.5 py-1 rounded border border-accent-green/40 bg-accent-green/10 text-accent-green hover:bg-accent-green/20"
                    >✓ 確認代入</button>
                    <button
                      type="button"
                      onClick={() => setPreviewing(false)}
                      className="text-[12px] px-2.5 py-1 rounded border border-border text-text-dim hover:text-text-secondary"
                    >取消</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 即時預覽（含 [xxx] 引用 chip 與 <refId.attr> 數值引用解析）*/}
          <div className="mt-2 rounded-lg bg-bg-dark/60 border border-border/40 px-3 py-2">
            <div className="text-[11px] text-text-dim mb-1 uppercase tracking-wider">前台預覽（已解析數值引用）</div>
            <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
              <RefText text={joined} refs={refs} />
            </p>
          </div>
        </>
      )}
    </div>
  )
}
