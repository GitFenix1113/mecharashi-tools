import { Link } from 'react-router-dom'
import type { Weapon } from '../../types'
import type { WeaponSlotRef } from '../../types/slots'
import { slotKey } from '../../types/slots'
import { slotLabel } from '../../utils/mechSlots'
import { WeaponEquipSlot } from '../../types/enums'
import { isNaStat, isVariableStat, naOr, NA_STAT_TEXT } from '../../utils/weaponStats'
import { enumerateSlots } from '../../utils/mechSlots'
import { lockedMounts, slotOccupant, type LoadoutContext } from '../../utils/loadoutRules'

// ─── 裝配武器數值列表（PLAN-052-B D-1）───────────────────────────────────────
//
// **只出與官方 1:1 相符的欄位。**（決策四：不渲染，不是渲染空的）
//   重量   ✓ 逐格對帳通過（四個形態四組官方數字）
//   命中   ✓ 實測 戕神者 DB accuracy = 1466 = 官方 1466
//   射程   ✓ DB 原值
//   攻擊力 ⚠ **DB 值是「全部連擊的總和」，官方顯示的是「每擊值」**，且官方值比 DB 高
//            17.3–18.6% 且逐把不同（已排除機師五維、kindCoefficient、單一全域倍率）。
//            → 這裡顯示 DB 原值並明確標「本站口徑，含連擊」，
//              **不做 ÷hitCount 的官方同格式渲染** —— 那個差額未解，屬傷害計算範疇
//              （總綱決策一④，已裁決延後至傷害模擬計畫）。

const RANGE_TYPE_LABELS: Record<string, string> = {
  manhattan: '菱形', orthogonal: '十字直線', ring: '環形',
}

const formatRange = (w: Weapon) =>
  w.rangeType === 'ring' ? `${w.maxRange}+` : `${w.minRange}-${w.maxRange}`

interface Row {
  key: string
  where: string
  weapon: Weapon
}

export function EquippedStats({ ctx }: { ctx: LoadoutContext }) {
  const rows: Row[] = []

  // 全鎖形態：整套由 form.restrict.mounts derive（draft 那一份必為空）
  for (const m of lockedMounts(ctx)) {
    const w = ctx.world.weapons.get(m.weaponId)
    if (w) rows.push({ key: slotKey(m.ref), where: slotLabel(m.ref), weapon: w })
  }

  if (rows.length === 0) {
    // 逐格走訪（含固定武裝），順序與槽位圖一致 —— 兩邊對不上時，玩家會以為漏了一把
    const refs: WeaponSlotRef[] = enumerateSlots(ctx.capacity)
    const dualBanks = new Set(
      ctx.set.mounts.filter((m) => m.slot === WeaponEquipSlot.DUAL_HAND).map((m) => m.bank),
    )
    for (const ref of refs) {
      // 雙手武器覆蓋左右兩格 —— 只在左手那一格列一次，否則同一把會出現兩列
      if (dualBanks.has(ref.bank) && ref.slot === WeaponEquipSlot.SINGLE_HAND && ref.side === 'right') continue
      const occ = slotOccupant(ctx, ref)
      const w = occ.kind === 'weapon' || occ.kind === 'fixed' ? occ.weapon : null
      if (!w) continue
      const where = occ.kind === 'weapon' && occ.mount.slot === WeaponEquipSlot.DUAL_HAND
        ? slotLabel({ bank: ref.bank, slot: WeaponEquipSlot.DUAL_HAND })
        : slotLabel(ref)
      rows.push({ key: slotKey(ref), where, weapon: w })
    }
  }

  if (rows.length === 0) {
    return <p className="text-[12px] text-text-dim leading-relaxed">尚未裝備任何武器。</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-text-dim">
            <th className="text-left font-medium py-1.5 pr-2">槽位</th>
            <th className="text-left font-medium py-1.5 px-2">武器</th>
            <th className="text-right font-medium py-1.5 px-2">重量</th>
            <th className="text-right font-medium py-1.5 px-2">命中</th>
            <th className="text-left font-medium py-1.5 px-2">射程</th>
            <th className="text-left font-medium py-1.5 pl-2">元件</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, where, weapon }) => {
            const rangeNa = isNaStat(weapon, ['minRange', 'maxRange'])
            return (
              <tr key={key} className="border-t border-border/70">
                <td className="py-1.5 pr-2 text-text-dim whitespace-nowrap">{where}</td>
                <td className="py-1.5 px-2 min-w-0">
                  <Link
                    to={`/weapons/${weapon.id}`}
                    className="text-text-primary hover:text-accent-orange no-underline"
                  >
                    {weapon.name}
                  </Link>
                  <div className="text-[10px] text-text-dim">{weapon.type} · {weapon.kind}</div>
                </td>
                <td className="py-1.5 px-2 text-right text-text-secondary font-[JetBrains_Mono,monospace]">
                  {weapon.weight.toLocaleString()}
                </td>
                <td className="py-1.5 px-2 text-right text-text-secondary font-[JetBrains_Mono,monospace]">
                  {isVariableStat(weapon, 'accuracy')
                    ? NA_STAT_TEXT
                    : naOr(weapon, 'accuracy', weapon.accuracy.toLocaleString())}
                </td>
                <td className="py-1.5 px-2 text-text-secondary whitespace-nowrap">
                  {rangeNa ? NA_STAT_TEXT : (
                    <>
                      {formatRange(weapon)}
                      <span className="text-text-dim ml-1">{RANGE_TYPE_LABELS[weapon.rangeType] ?? ''}</span>
                    </>
                  )}
                </td>
                {/* ⚠ 元件面板在 052-D，但這一格現在就要留：玩家看得到上限是
                    componentLimit（SS/S+ = 4、S = 3）而不是觸 3 加應 3 的 6。 */}
                <td className="py-1.5 pl-2 text-text-dim whitespace-nowrap font-[JetBrains_Mono,monospace]">
                  ⚙ 0/{weapon.componentLimit}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="mt-2 space-y-1">
        <p className="text-[11px] text-text-dim leading-relaxed">
          合計攻擊（本站口徑，含連擊）：
          <strong className="text-text-secondary font-[JetBrains_Mono,monospace] ml-1">
            {rows.reduce((n, r) => n + (r.weapon.attack ?? 0), 0).toLocaleString()}
          </strong>
        </p>
        <p className="text-[10px] text-text-dim leading-relaxed">
          ※ 遊戲內武器卡顯示的是「每擊值」，與本站口徑不同；兩者的換算尚有未解的差額，
          待傷害模擬計畫釐清後才會提供官方同格式的數字。
        </p>
        <p className="text-[10px] text-text-dim leading-relaxed">⚙ 元件功能建置中（觸元件＋應元件總槽數）。</p>
      </div>
    </div>
  )
}
