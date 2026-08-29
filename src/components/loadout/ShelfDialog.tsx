// 書架對話框 —— PLAN-052-C Phase D / D-1（本機）＋ PLAN-052-E Phase C（雲端）
//
// ⚠ **一個對話框兩個分頁，不是兩顆按鈕**（052-E C-1）。兩顆按鈕會逼使用者在按下去之前
//   就先回答「我上次存在哪裡」——而那正是他打開書架想知道的事。抬頭那顆鍵仍只有一顆。
//
// ⚠ **檔名從 `LocalShelfDialog` 改成 `ShelfDialog`**：一個叫 Local 的元件裡面裝著雲端分頁，
//   是下一個人一定會看錯的地方。
//
// ── 兩種配額的語意不同，文案必須分開寫（052-E C-3）───────────────────────────
//   本機：「本機書架 7/10」—— 全站共用一個配額，不分機師。
//   雲端：「海莉絲 3/5」—— **每位機師各 5 格**，10 套本機存檔完全可能全是同一位機師。
//   抬頭那顆鍵印的是**本機**的數字：它在未登入時也要有意義，而雲端計數是 per-pilot，
//   抬頭那裡沒有機師脈絡。
//
// ⚠ **存入鍵在對話框裡，不在底部固定操作列。** 底部那一列在超重時已經有四顆，
//   瀏覽器實測 390px ＋「大」字級下只剩 56px 餘裕（052-C C-1 的量測），第五顆會擠爆。
//   而且配額只有在這裡看得到 —— 存不進去的那一刻，答案就在同一個畫面上。
//
// ⚠ **刪除是兩段式的**（點一下變成「確定刪除？」）。這與貼碼對話框「不加第二層確認」
//   的取捨相反，理由也相反：套用只是覆蓋掉手上這一套（還在草稿裡、還能再配），
//   刪除則是永久的。雲端也一樣 —— 雲端不是備份，刪掉就沒了。

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LoadoutDraft } from '../../types/loadout'
import { CLOUD_SLOTS, CLOUD_SLOTS_PER_PILOT, type CloudSlot } from '../../types/loadout'
import type { LoadoutWorld } from '../../utils/loadoutRules'
import type { ShareIndexes } from '../../utils/loadoutCode/codec'
import { useAuth } from '../../contexts/AuthContext'
import {
  readShelf, saveBuild, deleteBuild, SHELF_LIMIT,
  type LocalBuild,
} from '../../lib/localBuilds'
import { classifyBuild, type BuildStatus } from '../../lib/buildStatus'
import {
  listCloudBuilds, saveCloudBuild, deleteCloudBuild,
  type CloudBuildEntry, type CloudBuildsFailure,
} from '../../lib/buildsApi'
import {
  freeSlots, planCloudImport, summarizeImportPlan, type ImportPlanRow,
} from '../../utils/cloudBuildRules'
import { HUD_PANEL, SHARE_KIND_LABEL } from './loadoutTheme'

interface Props {
  /**
   * ⚠ 與 `PasteCodeDialog` 同樣**由呼叫端條件式掛載**，本元件不收 `open`——
   *   卸載即歸零，不必記得清哪一個欄位（待確認的刪除、剛複製的提示…）。
   */
  onClose: () => void
  /**
   * 遊戲資料還在載入。**為真時不判三態、也不給套用**：索引還不完整，每一筆都會被算成
   * 「機甲查不到」——使用者打開書架看到十套存檔全部標紅，是這個功能最糟的第一印象。
   * （呼叫端會在對話框開啟時把載入階段推到 `equip`，所以這只是那一兩秒的過渡。）
   *
   * ⚠ 雲端分頁**用同一份 gate**（052-G 決策六），不新寫第五份。
   */
  loading?: boolean
  indexes: ShareIndexes
  world: LoadoutWorld
  /** 目前這一套的代碼。`null` ＝ 編不出來（還沒選機甲／超出上限）⇒ 存入鍵停用 */
  currentCode: string | null
  /**
   * 目前草稿的機師。**雲端存檔以機師為單位**，沒有機師就沒有可以存進去的文件 ——
   * 這時雲端分頁照樣顯示（見 C-4 的理由），只是把「先選一位機師」講出來。
   */
  pilotId: string | null
  onApply: (draft: LoadoutDraft) => void
  /** 複製分享連結。回 `true` ＝ 成功（剪貼簿在 http 與部分行動瀏覽器會直接拒絕） */
  onCopyLink: (code: string) => Promise<boolean>
  /** 本機筆數變動時回報，讓抬頭那顆鍵上的 `N/10` 跟著動 */
  onShelfChange: (count: number) => void
}

type TabKey = 'local' | 'cloud'

const SAVE_ERROR: Record<'full' | 'storage' | 'empty', string> = {
  full: `書架已滿（${SHELF_LIMIT}/${SHELF_LIMIT}）。請先刪掉一套再存 —— 這裡不會自動淘汰最舊的那一筆。`,
  storage: '這個瀏覽器不讓本站寫入資料（無痕視窗或儲存空間已滿），存不進去。可以先複製分享連結留著。',
  empty: '目前這一套還編不成代碼（至少要有機甲）。',
}

/**
 * 雲端寫入失敗的文案（052-E C-7）。
 *
 * **四種要分開講**，因為使用者的下一步完全不同：等一下再試／重新登入／回報 bug／自己挑一格。
 * ⚠ 不可以只印「存檔失敗」——那句話沒有提供任何做決定需要的資訊。
 * ⚠ 也不可以假裝存好了（`localBuilds.writeShelf` 早就立過這條規矩）。
 */
const CLOUD_ERROR: Record<CloudBuildsFailure, string> = {
  offline: '現在連不上伺服器，這一套沒有存進去。網路回來之後再試一次 —— 你的配裝還在畫面上，沒有丟失。',
  // ⚠ 與 offline 分開講：這一種是「送出了但沒等到確認」，我們取消不了那次寫入，
  //   所以不能說「沒有存進去」——連線回來它可能自己成功了。
  pending: '送出了，但伺服器一直沒有回應（多半是斷線）。連線恢復後它可能會自己存進去 —— 不過這一頁只要重新整理或關掉，這次存檔就會取消。保險起見，先複製分享連結留一份。',
  // PLAN-045 的教訓：token 續期被擋會讓寫入在「看起來還登入著」的狀態下失敗。
  // 所以這一句要把人導去重新登入，而不是顯示一句技術錯誤。
  denied: '伺服器拒絕了這次寫入。多半是登入憑證過期了 —— 請先登出再登入一次；如果重新登入後還是這樣，麻煩回報，那是站上的 bug。',
  'code-too-long': '這一套的代碼超出單格上限，存不進去。這是站上的 bug，麻煩回報（可以先複製分享連結留著）。',
  'code-charset': '代碼含有不該出現的字元，存不進去。這是站上的 bug，麻煩回報。',
  'code-empty': '目前這一套還編不成代碼（至少要有機甲）。',
  'invalid-pilot-id': '這位機師的編號格式不對，存不進去。這是站上的 bug，麻煩回報。',
  'invalid-slot': '格位編號不對，存不進去。這是站上的 bug，麻煩回報。',
  unknown: '存檔時發生預期外的錯誤，這一套沒有存進去。可以先複製分享連結留著，稍後再試一次。',
}

/** `YYYY-MM-DD HH:MM`。同一天存好幾套時，只有日期分不出先後。 */
function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function ShelfDialog({
  onClose, loading, indexes, world, currentCode, pilotId, onApply, onCopyLink, onShelfChange,
}: Props) {
  const { user, openAuthModal } = useAuth()
  const [tab, setTab] = useState<TabKey>('local')
  const uid = user?.uid ?? null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ── 雲端書架的狀態放在**對話框這一層**，不放在雲端分頁裡（052-E D-3）──────
  //
  // 本機分頁要在每張卡上標「已在雲端」，而那個判定是**比對代碼字串**（決策四：
  // 不另存旗標 —— 旗標是第二個真相源，雲端那邊被刪掉之後它會繼續說謊）。
  // 判定要用到雲端清單，所以清單必須是兩個分頁共用的。
  //
  // ⚠ 連 uid 一起存：`cloud.uid !== uid` 就代表「這份資料是上一個帳號的」，
  //   在 render 期間比對即可，不必在 effect 裡同步 setState 清空
  //   （那正是 react-hooks/set-state-in-effect 擋下來的串聯渲染）。
  const [cloud, setCloud] = useState<{ uid: string; entries: CloudBuildEntry[] } | null>(null)
  const [loadError, setLoadError] = useState<CloudBuildsFailure | null>(null)

  // ⚠ `getDocs` 一次抓，**不用 `onSnapshot`**（計畫書決策七）：跨裝置同步的實際需求是
  //   「換一台裝置打開時看得到」，不是「A 存了 B 立刻跳出來」。onSnapshot 會讓每個開著
  //   模擬器的分頁長期佔一條連線並持續計費讀取，換來一個沒有人在等的即時性。
  useEffect(() => {
    if (!uid) return   // 未登入時雲端分頁走另一條分支，沒有東西要讀
    let alive = true
    void listCloudBuilds(uid).then((r) => {
      if (!alive) return
      if (r.ok) { setCloud({ uid, entries: r.entries }); setLoadError(null) }
      else { setCloud({ uid, entries: [] }); setLoadError(r.reason) }
    })
    return () => { alive = false }
  }, [uid])

  /** `null` ＝ 還沒讀到（或換了帳號、上一份不算數） */
  const entries = cloud && cloud.uid === uid ? cloud.entries : null

  const updateEntries = useCallback(
    (fn: (prev: CloudBuildEntry[]) => CloudBuildEntry[]) =>
      setCloud((prev) => (prev ? { ...prev, entries: fn(prev.entries) } : prev)),
    [],
  )

  /** 已經在雲端的代碼全集 —— 本機分頁靠它標「已在雲端」（比對字串，不存旗標）。 */
  const cloudCodes = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries ?? []) for (const s of CLOUD_SLOTS) {
      const c = e.slots[s]
      if (c) set.add(c)
    }
    return set
  }, [entries])

  const pilotName = pilotId ? world.pilots.get(pilotId)?.name ?? pilotId : null

  return (
    <div
      // ⚠ z-[60]：手機底部 Tab Bar 與 BottomSheet 都是 z-50，而它們在 DOM 裡更後面。
      //   登入框是 z-[70]（C-4：從這裡叫出來的登入框必須蓋在本對話框之上）。
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="書架"
        className={`${HUD_PANEL} w-full max-w-xl p-4 sm:p-5 max-h-[88vh] flex flex-col`}
      >
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-[15px] font-bold text-text-primary">書架</h2>
          <button type="button" onClick={onClose} className="text-[12px] text-text-dim hover:text-text-primary cursor-pointer">
            關閉
          </button>
        </div>

        {/* 分頁列。⚠ 未登入時雲端分頁**不隱藏**（C-4）——隱藏會讓「這站沒有雲端存檔」
            變成最合理的解讀，與 052-B 常駐橫幅同一條理由。 */}
        <div className="flex gap-1 border-b border-border -mx-1 px-1">
          <TabButton active={tab === 'local'} onClick={() => setTab('local')} label="本機" />
          <TabButton active={tab === 'cloud'} onClick={() => setTab('cloud')} label="雲端" />
        </div>

        {tab === 'local' ? (
          <LocalTab
            loading={!!loading}
            indexes={indexes}
            world={world}
            currentCode={currentCode}
            cloudCodes={cloudCodes}
            onApply={(d) => { onApply(d); onClose() }}
            onCopyLink={onCopyLink}
            onShelfChange={onShelfChange}
          />
        ) : (
          <CloudTab
            // ⚠ uid 一變（登入／登出）就整個重掛：分頁自己的暫時狀態（剛存入的格子、
            //   待確認的刪除、匯入預覽）一次歸零。在 effect 裡手動清會變成同步 setState，
            //   而那正是 react-hooks/set-state-in-effect 擋下來的串聯渲染。
            key={uid ?? 'anon'}
            uid={uid}
            onLogin={openAuthModal}
            loading={!!loading}
            indexes={indexes}
            world={world}
            currentCode={currentCode}
            pilotId={pilotId}
            pilotName={pilotName}
            entries={entries}
            loadError={loadError}
            onEntriesChange={updateEntries}
            onApply={(d) => { onApply(d); onClose() }}
            onCopyLink={onCopyLink}
          />
        )}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-[13px] font-bold border-b-2 -mb-px transition-colors cursor-pointer ${
        active
          ? 'border-accent-cyan text-accent-cyan'
          : 'border-transparent text-text-dim hover:text-text-secondary'
      }`}
    >
      {label}
    </button>
  )
}

// ─── 本機分頁 ────────────────────────────────────────────────────────────────

function LocalTab({
  loading, indexes, world, currentCode, cloudCodes, onApply, onCopyLink, onShelfChange,
}: {
  loading: boolean
  indexes: ShareIndexes
  world: LoadoutWorld
  currentCode: string | null
  /**
   * 已經在雲端的代碼全集（052-E D-3）。
   *
   * ⚠ 「已在雲端」是**比對代碼字串**算出來的，不是存一個旗標（決策四）——
   *   旗標是第二個真相源：使用者在雲端那邊把某一套刪掉之後，本機這個旗標會繼續說謊。
   */
  cloudCodes: ReadonlySet<string>
  onApply: (draft: LoadoutDraft) => void
  onCopyLink: (code: string) => Promise<boolean>
  onShelfChange: (count: number) => void
}) {
  const [shelf, setShelf] = useState<LocalBuild[]>(() => readShelf())
  const [saveError, setSaveError] = useState<keyof typeof SAVE_ERROR | null>(null)
  /** 剛存進去的那一筆：存完卡片就在眼前，不必再彈一句「已儲存」 */
  const [justSavedId, setJustSavedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const commit = useCallback((next: LocalBuild[]) => {
    setShelf(next)
    onShelfChange(next.length)
  }, [onShelfChange])

  const save = useCallback(() => {
    if (!currentCode) { setSaveError('empty'); return }
    const r = saveBuild(currentCode, { now: Date.now() })
    if (!r.ok) { setSaveError(r.reason); return }
    setSaveError(null)
    setJustSavedId(r.id)
    commit(r.shelf)
  }, [currentCode, commit])

  const remove = useCallback((id: string) => {
    commit(deleteBuild(id))
    setPendingDelete(null)
  }, [commit])

  const copy = useCallback(async (entry: LocalBuild) => {
    const ok = await onCopyLink(entry.code)
    setCopiedId(ok ? entry.id : null)
  }, [onCopyLink])

  // 「已複製連結」兩秒後換回來（同抬頭那顆鍵）——不換回來的話，
  // 同一張卡再按一次就完全沒有回饋，使用者不知道剛剛那下有沒有算數
  useEffect(() => {
    if (!copiedId) return
    const t = setTimeout(() => setCopiedId(null), 2000)
    return () => clearTimeout(t)
  }, [copiedId])

  /** 每一筆對「現在這一版資料」的效力。`indexes` 變了要重算（重新載入資料後會救回一些）。 */
  const statuses = useMemo(
    () => new Map(shelf.map((e) => [e.id, classifyBuild(e.code, indexes)] as const)),
    [shelf, indexes],
  )

  const full = shelf.length >= SHELF_LIMIT
  const onShelfAlready = !!currentCode && shelf.some((e) => e.code === currentCode)

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-baseline gap-2 mt-3">
        <span className="text-[13px] font-bold text-text-primary">本機書架</span>
        <span className="font-[JetBrains_Mono,monospace] tabular-nums text-[13px] text-text-secondary">
          {shelf.length}/{SHELF_LIMIT}
        </span>
        <span className="text-[11px] text-text-dim">全站共用，不分機師</span>
      </div>

      {/* 這一句不可以拿掉（052-C 決策五）：使用者會以為登入與否都一樣，直到換一台電腦才發現 */}
      <p className="mt-1 text-[11px] text-text-dim leading-relaxed">
        這裡的配裝<strong className="text-text-secondary">只存在這台裝置的這個瀏覽器</strong>——
        清除瀏覽器資料、換裝置或用無痕視窗都看不到。重要的配裝請登入後存到雲端，或複製分享連結留著。
      </p>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!currentCode || (full && !onShelfAlready)}
          className="hud-cut-sm text-[12px] px-3 py-1.5 border border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {onShelfAlready ? '目前這一套已在架上' : '存入目前這一套'}
        </button>
        {full && !onShelfAlready && (
          <span className="text-[11px] text-text-dim">書架已滿，先刪一套</span>
        )}
      </div>

      {saveError && (
        <p className="mt-2 text-[12px] text-accent-red leading-relaxed">{SAVE_ERROR[saveError]}</p>
      )}

      {shelf.length === 0 ? (
        <p className="mt-4 mb-2 text-[12px] text-text-dim leading-relaxed">
          書架是空的。配好一套之後回到這裡按「存入目前這一套」，最多可以放 {SHELF_LIMIT} 套。
        </p>
      ) : (
        <ul className="mt-3 space-y-2 overflow-y-auto pr-1 min-h-0">
          {shelf.map((entry) => (
            <ShelfCard
              key={entry.id}
              code={entry.code}
              savedLabel={entry.id === justSavedId ? '剛存入' : stamp(entry.savedAt)}
              fallbackTitle={`未命名配裝（${stamp(entry.savedAt)}）`}
              loading={loading}
              status={statuses.get(entry.id)!}
              world={world}
              inCloud={cloudCodes.has(entry.code)}
              highlighted={entry.id === justSavedId}
              copied={entry.id === copiedId}
              confirming={entry.id === pendingDelete}
              onApply={onApply}
              onCopy={() => void copy(entry)}
              onAskDelete={() => { setPendingDelete(entry.id); setCopiedId(null) }}
              onCancelDelete={() => setPendingDelete(null)}
              onDelete={() => remove(entry.id)}
            />
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-text-dim text-right shrink-0">套用會取代你目前正在配的這一套。</p>
    </div>
  )
}

// ─── 雲端分頁 ────────────────────────────────────────────────────────────────

function CloudTab({
  uid, onLogin, loading, indexes, world, currentCode, pilotId, pilotName,
  entries, loadError, onEntriesChange, onApply, onCopyLink,
}: {
  uid: string | null
  onLogin: () => void
  loading: boolean
  indexes: ShareIndexes
  world: LoadoutWorld
  currentCode: string | null
  pilotId: string | null
  pilotName: string | null
  /** `null` ＝ 還沒讀到。清單的擁有者是對話框那一層（本機分頁也要用） */
  entries: CloudBuildEntry[] | null
  loadError: CloudBuildsFailure | null
  onEntriesChange: (fn: (prev: CloudBuildEntry[]) => CloudBuildEntry[]) => void
  onApply: (draft: LoadoutDraft) => void
  onCopyLink: (code: string) => Promise<boolean>
}) {
  const [busySlot, setBusySlot] = useState<CloudSlot | null>(null)
  const [saveError, setSaveError] = useState<CloudBuildsFailure | null>(null)
  const [justSaved, setJustSaved] = useState<CloudSlot | null>(null)
  const [copiedSlot, setCopiedSlot] = useState<CloudSlot | null>(null)
  const [pendingDelete, setPendingDelete] = useState<CloudSlot | null>(null)

  useEffect(() => {
    if (!copiedSlot) return
    const t = setTimeout(() => setCopiedSlot(null), 2000)
    return () => clearTimeout(t)
  }, [copiedSlot])

  const mine = useMemo(
    () => (pilotId ? entries?.find((e) => e.pilotId === pilotId) ?? null : null),
    [entries, pilotId],
  )
  const others = useMemo(
    () => (entries ?? []).filter((e) => e.pilotId !== pilotId),
    [entries, pilotId],
  )

  const statuses = useMemo(() => {
    const m = new Map<CloudSlot, BuildStatus>()
    if (!mine) return m
    for (const s of CLOUD_SLOTS) {
      const code = mine.slots[s]
      if (code) m.set(s, classifyBuild(code, indexes))
    }
    return m
  }, [mine, indexes])

  const used = mine ? CLOUD_SLOTS.filter((s) => mine.slots[s] !== undefined).length : 0
  const free = freeSlots(mine?.slots)
  /** 同一串代碼已經在某一格 ⇒ 就地更新而不是佔第二格（沿用 `localBuilds.saveBuild` 的 deduped 語意） */
  const dupSlot = currentCode
    ? CLOUD_SLOTS.find((s) => mine?.slots[s] === currentCode) ?? null
    : null

  /**
   * 存到第 n 格。
   *
   * ⚠ **同一串代碼不會佔兩格**（沿用 `localBuilds.saveBuild` 的 deduped 語意）：
   *   它已經在別格而使用者挑了一個新格子時，這裡做的是**搬移** —— 先寫新的、再刪舊的。
   *   不去重的話，五格會被同一套配裝的複本吃光，而使用者看到的是幾張長得一模一樣的卡。
   *   順序不可以反過來：先刪後寫的話，中間那一刻寫入失敗就等於把存檔弄丟了。
   */
  const save = useCallback(async (slot: CloudSlot) => {
    if (!uid || !pilotId || !currentCode) return
    const from = CLOUD_SLOTS.find((s) => mine?.slots[s] === currentCode) ?? null
    setBusySlot(slot)
    setSaveError(null)
    const r = await saveCloudBuild(uid, pilotId, slot, currentCode)
    if (!r.ok) { setBusySlot(null); setSaveError(r.reason); return }

    // 搬移：新的已經寫進去了，這時才刪舊的那一格。刪不掉也不算失敗
    // （東西還在，只是暫時佔兩格），所以不覆蓋成功狀態、只記下來。
    let moved = false
    if (from && from !== slot) {
      const del = await deleteCloudBuild(uid, pilotId, from)
      moved = del.ok
      if (!del.ok) setSaveError(del.reason)
    }
    setBusySlot(null)

    // 樂觀更新：這一格的內容就是剛剛送上去的那一串，不必為了看到它再讀一次
    onEntriesChange((prev) => {
      const now = new Date().toISOString()
      const list = prev ?? []
      const hit = list.find((e) => e.pilotId === pilotId)
      if (hit) {
        return list.map((e) => {
          if (e.pilotId !== pilotId) return e
          const slots = { ...e.slots, [slot]: currentCode }
          if (moved && from) delete slots[from]
          return { ...e, slots, updatedAt: now }
        })
      }
      return [{ pilotId, slots: { [slot]: currentCode }, updatedAt: now }, ...list]
    })
    setJustSaved(slot)
  }, [uid, pilotId, currentCode, mine, onEntriesChange])

  const remove = useCallback(async (slot: CloudSlot) => {
    if (!uid || !pilotId) return
    setBusySlot(slot)
    const r = await deleteCloudBuild(uid, pilotId, slot)
    setBusySlot(null)
    setPendingDelete(null)
    if (!r.ok) { setSaveError(r.reason); return }
    onEntriesChange((prev) => (prev ?? []).flatMap((e) => {
      if (e.pilotId !== pilotId) return [e]
      const next = { ...e.slots }
      delete next[slot]
      // 最後一格被刪掉時整份文件也刪了（`deleteCloudBuild` 會處理），這裡跟著移除
      return Object.keys(next).length === 0 ? [] : [{ ...e, slots: next }]
    }))
    if (justSaved === slot) setJustSaved(null)
  }, [uid, pilotId, justSaved, onEntriesChange])

  const copy = useCallback(async (slot: CloudSlot, code: string) => {
    const ok = await onCopyLink(code)
    setCopiedSlot(ok ? slot : null)
  }, [onCopyLink])

  // ── 未登入：說出來，不要隱藏（C-4）────────────────────────────────────────
  if (!uid) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        <p className="text-[12px] text-text-secondary leading-relaxed">
          登入之後可以把配裝存到雲端，<strong className="text-text-primary">換一台裝置也看得到</strong>。
          <br />
          每位機師 {CLOUD_SLOTS_PER_PILOT} 格，與本機書架的 {SHELF_LIMIT} 格<strong className="text-text-primary">分開計算</strong>
          —— 本機那 {SHELF_LIMIT} 套之後可以一次搬上來，不用重配。
        </p>
        <div>
          <button
            type="button"
            onClick={onLogin}
            className="hud-cut-sm text-[12px] px-3 py-1.5 border border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 transition-colors cursor-pointer"
          >
            登入 / 註冊
          </button>
        </div>
        <p className="text-[11px] text-text-dim leading-relaxed">
          登入之後這個分頁就會直接變成你的雲端書架，不用重新打開。
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-baseline gap-2 mt-3 flex-wrap">
        <span className="text-[13px] font-bold text-text-primary">
          雲端書架{pilotName ? ` · ${pilotName}` : ''}
        </span>
        {pilotId && (
          <span className="font-[JetBrains_Mono,monospace] tabular-nums text-[13px] text-text-secondary">
            {used}/{CLOUD_SLOTS_PER_PILOT}
          </span>
        )}
        <span className="text-[11px] text-text-dim">每位機師各 {CLOUD_SLOTS_PER_PILOT} 格</span>
      </div>

      {entries === null ? (
        <p className="mt-3 text-[12px] text-text-dim">讀取雲端書架中…</p>
      ) : loadError ? (
        <p className="mt-3 text-[12px] text-accent-red leading-relaxed">{CLOUD_ERROR[loadError]}</p>
      ) : !pilotId ? (
        // 沒有機師就沒有可以存進去的文件 —— 但其他機師的存檔要看得到，
        // 否則使用者會以為自己的雲端書架是空的
        <p className="mt-3 text-[12px] text-text-dim leading-relaxed">
          雲端書架<strong className="text-text-secondary">以機師為單位</strong>，
          先選一位機師才能存。
        </p>
      ) : (
        <>
          {/* ── 存入：五格自己選（C-2）───────────────────────────────────────
              ⚠ 不做「先按存入再問確定要覆寫嗎」——那句話沒有提供任何做決定需要的
                資訊。每一格直接印出裡面是什麼，覆寫與否在按下去之前就看得見。 */}
          <div className="mt-3">
            <div className="text-[11px] text-text-dim mb-1.5">
              {!currentCode ? '目前這一套還編不成代碼（至少要有機甲）'
                : dupSlot ? `目前這一套已經在第 ${Number(dupSlot) + 1} 格 —— 再按一次只會更新時間，不會多佔一格`
                : free.length === 0 ? '五格都滿了。挑一格覆寫 —— 這裡不會自動淘汰最舊的那一套'
                : '存入哪一格？'}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {CLOUD_SLOTS.map((s) => {
                const occupied = mine?.slots[s] !== undefined
                const st = statuses.get(s)
                const label = occupied
                  ? (st?.draft?.name
                    || (st?.draft?.mechId ? world.mechs.get(st.draft.mechId)?.name : null)
                    || '已存')
                  : '空'
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void save(s)}
                    disabled={!currentCode || busySlot !== null}
                    title={occupied ? `第 ${Number(s) + 1} 格：${label}（會被覆寫）` : `第 ${Number(s) + 1} 格：空的`}
                    className={`hud-cut-sm text-[12px] px-2.5 py-1.5 border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed max-w-[9rem] ${
                      s === dupSlot ? 'border-accent-cyan/60 bg-accent-cyan/10 text-accent-cyan'
                        : occupied ? 'border-accent-yellow/40 text-text-secondary hover:border-accent-yellow/70'
                        : 'border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20'
                    }`}
                  >
                    <span className="tabular-nums font-[JetBrains_Mono,monospace]">{Number(s) + 1}</span>
                    <span className="ml-1.5 truncate inline-block align-bottom max-w-[6rem]">
                      {busySlot === s ? '存入中…'
                        : occupied ? `覆寫 ${label}`
                        : dupSlot ? '移到這格'
                        : label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {saveError && (
            <p className="mt-2 text-[12px] text-accent-red leading-relaxed">{CLOUD_ERROR[saveError]}</p>
          )}

          {used === 0 ? (
            <p className="mt-4 mb-2 text-[12px] text-text-dim leading-relaxed">
              {pilotName ?? '這位機師'}在雲端還沒有存檔。上面挑一格就能存進去，換裝置登入一樣看得到。
            </p>
          ) : (
            <ul className="mt-3 space-y-2 overflow-y-auto pr-1 min-h-0">
              {CLOUD_SLOTS.filter((s) => mine?.slots[s] !== undefined).map((s) => (
                <ShelfCard
                  key={s}
                  code={mine!.slots[s]!}
                  savedLabel={justSaved === s ? '剛存入' : `第 ${Number(s) + 1} 格`}
                  fallbackTitle={`未命名配裝（第 ${Number(s) + 1} 格）`}
                  loading={loading}
                  status={statuses.get(s)!}
                  world={world}
                  highlighted={justSaved === s}
                  copied={copiedSlot === s}
                  confirming={pendingDelete === s}
                  busy={busySlot === s}
                  onApply={onApply}
                  onCopy={() => void copy(s, mine!.slots[s]!)}
                  onAskDelete={() => { setPendingDelete(s); setCopiedSlot(null) }}
                  onCancelDelete={() => setPendingDelete(null)}
                  onDelete={() => void remove(s)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {/* 訪客書架匯入（Phase D）—— 只在真的有東西可以搬時才出現 */}
      {entries !== null && !loading && (
        <ImportPanel
          uid={uid!}
          indexes={indexes}
          world={world}
          entries={entries}
          onEntriesChange={onEntriesChange}
        />
      )}

      {/* 其他機師存了幾套（C-3）—— 少了這一行，使用者不知道自己在雲端總共有什麼，
          而這個分頁又只看得到當前機師的五格 */}
      {entries !== null && others.length > 0 && (
        <p className="mt-3 text-[11px] text-text-dim leading-relaxed shrink-0">
          其他機師：
          {others.slice(0, 6).map((e) => {
            const n = CLOUD_SLOTS.filter((s) => e.slots[s] !== undefined).length
            return `${world.pilots.get(e.pilotId)?.name ?? e.pilotId} ${n} 套`
          }).join('、')}
          {others.length > 6 && ` …共 ${others.length} 位`}
          。切換機師就會看到那一位的格子；完整清單在<strong className="text-text-secondary">個人中心 → 我的配裝</strong>。
        </p>
      )}

      <p className="mt-2 text-[11px] text-text-dim text-right shrink-0">套用會取代你目前正在配的這一套。</p>
    </div>
  )
}

// ─── 訪客書架匯入（PLAN-052-E Phase D）───────────────────────────────────────
//
// 管理者測試期配的每一套都在 localStorage 裡，這一段的價值就是它們不用重配一次。
//
// ⚠ **不清空 localStorage**（決策四／D-3）。三條理由：① 同一個瀏覽器可能有多人用
//   （家用電腦），清空等於替別人做決定；② 匯入到一半失敗時清空 ＝ 資料消失；
//   ③ 使用者可能只是想備份一份。成功的那幾筆改成在本機分頁標「已在雲端」，
//   而那個標記是**比對代碼字串**算出來的，不是存旗標。
//
// ⚠ **逐筆回報，不是整批成功／失敗**（D-4）。一句「匯入完成」會讓使用者以為 10 套都
//   上去了，而實際上可能只有 6 套 —— 他要到換裝置那天才會發現。
//
// ⚠ 「塞不下」是**正常結果不是錯誤**：訪客配額是全站 10 格、雲端是每機師 5 格，
//   10 套完全可能全是同一位機師。

const OUTCOME_STYLE: Record<string, string> = {
  import: 'text-accent-cyan border-accent-cyan/40',
  duplicate: 'text-text-dim border-border',
  full: 'text-accent-yellow border-accent-yellow/40',
  broken: 'text-accent-red border-accent-red/40',
  unselected: 'text-text-dim border-border',
  failed: 'text-accent-red border-accent-red/40',
}

function ImportPanel({
  uid, indexes, world, entries, onEntriesChange,
}: {
  uid: string
  indexes: ShareIndexes
  world: LoadoutWorld
  entries: CloudBuildEntry[]
  onEntriesChange: (fn: (prev: CloudBuildEntry[]) => CloudBuildEntry[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  /** 沒被勾的那幾筆（預設全勾 ⇒ 記「不要的」比記「要的」少一次初始化） */
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set())
  /** 執行完的逐筆結果。`null` ＝ 還沒跑過（畫面上顯示的是預覽） */
  const [done, setDone] = useState<Array<ImportPlanRow & { failed?: CloudBuildsFailure }> | null>(null)

  const shelf = useMemo(() => readShelf(), [])

  /** 每一筆解出機師與摘要 —— 卡片上要顯示的一切都由代碼當場解出來（決策五） */
  const decoded = useMemo(() => shelf.map((e) => {
    const st = classifyBuild(e.code, indexes)
    return { entry: e, status: st, pilotId: st.draft?.pilotId ?? null }
  }), [shelf, indexes])

  const cloudMap = useMemo(
    () => new Map(entries.map((e) => [e.pilotId, e.slots])),
    [entries],
  )

  /** 預覽計畫。`unchecked` 或雲端狀態一變就重算 —— 使用者要看到勾選的後果。 */
  const plan = useMemo(() => planCloudImport(
    decoded.map((d) => ({
      id: d.entry.id,
      code: d.entry.code,
      // broken（機師或機甲查不到）一律不給匯入：`planCloudImport` 靠 pilotId 是不是
      // null 來判，所以這裡把 broken 的機師抹掉，而不是在那邊多開一個旗標
      pilotId: d.status.state === 'broken' ? null : d.pilotId,
      selected: !unchecked.has(d.entry.id),
    })),
    cloudMap,
  ), [decoded, cloudMap, unchecked])

  // 執行前是預覽（沒有 failed），執行後是結果 —— 明寫成同一個型別，
  // 免得 `in` 收窄把 row.failed 推成 unknown
  const rows: Array<ImportPlanRow & { failed?: CloudBuildsFailure }> = done ?? plan
  /**
   * ⚠ 統計一律算 `rows` 而**不是 `plan`**：跑完之後 `plan` 會**重算**（雲端狀態變了），
   *   那時剛匯入的那幾筆全部變成 duplicate —— 結果行會印出「已匯入 5 套 · 雲端已有 5 套」，
   *   同一批東西被數了兩次。統計要問的是「這次做了什麼」，那是 `done` 的內容。
   */
  const summary = useMemo(() => summarizeImportPlan(rows), [rows])

  const run = useCallback(async () => {
    setRunning(true)
    const results: Array<ImportPlanRow & { failed?: CloudBuildsFailure }> = []
    // 逐筆寫、逐筆記結果。**不用 Promise.all**：失敗時要知道是哪幾筆失敗，
    // 而且並行寫同一份文件會讓「其他格子」的合併結果變成競態。
    for (const row of plan) {
      if (row.outcome.kind !== 'import' || !row.pilotId) { results.push(row); continue }
      const r = await saveCloudBuild(uid, row.pilotId, row.outcome.slot, row.code)
      if (r.ok) {
        results.push(row)
        const { pilotId, code, outcome } = row
        const slot = outcome.slot
        onEntriesChange((prev) => {
          const hit = prev.find((e) => e.pilotId === pilotId)
          const now = new Date().toISOString()
          if (hit) {
            return prev.map((e) => e.pilotId === pilotId
              ? { ...e, slots: { ...e.slots, [slot]: code }, updatedAt: now } : e)
          }
          return [{ pilotId, slots: { [slot]: code }, updatedAt: now }, ...prev]
        })
      } else {
        results.push({ ...row, failed: r.reason })
      }
    }
    setDone(results)
    setRunning(false)
  }, [plan, uid, onEntriesChange])

  if (shelf.length === 0) return null

  const importedCount = done?.filter((r) => r.outcome.kind === 'import' && !r.failed).length ?? 0
  const failedCount = done?.filter((r) => r.failed).length ?? 0

  return (
    <div className="mt-3 border-t border-border pt-3 shrink-0">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="hud-cut-sm text-[12px] px-3 py-1.5 border border-border text-text-secondary hover:text-text-primary hover:border-border-accent transition-colors cursor-pointer"
        >
          從本機書架匯入（{shelf.length} 套）
        </button>
      ) : (
        <div className="flex flex-col min-h-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-bold text-text-primary">從本機書架匯入</span>
            <button
              type="button"
              onClick={() => { setOpen(false); setDone(null) }}
              className="text-[12px] text-text-dim hover:text-text-primary cursor-pointer"
            >
              收起
            </button>
          </div>

          {done ? (
            // ── 逐筆回報（D-4）─────────────────────────────────────────────
            <p className="mt-1 text-[12px] text-text-secondary leading-relaxed">
              已匯入 <strong className="text-accent-cyan">{importedCount}</strong> 套
              {summary.duplicate > 0 && <> · 雲端已有 {summary.duplicate} 套</>}
              {summary.full > 0 && <> · <span className="text-accent-yellow">機師的 5 格滿了 {summary.full} 套</span></>}
              {summary.broken > 0 && <> · <span className="text-accent-red">無法匯入 {summary.broken} 套</span></>}
              {summary.unselected > 0 && <> · 未勾選 {summary.unselected} 套</>}
              {failedCount > 0 && <> · <span className="text-accent-red">寫入失敗 {failedCount} 套</span></>}
              <br />
              <span className="text-text-dim">
                本機書架<strong className="text-text-secondary">原封不動</strong> ——
                匯入不會清空這台裝置上的存檔（同一個瀏覽器可能有別人在用，而且你可能只是想留一份備份）。
              </span>
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-text-dim leading-relaxed">
              本機那 {shelf.length} 套會依機師分別填進雲端的空格子。
              <strong className="text-text-secondary">已被雲端佔用的格子會跳過，不會覆寫</strong>；
              同一位機師超過 {CLOUD_SLOTS_PER_PILOT} 套的部分留在本機。匯入<strong className="text-text-secondary">不會清空</strong>本機書架。
            </p>
          )}

          <ul className="mt-2 space-y-1 overflow-y-auto pr-1 min-h-0 max-h-56">
            {rows.map((row) => {
              const d = decoded.find((x) => x.entry.id === row.id)!
              const st = d.status
              const pilot = row.pilotId ? world.pilots.get(row.pilotId)?.name ?? row.pilotId : null
              const mech = st.draft?.mechId ? world.mechs.get(st.draft.mechId)?.name ?? st.draft.mechId : null
              const weapons = Object.values(st.draft?.sets ?? {}).reduce((n, s) => n + (s.mounts?.length ?? 0), 0)
              const failed = row.failed
              const kind = failed ? 'failed' : row.outcome.kind
              const label =
                failed ? '寫入失敗'
                : row.outcome.kind === 'import' ? (done ? `已存入第 ${Number(row.outcome.slot) + 1} 格` : `→ 第 ${Number(row.outcome.slot) + 1} 格`)
                : row.outcome.kind === 'duplicate' ? `雲端已有（第 ${Number(row.outcome.slot) + 1} 格）`
                : row.outcome.kind === 'full' ? `${pilot ?? '這位機師'}的 5 格滿了`
                : row.outcome.kind === 'broken' ? '機師或機甲查不到'
                : '未勾選'
              const canPick = st.state !== 'broken' && !done

              return (
                <li key={row.id} className="flex items-start gap-2 text-[12px] py-1">
                  <input
                    type="checkbox"
                    checked={!unchecked.has(row.id) && st.state !== 'broken'}
                    disabled={!canPick}
                    onChange={(e) => setUnchecked((prev) => {
                      const next = new Set(prev)
                      if (e.target.checked) next.delete(row.id); else next.add(row.id)
                      return next
                    })}
                    className="mt-0.5 accent-accent-cyan cursor-pointer disabled:cursor-not-allowed"
                    aria-label={`匯入 ${st.draft?.name || pilot || '這一套'}`}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="text-text-primary">{st.draft?.name || pilot || '未命名配裝'}</span>
                    <span className="text-text-dim">
                      {pilot && <> · {pilot}</>}
                      {mech && <> · {mech}</>}
                      {weapons > 0 && <> · 武器 {weapons} 把</>}
                      {' · '}{stamp(d.entry.savedAt)}
                    </span>
                    {/* broken 的**列出來但不給勾**（D-1）——直接濾掉會變成
                        「我明明有 10 套，怎麼只剩 7 套」 */}
                    {st.state === 'broken' && (
                      <span className="block text-accent-red/90">
                        {st.message ?? '這套的機師或機甲在站上查不到，沒辦法匯入。代碼還留在本機書架上。'}
                      </span>
                    )}
                    {/* degraded 照樣可以匯入：少一把武器遠好過整套不給搬 */}
                    {st.state === 'degraded' && (
                      <span className="block text-accent-yellow/80">
                        有 {st.missing.length} 項裝備已下架，匯入後那幾格會是空的。
                      </span>
                    )}
                    {failed && <span className="block text-accent-red/90">{CLOUD_ERROR[failed]}</span>}
                  </span>
                  <span className={`shrink-0 text-[11px] px-1.5 py-0.5 border hud-cut-sm ${OUTCOME_STYLE[kind]}`}>
                    {label}
                  </span>
                </li>
              )
            })}
          </ul>

          {!done && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void run()}
                disabled={running || summary.willImport === 0}
                className="hud-cut-sm text-[12px] px-3 py-1.5 border border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {running ? '匯入中…' : `匯入 ${summary.willImport} 套`}
              </button>
              {summary.willImport === 0 && (
                <span className="text-[11px] text-text-dim">
                  {summary.duplicate === shelf.length ? '這些都已經在雲端了' : '沒有可以匯入的項目'}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── 一張卡（本機與雲端共用）─────────────────────────────────────────────────
//
// ⚠ 兩邊共用同一張卡與同一支 `classifyBuild`（C-5）：兩份判定遲早會在同一串代碼上
//   給出不同答案 —— 同一套配裝在本機分頁說「可套用」、在雲端分頁說「已失效」。

const BORDER: Record<BuildStatus['state'], string> = {
  ok: 'border-border',
  degraded: 'border-accent-yellow/40',
  broken: 'border-accent-red/40',
}

function ShelfCard({
  code, savedLabel, fallbackTitle, status, loading, world, highlighted, copied, confirming, busy, inCloud,
  onApply, onCopy, onAskDelete, onCancelDelete, onDelete,
}: {
  code: string
  /** 右上角那一行：本機印時間、雲端印格號 */
  savedLabel: string
  /** 連名稱與機師都解不出來時的標題 */
  fallbackTitle: string
  status: BuildStatus
  /** 資料還沒齊 —— 三態不算數，只印得出代碼裡自帶的名稱 */
  loading: boolean
  world: LoadoutWorld
  highlighted: boolean
  copied: boolean
  confirming: boolean
  busy?: boolean
  /** 本機分頁專用：同一串代碼已經在雲端的某一格（D-3，比對字串而非旗標） */
  inCloud?: boolean
  onApply: (draft: LoadoutDraft) => void
  onCopy: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
}) {
  void code   // 卡片本身不需要代碼，但呼叫端用它當 key／複製來源，留著讓型別說明意圖
  const d = status.draft
  const pilot = d?.pilotId ? world.pilots.get(d.pilotId)?.name ?? d.pilotId : null
  const mech = d?.mechId ? world.mechs.get(d.mechId)?.name ?? d.mechId : null
  const setKeys = d ? Object.keys(d.sets) : []
  const weapons = setKeys.reduce((n, k) => n + (d?.sets[k].mounts?.length ?? 0), 0)
  // ⚠ 模組與元件也要數（052-G E-1 實地驗收補上，與 `PasteCodeDialog` 同一處遺漏）。
  //   這段是 052-C 寫的，那時兩者都還不存在。書架卡是使用者**分辨十張卡**的唯一依據，
  //   而一份純模組配裝在這裡會顯示成「武器 0 把」——十張長得一樣的卡等於沒有摘要。
  const modules = Object.values(d?.modules ?? {}).filter(Boolean).length
  const components = setKeys.reduce((n, k) => n + (d?.sets[k].mounts ?? []).reduce(
    (m, mt) => m + (mt.setup?.triggerComponentIds?.length ?? 0) + (mt.setup?.effectComponentIds?.length ?? 0), 0), 0)

  // 名稱一律由代碼當場解出來（決策五：只存代碼字串）。連名稱都解不出來時退到呼叫端給的
  // 後備標題，因為那一刻使用者唯一分得出兩張卡的線索就是「什麼時候／存在哪一格」
  const title = d?.name || (loading ? null : pilot) || fallbackTitle

  return (
    <li className={`hud-cut-sm border ${
      highlighted ? 'border-accent-cyan/60' : loading ? 'border-border' : BORDER[status.state]
    } bg-bg-dark px-3 py-2`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-bold text-text-primary truncate">{title}</span>
        <span className="flex items-baseline gap-1.5 shrink-0">
          {inCloud && (
            <span
              title="這一串代碼已經在你的雲端書架裡"
              className="text-[10px] px-1.5 py-0.5 border border-accent-cyan/40 text-accent-cyan/90 hud-cut-sm"
            >
              已在雲端
            </span>
          )}
          <span className="text-[10px] text-text-dim font-[JetBrains_Mono,monospace] tabular-nums">
            {savedLabel}
          </span>
        </span>
      </div>

      {loading ? (
        <p className="mt-0.5 text-[12px] text-text-dim">載入遊戲資料中…</p>
      ) : status.state === 'broken' && status.message ? (
        // 結構性損毀：解碼器自己的文案已經是中文，而且給得出下一步
        <p className="mt-1 text-[12px] text-accent-red leading-relaxed">{status.message}</p>
      ) : (
        <div className="mt-0.5 text-[12px] text-text-secondary leading-relaxed">
          <span className="text-text-dim">機師</span> {pilot ?? '未選'}
          <span className="mx-2 text-border">·</span>
          <span className="text-text-dim">機甲</span> {mech ?? '未選'}
          {setKeys.length > 1 && <><span className="mx-2 text-border">·</span>{setKeys.length} 套</>}
          <span className="mx-2 text-border">·</span>武器 {weapons} 把
          {modules > 0 && <><span className="mx-2 text-border">·</span>模組 {modules} 顆</>}
          {components > 0 && <><span className="mx-2 text-border">·</span>元件 {components} 個</>}
        </div>
      )}

      {/* 失效兩態的說明。**永不自動修復**，所以這裡只說發生了什麼，不提供「幫我換一把」 */}
      {!loading && status.state === 'broken' && status.missingIdentity.length > 0 && (
        <p className="mt-1 text-[12px] text-accent-red leading-relaxed">
          這套的{[...new Set(status.missingIdentity)].map((k) => SHARE_KIND_LABEL[k]).join('與')}
          在站上查不到，沒辦法載入。代碼還留著——如果是剛改版，重新載入資料後可能就回來了。
        </p>
      )}
      {!loading && status.state === 'degraded' && (
        <p className="mt-1 text-[12px] text-accent-yellow/90 leading-relaxed">
          有 {status.missing.length} 項裝備已下架（
          {status.missing.slice(0, 4).map((u) => `#${u.shareId}`).join('、')}
          {status.missing.length > 4 && ' …'}），套用後那幾格會是空的。
        </p>
      )}

      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {confirming ? (
          <>
            <span className="text-[12px] text-accent-red mr-auto">刪掉就找不回來了，確定嗎？</span>
            <button
              type="button"
              onClick={onCancelDelete}
              className="hud-cut-sm text-[12px] px-2.5 py-1 border border-border text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="hud-cut-sm text-[12px] px-2.5 py-1 border border-accent-red/50 bg-accent-red/10 text-accent-red hover:bg-accent-red/20 transition-colors cursor-pointer disabled:opacity-40"
            >
              {busy ? '刪除中…' : '確定刪除'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => { if (d && !loading && status.state !== 'broken') onApply(d) }}
              disabled={!d || loading || status.state === 'broken'}
              className="hud-cut-sm text-[12px] px-2.5 py-1 border border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              套用
            </button>
            {/* 每張卡永遠有一個「把它帶出這台裝置」的出口（決策五）。
                給的是連結不是裸碼：base64url 含 `_`，Discord 的 `_斜體_` 會把它吃掉 */}
            <button
              type="button"
              onClick={onCopy}
              className="hud-cut-sm text-[12px] px-2.5 py-1 border border-border text-text-secondary hover:text-text-primary hover:border-border-accent transition-colors cursor-pointer"
            >
              {copied ? '已複製連結' : '複製連結'}
            </button>
            <button
              type="button"
              onClick={onAskDelete}
              className="hud-cut-sm text-[12px] px-2.5 py-1 border border-border text-text-dim hover:text-accent-red hover:border-accent-red/50 transition-colors cursor-pointer ml-auto"
            >
              刪除
            </button>
          </>
        )}
      </div>
    </li>
  )
}
