import type { LoadoutBudget } from '../../utils/loadoutRules'
import { HUD, SEG_COLOR, SEG_LABEL, type SegKey } from './loadoutTheme'

// ─── 常駐帳本列（PLAN-052-B B-1／PLAN-052-I A-3）──────────────────────────────
//
// 一條列回答三件事：**現在多重**、**可用出力多少**、**重量花在哪裡**。
//
// A-3 改的是「階」不是內容：總重與可用出力放大到 30px（全頁唯一的 30px），
// 餘量／超出獨立成一張綠或紅的小卡，分段條與圖例維持原樣。
// 理由是這一列是頁面上唯一的即時回饋 —— 玩家換一把武器就是在看這個數字變化，
// 而它原本跟旁邊的說明文字一樣是 12px，得用找的。
//
// ⚠ 分段配色 `SEG_COLOR` 已移到 `loadoutTheme.ts`：槽位格的重量數字要用同一段的顏色，
//   兩處各留一份必然漂移。
//
// ⚠ **手部那一段必須標明「取較重者」**。官方的算法是 `max(Σ主手, Σ備用)` 而不是相加，
//   所以裝了強襲者背包的玩家會看到「主手 800、備用 850，但條上只有 850」——
//   不寫清楚，他會以為系統少算了一把武器（實際上寫成加總才是錯的，先鋒形態會誤差 44%）。

interface Props {
  budget: LoadoutBudget
  /** hover 挑選器某一列時的假想預算 —— 多出來的部分畫成半透明的新分段 */
  previewBudget?: LoadoutBudget | null
  /** hover 某一段 → 讓左欄對應的格高亮 */
  onHoverSegment?: (label: string | null) => void
  /** 挑選器內的窄版：收掉大數值與餘量卡，只留條與一行摘要 */
  compact?: boolean
  /**
   * 單欄版面的常駐帳本列（PLAN-052-I F-1）。**壓縮排版，不改資訊結構**：
   * 大數值降到 20px、餘量卡與它同一行，條與圖例掉到第二行。
   *
   * ⚠ 不能直接改用 `compact`：那一版把主要數值壓成 12px，而粗指標裝置**沒有 hover 預覽**，
   *   這條帳本列是玩家換裝後唯一的即時回饋 —— 它必須一眼讀得到。
   *   實測 390px 寬時預設版會 wrap 成三列共 ~180px，本版兩列 ~110px。
   */
  narrow?: boolean
}

export function OutputBar({ budget, previewBudget, onHoverSegment, compact, narrow }: Props) {
  const { weight, output, remaining, over, dataIncomplete } = budget
  const segs: { key: SegKey; value: number }[] = [
    { key: 'chassis',  value: weight.chassis },
    { key: 'hands',    value: weight.hands },
    { key: 'shoulder', value: weight.shoulder },
    { key: 'back',     value: weight.back },
  ]

  // 分母取「可用出力」與「總重」的較大者：超重時條會撐滿並多出一截紅色，
  // 而不是讓分段各自縮小（那會讓超重看起來像沒事）
  const scale = Math.max(output.total, weight.total, 1)
  const pct = (v: number) => `${(v / scale) * 100}%`
  const extra = previewBudget ? previewBudget.weight.total - weight.total : 0

  const bar = (
    <div
      className={`relative w-full ${compact ? 'h-[10px]' : 'h-[14px]'} overflow-hidden bg-bg-dark border ${
        over ? 'border-accent-red/60' : 'border-border'
      } flex`}
      onMouseLeave={() => onHoverSegment?.(null)}
    >
      {segs.map((s) =>
        s.value > 0 ? (
          <div
            key={s.key}
            className={`${SEG_COLOR[s.key]} h-full transition-[width] duration-200`}
            style={{ width: pct(s.value) }}
            title={`${SEG_LABEL[s.key]} ${s.value.toLocaleString()}`}
            onMouseEnter={() => onHoverSegment?.(SEG_LABEL[s.key])}
          />
        ) : null,
      )}
      {/* 預覽增量：半透明疊在既有分段之後 */}
      {extra > 0 && (
        <div className="h-full bg-accent-orange/50 transition-[width] duration-150" style={{ width: pct(extra) }} />
      )}
    </div>
  )

  const legend = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-text-dim">
      {segs.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1">
          <i className={`inline-block w-2 h-2 ${SEG_COLOR[s.key]}`} />
          {SEG_LABEL[s.key]} <span className={HUD.num}>{s.value.toLocaleString()}</span>
        </span>
      ))}
      {/* ⚠ 這一句不是裝飾：沒有它，裝了強襲者背包的玩家會以為系統少算了一把武器 */}
      {weight.backupHand > 0 && (
        <span>
          手部：主手 <span className={HUD.num}>{weight.mainHand.toLocaleString()}</span>
          ／備用 <span className={HUD.num}>{weight.backupHand.toLocaleString()}</span>
          <strong className="text-text-secondary"> 取較重者</strong>
          （採計{weight.heavierBank === 'backup' ? '備用' : '主手'}組）
        </span>
      )}
    </div>
  )

  const notes = (
    <>
      {output.hasUnknownBackpackBonus && (
        <p className="text-[10px] text-accent-yellow/90 leading-relaxed">
          此背包已知會提供出力，但本站尚未取得數值 —— 實際可用出力會高於上方數字。
        </p>
      )}
      {dataIncomplete && (
        <p className="text-[10px] text-accent-yellow/90 leading-relaxed">
          這台機甲的官方數值尚未公布（全欄位為 0），重量與出力無法計算。
        </p>
      )}
    </>
  )

  // ── 窄版（挑選器內的 budgetLine）──
  // 挑選器本身就是一份長清單，這裡再放 30px 數值會跟清單搶注意力。
  if (compact) {
    return (
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] text-text-dim">總重 ／ 可用出力</span>
          <span className={`${HUD.numSm}`}>
            <strong className={over ? 'text-accent-red' : 'text-text-primary'}>
              {weight.total.toLocaleString()}
            </strong>
            <span className="text-text-dim"> / {output.total.toLocaleString()}</span>
            <span className={`ml-1.5 ${over ? 'text-accent-red' : 'text-accent-green'}`}>
              {over ? `超出 ${(-remaining).toLocaleString()}` : `餘 ${remaining.toLocaleString()}`}
            </span>
          </span>
        </div>
        {bar}
        {legend}
        {notes}
      </div>
    )
  }

  /*
    餘量卡。超重時整張換成紅的並改寫標題 —— 只把數字變成負值不夠：
    「-35」跟「餘 35」在餘光裡幾乎一樣，而這兩者是「能不能出擊」的差別。
  */
  const remainCard = (
    <div
      className={`hud-cut-sm flex flex-col items-end gap-0.5 border ${
        narrow ? 'px-3 py-1.5' : 'px-4 py-2'
      } ${over ? 'border-accent-red/45 bg-accent-red/10' : 'border-accent-green/45 bg-accent-green/10'}`}
    >
      <span className={`${HUD.label} ${over ? 'text-accent-red' : 'text-accent-green'}`}>
        {over ? 'Over' : 'Remaining'}
      </span>
      <span className={`${HUD.numMd} ${over ? 'text-accent-red' : 'text-accent-green'}`}>
        {(over ? -remaining : remaining).toLocaleString()}
      </span>
    </div>
  )

  const totals = (
    <div className="flex flex-col gap-0.5">
      <span className={`${HUD.label} text-text-dim`}>Total / Output</span>
      <span className="flex items-baseline gap-1.5">
        <span className={`${narrow ? HUD.numMd : HUD.numLg} ${over ? 'text-accent-red' : 'text-text-primary'}`}>
          {weight.total.toLocaleString()}
        </span>
        <span className={`${HUD.num} ${narrow ? 'text-[13px]' : 'text-[15px]'} text-text-dim`}>
          / {output.total.toLocaleString()}
        </span>
      </span>
    </div>
  )

  // ── 單欄版面的帳本列（F-1）：兩列。第一列 大數值 ＋ 餘量卡，第二列 條＋圖例 ──
  if (narrow) {
    return (
      <div className="hud-cut flex flex-col gap-2 border border-border-accent bg-bg-card px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          {totals}
          {remainCard}
        </div>
        <div className="flex flex-col gap-1.5">
          {bar}
          {legend}
          {notes}
        </div>
      </div>
    )
  }

  // ── 常駐帳本列 ──
  // 三塊橫排：大數值 ／ 條＋圖例 ／ 餘量卡。窄視窗時 flex-wrap 讓餘量卡掉到第二行，
  // 而不是把中間的條壓到讀不出比例。
  return (
    <div className="hud-cut flex flex-wrap items-center gap-x-5 gap-y-3 border border-border-accent bg-bg-card px-4 py-3">
      <div className="min-w-[9rem]">{totals}</div>

      <div className="flex-1 min-w-[14rem] flex flex-col gap-1.5">
        {bar}
        {legend}
        {notes}
      </div>

      {remainCard}
    </div>
  )
}
