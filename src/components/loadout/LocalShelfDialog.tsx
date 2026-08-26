// 訪客本機書架對話框 —— PLAN-052-C Phase D / D-1
//
// 未登入者唯一的存檔出口（052-E 的雲端存檔上線前）。存取邏輯全在 `lib/localBuilds.ts`，
// 這裡只負責把它的三態畫出來，並把「這些東西只存在這台裝置」講清楚。
//
// ⚠ **存入鍵在對話框裡，不在底部固定操作列。** 底部那一列在超重時已經有四顆，
//   瀏覽器實測 390px ＋「大」字級下只剩 56px 餘裕（C-1 的量測），第五顆會擠爆。
//   而且配額（7/10）只有在這裡看得到 —— 存不進去的那一刻，答案就在同一個畫面上。
//
// ⚠ **刪除是兩段式的**（點一下變成「確定刪除？」）。這與貼碼對話框「不加第二層確認」
//   的取捨相反，理由也相反：套用只是覆蓋掉手上這一套（還在草稿裡、還能再配），
//   刪除則是永久的 —— 沒有雲端備份、沒有復原。

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LoadoutDraft } from '../../types/loadout'
import type { LoadoutWorld } from '../../utils/loadoutRules'
import type { ShareIndexes } from '../../utils/loadoutCode/codec'
import {
  readShelf, saveBuild, deleteBuild, classifyBuild, SHELF_LIMIT,
  type LocalBuild, type BuildStatus,
} from '../../lib/localBuilds'
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
   */
  loading?: boolean
  indexes: ShareIndexes
  world: LoadoutWorld
  /** 目前這一套的代碼。`null` ＝ 編不出來（還沒選機甲／超出上限）⇒ 存入鍵停用 */
  currentCode: string | null
  onApply: (draft: LoadoutDraft) => void
  /** 複製分享連結。回 `true` ＝ 成功（剪貼簿在 http 與部分行動瀏覽器會直接拒絕） */
  onCopyLink: (code: string) => Promise<boolean>
  /** 筆數變動時回報，讓抬頭那顆鍵上的 `N/10` 跟著動 */
  onShelfChange: (count: number) => void
}

const SAVE_ERROR: Record<'full' | 'storage' | 'empty', string> = {
  full: `書架已滿（${SHELF_LIMIT}/${SHELF_LIMIT}）。請先刪掉一套再存 —— 這裡不會自動淘汰最舊的那一筆。`,
  storage: '這個瀏覽器不讓本站寫入資料（無痕視窗或儲存空間已滿），存不進去。可以先複製分享連結留著。',
  empty: '目前這一套還編不成代碼（至少要有機甲）。',
}

/** `YYYY-MM-DD HH:MM`。同一天存好幾套時，只有日期分不出先後。 */
function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function LocalShelfDialog({
  onClose, loading, indexes, world, currentCode, onApply, onCopyLink, onShelfChange,
}: Props) {
  const [shelf, setShelf] = useState<LocalBuild[]>(() => readShelf())
  const [saveError, setSaveError] = useState<keyof typeof SAVE_ERROR | null>(null)
  /** 剛存進去的那一筆：存完卡片就在眼前，不必再彈一句「已儲存」 */
  const [justSavedId, setJustSavedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
    <div
      // ⚠ z-[60]：手機底部 Tab Bar 與 BottomSheet 都是 z-50，而它們在 DOM 裡更後面
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="本機書架"
        className={`${HUD_PANEL} w-full max-w-xl p-4 sm:p-5 max-h-[88vh] flex flex-col`}
      >
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-[15px] font-bold text-text-primary">
            本機書架
            <span className="ml-2 font-[JetBrains_Mono,monospace] tabular-nums text-[13px] text-text-secondary">
              {shelf.length}/{SHELF_LIMIT}
            </span>
          </h2>
          <button type="button" onClick={onClose} className="text-[12px] text-text-dim hover:text-text-primary cursor-pointer">
            關閉
          </button>
        </div>

        {/* 這一句不可以拿掉（決策五）：使用者會以為登入與否都一樣，直到換一台電腦才發現 */}
        <p className="text-[11px] text-text-dim leading-relaxed">
          未登入的配裝<strong className="text-text-secondary">只存在這台裝置的這個瀏覽器</strong>——
          清除瀏覽器資料、換裝置或用無痕視窗都看不到。重要的配裝請另外複製分享連結留著。
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
                entry={entry}
                loading={!!loading}
                status={statuses.get(entry.id)!}
                world={world}
                justSaved={entry.id === justSavedId}
                copied={entry.id === copiedId}
                confirming={entry.id === pendingDelete}
                onApply={(draft) => { onApply(draft); onClose() }}
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
    </div>
  )
}

// ─── 一張卡 ──────────────────────────────────────────────────────────────────

const BORDER: Record<BuildStatus['state'], string> = {
  ok: 'border-border',
  degraded: 'border-accent-yellow/40',
  broken: 'border-accent-red/40',
}

function ShelfCard({
  entry, status, loading, world, justSaved, copied, confirming,
  onApply, onCopy, onAskDelete, onCancelDelete, onDelete,
}: {
  entry: LocalBuild
  status: BuildStatus
  /** 資料還沒齊 —— 三態不算數，只印得出代碼裡自帶的名稱 */
  loading: boolean
  world: LoadoutWorld
  justSaved: boolean
  copied: boolean
  confirming: boolean
  onApply: (draft: LoadoutDraft) => void
  onCopy: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
}) {
  const d = status.draft
  const pilot = d?.pilotId ? world.pilots.get(d.pilotId)?.name ?? d.pilotId : null
  const mech = d?.mechId ? world.mechs.get(d.mechId)?.name ?? d.mechId : null
  const setKeys = d ? Object.keys(d.sets) : []
  const weapons = setKeys.reduce((n, k) => n + (d?.sets[k].mounts?.length ?? 0), 0)

  // 名稱一律由代碼當場解出來（決策五：只存代碼字串）。連名稱都解不出來時退到日期，
  // 因為那一刻使用者唯一分得出兩張卡的線索就是「什麼時候存的」
  const title = d?.name || (loading ? null : pilot) || `未命名配裝（${stamp(entry.savedAt)}）`

  return (
    <li className={`hud-cut-sm border ${
      justSaved ? 'border-accent-cyan/60' : loading ? 'border-border' : BORDER[status.state]
    } bg-bg-dark px-3 py-2`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-bold text-text-primary truncate">{title}</span>
        <span className="text-[10px] text-text-dim font-[JetBrains_Mono,monospace] tabular-nums shrink-0">
          {justSaved ? '剛存入' : stamp(entry.savedAt)}
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
              className="hud-cut-sm text-[12px] px-2.5 py-1 border border-accent-red/50 bg-accent-red/10 text-accent-red hover:bg-accent-red/20 transition-colors cursor-pointer"
            >
              確定刪除
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
