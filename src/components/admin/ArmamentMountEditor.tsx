// 固定武裝編輯器（PLAN-052-A C-2／C-3）——MechAdmin 與 FormAdmin 共用
//
// 編輯一份 `ArmamentMount[]`：機甲部件焊死的武裝、或機師形態鎖死的武裝。
//
// ── 為什麼 slot 是唯讀的 ────────────────────────────────────────────────────
// 硬不變式是 `mount.slot === weapons[mount.weaponId].equipSlot`。既然如此，slot 就不該
// 是一個「可以選錯」的欄位——選武器時直接由武器帶入並唯讀顯示。這樣 D-3 的校驗腳本
// 永遠是 0 例外，它的角色從「清理工具」變成「回歸測試」。
// 讓人手選 slot 再靠腳本事後抓，等於刻意製造一個只有腳本看得到的錯誤來源。
//
// ── 為什麼用陣列而不是選填 scalar ──────────────────────────────────────────
// 帕斯卡是**同一把衝擊炮掛左右兩肩**，scalar 表達不了；而且 scalar 的三態語意會撞上
// `stripUndefined`（取消勾選寫的 `undefined` 被整個濾掉 ⇒ 一旦填了就再也取消不掉）——
// 被本元件取代的 `leftShoulderSlot` 三兄弟就是栽在這裡（PLAN-040 決策六）。
import { useMemo, useState } from 'react'
import type { ArmamentMount, SlotSide, Weapon } from '../../types'
import { slotKey, slotAcceptsSide } from '../../types/slots'
import { mountLabel } from '../../utils/mechSlots'
import { EQUIP_SLOT_LABELS } from '../badges/WeaponBadges'

const SIDE_OPTIONS: { value: SlotSide; label: string }[] = [
  { value: 'left', label: '左' },
  { value: 'right', label: '右' },
]

export function ArmamentMountEditor({
  label,
  hint,
  value,
  weapons,
  onChange,
  defaultSide,
}: {
  label: string
  hint?: React.ReactNode
  value: ArmamentMount[]
  weapons: Weapon[]
  onChange: (next: ArmamentMount[]) => void
  /** 新增時預設帶入的側別（部件編輯器會依左臂／右臂各自帶入，省一次點擊） */
  defaultSide?: SlotSide
}) {
  const [search, setSearch] = useState('')
  const byId = useMemo(() => new Map(weapons.map((w) => [w.id, w])), [weapons])

  // 固定武裝排在最前面（全站 6 把，之後 8 把）——它們是這個欄位的主要對象
  const options = useMemo(() => {
    const q = search.trim().toLowerCase()
    return weapons
      .filter((w) => !q || w.name.toLowerCase().includes(q) || w.id.toLowerCase().includes(q))
      .sort((a, b) => Number(!!b.isFixedArmament) - Number(!!a.isFixedArmament))
      .slice(0, 50)
  }, [weapons, search])

  /** 依武器的 equipSlot 建 mount：slot 由武器決定，side 只在該槽有左右之分時保留 */
  const mountOf = (weaponId: string, side?: SlotSide): ArmamentMount => {
    const slot = (byId.get(weaponId)?.equipSlot ?? 'singleHand') as ArmamentMount['slot']
    return slotAcceptsSide(slot) ? { weaponId, slot, side: side ?? defaultSide ?? 'left' } : { weaponId, slot }
  }

  const patch = (idx: number, next: ArmamentMount) =>
    onChange(value.map((m, i) => (i === idx ? next : m)))

  return (
    <div className="border border-accent-yellow/40 rounded-lg p-3 bg-accent-yellow/5 space-y-2.5">
      <div>
        <p className="text-xs font-medium text-accent-yellow">{label}</p>
        {hint && <p className="text-[11px] text-text-dim leading-relaxed mt-1">{hint}</p>}
      </div>

      {value.length === 0 && (
        <p className="text-[11px] text-text-dim">尚未設定（沒有固定武裝的機甲／形態就保持空白）</p>
      )}

      <div className="space-y-2">
        {value.map((mount, idx) => {
          const w = byId.get(mount.weaponId)
          const sided = slotAcceptsSide(mount.slot)
          return (
            // key 用 slotKey + idx：同一把武器可掛兩格（帕斯卡兩肩），weaponId 會撞 key；
            // 而未填完的列可能暫時同鍵，故再綴 idx
            <div
              key={`${slotKey({ bank: 'main', slot: mount.slot, side: mount.side })}-${idx}`}
              className="flex flex-wrap items-center gap-2 bg-bg-dark border border-border rounded-lg px-2.5 py-2"
            >
              <span className="text-sm text-text-primary min-w-[120px]">
                {w ? w.name : <span className="text-accent-red">⚠ 找不到 {mount.weaponId}</span>}
              </span>

              {/* slot 唯讀：由武器的 equipSlot 決定，見檔頭 */}
              <span className="text-[11px] px-1.5 py-0.5 rounded border border-border text-text-dim">
                {EQUIP_SLOT_LABELS[mount.slot] ?? mount.slot}
                <span className="ml-1 opacity-60">（隨武器）</span>
              </span>

              {sided ? (
                <select
                  className="px-2 py-1 rounded bg-bg-card border border-border text-text-primary text-xs"
                  value={mount.side ?? 'left'}
                  onChange={(e) => patch(idx, { ...mount, side: e.target.value as SlotSide })}
                >
                  {SIDE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] text-text-dim">此槽無左右之分</span>
              )}

              <span className="text-[11px] text-accent-cyan">→ {mountLabel(mount)}</span>

              <button
                type="button"
                onClick={() => onChange(value.filter((_, i) => i !== idx))}
                className="ml-auto shrink-0 text-[13px] px-2 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10"
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋武器名稱或 ID..."
          className="flex-1 px-2.5 py-1.5 rounded-lg bg-bg-dark border border-border text-text-primary text-xs focus:outline-none focus:border-accent-orange"
        />
        <select
          className="flex-1 px-2.5 py-1.5 rounded-lg bg-bg-dark border border-border text-text-primary text-xs"
          value=""
          onChange={(e) => { if (e.target.value) { onChange([...value, mountOf(e.target.value)]); setSearch('') } }}
        >
          <option value="">+ 新增固定武裝…</option>
          {options.map((w) => (
            <option key={w.id} value={w.id}>
              {w.isFixedArmament ? '🔒 ' : ''}{w.name}（{EQUIP_SLOT_LABELS[w.equipSlot] ?? w.equipSlot}）
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
