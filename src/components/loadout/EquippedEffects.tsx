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
import { HUD } from './loadoutTheme'

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
  /** 這一族的第一格嗎。false ＝ 只標「與 X 同族」，不重印數值 */
  primary: boolean
  /** 同族的其他部位（給第二格起的那一行用） */
  sharedWith: string
}

export function EquippedEffects({ ctx }: { ctx: LoadoutContext }) {
  const { mech, chassis } = ctx

  const stacks = useMemo(
    () => moduleStacks(ctx.modules, (id) => ctx.world.modules.get(id)),
    [ctx.modules, ctx.world.modules],
  )

  const slots = useMemo<SlotLine[]>(() => {
    if (!chassis) return []
    const seen = new Set<string>()
    return MECH_PART_ORDER.map((pos) => {
      const id = ctx.modules[pos]
      const mod = id ? ctx.world.modules.get(id) ?? null : null
      const iface = interfaceState(chassis.moduleSlots[pos].iface)
      const stack = mod ? stacks.get(moduleFamilyKey(mod)) ?? null : null
      const key = mod ? moduleFamilyKey(mod) : ''
      const primary = !!mod && !seen.has(key)
      if (mod) seen.add(key)
      return {
        position: pos,
        iface: iface === 'none' ? '無接口' : iface === 'unknown' ? '型別不明' : iface,
        usable: iface !== 'none' && iface !== 'unknown',
        mod,
        fallbackId: id && !mod ? id : undefined,
        stack,
        primary,
        sharedWith: stack
          ? stack.positions.filter((p) => p !== pos).map(partLabel).join('、')
          : '',
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

  if (!mech || !chassis) return null

  return (
    <div className="space-y-2.5">
      <Group label={`模組接口（${equippedCount} / ${slots.length}）`}>
        {slots.map((l) => <SlotRow key={l.position} line={l} />)}
      </Group>

      {/* 超限提醒（使用者裁決 2026-08-27）—— 提醒而不是擋：裝四顆同族是合法操作，
          只是其中幾顆白費，那是玩家的選擇。不說則會讓他以為自己疊出了 8 級。 */}
      {wasted.map((st) => (
        <p
          key={moduleFamilyKey(st.mod)}
          className="hud-cut-sm border border-accent-yellow/30 bg-accent-yellow/5 px-2.5 py-2 text-[11px] leading-relaxed text-accent-yellow/90"
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
          <ModuleStatTags stats={total} variant="chip" className="flex flex-wrap gap-1.5 text-[12px]" />
        ) : (
          <p className={`${HUD.body} text-text-dim`}>
            {loading ? '載入模組中…' : '目前沒有任何模組加成。'}
          </p>
        )}
        {/* 口徑未定的東西寧可不出，也不要出一個玩家會拿去做決定的推測值 */}
        <p className="text-[10px] text-text-dim leading-relaxed mt-1.5">
          同一顆模組裝多格是<strong className="text-text-secondary">疊等級</strong>而不是疊效果，
          所以合計每一族只算一次。此處只列模組本身的加成，不含衍生的戰力／傷害推算（攻擊力口徑未定）。
        </p>
      </div>
    </div>
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
    <p className="hud-cut-sm border border-border-subtle bg-bg-dark/40 px-2.5 py-2 text-[11px] leading-relaxed text-text-dim">
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

function SlotRow({ line }: { line: SlotLine }) {
  const { position, iface, mod, fallbackId, stack, primary, sharedWith } = line

  return (
    <div className="flex items-start bg-bg-dark border border-border-subtle" style={{ gap: 8, padding: '5px 8px' }}>
      <span className="shrink-0 w-11 flex flex-col leading-tight">
        <span className="text-[11px] text-text-secondary">{partLabel(position)}</span>
        <span className="text-[9px] text-text-dim truncate">{iface}</span>
      </span>
      {/* 縮圖：讓「裝了什麼」不必讀字（C-8）。未裝時留同尺寸的框，列高才一致 */}
      <ModuleIcon mod={mod} size={26} />
      <span className="flex flex-col min-w-0 grow" style={{ gap: 2 }}>
        <span className="flex items-baseline" style={{ gap: 5 }}>
          <span className={`${HUD.body} truncate ${mod ? 'text-text-primary' : 'text-text-dim'}`}>
            {mod?.name ?? fallbackId ?? '未裝'}
          </span>
          {stack && (
            <span className={`${HUD.num} text-[10px] shrink-0 ${
              stack.overflow > 0 ? 'text-accent-yellow/90' : 'text-text-dim'
            }`}>
              Lv{stack.level} / {stack.cap}
            </span>
          )}
        </span>
        {fallbackId && !mod && (
          <span className="text-[10px] text-accent-red/80">模組資料已不存在</span>
        )}
        {/* 第二格起不重印數值：同族是疊等級不是疊效果（見檔頭） */}
        {mod && !primary && (
          <span className="text-[10px] text-text-dim">與{sharedWith}同族，合計 Lv{stack?.level}</span>
        )}
        {mod && primary && <Effect mod={mod} level={stack?.level ?? 0} />}
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
    <div className="flex items-start bg-bg-dark border border-border-subtle" style={{ gap: 8, padding: '5px 8px' }}>
      <span className="shrink-0 w-11 text-[11px] text-text-secondary leading-tight">{where}</span>
      <ModuleIcon mod={mod} size={26} />
      <span className="flex flex-col min-w-0 grow" style={{ gap: 2 }}>
        <span className="flex items-baseline" style={{ gap: 5 }}>
          <span className={`${HUD.body} truncate ${mod ? 'text-text-primary' : 'text-text-dim'}`}>
            {mod?.name ?? fallbackId ?? '未裝'}
          </span>
          {mod && level > 0 && <span className={`${HUD.num} text-[10px] text-text-dim shrink-0`}>Lv{level}</span>}
        </span>
        {fallbackId && !mod && (
          <span className="text-[10px] text-accent-red/80">模組資料已不存在</span>
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
    return <ModuleStatTags stats={stats} variant="plain" className="flex flex-wrap gap-2 text-[11px]" />
  }
  return (
    <span className="text-[10px] text-text-dim line-clamp-2">
      {moduleLevelAt(mod, level)?.description || mod.description || '這一階沒有可彙總的數值'}
    </span>
  )
}
