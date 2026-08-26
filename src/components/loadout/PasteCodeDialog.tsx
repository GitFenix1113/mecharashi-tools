// 貼碼對話框 —— PLAN-052-C Phase C / C-1
//
// 「別人把連結貼給我，我要看到他的配裝」的另一半：使用者手上只有一串文字時的入口。
//
// ⚠ **套用之前一定要先給預覽。** 貼碼會覆蓋掉使用者手上正在配的那一套，
//   而那一套沒有第二份備份（本機草稿只有一份）。先看到「這是誰的什麼配裝」再決定，
//   是這個對話框存在的全部理由 —— 少了它，這裡就只是一個會吃掉你半小時的輸入框。
//
// ⚠ **解不開時不要急著說「已下架」**（決策四的舊快取防護）：本週剛上線的武器，
//   在快取還沒失效的瀏覽器上查不到號碼，語意剛好相反。先問 `onCheckStale()`。

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LoadoutDraft } from '../../types/loadout'
import type { LoadoutWorld } from '../../utils/loadoutRules'
import { decodeLoadout, type ShareIndexes, type DecodeResult, type UnresolvedRef } from '../../utils/loadoutCode/codec'
import { readShareCode } from '../../utils/loadoutCode/shareLink'
import { HUD_PANEL } from './loadoutTheme'

interface Props {
  /**
   * ⚠ **由呼叫端條件式掛載**（`{open && <PasteCodeDialog …/>}`），本元件不收 `open`。
   *   收 `open` 就得在 effect 裡把內部狀態清乾淨，而那是 effect 的誤用
   *   （eslint `react-hooks` 會擋，理由也對：會觸發串聯渲染）。
   *   卸載即歸零 —— 不必寫任何清理程式碼，也不可能忘記清哪一個欄位。
   */
  onClose: () => void
  indexes: ShareIndexes
  world: LoadoutWorld
  onApply: (draft: LoadoutDraft) => void
  /**
   * 檢查本機遊戲資料是否落後於伺服器。回 `true` ＝ 落後，此時「查無此號」很可能是
   * 快取太舊而不是真的下架。不傳則一律以「已下架」呈現（降級，不是壞掉）。
   */
  onCheckStale?: () => Promise<boolean>
  /** 重新載入遊戲資料（`GameDataContext.reload()`）。落後時才會顯示那顆按鈕。 */
  onReload?: () => void
}

const KIND_LABEL: Record<UnresolvedRef['kind'], string> = {
  pilot: '機師', mech: '機甲', weapon: '武器',
  component: '元件', backpack: '背包', module: '模組',
}

export function PasteCodeDialog({ onClose, indexes, world, onApply, onCheckStale, onReload }: Props) {
  const [raw, setRaw] = useState('')
  /**
   * 版本檢查的結果，**連同它是針對哪一串輸入算的**一起存。
   *
   * 只存 `boolean` 會有一個看不出來的錯：貼了 A（資料落後）之後改貼 C，
   * 在非同步查詢回來之前，畫面會用 A 的答案去描述 C —— 使用者看到的是一句
   * 針對別串代碼的說明。帶上 `raw` 就自然對得起來。
   */
  const [staleFor, setStaleFor] = useState<{ raw: string; stale: boolean } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const result = useMemo<DecodeResult | null>(() => {
    const code = readShareCode(raw)
    return code ? decodeLoadout(code, indexes) : null
  }, [raw, indexes])

  // 有解不開的引用時才去問版本（1 次讀取）。沒有的話一個網路請求都不發
  const unresolvedCount = result?.ok ? result.unresolved.length : 0
  useEffect(() => {
    if (!unresolvedCount || !onCheckStale) return
    let alive = true
    const forRaw = raw
    onCheckStale()
      .then((v) => { if (alive) setStaleFor({ raw: forRaw, stale: v }) })
      .catch(() => { if (alive) setStaleFor({ raw: forRaw, stale: false }) })
    return () => { alive = false }
  }, [raw, unresolvedCount, onCheckStale])
  const stale = staleFor?.raw === raw ? staleFor.stale : null

  const preview = useMemo(() => {
    if (!result?.ok) return null
    const d = result.draft
    const pilot = d.pilotId ? world.pilots.get(d.pilotId)?.name ?? d.pilotId : null
    const mech = d.mechId ? world.mechs.get(d.mechId)?.name ?? d.mechId : null
    const setKeys = Object.keys(d.sets)
    const weapons = setKeys.reduce((n, k) => n + (d.sets[k].mounts?.length ?? 0), 0)
    const backpacks = setKeys.filter((k) => d.sets[k].backpackId).length
    return { pilot, mech, sets: setKeys.length, weapons, backpacks, name: d.name }
  }, [result, world])

  const apply = useCallback(() => {
    if (result?.ok) { onApply(result.draft); onClose() }
  }, [result, onApply, onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div role="dialog" aria-modal="true" aria-label="貼上分享碼" className={`${HUD_PANEL} w-full max-w-lg p-4 sm:p-5`}>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[15px] font-bold text-text-primary">貼上分享碼</h2>
          <button type="button" onClick={onClose} className="text-[12px] text-text-dim hover:text-text-primary cursor-pointer">
            關閉
          </button>
        </div>

        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={3}
          autoFocus
          placeholder="把別人給你的連結或代碼整串貼進來"
          className="w-full bg-bg-dark border border-border px-2.5 py-2 text-[12px] font-mono text-text-primary placeholder:text-text-dim focus:border-border-accent outline-none resize-none"
        />

        {/* 空白時不給任何紅字：使用者還沒貼完就先被罵，是最沒必要的一種回饋 */}
        {raw.trim() && !result && (
          <p className="mt-3 text-[12px] text-text-dim">
            這段文字裡找不到分享碼。連結長得像 <span className="font-mono">…/simulator?b=…</span>，代碼則是一長串英數字。
          </p>
        )}

        {result && !result.ok && (
          <p className="mt-3 text-[12px] text-accent-red leading-relaxed">{result.message}</p>
        )}

        {result?.ok && preview && (
          <div className="mt-3 space-y-2">
            <div className="hud-cut-sm border border-border bg-bg-dark px-3 py-2 text-[12px] text-text-secondary leading-relaxed">
              {preview.name && <div className="text-[13px] text-text-primary font-bold mb-1">{preview.name}</div>}
              <div>
                <span className="text-text-dim">機師</span> {preview.pilot ?? '未選'}
                <span className="mx-2 text-border">·</span>
                <span className="text-text-dim">機甲</span> {preview.mech ?? '未選'}
              </div>
              <div className="mt-0.5">
                {preview.sets > 1 && <>{preview.sets} 套配裝<span className="mx-2 text-border">·</span></>}
                武器 {preview.weapons} 把
                {preview.backpacks > 0 && <><span className="mx-2 text-border">·</span>背包 {preview.backpacks}</>}
              </div>
            </div>

            {unresolvedCount > 0 && (
              <div className="hud-cut-sm border border-accent-yellow/40 bg-accent-yellow/5 px-3 py-2 text-[12px] text-text-secondary leading-relaxed">
                {stale === true ? (
                  <>
                    有 {unresolvedCount} 項裝備在你這裡查不到，而<strong className="text-accent-yellow">你手上的遊戲資料不是最新的</strong>——
                    很可能是這一版剛上線的東西。建議先重新載入資料再套用。
                    {onReload && (
                      <button
                        type="button"
                        onClick={onReload}
                        className="ml-2 underline text-accent-cyan hover:text-accent-cyan/80 cursor-pointer"
                      >
                        重新載入資料
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    有 {unresolvedCount} 項裝備在站上查不到（
                    {[...new Set(result.unresolved.map((u) => KIND_LABEL[u.kind]))].join('、')}
                    ），套用後那幾格會是空的。其餘內容都會照樣載入。
                  </>
                )}
              </div>
            )}

            {result.unmodeled.length > 0 && (
              <p className="text-[11px] text-text-dim leading-relaxed">
                這串代碼裡有 {result.unmodeled.length} 段本站目前讀不懂的內容（多半來自更新的版本），已略過。
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="hud-cut-sm text-[12px] px-3 py-1.5 border border-border text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!result?.ok}
            className="hud-cut-sm text-[12px] px-3 py-1.5 border border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            套用這套配裝
          </button>
        </div>

        {/* 覆蓋警告放在按鈕下方而不是彈第二層確認：多一層點擊擋不住誤操作，
            只會讓每一次正常操作都多按一下 */}
        <p className="mt-2 text-[11px] text-text-dim text-right">套用會取代你目前正在配的這一套。</p>
      </div>
    </div>
  )
}
