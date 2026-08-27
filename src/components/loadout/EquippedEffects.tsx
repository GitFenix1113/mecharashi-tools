import { useMemo } from 'react'
import type { Module } from '../../types'
import type { MechPartPosition } from '../../types/enums'
import { MECH_PART_ORDER } from '../../utils/chassisStats'
import { partLabel } from '../../utils/moduleSlots'
import {
  interfaceState, moduleLevelAt, moduleStatsAt, sumModuleStats,
  moduleStacks, moduleFamilyKey, type ModuleStack,
} from '../../utils/moduleRules'
import { ModuleSlot } from '../../types/enums'
import type { LoadoutContext } from '../../utils/loadoutRules'
import { ModuleStatTags } from '../module/ModuleStatTags'
import { ModuleIcon } from '../icons/ModuleIcon'
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
// ⚠ **天生模組一併顯示但不可編輯**（進度表 C-4）：`module4Id` / `module8Id` /
//   `moduleFixedIds` 是機甲自帶的（全庫 260 個引用、零斷鏈），玩家改不了它們，
//   但它們確實在生效。藏起來會讓合計對不上；混進四個接口那一區則會讓玩家
//   以為自己可以換掉它們 —— 所以分兩區、並標明「不可更換」。
//   ⚠ 它們的等級**不走同族堆疊**（那是接口那一段的機制），維持滿級呈現。
//   8 級模組的差額見下方 `EightLevelNote`。

interface SlotLine {
  position: MechPartPosition
  iface: string
  usable: boolean
  mod: Module | null
  /** 查無資料時要印出來的 id（斷鏈要看得見，不是靜默留白） */
  fallbackId?: string
  stack: ModuleStack | null
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

  const stacks = useMemo(
    () => moduleStacks(ctx.modules, (id) => ctx.world.modules.get(id)),
    [ctx.modules, ctx.world.modules],
  )

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
      }
    })
  }, [ctx, chassis, stacks])

  const innate = useMemo(() => {
    if (!mech || !chassis) return []
    const ids = [mech.module4Id, mech.module8Id, ...(mech.moduleFixedIds ?? [])]
      .filter((x): x is string => !!x)
    return ids.map((id, i) => {
      const mod = ctx.world.modules.get(id) ?? null
      return {
        key: `${id}#${i}`,
        where: mod?.slot ?? '機甲自帶',
        mod,
        fallbackId: mod ? undefined : id,
        level: mod ? chassis.moduleLevelOf(id) : 0,
      }
    })
  }, [mech, chassis, ctx.world.modules])

  const equippedCount = slots.filter((l) => l.mod).length
  // 空 Map ＝還沒載入完（見 LoadoutWorld.modules），不是「這台沒有天生模組」
  const loading = ctx.world.modules.size === 0

  /** 合計：接口那段**每族一次**（見檔頭），天生那段逐顆 */
  const total = useMemo(() => sumModuleStats([
    ...[...stacks.values()].map((st) => moduleStatsAt(st.mod, st.level)),
    ...innate.map((l) => (l.mod ? moduleStatsAt(l.mod, l.level) : {})),
  ]), [stacks, innate])

  const wasted = [...stacks.values()].filter((st) => st.overflow > 0)
  const hasEightLevel = [...stacks.values()].some((st) => st.mod.slot === ModuleSlot.SLOT_8)

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
        {merged.map((m) => <SlotRow key={m.key} merged={m} />)}
      </Group>

      {/* 超限提醒（使用者裁決 2026-08-27）—— 提醒而不是擋：裝四顆同族是合法操作，
          只是其中幾顆白費，那是玩家的選擇。不說則會讓他以為自己疊出了 8 級。 */}
      {wasted.map((st) => (
        <p
          key={moduleFamilyKey(st.mod)}
          className="hud-cut-sm border border-accent-yellow/30 bg-accent-yellow/5 px-2.5 py-2 text-[12px] leading-relaxed text-accent-yellow/90"
        >
          ⚠ <strong>{st.mod.name}</strong> 裝了 {st.positions.length} 顆（
          {st.positions.map(partLabel).join('、')}），合計 <strong>{st.sum}</strong> 級，
          但它只有 <strong>{st.cap}</strong> 階 —— 超出的 <strong>{st.overflow}</strong> 級
          <strong>不會生效</strong>。把多的那幾格換成別的模組，等於白拿一份加成。
        </p>
      ))}

      {hasEightLevel && <EightLevelNote />}

      {(innate.length > 0 || loading) && (
        <Group label="機甲自帶 · 不可更換">
          {loading && innate.length === 0
            ? <p className={`${HUD.body} text-text-dim`}>載入模組中…</p>
            : innate.map((l) => (
                <PlainRow
                  key={l.key}
                  where={l.where}
                  mod={l.mod}
                  fallbackId={l.fallbackId}
                  level={l.level}
                />
              ))}
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
                level={l.level || undefined}
                innate
                title={`${l.where}（不可更換）｜${l.mod?.name ?? l.fallbackId ?? '—'}`}
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
 * 8 級模組的差額說明。
 *
 * 8 級模組有 8 階，而四個接口最多只給得出 4 級（`moduleAddLevel` 恆為 1）。
 * 差額來自**機甲自帶的那一顆**（`Mech.module8Id`），它的等級隨機甲品質階走 ——
 * 使用者 2026-08-27 逐字：「一套 S 級甲，整套金 3 的時候，他的 8 級模組會剛好 4 級，
 * 這時候搭配 4 顆 8 級模組就能 8 級」，並指出這是資源有限時的**過渡期選項**。
 *
 * ⚠ 站上**不替機甲自帶那一顆推等級**（需要一整套品質階模型，屬另一份尚未動工的計畫），
 *   所以這裡明講差額在哪，而不是靜默顯示一個只到 4 的數字讓人以為那就是全部。
 */
function EightLevelNote() {
  return (
    <p className="hud-cut-sm border border-border-subtle bg-bg-dark/40 px-2.5 py-2 text-[12px] leading-relaxed text-text-dim">
      8 級模組共 8 階，而四個接口最多貢獻 4 級 —— 另外那 4 級來自
      <strong className="text-text-secondary">機甲自己帶的那一顆 8 級模組</strong>，
      它的等級隨機甲品質階走（S 級甲整套滿階時約 4 級）。
      站上目前<strong className="text-text-secondary">只算接口這一段</strong>，
      機甲那一段還沒建模，所以這裡的數字會偏低。
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

function SlotRow({ merged }: { merged: MergedLine }) {
  const { positions, line } = merged
  const { iface, mod, fallbackId, stack } = line
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
        {/* 合併之後**每一族只印一次數值**，「與 X 同族」那句話連同重複的列一起消失 */}
        {mod && <Effect mod={mod} level={stack?.level ?? 0} />}
      </span>
    </div>
  )
}

function PlainRow({ where, mod, fallbackId, level }: {
  where: string
  mod: Module | null
  fallbackId?: string
  level: number
}) {
  return (
    <div className={`flex items-start border ${HUD_READONLY}`} style={{ gap: 8, padding: '5px 8px' }}>
      <span className="shrink-0 w-11 text-[12px] text-text-secondary leading-tight">{where}</span>
      <ModuleIcon mod={mod} size={26} />
      <span className="flex flex-col min-w-0 grow" style={{ gap: 2 }}>
        <span className="flex items-baseline" style={{ gap: 5 }}>
          <span className={`${HUD.body} truncate ${mod ? 'text-text-primary' : 'text-text-dim'}`}>
            {mod?.name ?? fallbackId ?? '未裝'}
          </span>
          {mod && level > 0 && <span className={`${HUD.num} text-[10px] text-text-dim shrink-0`}>Lv{level}</span>}
        </span>
        {fallbackId && !mod && (
          <span className="text-[11px] text-accent-red/80">模組資料已不存在</span>
        )}
        {mod && <Effect mod={mod} level={level} />}
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
