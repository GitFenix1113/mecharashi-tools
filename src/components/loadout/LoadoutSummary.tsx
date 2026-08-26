import { enumerateSlots } from '../../utils/mechSlots'
import { lockedMounts, slotOccupant, type LoadoutContext } from '../../utils/loadoutRules'
import { HUD } from './loadoutTheme'

// ─── 配裝概況（PLAN-052-B D-1）───────────────────────────────────────────────
//
// **只呈現算得準的數字。** 算不準的明講不提供 —— 這是決策四的整條規則：
// 「不渲染，不是渲染空的」，而現行 Step 6 渲染 3 個空格 0 顆按鈕就是那個錯誤的現成教訓。
//
// 因此這裡沒有：可達增益數值加總（全庫 buff／技能 effects 0 筆、323 筆 buffId 解析失敗）、
// 單輪理論輸出（attack 語意未定）。
// 戰術評分**本站永久不做**（零公式依據，且是垃圾機制），連「不提供猜測值」的告示都不留 ——
// 常駐一句否定句只是替一個我們不打算實作的東西持續佔版面。
//
// ⚠ **總重不在這裡**（PLAN-052-I B-3）。常駐帳本列已經用 30px 把它印在頁面最上方，
//   外加分段條回答了「重量花在哪裡」；這裡再列一次 13px 的同一個數字，只會讓玩家
//   在兩個地方看同一件事，還得先確認兩者有沒有對上。這一區只留帳本列**答不出來**的：
//   已用了幾格、平均射程多少。

export function LoadoutSummary({ ctx }: { ctx: LoadoutContext }) {
  const refs = enumerateSlots(ctx.capacity)
  const locked = lockedMounts(ctx)

  // 已用槽位：全鎖形態直接數 form 的 mounts；其餘逐格看誰佔著（含機甲固定武裝）
  const used = locked.length > 0
    ? locked.length
    : refs.filter((r) => slotOccupant(ctx, r).kind !== 'empty').length
  const total = locked.length > 0 ? locked.length : refs.length

  const weapons = (locked.length > 0
    ? locked.map((m) => ctx.world.weapons.get(m.weaponId))
    : ctx.set.mounts.map((m) => ctx.world.weapons.get(m.weaponId))
  ).filter((w): w is NonNullable<typeof w> => !!w)

  // 平均射程只取「有射程可談」的武器：naStats 標了 minRange/maxRange 的（固定武裝多屬此類）
  // 算進來會把平均值往 0 拉，而那是一個沒有意義的數字
  const ranged = weapons.filter((w) => !(w.naStats ?? []).some((k) => k === 'minRange' || k === 'maxRange'))
  const avgRange = ranged.length > 0
    ? (ranged.reduce((n, w) => n + w.maxRange, 0) / ranged.length).toFixed(1)
    : null

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="已用槽位" value={`${used} / ${total}`} />
        <Stat label="平均射程" value={avgRange ?? '—'} />
      </div>

      <p className="text-[10px] text-text-dim leading-relaxed">
        本站數值一律以<strong className="text-text-secondary">滿級／滿品質階</strong>計算；
        機甲火力不含科技加成。
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="hud-cut-sm border border-border bg-bg-dark/40 px-2.5 py-1.5">
      <div className={`${HUD.labelCjk} text-text-dim leading-tight`}>{label}</div>
      <div className={`${HUD.num} text-[15px] text-text-primary leading-tight mt-0.5`}>{value}</div>
    </div>
  )
}
