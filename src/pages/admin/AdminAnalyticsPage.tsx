import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  clearAnalyticsCache,
  getDailyRange,
  getEntityMonth,
  sumField,
  sumMap,
  sumRoutes,
  toRanking,
} from '../../lib/firestoreApi'
import { ROUTE_LABELS } from '../../lib/analytics/routeKeys'
import {
  AUTH_LABEL,
  DEVICE_LABEL,
  ENTITY_KIND_LABEL,
  LANG_LABEL,
  type AnalyticsDaily,
  type AnalyticsEntityMonth,
  type EntityKind,
} from '../../types/analytics'
import { StatCard } from '../../components/admin/analytics/StatCard'
import { BarList, type BarItem } from '../../components/admin/analytics/BarList'
import { TrendChart, type TrendPoint } from '../../components/admin/analytics/TrendChart'

// ─── 使用統計儀表板（PLAN-046 Phase B）───────────────────────────────────────
//
// 讀取權限由 firestore.rules 的 isAdmin() 把關；本頁入口在 AdminPage 也只對
// ADMIN/OWNER 顯示，但**規則才是真正的防線**，UI 隱藏只是避免點進來吃權限錯誤。
//
// 不進 GameDataContext（統計沒有版本 gate 概念），比照 changeHistory / systemLog
// 直接走 API 層；讀取端有 5 分鐘記憶體快取，看 30 天約 31 次讀取。

type Range = 7 | 30 | 90
type Metric = 'upv' | 'sessions' | 'visitors'

const RANGE_OPTIONS: Range[] = [7, 30, 90]

const METRIC_LABEL: Record<Metric, string> = {
  upv: '有效瀏覽',
  sessions: '造訪次數',
  visitors: '不重複訪客',
}

/** 目前月份（UTC+8）。entity 文件是月粒度。 */
function currentMonth(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 7)
}

function fmtTime(seconds?: number): string {
  if (!seconds) return ''
  const d = new Date(seconds * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-bg-card border border-border rounded-xl p-4">
      <h2 className="text-sm font-bold text-text-primary mb-1">{title}</h2>
      {hint && <p className="text-[11px] text-text-dim mb-3 leading-snug">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </section>
  )
}

export default function AdminAnalyticsPage() {
  const [range, setRange] = useState<Range>(30)
  const [days, setDays] = useState<AnalyticsDaily[]>([])
  const [entity, setEntity] = useState<AnalyticsEntityMonth | null>(null)
  const [entityKind, setEntityKind] = useState<EntityKind>('pilots')
  const [metric, setMetric] = useState<Metric>('upv')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 「重新整理」用的觸發器。改用計數器而非直接呼叫 loader，是為了讓查詢**只**由
  // 這個 effect 發動——狀態更新全部落在 promise 回呼裡，不在 effect 本體同步呼叫
  // setState（那會造成連鎖 render，也是 react-hooks/set-state-in-effect 擋的東西）。
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    // 切換區間時舊資料**刻意留在畫面上**直到新資料回來：閃一下空白再填回去，
    // 比多等 200ms 更難讀。加上 5 分鐘快取，第二次之後幾乎是瞬間。
    let cancelled = false
    Promise.all([getDailyRange(range), getEntityMonth(currentMonth())])
      .then(([d, e]) => {
        if (cancelled) return
        setDays(d)
        setEntity(e)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('[AdminAnalyticsPage] 查詢失敗:', err)
        setError(err instanceof Error ? err.message : '查詢使用統計失敗')
      })
      .finally(() => {
        // 快速連點區間時，舊查詢的回應不可覆蓋新查詢的結果
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [range, reloadKey])

  const truncated = useMemo(() => days.filter((d) => !!d.truncatedAt), [days])

  // 趨勢與排行一律**排除資料不完整的日子**：熔斷後的曲線看起來完全正常，
  // 混進來比較就是拿少了半天的數字當基準。
  const cleanDays = useMemo(() => days.filter((d) => !d.truncatedAt), [days])

  const totals = useMemo(
    () => ({
      pv: sumField(cleanDays, 'pv'),
      upv: sumField(cleanDays, 'upv'),
      sessions: sumField(cleanDays, 'sessions'),
      visitors: sumField(cleanDays, 'visitors'),
    }),
    [cleanDays],
  )

  const hasData = totals.pv > 0 || totals.sessions > 0

  const trend: TrendPoint[] = useMemo(
    () => days.map((d) => ({ date: d.date, value: d[metric] ?? 0, truncated: !!d.truncatedAt })),
    [days, metric],
  )

  const routeItems: BarItem[] = useMemo(() => {
    const merged = sumRoutes(cleanDays)
    return Object.entries(merged)
      .filter(([, v]) => v.upv > 0)
      .sort((a, b) => b[1].upv - a[1].upv)
      .map(([key, v]) => ({
        key,
        // 對不到標籤就顯示 key 原文：Worker 端刻意不做名單過濾（決策八），
        // 所以理論上可能出現未登記的 key。讓它以「看得懂的雜訊」出現，而不是被吞掉。
        label: ROUTE_LABELS[key] ?? key,
        value: v.upv,
        sub: v.pv > v.upv ? `／${v.pv}` : undefined,
      }))
  }, [cleanDays])

  const mapToItems = useCallback(
    (map: Record<string, number>, labels: Record<string, string>, limit = 12): BarItem[] =>
      toRanking(map, limit).map(({ key, value }) => ({
        key,
        label: labels[key] ?? key,
        value,
      })),
    [],
  )

  const langItems = useMemo(() => mapToItems(sumMap(cleanDays, (d) => d.byLang), LANG_LABEL), [cleanDays, mapToItems])
  const countryItems = useMemo(() => mapToItems(sumMap(cleanDays, (d) => d.byCountry), {}), [cleanDays, mapToItems])
  const authItems = useMemo(() => mapToItems(sumMap(cleanDays, (d) => d.byAuth), AUTH_LABEL), [cleanDays, mapToItems])
  const deviceItems = useMemo(() => mapToItems(sumMap(cleanDays, (d) => d.byDevice), DEVICE_LABEL), [cleanDays, mapToItems])
  const refItems = useMemo(
    () => mapToItems(sumMap(cleanDays, (d) => d.byRef), { direct: '直接進入／站內' }, 10),
    [cleanDays, mapToItems],
  )

  const entityItems: BarItem[] = useMemo(() => {
    const map = entity?.[entityKind] ?? {}
    return toRanking(map, 20).map(({ key, value }) => ({ key, label: key, value }))
  }, [entity, entityKind])

  const bounceRatio = totals.upv > 0 ? (totals.pv / totals.upv).toFixed(2) : '—'

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">
      {/* 麵包屑 */}
      <div className="flex items-center gap-2 text-xs text-text-dim mb-4">
        <Link to="/admin" className="hover:text-text-secondary transition-colors no-underline">後台管理</Link>
        <span>›</span>
        <span className="text-text-secondary">使用統計</span>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
        <h1 className="text-xl font-bold text-accent-purple">網站使用統計</h1>
        <div className="flex items-center gap-2">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                range === r
                  ? 'bg-accent-purple/15 text-accent-purple border-accent-purple/40'
                  : 'bg-bg-dark text-text-secondary border-border hover:text-text-primary'
              }`}
            >
              {r} 天
            </button>
          ))}
          <button
            onClick={() => { clearAnalyticsCache(); setReloadKey((k) => k + 1) }}
            className="px-3 py-1 rounded-lg text-xs border border-border bg-bg-dark text-text-dim hover:text-text-secondary transition-colors"
            title="統計有 5 分鐘記憶體快取，這裡可強制重讀"
          >
            重新整理
          </button>
        </div>
      </div>
      <p className="text-[11px] text-text-dim mb-5">
        匿名彙總資料，不含任何個人瀏覽紀錄。日界線為台北時間（UTC+8）。
      </p>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-accent-red/30 bg-accent-red/10 text-xs text-accent-red">
          {error}
        </div>
      )}

      {truncated.length > 0 && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-accent-red/30 bg-accent-red/10 text-xs text-text-secondary">
          <b className="text-accent-red">⚠ 有 {truncated.length} 天的資料不完整</b>
          ——當日達到寫入預算而中止記錄，之後的瀏覽沒有被記到。
          <b>這些日子已排除在下方所有數字與排行之外</b>（趨勢圖仍畫出來但標紅圈），
          避免用少了半天的數字當比較基準。<br />
          <span className="text-text-dim">
            {truncated.map((d) => `${d.date}（${fmtTime(d.truncatedAt?.seconds)} 起中止）`).join('、')}
          </span>
        </div>
      )}

      {loading && days.length === 0 ? (
        <div className="text-sm text-text-dim py-10 text-center">載入中…</div>
      ) : !hasData ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {/* 總量 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="有效瀏覽 UPV" value={totals.upv.toLocaleString()} hint="同一次造訪內同頁只算一次" accent="cyan" />
            <StatCard label="造訪次數" value={totals.sessions.toLocaleString()} hint="閒置 10 分鐘即算新的一次" accent="purple" />
            <StatCard label="不重複訪客" value={totals.visitors.toLocaleString()} hint="以裝置估算，清快取會多算" accent="green" />
            <StatCard label="折返率" value={bounceRatio} hint={`原始瀏覽 ${totals.pv.toLocaleString()} ÷ 有效瀏覽`} accent="orange" />
          </div>

          <Section
            title="每日趨勢"
            hint="缺漏的日子補零，不做平滑——把沒有流量的日子連成直線會看起來像有穩定流量。"
          >
            <div className="flex items-center gap-2 mb-2">
              {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMetric(m)}
                  className={`px-2.5 py-0.5 rounded text-[11px] border transition-colors ${
                    metric === m
                      ? 'bg-accent-cyan/15 text-accent-cyan border-accent-cyan/40'
                      : 'bg-bg-dark text-text-dim border-border hover:text-text-secondary'
                  }`}
                >
                  {METRIC_LABEL[m]}
                </button>
              ))}
            </div>
            <TrendChart points={trend} />
          </Section>

          <Section
            title="頁面熱度"
            hint="數字為有效瀏覽；後方灰字是含來回點擊的原始次數。兩者差距越大，代表該頁被反覆折返查看——通常是「資訊沒一次給足」的訊號。"
          >
            <BarList items={routeItems} accent="cyan" empty="這段期間沒有任何頁面被瀏覽" />
          </Section>

          <div className="grid md:grid-cols-2 gap-4">
            <Section
              title="語言分布"
              hint="使用者的瀏覽器語言＝「誰在讀」。這是描述受眾組成的維度，不受 VPN 影響。"
            >
              <BarList items={langItems} accent="purple" />
            </Section>
            <Section
              title="國家／地區分布"
              hint="連線的網路位置，不等於受眾語言——國際服玩家散布各國、中國玩家常經 VPN 顯示為他國。要看受眾請對照左側語言分布。XX 為無法判定。"
            >
              <BarList items={countryItems} accent="green" />
            </Section>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Section title="訪客組成" hint="以造訪次數計。具後台權限的角色一律不計入統計。">
              <BarList items={authItems} accent="orange" />
              <div className="h-3" />
              <BarList items={deviceItems} accent="cyan" />
            </Section>
            <Section title="來源" hint="以造訪次數計。站內跳轉與直接輸入網址皆歸「直接進入」。">
              <BarList items={refItems} accent="purple" />
            </Section>
          </div>

          <Section
            title={`熱門${ENTITY_KIND_LABEL[entityKind]} TOP 20`}
            hint={`本月（${currentMonth()}）累計，同一次造訪內同一個實體只算一次。這份排行的用途是決定「資料要優先補誰」。`}
          >
            <div className="flex items-center gap-2 mb-3">
              {(Object.keys(ENTITY_KIND_LABEL) as EntityKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setEntityKind(k)}
                  className={`px-2.5 py-0.5 rounded text-[11px] border transition-colors ${
                    entityKind === k
                      ? 'bg-accent-purple/15 text-accent-purple border-accent-purple/40'
                      : 'bg-bg-dark text-text-dim border-border hover:text-text-secondary'
                  }`}
                >
                  {ENTITY_KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <BarList items={entityItems} accent="purple" empty="本月還沒有詳情頁被瀏覽" />
          </Section>

          <Caveats />
        </div>
      )}
    </div>
  )
}

/**
 * 空狀態。
 *
 * 這個畫面在正常運作下也會出現（埋點剛上線、或選了還沒有資料的區間），
 * 所以不能只寫「沒有資料」——要說清楚為什麼，以及**站長自己逛站是驗證不到的**。
 * 那是排除規則的直接後果，不講的話最可能的結論會是「功能壞了」。
 */
function EmptyState() {
  return (
    <div className="bg-bg-card border border-border rounded-xl px-5 py-6 text-sm text-text-secondary space-y-3">
      <div className="text-text-primary font-bold">這段期間還沒有統計資料</div>
      <p className="text-xs leading-relaxed">
        統計自 2026-08-08 起才開始記錄，<b>不會回溯</b>先前的瀏覽。若埋點剛上線，等一段時間再回來即可。
      </p>
      <div className="text-xs leading-relaxed border-l-2 border-accent-yellow/50 pl-3">
        <b className="text-accent-yellow">想自己驗證的話：用無痕視窗</b><br />
        具後台權限的角色（ADMIN／OWNER）<b>一律不計入統計</b>——這是刻意的，
        否則以本站的流量規模，維護者巡站就足以構成一成以上的噪音，
        還會把「編輯者常看的頁」推上熱度排行。<br />
        因此<b>用你自己的帳號逛站是驗證不到的</b>。請開無痕視窗（未登入＝訪客＝計入），
        逛幾頁後<b>切換分頁或關閉視窗</b>——資料是在離站時才批次送出的，停在頁面上等不會有東西。
      </div>
    </div>
  )
}

/** 誤差說明。不寫的話，這些數字很容易被當成精確值使用。 */
function Caveats() {
  return (
    <div className="text-[11px] text-text-dim leading-relaxed border-t border-border pt-3 space-y-1">
      <div className="text-text-secondary font-bold">數字的已知限制</div>
      <div>· <b>不重複訪客是裝置估算值</b>：清快取、無痕視窗、換裝置都會被算成新的人。</div>
      <div>· <b>去重窗口是 10 分鐘</b>（多數統計工具用 30 分鐘），不可直接與其他站的數字比較。</div>
      <div>· <b>國家是連線位置不是受眾語言</b>：VPN 會讓中國訪客顯示為他國，請對照語言分布判讀。</div>
      <div>· 使用者關閉頁面太快時，少數資料可能來不及送出。</div>
      <div>· 爬蟲只擋得掉機房 IP；住宅代理仍可能混入。</div>
    </div>
  )
}
