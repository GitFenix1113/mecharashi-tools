// 後台「選取官方立繪」—— 機師、機甲版的 GameIconPicker
//
// 舊的 IconPicker 是「資料夾下拉＋檔名」。PLAN-054 之後機師／機甲圖一律放在遊戲 ID 資料夾
// （game/pilots/10103174/…、game/mechs/1011/…）：近兩百個純數字資料夾、檔名也是官方編號，
// 下拉選單完全看不出誰是誰——與 PLAN-055 之前圖示選圖器的困境相同。這裡比照 GameIconPicker 的解法：
//   · 每組圖標出**被哪位機師／哪台機甲使用**（從已載入的遊戲資料即時算，不另外讀 Firestore）
//   · 搜尋同時比對名稱、文件 ID、遊戲 ID（機師另含 artKey）
//   · 「未使用」排最前：新角色匯入官方原檔後，它就是唯一一組沒人用的圖
//   · 點一次就把**官方 ID 連同圖片**寫回（各欄位版各自決定寫哪些欄）
//
// 機師另有「NPC 立繪」分組（2026-10-12）：game/npc/ 裡還沒對應到可抽機師的官方立繪。NPC 轉正的機師官方常沿用
// NPC 時期那張，點它只寫回 artKey＋portrait——gameId（機師卡號）等官方出卡後再填，前台照樣有圖（見 pilotGameArt）。
//
// 清單來源是 build 產生的 gameArtIndex（與前台同一份）：剛匯入、還沒重跑 build／dev 的圖不會出現——前台也還看不到它。
// 客戶端擷取裡沒有的角色才走「其他圖片」：舊的 IconPicker，資料夾名旁附名稱；選到官方資料夾裡的圖照樣回推 ID。

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Mech, Pilot } from '../../types'
import { GAME_MECH_ART, GAME_NPC_ART, GAME_PILOT_ART } from '../../data/gameArtIndex'
import { PILOT_ART_INDEX } from '../../data/artIndex'
import { mechGameArt, npcGameArt, pilotGameArt, pilotGameIdFromPath } from '../../utils/gameArt'
import type { MechGameArtKind } from '../../utils/gameArt'
import { assetUrl, resolveIconSrc } from '../../utils/assets'
import { maxEntitySeq } from '../../utils/idSlug'
import { IconPicker } from './IconPicker'
import { artFolderNames } from './artFolderNames'

/** 一組官方原檔（一個遊戲 ID 資料夾，或 NPC 圖庫的一套立繪） */
interface ArtCandidate {
  id: string
  /** 分組（對到 GameArtPicker 的 groups）；不給＝第一組 */
  group?: string
  /** 格子第二行顯示的短編號；不給＝id */
  label?: string
  /** 同狀態時的排序（大的在前）；不給＝Number(id) */
  order?: number
  /** 網格縮圖（已套 assetUrl） */
  thumb: string
  /** 側欄預覽：第一張放大，其餘排成一列 */
  previews: { src: string; label: string }[]
  /** 側欄的事實列（遊戲 ID、artKey…） */
  facts: [string, ReactNode][]
  /** 額外的搜尋字串（例：artKey） */
  search?: string
}

interface ArtUser { id: string; name: string; detail?: string; search?: string }

interface ArtEntry extends ArtCandidate {
  /** 使用這組圖的**其他**實體（不含正在編輯的這一筆） */
  users: ArtUser[]
  /** 沒有任何實體在用（正在編輯的這一筆目前連著它也不算） */
  free: boolean
  /** 排序用：未使用＝∞（最新），已使用＝使用者文件 ID 的流水號 */
  seq: number
  haystack: string
}

type UseFilter = 'all' | 'unused' | 'used'
type ArtGroup = { key: string; label: string; tag?: string; hint?: string }

/** 候選屬於哪一組；沒標的歸第一組 */
const groupKeyOf = (e: ArtCandidate, groups: ArtGroup[] | undefined) => e.group ?? groups?.[0]?.key ?? ''

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full border text-xs whitespace-nowrap transition-colors ${
        on ? 'border-accent-cyan text-accent-cyan bg-accent-cyan/10' : 'border-border text-text-secondary hover:border-border-accent'
      }`}
    >
      {children}
    </button>
  )
}

// ── 挑選器彈窗（通用）──────────────────────────────────────────────────────────
function GameArtPicker({
  noun, idPrefix, subtitle, candidates, groups, usersOf, selfId, currentId, wide, importHint, footer, onPick, onClose,
}: {
  /** 「機師」／「機甲」 */
  noun: string
  /** 文件 ID 前綴，算建檔流水號用 */
  idPrefix: 'pilot' | 'mech'
  subtitle: string
  candidates: ArtCandidate[]
  /** 來源分組（例：可抽機師／NPC 立繪）；只有一組時不顯示分組列 */
  groups?: ArtGroup[]
  /** 候選 id → 使用它的**其他**實體 */
  usersOf: ReadonlyMap<string, ArtUser[]>
  selfId: string
  currentId?: string
  /** 縮圖是橫式（機甲立繪 560×340） */
  wide?: boolean
  /** 「未使用」為空時的匯入說明 */
  importHint: ReactNode
  footer: string
  onPick: (id: string) => void
  onClose: () => void
}) {
  const entries = useMemo(() => candidates.map((c): ArtEntry => {
    const users = usersOf.get(c.id) ?? []
    const ids = [...users.map((u) => u.id), ...(c.id === currentId ? [selfId] : [])]
    return {
      ...c,
      users,
      free: !ids.length,
      seq: ids.length ? maxEntitySeq(idPrefix, ids) : Infinity,
      haystack: [c.id, c.search ?? '', ...users.flatMap((u) => [u.name, u.search ?? '', u.id])].join(' ').toLowerCase(),
    }
  }), [candidates, usersOf, currentId, selfId, idPrefix])

  const unusedCount = entries.filter((e) => e.free).length
  // 還沒連上官方原檔的（新角色）→ 有未使用的圖就直接只開那幾組
  const [use, setUse] = useState<UseFilter>(() => (!currentId && unusedCount > 0 ? 'unused' : 'all'))
  const [newestFirst, setNewestFirst] = useState(true)
  const [search, setSearch] = useState('')
  const [focus, setFocus] = useState<string | null>(currentId ?? null)
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const groupInfo = (e: ArtCandidate) => groups?.find((g) => g.key === groupKeyOf(e, groups))

  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = entries.filter((e) => {
      if (groupFilter && groupKeyOf(e, groups) !== groupFilter) return false
      if (use === 'unused' && !e.free) return false
      if (use === 'used' && e.free) return false
      return !q || e.haystack.includes(q)
    })
    // 使用狀態（未使用＝最新）→ 分組順序 → 編號
    const order = (e: ArtCandidate) => e.order ?? Number(e.id)
    const rank = (e: ArtCandidate) => Math.max(0, groups?.findIndex((g) => g.key === groupKeyOf(e, groups)) ?? 0)
    out.sort((a, b) => (newestFirst ? b.seq - a.seq : a.seq - b.seq) || rank(a) - rank(b) || order(b) - order(a))
    return out
  }, [entries, use, search, newestFirst, groupFilter, groups])

  const focusEntry = entries.find((e) => e.id === focus) ?? null
  const pick = (id: string) => { onPick(id); onClose() }
  const [lead, ...rest] = focusEntry?.previews ?? []

  // ⚠ 與 IconPicker 同理，必須 portal 到 body（祖先的 transform／filter 會讓 fixed 失準）
  return createPortal(
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        // 固定高度：篩選／搜尋讓結果變少時彈窗不縮，右側預覽才不會跟著跳
        className="bg-bg-card border border-border rounded-xl p-5 w-full max-w-5xl h-[min(90vh,860px)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3 shrink-0 gap-3">
          <h3 className="text-base font-bold flex items-center gap-2 flex-wrap">
            <span className="text-accent-orange">🖼️</span> 選取官方立繪
            <span className="text-text-dim text-xs font-normal">{subtitle}</span>
          </h3>
          <button onClick={onClose} className="text-text-dim hover:text-text-primary text-lg leading-none">✕</button>
        </div>

        {groups && groups.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2 shrink-0">
            <span className="text-[11px] text-text-dim shrink-0">來源</span>
            <Chip on={!groupFilter} onClick={() => setGroupFilter(null)}>全部來源</Chip>
            {groups.map((g) => (
              <Chip key={g.key} on={groupFilter === g.key} onClick={() => setGroupFilter(g.key)} title={g.hint}>
                {g.label}（{entries.filter((e) => groupKeyOf(e, groups) === g.key).length}）
              </Chip>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mb-3 shrink-0">
          <Chip on={use === 'all'} onClick={() => setUse('all')}>全部（{entries.length}）</Chip>
          <Chip on={use === 'unused'} onClick={() => setUse('unused')} title={`沒有任何其他${noun}在用——新匯入的就在這裡`}>
            未使用（{unusedCount}）
          </Chip>
          <Chip on={use === 'used'} onClick={() => setUse('used')}>已使用（{entries.length - unusedCount}）</Chip>
          <Chip on={newestFirst} onClick={() => setNewestFirst((v) => !v)} title="依使用者的建檔流水號；未使用的視為最新">
            {newestFirst ? '最新在前' : '最舊在前'}
          </Chip>
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`搜尋${noun}名稱、遊戲 ID…`}
            className="input-field text-sm flex-1 min-w-[200px]"
          />
        </div>

        <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 min-h-[200px] -mx-1 px-1">
            {results.length === 0 ? (
              <div className="py-10 text-center text-sm text-text-dim space-y-2">
                <p>{use === 'unused' ? `沒有未使用的官方立繪——每一組都已經有${noun}在用。` : '找不到符合的立繪'}</p>
                {use === 'unused' && <div className="text-xs leading-relaxed">{importHint}</div>}
              </div>
            ) : (
              <div className={`grid gap-2 ${wide ? 'grid-cols-[repeat(auto-fill,minmax(132px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(92px,1fr))]'}`}>
                {results.map((e) => {
                  const active = e.id === currentId
                  const taken = e.users.length > 0
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => pick(e.id)}
                      onMouseEnter={() => setFocus(e.id)}
                      onFocus={() => setFocus(e.id)}
                      className={`relative flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-colors ${
                        active ? 'border-accent-orange bg-accent-orange/10' : 'border-border/50 hover:border-border-accent hover:bg-bg-dark'
                      }`}
                    >
                      <img
                        src={e.thumb}
                        alt=""
                        loading="lazy"
                        className={`${wide ? 'w-28 h-[68px] object-contain' : 'w-16 h-16 object-cover'} rounded bg-bg-dark`}
                      />
                      <span className={`text-[11px] truncate max-w-full leading-tight ${active ? 'text-accent-orange' : taken ? 'text-text-primary' : 'text-accent-yellow'}`}>
                        {active ? '目前' : taken ? e.users.map((u) => u.name).join('、') : '未使用'}
                      </span>
                      <span className="text-[10px] text-text-dim font-mono leading-tight truncate max-w-full">{e.label ?? e.id}</span>
                      {groupInfo(e)?.tag && (
                        <span className="absolute top-1 left-1 px-1 rounded bg-bg-dark/90 border border-accent-purple/50 text-[9px] leading-4 text-accent-purple">
                          {groupInfo(e)!.tag}
                        </span>
                      )}
                      {e.users.length > 1 && (
                        <span title="遊戲 ID 應該一筆一組" className="absolute top-1 right-1 px-1 rounded bg-bg-dark/90 border border-accent-red/50 text-[9px] leading-4 text-accent-red">
                          重複
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <aside className="md:w-64 shrink-0 border-t md:border-t-0 md:border-l border-border pt-3 md:pt-0 md:pl-4 overflow-y-auto">
            {focusEntry && lead ? (
              <>
                <img
                  src={lead.src}
                  alt={lead.label}
                  className={`${wide ? 'w-full h-auto' : 'w-32 h-32'} rounded-lg object-contain bg-bg-dark mx-auto`}
                />
                {rest.length > 0 && (
                  <div className="flex justify-center flex-wrap gap-2 mt-2">
                    {rest.map((p) => (
                      <figure key={p.label} className="m-0 flex flex-col items-center gap-0.5">
                        <img src={p.src} alt="" className="w-12 h-12 rounded object-contain bg-bg-dark" />
                        <figcaption className="text-[10px] text-text-dim">{p.label}</figcaption>
                      </figure>
                    ))}
                  </div>
                )}
                <dl className="mt-3 text-xs space-y-1">
                  {focusEntry.facts.map(([k, v]) => (
                    <div key={k} className="flex gap-2"><dt className="text-text-dim w-14 shrink-0">{k}</dt><dd className="break-all">{v}</dd></div>
                  ))}
                </dl>
                <div className="mt-3 text-xs">
                  {focusEntry.users.length ? (
                    <>
                      <p className="text-text-dim mb-1">使用中</p>
                      <ul className="space-y-1">
                        {focusEntry.users.map((u) => (
                          <li key={u.id} className="leading-snug">
                            <span className="text-text-primary">{u.name}</span>
                            {u.detail && <span className="text-text-dim">（{u.detail}）</span>}
                            <span className="block text-[10px] text-text-dim font-mono">{u.id}</span>
                          </li>
                        ))}
                      </ul>
                      {focusEntry.id !== currentId && (
                        <p className="mt-2 text-accent-yellow leading-snug">⚠ 套用後會和上面這{noun === '機甲' ? '台' : '位'}共用同一組圖——只有修正資料、或刻意換成這套造型時才該這樣做。</p>
                      )}
                    </>
                  ) : focusEntry.id === currentId ? (
                    <p className="text-accent-orange">目前這筆使用中</p>
                  ) : (
                    <p className="text-accent-yellow">尚未被任何{noun}使用</p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs text-text-dim">滑過立繪可放大，並顯示被哪{noun === '機甲' ? '台機甲' : '位機師'}使用。</p>
            )}
          </aside>
        </div>

        <p className="text-[11px] text-text-dim mt-2 shrink-0">符合 {results.length} 組 · {footer}</p>
      </div>
    </div>,
    document.body,
  )
}

// ── 欄位外殼（預覽＋文字輸入＋選取官方立繪／其他圖片＋清除＋回推提示）────────────
function ArtFieldShell({ label, value, onType, onClear, onOfficial, onOther, note, hint }: {
  label: string
  value: string
  onType: (v: string) => void
  onClear: () => void
  onOfficial: () => void
  onOther: () => void
  /** 選圖後回推出遊戲 ID 時的提示 */
  note: string | null
  hint: string
}) {
  return (
    <div>
      <label className="text-xs text-text-dim mb-1 block">{label}</label>
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
        {value ? (
          <img
            src={resolveIconSrc(value)}
            alt=""
            className="w-10 h-10 rounded object-contain border border-border/50 bg-bg-dark shrink-0"
            onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.15')}
          />
        ) : (
          <div className="w-10 h-10 rounded border border-dashed border-border/60 bg-bg-dark/50 shrink-0 flex items-center justify-center text-text-dim text-[10px]">無</div>
        )}
        <input
          type="text"
          value={value}
          onChange={(e) => onType(e.target.value)}
          placeholder="/images/... 或貼上遠端 URL"
          className="input-field flex-1 min-w-[160px] text-sm"
        />
        <button
          type="button"
          onClick={onOfficial}
          className="shrink-0 px-3 py-2 text-sm text-accent-cyan border border-accent-cyan/40 rounded-lg hover:bg-accent-cyan/10 transition-colors whitespace-nowrap"
        >
          選取官方立繪
        </button>
        <button
          type="button"
          onClick={onOther}
          title="依資料夾瀏覽 public/images（站上自製圖、沒有官方原檔的用）；選到官方資料夾裡的圖照樣會帶入遊戲 ID"
          className="shrink-0 px-3 py-2 text-sm text-text-secondary border border-border rounded-lg hover:border-border-accent transition-colors whitespace-nowrap"
        >
          其他圖片
        </button>
        {value && (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 px-2 py-2 text-sm text-accent-red border border-accent-red/30 rounded-lg hover:bg-accent-red/10 transition-colors"
          >
            清除
          </button>
        )}
      </div>
      {note
        ? <p className="text-[11px] text-accent-green mt-1">✓ {note}</p>
        : <p className="text-[11px] text-text-dim mt-1">{hint}</p>}
    </div>
  )
}

// ── 機師 ────────────────────────────────────────────────────────────────────────
const PILOT_CANDIDATES: ArtCandidate[] = [...GAME_PILOT_ART]
  .filter(([, e]) => e.key && e.half) // 沒有立繪主鍵／半身頭像的資料夾寫不出 portrait
  .map(([id, e]) => {
    const art = (kind: 'half' | 'head' | 'card') => assetUrl(pilotGameArt({ gameId: id, artKey: e.key }, kind) ?? '')
    return {
      id,
      thumb: art('half'),
      previews: [{ src: art('half'), label: '頭像' }, { src: art('head'), label: '頭部' }, { src: art('card'), label: '機師卡' }],
      facts: [
        ['gameId', <span className="font-mono select-all">{id}</span>],
        ['artKey', <span className="font-mono select-all">{e.key}</span>],
        ['原稿全身', PILOT_ART_INDEX.has(id) ? '有（art.webp）' : <span className="text-text-dim">無</span>],
      ],
      search: e.key,
    }
  })

/**
 * NPC 圖庫（2026-10-12）。可抽機師 core 資料夾裡已經有的立繪鍵不列（NPC 轉正、用 --id 匯入 core 後兩邊都有一份）；
 * 沒有頭像（half）的那幾套也不列——寫不出 portrait。
 * 格子第二行顯示英文名（3D 模型資料夾，--npc 自動抓）：新機師公布英文名時，搜尋英文就找得到 NPC 時期的立繪。
 * 人工註記的 owner（其實是哪位可抽機師的另一造型）在 PilotPortraitField 的 usersOf 裡當成使用者，不算「未使用」。
 */
const PILOT_CORE_KEYS = new Set([...GAME_PILOT_ART.values()].map((e) => e.key))
const NPC_CANDIDATES: ArtCandidate[] = [...GAME_NPC_ART]
  .filter(([key, e]) => e.half && !PILOT_CORE_KEYS.has(key))
  .map(([key, e]) => {
    const art = (kind: 'half' | 'head') => assetUrl(npcGameArt(key, kind) ?? '')
    return {
      id: key,
      group: 'npc',
      label: e.en ?? key.replace(/^Pilot_/, ''),
      order: Number(e.dir),
      thumb: art('half'),
      previews: [{ src: art('half'), label: '頭像' }, ...(e.head ? [{ src: art('head'), label: '頭部' }] : [])],
      facts: [
        ['artKey', <span className="font-mono select-all">{key}</span>],
        ...(e.en ? [['英文名', e.en] as [string, ReactNode]] : []),
        ['位置', <span className="font-mono">game/npc/{e.dir}</span>],
        ['機師卡', <span className="text-text-dim">無（NPC 立繪）</span>],
        ...(e.note ? [['註記', <span className="text-accent-yellow">{e.note}</span>] as [string, ReactNode]] : []),
      ],
      search: [key, 'npc', e.dir, e.en, e.note].filter(Boolean).join(' '),
    }
  })
const PILOT_GROUPS: ArtGroup[] = [
  { key: 'pilot', label: '可抽機師' },
  { key: 'npc', label: 'NPC 立繪', tag: 'NPC', hint: '還沒對應到可抽機師的官方立繪（劇情 NPC、尚未上線的新角色）——NPC 轉正的機師從這裡挑' },
]
const ALL_PILOT_CANDIDATES = [...PILOT_CANDIDATES, ...NPC_CANDIDATES]

/**
 * 機師立繪欄位。
 * - 選取官方立繪：寫回 gameId、artKey（取自資料夾實際檔名——5 位例外也不必手打）、portrait（half 路徑，與既有機師同慣例）
 *   NPC 立繪：只寫 artKey＋portrait，gameId 不動（機師卡號等官方出卡後再填）
 * - 其他圖片：寫回 portrait；路徑在官方／原稿的 gameId 資料夾裡就順手帶入 gameId＋artKey，推不出來只寫圖片
 */
export function PilotPortraitField({ form, pilots, onPatch }: {
  form: Pilot
  pilots: readonly Pilot[]
  onPatch: (patch: Partial<Pilot>) => void
}) {
  const [picking, setPicking] = useState<'official' | 'other' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const folderNames = useMemo(() => artFolderNames(pilots), [pilots])
  const usersOf = useMemo(() => {
    const m = new Map<string, ArtUser[]>()
    const add = (k: string, p: Pilot) => m.set(k, [...(m.get(k) ?? []), { id: p.id, name: p.name, detail: [p.rarity, p.class].filter(Boolean).join('・'), search: p.fullName }])
    for (const p of pilots) {
      if (p.id === form.id) continue
      if (p.gameId) add(p.gameId, p)
      // NPC 立繪以 artKey 認：gameId 資料夾的主鍵對不上、而 NPC 圖庫有這個鍵 → 這位用的是 NPC 立繪
      if (p.artKey && GAME_NPC_ART.has(p.artKey) && GAME_PILOT_ART.get(p.gameId ?? '')?.key !== p.artKey) add(p.artKey, p)
    }
    // 人工註記：這套 NPC 立繪其實是某位可抽機師的另一造型（劇情換造型前的樣子等）→ 掛在他名下，不算未使用
    const byId = new Map(pilots.map((p) => [p.id, p]))
    for (const [key, e] of GAME_NPC_ART) {
      const owner = e.owner ? byId.get(e.owner) : undefined
      if (!owner || owner.id === form.id || m.get(key)?.some((u) => u.id === owner.id)) continue
      m.set(key, [...(m.get(key) ?? []), { id: owner.id, name: `${owner.name}・另一造型`, detail: '人工註記', search: `${owner.name} ${owner.fullName ?? ''}` }])
    }
    return m
  }, [pilots, form.id])
  // 目前連著哪一組：gameId 資料夾的主鍵對得上 → 那個 gameId；否則 artKey 在 NPC 圖庫 → 那套 NPC 立繪
  const currentId = form.gameId && GAME_PILOT_ART.get(form.gameId)?.key === form.artKey ? form.gameId
    : form.artKey && GAME_NPC_ART.has(form.artKey) ? form.artKey
    : form.gameId

  const pickOther = (path: string) => {
    const inferred = pilotGameIdFromPath(path)
    if (inferred && (inferred.gameId !== form.gameId || inferred.artKey !== form.artKey)) {
      onPatch({ portrait: path, ...inferred })
      const prev = form.gameId && form.gameId !== inferred.gameId ? `（原本是 ${form.gameId}）` : ''
      setNote(`已依圖片路徑帶入 gameId ${inferred.gameId}${prev}${inferred.artKey ? `／artKey ${inferred.artKey}` : ''}`)
    } else {
      onPatch({ portrait: path })
      setNote(null)
    }
  }

  return (
    <>
      <ArtFieldShell
        label="立繪路徑 portrait"
        value={form.portrait ?? ''}
        onType={(v) => { onPatch({ portrait: v }); setNote(null) }}
        onClear={() => { onPatch({ portrait: '' }); setNote(null) }}
        onOfficial={() => setPicking('official')}
        onOther={() => setPicking('other')}
        note={note}
        hint="「選取官方立繪」依機師名稱挑圖，會一併填好下方的 gameId 與 artKey；客戶端擷取裡還沒有的機師才用「其他圖片」或貼網址。"
      />
      {picking === 'official' && (
        <GameArtPicker
          noun="機師"
          idPrefix="pilot"
          subtitle="官方原檔 game/pilots＋NPC 圖庫 game/npc · 寫回 gameId／artKey／portrait"
          candidates={ALL_PILOT_CANDIDATES}
          groups={PILOT_GROUPS}
          usersOf={usersOf}
          selfId={form.id}
          currentId={currentId}
          importHint={<>
            新機師要先匯入官方原檔：<code>node scripts/import-game-assets.mjs --src=latest --id=&lt;卡號&gt; --art-key=Pilot_&lt;卡號&gt;A --apply</code>，
            重跑 build／dev 後才會出現在這裡。<br />
            NPC 轉正的機師（例：索妮婭）官方常沿用 NPC 時期的立繪——切到上方「NPC 立繪」分組找，點了就能用，不必等機師卡。<br />
            客戶端擷取裡真的沒有的機師，請關掉這個視窗改用「其他圖片」或貼遠端網址。
          </>}
          footer="點擊即套用：可抽機師寫 gameId＋artKey（取自資料夾實際檔名）＋portrait；NPC 立繪寫 artKey＋portrait"
          onPick={(id) => {
            if (GAME_NPC_ART.has(id) && !GAME_PILOT_ART.has(id)) {
              onPatch({ artKey: id, portrait: npcGameArt(id, 'half') ?? form.portrait })
              setNote(`已套用 NPC 立繪 ${id}${form.gameId ? '' : '；機師卡要等官方出卡後再填 gameId（卡號）'}`)
              return
            }
            const artKey = GAME_PILOT_ART.get(id)?.key
            onPatch({ gameId: id, artKey, portrait: pilotGameArt({ gameId: id, artKey }, 'half') ?? form.portrait })
            setNote(null)
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === 'other' && (
        <IconPicker
          value={form.portrait}
          defaultFolder={form.gameId ? `game/pilots/${form.gameId}` : 'pilots'}
          folderNames={folderNames}
          onPick={pickOther}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  )
}

// ── 機甲 ────────────────────────────────────────────────────────────────────────
const MECH_PART_PREVIEWS: [MechGameArtKind, string][] = [['torso', '軀幹'], ['leftArm', '左臂'], ['rightArm', '右臂'], ['legs', '腿部']]

const MECH_CANDIDATES: ArtCandidate[] = [...GAME_MECH_ART].map(([wap, e]) => {
  const art = (kind: MechGameArtKind) => {
    const p = mechGameArt({ gameId: wap }, kind)
    return p ? assetUrl(p) : ''
  }
  const parts = MECH_PART_PREVIEWS.map(([k, label]) => ({ src: art(k), label })).filter((p) => p.src)
  return {
    id: wap,
    thumb: art('icon') || parts[0]?.src || '',
    previews: [...(e.icon ? [{ src: art('icon'), label: '立繪' }] : []), ...parts],
    facts: [
      ['wap', <span className="font-mono select-all">{wap}</span>],
      ['部件', `${e.parts.length}／4`],
      ['全身大圖', e.sn ? '有（SN）' : <span className="text-text-dim">無</span>],
    ],
  }
})

/**
 * 機甲立繪欄位。
 * - 選取官方立繪：交給 onLinkOfficial(wap)——寫回 gameId、立繪，部件圖由 MechAdmin 決定怎麼補（它才有空白部件工廠）
 * - 其他圖片：寫回 portrait，再交給 onPickImage 回推遊戲 ID（推不出來只寫圖片）
 */
export function MechPortraitField({ form, mechs, folderNames, defaultFolder, onPortrait, onPickImage, onLinkOfficial }: {
  form: Mech
  mechs: readonly Mech[]
  folderNames: Record<string, string>
  defaultFolder: string
  onPortrait: (v: string | undefined) => void
  /** 從「其他圖片」選圖後回推遊戲 ID；回傳要顯示的提示（推不出來回 undefined） */
  onPickImage: (path: string) => string | undefined
  /** 點選官方立繪：連上這組官方原檔；回傳要顯示的結果說明 */
  onLinkOfficial: (wap: string) => string
}) {
  const [picking, setPicking] = useState<'official' | 'other' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const usersOf = useMemo(() => {
    const byId = new Map(mechs.map((m) => [m.id, m]))
    const m = new Map<string, ArtUser[]>()
    for (const x of mechs) {
      if (x.id === form.id || !x.gameId) continue
      const skin = x.skinOfId ? `${byId.get(x.skinOfId)?.name ?? x.skinOfId} 的塗裝` : undefined
      m.set(x.gameId, [...(m.get(x.gameId) ?? []), { id: x.id, name: x.name, detail: [x.quality, x.armorType, skin].filter(Boolean).join('・') }])
    }
    return m
  }, [mechs, form.id])

  const pickOther = (path: string) => { onPortrait(path); setNote(onPickImage(path) ?? null) }

  return (
    <>
      <ArtFieldShell
        label="立繪 portrait"
        value={form.portrait ?? ''}
        onType={(v) => { onPortrait(v || undefined); setNote(null) }}
        onClear={() => { onPortrait(undefined); setNote(null) }}
        onOfficial={() => setPicking('official')}
        onOther={() => setPicking('other')}
        note={note}
        hint="「選取官方立繪」依機甲名稱挑圖，會一併帶入遊戲 ID 與四個部件圖；客戶端擷取裡還沒有的機甲才用「其他圖片」或貼網址。"
      />
      {picking === 'official' && (
        <GameArtPicker
          noun="機甲"
          idPrefix="mech"
          subtitle="官方原檔 game/mechs · 一次帶入遊戲 ID、立繪與部件圖"
          candidates={MECH_CANDIDATES}
          usersOf={usersOf}
          selfId={form.id}
          currentId={form.gameId}
          wide
          importHint={<>
            新機甲要先匯入官方原檔：<code>node scripts/import-game-assets.mjs --wap=&lt;####&gt; --apply</code>，
            重跑 build／dev 後才會出現在這裡。<br />
            客戶端擷取裡還沒有的機甲，請關掉這個視窗改用「其他圖片」或貼遠端網址。
          </>}
          footer="點擊即套用：遊戲 ID、立繪，以及空白或原本就是官方圖的部件圖（手放的自訂圖不會被蓋掉）"
          onPick={(wap) => setNote(onLinkOfficial(wap))}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === 'other' && (
        <IconPicker
          value={form.portrait}
          defaultFolder={defaultFolder}
          folderNames={folderNames}
          onPick={pickOther}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  )
}
