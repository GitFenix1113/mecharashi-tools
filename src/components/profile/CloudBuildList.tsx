// 個人中心的「我的配裝」—— PLAN-052-E C-6
//
// 取代 v1 的 `getUserBuilds()` ＋ `BuildCard`（那個模型已隨 B-6 整條刪除）。
// 這裡列的是雲端書架 `users/{uid}/builds/{pilotId}`：**按機師分組，每組最多 5 張卡**。
//
// ⚠ **本元件刻意獨立成檔並由分頁條件式掛載**，而不是寫在 ProfilePage 裡：
//   它要 `useLoadoutGameData('equip')`（把代碼解出名稱、機甲、失效三態需要六個集合），
//   而 hook 不能條件式呼叫。寫在 ProfilePage 裡就變成「只是開個人資料頁也把整個
//   遊戲資料庫拉一次」。掛載時機＝使用者真的點開「我的配裝」，與舊版只在開分頁時
//   才 fetch 是同一個行為。
//   （多數情況下那份資料已在 localStorage 快取裡 —— 會有雲端存檔，就代表用過模擬器。）
//
// ⚠ 失效三態走 `classifyBuild()`（052-E C-5 搬到 `lib/buildStatus.ts` 的那一支），
//   **不另寫一份**：兩份判定遲早會在同一串代碼上給出不同答案 —— 同一套配裝，
//   在模擬器書架顯示「可套用」、在這裡顯示「已失效」。
//
// ⚠ 「載入配裝」帶的是**代碼**（`/simulator?b=…`），與書架、分享碼同一條路徑。
//   v1 那條 `navigate('/simulator', { state: { build } })` 已刪 —— 它是第二種進場方式，
//   而第二種進場方式意味著 LoadoutPage 要維護兩套還原邏輯。

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLoadoutGameData } from '../../hooks/useFirestore'
import { CLOUD_SLOTS, CLOUD_SLOTS_PER_PILOT, type CloudSlot } from '../../types/loadout'
import { classifyBuild, type BuildStatus } from '../../lib/buildStatus'
import { listCloudBuilds, deleteCloudBuild, type CloudBuildEntry, type CloudBuildsFailure } from '../../lib/buildsApi'
import { buildShareIndex } from '../../utils/loadoutCode/shareId'
import { shareIdAliases, shareIdRegisteredIds } from '../../utils/loadoutCode/shareIdRegistry'
import { SHARE_PARAM } from '../../utils/loadoutCode/shareLink'
import type { ShareIndexes } from '../../utils/loadoutCode/codec'

const LOAD_ERROR: Record<CloudBuildsFailure, string> = {
  offline: '現在連不上伺服器，讀不到雲端書架。網路回來之後重新整理一次。',
  denied: '伺服器拒絕了這次讀取。多半是登入憑證過期了 —— 請先登出再登入一次。',
  unknown: '讀取雲端書架時發生預期外的錯誤，請稍後再試。',
  pending: '伺服器一直沒有回應，這次操作還沒送達。連線恢復後重新整理看看。',
  'code-too-long': '', 'code-charset': '', 'code-empty': '', 'invalid-pilot-id': '', 'invalid-slot': '',
}

export default function CloudBuildList({ uid }: { uid: string }) {
  const navigate = useNavigate()
  const { data, loading } = useLoadoutGameData('equip')
  const [entries, setEntries] = useState<CloudBuildEntry[] | null>(null)
  const [error, setError] = useState<CloudBuildsFailure | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void listCloudBuilds(uid).then((r) => {
      if (!alive) return
      if (r.ok) { setEntries(r.entries); setError(null) }
      else { setEntries([]); setError(r.reason) }
    })
    return () => { alive = false }
  }, [uid])

  const indexes = useMemo<ShareIndexes>(() => ({
    pilot: buildShareIndex('pilot', data.pilots.map((x) => x.id)),
    mech: buildShareIndex('mech', data.mechs.map((x) => x.id)),
    weapon: buildShareIndex('weapon', data.weapons.map((x) => x.id)),
    backpack: buildShareIndex('backpack', data.backpacks.map((x) => x.id)),
    component: buildShareIndex('component', data.components.map((x) => x.id)),
    // ⚠ 第三個參數（別名表）不可省：41 顆模組的號碼是**手工指派**的，推導不出來。
    //   少了它，那些模組一律解不出 docId ⇒ 每一套帶模組的存檔都會被誤判成
    //   「有 N 項裝備已下架」——實機跑 052-E C-6 時就是這樣紅了兩張卡。
    //   （LoadoutPage 的 shareIndexes 一直有帶，這裡是接線層漏抄。）
    module: buildShareIndex('module', data.modules.map((x) => x.id), shareIdAliases('module')),
    // ⚠ 技能的來源是**登錄簿而不是集合**（PLAN-052-L D-2）：這一頁根本沒載 `pilotSkills`
    //   （`useLoadoutGameData('equip')` 不含它），傳空陣列就會讓每一套帶技能的存檔
    //   被誤判成「有 N 項裝備已下架」——與上面那條模組別名漏抄是同一種錯。理由詳見
    //   `shareIdRegisteredIds()`。
    pilotSkill: buildShareIndex('pilotSkill', shareIdRegisteredIds('pilotSkill'), shareIdAliases('pilotSkill')),
  }), [data])

  const pilotName = useMemo(
    () => new Map(data.pilots.map((p) => [p.id, p.name])),
    [data.pilots],
  )
  const mechName = useMemo(
    () => new Map(data.mechs.map((m) => [m.id, m.name])),
    [data.mechs],
  )

  const remove = async (pilotId: string, slot: CloudSlot) => {
    const key = `${pilotId}:${slot}`
    setBusy(key)
    const r = await deleteCloudBuild(uid, pilotId, slot)
    setBusy(null)
    setPendingDelete(null)
    if (!r.ok) { setError(r.reason); return }
    setEntries((prev) => (prev ?? []).flatMap((e) => {
      if (e.pilotId !== pilotId) return [e]
      const next = { ...e.slots }
      delete next[slot]
      // 最後一格被刪掉時整份文件也刪了（`deleteCloudBuild` 會處理），這裡跟著移除
      return Object.keys(next).length === 0 ? [] : [{ ...e, slots: next }]
    }))
  }

  if (entries === null) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-8 text-center text-text-dim">
        讀取雲端書架中...
      </div>
    )
  }

  if (error && LOAD_ERROR[error]) {
    return (
      <div className="bg-bg-card border border-accent-red/30 rounded-xl p-6 text-center">
        <p className="text-[13px] text-accent-red leading-relaxed">{LOAD_ERROR[error]}</p>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
        <div className="text-3xl mb-3">📋</div>
        <p className="text-text-dim text-sm">雲端還沒有配裝</p>
        <p className="text-text-dim text-[12px] mt-2 leading-relaxed">
          在配裝模擬器配好一套，打開「書架 → 雲端」就能存進來。
          <br />每位機師 {CLOUD_SLOTS_PER_PILOT} 格，換一台裝置登入一樣看得到。
        </p>
      </div>
    )
  }

  const total = entries.reduce((n, e) => n + CLOUD_SLOTS.filter((s) => e.slots[s] !== undefined).length, 0)

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12px] text-text-dim">
        共 {total} 套，分在 {entries.length} 位機師底下（每位上限 {CLOUD_SLOTS_PER_PILOT} 格）。
      </p>

      {entries.map((entry) => {
        const slots = CLOUD_SLOTS.filter((s) => entry.slots[s] !== undefined)
        return (
          <section key={entry.pilotId} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <h3 className="text-[15px] font-bold text-text-primary">
                {pilotName.get(entry.pilotId) ?? entry.pilotId}
              </h3>
              <span className="text-[12px] text-text-dim font-[JetBrains_Mono,monospace] tabular-nums">
                {slots.length}/{CLOUD_SLOTS_PER_PILOT}
              </span>
            </div>

            {slots.map((slot) => {
              const code = entry.slots[slot]!
              const key = `${entry.pilotId}:${slot}`
              return (
                <BuildRow
                  key={key}
                  slot={slot}
                  // 資料還沒齊時不判三態：索引不完整會把每一筆都算成「機甲查不到」，
                  // 使用者看到整頁存檔標紅是最嚇人的誤報（052-G 決策六，同書架那份 gate）
                  status={loading ? null : classifyBuild(code, indexes)}
                  mechNameOf={(id) => mechName.get(id) ?? id}
                  confirming={pendingDelete === key}
                  busy={busy === key}
                  onLoad={() => navigate(`/simulator?${SHARE_PARAM}=${code}`)}
                  onAskDelete={() => setPendingDelete(key)}
                  onCancelDelete={() => setPendingDelete(null)}
                  onDelete={() => void remove(entry.pilotId, slot)}
                />
              )
            })}
          </section>
        )
      })}
    </div>
  )
}

function BuildRow({
  slot, status, mechNameOf, confirming, busy, onLoad, onAskDelete, onCancelDelete, onDelete,
}: {
  slot: CloudSlot
  /** `null` ＝ 遊戲資料還在載入，這時不判三態也不給載入 */
  status: BuildStatus | null
  mechNameOf: (id: string) => string
  confirming: boolean
  busy: boolean
  onLoad: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
}) {
  const d = status?.draft
  const broken = status?.state === 'broken'
  const title = d?.name || (d?.mechId ? mechNameOf(d.mechId) : null) || `第 ${Number(slot) + 1} 格`

  return (
    <div className={`bg-bg-card border rounded-xl p-4 flex items-start gap-4 transition-colors ${
      broken ? 'border-accent-red/30' : status?.state === 'degraded' ? 'border-accent-yellow/30' : 'border-border hover:border-border-accent'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] text-text-dim font-[JetBrains_Mono,monospace] tabular-nums shrink-0">
            {Number(slot) + 1}
          </span>
          <span className="font-bold text-base truncate">{title}</span>
        </div>

        {!status ? (
          <div className="text-[13px] text-text-dim mt-1.5">載入遊戲資料中...</div>
        ) : broken ? (
          <div className="text-[13px] text-accent-red mt-1.5 leading-relaxed">
            {status.message ?? '這套的機師或機甲在站上查不到，沒辦法載入。代碼還留著 —— 如果是剛改版，之後可能就回來了。'}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
              {d?.mechId && (
                <span className="text-[13px] text-text-dim">
                  機甲: <span className="text-text-secondary">{mechNameOf(d.mechId)}</span>
                </span>
              )}
              <span className="text-[13px] text-text-dim">
                武器: <span className="text-text-secondary">
                  {Object.values(d?.sets ?? {}).reduce((n, s) => n + (s.mounts?.length ?? 0), 0)} 把
                </span>
              </span>
              {Object.keys(d?.sets ?? {}).length > 1 && (
                <span className="text-[13px] text-text-dim">
                  形態: <span className="text-text-secondary">{Object.keys(d!.sets).length} 套</span>
                </span>
              )}
            </div>
            {status.state === 'degraded' && (
              <div className="text-[12px] text-accent-yellow/90 mt-1.5 leading-relaxed">
                有 {status.missing.length} 項裝備已下架，載入後那幾格會是空的。
              </div>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 flex flex-col gap-1 items-end">
        {confirming ? (
          <>
            <span className="text-[12px] text-accent-red">刪掉就找不回來了</span>
            <div className="flex gap-1">
              <button
                onClick={onCancelDelete}
                className="px-2.5 py-1 text-xs border border-border rounded-lg text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={onDelete}
                disabled={busy}
                className="px-2.5 py-1 text-xs bg-accent-red/10 text-accent-red border border-accent-red/30 rounded-lg hover:bg-accent-red/20 transition-colors cursor-pointer disabled:opacity-40"
              >
                {busy ? '...' : '確定刪除'}
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              onClick={onLoad}
              disabled={!status || broken}
              title={broken ? '這套的機師或機甲查不到，載入只會得到空的模擬器' : undefined}
              className="px-3 py-1.5 text-xs font-medium bg-accent-orange/10 text-accent-orange border border-accent-orange/30 rounded-lg hover:bg-accent-orange/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              載入配裝
            </button>
            <button
              onClick={onAskDelete}
              className="p-1.5 text-text-dim hover:text-accent-red transition-colors cursor-pointer"
              title="刪除配裝"
            >
              🗑️
            </button>
          </>
        )}
      </div>
    </div>
  )
}
