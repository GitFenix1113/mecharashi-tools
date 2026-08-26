import { useRef, useState } from 'react'
import type { NeuralDrive, NeuralDriveAbility } from '../../types'
import { ND_RULES, isGammaZone, zonePower } from '../../utils/ndOverrides'
import { NdActiveAbilities } from './NdActiveAbilities'

// ─── 神經驅動算力配置列（PLAN-021 · 1-6／PLAN-052-I D-1）──────────────────────
//
// 玩家點選各區 Lv（仿遊戲內 Lv 條），天賦敘述與 BUFF 階隨配置即時改寫。
//
// ⚠ **門檻規則一行都不在這裡**：`ND_RULES.gammaPairCap` / `zonePower()` / `defaultNdLevels()`
//   全部住在 `src/utils/ndOverrides.ts`，與 PLAN-034 的 BUFF 階覆寫層共用同一份。
//   在這裡寫死 23 或自己算 minSum，會讓「畫面上點得動」與「覆寫表認不認」兩件事分頭漂移，
//   而症狀是靜默的：Lv 條亮了第 5 格，正文卻沒有換字。
//
// ⚠ **兩種版型共用同一支元件，不是兩份實作**（052-I D-1）。`canSet` / `clickSquare` /
//   上限提示都在這裡，兩個 layout 只差在怎麼畫。抽成兩個檔的話，γ 上限這條規則就會有
//   兩份要同步的實作 —— 而模擬器那份是後寫的，必然先漂。
//
//   'inline'  機師詳情頁：分頁卡頂部的一條橫向配置列（原 PilotDetailPage 的區域元件）
//   'panel'   配裝模擬器：左欄機師卡下方的直式面板，多一段「目前生效能力」
//
// ⚠ panel 版的內距與間隙**一律寫 px**（052-I B-2 踩過）：本站 root font-size 是 19px，
//   Tailwind 的 spacing 單位是 rem 的倍數，`gap-2.5` 實測 11.9px —— 分區列會被撐開，
//   Lv 條反而被擠窄。

export interface NdPowerBarProps {
  drives: NeuralDrive[]
  /** 分區名 → 選定 Lv。呼叫端負責疊上 `defaultNdLevels()`，本元件只讀不補 */
  levels: Record<string, number>
  /** 這些分區的算力會改寫天賦／技能敘述 → 標 ★（由 ndVariants.zone 與 buffUpgrades 推導） */
  affectZones: Set<string>
  onChange: (next: Record<string, number>) => void
  /** 版型。省略＝機師頁的橫向列（既有行為，byte-identical） */
  layout?: 'inline' | 'panel'
  /**
   * panel 版的「目前生效能力」用來解析能力名。省略則整段不畫 —— 空標題配一片空白，
   * 比沒有那一段更難理解（決策四：不渲染，不是渲染空的）。
   */
  abilityMap?: Map<string, NeuralDriveAbility>
}

export function NdPowerBar({
  drives, levels, affectZones, onChange, layout = 'inline', abilityMap,
}: NdPowerBarProps) {
  const [capHint, setCapHint] = useState(false)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const gammaSum = drives
    .filter(d => isGammaZone(d.name))
    .reduce((s, d) => s + zonePower(d, levels[d.name] ?? 0), 0)

  function canSet(drive: NeuralDrive, lv: number): boolean {
    if (!isGammaZone(drive.name)) return true
    const others = drives
      .filter(d => isGammaZone(d.name) && d.name !== drive.name)
      .reduce((s, d) => s + zonePower(d, levels[d.name] ?? 0), 0)
    return others + zonePower(drive, lv) <= ND_RULES.gammaPairCap
  }

  function clickSquare(drive: NeuralDrive, lv: number) {
    const cur = levels[drive.name] ?? 0
    const target = cur === lv ? lv - 1 : lv // 點最上面那格 = 降一級
    if (target > cur && !canSet(drive, target)) {
      setCapHint(true)
      if (hintTimer.current) clearTimeout(hintTimer.current)
      hintTimer.current = setTimeout(() => setCapHint(false), 2600)
      return
    }
    onChange({ ...levels, [drive.name]: target })
  }

  /** 某一格的三態：已點亮／可點／被 γ 上限鎖住。兩個版型共用同一套判定。 */
  const stateOf = (d: NeuralDrive, lv: number): 'on' | 'open' | 'locked' => {
    const cur = levels[d.name] ?? 0
    if (cur >= lv) return 'on'
    return canSet(d, lv) ? 'open' : 'locked'
  }

  const capText = `⚠ γ 區合計算力上限 ${ND_RULES.gammaPairCap}（上下16）—— 先降低另一個 γ 區。`

  if (layout === 'panel') {
    return (
      <NdPowerPanel
        drives={drives}
        levels={levels}
        affectZones={affectZones}
        gammaSum={gammaSum}
        capHint={capHint}
        capText={capText}
        stateOf={stateOf}
        onSquare={clickSquare}
        abilityMap={abilityMap}
      />
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2 bg-accent-pink/[0.04] border-b border-border">
      <span className="text-[11px] font-bold tracking-[2px] text-accent-pink uppercase whitespace-nowrap">
        ▶ 神經驅動算力
      </span>
      {drives.map((d) => {
        const cur = levels[d.name] ?? 0
        return (
          <span key={d.name} className="flex items-center gap-1.5">
            <span className="relative text-[13px] font-bold text-text-primary">
              {d.name}
              {affectZones.has(d.name) && (
                <span className="absolute -top-1.5 -right-2 text-[9px] text-accent-pink" title="此區算力會改寫天賦／技能敘述">★</span>
              )}
            </span>
            <span className="flex gap-[3px] ml-1.5">
              {d.levels.map((lvl, i) => {
                const lv = i + 1
                const st = stateOf(d, lv)
                return (
                  <button
                    key={lv}
                    type="button"
                    title={`Lv${lv}（算力 ${lvl.minSum}）`}
                    onClick={() => clickSquare(d, lv)}
                    className={`w-3.5 h-3.5 rounded-[3px] border transition-all ${
                      st === 'on'
                        ? 'bg-accent-yellow border-accent-yellow shadow-[0_0_5px_rgba(251,191,36,0.45)]'
                        : st === 'locked'
                          ? 'bg-bg-dark border-border border-dashed opacity-25 cursor-not-allowed'
                          : 'bg-bg-dark border-[#4a4f5e] hover:border-accent-yellow cursor-pointer'
                    }`}
                  />
                )
              })}
            </span>
            <span className="text-[11px] text-text-dim font-mono whitespace-nowrap">
              {zonePower(d, cur)}
            </span>
          </span>
        )
      })}
      <span className={`ml-auto text-[11.5px] font-mono px-2.5 py-0.5 rounded-md border border-border bg-bg-dark ${
        gammaSum >= ND_RULES.gammaPairCap ? 'text-accent-red' : 'text-text-secondary'
      }`}>
        γ合計 {gammaSum} / {ND_RULES.gammaPairCap}
      </span>
      {capHint && <span className="w-full text-[11.5px] text-accent-red">{capText}</span>}
    </div>
  )
}

// ─── panel 版（配裝模擬器左欄）────────────────────────────────────────────────

function NdPowerPanel({
  drives, levels, affectZones, gammaSum, capHint, capText, stateOf, onSquare, abilityMap,
}: {
  drives: NeuralDrive[]
  levels: Record<string, number>
  affectZones: Set<string>
  gammaSum: number
  capHint: boolean
  capText: string
  stateOf: (d: NeuralDrive, lv: number) => 'on' | 'open' | 'locked'
  onSquare: (d: NeuralDrive, lv: number) => void
  abilityMap?: Map<string, NeuralDriveAbility>
}) {
  return (
    <div className="flex flex-col" style={{ gap: 11 }}>
      <div className="flex flex-col" style={{ gap: 9 }}>
        {drives.map((d) => (
          <div key={d.name} className="flex items-center" style={{ gap: 10 }}>
            <span className="relative shrink-0 text-[15px] font-extrabold text-text-primary" style={{ width: 28 }}>
              {d.name}
              {affectZones.has(d.name) && (
                <span
                  className="absolute -top-1 -right-1 text-[10px] text-accent-pink"
                  title="此區算力會改寫天賦／技能敘述"
                >★</span>
              )}
            </span>
            {/* Lv 條：每一格 flex-1，於是分區級數不同（3 級／6 級）時整條寬度仍然對齊 */}
            <span className="flex grow min-w-0" style={{ gap: 4 }}>
              {d.levels.map((lvl) => {
                const st = stateOf(d, lvl.level)
                return (
                  <button
                    key={lvl.level}
                    type="button"
                    title={`${d.name} Lv${lvl.level}（算力 ${lvl.minSum}）`}
                    onClick={() => onSquare(d, lvl.level)}
                    className={`grow min-w-0 transition-all ${
                      st === 'on'
                        ? 'bg-accent-yellow shadow-[0_0_7px_rgba(234,179,8,0.5)] cursor-pointer'
                        : st === 'locked'
                          ? 'bg-bg-dark border border-dashed border-border opacity-35 cursor-not-allowed'
                          : 'bg-bg-dark border border-[#4a4f5e] hover:border-accent-yellow cursor-pointer'
                    }`}
                    style={{ height: 18 }}
                  />
                )
              })}
            </span>
            <span className="shrink-0 text-right font-[JetBrains_Mono,monospace] tabular-nums text-[14px] text-text-primary" style={{ width: 28 }}>
              {zonePower(d, levels[d.name] ?? 0)}
            </span>
          </div>
        ))}
      </div>

      <div className={`self-start hud-cut-sm border px-2 py-0.5 font-[JetBrains_Mono,monospace] tabular-nums text-[12px] bg-bg-dark ${
        gammaSum >= ND_RULES.gammaPairCap ? 'border-accent-red/50 text-accent-red' : 'border-border text-text-secondary'
      }`}>
        γ 合計 {gammaSum} / {ND_RULES.gammaPairCap}
      </div>

      {capHint && <p className="text-[11.5px] text-accent-red leading-relaxed">{capText}</p>}

      {/* 「目前生效」的圖示、hover 說明與展開詳情獨立成一支（互動語彙與機師詳情頁對齊） */}
      {abilityMap && <NdActiveAbilities drives={drives} levels={levels} abilityMap={abilityMap} />}
    </div>
  )
}
