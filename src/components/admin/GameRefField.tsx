// ── 遊戲身分鍵 gameRef 的唯讀顯示（PLAN-065-A B-5）───────────────────────────────
// 後台各實體編輯面板的一列（GameRefRow）＋列表列的一枚小標（GameRefBadge）。
//
// gameRef 的唯一寫入者是回填腳本 scripts/backfill-game-join-keys.mjs，後台**只看不改**；
// 存檔時怎麼保證不被洗掉見 pages/user/admin/gameRefGuard.ts。
// 未設定＝未連結：傷害模擬不會把這筆算進去，所以「未連結」要看得見（總綱決策三）。
//
// 刻意吃「任意物件」而不是八種 gameRef 型別各寫一份：欄位名直接照型別顯示
// （pilotInfoId、suitId、entryId…），日後型別多一個欄位，這裡不用跟著改。
// 也刻意不跟 gameId 並排比較——兩者是不同的東西、不互推（見 types/gameRef.ts）。

const UNLINKED_TITLE = '尚未連結遊戲資料：傷害模擬不會把它算進去。由回填腳本寫入，後台不能改。'

/** 取出有值的欄位：數字照列、陣列以「、」串起；undefined／空陣列略過。全空＝未連結。 */
function gameRefEntries(value: object | undefined): [string, string][] {
  if (!value) return []
  const out: [string, string][] = []
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'number') out.push([key, String(v)])
    else if (Array.isArray(v) && v.length > 0) out.push([key, v.join('、')])
  }
  return out
}

/**
 * 編輯面板用：一列唯讀「遊戲 ID」。放在標題下方，各分頁都看得到。
 * unlinkedHint：未連結時的說明（滑過才看）；有些集合「未連結」可能是正常的（例：沒人持有的技能），用它講清楚。
 */
export function GameRefRow({ value, className = '', unlinkedHint = UNLINKED_TITLE }: { value: object | undefined; className?: string; unlinkedHint?: string }) {
  const entries = gameRefEntries(value)
  return (
    <div className={`flex items-center gap-1.5 flex-wrap text-[12px] ${className}`}>
      <span className="text-text-dim">遊戲 ID</span>
      {entries.length === 0 ? (
        <span
          title={unlinkedHint}
          className="px-1.5 py-0.5 rounded border border-accent-yellow/40 bg-accent-yellow/10 text-accent-yellow"
        >
          未連結
        </span>
      ) : (
        entries.map(([key, text]) => (
          <span key={key} className="px-1.5 py-0.5 rounded border border-border bg-bg-dark font-mono text-text-secondary">
            <span className="text-text-dim">{key}</span> {text}
          </span>
        ))
      )}
      <span className="text-text-dim">（唯讀，由回填腳本寫入）</span>
    </div>
  )
}

/**
 * 列表列用的小標。全庫回填前每一列都會是「ID 未連結」，所以刻意用暗色、不搶畫面；
 * 多帶「ID」兩字是因為神驅能力等頁的「未連結」指的是 [xxx] 引用，單看兩個字會搞混。
 * 已連結時只亮一個「遊戲 ID」，數值放 title（滑過才看），列表本身已經夠擠。
 */
export function GameRefBadge({ value }: { value: object | undefined }) {
  const entries = gameRefEntries(value)
  if (entries.length === 0) {
    return (
      <span title={UNLINKED_TITLE} className="text-[12px] px-1.5 py-0.5 rounded border border-border text-text-dim shrink-0">
        ID 未連結
      </span>
    )
  }
  return (
    <span
      title={entries.map(([key, text]) => `${key} ${text}`).join('\n')}
      className="text-[12px] px-1.5 py-0.5 rounded border border-accent-green/40 bg-accent-green/10 text-accent-green shrink-0"
    >
      遊戲 ID
    </span>
  )
}
