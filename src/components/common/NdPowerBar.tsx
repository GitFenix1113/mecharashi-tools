import { useRef, useState } from 'react'
import type { NeuralDrive, NeuralDriveAbility } from '../../types'
import { ND_RULES, isGammaZone, zonePower } from '../../utils/ndOverrides'
import { effectiveNdLevels, type NdPowerBonus } from '../../utils/ndPowerBonus'
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
//
// ── PLAN-052-M 起的兩條 ──────────────────────────────────────────────────────
//
// ⚠ **α／β 鎖死在滿級、不開放調整**（使用者裁決 2026-08-30）。它們只有 3 級、取得成本低，
//   實務上人人點滿；開放調整只是替一個沒有人會做的選擇留一組按鈕。
//   ⚠ **仍然畫出來**，不是整列隱藏：看過遊戲的人找不到 α／β 會以為本站漏了資料。
//     畫成「亮著但點不動」才同時說出「它在」與「它不歸你管」。
//   ⚠ 這條與資料一致而不是硬湊：實測 178 個 α／β 分區**零個**帶 `buffUpgrades`
//     ⇒ `defaultNdLevels()` 對它們一律給滿級，鎖死之後值一個都不會變。
//
// ⚠ **加成格與投入格必須長得不一樣**（`bonus`）。模組給的算力不花 γ 預算，
//   所以「條上亮到第 4 格」與「投入徽章 23／23」會同時成立 —— 兩者混成同一種黃色的話，
//   玩家只會覺得數字自己在跳。加成格畫成**虛線描邊的黃**，並在下面明說它落在哪一區。
//   ⚠ 徽章的字是**「投入」不是「合計」**：23 是可投入上限，不是生效上限（生效可以到 26）。

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
  /**
   * 模組給的算力加成（PLAN-052-M）。**由呼叫端算好傳進來**，本元件不查模組 ——
   * 機師詳情頁根本沒有配裝，讓這支元件去問 `ctx` 等於把一條 Lv 條綁死在模擬器上。
   *
   * ⚠ `levels` 收的仍然是**玩家投入**的值，不是生效值：那條 γ 預算閘門（`canSet`）
   *   要讀投入值，而加成不花預算。兩者混用的症狀是「裝上模組反而少能點一格」。
   */
  bonus?: NdPowerBonus | null
}

export function NdPowerBar({
  drives, levels, affectZones, onChange, layout = 'inline', abilityMap, bonus,
}: NdPowerBarProps) {
  const [capHint, setCapHint] = useState(false)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const gammaSum = drives
    .filter(d => isGammaZone(d.name))
    .reduce((s, d) => s + zonePower(d, levels[d.name] ?? 0), 0)

  /**
   * α／β **不開放調整**（見檔頭）。判準就是「不是 γ 區」—— 不要改成列舉分區名，
   * 全庫只有 α／β／γ／γ1／γ2 五種，但那 10 位老角的分區名是單一字元 `γ`。
   */
  const isFixedZone = (drive: NeuralDrive) => !isGammaZone(drive.name)

  function canSet(drive: NeuralDrive, lv: number): boolean {
    if (isFixedZone(drive)) return false
    const others = drives
      .filter(d => isGammaZone(d.name) && d.name !== drive.name)
      .reduce((s, d) => s + zonePower(d, levels[d.name] ?? 0), 0)
    return others + zonePower(drive, lv) <= ND_RULES.gammaPairCap
  }

  function clickSquare(drive: NeuralDrive, lv: number) {
    if (isFixedZone(drive)) return
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

  /**
   * 某一格的四態。兩個版型共用同一套判定。
   *
   *   `on`     玩家投入點亮的
   *   `bonus`  **模組加成給的那一格**（PLAN-052-M）—— 亮著，但不是玩家的預算換來的
   *   `open`   還可以點
   *   `locked` 被 γ 投入上限擋住／或這一區根本不開放調整（α／β）
   *
   * ⚠ `bonus` 要壓在 `open` 之前判：那一格本來就是「還沒點的下一格」，
   *   不特別畫的話它與旁邊的空格長得一樣，加成就等於沒說出來。
   */
  const stateOf = (d: NeuralDrive, lv: number): 'on' | 'bonus' | 'open' | 'locked' => {
    const cur = levels[d.name] ?? 0
    if (cur >= lv) return 'on'
    if (bonus?.zone === d.name && lv <= bonus.level) return 'bonus'
    return canSet(d, lv) ? 'open' : 'locked'
  }

  const capText = `⚠ γ 區可投入算力上限 ${ND_RULES.gammaPairCap}（上下16）—— 先降低另一個 γ 區。`

  /**
   * 加成那一行的說明。**一定要講出它落在哪一區**：落點是「算力最低的 γ 區」，
   * 玩家把 γ2 降一級就可能整個跳到 γ1 —— 不標的話，畫面上是「我動這裡、那裡自己亮起來」。
   */
  const bonusText = !bonus ? null
    : bonus.zone
      ? `⊕ ${bonus.moduleName} LV.MAX：算力最低的分區 +${bonus.amount} —— 現在落在 ${bonus.zone}（生效算力 ${bonus.power}）`
      : `⊕ ${bonus.moduleName} LV.MAX：算力最低的分區 +${bonus.amount} —— 但 γ 區已滿級，這 ${bonus.amount} 點沒有落點`

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
        bonus={bonus}
        bonusText={bonusText}
        isFixedZone={isFixedZone}
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
                const fixed = isFixedZone(d)
                return (
                  <button
                    key={lv}
                    type="button"
                    disabled={fixed}
                    title={fixed
                      ? `${d.name} 固定滿級，本站不開放調整`
                      : st === 'bonus'
                        ? `${bonus?.moduleName} 加成給的（算力 +${bonus?.amount}）`
                        : `Lv${lv}（算力 ${lvl.minSum}）`}
                    onClick={() => clickSquare(d, lv)}
                    className={`w-3.5 h-3.5 rounded-[3px] border transition-all ${
                      st === 'on'
                        ? `bg-accent-yellow border-accent-yellow ${fixed ? 'opacity-60 cursor-default' : 'shadow-[0_0_5px_rgba(251,191,36,0.45)]'}`
                        : st === 'bonus'
                          // 加成格：虛線描邊的黃 —— 亮著，但看得出不是實心的那一種
                          ? 'bg-accent-yellow/25 border-accent-yellow border-dashed cursor-pointer'
                          : st === 'locked'
                            ? `bg-bg-dark border-border border-dashed opacity-25 ${fixed ? 'cursor-default' : 'cursor-not-allowed'}`
                            : 'bg-bg-dark border-[#4a4f5e] hover:border-accent-yellow cursor-pointer'
                    }`}
                  />
                )
              })}
            </span>
            {/* 讀數是**生效**算力（含加成）：它決定哪些能力亮著，而那才是玩家在看的。
                投入了多少請看右邊的徽章 —— 兩者在有加成時本來就不相等。 */}
            <span className={`text-[11px] font-mono whitespace-nowrap ${
              bonus?.zone === d.name ? 'text-accent-yellow font-bold' : 'text-text-dim'
            }`}>
              {bonus?.zone === d.name ? bonus.power : zonePower(d, cur)}
            </span>
          </span>
        )
      })}
      <span className={`ml-auto text-[11.5px] font-mono px-2.5 py-0.5 rounded-md border border-border bg-bg-dark ${
        gammaSum >= ND_RULES.gammaPairCap ? 'text-accent-red' : 'text-text-secondary'
      }`}>
        γ投入 {gammaSum} / {ND_RULES.gammaPairCap}
      </span>
      {bonusText && <span className="w-full text-[11.5px] text-accent-yellow">{bonusText}</span>}
      {capHint && <span className="w-full text-[11.5px] text-accent-red">{capText}</span>}
    </div>
  )
}

// ─── panel 版（配裝模擬器左欄）────────────────────────────────────────────────

function NdPowerPanel({
  drives, levels, affectZones, gammaSum, capHint, capText, stateOf, onSquare, abilityMap,
  bonus, bonusText, isFixedZone,
}: {
  drives: NeuralDrive[]
  levels: Record<string, number>
  affectZones: Set<string>
  gammaSum: number
  capHint: boolean
  capText: string
  stateOf: (d: NeuralDrive, lv: number) => 'on' | 'bonus' | 'open' | 'locked'
  onSquare: (d: NeuralDrive, lv: number) => void
  abilityMap?: Map<string, NeuralDriveAbility>
  bonus?: NdPowerBonus | null
  bonusText: string | null
  isFixedZone: (d: NeuralDrive) => boolean
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
                const fixed = isFixedZone(d)
                return (
                  <button
                    key={lvl.level}
                    type="button"
                    disabled={fixed}
                    title={fixed
                      ? `${d.name} 固定滿級，本站不開放調整`
                      : st === 'bonus'
                        ? `${bonus?.moduleName} 加成給的（算力 +${bonus?.amount}）`
                        : `${d.name} Lv${lvl.level}（算力 ${lvl.minSum}）`}
                    onClick={() => onSquare(d, lvl.level)}
                    className={`grow min-w-0 transition-all ${
                      st === 'on'
                        ? `bg-accent-yellow ${fixed ? 'opacity-55 cursor-default' : 'shadow-[0_0_7px_rgba(234,179,8,0.5)] cursor-pointer'}`
                        : st === 'bonus'
                          // 加成格：虛線描邊的黃 —— 亮著，但看得出不是玩家的預算換來的
                          ? 'bg-accent-yellow/25 border border-dashed border-accent-yellow cursor-pointer'
                          : st === 'locked'
                            ? `bg-bg-dark border border-dashed border-border opacity-35 ${fixed ? 'cursor-default' : 'cursor-not-allowed'}`
                            : 'bg-bg-dark border border-[#4a4f5e] hover:border-accent-yellow cursor-pointer'
                    }`}
                    style={{ height: 18 }}
                  />
                )
              })}
            </span>
            {/* 讀數是**生效**算力（含加成）—— 決定哪些能力亮著的是它。
                投入了多少請看下面的徽章：有加成時兩者本來就不相等。 */}
            <span className={`shrink-0 text-right font-[JetBrains_Mono,monospace] tabular-nums text-[14px] ${
              bonus?.zone === d.name ? 'text-accent-yellow font-bold' : 'text-text-primary'
            }`} style={{ width: 28 }}>
              {bonus?.zone === d.name ? bonus.power : zonePower(d, levels[d.name] ?? 0)}
            </span>
          </div>
        ))}
      </div>

      <div className={`self-start hud-cut-sm border px-2 py-0.5 font-[JetBrains_Mono,monospace] tabular-nums text-[12px] bg-bg-dark ${
        gammaSum >= ND_RULES.gammaPairCap ? 'border-accent-red/50 text-accent-red' : 'border-border text-text-secondary'
      }`}>
        γ 投入 {gammaSum} / {ND_RULES.gammaPairCap}
      </div>

      {bonusText && <p className="text-[11.5px] text-accent-yellow leading-relaxed">{bonusText}</p>}
      {/* α／β 點不動這件事要講一次。⚠ 不講的話，玩家會以為那兩條壞掉了 */}
      <p className="text-[11px] text-text-dim leading-relaxed">
        α／β 固定滿級、不開放調整 —— 它們只有 3 級且取得成本低，實務上人人點滿。
      </p>

      {capHint && <p className="text-[11.5px] text-accent-red leading-relaxed">{capText}</p>}

      {/* 「目前生效」的圖示、hover 說明與展開詳情獨立成一支（互動語彙與機師詳情頁對齊）。
          ⚠ 這裡吃的是**生效** Lv：它列的就是「現在亮著哪些能力」，而加成給的那一級
            確實亮著。傳投入值進去的症狀是「條上亮了第 4 格、下面卻少一個能力」。 */}
      {abilityMap && (
        <NdActiveAbilities drives={drives} levels={effectiveNdLevels(levels, bonus ?? null)} abilityMap={abilityMap} />
      )}
    </div>
  )
}
