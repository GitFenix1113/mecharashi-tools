import { useEffect, useRef } from 'react'
import type { CascadeNotice } from '../../pages/simulator/simReducer'

// ─── 級聯回饋（PLAN-052-B A-1 / C-1）─────────────────────────────────────────
//
// 決策三那張表的「回饋」欄，全部由這一則 toast 兌現：
//   「移除 2 項：左肩 熔火 · 右肩 熔火」＋ [復原]，同時左欄對應的格閃橙 600ms。
//
// ⚠ **[復原] 是這個設計的安全網**：級聯會在玩家沒有預期的時候拿掉東西
//   （換一台機甲、換一個背包），沒有一鍵還原的話，唯一的補救是憑記憶重配一次。
// ⚠ 出力變化與「被移除的東西」分開列：它不是移除項，但它是玩家最容易漏看、
//   卻最影響後續判斷的一件事。

interface Props {
  notice: CascadeNotice | null
  /**
   * 單欄版面：抬高讓開底部的兩層固定列（本頁操作列 ＋ Layout 的手機 Tab Bar）。
   *
   * ⚠ 這不是新需求，是**修既有缺陷**：站上的手機 Tab Bar 高 3.5rem，
   *   `bottom-4` 的 toast 在手機上本來就被它整條蓋住 —— 而 toast 上有 [復原]，
   *   那是級聯拿掉裝備之後唯一的補救按鈕。
   *
   * ⚠ 收的是**算好的 CSS `bottom` 值**而不是布林：操作列的高度會隨按鈕數與
   *   使用者字級變（超重時多一顆、窄畫面會換行），這裡曾經寫死 `7rem`，
   *   而那個常數一被換行破壞，就是「[復原] 被壓在列底下」。
   *   由 `LoadoutPage` 量測固定列高度後算出；`undefined` ＝ 不抬高。
   */
  raisedBottom?: string
  onUndo: () => void
  onDismiss: () => void
}

/** 自動收起的秒數。夠讀完兩三行、又不會一直擋著畫面。 */
const AUTO_DISMISS_MS = 7000

export function CascadeToast({ notice, raisedBottom, onUndo, onDismiss }: Props) {
  // ⚠ onDismiss 放 ref（且在 effect 裡同步）：呼叫端多半寫成 inline 箭頭函式，
  //   每次 render 都是新 reference，直接放進下方的依賴陣列會讓自動收起的計時器
  //   一直重新開始—— toast 就永遠不會自己收起，而且沒有任何錯誤訊息。
  //   放 ref 而不是要求呼叫端 useCallback：後者是跨檔且無人把關的不變式。
  const dismissRef = useRef(onDismiss)
  useEffect(() => { dismissRef.current = onDismiss }, [onDismiss])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => dismissRef.current(), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
    // seq 是每次級聯遞增的序號 —— 用它當依賴，同樣內容的第二次級聯也會重新計時
  }, [notice?.seq, notice])

  if (!notice) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 z-40 w-[min(92vw,26rem)] rounded-xl border border-border-accent bg-bg-tooltip shadow-lg px-3.5 py-3"
      style={{ bottom: raisedBottom ?? '1rem' }}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-text-primary">{notice.title}</div>

          {notice.removed.length > 0 && (
            <div className="mt-1 text-[12px] text-text-secondary leading-relaxed">
              移除 {notice.removed.length} 項：
              {notice.removed.map((r, i) => (
                <span key={`${r.id}-${r.where ?? ''}-${i}`}>
                  {i > 0 && ' · '}
                  {r.where && <span className="text-text-dim">{r.where} </span>}
                  {r.name}
                </span>
              ))}
              <div className="text-[11px] text-text-dim mt-0.5">{notice.removed[0].why}</div>
            </div>
          )}

          {notice.notes.map((n) => (
            <div key={n} className="mt-1 text-[11px] text-accent-cyan/90">{n}</div>
          ))}
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          {notice.undoable && (
            <button
              type="button"
              onClick={onUndo}
              className="text-[11px] px-2 py-1 rounded border border-accent-orange/40 text-accent-orange hover:bg-accent-orange/10 transition-colors cursor-pointer"
            >
              復原
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="關閉提示"
            className="text-[11px] px-2 py-1 rounded border border-border text-text-dim hover:text-text-primary transition-colors cursor-pointer"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  )
}
