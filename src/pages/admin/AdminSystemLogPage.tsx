import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSystemLogPage, getSystemLogSummary } from '../../lib/firestoreApi'
import type { SystemLogEntry, SystemLogKind } from '../../types/systemLog'
import { KIND_LABEL, REASON_LABEL, REASON_SEVERITY } from '../../types/systemLog'
import type { LogoutReason, Tri } from '../../lib/diag/sentinel'
import type { PageCursor } from '../../lib/api/firestoreCore'
import { LoadMoreButton } from '../user/admin/shared'

// ─── 系統日誌檢視頁（PLAN-045 Phase E-2）─────────────────────────────────────
// systemLog 不進 GameDataContext 快取（比照 changeHistory），本頁直接走
// getSystemLogPage 伺服器分頁。也不可用 useClientPaged / useServerPaged——
// 兩者綁定 name 排序模型，與本頁的 at 時間排序不相容。
//
// 讀取權限由 firestore.rules 的 isOwnerRole() 把關；本頁的入口在 AdminPage 也只對
// OWNER 顯示，但**規則才是真正的防線**，UI 隱藏只是避免 ADMIN 點進來吃到權限錯誤。

const PAGE_SIZE = 30

const KIND_OPTIONS: (SystemLogKind | '')[] = ['', 'logout', 'writeDenied']
// idbEvicted 已停用（該探針恆為 present，判定產生不出來），不列為篩選選項——
// 留著只會讓人以為那是可能出現的成因。既有舊記錄仍顯示得出標籤。
const REASON_OPTIONS: (LogoutReason | '')[] = [
  '', 'storageCleared', 'tokenRevoked', 'unknown',
]

/** 嚴重度色票：alert 紅（要追的目標）/ notice 黃 / normal 灰 */
const SEVERITY_CHIP: Record<'normal' | 'notice' | 'alert', string> = {
  alert:  'bg-accent-red/15 text-accent-red border-accent-red/30',
  notice: 'bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30',
  normal: 'bg-bg-dark text-text-dim border-border',
}

const KIND_CHIP: Record<SystemLogKind, string> = {
  logout:      'bg-accent-purple/15 text-accent-purple border-accent-purple/30',
  writeDenied: 'bg-accent-orange/15 text-accent-orange border-accent-orange/30',
}

function fmtTime(ms: number): string {
  if (!ms) return '（時間不明）'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** bytes → 人類可讀。儲存用量動輒數十 MB，原始數字看不出所以然。 */
function fmtBytes(n?: number): string {
  if (typeof n !== 'number') return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function fmtDuration(sec?: number): string {
  if (typeof sec !== 'number') return '—'
  if (sec < 60) return `${sec} 秒`
  if (sec < 3600) return `${Math.round(sec / 60)} 分鐘`
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} 小時`
  return `${(sec / 86400).toFixed(1)} 天`
}

/**
 * 從 UA 粗略辨識瀏覽器。
 *
 * 為什麼值得做：storageCleared 有兩個對策完全不同的來源——Chrome 的空間壓力 eviction
 * （可用 persist() 豁免，firebase.ts 已在做）與 Safari ITP 的 7 天定時清除
 * （**persist() 一律不核准**，現有防護對它完全無效）。兩者在使用者眼中是同一個症狀，
 * 分不出來就只能繼續猜。順序有意義：Edge/Chrome 的 UA 都含 Safari 字樣，要先排除。
 */
function browserOf(ua?: string): string {
  if (!ua) return '—'
  if (/Edg\//.test(ua)) return 'Edge'
  if (/OPR\//.test(ua)) return 'Opera'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Chrome\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return '其他'
}

/** 三態探針的中文化。與探針色票用同一組字，看列表與看快照才不用轉譯兩次。 */
function triText(t?: Tri): string {
  return t === 'present' ? '在' : t === 'absent' ? '不見' : '測不到'
}

/** SDK 實際生效的儲存層。正常恆為 indexedDB；其餘一律是降級，也就是我們在追的東西。 */
const PERSISTENCE_LABEL: Record<string, string> = {
  indexedDB:      'IndexedDB（正常）',
  localStorage:   'localStorage（已降級）',
  sessionStorage: 'sessionStorage（已降級）',
  inMemory:       '僅記憶體（未落地）',
  unknown:        '測不到',
}

/** 頁面載入方式。用來分辨「開新分頁才發現」與「按 F5 才發現」。 */
const NAV_TYPE_LABEL: Record<string, string> = {
  navigate:     '開新分頁／連結進入',
  reload:       '重新整理（F5）',
  back_forward: '上一頁／下一頁',
  prerender:    '預先轉譯',
}

/**
 * `authRecord` 為何「不見」。三種狀態對應三個完全不同的成因——
 * 這是目前最能一刀切開各假說的一欄，故用白話寫清楚它各自代表什麼。
 */
const AUTH_DETAIL_LABEL: Record<string, string> = {
  present: '憑證記錄在',
  noDb:    'database 整個不存在（被外力刪除）',
  noStore: 'database 在但 object store 不見（Firebase 會據此刪庫重建）',
  noKey:   'database 與 store 都在，但沒有憑證 key（SDK 主動移除）',
  unknown: '測不到',
}

const TRIGGER_LABEL: Record<string, string> = {
  signin:  '登入當下',
  tick:    '使用中心跳',
  hidden:  '分頁離開前',
  visible: '分頁回來時',
}

/**
 * 從證據自動導出判讀提示。
 *
 * 為什麼要做這層：新增的欄位（persistence / lastSeen / authErrors）單看每一項都
 * 只是數字，真正有意義的是**組合**——而人工每次都重新比對一遍既慢又容易漏。
 * 這裡把已知有診斷價值的組合寫死成規則，讓可疑樣本自己浮上來。
 *
 * ⚠ 這只是**提示**，不是判定。`reason` 欄位仍由 classifyLogout 決定（見 sentinel.ts
 *   為什麼刻意不讓這些訊號參與判定）。提示寫錯頂多誤導人一次，判定寫錯會污染整份日誌。
 */
function hintsOf(entry: SystemLogEntry): { tone: 'alert' | 'notice'; text: string }[] {
  const out: { tone: 'alert' | 'notice'; text: string }[] = []
  const p = entry.probes
  const ls = entry.lastSeen
  const gap = entry.sinceSentinelSeenSec

  // ① persistence 降級的指紋：憑證其實還在 localStorage，只是 SDK 這次沒讀那一層
  if (p?.authRecord === 'absent' && p?.authLocal === 'present') {
    out.push({
      tone: 'alert',
      text: 'IndexedDB 憑證不見、localStorage 憑證還在 → 高度指向 persistence 降級（兩層互不讀取）',
    })
  }

  // ② 最直接的證據：**發現登出的那一次載入**，SDK 挑的根本不是 IndexedDB。
  //    這代表 IndexedDBLocalPersistence._isAvailable() 當場失敗了。
  if (entry.persistence && entry.persistence !== 'indexedDB' && entry.persistence !== 'unknown') {
    out.push({
      tone: 'alert',
      text: `本次載入 SDK 挑中的是 ${PERSISTENCE_LABEL[entry.persistence] ?? entry.persistence}，代表 IndexedDB 當場不可用 → 幾乎可確定是 persistence 降級`,
    })
  }

  // ③ 登出前就已經在降級狀態下運作
  if (ls?.persistence && ls.persistence !== 'indexedDB' && ls.persistence !== 'unknown') {
    out.push({
      tone: 'alert',
      text: `登出前 SDK 使用的已經是 ${PERSISTENCE_LABEL[ls.persistence] ?? ls.persistence}，並非 IndexedDB`,
    })
  }

  // ④ 兩層憑證都不見、哨兵卻完好。
  //    對照 @firebase/auth 的 PersistenceUserManager.create：它讀取既有憑證時用
  //    `catch {}` 吞掉錯誤（IndexedDB 讀取失敗＝查無使用者），選定新的一層之後又會
  //    `_remove(key)` 清掉其他層 —— 於是一次瞬間的 IndexedDB 不可用，會把憑證**刪掉**
  //    而不只是讀不到。那條路徑留下的痕跡正好就是這個組合。
  if (p?.authRecord === 'absent' && p?.authLocal === 'absent' && p?.sentinel === 'present') {
    out.push({
      tone: 'notice',
      text: '兩層憑證都不見、哨兵完好 → 不是儲存被清。可能是憑證被撤銷，也可能是 SDK 降級時把 IndexedDB 那筆一併刪了',
    })
  }

  // ⑤ IndexedDB「不見」的細分——目前最能一刀切開各假說的一欄
  if (p?.authDetail === 'noStore') {
    out.push({
      tone: 'alert',
      text: 'database 在但 object store 不見 → 抓到現行犯：Firebase 的 _openDatabase() 遇到這個狀態會 deleteDatabase() 再重建成空的，接著 _poll() 讀到空陣列就把所有 key 判成已刪除 → 登出',
    })
  }
  if (p?.authDetail === 'noDb') {
    out.push({
      tone: 'alert',
      text: 'database 整個不存在 → 被外力刪除（瀏覽器清理，或 Firebase 自己的 _deleteDatabase()）。注意 SDK 初始化會自動重建，能測到這一態代表刪除發生得很近',
    })
  }
  if (p?.authDetail === 'noKey' && p?.authKeyCount === 0) {
    out.push({
      tone: 'notice',
      text: 'store 存在但一個 key 都沒有 → 像是剛被重建的空庫，而非單獨移除憑證那一筆',
    })
  }
  if (p?.authDbVersion !== undefined && p.authDbVersion !== 1) {
    out.push({
      tone: 'notice',
      text: `firebaseLocalStorageDb 版本為 ${p.authDbVersion}（Firebase 固定用 1）→ 有別的東西動過這個資料庫`,
    })
  }

  // ④ 失效區間的形狀。心跳 60 秒一次，所以 ≤3 分鐘等於「就在使用中掉的」
  if (typeof gap === 'number' && ls) {
    if (gap <= 180 && ls.visible) {
      out.push({ tone: 'alert', text: `失效發生在使用中（分頁可見，區間僅 ${fmtDuration(gap)}）` })
    } else if (!ls.visible && gap > 600) {
      out.push({ tone: 'notice', text: `失效發生在分頁離開後的 ${fmtDuration(gap)} 內，並非使用中` })
    }
  }

  // ⑤ token 側的直接證據：登出前 10 分鐘內有 idToken 取得失敗
  const recentErr = entry.authErrors?.filter((e) => {
    const d = entry.occurredAt - e.at
    return d >= 0 && d <= 10 * 60_000
  })
  if (recentErr?.length) {
    out.push({
      tone: 'alert',
      text: `登出前 10 分鐘內有 idToken 取得失敗：${recentErr.map((e) => e.code).join('、')}`,
    })
  }

  // ⑥ token 快到期時掉的 → refresh 沒接上
  if (ls?.tokenExpiresInSec !== undefined && ls.tokenExpiresInSec < 300) {
    out.push({
      tone: 'notice',
      text: `最後一眼時 idToken 只剩 ${fmtDuration(Math.max(0, ls.tokenExpiresInSec))} 到期 → 疑似自動 refresh 沒接上`,
    })
  }

  return out
}

function platformOf(ua?: string): string {
  if (!ua) return '—'
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Android/.test(ua)) return 'Android'
  if (/Mac OS X/.test(ua)) return 'macOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Linux/.test(ua)) return 'Linux'
  return '—'
}

function FilterGroup<T extends string>({
  label,
  options,
  labelOf,
  value,
  onChange,
}: {
  label: string
  options: (T | '')[]
  labelOf: (v: T) => string
  value: T | ''
  onChange: (v: T | '') => void
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-text-dim shrink-0">{label}</span>
      {options.map((opt) => (
        <button
          key={opt || '__all'}
          onClick={() => onChange(opt)}
          className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
            value === opt
              ? 'bg-accent-cyan/15 text-accent-cyan border-accent-cyan/40'
              : 'bg-bg-dark text-text-secondary border-border hover:text-text-primary'
          }`}
        >
          {opt === '' ? '全部' : labelOf(opt)}
        </button>
      ))}
    </div>
  )
}

/** 展開區：完整環境證據。這是判讀成因的原始材料，刻意全部攤開不折疊。 */
function EvidenceView({ entry }: { entry: SystemLogEntry }) {
  const env = entry.env
  const s = entry.session
  const p = entry.probes

  const ls = entry.lastSeen
  const hints = hintsOf(entry)

  const rows: [string, string][] = [
    ['瀏覽器', `${browserOf(env?.ua)} · ${platformOf(env?.ua)}${env?.standalone ? ' · 已加入主畫面' : ''}`],
    ['持久化儲存', env?.persisted === undefined ? '—' : env.persisted ? '✓ 已獲准' : '✗ 未獲准'],
    ['儲存用量', `${fmtBytes(env?.storageUsage)} / ${fmtBytes(env?.storageQuota)}`],
    // 失效區間寬度排在最前面的時間欄位：它比 session 時長更能說明「什麼時候掉的」
    ['距上次確認登入', fmtDuration(entry.sinceSentinelSeenSec)],
    ['本次載入的儲存層', entry.persistence ? (PERSISTENCE_LABEL[entry.persistence] ?? entry.persistence) : '—'],
    ['IndexedDB 狀態', p?.authDetail ? (AUTH_DETAIL_LABEL[p.authDetail] ?? p.authDetail) : '—'],
    ['auth store key 數', p?.authKeyCount === undefined ? '—' : `${p.authKeyCount}${p.authDbVersion !== undefined ? ` · DB v${p.authDbVersion}` : ''}`],
    ['session 時長', fmtDuration(s?.sessionAgeSec)],
    ['本次載入方式', s?.navType ? (NAV_TYPE_LABEL[s.navType] ?? s.navType) : '—'],
    ['距上次 token 更新', fmtDuration(s?.sinceTokenRefreshSec)],
    ['本 session 離線累計', fmtDuration(s?.offlineSec)],
    ['哨兵存活時長', fmtDuration(entry.sentinelAgeSec)],
    ['當時所在頁面', s?.route || '—'],
    ['當時有未存草稿', s?.hadDraft === undefined ? '—' : s.hadDraft ? '是' : '否'],
  ]

  return (
    <div className="space-y-3">
      {/* 判讀提示：把「要人工比對好幾個欄位才看得出來」的組合直接講出來。
          刻意放在最上面——展開記錄的人第一眼要看到的是結論方向，不是原始數字。 */}
      {hints.length > 0 && (
        <div className="space-y-1">
          {hints.map((h, i) => (
            <div
              key={i}
              className={`text-xs px-3 py-1.5 rounded-lg border ${
                h.tone === 'alert'
                  ? 'bg-accent-red/10 text-accent-red border-accent-red/30'
                  : 'bg-accent-yellow/10 text-accent-yellow border-accent-yellow/30'
              }`}
            >
              {h.text}
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-4 gap-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-2 text-xs">
            <span className="text-text-dim shrink-0">{k}</span>
            <span className="text-text-secondary font-mono break-all">{v}</span>
          </div>
        ))}
      </div>

      {/* 探針原始值：保留它而非只存結論，判定邏輯日後改版可重新推算舊資料 */}
      {p && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-text-dim">探針：</span>
          {/* authRecord 標為「佐證」：它不參與判定，只是人工判讀時的線索。
              不標的話很容易讓人以為紅字代表判定依據。 */}
          {([
            ['哨兵', p.sentinel],
            ['cookie', p.cookie],
            ['Auth@IDB(佐證)', p.authRecord],
            ['Auth@localStorage(佐證)', p.authLocal],
          ] as const).map(
            ([name, val]) => (
              <span
                key={name}
                className={`px-1.5 py-0.5 text-[11px] font-mono rounded border ${
                  val === 'present'
                    ? 'bg-accent-green/10 text-accent-green border-accent-green/30'
                    : val === 'absent'
                      ? 'bg-accent-red/10 text-accent-red border-accent-red/30'
                      : 'bg-bg-dark text-text-dim border-border'
                }`}
              >
                {name} {val === 'present' ? '在' : val === 'absent' ? '不見' : '測不到'}
              </span>
            ),
          )}
        </div>
      )}

      {/* 登出前的最後一眼：失效區間的下界。與上方「登出當下」的探針逐項對照，
          就知道這段期間內究竟是哪一項變了 —— 這是心跳存在的全部理由。 */}
      {ls && (
        <div className="rounded-lg border border-border bg-bg-dark px-3 py-2 space-y-1.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[11px] text-accent-cyan font-medium">登出前最後一眼</span>
            <span className="text-[11px] text-text-dim font-mono">{fmtTime(ls.at)}</span>
            <span className="text-[11px] text-text-dim">
              {TRIGGER_LABEL[ls.trigger] ?? ls.trigger} · 分頁{ls.visible ? '可見' : '不可見'}
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-4 gap-y-1">
            {([
              ['Auth 儲存層', PERSISTENCE_LABEL[ls.persistence] ?? ls.persistence],
              ['當時探針', `哨兵 ${triText(ls.sentinel)} · cookie ${triText(ls.cookie)} · IDB ${triText(ls.authRecord)} · LS ${triText(ls.authLocal)}`],
              ['idToken 剩餘', ls.tokenExpiresInSec === undefined ? '—' : fmtDuration(ls.tokenExpiresInSec)],
              ['idToken 簽發於', ls.tokenIssuedAt ? fmtTime(ls.tokenIssuedAt) : '—'],
              ['當時所在頁面', ls.route || '—'],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-2 text-xs">
                <span className="text-text-dim shrink-0">{k}</span>
                <span className="text-text-secondary font-mono break-all">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* idToken 取得失敗記錄。跨 session 累積（最多 5 筆），用來看是不是 refresh 側的問題。 */}
      {entry.authErrors && entry.authErrors.length > 0 && (
        <div className="rounded-lg border border-accent-orange/30 bg-accent-orange/5 px-3 py-2">
          <div className="text-[11px] text-accent-orange font-medium mb-1">近期 idToken 取得失敗</div>
          {entry.authErrors.map((e, i) => (
            <div key={i} className="text-xs font-mono text-text-secondary">
              {fmtTime(e.at)} · {e.code}
            </div>
          ))}
        </div>
      )}

      {entry.kind === 'writeDenied' && (
        <div className="text-xs text-text-secondary">
          寫入目標：<span className="font-mono">{entry.coll}/{entry.docId}</span>
        </div>
      )}

      {env?.ua && (
        <div className="text-[11px] text-text-dim font-mono break-all bg-bg-dark border border-border rounded-lg px-3 py-2">
          {env.ua}
        </div>
      )}
    </div>
  )
}

/** 成因分布摘要。本計畫的產出重點——後續對策要靠這個分布決定，而不是再一次憑印象猜。 */
function SummaryPanel({ summary }: { summary: { total: number; byReason: Record<string, number> } | null }) {
  if (!summary || summary.total === 0) return null
  const entries = Object.entries(summary.byReason).sort((a, b) => b[1] - a[1])
  return (
    <div className="bg-bg-card border border-border rounded-xl px-4 py-3 mb-5">
      <div className="text-[10px] font-[Orbitron,sans-serif] tracking-[2px] text-text-dim uppercase mb-2">
        最近 {summary.total} 筆的成因分布
      </div>
      <div className="space-y-1.5">
        {entries.map(([reason, count]) => {
          const pct = Math.round((count / summary.total) * 100)
          const sev = REASON_SEVERITY[reason as LogoutReason] ?? 'notice'
          const label = REASON_LABEL[reason as LogoutReason] ?? reason
          return (
            <div key={reason} className="flex items-center gap-3">
              <span className="text-xs text-text-secondary w-40 shrink-0 truncate">{label}</span>
              <div className="flex-1 h-2 bg-bg-dark border border-border rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    sev === 'alert' ? 'bg-accent-red' : sev === 'notice' ? 'bg-accent-yellow' : 'bg-text-dim'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs text-text-dim font-mono w-16 text-right shrink-0">
                {count} · {pct}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function AdminSystemLogPage() {
  const [kind, setKind] = useState<SystemLogKind | ''>('')
  const [reason, setReason] = useState<LogoutReason | ''>('')

  const [items, setItems] = useState<SystemLogEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [summary, setSummary] = useState<{ total: number; byReason: Record<string, number> } | null>(null)

  // 游標與請求序號放 ref：切換篩選要重置游標重新查詢，序號用來丟棄慢速回應——
  // 快速連點篩選時，舊請求的結果不可覆蓋新篩選的列表。（同 AdminHistoryPage）
  const cursorRef = useRef<PageCursor>(null)
  const reqSeqRef = useRef(0)

  const fetchPage = useCallback(async (reset: boolean) => {
    const seq = ++reqSeqRef.current
    setLoading(true)
    setError(null)
    if (reset) cursorRef.current = null
    try {
      const page = await getSystemLogPage({
        kind: kind || undefined,
        reason: reason || undefined,
        cursor: cursorRef.current,
        pageSize: PAGE_SIZE,
      })
      if (seq !== reqSeqRef.current) return
      cursorRef.current = page.cursor
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]))
      setHasMore(page.hasMore)
    } catch (err) {
      if (seq !== reqSeqRef.current) return
      console.error('[AdminSystemLogPage] 查詢失敗:', err)
      setError(err instanceof Error ? err.message : '查詢系統日誌失敗')
    } finally {
      if (seq === reqSeqRef.current) setLoading(false)
    }
  }, [kind, reason])

  useEffect(() => {
    void fetchPage(true)
  }, [fetchPage])

  // 摘要獨立查詢：列表會被篩選影響，摘要必須永遠是「未篩選的最近 N 筆」才有代表性。
  useEffect(() => {
    void getSystemLogSummary()
      .then(setSummary)
      .catch((err) => console.warn('[AdminSystemLogPage] 摘要查詢失敗:', err))
  }, [])

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">

      {/* 麵包屑 */}
      <div className="flex items-center gap-2 text-xs text-text-dim mb-4">
        <Link to="/admin" className="hover:text-text-secondary transition-colors no-underline">後台管理</Link>
        <span>›</span>
        <span className="text-accent-cyan">系統日誌</span>
      </div>

      {/* 頁首 */}
      <div className="mb-6">
        <div className="text-[10px] font-[Orbitron,sans-serif] tracking-[3px] text-accent-cyan uppercase mb-1">
          Owner · System Log
        </div>
        <h1 className="text-2xl font-bold text-text-primary">系統日誌</h1>
        <p className="text-text-dim text-sm mt-1">
          維護者非預期登出與寫入被拒的診斷記錄（僅可新增、不可竄改），保留 90 天後自動清除。
        </p>
      </div>

      <SummaryPanel summary={summary} />

      {/* 雙軸篩選 */}
      <div className="bg-bg-card border border-border rounded-xl px-4 py-3 mb-5 space-y-2">
        <FilterGroup
          label="事件"
          options={KIND_OPTIONS}
          labelOf={(v) => KIND_LABEL[v]}
          value={kind}
          onChange={setKind}
        />
        <FilterGroup
          label="成因"
          options={REASON_OPTIONS}
          labelOf={(v) => REASON_LABEL[v]}
          value={reason}
          onChange={setReason}
        />
      </div>

      {/* 錯誤 */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-accent-red/10 border border-accent-red/30 text-accent-red text-sm">
          {error}
        </div>
      )}

      {/* 首次載入骨架 */}
      {loading && items.length === 0 && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-bg-card border border-border rounded-xl h-14 animate-pulse" />
          ))}
        </div>
      )}

      {/* 記錄列表 */}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((e) => {
            const isOpen = expanded.has(e.id)
            const sev = REASON_SEVERITY[e.reason as LogoutReason] ?? 'notice'
            const reasonLabel = REASON_LABEL[e.reason as LogoutReason] ?? e.reason
            // 佇列延遲上報：at（伺服器寫入）與 occurredAt（本機發生）差距明顯時標出來，
            // 否則看列表的人會以為事件發生在重新登入的那一刻。
            const atMs = e.at ? e.at.toDate().getTime() : 0
            const delayed = atMs && e.occurredAt && atMs - e.occurredAt > 5 * 60_000
            return (
              <div key={e.id} className="bg-bg-card border border-border rounded-xl overflow-hidden">
                <div
                  className="px-4 py-3 flex items-center gap-3 flex-wrap cursor-pointer hover:bg-bg-card-hover transition-colors"
                  onClick={() => toggleExpand(e.id)}
                >
                  <span className="text-xs text-text-dim font-mono shrink-0 w-36">
                    {fmtTime(e.occurredAt)}
                  </span>
                  <span className={`px-2 py-0.5 text-xs font-bold rounded border shrink-0 ${KIND_CHIP[e.kind]}`}>
                    {KIND_LABEL[e.kind]}
                  </span>
                  <span className={`px-2 py-0.5 text-xs rounded border shrink-0 ${SEVERITY_CHIP[sev]}`}>
                    {reasonLabel}
                  </span>
                  <span className="text-sm text-text-primary font-medium">{e.actorName}</span>
                  {delayed && (
                    <span className="text-[11px] text-text-dim" title="事件發生後隔了一段時間才隨下次登入補送">
                      （延遲上報）
                    </span>
                  )}
                  <span className="text-xs text-text-dim ml-auto shrink-0">
                    {browserOf(e.env?.ua)} · {platformOf(e.env?.ua)}
                  </span>
                  <span className={`text-text-dim text-xs shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                </div>

                {isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-border">
                    <EvidenceView entry={e} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 空狀態 */}
      {!loading && !error && items.length === 0 && (
        <div className="text-center py-16 text-text-dim">
          <div className="text-4xl mb-3">🩺</div>
          <p className="text-sm">沒有符合條件的診斷記錄</p>
          <p className="text-xs mt-2 max-w-md mx-auto leading-relaxed">
            空白是好事——代表這段期間沒有維護者遇到非預期登出。
            主動登出與匿名訪客不會進入本日誌。
          </p>
        </div>
      )}

      <LoadMoreButton hasMore={hasMore} loading={loading} onClick={() => void fetchPage(false)} />
    </div>
  )
}
