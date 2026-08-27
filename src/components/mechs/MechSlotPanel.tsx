// 機甲詳情頁的槽位配置與四部位表（PLAN-052-A E-1）
//
// 這是本子計畫唯一的前台改動，也是它能單獨上線的理由——「這台有幾個手／肩／背槽、
// 哪些被固定武裝佔住」是今天全站沒有的資訊。
//
// ⚠ 資料成本：只有 3/90 台機甲有固定武裝，所以「查武器名稱」被隔離在 FixedArmamentList
//   子元件裡——它只在真的有固定武裝時才 mount，其餘 87 台完全不碰 weapons 集合。
//   把 useWeapons() 寫在外層會讓每一台機甲的詳情頁都多載入 182 筆武器。
import { Link } from 'react-router-dom'
import type { Mech } from '../../types'
import type { ArmamentMount } from '../../types'
import { slotKey } from '../../types/slots'
import { mechSlotCapacity, enumerateSlots, occupiedSlots, slotLabel } from '../../utils/mechSlots'
import { resolveChassis, MECH_PART_ORDER } from '../../utils/chassisStats'
import { useWeapons } from '../../hooks/useFirestore'

const PART_LABELS: Record<string, string> = {
  torso: '軀幹', leftArm: '左臂', rightArm: '右臂', legs: '腿部',
}

/**
 * 沒有模組接口時的呈現。留白會被讀成「這裡應該有東西但我們沒查到」，
 * 而事實正好相反 —— 這台機甲**確實沒有**這個槽（2026-08-27 起空字串只有這一種語意，
 * 見 `src/utils/mechInterface.ts`）。所以要把否定陳述明著寫出來。
 */
const IFACE_NONE = '無模組接口'

/** 槽位分列的順序與列標。與 enumerateSlots() 的產出順序一致。 */
const SLOT_GROUPS: { slot: string; label: string }[] = [
  { slot: 'singleHand', label: '手部' },
  { slot: 'shoulder',   label: '肩部' },
  { slot: 'back',       label: '背部' },
]

// ─── 槽位配置 ───────────────────────────────────────────────────────────────

export function MechSlotPanel({ mech }: { mech: Mech }) {
  const capacity = mechSlotCapacity(mech)
  const slots = enumerateSlots(capacity)
  const occupied = occupiedSlots(mech.parts)

  return (
    <div className="bg-bg-card border border-border rounded-xl p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-3">
        <h3 className="text-[13px] font-bold text-text-primary">槽位配置</h3>
        <span className="text-[11px] text-text-dim">
          單手 ×{capacity.singleHand}
          {capacity.shoulder > 0 && ` · 肩 ×${capacity.shoulder}`}
          {' '}· 背 ×{capacity.back}
        </span>
      </div>

      {/* 依槽位類型分列，不用單一 grid 流式排版 —— 3 欄 grid 會把「左肩／右肩」拆到兩列，
          讀起來像兩個不相干的格子。同一對槽位本來就該並排。 */}
      <div className="space-y-2">
        {SLOT_GROUPS.map(({ slot, label }) => {
          const group = slots.filter((r) => r.slot === slot)
          if (!group.length) return null
          return (
            <div key={slot} className="flex items-stretch gap-2">
              <div className="w-10 shrink-0 flex items-center text-[11px] text-text-dim">{label}</div>
              <div className="flex-1 grid grid-cols-2 gap-2">
                {group.map((ref) => {
                  const key = slotKey(ref)
                  const occ = occupied.get(key)
                  return (
                    <div
                      key={key}
                      className={`rounded-lg border px-2.5 py-2 ${
                        occ ? 'border-accent-yellow/40 bg-accent-yellow/5' : 'border-border bg-bg-dark'
                      } ${group.length === 1 ? 'col-span-2' : ''}`}
                    >
                      <div className="text-[11px] text-text-dim leading-tight">{slotLabel(ref)}</div>
                      {occ ? (
                        <FixedArmamentName mount={occ.mount} />
                      ) : (
                        <div className="text-[12px] text-text-secondary leading-tight mt-0.5">可裝備</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* ⚠ 沒有固定武裝時，這裡**什麼都不渲染**——絕不寫「無固定武裝」。
          我們無法分辨「這台真的沒有」與「還沒有人建檔」，兩者共用同一種呈現（不說），
          而不是把一個我們並不知道的否定陳述寫死在頁面上。 */}
      {occupied.size > 0 && (
        <p className="text-[11px] text-text-dim mt-2.5 leading-relaxed">
          🔒 標記的格子被固定武裝佔住，無法更換。
        </p>
      )}

      {capacity.shoulder === 0 && (
        <p className="text-[11px] text-text-dim mt-2 leading-relaxed">
          肩部槽位只有<strong className="text-text-secondary">中甲</strong>機甲才有。
        </p>
      )}
    </div>
  )
}

/**
 * 顯示某一格的固定武裝名稱。
 *
 * 獨立成元件才能把 `useWeapons()` 的載入成本限制在真的有固定武裝的機甲上（見檔頭）。
 * 武器查不到時退回顯示 id——那代表資料斷鏈，該被看見而不是靜默留白。
 */
function FixedArmamentName({ mount }: { mount: ArmamentMount }) {
  const { data: weapons } = useWeapons()
  const w = weapons?.find((x) => x.id === mount.weaponId)
  return (
    <div className="text-[12px] leading-tight mt-0.5 truncate">
      <span className="text-accent-yellow mr-0.5">🔒</span>
      {w ? (
        <Link to={`/weapons/${mount.weaponId}`} className="text-text-primary hover:text-accent-orange no-underline">
          {w.name}
        </Link>
      ) : (
        <span className="text-text-dim">{mount.weaponId}</span>
      )}
    </div>
  )
}

// ─── 四部位表 ───────────────────────────────────────────────────────────────

/**
 * 唯讀的四部位表：來源／重量／火力／接口型別。
 *
 * 「來源」欄今天恆等於本機甲，看起來多餘——但混搭部位（PLAN-052 Q20 / 052-G）之後
 * 四個部位可以來自四台不同的機甲，這一欄就是那時唯一能回答「這是哪來的」的地方。
 * 先把欄位擺好，混搭 UI 上線時不必改表格結構。
 */
export function MechPartsTable({ mech }: { mech: Mech }) {
  const chassis = resolveChassis(mech)
  if (!chassis) return null   // 四部位不齊 → 整區不渲染（不補零值部位）

  return (
    <div className="bg-bg-card border border-border rounded-xl p-4">
      <h3 className="text-[13px] font-bold text-text-primary mb-3">四部位</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="text-text-dim">
              <th className="text-left font-medium py-1.5 pr-2">部位</th>
              <th className="text-left font-medium py-1.5 px-2">來源</th>
              <th className="text-right font-medium py-1.5 px-2">重量</th>
              <th className="text-right font-medium py-1.5 px-2">火力</th>
              <th className="text-left font-medium py-1.5 pl-2">接口</th>
            </tr>
          </thead>
          <tbody>
            {MECH_PART_ORDER.map((pos) => {
              const { part, sourceMechId } = chassis.parts[pos]
              const iface = chassis.moduleSlots[pos].iface
              return (
                <tr key={pos} className="border-t border-border/70">
                  <td className="py-1.5 pr-2 text-text-primary font-medium">{PART_LABELS[pos] ?? pos}</td>
                  <td className="py-1.5 px-2 text-text-dim truncate max-w-[140px]">
                    {sourceMechId === mech.id ? mech.name : sourceMechId}
                  </td>
                  <td className="py-1.5 px-2 text-right text-text-secondary font-[JetBrains_Mono,monospace]">
                    {part.weight.toLocaleString()}
                  </td>
                  <td className="py-1.5 px-2 text-right text-text-secondary font-[JetBrains_Mono,monospace]">
                    {part.firepower.toLocaleString()}
                  </td>
                  <td className={`py-1.5 pl-2 ${iface ? 'text-text-secondary' : 'text-text-dim italic'}`}>
                    {iface || IFACE_NONE}
                  </td>
                </tr>
              )
            })}
            <tr className="border-t border-border">
              <td className="py-1.5 pr-2 text-text-dim">合計</td>
              <td className="py-1.5 px-2" />
              <td className="py-1.5 px-2 text-right text-text-primary font-medium font-[JetBrains_Mono,monospace]">
                {chassis.weight.toLocaleString()}
              </td>
              <td className="py-1.5 px-2 text-right text-text-primary font-medium font-[JetBrains_Mono,monospace]">
                {chassis.firepower.toLocaleString()}
              </td>
              <td className="py-1.5 pl-2" />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-text-dim mt-2.5 leading-relaxed">
        本站數值一律以<strong className="text-text-secondary">滿級／滿品質階</strong>計算；火力不含科技加成。
      </p>
    </div>
  )
}
