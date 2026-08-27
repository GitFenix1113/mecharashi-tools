import { useMemo, useState } from 'react'
import type { DescriptionRefs, PilotSkillDoc, PilotTalent, Weapon } from '../../types'
import {
  pilotExclusiveWeapons, planWeaponAutoEquip,
  type LoadoutContext, type WeaponAutoEquipPlan,
} from '../../utils/loadoutRules'
import type { WeaponSlotRef } from '../../types/slots'
import { weaponRows } from '../../utils/loadoutRows'
import { resolveWeaponSkills } from '../../utils/weaponSkills'
import { SkillIcon } from '../icons/SkillIcon'
import { RefText } from '../refs/RefText'
import { DiffHighlight } from '../refs/DiffHighlight'
import LoadoutIcon from '../icons/LoadoutIcon'
import { HUD, HUD_PANEL } from './loadoutTheme'

// ─── 機師天賦條 · 專武強化（使用者要求 2026-08-27）──────────────────────────
//
// 「機師如果裝配了自己的專武，希望可以展示專武的天賦強化部分。」——使用者逐字，
// 並指定位置在左邊的機師欄。
//
// ── 為什麼是機師卡**下方**的獨立區塊，不是卡片裡面 ──────────────────────────
// `PilotIdentityCard` 的高度是**刻意寫死**的（立繪非同步載入，讓圖決定高度會在它到位
// 那一刻把整個左欄往下推）。把一段會展開的天賦正文塞進那張卡，等於親手拆掉那條保證。
// 拆成兩塊之後，卡片仍然是固定高的身分卡，這一條則自己負責長高。
//
// ── 為什麼預設只有一排縮圖 ─────────────────────────────────────────────────
// 天賦正文一段動輒三四行，四個天賦攤開就是半個螢幕，而玩家在配裝時多數時候
// 只想知道「有沒有被強化」——那件事一顆金框就講完了。點下去才展開那一個。
//
// ⚠ **未裝專武時也要出現**，只是換一句話（「裝上 XX 可強化 N 個天賦」）。
//   這一區真正的用處是回答「該不該把專武塞進這一套」，而那個問題是在**還沒裝**的時候問的。
//   只在裝上後才顯示，等於只服務已經做完決定的人。
//
// ⚠ 強化文字**必須連同該技能的 `descriptionRefs` 一起帶出來**（PLAN-019 引用渲染缺漏）：
//   強化敘述新增的 [xxx] 只側錄在武器技能上，天賦自身的 refs 沒有 ——
//   只用天賦 refs 的話那些引用會靜默降級成純文字。
//
// ⚠ 差異對比的 base 一律用 `talent.description`（**初始天賦**），不是 `descriptionMax`：
//   模擬器沒有星等模型，挑一個玩家沒設定過的滿星基準去 diff，畫出來的差異
//   會包含「滿星帶來的」與「專武帶來的」兩件事，而標題只寫了專武。

interface Props {
  ctx: LoadoutContext
  /** 技能庫（`pilotSkills`）。空 Map ＝ 還沒載入 —— 見 `loading` */
  skillMap: Map<string, PilotSkillDoc>
  loading?: boolean
  compact?: boolean
  /**
   * 一鍵裝上專武（使用者要求 2026-08-27）。**未傳＝不畫那顆鍵**——匯出圖等唯讀情境。
   *
   * ⚠ 槽位由 `planWeaponAutoEquip()` 決定，這裡只負責派出去：這一條與模組的
   *   「一鍵裝滿」逐字同一條，UI 不自己挑格子。
   */
  onEquipWeapon?: (ref: WeaponSlotRef, weaponId: string) => void
}

interface Enhancement {
  text: string
  refs?: DescriptionRefs
}

export function PilotTalentStrip({ ctx, skillMap, loading, compact, onEquipWeapon }: Props) {
  const pilot = ctx.pilot
  const [openName, setOpenName] = useState<string | null>(null)

  /**
   * 這位機師的專武**全部變體**，依升級鏈由母到子（熠光 → 裁決者）。
   *
   * ⚠ 判準是 `isExclusive && exclusiveFor`，**不是** `isFixedArmament` ——
   *   後者是「鎖死、無法更換」的固定武裝，語意相反（見 `types/weapon.ts`）。
   * ⚠ 舊版寫成 `find()` 只取一把，而實測有 3 位機師各有兩把（母武器與進階版**都**掛
   *   `isExclusive` 並指向同一位機師）—— 那個版本顯示哪一把取決於 Map 的迭代順序。
   */
  const variants = useMemo(
    () => (pilot ? pilotExclusiveWeapons(ctx, pilot.id) : []),
    [ctx, pilot],
  )
  /** 鏈頭（熠光）。狀態句在還沒裝任何一把時用它當代表 */
  const exclusive = variants[0] ?? null

  /** 目前這一套裝著的是哪一把變體（含固定武裝與形態鎖定那兩種來源）。沒裝回 null。 */
  const equippedVariant = useMemo(() => {
    const ids = new Set(weaponRows(ctx).map((r) => r.weapon?.id))
    return variants.find((w) => ids.has(w.id)) ?? null
  }, [ctx, variants])
  const equipped = equippedVariant !== null

  /**
   * **每一把**變體各一份計畫 —— 包含已經裝著的那一把。
   *
   * ⚠ **裝上之後仍然要算**（使用者裁決 2026-08-27）：玩家可能想雙手都拿同一把專武，
   *   而換成另一個變體（熠光 ⇄ 裁決者）更是這一區的主要用途。
   *   舊版寫成 `!equipped && …`，等於在裝上第一把的瞬間把整條收掉。
   * ⚠ **不可再加 `.filter(w => w.id !== equippedVariant?.id)`**（使用者回報 2026-08-28：
   *   「本來左右手專武可以快速加入，現在又變回只能一次加一隻手」）：那個 filter 是同一個
   *   錯誤換了寫法 —— 只有一把變體的機師（多數）裝上右手之後整條就消失，左手再也點不到，
   *   `EquipWeaponBar` 的「再裝一把」分支等於死碼。
   *   「這一格沒事可做」由規則層負責：`planWeaponAutoEquip()` 會把已拿著它的那一格從
   *   `options` 拿掉並回報 `alreadyEquipped`；真的沒位置時 options 為空、整條自己收掉。
   *
   * ⚠ **不包 useMemo**：包了會被 React Compiler 判成無法保留的手動記憶化，
   *   代價是整支元件放棄自動最佳化（ModulePanel 已經踩過一次）。
   */
  const equipPlans = variants
    .map((w) => ({ weapon: w, plan: planWeaponAutoEquip(ctx, w), relation: relationOf(w, equippedVariant) }))

  /**
   * 天賦名 → 被專武強化後的正文。
   *
   * ⚠ 來源是**目前裝著的那一把**，沒裝才退回鏈頭當預覽（使用者回報 2026-08-27：
   *   「裁決者也會強化天賦」）。實測兩個變體強化的是同一個天賦名，但**正文未必相同**
   *   ——拿母武器的敘述去代表已裝上的進階版，畫面會顯示一段與現況不符的強化文字。
   */
  const enhanceSource = equippedVariant ?? exclusive
  const enhancements = useMemo(() => {
    const map = new Map<string, Enhancement>()
    for (const sk of resolveWeaponSkills(enhanceSource?.skills, skillMap)) {
      if (sk.enhancesTalentName && sk.enhancedTalentDescription) {
        map.set(sk.enhancesTalentName, { text: sk.enhancedTalentDescription, refs: sk.descriptionRefs })
      }
    }
    return map
  }, [enhanceSource, skillMap])

  if (!pilot) return null
  const talents = pilot.talents ?? []
  if (talents.length === 0) return null

  const open = talents.find((t) => t.name === openName) ?? null
  const enhancedCount = talents.filter((t) => enhancements.has(t.name)).length
  /**
   * 武器集合到齊了嗎。
   *
   * ⚠ **這一條不可省**：`weapons` 自 `equip` 階段才載入（還沒選機甲時是空 Map），
   *   而空 Map 會讓 `exclusive` 查成 null —— 照著印就會對每一位機師說
   *   「這位機師沒有專武」，那是一句**錯的肯定陳述**，而且它出現在最常見的初始狀態。
   *   同 components／modules 的那一條：空 Map ＝ 還沒載入，不是「這個世界沒有」。
   */
  const worldReady = ctx.world.weapons.size > 0

  return (
    <section className={`${HUD_PANEL} p-3 space-y-2`}>
      <div className="flex items-baseline gap-2">
        <span className={`${HUD.label} text-text-dim`}>Talents</span>
        <span className={`${HUD.body} text-text-dim ml-auto text-right min-w-0`}>
          {statusLine({ worldReady, exclusive, equippedVariant, enhancedCount, loading })}
        </span>
      </div>

      {/* 一鍵裝上／換變體。**只在「真的還有位置裝得上」時出現** —— 出現卻按不動的按鈕
          比沒有按鈕更糟。沒有位置且沒裝過時改印一行原因（見下方 `EquipWeaponBar`）。 */}
      {onEquipWeapon && equipPlans.map((e) => (
        <EquipWeaponBar
          key={e.weapon.id}
          plan={e.plan}
          relation={e.relation}
          enhances={enhancedCount}
          onEquip={onEquipWeapon}
        />
      ))}

      <div className="flex flex-wrap" style={{ gap: 6 }}>
        {talents.map((t) => (
          <TalentThumb
            key={t.name}
            talent={t}
            // 金框只在**真的裝上了**才亮：未裝時那是「可以拿到」，不是「已經有」，
            // 兩者用同一個視覺會讓玩家以為加成已經生效
            enhanced={equipped && enhancements.has(t.name)}
            available={!equipped && enhancements.has(t.name)}
            active={openName === t.name}
            compact={compact}
            onClick={() => setOpenName((n) => (n === t.name ? null : t.name))}
          />
        ))}
      </div>

      {open && (
        <TalentDetail
          talent={open}
          enhancement={equipped ? enhancements.get(open.name) ?? null : null}
          // 強化框的抬頭印**裝著的那一把**（熠光／裁決者的強化正文未必相同）
          weaponName={equippedVariant?.name}
          pending={!equipped && enhancements.has(open.name) ? exclusive?.name : undefined}
        />
      )}
    </section>
  )
}

/**
 * 這一把變體與**目前裝著的那把**是什麼關係。決定按鈕上的動詞。
 *
 * 使用者逐字：「如果他裝備了熠光，那按鈕就變成裁決者；裝了裁決者，按鈕就變成熠光。」
 * —— 兩個方向都要走得通，而且要講得出走的是哪一個方向：
 * 往上是「升級」（拿到更強的），往下是「換回」（材料還沒湊齊時的現實選擇）。
 */
type VariantRelation = 'plain' | 'upgrade' | 'downgrade'

const VERB: Record<VariantRelation, string> = {
  plain: '裝上專武',
  upgrade: '升級為',
  downgrade: '換回',
}

function relationOf(candidate: Weapon, equipped: Weapon | null): VariantRelation {
  if (!equipped) return 'plain'
  if (candidate.upgrade?.fromWeaponId === equipped.id) return 'upgrade'
  if (equipped.upgrade?.fromWeaponId === candidate.id) return 'downgrade'
  return 'plain'
}

/** 抬頭右側那一句。四種狀態各自一句話，不共用一句含糊的。 */
function statusLine({
  worldReady, exclusive, equippedVariant, enhancedCount, loading,
}: {
  worldReady: boolean
  /** 鏈頭（熠光）。還沒裝任何一把時用它當代表 */
  exclusive: Weapon | null
  /**
   * 目前裝著的那一把變體。
   *
   * ⚠ **不可印鏈頭的名字**：裝著裁決者卻寫「已裝熠光」是一句**錯的肯定陳述**，
   *   而它剛好出現在玩家剛做完升級、正在確認結果的那一刻。
   */
  equippedVariant: Weapon | null
  enhancedCount: number
  loading?: boolean
}): React.ReactNode {
  const equipped = equippedVariant !== null
  // 武器還沒載入（＝還沒選機甲）：只講下一步，不對專武下任何判斷（見 `worldReady`）
  if (!worldReady) return '選好機甲後顯示專武強化'
  if (!exclusive) return '這位機師沒有專武'
  // 技能庫沒載完時 `enhancedCount` 恆為 0，那時說「沒有強化任何天賦」是一句錯話
  if (loading) return '載入技能庫中…'
  if (enhancedCount === 0) {
    return <>專武<span className="text-text-secondary">{exclusive.name}</span>不強化天賦</>
  }
  if (equipped) {
    return (
      <>
        已裝<span className="text-accent-yellow">{equippedVariant.name}</span>，
        強化 <span className={HUD.num}>{enhancedCount}</span> 個天賦
      </>
    )
  }
  return (
    <>
      裝上<span className="text-text-secondary">{exclusive.name}</span>可強化
      <span className={HUD.num}> {enhancedCount} </span>個天賦
    </>
  )
}

/**
 * 「裝上專武」那一條。
 *
 * ⚠ 樣式與模組的「裝滿 N 格」**同一套**（實心橘底 ＋ 深色字 ＋ ＋號圖示）：
 *   兩者是同一類東西 —— 站上替玩家一次做完好幾步的捷徑。長得不一樣會讓人以為
 *   它們的份量不同。徽章一律是淡底，實心色塊在本頁只用於這一類（使用者回饋 2026-08-27）。
 *
 * ⚠ 裝不上時**不畫成 disabled 的按鈕**：一顆按不動的鍵只會讓人一直去按它。
 *   改成一行說明，並且把原因寫出來（多半是出力不足 —— 那是玩家改得動的事）。
 */
function EquipWeaponBar({ plan, relation, enhances, onEquip }: {
  plan: WeaponAutoEquipPlan
  /** 這一把與**目前裝著的那把變體**是什麼關係，決定動詞（見 `relationOf`） */
  relation: VariantRelation
  /** 這把專武會強化幾個天賦。0 ＝ 不提，免得變成一句沒有內容的推銷 */
  enhances: number
  onEquip: (ref: WeaponSlotRef, weaponId: string) => void
}) {
  const verb = VERB[relation]
  if (plan.options.length === 0) {
    // 沒有位置可裝。已經裝著（`alreadyEquipped`）⇒ 安靜；真的裝不上才說話。
    // 兩者由規則層的 `rejection` 分開 —— 這裡不重判一次
    if (!plan.rejection) return null
    return (
      <p className="text-[12px] leading-relaxed text-text-dim">
        {plan.alreadyEquipped ? '再裝一把' : `無法${verb}`}
        <strong className="text-text-secondary">{plan.weapon.name}</strong>：{plan.rejection.reason}
      </p>
    )
  }

  const titleOf = (o: WeaponAutoEquipPlan['options'][number]) => [
    `裝到${o.label}`,
    o.displaces ? `會換掉${o.displaces}（可復原）` : null,
    enhances > 0 ? `強化 ${enhances} 個天賦` : null,
  ].filter(Boolean).join('\n')

  const solid = `hud-cut-sm inline-flex items-center justify-center gap-1 px-2 py-1 font-bold
    bg-accent-orange text-bg-dark hover:bg-accent-yellow
    shadow-[0_1px_6px_rgba(255,107,43,0.35)] transition-colors cursor-pointer`

  // ── 只有一個位置：整條就是一顆鍵 ──
  //    （雙手武器恆走這一支：左右手指向同一個 dualHand 座標，已在規則層去重）
  if (plan.options.length === 1) {
    const o = plan.options[0]
    return (
      <button
        type="button"
        onClick={() => onEquip(o.ref, plan.weapon.id)}
        title={titleOf(o)}
        className={`${solid} w-full text-[13px]`}
      >
        <LoadoutIcon name="plus" className="w-3.5 h-3.5 shrink-0" strokeWidth={3} />
        {/* ⚠ 武器名要能被截斷（`min-w-0 truncate`）：專武名最長 7 個字，而這一欄在
            兩欄版只有 ~300px。不給它縮的餘地，整顆按鈕會把左欄撐寬 → 全頁長出橫向捲軸
            （使用者要求 2026-08-27：整體版面不要形成左右 scroller）。 */}
        <span className="min-w-0 truncate">
          {plan.alreadyEquipped ? '再裝一把' : verb} {plan.weapon.name}
        </span>
        <span className="font-normal opacity-80 shrink-0">· {o.label}</span>
      </button>
    )
  }

  // ── 兩個以上：讓玩家自己點哪一隻手（使用者要求 2026-08-27）──
  //
  // ⚠ **不預選、也不標「建議」**：慣用手是偏好不是最佳解，站上沒有立場替他決定。
  //   第一版直接挑第一格，等於替所有人決定了左手。
  // ⚠ 盾牌不必在這裡特判 —— `SHIELD_LIMIT` 已經讓它只剩一個選項（見 `options` 的註解）。
  return (
    <div className="flex flex-wrap items-center" style={{ gap: 6 }}>
      {/* ⚠ 動詞跟著現況走：沒裝＝「裝上專武」、已裝母武器＝「升級為」、已裝進階版＝「換回」、
          已經拿著同一把＝「再裝一把」。四種狀態共用一句「裝上專武」的話，
          在後三種情況讀起來都像「你還沒裝」——而那是錯的。 */}
      <span className="text-[13px] text-text-secondary min-w-0 truncate">
        {plan.alreadyEquipped ? '再裝一把' : verb}
        <strong className="text-text-primary">{plan.weapon.name}</strong>：
      </span>
      {plan.options.map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => onEquip(o.ref, plan.weapon.id)}
          title={titleOf(o)}
          className={`${solid} text-[13px] shrink-0 ${o.displaces ? 'opacity-85' : ''}`}
        >
          <LoadoutIcon name="plus" className="w-3 h-3 shrink-0" strokeWidth={3} />
          {o.label}
        </button>
      ))}
    </div>
  )
}

function TalentThumb({
  talent, enhanced, available, active, compact, onClick,
}: {
  talent: PilotTalent
  enhanced: boolean
  available: boolean
  active: boolean
  compact?: boolean
  onClick: () => void
}) {
  const ring = enhanced ? 'border-accent-yellow'
    : available ? 'border-accent-yellow/35 border-dashed'
    : active ? 'border-accent-orange'
    : 'border-border-subtle hover:border-border-accent'

  return (
    <button
      type="button"
      onClick={onClick}
      title={talent.name}
      aria-pressed={active}
      className={`hud-cut-sm relative flex items-center border bg-bg-dark transition-colors cursor-pointer ${ring} ${
        active ? 'bg-accent-orange/10' : ''
      }`}
      style={{ gap: 6, padding: '4px 8px 4px 4px' }}
    >
      <SkillIcon iconLocal={talent.iconLocal} name={talent.name} size="sm" />
      {!compact && (
        <span className={`${HUD.body} truncate max-w-[7.5rem] ${enhanced ? 'text-accent-yellow' : 'text-text-secondary'}`}>
          {talent.name}
        </span>
      )}
      {/* 已強化的角標。`available`（可強化但沒裝）刻意**不掛角標**，只留虛線框 ——
          角標會被讀成「已經生效」 */}
      {enhanced && (
        <span
          className="absolute -right-1 -top-1 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-accent-yellow text-bg-dark text-[9px] font-bold leading-none"
          aria-label="專武強化"
        >
          強
        </span>
      )}
    </button>
  )
}

function TalentDetail({
  talent, enhancement, weaponName, pending,
}: {
  talent: PilotTalent
  /** 有值 ＝ 專武已裝且它強化這個天賦 */
  enhancement: Enhancement | null
  weaponName?: string
  /** 「裝上這把就會強化」——有值 ＝ 可強化但目前沒裝 */
  pending?: string
}) {
  return (
    <div className="hud-cut-sm border border-border-subtle bg-bg-dark px-2.5 py-2 space-y-1.5">
      <div className="flex items-center" style={{ gap: 6 }}>
        <SkillIcon iconLocal={talent.iconLocal} name={talent.name} size="sm" />
        <span className={`${HUD.bodyStrong} text-text-primary`}>{talent.name}</span>
      </div>

      <p className={`${HUD.body} text-text-secondary`}>
        <RefText text={talent.description} refs={talent.descriptionRefs} />
      </p>

      {enhancement && (
        <div className="hud-cut-sm border border-accent-yellow/25 bg-accent-yellow/5 px-2 py-1.5">
          <span className={`${HUD.labelCjk} text-accent-yellow`}>
            ▶ 專武強化{weaponName ? ` · ${weaponName}` : ''}
          </span>
          <p className={`${HUD.body} text-text-secondary mt-1`}>
            {/* 兩份 refs 合併：強化敘述新增的 [xxx] 只側錄在武器技能上（見檔頭） */}
            <DiffHighlight
              base={talent.description}
              enhanced={enhancement.text}
              refs={{ ...talent.descriptionRefs, ...enhancement.refs }}
            />
          </p>
        </div>
      )}

      {pending && (
        <p className="text-[11px] text-accent-yellow/80 leading-relaxed">
          裝上專武<strong>{pending}</strong>後，這個天賦會被改寫 —— 裝上來這裡就會顯示前後對比。
        </p>
      )}
    </div>
  )
}
