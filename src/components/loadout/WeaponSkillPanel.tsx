import { useMemo } from 'react'
import type { PilotSkillDoc } from '../../types'
import type { LoadoutContext } from '../../utils/loadoutRules'
import { weaponRows } from '../../utils/loadoutRows'
import { resolveWeaponSkills, type ResolvedWeaponSkill } from '../../utils/weaponSkills'
import { ACTIVATION_CONFIG } from '../badges/WeaponBadges'
import { SkillIcon } from '../icons/SkillIcon'
import { RefText } from '../refs/RefText'
import { HUD } from './loadoutTheme'

// ─── 武器技能（使用者要求 2026-08-27）────────────────────────────────────────
//
// 「S+ 以上的武器有各種技能、各種生效方式，這部分會很大程度影響使用者怎麼搭配，
//   這也是為什麼遊戲中高手都會混搭專武，因為想吃不同效果。」——使用者逐字。
//
// ── 為什麼**按生效方式分組**，而不是按武器分組 ──────────────────────────────
// 按武器分組（「右手 XX：技能 A、技能 B」）只是把武器詳情頁的內容抄四遍，而玩家
// 在這一頁真正要回答的是**跨武器**的那個問題：「這一套總共吃得到哪些效果？」
// 混搭專武的整個道理就在生效方式上 —— 一把只要帶著就生效的專武，即使從來不拿它出手
// 也照樣加成。分組把那件事變成畫面上的第一層結構，來源武器退成每一列的副標。
//
// ⚠ **生效方式是「掛載側」的欄位，逐把不同**（PLAN-032 決策三）：實測 44 個同名技能
//   群組中有 38 個在此欄衝突（[赤狐·改 S+] 凝神待發＝攜帶、[魔笛 SS] 同名技能＝使用時）。
//   所以這一區的排序鍵**不能**改成技能名去重 —— 同名的兩筆是兩件不同的事，
//   合併起來會讓玩家以為換哪一把都一樣。
//
// ⚠ 顯示 gate 一律接在 `resolveWeaponSkills()` 的**回傳陣列**上，不可用
//   `weapon.skills.length`：技能庫（`pilotSkills`）還沒載入時那個長度仍 > 0，
//   gate 會開、然後渲染出一塊空的技能區（PLAN-032 已知的靜默壞點）。
//   「還在載」與「真的沒有技能」是兩句不同的話，由 `loading` 分開。
//
// ⚠ **不做任何數值彙總**（沿用「模組效果」那一區的同一條）：技能效果沒有可加總的
//   結構化欄位可用，硬湊一個「合計」會是推測值，而玩家會拿它去做決定。

interface Props {
  ctx: LoadoutContext
  /** 技能庫（`pilotSkills`）。空 Map ＝ 還沒載入，不是「沒有技能」——見 `loading` */
  skillMap: Map<string, PilotSkillDoc>
  /** 技能庫還在路上 */
  loading?: boolean
}

interface SkillLine {
  key: string
  /** 「右手」這類槽位標籤 */
  where: string
  weaponName: string
  /** 專武（`isExclusive`）：混搭的主角，值得在列上標出來 */
  exclusive: boolean
  sk: ResolvedWeaponSkill
}

/** 由「整套都吃得到」到「只有用它才吃得到」。三種以外的值（資料異常）排最後。 */
const ACTIVATION_ORDER = ['carry', 'equip', 'use'] as const

/**
 * 每一組的一句話。
 *
 * ⚠ 刻意只講**這三個值的字面語意**，不替遊戲補規則（例如「備用槽算不算攜帶」）：
 *   那條站上沒有實測過，寫下去就是一句玩家會拿去配裝的猜測。
 */
const ACTIVATION_NOTE: Record<string, string> = {
  carry: '帶著就生效 —— 不必拿它出手。',
  equip: '裝在槽上就生效。',
  use:   '只有實際使用這把武器時才生效。',
}

/**
 * 這一套的武器技能，已按生效方式分好組。
 *
 * ⚠ **完整版與縮圖版共用這一支**：分組規則（含「未知生效方式不吞掉」）與排序各留一份
 *   必然漂移，而漂移的症狀是收合時看到三顆、展開後變成四筆。
 *
 * 刻意**不匯出**（hook 從元件檔匯出會讓整檔的 fast refresh 失效，同 `EquippedEffects`）。
 */
function useSkillGroups(ctx: LoadoutContext, skillMap: Map<string, PilotSkillDoc>) {
  // 順序沿用 `weaponRows()`（＝槽位圖的順序），這份清單才與槽位圖對得起來。
  // 它同時已經含入機甲固定武裝與形態鎖定的武裝 —— 那兩種一樣會帶技能。
  const rows = useMemo(() => weaponRows(ctx), [ctx])

  const lines = useMemo<SkillLine[]>(() => {
    const out: SkillLine[] = []
    for (const r of rows) {
      if (!r.weapon) continue   // 斷鏈由「武器與元件」那一列負責印，這裡不重複報一次
      for (const [i, sk] of resolveWeaponSkills(r.weapon.skills, skillMap).entries()) {
        out.push({
          key: `${r.rowKey}#${i}`,
          where: r.label,
          weaponName: r.weapon.name,
          exclusive: !!r.weapon.isExclusive,
          sk,
        })
      }
    }
    return out
  }, [rows, skillMap])

  const groups = useMemo(() => {
    const known = ACTIVATION_ORDER.map((a) => ({ activation: a as string, items: lines.filter((l) => l.sk.activation === a) }))
    const rest = lines.filter((l) => !ACTIVATION_ORDER.includes(l.sk.activation as typeof ACTIVATION_ORDER[number]))
    // 未知的生效方式**不吞掉**：資料異常要看得見，但不必為它編一句說明
    return [...known, ...(rest.length ? [{ activation: '其他', items: rest }] : [])]
      .filter((g) => g.items.length > 0)
  }, [lines])

  return { groups, lines, hasWeapons: rows.some((r) => r.weapon) }
}

export function WeaponSkillPanel({ ctx, skillMap, loading }: Props) {
  const { groups, lines, hasWeapons } = useSkillGroups(ctx, skillMap)

  if (loading) {
    return <p className={`${HUD.body} text-text-dim`}>載入技能庫中…</p>
  }

  if (!hasWeapons) {
    return (
      <p className={`${HUD.body} text-text-dim`}>
        還沒有裝上任何武器 —— 武器技能會跟著武器一起長出來。
      </p>
    )
  }

  if (lines.length === 0) {
    return (
      <p className={`${HUD.body} text-text-dim leading-relaxed`}>
        目前這一套的武器都沒有技能。武器技能集中在高品質的武器上（S+ 與 SS），
        A／B 品質的武器多半只有數值。
      </p>
    )
  }

  return (
    <div className="space-y-2.5">
      {groups.map((g) => (
        <div key={g.activation}>
          <div className="flex items-baseline gap-2 mb-1">
            <ActivationChip activation={g.activation} />
            <span className={`${HUD.body} text-text-dim min-w-0 truncate`}>
              {ACTIVATION_NOTE[g.activation] ?? '生效方式不明。'}
            </span>
            <span className={`${HUD.num} text-[10px] text-text-dim ml-auto shrink-0`}>{g.items.length}</span>
          </div>
          <div className="flex flex-col" style={{ gap: 5 }}>
            {g.items.map((l) => <SkillRow key={l.key} line={l} />)}
          </div>
        </div>
      ))}

      <p className="text-[11px] text-text-dim leading-relaxed border-t border-border pt-2">
        同一個技能名在不同武器上<strong className="text-text-secondary">生效方式可能不同</strong>
        （實測 44 個同名群組有 38 個不一樣）—— 混搭時要看的是上面那顆徽章，不是技能名。
      </p>
    </div>
  )
}

/**
 * ── 縮圖版（使用者要求 2026-08-27）─────────────────────────────────────────
 *
 * 面板收合時顯示的那一排：**每一種生效方式一列**，列上只有技能圖示。
 *
 * ⚠ 分組**在收合態也要留著**（使用者逐字：「按生效方式分類這想法很棒」）：
 *   把六顆圖示排成一排會讓這一區退回成「這套有六個技能」，而玩家要問的是
 *   「有幾個是帶著就生效的」。一列一種方式，數量自己就看得出來。
 *
 * ⚠ 技能名一律進 `title` 不上畫面：這一欄只有半個中欄寬（約 400px），
 *   六個技能名會折成三行，而那正是它從右欄搬過來要解決的問題。
 */
export function WeaponSkillStrip({ ctx, skillMap, loading }: Props) {
  const { groups, lines, hasWeapons } = useSkillGroups(ctx, skillMap)

  if (loading) return <p className={`${HUD.body} text-text-dim`}>載入技能庫中…</p>
  if (!hasWeapons) return <p className={`${HUD.body} text-text-dim`}>還沒有裝上任何武器。</p>
  if (lines.length === 0) {
    return <p className={`${HUD.body} text-text-dim`}>目前這一套的武器都沒有技能（技能集中在 S+ 與 SS）。</p>
  }

  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      {groups.map((g) => (
        <div key={g.activation} className="flex items-center" style={{ gap: 6 }}>
          <ActivationChip activation={g.activation} />
          <span className="flex flex-wrap items-center" style={{ gap: 4 }}>
            {g.items.map((l) => (
              <span key={l.key} className="relative inline-flex">
                <SkillIcon
                  iconLocal={l.sk.iconLocal}
                  name={l.sk.name}
                  size="sm"
                  className={l.exclusive ? 'ring-1 ring-accent-yellow/70' : ''}
                />
                {/* title 帶滿四件事：這一排沒有任何文字，滑過去是唯一的辨識管道 */}
                <span
                  className="absolute inset-0"
                  title={`${l.sk.name}｜${l.where} · ${l.weaponName}${
                    l.sk.enhancesTalentName ? `｜強化天賦：${l.sk.enhancesTalentName}` : ''
                  }
${l.sk.description}`}
                />
              </span>
            ))}
          </span>
          <span className={`${HUD.num} text-[10px] text-text-dim ml-auto shrink-0`}>{g.items.length}</span>
        </div>
      ))}
      {/* 金框那顆是專武 —— 一排沒有文字的圖示裡，那圈金色需要一句話才讀得懂 */}
      {lines.some((l) => l.exclusive) && (
        <p className="text-[11px] text-text-dim">金框 ＝ 專武技能。展開看效果與來源。</p>
      )}
    </div>
  )
}

/** 分組抬頭那顆徽章。沿用圖鑑同一套配色（carry 紫／equip 青／use 橘），此處縮小一階。 */
function ActivationChip({ activation }: { activation: string }) {
  const cfg = ACTIVATION_CONFIG[activation]
    ?? { label: activation, className: 'text-text-dim bg-bg-dark border-border' }
  return (
    <span className={`hud-cut-sm shrink-0 px-1.5 py-0.5 text-[12px] font-bold border ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}

function SkillRow({ line }: { line: SkillLine }) {
  const { where, weaponName, exclusive, sk } = line
  return (
    <div className="flex items-start bg-bg-dark border border-border-subtle" style={{ gap: 8, padding: '6px 8px' }}>
      <SkillIcon iconLocal={sk.iconLocal} name={sk.name} size="sm" />
      <span className="flex flex-col min-w-0 grow" style={{ gap: 2 }}>
        <span className="flex items-baseline flex-wrap" style={{ gap: 6 }}>
          <span className={`${HUD.bodyStrong} text-text-primary`}>{sk.name}</span>
          {exclusive && (
            <span className="hud-cut-sm px-1 text-[11px] font-bold text-accent-yellow bg-accent-yellow/10 border border-accent-yellow/30">
              專武
            </span>
          )}
          {/* 來源退成副標：分組已經回答了「怎麼生效」，這裡只補「哪一把」 */}
          <span className={`${HUD.body} text-text-dim ml-auto shrink-0`}>{where} · {weaponName}</span>
        </span>

        {/* ⚠ 專武技能的「強化天賦」在這裡**只點名、不展開**：完整的前後對比在左欄的
            天賦條（`PilotTalentStrip`），那裡才有天賦原文可以做差異對比。
            兩處各印一份長文，右欄會被一段與武器無關的天賦正文淹掉。 */}
        {sk.enhancesTalentName && (
          <span className="text-[12px] text-accent-yellow/90 leading-snug">
            ▶ 強化天賦：{sk.enhancesTalentName}（前後對比看左邊的天賦欄）
          </span>
        )}

        <span className={`${HUD.body} text-text-secondary`}>
          <RefText text={sk.description} refs={sk.descriptionRefs} />
        </span>
      </span>
    </div>
  )
}
