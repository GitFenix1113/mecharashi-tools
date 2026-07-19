import { USE_EMULATOR } from '../lib/firebase'

/**
 * 本地模擬器環境標示（PLAN-030 Phase 0）
 *
 * 引入模擬器後最危險的失誤模式是「以為連著模擬器、其實正在對正式資料庫做破壞性操作」，
 * 或反過來「以為在測試環境而放心亂刪」。因此環境切換必須在畫面上常駐可見，不能只靠 console。
 *
 * 刻意選右下角固定定位 + pointer-events-none：不擋操作、不影響截圖判讀，但永遠在視野內。
 * 非模擬器模式回傳 null（正式站不會有任何多餘 DOM）。
 *
 * 刻意「不」加 aria-hidden：這是安全指示器，必須讓螢幕閱讀器唸得出來，
 * 也必須讓自動化測試（AGENT 的 a11y 快照）驗證得到「現在確實連在模擬器」。
 * 不擋操作靠的是 pointer-events-none，不是把自己從無障礙樹裡藏起來。
 */
export default function EmulatorBadge() {
  if (!USE_EMULATOR) return null

  return (
    <div
      role="status"
      className="fixed bottom-3 right-3 z-[9999] pointer-events-none select-none
                 flex items-center gap-1.5 rounded-full
                 bg-accent-green/15 border border-accent-green/40
                 px-3 py-1.5 text-xs font-medium text-accent-green
                 shadow-lg backdrop-blur"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-green opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-green" />
      </span>
      本地模擬器
    </div>
  )
}
