import { useMemo, useState, useEffect } from 'react'
import type { EntityRef, RefType, DescriptionRefs } from '../../types'
import { useGameData, type CollectionKey } from '../../contexts/GameDataContext'
import { STAT_LABELS } from '../../utils/moduleStats'
import { RefText } from '../RefText'
import { compileSugar, orderRefsByFirstMention, detectLeftoverSugar, NUM_ATTRS } from '../../utils/numRefs'
import { splitRefKey, countKeywordOccurrences, rewriteOccurrence } from '../../utils/refKey'

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
]

const REF_TYPE_LABEL: Record<RefType, string> = {
  buff: 'BUFF', skill: '技能', pilot: '機師', mech: '機甲', weapon: '武器',
  module: '模組', backpack: '背包', component: '元件', stat: '屬性', term: '詞條', neuralDrive: '神經驅動',
}

const REF_TO_COLLECTION: Partial<Record<RefType, CollectionKey>> = {
  pilot: 'pilots', mech: 'mechs', weapon: 'weapons', module: 'modules',
  backpack: 'backpacks', component: 'components', buff: 'buffs',
  skill: 'pilotSkills', term: 'glossaryTerms', neuralDrive: 'neuralDriveAbilities',
}

interface Candidate { id: string; name: string }

/**
 * 取出描述中所有不重複的 [xxx] token（保留出現順序）。
 * Map 保留插入序，故與原先自行 tokenize 的行為完全相同——tokenizer 收斂到 refKey 一處（PLAN-039）。
 */
const extractTokens = (text: string): string[] => [...countKeywordOccurrences(text).keys()]

/**
 * 同名重複的 token（PLAN-039 B-2）：同一個**完整 key** 在正文出現 ≥2 次。
 *
 * **逐段取最大值而非合計**：天賦的 description 與 descriptionMax 是同一段能力的兩個版本，
 * 合併後計數會把「出現 2 次」報成 4 次——而 4 次會誤觸發 B-3 的「≥3 次停用」規則，
 * 讓一鍵拆分在最需要它的案例上不可用。
 *
 * 已消歧完畢的 [駐陣] / [駐陣|skill] 各算 1，不會被報成重複。
 */
function findDuplicateTokens(parts: string[]): { token: string; count: number }[] {
  const max = new Map<string, number>()
  for (const p of parts) {
    for (const [k, n] of countKeywordOccurrences(p)) max.set(k, Math.max(max.get(k) ?? 0, n))
  }
  return [...max].filter(([, n]) => n >= 2).map(([token, count]) => ({ token, count }))
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
      case 'neuralDrive': return gd.neuralDriveAbilities.map(a => ({ id: a.id, name: a.name }))
      case 'stat':      return STAT_LABELS.map(s => ({ id: s.key, name: s.label }))
      default:          return []
    }
  }, [refType, gd.pilots, gd.mechs, gd.weapons, gd.modules, gd.backpacks, gd.components, gd.buffs, gd.pilotSkills, gd.glossaryTerms, gd.neuralDriveAbilities])
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
    <div className="bg-bg-dark border border-border/60 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-accent-purple text-sm">[{display}]</span>
        {disambig && (
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-accent-orange/30 bg-accent-orange/10 text-accent-orange"
            title={`同名消歧鍵：此標記在資料中的 key 為「${token}」，前台顯示時會剝除後綴`}
          >|{disambig}</span>
        )}
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
    </div>
  )
}

// ── RefPicker 主體 ─────────────────────────────────────────────────────────────
export function RefPicker({
  text,
  value,
  onChange,
  onCompileText,
}: {
  /**
   * 正文。多欄位面板（天賦的 description + descriptionMax）**應傳陣列**：
   * join 後的單一字串無法分辨「同一個 [xxx] 在兩個版本各出現一次」與「在同一版本出現兩次」，
   * 而這兩者對同名消歧的判定完全相反（PLAN-039 B-2）。傳字串 = 單段，既有行為不變。
   * 陣列元素可為 undefined（選填欄位如 descriptionMax 直接傳即可），空值會被略過。
   */
  text: string | (string | undefined)[]
  value?: DescriptionRefs
  onChange: (refs: DescriptionRefs) => void
  /**
   * **正文改寫管道**：RefPicker 算出一個 transform，交給消費端對自己擁有的各正文欄位
   * （如 description / descriptionMax）分別套用 —— 邏輯集中、消費端只接一行。
   * 未傳則相關按鈕不顯示（既有面板零回歸）。
   *
   * 目前有兩個用途，共用同一條管道：
   *   ① PLAN-022 Phase C：把編輯期語法糖 $n/%n 編譯成正式 token
   *   ② PLAN-039 B-3：把同名 [xxx] 的指定一處改寫為帶消歧後綴的形式
   * 名稱沿用 compile 是歷史因素；它描述的是機制（交出 transform）而非特定用途。
   */
  onCompileText?: (transform: (s: string) => string) => void
}) {
  // 陣列 → 各段獨立（供同名計數）；字串 → 單段。joined 供 tokenize / 語法糖 / 預覽沿用既有邏輯。
  const parts  = useMemo(
    () => (Array.isArray(text) ? text.filter((s): s is string => !!s) : [text || '']),
    [text],
  )
  const joined = useMemo(() => parts.join('\n'), [parts])

  const tokens = useMemo(() => extractTokens(joined), [joined])
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

  // ── PLAN-022 Phase C：數值語法糖代入 ───────────────────────────────────────────
  // orderedRefs：已指派 [xxx] 依首次出現序的 refId 清單，作為 $n/%n 的 n 對照（對齊 numbered 顯示）。
  const orderedRefs   = useMemo(() => orderRefsByFirstMention(joined, value ?? {}), [joined, value])
  const leftoverSugar = useMemo(() => detectLeftoverSugar(joined), [joined])
  const numberedRefs  = useMemo(
    () => tokens.filter(t => (value ?? {})[t]).map((t, i) => ({ n: i + 1, token: t })),
    [tokens, value],
  )
  const [previewing, setPreviewing] = useState(false)

  // ── PLAN-039 B-2/B-3：同名引用消歧 ────────────────────────────────────────────
  const duplicates = useMemo(() => findDuplicateTokens(parts), [parts])
  // 各 token 的消歧鍵輸入。預設 skill —— 同名的兩種語意最常是「指令/技能」對「狀態/BUFF」，
  // 而慣例是讓裸 key 留給 BUFF、帶後綴的那個標成 skill。
  const [disambigInput, setDisambigInput] = useState<Record<string, string>>({})
  // 拆分會改變 orderRefsByFirstMention 的編號基準 → 未代入的 $n 會指到錯誤的引用（決策五）
  const splitBlocked = leftoverSugar.length > 0

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

      {/* PLAN-039 B-2：同名重複偵測。是提示不是錯誤——同名同義是絕大多數情況的正確狀態 */}
      {duplicates.length > 0 && (
        <div className="rounded-lg border border-accent-orange/30 bg-accent-orange/5 px-3 py-2.5 space-y-2">
          <div className="text-[12px] font-semibold text-accent-orange">🔀 同名引用標記</div>
          <div className="text-[11px] text-text-dim leading-relaxed">
            下列標記在同一段正文出現多次，目前<strong className="text-text-secondary">全部指向同一個實體</strong>。
            各處語意相同時（多數情況）無需處理；語意不同時——例如一處是「可使用指令<code>[駐陣]</code>」＝技能、
            另一處是「處於<code>[駐陣]</code>狀態」＝BUFF——替其中一處加上消歧鍵即可各自指派，
            <strong className="text-text-secondary">前台顯示的文字不受影響</strong>。
            <div className="mt-1">
              分隔符固定為 <code className="text-accent-orange">|</code>；
              <code>#</code> 會被當成數值語法糖而改壞正文，不可使用。
            </div>
          </div>
          {duplicates.map(({ token, count }) => {
            const dis = disambigInput[token] ?? 'skill'
            const tooMany = count > 4                 // 按鈕會排不下；此時請直接編輯正文
            return (
              <div key={token} className="flex items-center gap-2 flex-wrap text-[11px] pt-1.5 border-t border-accent-orange/15">
                <span className="font-semibold text-accent-purple">[{token}]</span>
                <span className="text-text-dim">出現 {count} 次</span>
                {onCompileText && !tooMany && (
                  <>
                    <input
                      value={dis}
                      onChange={(e) => setDisambigInput((prev) => ({
                        // 方括號會破壞 token 邊界、'|' 會讓 key 出現第二個分隔符 → 直接濾掉
                        ...prev, [token]: e.target.value.replace(/[[\]|]/g, ''),
                      }))}
                      placeholder="skill"
                      className="input-field text-[11px] w-20 py-0.5"
                      title="消歧鍵：會成為 key 的後綴（駐陣|skill），前台顯示時剝除"
                    />
                    {Array.from({ length: count }, (_, k) => (
                      <button
                        key={k}
                        type="button"
                        disabled={splitBlocked || !dis}
                        onClick={() => onCompileText((s) => rewriteOccurrence(s, token, k + 1, dis))}
                        className="px-2 py-0.5 rounded border border-accent-orange/40 bg-accent-orange/10 text-accent-orange hover:bg-accent-orange/20 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={`把第 ${k + 1} 處 [${token}] 改寫為 [${token}|${dis || 'skill'}]`}
                      >標記第 {k + 1} 處</button>
                    ))}
                  </>
                )}
                {onCompileText && tooMany && (
                  <span className="text-text-dim">出現次數過多，請直接在上方正文手動加上 <code>|{dis}</code> 後綴</span>
                )}
                {onCompileText && splitBlocked && !tooMany && (
                  <span className="text-accent-yellow">← 請先代入下方的數值語法糖（拆分會改變 $n 的編號基準）</span>
                )}
                {onCompileText && parts.length > 1 && !tooMany && (
                  <span className="text-text-dim w-full">
                    此面板有 {parts.length} 段正文（如初始 / 滿星），改寫會同時套用到<strong className="text-text-secondary">各段的第 N 處</strong>；
                    若兩段句子結構不同，請改為手動編輯。
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

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
