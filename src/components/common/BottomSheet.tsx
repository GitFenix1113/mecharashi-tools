import { createPortal } from 'react-dom'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

// ─── 手機版底部彈出面板（PLAN-052-B B-3 補齊 a11y ＋ footer slot）──────────────
//
// ⚠ **這是共用元件，改動要獨立驗收。** 它已被 PLAN-019 的引用浮窗、ModuleAllLevels、
//   ActivityBar、四個圖鑑頁使用；配裝器（052-B）再把它從「偶爾用的浮窗」升級成
//   手機上每次選武器都會用到的主要互動 —— 所以是改這一份，不是在配裝器裡分叉一份。
//
// 改造前它只有 portal ＋ 遮罩 onClick，缺六項無障礙基本功：
//   role="dialog" ／ aria-modal ／ aria-labelledby ／ Escape 關閉 ／ focus trap ／ 焦點歸還。
// 對鍵盤與螢幕閱讀器使用者來說，那等於「打開一個看不見、也離不開的東西」。
//
// 另加三件配裝器要用的：
//   · `footer` slot —— 手機版 sheet 會蓋住 HUD 的重量條，沒有底部常駐預算列，玩家在挑選時是瞎選。
//   · body scroll lock —— 沒有它，捲到 sheet 內容底部後會繼續捲動背後的頁面（scroll chaining）。
//   · safe-area-inset-bottom —— iPhone 底部橫條會蓋住 footer 的最後一列。

/**
 * 目前開著的 sheet 堆疊（by instance id）。
 *
 * ⚠ 存在的理由只有一個：**堆疊時只畫一層遮罩**。ReferenceContext 的引用浮窗可以從
 *   配裝器的 sheet 內部再開一層，兩層各畫一次 `bg-black/60` 會疊成幾乎全黑。
 *   也順便讓 scroll lock 在最後一層關閉時才解除。
 */
let sheetStack: string[] = []
const stackListeners = new Set<() => void>()
function notifyStack() { stackListeners.forEach((fn) => fn()) }

interface Props {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  /**
   * 標題列。有值時同時當作 `aria-labelledby` 的來源 —— 這是螢幕閱讀器唯一能講出
   * 「你現在在哪個對話框」的方式。沒有標題時退回 `aria-label`（見 `label`）。
   */
  title?: React.ReactNode
  /** 無標題時的無障礙名稱。兩者都沒有時用一個誠實但無用的預設值 */
  label?: string
  /**
   * 底部常駐區（不隨內容捲動）。配裝器用它放預算列：
   * 「目前餘 X → 裝上後 Y」，超重轉紅。
   */
  footer?: React.ReactNode
}

export function BottomSheet({ open, onClose, children, title, label, footer }: Props) {
  const instanceId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)
  const [, forceRender] = useState(0)
  const titleId = `${instanceId}-title`

  // 堆疊登記。訂閱是為了「別人開了新的一層」時，自己要重畫成不畫遮罩
  useEffect(() => {
    const bump = () => forceRender((n) => n + 1)
    stackListeners.add(bump)
    return () => { stackListeners.delete(bump) }
  }, [])

  useEffect(() => {
    if (!open) return
    sheetStack = [...sheetStack, instanceId]
    notifyStack()
    return () => {
      sheetStack = sheetStack.filter((id) => id !== instanceId)
      notifyStack()
    }
  }, [open, instanceId])

  // body scroll lock —— 最後一層關掉時才還原
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      if (sheetStack.filter((id) => id !== instanceId).length === 0) document.body.style.overflow = prev
    }
  }, [open, instanceId])

  // 焦點：進場移入面板、離場歸還原本的元素
  //
  // ⚠ 歸還很重要而且常被漏掉：從一張武器卡開啟 sheet、關閉後焦點若掉回 <body>，
  //   鍵盤使用者得從頁首重新 Tab 一輪才回得到剛才的位置。
  useEffect(() => {
    if (!open) return
    restoreTo.current = document.activeElement as HTMLElement | null
    const timer = setTimeout(() => panelRef.current?.focus(), 0)
    return () => {
      clearTimeout(timer)
      restoreTo.current?.focus?.()
    }
  }, [open])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
    if (e.key !== 'Tab') return
    // focus trap：Tab 到最後一個之後回到第一個，Shift+Tab 反之
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (!focusables || focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    else if (e.shiftKey && (active === first || active === panelRef.current)) { e.preventDefault(); last.focus() }
  }, [onClose])

  if (!open) return null

  const depth = Math.max(0, sheetStack.indexOf(instanceId))
  const isTop = sheetStack[sheetStack.length - 1] === instanceId

  return createPortal(
    <div
      className="fixed inset-0 flex flex-col justify-end"
      style={{ zIndex: 50 + depth * 2 }}
      onKeyDown={onKeyDown}
    >
      {/* 只有最上層畫遮罩 —— 兩層各畫一次會疊成幾乎全黑（見檔頭 sheetStack） */}
      {isTop && <div className="absolute inset-0 bg-black/60" onClick={onClose} />}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        {...(title ? { 'aria-labelledby': titleId } : { 'aria-label': label ?? '詳細資訊' })}
        tabIndex={-1}
        // ⚠ 用 bg-tooltip 而不是 bg-card：bg-card 是 65% 透明，在卡片上很好看，
        //   但 sheet 是蓋在整頁上的 modal —— 底下的表格數字會透上來與清單混在一起。
        //   bg-tooltip（近乎不透明）就是為這件事而存在的設計字彙。
        className="relative bg-bg-tooltip border-t border-border-accent rounded-t-2xl max-h-[85vh] flex flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 flex items-center justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>
        <button
          className="absolute top-2 right-3 w-8 h-8 flex items-center justify-center rounded-full text-text-dim hover:text-text-primary hover:bg-bg-dark transition-colors text-lg leading-none cursor-pointer"
          onClick={onClose}
          aria-label="關閉"
        >
          ✕
        </button>
        {title && (
          <div id={titleId} className="flex-shrink-0 px-4 pr-12 pb-2 text-sm font-bold text-text-primary">
            {title}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-1 pb-4">
          {children}
        </div>
        {footer && (
          <div
            className="flex-shrink-0 border-t border-border bg-bg-tooltip px-4 pt-2.5"
            // iPhone 底部橫條會蓋住 footer 的最後一列
            style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        )}
        {/* footer 缺席時，底部留白同樣要讓開安全區 */}
        {!footer && <div style={{ height: 'env(safe-area-inset-bottom)' }} />}
      </div>
    </div>,
    document.body,
  )
}
