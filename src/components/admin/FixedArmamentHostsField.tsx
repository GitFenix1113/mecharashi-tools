// 武器管理：固定武裝的「宿主」唯讀區塊（2026-10-10）
//
// 回答「這把固定武裝焊在誰身上、哪幾格」。**只顯示、不編輯** ——
// 掛載關係存在宿主那側（機甲部件的 fixedArmament／形態的 restrict.mounts），
// 理由見 `fixedArmamentHosts()`（src/utils/mechSlots.ts）。這裡若也能寫，
// 存檔就得同時改兩個集合、兩邊各 bump 一次版本；以全站 8 把、新增極少的頻率不划算。
//
// ⚠ mechs／forms 由本元件自己載入（useMechs／useForms），只在勾了 isFixedArmament 時 mount，
//   武器分頁其餘 176 把的編輯彈窗不為此多載兩個集合。
import { Link } from 'react-router-dom'
import { useMechs, useForms, usePilots } from '../../hooks/useFirestore'
import { fixedArmamentHosts, slotLabel } from '../../utils/mechSlots'

export function FixedArmamentHostsField({ weaponId }: { weaponId: string }) {
  const { data: mechs, loading: mechsLoading } = useMechs()
  const { data: forms, loading: formsLoading } = useForms()
  const { data: pilots } = usePilots()

  if (mechsLoading || formsLoading) {
    return <p className="text-[12px] text-text-dim">宿主：載入中…</p>
  }

  const hosts = fixedArmamentHosts(weaponId, mechs, forms)
  const pilotName = (id: string) => pilots.find((p) => p.id === id)?.name ?? id

  if (hosts.length === 0) {
    return (
      <p className="text-[12px] text-accent-yellow leading-relaxed">
        ⚠ 尚未連結到任何機甲或形態。連結要在宿主那邊建立：
        機甲 →「機甲管理」→ 該機甲 →「部件」→ 左臂／右臂的「固定武裝」欄位各加一筆；
        形態 →「機師形態」→ 該形態的固定武裝。
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {hosts.length > 1 && (
        <p className="text-[12px] text-accent-red leading-relaxed">
          ⚠ 同時焊在 {hosts.length} 個宿主上。固定武裝應為一對一（站長 2026-10-10 判斷），
          請確認是否掛錯（<code>validate-mech-slots.mjs</code> ⑦ 也會報錯）。
        </p>
      )}
      {hosts.map((h) => {
        const where = h.refs.map(slotLabel).join('、')
        return (
          <p key={`${h.kind}:${h.id}`} className="text-[13px] text-text-secondary">
            <span className="text-text-dim">焊在</span>{' '}
            {h.kind === 'mech' ? (
              <Link to={`/mechs/${h.id}`} target="_blank" className="text-accent-cyan hover:underline">{h.name}</Link>
            ) : (
              <span className="text-text-primary">{pilotName(h.pilotId)}・{h.name}</span>
            )}
            {where && <span className="ml-1.5">{where}</span>}
            <span className="ml-2 text-[11px] text-text-dim">
              （要改到「{h.kind === 'mech' ? '機甲管理 → 部件' : '機師形態'}」）
            </span>
          </p>
        )
      })}
    </div>
  )
}
