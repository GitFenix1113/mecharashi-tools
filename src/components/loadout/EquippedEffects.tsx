import { useMemo } from 'react'
import type { Module } from '../../types'
import type { MechPartPosition } from '../../types/enums'
import { MECH_PART_ORDER } from '../../utils/chassisStats'
import { partLabel } from '../../utils/moduleSlots'
import {
  interfaceState, moduleLevelAt, moduleStatsAt, sumModuleStats,
  moduleFamilyKey, type ModuleStack,
} from '../../utils/moduleRules'
import { ModuleSlot } from '../../types/enums'
import { activeStacks, type LoadoutContext } from '../../utils/loadoutRules'
import type { InnateSource, UnlockBlock } from '../../utils/innateModules'
import { ModuleStatTags } from '../module/ModuleStatTags'
import { ModuleIcon } from '../icons/ModuleIcon'
import { InnateSourceBadge } from '../badges/InnateBadges'
import { HUD, HUD_READONLY } from './loadoutTheme'

// ─── 已裝效果彙總（PLAN-052-G C-4 ／ C-7 同族堆疊）──────────────────────────
//
// 「這一套裝了哪些模組、各自加了什麼、合計多少」。
//
// ⚠ **只能靠 `levels[]` 的數值欄位加總**（計畫書決策八）：2026-08-27 盤點確認
//   候選池 186 筆的 `buffIds` 與 `conditionalEffects` **都是 0 筆** —— 模組的效果
//   沒有進 PLAN-019 的 buff 層，也沒有結構化的條件效果。可用的只有 30 個數值欄位。
//
// ⚠ **合計走「族」而不是走「格」**（C-7）：同一顆模組裝兩格是**升它的等級**，
//   不是兩份效果。逐格加總會讓四顆刀劍模組Ⅱ 算出四倍加成 —— 那是這一區最容易
//   長出來的錯，而且它長得很像是對的。第二格起只標「與軀幹同族」，不重印一次數值。
//
// ⚠ **不出衍生的戰力／傷害數字**（總綱決策一④已裁決延後）：攻擊力口徑未定
//   （DB 值＝全部連擊總和、官方卡片＝每擊值，差額 17.3–18.6% 且逐把不同）。
//
// ⚠ **天生模組一併顯示但不可編輯**：玩家改不了它們，但它們確實在生效。藏起來會讓
//   合計對不上；混進四個接口那一區則會讓玩家以為自己可以換掉它們 —— 所以分兩區、
//   並標明「不可更換」。
//
// ── 天生那一區改成逐部位推導（PLAN-052-K D-1）──────────────────────────────
// 改寫前這一區讀的是機甲**頂層**三個欄位、等級一律取滿級（`chassis.moduleLevelOf`），
// 於是 052-G Phase D 讓玩家換部位之後它整區說謊：換掉滿階帕斯卡的右臂，遊戲裡
// 〈彙編矩陣〉整顆消失、〈蓄能模組〉8→6、〈出力模組〉4→3，站上一顆都不動。
//
// 現在的來源是 `ctx.chassis.innateByPart`（逐格取自**那一格的來源機甲**），
// 等級則來自 `ctx.stacks` —— 天生與插槽**共用同一個等級池**：
//
//     level = min( Σ天生貢獻 ＋ Σ(插槽貢獻 × 部位倍率), cap )
//
// ⚠ 合計因此**只加 `ctx.stacks` 一次**。改寫前是「stacks ＋ 天生逐顆」相加，
//   那在兩邊出現同一族時會算兩份；現在同一族只會有一筆。
//
// ⚠ **未解鎖的不刪掉，改成停用態**（決策五 / D-3）：復仇女神少一個部位 ⇒ 迸發模組
//   只剩 6 級 ⇒ 四顆〈模型-XX〉一起失效。直接讓它們從清單消失，玩家會以為是 bug。
//   合計走 `activeStacks()`，畫面走 `ctx.stacks` ＋ `ctx.moduleBlocks`。

interface SlotLine {
  position: MechPartPosition
  iface: string
  usable: boolean
  mod: Module | null
  /** 查無資料時要印出來的 id（斷鏈要看得見，不是靜默留白） */
  fallbackId?: string
  stack: ModuleStack | null
  /**
   * 沒解鎖的原因（PLAN-052-K D-3）。**今天恆為 null** —— 六顆有條件的模組全是
   * 機甲專屬／隱藏模組，進不了候選池，插不到接口上。
   *
   * ⚠ 仍然接起來的理由：合計走 `activeStacks()`（會扣掉未解鎖的），這一列若不跟著扣，
   *   哪天官方出一顆有條件的通用模組，畫面就會變成「這一列印著加成、合計卻沒算它」
   *   —— 一個沒有任何錯誤訊息、只能靠人肉對帳發現的差異。
   */
  block: UnlockBlock | null
}
// ⏸ `primary` / `sharedWith` 已隨「相同模組合併成一列」移除（使用者要求 2026-08-27）：
//    它們是逐格列時代用來避免重印數值的補丁 —— 第二格起改印「與軀幹同族」。
//    合併之後同一族本來就只有一列，那句話與它服務的欄位一起消失。
//    ⚠ 縮圖版（`ModuleThumbStrip`）**仍然逐格畫**，那是刻意的：一排四顆縮圖要對應
//      四個接口，合併會讓「有幾格被佔用」看不出來。合併只發生在文字列這一側。

/**
 * 這一套的模組全貌（接口那四格 ＋ 機甲自帶 ＋ 合計 ＋ 超限）。
 *
 * ⚠ **完整版與縮圖版共用這一支**（使用者要求 2026-08-27 把兩區收成中欄的縮圖面板）：
 *   同族堆疊、天生模組的來源、合計「每族只算一次」這三條各留一份必然漂移，
 *   而漂移的症狀是「收合時的合計」與「展開後的合計」對不起來 —— 那正是最難察覺的一種。
 *
 * 刻意**不匯出**：它是 hook，從這個檔匯出會讓 Vite 的 fast refresh 對整檔失效
 * （`react-refresh/only-export-components`，同 `loadoutTheme.ts` 的那一條）。
 */
function useModuleView(ctx: LoadoutContext) {
  const { mech, chassis } = ctx

  // 天生 ＋ 插槽同一個等級池，在 `buildContext()` 算好（PLAN-052-K D-1）。
  // 這裡再算一次的話，右欄的 Lv 與四部位卡、OutputBar、匯出圖會各說各話。
  const stacks = ctx.stacks

  const slots = useMemo<SlotLine[]>(() => {
    if (!chassis) return []
    return MECH_PART_ORDER.map((pos) => {
      const id = ctx.modules[pos]
      const mod = id ? ctx.world.modules.get(id) ?? null : null
      const iface = interfaceState(chassis.moduleSlots[pos].iface)
      const stack = mod ? stacks.get(moduleFamilyKey(mod)) ?? null : null
      return {
        position: pos,
        iface: iface === 'none' ? '無接口' : iface === 'unknown' ? '型別不明' : iface,
        usable: iface !== 'none' && iface !== 'unknown',
        mod,
        fallbackId: id && !mod ? id : undefined,
        stack,
        block: (mod && ctx.moduleBlocks.get(moduleFamilyKey(mod))) || null,
      }
    })
  }, [ctx, chassis, stacks])

  /**
   * 機甲自帶的那幾顆 —— **逐部位推導後再依模組收成一列**（PLAN-052-K D-1）。
   *
   * ⚠ 一顆天生模組通常四個部位都有份（S 級的 8 級模組每部位 2 級），
   *   逐部位列會變成同一顆講四遍。收成一列、把貢獻的部位列在左欄，
   *   與接口那一區「按族合併」是同一種讀法。
   *
   * ⚠ 等級取 `stacks`（含插槽貢獻並已封頂），不是四格相加：天生與插槽共用一個池，
   *   自己加會得到一個沒封頂、而且與旁邊那一區對不起來的數字。
   */
  const innate = useMemo<InnateLine[]>(() => {
    if (!mech || !chassis) return []
    const order: string[] = []
    const acc = new Map<string, { positions: MechPartPosition[]; source: InnateSource; sum: number }>()
    const gaps: InnateLine[] = []

    for (const pos of MECH_PART_ORDER) {
      const res = chassis.innateByPart[pos]
      for (const e of res.entries) {
        let it = acc.get(e.moduleId)
        if (!it) { it = { positions: [], source: 'rule', sum: 0 }; acc.set(e.moduleId, it); order.push(e.moduleId) }
        it.positions.push(pos)
        it.sum += e.level
        // 一格是人工填的，整顆就標人工 —— 混搭時四格可能來自四台，其中一台被覆寫過
        if (e.source === 'override') it.source = 'override'
      }
      // 資料缺口不靜默：這兩類算不出部位，但它們**確實掛在機甲上**。
      // 不列出來的話畫面與遊戲差一顆，而且沒有任何症狀。
      for (const id of res.missingBoundPart) gaps.push(gapLine(id, '專屬模組未填部位'))
      for (const id of res.unknownModuleIds) gaps.push(gapLine(id, '模組資料已不存在'))
    }

    const lines = order.map((id) => {
      const it = acc.get(id)!
      const mod = ctx.world.modules.get(id) ?? null
      const stack = mod ? stacks.get(moduleFamilyKey(mod)) ?? null : null
      return {
        key: id,
        mod,
        fallbackId: mod ? undefined : id,
        positions: it.positions,
        source: it.source,
        innateSum: it.sum,
        // 查無模組時退回天生那一段的合計 —— 至少講得出「它給了幾級」
        level: stack?.level ?? it.sum,
        cap: stack?.cap ?? 0,
        slotCount: stack?.positions.length ?? 0,
        block: (mod && ctx.moduleBlocks.get(moduleFamilyKey(mod))) || null,
      }
    })
    // 缺口去重（四個部位可能各回報同一顆）
    const seen = new Set(lines.map((l) => l.key))
    return [...lines, ...gaps.filter((g) => !seen.has(g.key) && seen.add(g.key))]
  }, [mech, chassis, ctx.world.modules, ctx.moduleBlocks, stacks])

  const equippedCount = slots.filter((l) => l.mod).length
  // 空 Map ＝還沒載入完（見 LoadoutWorld.modules），不是「這台沒有天生模組」
  const loading = ctx.world.modules.size === 0

  /**
   * 合計：**每族一次**，天生與插槽已在 `stacks` 裡合流（見檔頭），
   * 未解鎖的那幾族不算（`activeStacks()`）。
   */
  const total = useMemo(() => sumModuleStats(
    activeStacks(ctx).map((st) => moduleStatsAt(st.mod, st.level)),
  ), [ctx])

  // ⚠ **只提醒玩家動得到的那些**（`positions.length > 0`）：純天生就超出上限的族
  //   （若哪天出現）不是玩家裝出來的，那句「把多的那幾格換掉」會變成在怪他。
  const wasted = [...stacks.values()].filter((st) => st.overflow > 0 && st.positions.length > 0)
  // ⚠ 條件是「**接口上**裝了 8 級模組」而不是「這一族是 8 級模組」：
  //   自帶那一顆自 D-1 起也進 stacks，用後者的話 S／A 級 74 台每台都會跳這段說明。
  const hasEightLevel = [...stacks.values()].some(
    (st) => st.mod.slot === ModuleSlot.SLOT_8 && st.positions.length > 0,
  )

  /**
   * **按族合併**的接口列（使用者要求 2026-08-27：「相同的模組展示一條即可」）。
   *
   * 逐格列的版本在最常見的配法下會長成四列同一顆模組，其中三列的內容是
   * 「與軀幹、右臂、腿部同族，合計 Lv4」—— 同一句話講三遍，而真正的資訊
   * （這顆加了什麼）只出現在第一列。合併後一列就答完：裝在哪幾格、幾級、加什麼。
   *
   * ⚠ **空格與無接口不合併**：它們各自代表一個玩家可以動的位置（或不能動的原因），
   *   把三個空格併成「軀幹、左臂、腿部 未裝」會讓「點哪裡去裝」變得不明確。
   *   合併只發生在**真的裝了同一族**的那些格上。
   */
  const merged = useMemo<MergedLine[]>(() => {
    const out: MergedLine[] = []
    const done = new Set<string>()
    for (const l of slots) {
      if (!l.mod || !l.stack) { out.push({ key: l.position, positions: [l.position], line: l }); continue }
      const key = moduleFamilyKey(l.mod)
      if (done.has(key)) continue
      done.add(key)
      // 順序取自 `stack.positions`（已依 MECH_PART_ORDER 排好），與四部位卡的排列一致
      out.push({ key, positions: l.stack.positions, line: l })
    }
    return out
  }, [slots])

  return { mech, chassis, slots, merged, innate, equippedCount, loading, total, wasted, hasEightLevel }
}

/** 機甲自帶的一列：一顆模組 ＋ 它由哪些部位帶來、幾級、生不生效。 */
interface InnateLine {
  /** ＝ 模組 doc id */
  key: string
  mod: Module | null
  /** 查無資料時要印出來的 id（斷鏈要看得見，不是靜默留白） */
  fallbackId?: string
  /** 哪幾個部位帶來這一顆。資料缺口列為空 */
  positions: MechPartPosition[]
  source: InnateSource
  /** Σ 天生貢獻（未封頂）。與 `level` 的差額就是插槽那一段 */
  innateSum: number
  /** 生效等級（天生 ＋ 插槽，已封頂） */
  level: number
  cap: number
  /** 這一族同時也裝在幾個接口上（0 ＝ 純天生） */
  slotCount: number
  /** 沒解鎖的原因（PLAN-052-K D-3）。`null` ＝ 生效中 */
  block: UnlockBlock | null
  /** 資料缺口的說明。有值時這一列算不出部位與等級，只是為了**不讓它消失** */
  gap?: string
}

/** 算不出部位／查無資料的那幾顆。仍然列出來 —— 它們確實掛在機甲上。 */
const gapLine = (id: string, gap: string): InnateLine => ({
  key: id, mod: null, fallbackId: id, positions: [], source: 'rule',
  innateSum: 0, level: 0, cap: 0, slotCount: 0, block: null, gap,
})

/**
 * 沒解鎖的原因，講成人話。
 *
 * ⚠ `required <= 0` 是**資料斷鏈**（觸發者查無 `levels[]`），不是「需要 LV.0」——
 *   照字面印會變成一句玩家永遠達不成、也看不懂的條件。
 */
function blockText(block: UnlockBlock, ctx: LoadoutContext): string {
  if (block.kind === 'pilotOnly') {
    const names = block.pilotIds.map((id) => ctx.world.pilots.get(id)?.name ?? id).join('、')
    return `只有 ${names} 駕駛時才會啟動`
  }
  const name = ctx.world.modules.get(block.moduleId)?.name ?? block.moduleId
  return block.required > 0
    ? `需要〈${name}〉達 LV.${block.required}（目前 LV.${block.current}）`
    : `需要〈${name}〉滿級，但該模組的階數未建檔`
}

/** 合併後的一列：一顆模組（或一個空格）＋ 它佔的所有部位。 */
interface MergedLine {
  key: string
  positions: MechPartPosition[]
  /** 代表列。數值、接口型別、斷鏈訊息都取自它 */
  line: SlotLine
}

export function EquippedEffects({ ctx }: { ctx: LoadoutContext }) {
  const { mech, chassis, slots, merged, innate, equippedCount, loading, total, wasted, hasEightLevel } = useModuleView(ctx)

  if (!mech || !chassis) return null

  return (
    <div className="space-y-2.5">
      <Group label={`模組接口（${equippedCount} / ${slots.length}）`}>
        {merged.map((m) => <SlotRow key={m.key} merged={m} ctx={ctx} />)}
      </Group>

      {/* 超限提醒（使用者裁決 2026-08-27）—— 提醒而不是擋：裝四顆同族是合法操作，
          只是其中幾顆白費，那是玩家的選擇。不說則會讓他以為自己疊出了 8 級。 */}
      {wasted.map((st) => (
        <p
          key={moduleFamilyKey(st.mod)}
          className="hud-cut-sm border border-accent-yellow/30 bg-accent-yellow/5 px-2.5 py-2 text-[12px] leading-relaxed text-accent-yellow/90"
        >
          ⚠ <strong>{st.mod.name}</strong> 裝了 {st.positions.length} 顆（
          {st.positions.map(partLabel).join('、')}）＝ <strong>{st.sum}</strong> 級
          {/* 天生那一段要講出來，否則「裝 2 顆共 2 級卻超出 8 階」讀起來像算錯
              （PLAN-052-K D-1：滿階 S 級甲自帶的 8 級模組本身就給滿 8 級） */}
          {st.innateSum > 0 && <>，加上機甲自帶的 <strong>{st.innateSum}</strong> 級</>}
          ，合計 <strong>{st.sum + st.innateSum}</strong> 級，但它只有 <strong>{st.cap}</strong> 階
          —— 超出的 <strong>{st.overflow}</strong> 級<strong>不會生效</strong>。
          把多的那幾格換成別的模組，等於白拿一份加成。
        </p>
      ))}

      {hasEightLevel && <EightLevelNote />}

      {(innate.length > 0 || loading) && (
        <Group label="機甲自帶 · 不可更換">
          {loading && innate.length === 0
            ? <p className={`${HUD.body} text-text-dim`}>載入模組中…</p>
            : innate.map((l) => <InnateRow key={l.key} line={l} ctx={ctx} />)}
        </Group>
      )}

      <div className="border-t border-border pt-2">
        <div className={`${HUD.labelCjk} text-text-dim mb-1`}>合計加成</div>
        {Object.keys(total).length > 0 ? (
          <ModuleStatTags stats={total} variant="chip" className="flex flex-wrap gap-1.5 text-[13px]" />
        ) : (
          <p className={`${HUD.body} text-text-dim`}>
            {loading ? '載入模組中…' : '目前沒有任何模組加成。'}
          </p>
        )}
        {/* 口徑未定的東西寧可不出，也不要出一個玩家會拿去做決定的推測值 */}
        <p className="text-[11px] text-text-dim leading-relaxed mt-1.5">
          同一顆模組裝多格是<strong className="text-text-secondary">疊等級</strong>而不是疊效果，
          所以合計每一族只算一次。此處只列模組本身的加成，不含衍生的戰力／傷害推算（攻擊力口徑未定）。
        </p>
      </div>
    </div>
  )
}

/**
 * ── 縮圖版（使用者要求 2026-08-27）─────────────────────────────────────────
 *
 * 面板收合時顯示的那一排。「模組效果」原本住在右欄，逐格一列、四列加上天生那幾顆
 * 再加兩段說明——擺在半欄寬的中欄下方會是一根長條。收合態改成**一排縮圖 ＋ 合計標籤**：
 * 「裝了什麼」用圖回答，「總共加多少」用標籤回答，兩者都不必讀完整句子。
 *
 * ⚠ 與展開版**同源**（`useModuleView`）：兩份各自推導必然漂移，而症狀是收合／展開
 *   兩個合計對不起來（見該 hook 的註解）。
 *
 * ⚠ 超限那一條**在收合態也要出現**，只是縮成一行：它是這一區唯一「玩家該動手改」的
 *   訊息，藏在展開後面等於預設不說。其餘說明文（8 級差額、每族只算一次的口徑）
 *   留在展開版——那些是讀數字時才需要的背景。
 */
export function ModuleThumbStrip({ ctx }: { ctx: LoadoutContext }) {
  const { mech, chassis, slots, innate, equippedCount, loading, total, wasted } = useModuleView(ctx)
  const blocked = innate.filter((l) => l.block)

  if (!mech || !chassis) return null
  if (loading) return <p className={`${HUD.body} text-text-dim`}>載入模組中…</p>

  return (
    <div className="space-y-2">
      {/* ⚠ `pr-1`：縮圖的等級角標用 `-right-1` 往外掛，最右邊那一顆會超出容器 4px。
          在這一層吸收掉，否則它會一路累加到頁面層變成一條橫向捲軸
          （使用者要求 2026-08-27：不要形成左右 scroller）。 */}
      <div className="flex flex-wrap items-start pr-1" style={{ gap: 6 }}>
        {slots.map((l) => (
          <Thumb
            key={l.position}
            mod={l.mod}
            // 未裝與「這一格根本沒有接口」是兩件事：後者畫成可裝的空框會讓玩家一直想點它
            level={l.stack?.level}
            cap={l.stack?.cap}
            over={!!l.stack && l.stack.overflow > 0}
            disabled={!l.usable}
            title={`${partLabel(l.position)}｜${l.iface}｜${l.mod?.name ?? l.fallbackId ?? '未裝'}`}
          />
        ))}

        {innate.length > 0 && (
          <>
            {/* 分隔線：天生那幾顆玩家改不了，混在同一排會讓人以為可以換掉它們 */}
            <span aria-hidden className="self-stretch w-px bg-border mx-0.5" />
            {innate.map((l) => (
              <Thumb
                key={l.key}
                mod={l.mod}
                // 未啟動的不印等級：印了就等於宣稱它在生效（PLAN-052-K D-3）
                level={l.block ? undefined : l.level || undefined}
                cap={l.block ? undefined : l.cap || undefined}
                innate
                disabled={!!l.block}
                title={
                  l.block
                    ? `${l.mod?.name ?? l.fallbackId ?? '—'}｜未啟動：${blockText(l.block, ctx)}`
                    : `${l.positions.map(partLabel).join('、') || '—'} 自帶（不可更換）｜${l.mod?.name ?? l.fallbackId ?? '—'}`
                }
              />
            ))}
          </>
        )}
      </div>

      <div className={`${HUD.body} text-text-dim flex items-baseline`} style={{ gap: 10 }}>
        <span>接口 <span className={HUD.num}>{equippedCount}/{slots.length}</span></span>
        {innate.length > 0 && <span>自帶 <span className={HUD.num}>{innate.length}</span></span>}
      </div>

      {Object.keys(total).length > 0 ? (
        <ModuleStatTags stats={total} variant="chip" className="flex flex-wrap gap-1.5 text-[13px]" />
      ) : (
        <p className={`${HUD.body} text-text-dim`}>目前沒有任何模組加成。</p>
      )}

      {wasted.length > 0 && (
        <p className="text-[12px] text-accent-yellow/90 leading-snug">
          ⚠ {wasted.map((st) => st.mod.name).join('、')} 同族超限，多的幾級不會生效 —— 展開看細節。
        </p>
      )}

      {/* 停用的天生模組（D-3）。收合態一排灰圖但不講原因＝玩家眼中的 bug */}
      {blocked.length > 0 && (
        <p className="text-[12px] text-text-dim leading-snug">
          {blocked.map((l) => l.mod?.name ?? l.fallbackId).join('、')} 目前未啟動 —— 展開看條件。
        </p>
      )}
    </div>
  )
}

/** 縮圖一顆：圖 ＋ 右下角的等級。名稱一律進 `title`——這一排的重點是認圖不是讀字。 */
function Thumb({ mod, level, cap, over, disabled, innate, title }: {
  mod: Module | null
  level?: number
  cap?: number
  over?: boolean
  disabled?: boolean
  innate?: boolean
  title: string
}) {
  return (
    <span className="relative inline-flex" title={title}>
      <ModuleIcon
        mod={mod}
        size={34}
        className={disabled ? 'opacity-35' : !mod ? 'border-dashed' : innate ? 'opacity-80' : ''}
      />
      {level !== undefined && level > 0 && (
        <span
          className={`${HUD.num} absolute -bottom-1 -right-1 px-[3px] text-[9px] leading-[1.3] bg-bg-dark border ${
            over ? 'border-accent-yellow/60 text-accent-yellow' : 'border-border text-text-secondary'
          }`}
        >
          {level}{cap ? `/${cap}` : ''}
        </span>
      )}
    </span>
  )
}

/**
 * 8 級模組的口徑說明。
 *
 * ⚠ **原文案已被 PLAN-052-K D-1 推翻**，逐字留在這裡當教訓：它說「站上目前只算接口
 *   這一段，機甲那一段還沒建模，所以這裡的數字會偏低」——自帶那一段建模之後這句話
 *   從「誠實的免責」變成「錯的」，而它不會自己壞掉、也不會有測試抓到。
 *
 * 現在的事實：接口最多貢獻 4 級（`moduleAddLevel` 恆為 1），而**滿階 S 級甲自帶的
 * 那一顆每部位 2 級、四部位合計就是 8 級 ＝ 上限**（`INNATE_LEVEL_RULE`），
 * 所以在滿階假設下再插同族只會超限。使用者 2026-08-27 講的「整套金 3 時剛好 4 級、
 * 搭配 4 顆就能 8 級」是**過渡期**的配法 —— 站上一律以滿階計（總綱 N3），
 * 那個中間階不在模型內。
 */
function EightLevelNote() {
  return (
    <p className="hud-cut-sm border border-border-subtle bg-bg-dark/40 px-2.5 py-2 text-[12px] leading-relaxed text-text-dim">
      8 級模組共 8 階：四個接口最多貢獻 4 級，其餘來自
      <strong className="text-text-secondary">機甲自己帶的那一顆</strong>（上方「機甲自帶」區）。
      站上一律以<strong className="text-text-secondary">滿階</strong>計算 ——
      滿階 S 級甲自帶的 8 級模組每部位 2 級、合計就已經是 8 級，
      這時接口再插同一族只會超限；A 級甲自帶 2 級（軀幹、腿部各 1，雙臂 0）。
      實際遊戲中機甲品質沒滿時自帶那一段會較低，插同族就補得上來。
    </p>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={`${HUD.labelCjk} text-text-dim mb-1`}>{label}</div>
      <div className="flex flex-col" style={{ gap: 5 }}>{children}</div>
    </div>
  )
}

function SlotRow({ merged, ctx }: { merged: MergedLine; ctx: LoadoutContext }) {
  const { positions, line } = merged
  const { iface, mod, fallbackId, stack, block } = line
  // 合併後左欄要放得下「軀幹、左臂、右臂、腿部」——四個詞折成兩行，欄寬給到 w-16。
  // ⚠ 這一欄**不可 truncate**：它是「這顆裝在哪」的唯一答案，截掉就變成一個看不出範圍的清單。
  const where = positions.map(partLabel).join('、')

  return (
    // ⚠ 這一列**不可點**，所以刻意走 `HUD_READONLY`（暗一階的框、沒有 hover、沒有 `›`）：
    //   它與模組面板那份可點的清單長得很像，而「哪些點得下去」必須第一眼看得出來
    //   （使用者要求 2026-08-27）。要換模組的入口在槽位圖下方的四部位卡。
    <div className={`flex items-start border ${HUD_READONLY}`} style={{ gap: 8, padding: '6px 8px' }}>
      <span className="shrink-0 w-16 flex flex-col leading-tight">
        <span className="text-[13px] text-text-secondary">{where}</span>
        <span className="text-[11px] text-text-dim">{iface}</span>
      </span>
      {/* 縮圖：讓「裝了什麼」不必讀字（C-8）。未裝時留同尺寸的框，列高才一致 */}
      <ModuleIcon mod={mod} size={26} />
      <span className="flex flex-col min-w-0 grow" style={{ gap: 2 }}>
        <span className="flex items-baseline" style={{ gap: 5 }}>
          <span className={`${HUD.bodyStrong} truncate ${mod ? 'text-text-primary' : 'text-text-dim'}`}>
            {mod?.name ?? fallbackId ?? '未裝'}
          </span>
          {stack && (
            <span className={`${HUD.num} text-[11px] shrink-0 ${
              stack.overflow > 0 ? 'text-accent-yellow/90' : 'text-text-dim'
            }`}>
              Lv{stack.level} / {stack.cap}
            </span>
          )}
          {/* 佔了幾格：合併之後「四格都是它」這件事沒有別的地方講得出來 */}
          {positions.length > 1 && (
            <span className={`${HUD.num} text-[10px] text-text-dim shrink-0`}>×{positions.length}</span>
          )}
        </span>
        {fallbackId && !mod && (
          <span className="text-[11px] text-accent-red/80">模組資料已不存在</span>
        )}
        {block && (
          <span className="text-[11px] text-accent-yellow/90 leading-snug">{blockText(block, ctx)}</span>
        )}
        {/* 合併之後**每一族只印一次數值**，「與 X 同族」那句話連同重複的列一起消失 */}
        {mod && !block && <Effect mod={mod} level={stack?.level ?? 0} />}
      </span>
    </div>
  )
}

/**
 * 機甲自帶的一列。
 *
 * ⚠ 左欄印的是**哪幾個部位帶來這一顆**，不是模組類別（改寫前印 `mod.slot`）。
 *   混搭之後「這顆從哪來」才是玩家真正要知道的事 —— 換掉右臂會讓某幾顆掉級或整顆消失，
 *   而那條因果只有部位講得出來。類別退到第二行。
 *
 * ⚠ 未解鎖的**不隱藏**（D-3）：灰掉、不印數值、把條件寫在下面一行。
 *   直接讓它消失的話，玩家換掉一個部位後看到清單少了四顆而畫面沒有任何解釋。
 */
function InnateRow({ line, ctx }: { line: InnateLine; ctx: LoadoutContext }) {
  const { mod, fallbackId, positions, source, level, cap, slotCount, block, gap } = line
  const blocked = !!block

  return (
    <div
      className={`flex items-start border ${HUD_READONLY} ${blocked ? 'opacity-60' : ''}`}
      style={{ gap: 8, padding: '5px 8px' }}
    >
      {/* 四個部位全中時是「軀幹、左臂、右臂、腿部」——與接口那一區同寬、同折行方式 */}
      <span className="shrink-0 w-16 flex flex-col leading-tight">
        <span className="text-[12px] text-text-secondary">
          {positions.length > 0 ? positions.map(partLabel).join('、') : '—'}
        </span>
        {mod && <span className="text-[11px] text-text-dim truncate">{mod.slot}</span>}
      </span>
      <ModuleIcon mod={mod} size={26} className={blocked ? 'opacity-45' : ''} />
      <span className="flex flex-col min-w-0 grow" style={{ gap: 2 }}>
        <span className="flex items-baseline flex-wrap" style={{ gap: 5 }}>
          <span className={`${HUD.body} truncate ${mod && !blocked ? 'text-text-primary' : 'text-text-dim'}`}>
            {mod?.name ?? fallbackId ?? '—'}
          </span>
          {blocked ? (
            <span className="text-[11px] text-text-dim shrink-0">未啟動</span>
          ) : (
            level > 0 && (
              <span className={`${HUD.num} text-[10px] text-text-dim shrink-0`}>
                Lv{level}{cap > 0 ? ` / ${cap}` : ''}
              </span>
            )
          )}
          {/* 這一族同時也插在接口上 ⇒ 上面那個 Lv 不全是自帶的，要講 */}
          {slotCount > 0 && !blocked && (
            <span className="text-[10px] text-text-dim shrink-0">含接口 {slotCount} 格</span>
          )}
          <InnateSourceBadge source={source} className="shrink-0" />
        </span>
        {gap && <span className="text-[11px] text-accent-red/80">{gap}</span>}
        {block && (
          <span className="text-[11px] text-accent-yellow/90 leading-snug">{blockText(block, ctx)}</span>
        )}
        {mod && !blocked && <Effect mod={mod} level={level} />}
      </span>
    </div>
  )
}

/**
 * 一行效果。
 *
 * ⚠ 數值欄位全 0 的模組是**常態而不是缺漏**（實地驗收 2026-08-27 抓到）：
 *   天生模組裡有一批的效果是敘述性的（修理、協調…），它們有 `levels[]`、也有各階敘述，
 *   只是不落在那 30 個數值欄位上。對它們說「各階數值未建檔」是一句**錯話** ——
 *   資料在，只是不是數字。退而印該階的敘述，講不出敘述時才承認不知道。
 */
function Effect({ mod, level }: { mod: Module; level: number }) {
  const stats = moduleStatsAt(mod, level)
  if (Object.keys(stats).length > 0) {
    return <ModuleStatTags stats={stats} variant="plain" className="flex flex-wrap gap-2 text-[12px]" />
  }
  return (
    <span className="text-[11px] text-text-dim line-clamp-2">
      {moduleLevelAt(mod, level)?.description || mod.description || '這一階沒有可彙總的數值'}
    </span>
  )
}
