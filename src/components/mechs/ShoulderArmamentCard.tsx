// 機甲詳情頁：肩部固定武裝卡（2026-10-10，接手下架的「槽位配置」唯一不重複的那份資訊）
//
// 放在部件十字上排的兩個空角落 —— 左上＝右肩、右上＝左肩（從正面看機體，每邊肩膀正好在
// 同側手臂上方），與遊戲整備畫面、模擬器的左右一致。手機版則是立繪下方的一條橫列。
// 只在肩部**真的被固定武裝佔住**時才出現：今天只有帕斯卡／破曉者-01／霸王三台，
// 其餘機甲那兩個角落維持空白，外觀與改版前完全相同。
//
// ⚠ 資料成本：weapons 與技能庫的載入被隔離在這張卡裡 —— 它只在有固定武裝時 mount，
//   其他機甲的詳情頁完全不碰這兩個集合（沿用 MechSlotPanel 當初的做法）。
// ⚠ 卡上刻意不放重量／攻擊：三把肩部固定武裝全是 0，放了只是噪音。
// ⚠ 沒有技能時**什麼都不寫**，不寫「無技能」—— 與當初不寫「無固定武裝」同一個理由：
//   我們分不出「真的沒有」與「還沒建檔」，不把一個不確定的否定陳述寫死在頁面上。
import { Link } from 'react-router-dom'
import { slotLabel, type OccupiedSlot } from '../../utils/mechSlots'
import { useWeapon, useWeaponSkillMap } from '../../hooks/useFirestore'
import { resolveWeaponSkills } from '../../utils/weaponSkills'
import { weaponIconCandidates } from '../../utils/gameIcons'
import { FallbackImage } from '../common/FallbackImage'
import { LoadoutIcon } from '../icons/LoadoutIcon'
import { RefChip } from '../refs/RefChip'

export function ShoulderArmamentCard({ occupied }: { occupied: OccupiedSlot }) {
  const { mount, ref } = occupied
  const { data: weapon, loading } = useWeapon(mount.weaponId)
  const { data: skillMap } = useWeaponSkillMap()
  const skills = resolveWeaponSkills(weapon?.skills, skillMap)

  return (
    // self-start：不撐滿整列高度 —— 軀幹卡比較高，撐滿會在鎖頭卡底下留一大塊空的黃框
    <div className="self-start bg-accent-yellow/5 border border-accent-yellow/45 rounded-xl p-2.5 flex flex-row gap-2.5 min-w-0">
      {/* 左右肩各用自己的鏡像圖（sideGameIds），沒有官方圖時退回鎖頭 */}
      <FallbackImage
        candidates={weaponIconCandidates(weapon, ref.side)}
        alt={weapon?.name ?? mount.weaponId}
        className="w-9 h-9 rounded-lg bg-bg-card border border-accent-yellow/30 object-contain flex-shrink-0 self-start"
        fallback={
          <div className="w-9 h-9 rounded-lg bg-bg-card border border-accent-yellow/30 flex items-center justify-center flex-shrink-0 self-start">
            <LoadoutIcon name="lock" className="w-4 h-4 text-accent-yellow" />
          </div>
        }
      />
      <div className="flex-1 min-w-0">
        {/* 兩段各自不斷行、段與段之間可換行：手機兩欄並排（360px 寬每張卡只剩 ~75px 字寬）時
            「固定武裝」整段換到第二行，而不是被 truncate 成「右肩 · 固…」。
            標題前也刻意不放小鎖頭 —— 黃框＋「固定武裝」已經講完了，它只會再擠掉一格字 */}
        <p className="flex flex-wrap gap-x-1.5 text-[11px] leading-tight">
          <span className="whitespace-nowrap text-text-dim">{slotLabel(ref)}</span>
          <span className="whitespace-nowrap text-accent-yellow/80">固定武裝</span>
        </p>
        {weapon ? (
          <Link
            to={`/weapons/${mount.weaponId}`}
            className="block font-bold text-[13px] text-accent-yellow hover:text-accent-orange no-underline leading-tight mt-0.5 truncate"
          >
            {weapon.name}
          </Link>
        ) : loading ? (
          <div className="h-4 w-16 mt-1 rounded bg-bg-card animate-pulse" />
        ) : (
          // 查不到 ＝ 資料斷鏈（validate-mech-slots ① 會抓），該被看見而不是靜默留白
          <p className="text-[12px] text-text-dim leading-tight mt-0.5 truncate">{mount.weaponId}</p>
        )}
        {skills.length > 0 && (
          <div className="flex flex-wrap gap-x-1.5 gap-y-0.5 mt-1 text-[12px] leading-tight">
            {skills.map((s) =>
              s.id
                ? <RefChip key={s.id} inner={s.name} entity={{ refType: 'skill', refId: s.id }} />
                : <span key={s.name} className="text-text-secondary">{s.name}</span>,
            )}
          </div>
        )}
      </div>
    </div>
  )
}
