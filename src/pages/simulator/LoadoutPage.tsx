import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Backpack, Mech, Pilot, UserBuild, Weapon } from '../../types'
import type { LoadoutDraft } from '../../types/loadout'
import type { ModuleSlotRef, SlotKey, WeaponSlotRef } from '../../types/slots'
import { slotKey } from '../../types/slots'
import { WeaponEquipSlot, WeaponType } from '../../types/enums'
import type { MechPartPosition } from '../../types/enums'
import { useLoadoutGameData, type LoadoutStage } from '../../hooks/useFirestore'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useLayoutBreakpoint } from '../../hooks/useLayoutBreakpoint'
import { equipSetKeys, equipSetLabel, hasIndependentLoadouts, DEFAULT_EQUIP_SET_KEY } from '../../utils/forms'
import { slotLabel } from '../../utils/mechSlots'
// ⏸ 部件混搭未開放前，四部位表暫時下架（見下方 JSX 內註解）。模組槽已於 052-G Phase C 開放
// import { MechPartsTable } from '../../components/mechs/MechSlotPanel'
import { PilotIcon } from '../../components/icons/PilotIcon'
import { LoadoutRig } from '../../components/loadout/LoadoutRig'
import { OutputBar } from '../../components/loadout/OutputBar'
import { PickerShell } from '../../components/loadout/PickerShell'
// ⏸ 攻擊力口徑未定，「裝配武器」面板暫時下架（見 infoPanel 內註解）
// import { EquippedStats } from '../../components/loadout/EquippedStats'
// ⏸ 「配裝概況」面板已下架（見下方 infoPanel 的註解）；LoadoutSummary.tsx 本體保留備用
// import { LoadoutSummary } from '../../components/loadout/LoadoutSummary'
import { PilotIdentityCard } from '../../components/loadout/PilotIdentityCard'
import { WeaponComponentList } from '../../components/loadout/WeaponComponentList'
import { weaponRows } from '../../utils/loadoutRows'
import { ComponentPanel } from '../../components/loadout/ComponentPanel'
import { ModulePanel } from '../../components/loadout/ModulePanel'
import { EquippedEffects } from '../../components/loadout/EquippedEffects'
import { LoadoutExportRunner } from '../../components/loadout/LoadoutExportCard'
import { sanitizeLoadoutName, LOADOUT_NAME_MAX } from '../../utils/loadoutName'
import { NdPowerBar } from '../../components/common/NdPowerBar'
import { buildNdAbilityMap } from '../../utils/neuralDriveAbilities'
import { defaultNdLevels, ndAffectZones } from '../../utils/ndOverrides'
import { HUD, HUD_PANEL } from '../../components/loadout/loadoutTheme'
import { CLASS_CONFIG } from '../../components/badges/PilotBadges'
import { mechSlotCapacity } from '../../utils/mechSlots'
import { licenseAllows } from '../../utils/normalizeArmorType'
import type { PickerFilterGroup } from '../../components/loadout/PickerShell'
import { CascadeToast } from '../../components/loadout/CascadeToast'
import { PasteCodeDialog } from '../../components/loadout/PasteCodeDialog'
import { LocalShelfDialog } from '../../components/loadout/LocalShelfDialog'
import { readShelf, SHELF_LIMIT } from '../../lib/localBuilds'
import { buildShareIndex } from '../../utils/loadoutCode/shareId'
import { shareIdAliases } from '../../utils/loadoutCode/shareIdRegistry'
import { encodeLoadout, decodeLoadout, type ShareIndexes } from '../../utils/loadoutCode/codec'
import { readShareCode, buildShareUrl, staleCacheKeys } from '../../utils/loadoutCode/shareLink'
import { useGameData } from '../../contexts/GameDataContext'
import { usePatchVersions } from '../../hooks/usePatchVersions'
import { WORKER_ENABLED, getWorkerDataVersions } from '../../lib/api/workerData'
import { getDataVersions } from '../../lib/api/versions'
import type { PickerRowItem } from '../../components/loadout/RejectionRow'
import { BACKPACK_TYPE_CONFIG } from '../../components/badges/BackpackBadges'
import {
  backpackChoices, buildContext, buildWorld, canSelectMech, loadoutBudget, mountRefFor, slotsOverlap,
  slotHasCandidates, slotOccupant, weaponChoices, type PickerEntry, type ResolutionAction,
} from '../../utils/loadoutRules'
import { INITIAL_SIM_STATE, simReduce, type LoadoutAction, type SimState } from './simReducer'

// ─── 配裝模擬器（PLAN-052-B）─────────────────────────────────────────────────
//
// 取代 8 步驟精靈的整頁改版。舊頁的病根不是哪一步做得不好，而是互動模型錯了：
// 配裝是「反覆試」的動作，每試一次走 8 步，沒有人會用第二次。
//
// 這一頁只有一個模型：**一眼看到全部槽位 → 點槽位換裝備 → 即時看重量／出力**。
//
// ⚠ 兩個正交的響應式軸（決策一），不要合併：
//     版面欄數  ← `useLayoutBreakpoint()`（視窗寬）
//     互動方式  ← `useIsMobile()`（粗指標）—— 決定就地面板 vs BottomSheet、有無 hover 預覽

/** 草稿暫存鍵。**只存一份**「現在正在配的這套」，書架是 052-C 的事。 */
const DRAFT_CACHE_KEY = 'mecharashi_loadout_draft'

function readDraftCache(): LoadoutDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LoadoutDraft
    // 只做最低限度的形狀檢查；真正的合法性由 reconcile 統一負責
    return parsed && typeof parsed === 'object' && parsed.sets ? parsed : null
  } catch {
    return null   // 隱私模式／配額用盡／格式改過 —— 一律當作沒有草稿，不要讓整頁掛掉
  }
}

function writeDraftCache(draft: LoadoutDraft) {
  try { localStorage.setItem(DRAFT_CACHE_KEY, JSON.stringify(draft)) } catch { /* 寫不進去就算了 */ }
}

/**
 * 把 ProfilePage 傳進來的**舊格式**存檔轉成草稿。
 *
 * 舊 `Build` 只有一把武器（`weaponId`），沒有槽位概念 —— 槽位由武器自己的 `equipSlot` 決定。
 * 轉不出來的部分（改裝、元件、科研）一律丟棄：那些在本版都不渲染（決策四），
 * 留著只會變成一份沒有任何東西讀得到的殘影。
 */
function legacyBuildToDraft(build: UserBuild, weapons: ReadonlyMap<string, Weapon>): LoadoutDraft {
  const w = build.weaponId ? weapons.get(build.weaponId) : undefined
  const slot = (w?.equipSlot ?? WeaponEquipSlot.SINGLE_HAND) as WeaponSlotRef['slot']
  return {
    pilotId: build.pilotId || undefined,
    mechId: build.mechId || undefined,
    activeSetKey: DEFAULT_EQUIP_SET_KEY,
    sets: {
      [DEFAULT_EQUIP_SET_KEY]: {
        mounts: w
          ? [{
              weaponId: w.id,
              bank: 'main' as const,
              slot,
              side: slot === WeaponEquipSlot.SINGLE_HAND || slot === WeaponEquipSlot.SHOULDER ? ('left' as const) : undefined,
            }]
          : [],
        ...(build.backpackId ? { backpackId: build.backpackId } : {}),
      },
    },
  }
}

/**
 * 把網址上的分享碼解成草稿。**解不開時回 `undefined` 而不是丟例外** ——
 * 一個壞連結讓整頁白畫面，比看到空的模擬器更糟。
 *
 * ⚠ 解得開但有查不到的裝備時**照樣套用**（決策四）：對方可能在分享改版前的配裝，
 *   而「少一把武器」遠好過「整套都不給你看」。差別由 `notice` 說出來。
 */
function decodeShared(code: string, indexes: ShareIndexes): { draft?: LoadoutDraft; notice?: string } {
  const res = decodeLoadout(code, indexes)
  if (!res.ok) return { notice: res.message }
  const n = res.unresolved.length
  return {
    draft: res.draft,
    notice: n > 0 ? `這套配裝裡有 ${n} 項裝備在站上查不到，那幾格是空的。若這是剛上線的裝備，重新整理頁面（Ctrl+F5）後再試一次。` : undefined,
  }
}

type ActivePicker =
  | { kind: 'pilot' }
  | { kind: 'mech' }
  | { kind: 'weapon'; ref: WeaponSlotRef }
  | { kind: 'backpack' }
  | null

export default function LoadoutPage() {
  const location = useLocation()
  const bp = useLayoutBreakpoint()
  const isMobile = useIsMobile()

  // 挑選器狀態先於狀態機宣告：send() 會順手清掉 hover 預覽
  const [picker, setPickerRaw] = useState<ActivePicker>(null)
  /**
   * 右欄鑽進元件面板的那一列（存 `SlotKey` 而不是整個 row 物件）。
   *
   * ⚠ 存 key 不存快照：武器被級聯移除、或被另一把取代時，快照會留在畫面上變成
   *   一份指向已不存在裝備的面板。存 key 則每次 render 重新查 —— 查不到就自動退回清單。
   */
  const [openRowKey, setOpenRowKey] = useState<SlotKey | null>(null)

  /**
   * 右欄鑽進模組面板的那個接口（PLAN-052-G C-3）。
   *
   * ⚠ 存**部位**而不是整個 ref 物件：部位是四個固定值，而 ref 每次重建都是新參考，
   *   放進 state 會讓每一次 render 都觸發下游 memo 重算。也與 `openRowKey` 存 key
   *   不存快照同一條理由 —— 機甲換掉時這個部位一樣還在，面板自己會重新查。
   */
  const [openModulePos, setOpenModulePos] = useState<MechPartPosition | null>(null)

  // ── 匯出配裝圖（PLAN-052-I E-3）──
  //    `exporting` 為真時才掛載離屏版面；失敗一定要說出來（按了沒反應是最糟的回饋）
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const finishExport = useCallback((err: Error | null) => {
    setExporting(false)
    setExportError(err ? err.message : null)
  }, [])

  /** 開挑選器時一律收起元件面板：兩者同住右欄，疊在一起會讓「返回」變成回到哪裡都說不準 */
  const setPicker = useCallback((next: ActivePicker) => {
    setPickerRaw(next)
    if (next) setOpenRowKey(null)
  }, [])
  const [hovered, setHovered] = useState<{ slot: SlotKey; weight: number; name: string; icon?: string } | null>(null)
  const [hoverSegment, setHoverSegment] = useState<string | null>(null)

  // ⚠ 用 `useState` + 一支綁住 world 的 `send()`，**不是** `useReducer` ——
  //   reducer 需要 world，而 world 又要由 draft 決定載入到哪個階段。用 ref 打斷循環會在
  //   render 期間讀 ref（eslint `react-hooks/refs` 會擋，而且理由是對的）；
  //   把 world 綁進 send 的 closure 則自然正確：dispatch 一律發生在 render 之後的事件裡。
  const [state, setState] = useState<SimState>(INITIAL_SIM_STATE)

  // 有待還原的草稿時直接跳到最終階段：reconcile 會把「查不到資料的裝備」掃掉，
  // 在武器還沒載入時還原，等於把整套配裝洗掉 —— 而且沒有任何錯誤訊息
  const [pending, setPending] = useState<{ draft?: LoadoutDraft; legacy?: UserBuild; code?: string } | null>(() => {
    // ⚠ 順序就是優先權，不要調換：**網址上的分享碼永遠贏過本機草稿**。
    //   點開別人連結的人，要的是那一套；把他自己上次配到一半的東西端出來，
    //   會讓「連結壞掉了」變成最合理的解讀。
    const shared = readShareCode(window.location.search)
    if (shared) return { code: shared }
    const incoming = (location.state as { build?: UserBuild } | null)?.build
    if (incoming) return { legacy: incoming }
    const cached = readDraftCache()
    return cached ? { draft: cached } : null
  })

  /** 分享碼送進來的東西解不開時要說出來（那幾格會是空的）。 */
  const [shareNotice, setShareNotice] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)

  // ── 本機書架（PLAN-052-C D-1）──
  //    筆數留在這一層，抬頭那顆鍵才印得出 `3/10`；對話框改動後回報上來。
  //    ⚠ 初值用 lazy initializer：`readShelf()` 每次 render 都跑一次是白讀 localStorage。
  const [shelfOpen, setShelfOpen] = useState(false)
  const [shelfCount, setShelfCount] = useState(() => readShelf().length)

  // ⚠ **兩個對話框一開就跳到 equip 階段**：它們都要「整個宇宙」才說得出真話。
  //   只載了 pilots 的時候，任何代碼裡的機甲與武器都會被判成「站上查不到」——
  //   而那是最嚇人的一種誤報：使用者打開書架，看到自己十套存檔全部標成失效。
  const stage: LoadoutStage =
    pending || pasteOpen || shelfOpen ? 'equip'
    : !state.draft.pilotId ? 'pilot'
    : !state.draft.mechId ? 'mech'
    : 'equip'

  const { data, loading } = useLoadoutGameData(stage)
  // 分享碼 header 的 GAMEVER 欄位。**與匯出圖用同一個來源**——各取各的必然漂移，
  // 而漂移的症狀是同一套配裝的圖與代碼標著不同版本。這支有靜態 fallback 且模組層快取，
  // 不會擋住畫面，代價是每個 session 多一次小集合請求。
  const { data: patchVersions } = usePatchVersions()
  const { reload: reloadGameData } = useGameData()
  const world = useMemo(() => buildWorld(data), [data])

  /**
   * 分享碼的六個索引。
   *
   * ⚠ **`module` 也曾經是空索引**，一路空到 PLAN-052-G A-1 —— 而空陣列的意思不是
   *   「沒有別名」而是「這個集合根本沒進來」：`buildShareIndex()` 的迴圈一次都不跑，
   *   別名參數補的是「推導不出號碼」的缺口（41 筆 `mod_40xx_2` 第二型靠它），
   *   補不了一個空的來源。A-1 把「加集合」與「接索引」在同一個 commit 做完，
   *   正是因為兩者分開做過一次、而後半漏了三個 Phase（見下一段）。
   *
   * ⚠ **`component` 曾經是空索引，而那一行漏改了整整三個 Phase**（PLAN-052-D D-4 實地驗收抓到）。
   *   A-3 已把 `components` 加進 equip 階段，但這裡仍寫著 `[]`，於是：
   *   encode 時 `toShareId()` 回 null ⇒ **元件被靜默濾掉，分享碼裡根本沒有它們**；
   *   decode 時 `toDocId()` 回 null ⇒ 元件進 `unresolved` 被丟掉。
   *   玩家配好元件、複製連結、貼給別人，對方收到的是一套沒有元件的配裝 ——
   *   而兩邊的畫面都不會說任何話。單元測試抓不到這種事：codec 的測試自己建含元件的索引，
   *   壞掉的是**頁面這一層的接線**。
   *
   * ⚠ 時序上安全：`stage` 在有 `pending`（分享碼／書架／舊存檔）時直接跳 `equip`，
   *   而還原那一段的守衛是 `if (pending && !loading)` —— `loading` 為 false 就代表
   *   equip 階段的每個集合（含 components 與 modules）都到齊了。
   */
  const shareIndexes = useMemo<ShareIndexes>(() => ({
    pilot:     buildShareIndex('pilot',     data.pilots.map((x) => x.id)),
    mech:      buildShareIndex('mech',      data.mechs.map((x) => x.id)),
    weapon:    buildShareIndex('weapon',    data.weapons.map((x) => x.id)),
    backpack:  buildShareIndex('backpack',  data.backpacks.map((x) => x.id)),
    component: buildShareIndex('component', data.components.map((x) => x.id)),
    module:    buildShareIndex('module',    data.modules.map((x) => x.id), shareIdAliases('module')),
  }), [data])

  const send = useCallback((a: LoadoutAction) => {
    setState((s) => simReduce(s, a, world))
    setHovered(null)
  }, [world])

  // 還原：資料齊了就在 render 期間併進 state（React 官方的「render 期間調整 state」模式 ——
  // 同一次 render 內立即重跑，不會多畫一幀，也不必用 effect 製造串聯渲染）。
  if (pending && !loading) {
    let draft = pending.legacy ? legacyBuildToDraft(pending.legacy, world.weapons) : pending.draft
    if (pending.code) {
      const res = decodeShared(pending.code, shareIndexes)
      draft = res.draft
      if (res.notice) setShareNotice(res.notice)
    }
    setPending(null)
    if (draft) setState((s) => simReduce(s, { type: 'loadDraft', draft }, world))
  }
  const restored = pending === null

  // 草稿暫存是**外部系統**（localStorage），所以這一支是 effect 的正當用途。
  // 還原完成前不寫：否則會用初始空草稿蓋掉使用者上次留下的那一份。
  useEffect(() => { if (restored) writeDraftCache(state.draft) }, [state.draft, restored])

  // ── 分頁鍵：一律取自 equipSetKeys()（形態分頁 UI 在 052-F，本版固定用第一個） ──
  const setKeys = useMemo(
    () => (state.draft.pilotId ? equipSetKeys(state.draft.pilotId, data.forms) : [DEFAULT_EQUIP_SET_KEY]),
    [state.draft.pilotId, data.forms],
  )
  const activeKey = setKeys.includes(state.draft.activeSetKey) ? state.draft.activeSetKey : setKeys[0]
  const ctx = useMemo(() => buildContext(state.draft, activeKey, world), [state.draft, activeKey, world])
  const budget = useMemo(() => loadoutBudget(ctx), [ctx])

  // ── 挑選器 ──
  // 沒有機師／機甲時，情境欄自動停在該選的那一步 —— 不必先點一下才知道要從哪裡開始。
  // 包 useMemo 是因為它會進到下面幾支 useMemo 的依賴：每次 render 產生新物件會讓清單白算一次
  //
  // ⚠ **對話框開著時一律不開挑選器**（D-1 瀏覽器實測）：還沒選機師的人一進頁面，
  //   挑選器就自動開著；手機版它是 BottomSheet，會整片蓋在書架／貼碼對話框上面
  //   —— 而那正是新訪客最可能先按書架的時機。「自動停在該選的那一步」在對話框開著時
  //   本來就不成立：現在該做的是那個對話框裡的事。`picker` 本身不清掉，關掉就回來。
  const effectivePicker = useMemo<ActivePicker>(
    () => (pasteOpen || shelfOpen
      ? null
      : picker ?? (!state.draft.pilotId ? { kind: 'pilot' } : !state.draft.mechId ? { kind: 'mech' } : null)),
    [picker, pasteOpen, shelfOpen, state.draft.pilotId, state.draft.mechId],
  )

  // 複製的成功回饋是按鈕文字換成「已複製連結」，兩秒後換回來 ——
  // 不換回來的話，下一次按下去就沒有任何回饋了
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(t)
  }, [copied])

  const closePicker = useCallback(() => { setPickerRaw(null); setHovered(null) }, [])

  const openSlot = useCallback((ref: WeaponSlotRef) => {
    setHovered(null)
    // 背槽同時是背包的位置。預設開哪一邊依現狀而定 —— 已裝背包、
    // 或這台機甲／這個形態根本沒有背部武器可選時，直接開背包清單。
    // 兩邊都有 [改選…] 切換鍵，不會把任一邊鎖死。
    if (ref.slot === WeaponEquipSlot.BACK && (ctx.backpack || !slotHasCandidates(ctx, ref))) {
      setPicker({ kind: 'backpack' })
    } else {
      setPicker({ kind: 'weapon', ref })
    }
  }, [ctx, setPicker])

  const clearSlot = useCallback((ref: WeaponSlotRef) => {
    const occ = slotOccupant(ctx, ref)
    send(occ.kind === 'backpack' ? { type: 'unequipBackpack' } : { type: 'unequip', ref })
  }, [ctx, send])

  const resolve = useCallback((action: ResolutionAction) => send(action), [send])

  /**
   * 開某一格武器的元件面板（PLAN-052-D）。槽位圖的 ⚙ 徽章與右欄武器列共用這一支。
   *
   * ⚠ 由 `ref` 反查 `weaponRows()` 的那一列而不是直接 `slotKey(ref)`：
   *   雙手武器的列鍵是 `dualHand`，而槽位圖給的是它蓋住的兩格之一（`singleHand`）——
   *   直接當鍵用會查無此列，症狀是「按了 ⚙ 什麼都沒發生」。
   */
  const openComponents = useCallback((ref: WeaponSlotRef) => {
    const row = weaponRows(ctx).find((r) => slotsOverlap(r.ref, ref))
    if (!row) return
    setPicker(null)
    setOpenRowKey(row.rowKey)
    setOpenModulePos(null)
  }, [ctx, setPicker])

  /**
   * 開某個接口的模組面板（PLAN-052-G C-3）。四部位卡整卡可點，共用這一支。
   *
   * ⚠ 進來時把挑選器與元件面板都關掉：右欄是**一欄多種內容的切換鏈**，
   *   同時開兩種會讓返回鍵不知道要退回哪一層。
   */
  const openModule = useCallback((ref: ModuleSlotRef) => {
    setPicker(null)
    setOpenRowKey(null)
    setOpenModulePos(ref.position)
  }, [setPicker])

  // ── 挑選器清單 ──
  const pilotEntries = useMemo<PickerEntry<Pilot>[]>(
    () => data.pilots.map((p) => ({ item: p, rejection: null })),
    [data.pilots],
  )
  const mechEntries = useMemo<PickerEntry<Mech>[]>(
    () => data.mechs
      .map((m) => ({ item: m, rejection: canSelectMech(ctx.pilot, m) }))
      .sort((a, b) => (a.rejection ? 1 : 0) - (b.rejection ? 1 : 0)),
    [data.mechs, ctx.pilot],
  )
  const weaponEntries = useMemo<PickerEntry<Weapon>[]>(
    () => (effectivePicker?.kind === 'weapon' ? weaponChoices(ctx, effectivePicker.ref) : []),
    [ctx, effectivePicker],
  )
  const backpackEntries = useMemo<PickerEntry<Backpack>[]>(
    () => (effectivePicker?.kind === 'backpack' ? backpackChoices(ctx) : []),
    [ctx, effectivePicker],
  )

  // hover 預覽的假想預算（半透明新分段）。粗指標裝置不做 hover 預覽（決策一）
  const previewBudget = useMemo(() => {
    if (!hovered) return null
    const ref = effectivePicker?.kind === 'weapon' ? effectivePicker.ref
      : effectivePicker?.kind === 'backpack' ? ({ bank: 'main', slot: WeaponEquipSlot.BACK } as WeaponSlotRef)
      : null
    if (!ref) return null
    return loadoutBudget(ctx, { add: { ref, weight: hovered.weight } })
  }, [hovered, ctx, effectivePicker])

  const showBanner = state.draft.pilotId ? hasIndependentLoadouts(state.draft.pilotId, data.forms) : false
  const compactRig = bp === 'narrow'

  // ── 版面：三欄／兩欄／單欄 ──
  //
  // ⚠ **彈性欄從挑選器換到槽位圖**（PLAN-052-I B-2）。槽位圖現在是
  //   「左節點 ／ 機甲 ／ 右節點」三個區塊橫排，原本的 400px 固定欄扣掉中央機甲之後
  //   每欄只剩 ~80px，武器名與重量全被截掉，整張圖退化成一排看不懂的圖示。
  //   挑選器反過來是一份清單，寬度給固定的 360px 就夠；把 1fr 讓給槽位圖，
  //   視窗越寬機甲 HUD 越舒展，而不是把空間浪費在一份清單的右側留白上。
  //   （槽位圖自己還會量容器寬度切換窄版，見 LoadoutRig 的 DENSE_MAX_WIDTH。）
  //
  // ⚠ PLAN-052-I C-1 起是**三塊**：機師身分卡（左，含配裝概況）／槽位 HUD（中，1fr）／
  //   挑選器（右，固定 380px）。順序刻意照設計畫布——機師在左、機甲在中，
  //   與玩家腦中的「誰開這台」一致。兩欄版把機師卡疊在槽位圖上方（同一欄）。
  const gridClass =
    bp === 'wide' ? 'grid grid-cols-[340px_minmax(0,1fr)_380px] gap-4 items-start'
    : bp === 'medium' ? 'grid grid-cols-[minmax(0,1fr)_380px] gap-4 items-start'
    : 'flex flex-col gap-4'

  const budgetLine = (
    <OutputBar budget={previewBudget ?? budget} compact onHoverSegment={setHoverSegment} />
  )

  // ── 右欄的元件面板：由 key 反查目前的列（查不到＝那把武器已不在了 → 自動退回清單）──
  const openRow = useMemo(
    () => (openRowKey && ctx.mech ? weaponRows(ctx).find((r) => r.rowKey === openRowKey) ?? null : null),
    [openRowKey, ctx],
  )

  /**
   * 右欄的模組面板要對著哪一格（PLAN-052-G C-3）。
   * 機甲沒了就自動退回清單 —— 接口是機甲的，同 `openRow` 的處置。
   */
  const openModuleRef = useMemo<ModuleSlotRef | null>(
    () => (openModulePos && ctx.chassis ? { kind: 'module', position: openModulePos } : null),
    [openModulePos, ctx.chassis],
  )

  // ── 三顆動作鍵。單欄版面時整組搬到底部固定列，其餘版面留在 sticky 抬頭右側（F-1）──
  //
  //    ⚠ **沒有「存進書架」**：那是 052-C，還沒有實作。計畫書 F-1 把它與匯出並列，
  //      但渲染一顆按下去沒反應的按鈕比少一顆更糟（決策四：不渲染，不是渲染空的）。
  // ── 分享（PLAN-052-C C-1）──
  //
  //    ⚠ **只給「複製分享連結」，不給裸碼。** base64url 含 `_`，而 Discord 的 `_斜體_`
  //      語法會把裸碼中間的底線吃掉，對方複製到的是一串看起來正常、實際解不開的碼。
  //      網址會被當成連結、不套用 markdown，因此是安全的。
  const gameVersion = useMemo(() => patchVersions.find((v) => v.isTwCurrent)?.version, [patchVersions])

  /**
   * 把手上這一套編成分享碼。**編不出來回 `null` 而不是往外丟**——
   * `encodeLoadout` 對呼叫端的 bug 一律 throw（超出上限、認不得的槽位），
   * 而這兩個呼叫點（複製連結、匯出圖）都寧可少一個東西，也不要整頁掛掉。
   */
  //
  // ⚠ **資料沒載齊就不編**（`loading`）：`toShareId()` 查不到的東西會被編成 0（空格），
  //   所以在「機甲已載入、武器還沒」的那個瞬間編出來的碼，會是一套沒有武器的配裝——
  //   而它看起來完全正常，貼給別人也解得開。呼叫端一律連 `loading` 一起擋。
  const encodeCurrent = useCallback((): string | null => {
    try {
      return encodeLoadout(state.draft, { indexes: shareIndexes, gameVersion })
    } catch (err) {
      console.error('[Loadout] encode error:', err)
      return null
    }
  }, [state.draft, shareIndexes, gameVersion])

  /** 把任一串代碼變成連結並放進剪貼簿。書架的每張卡也走這一支 —— 兩處給的必須是同一種東西。 */
  const copyLinkFor = useCallback(async (code: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(buildShareUrl(code, window.location.origin, import.meta.env.BASE_URL))
      return true
    } catch {
      // 剪貼簿在非安全來源（http）與部分行動瀏覽器會直接拒絕
      return false
    }
  }, [])

  const copyShareLink = useCallback(async () => {
    const code = encodeCurrent()
    setCopied(code && await copyLinkFor(code) ? 'ok' : 'fail')
  }, [encodeCurrent, copyLinkFor])

  // 匯出圖右下角的分享碼（E-1）。**只在真的要拍照時才編**：平常沒人看它，
  // 而每次改一格配裝就重編一次是白工。編不出來時傳 undefined ⇒ 那一欄整個不印
  // （元件的約定），因為印一串解不開的碼會有人拿去貼。
  const exportShareCode = useMemo(
    () => (exporting ? encodeCurrent() ?? undefined : undefined),
    [exporting, encodeCurrent],
  )

  /**
   * 本機遊戲資料是否落後於伺服器（決策四的舊快取防護）。
   * 只在貼碼有解不開的東西時才被呼叫 —— 沒事不多打這一次請求。
   */
  const checkStale = useCallback(async () => {
    const server = await (WORKER_ENABLED ? getWorkerDataVersions() : getDataVersions())
    return staleCacheKeys(server, ['pilots', 'mechs', 'weapons', 'backpacks', 'forms']).length > 0
  }, [])

  const pasteButton = (
    <button
      type="button"
      onClick={() => setPasteOpen(true)}
      className="hud-cut-sm text-[12px] px-2.5 py-1.5 border border-border text-text-secondary hover:text-text-primary hover:border-border-accent transition-colors cursor-pointer whitespace-nowrap"
    >
      {/* ⚠ 窄版用短標籤：這一列在 390px 上是「名稱欄 ＋ 貼碼 ＋ 書架」三件，
          長標籤會把輸入框壓到只剩幾十像素（同 C-1 對底部固定列的量測） */}
      {bp === 'narrow' ? '貼碼' : '貼上分享碼'}
    </button>
  )

  const shelfButton = (
    <button
      type="button"
      onClick={() => setShelfOpen(true)}
      className="hud-cut-sm text-[12px] px-2.5 py-1.5 border border-border text-text-secondary hover:text-text-primary hover:border-border-accent transition-colors cursor-pointer whitespace-nowrap"
    >
      書架
      <span className="ml-1.5 font-[JetBrains_Mono,monospace] tabular-nums text-text-dim">
        {shelfCount}/{SHELF_LIMIT}
      </span>
    </button>
  )

  const actionButtons = (
    <>
      <button
        type="button"
        onClick={copyShareLink}
        disabled={!ctx.mech || loading}
        className="hud-cut-sm text-[12px] px-2.5 py-1.5 border border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
      >
        {/* ⚠ 窄版用短標籤：底部固定列在超重時會有四顆（＋「自動卸至符合」），
            實測 390px ＋「大」字級下四顆只剩 8px 餘裕，換成短標籤後有 32px。
            「複製連結」仍然講得出重點——這顆給的是連結不是裸碼。 */}
        {copied === 'ok' ? '已複製連結' : bp === 'narrow' ? '複製連結' : '複製分享連結'}
      </button>
      <button
        type="button"
        onClick={() => { setExportError(null); setExporting(true) }}
        disabled={!ctx.mech || exporting || loading}
        className="hud-cut-sm text-[12px] px-2.5 py-1.5 border border-accent-orange/50 bg-accent-orange/10 text-accent-orange hover:bg-accent-orange/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {exporting ? '產生中…' : '匯出配裝圖'}
      </button>
      {budget.over && (
        <button
          type="button"
          onClick={() => send({ type: 'autoUnloadToFit' })}
          className="hud-cut-sm text-[12px] px-2.5 py-1.5 border border-accent-red/40 text-accent-red hover:bg-accent-red/10 transition-colors cursor-pointer"
        >
          自動卸至符合
        </button>
      )}
      <button
        type="button"
        onClick={() => send({ type: 'clearSet' })}
        disabled={!ctx.mech}
        className="hud-cut-sm text-[12px] px-2.5 py-1.5 border border-border text-text-secondary hover:text-text-primary hover:border-border-accent transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        清空
      </button>
    </>
  )

  // ── 神經驅動算力面板（PLAN-052-I D-1）──
  //
  // ⚠ **讀取時才把預設值疊上去**，不在選機師時寫死一份進 draft：`defaultNdLevels()` 會依
  //   該機師的 buffUpgrades 決定給 Lv1 還是滿級，把它的輸出落盤等於複製一份會過期的規則。
  //   `draft.ndLevels` 因此只存「玩家真的動過的分區」，其餘一律回落預設（含資料改版後
  //   新增的分區 —— 舊分享碼沒有那一鍵，疊上去就自動有了合理值）。
  const ndAbilityMap = useMemo(() => buildNdAbilityMap(data.neuralDriveAbilities), [data.neuralDriveAbilities])
  const ndLevels = useMemo(
    () => ({
      ...defaultNdLevels(ctx.pilot?.neuralDrive, (aid) => ndAbilityMap.get(aid)),
      ...state.draft.ndLevels,
    }),
    [ctx.pilot, ndAbilityMap, state.draft.ndLevels],
  )
  const ndZones = useMemo(
    () => ndAffectZones(ctx.pilot, (aid) => ndAbilityMap.get(aid)),
    [ctx.pilot, ndAbilityMap],
  )

  const ndPanel = !ctx.pilot?.neuralDrive?.length ? null : (
    <Panel
      title="神經驅動算力"
      // 沒有任何 ★ 分區時不印圖例：一句解釋畫面上不存在的符號，只會讓人回頭找那顆星
      titleExtra={ndZones.size > 0
        ? <span className={`${HUD.body} text-text-dim truncate`}>★ 的分區會改寫敘述</span>
        : undefined}
    >
      <NdPowerBar
        layout="panel"
        drives={ctx.pilot.neuralDrive}
        levels={ndLevels}
        affectZones={ndZones}
        abilityMap={ndAbilityMap}
        onChange={(levels) => send({ type: 'setNdLevels', levels })}
      />
    </Panel>
  )

  // ⏸ 「配裝概況」面板下架（PLAN-052-I，使用者驗收指示）。
  //
  //    它只剩兩個數字，而兩個都已經被別處答掉或答不準：
  //      · 已用槽位 —— D-3 的武器列抬頭寫了「共 N 把」，匯出圖寫了「N 個槽位 · 已裝 M」，
  //                    槽位圖本身更是一眼可數。第三個地方再講一次只會多一份要對帳的數字。
  //      · 平均射程 —— 把不同用途的武器射程平均起來，得到的是一個沒有人會據以決策的數。
  //                    要比射程的人比的是「這一把」，不是全套的算術平均。
  //
  //    `LoadoutSummary.tsx` 本體保留：等傷害模擬（總綱）把「情境有效值」定義出來之後，
  //    這一欄要放的是那種真的答得出問題的彙總，而不是現在這兩個。
  //
  // const infoPanel = !ctx.mech ? null : (
  //   <div className="space-y-3">
  //     <Panel title="配裝概況"><LoadoutSummary ctx={ctx} /></Panel>
  //   </div>
  // )
  //
  // ⏸ 「裝配武器」面板同樣下架（更早）：攻擊力口徑未定（DB 值＝全部連擊總和，官方卡片＝每擊值，
  //    兩者差額 17.3–18.6% 且逐把不同），在傷害模擬計畫釐清前不對外露出任何攻擊數值。
  //    EquippedStats.tsx 本體保留備用，屆時連同元件槽一起復原。
  //
  // 六維屬性面板已移除（不保留）：機師六維是滿級固定值、不隨配裝變動，要看六維去機師詳情頁。

  return (
    <div
      className="max-w-[1600px] mx-auto px-3 sm:px-4 py-4"
      // 單欄版面底部有兩層固定列（本頁操作列 ＋ Layout 的手機 Tab Bar），
      // 內容要讓開，否則最後一個面板永遠被蓋住一半
      style={bp === 'narrow' ? { paddingBottom: 'calc(3.25rem + env(safe-area-inset-bottom))' } : undefined}
    >
      <header className="mb-3">
        <div className={`${HUD.label} text-accent-orange`}>Loadout Simulator</div>
        <h1 className={`${HUD.sectionTitle} text-text-primary`}>配裝模擬器</h1>
        <p className={`${HUD.body} text-text-dim mt-0.5`}>
          選機師與機甲，在槽位上配武器與背包，即時看到與遊戲一致的重量／出力。
        </p>
      </header>

      {/* ⚠ 常駐橫幅，不是「暫時的公告」：這一版明確不做的東西必須講清楚，
          否則玩家會把「找不到」當成 bug（決策四）。 */}
      <div className="hud-cut mb-3 border border-accent-cyan/25 bg-accent-cyan/5 px-3.5 py-2.5 text-[12px] text-text-secondary leading-relaxed">
        本版提供<strong className="text-text-primary">槽位配裝、重量／出力計算、元件、模組槽與分享碼</strong>。
        武器改裝、形態分頁、部件混搭、雲端存檔<strong className="text-text-primary">尚在後續階段</strong>；
        傷害數字因官方公式未知，本站不提供猜測值
        （<strong className="text-text-primary">元件的觸發機率</strong>同理，面板只列出配對關係與 Lv）。
        {showBanner && (
          <>
            <br />
            <span className="text-accent-yellow/90">
              {ctx.pilot?.name ?? '這位機師'}的每個戰鬥形態各有一套獨立配裝 ——
              目前僅提供
              <strong className="text-text-primary">
                「{equipSetLabel(activeKey, data.forms) ?? '預設'}」
              </strong>
              一套，形態分頁開發中。
            </span>
          </>
        )}
      </div>

      {/* ── HUD：機師／機甲／動作／重量條。sticky top-12 讓開 Layout 的 h-12 sticky header ── */}
      <div className="sticky top-12 z-30 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2.5 mb-3 bg-bg-dark/95 backdrop-blur border-b border-border">
        <div className="flex flex-wrap items-stretch gap-2">
          <HudCard
            label="機師"
            active={effectivePicker?.kind === 'pilot'}
            onClick={() => setPicker({ kind: 'pilot' })}
          >
            {ctx.pilot ? (
              <span className="flex items-center gap-1.5 min-w-0">
                <PilotIcon pilot={ctx.pilot} size="xs" />
                <span className="truncate">{ctx.pilot.name}</span>
                <span className="text-[10px] text-text-dim shrink-0">{ctx.pilot.license}執照</span>
              </span>
            ) : '選擇機師'}
          </HudCard>

          <HudCard
            label="機甲"
            active={effectivePicker?.kind === 'mech'}
            disabled={!ctx.pilot}
            onClick={() => setPicker({ kind: 'mech' })}
          >
            {ctx.mech ? (
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="truncate">{ctx.mech.name}</span>
                <span className="text-[10px] text-text-dim shrink-0">{ctx.mech.armorType}</span>
              </span>
            ) : '選擇機甲'}
          </HudCard>

          {/* 方案名稱：這一列是「這套是誰的、叫什麼」，名稱理當與機師／機甲並排（E-1）。
              它也是匯出圖上最大的一行，所以放在按下匯出之前看得到的位置。
              ⚠ 單欄版面時**移出 sticky**（F-1）：它是設定一次的欄位，不是要一直盯著的即時回饋，
                 常駐在抬頭裡等於在 390px 的畫面上長期佔掉一整列。 */}
          {bp !== 'narrow' && (
            <LoadoutNameField
              value={state.draft.name}
              disabled={!ctx.mech}
              onChange={(name) => send({ type: 'setName', name })}
            />
          )}

          {/* 貼碼是「一個 session 用一次」的動作，所以不進底部固定操作列（那裡是反覆會按的三顆）。
              放在名稱欄旁邊：兩者同屬「這一套的身分」——命名它，或者換成別人的那一套。 */}
          {bp !== 'narrow' && pasteButton}
          {bp !== 'narrow' && shelfButton}

          {/* 單欄版面時動作鍵移到底部固定列（拇指可及、且抬頭少一列） */}
          {bp !== 'narrow' && <div className="flex items-center gap-1.5 ml-auto">{actionButtons}</div>}
        </div>

        {ctx.mech && (
          <div className="mt-2">
            <OutputBar
              budget={budget}
              previewBudget={previewBudget}
              onHoverSegment={setHoverSegment}
              narrow={bp === 'narrow'}
            />
          </div>
        )}
      </div>

      {loading && (
        <p className="text-[13px] text-text-dim py-8 text-center">載入遊戲資料中…</p>
      )}

      <div className={gridClass}>
        {/* ── 左欄：機師身分卡（＋三欄版才有的配裝概況） ── */}
        {bp === 'wide' && (
          <div className="space-y-3 min-w-0">
            <PilotIdentityCard pilot={ctx.pilot} onChange={() => setPicker({ kind: 'pilot' })} />
            {ndPanel}
          </div>
        )}

        {/* ── 中欄：槽位圖。兩欄／單欄版把機師卡疊在它上面 ── */}
        <div className="space-y-3 min-w-0">
          {/* 窄版的方案名稱：自 sticky 抬頭移下來，貼著機師卡 —— 「這套是誰的、叫什麼」是同一件事 */}
          {bp === 'narrow' && (
            <div className="flex items-stretch gap-1.5">
              <LoadoutNameField
                value={state.draft.name}
                disabled={!ctx.mech}
                onChange={(name) => send({ type: 'setName', name })}
                full
              />
              {pasteButton}
              {shelfButton}
            </div>
          )}
          {bp !== 'wide' && (
            <PilotIdentityCard
              pilot={ctx.pilot}
              onChange={() => setPicker({ kind: 'pilot' })}
              compact={bp === 'narrow'}
            />
          )}
          {/* ⚠ 抬頭與機師卡的「更換機師」對稱：兩個主要選擇都在**自己的區塊裡**
              各有一顆換裝鍵，而不是只有機師有、機甲得回頂上的 HUD 找（PLAN-052-I 驗收） */}
          <Panel
            title="槽位"
            titleExtra={ctx.mech ? (
              <span className="flex items-center gap-2 min-w-0">
                <span className={`${HUD.bodyStrong} text-text-primary truncate`}>{ctx.mech.name}</span>
                <span className={`hud-cut-sm shrink-0 px-1.5 py-0.5 text-[11px] font-bold border border-current/40 bg-bg-dark/70 ${
                  ARMOR_TONE[ctx.mech.armorType] ?? 'text-text-secondary'
                }`}>
                  {ctx.mech.armorType}
                </span>
              </span>
            ) : undefined}
            action={{
              label: ctx.mech ? '更換機甲' : '選擇機甲',
              onClick: () => setPicker({ kind: 'mech' }),
              disabled: !ctx.pilot,
            }}
          >
            {ctx.mech ? (
              <LoadoutRig
                ctx={ctx}
                activeSlot={effectivePicker?.kind === 'weapon' ? slotKey(effectivePicker.ref) : null}
                preview={hovered
                  ? { slot: hovered.slot, content: { ...hovered, remainingAfter: previewBudget?.remaining } }
                  : null}
                flash={[...(state.notice?.flash ?? []), ...(hoverSegment ? [hoverSegment] : [])]}
                // 數值未公布的機甲（出力 0）不印「可用 N」——那個 N 是負的，
                // 印出來等於用一個算不出來的數字去嚇人
                available={budget.dataIncomplete ? undefined : budget.remaining}
                onOpenComponents={openComponents}
                onOpenModule={openModule}
                activeModule={openModulePos}
                compact={compactRig}
                onOpenSlot={openSlot}
                onClearSlot={clearSlot}
              />
            ) : (
              <p className="text-[12px] text-text-dim leading-relaxed">
                選好機師與機甲之後，這裡會列出它全部的槽位。
              </p>
            )}
            {ctx.mech && (
              <button
                type="button"
                onClick={() => setPicker({ kind: 'backpack' })}
                className="hud-cut-sm mt-2 w-full text-[12px] px-2.5 py-1.5 border border-border text-text-secondary hover:text-text-primary hover:border-border-accent transition-colors cursor-pointer"
              >
                {ctx.backpack ? `更換背包（${ctx.backpack.name}）` : '選擇背包'}
              </button>
            )}
          </Panel>

          {/* ⚠ 非三欄版時算力面板掛在槽位圖**下方**，不是機師卡下方（052-I D-1 驗收）：
              兩欄版的這一欄有 ~660px 寬，「目前生效」逐級列出來可以到十幾列，
              擺在上面等於要捲過一整螢幕的能力清單才看得到機甲。三欄版的左欄只有 340px、
              而且那一欄本來就沒有別的東西要爭位置，才維持設計畫布的「機師卡下方」。 */}
          {bp !== 'wide' && ndPanel}
        </div>

        {/* ── 右欄：挑選器；沒開挑選器時放機甲的唯讀資訊與（窄版的）配裝概況 ── */}
        <div className="min-w-0 space-y-3">
          {!isMobile && effectivePicker?.kind === 'pilot' && (
            <PickerShell
              open
              title="選擇機師"
              variant="pilotGrid"
              filters={PILOT_FILTERS}
              selectedId={ctx.pilot?.id}
              hint={pilotWallHint(ctx)}
              entries={pilotEntries}
              toRow={pilotRow}
              replaceNote={(p) => pilotSwapNote(ctx, p)}
              budgetLine={budgetLine}
              loading={loading}
              useSheet={false}
              onPick={(p) => { send({ type: 'selectPilot', pilotId: p.id }); setPicker(null) }}
              onResolve={resolve}
              onClose={closePicker}
            />
          )}
          {!isMobile && effectivePicker?.kind === 'mech' && (
            <PickerShell
              open
              title="選擇機甲"
              variant="mechCard"
              selectedId={ctx.mech?.id}
              entries={mechEntries}
              toRow={mechRow}
              budgetLine={budgetLine}
              loading={loading}
              useSheet={false}
              onPick={(m) => { send({ type: 'selectMech', mechId: m.id }); setPicker(null) }}
              onResolve={resolve}
              onClose={closePicker}
            />
          )}
          {!isMobile && effectivePicker?.kind === 'weapon' && (
            <PickerShell
              open
              title={`選擇 ${slotLabel(effectivePicker.ref)} 的武器`}
              filters={WEAPON_FILTERS}
              blockedReason={blockedReason(ctx, effectivePicker.ref)}
              entries={weaponEntries}
              toRow={weaponRow}
              remainingAfter={(w) => loadoutBudget(ctx, { add: { ref: mountRefFor(w, effectivePicker.ref), weight: w.weight } }).remaining}
              replaceNote={(w) => replaceNote(ctx, effectivePicker.ref, w)}
              budgetLine={budgetLine}
              loading={loading}
              altAction={backAlt(effectivePicker.ref, () => setPicker({ kind: 'backpack' }))}
              useSheet={false}
              onPick={(w) => send({ type: 'equipWeapon', ref: mountRefFor(w, effectivePicker.ref), weaponId: w.id })}
              onResolve={resolve}
              onHoverItem={(w) => setHovered(w ? { slot: slotKey(mountRefFor(w, effectivePicker.ref)), weight: w.weight, name: w.name, icon: w.icon } : null)}
              onClose={closePicker}
            />
          )}
          {!isMobile && effectivePicker?.kind === 'backpack' && (
            <PickerShell
              open
              title="選擇背包"
              filters={BACKPACK_FILTERS}
              blockedReason={blockedReason(ctx, { bank: 'main', slot: WeaponEquipSlot.BACK })}
              entries={backpackEntries}
              toRow={backpackRow}
              remainingAfter={(b) => loadoutBudget(ctx, { add: { ref: { bank: 'main', slot: WeaponEquipSlot.BACK }, weight: b.weight, backpackId: b.id } }).remaining}
              budgetLine={budgetLine}
              loading={loading}
              altAction={BACK_WEAPON_ALT(() => setPicker({ kind: 'weapon', ref: { bank: 'main', slot: WeaponEquipSlot.BACK } }))}
              useSheet={false}
              onPick={(b) => send({ type: 'equipBackpack', backpackId: b.id })}
              onResolve={resolve}
              onHoverItem={(b) => setHovered(b ? { slot: slotKey({ bank: 'main', slot: WeaponEquipSlot.BACK }), weight: b.weight, name: b.name, icon: b.icon } : null)}
              onClose={closePicker}
            />
          )}

          {/* ── 右欄＝情境欄（PLAN-052-I D-3）──
              一欄三種內容，依情境切換：**挑選器 ＞ 元件面板 ＞ 武器與元件列**。

              ⚠ 為什麼挑選器不做成覆蓋層：四塊（機師＋算力／機甲 HUD／武器元件／挑選器）
                在 max-w-[1600px] 底下同時常駐，中欄只剩 ~430px —— 機甲 HUD 會被逼進窄版
                （LoadoutRig 的 DENSE_MAX_WIDTH = 570），等於為了同時看見一份清單而把
                整頁的主視覺壓扁。切換內容則沿用這一欄本來就有的行為（沒開挑選器時
                放機甲唯讀資訊），不新增 z-index 層級、focus trap 與 Esc 這三份互動負債。 */}
          {(isMobile || !effectivePicker) && openRow && (
            <ComponentPanel
              ctx={ctx}
              row={openRow}
              onBack={() => setOpenRowKey(null)}
              onEquip={(c) => send({ type: 'equipComponent', ref: openRow.ref, componentId: c.id })}
              onResolve={resolve}
            />
          )}

          {/* 模組面板 —— 切換鏈的第四種內容（PLAN-052-G C-3）。入口是槽位圖下方的四部位卡 */}
          {(isMobile || !effectivePicker) && !openRow && openModuleRef && (
            <ModulePanel
              ctx={ctx}
              ref_={openModuleRef}
              onBack={() => setOpenModulePos(null)}
              onEquip={(m) => send({ type: 'equipModule', ref: openModuleRef, moduleId: m.id })}
              onResolve={resolve}
            />
          )}

          {(isMobile || !effectivePicker) && !openRow && !openModuleRef && ctx.mech && (
            <Panel title="武器與元件">
              <WeaponComponentList
                ctx={ctx}
                budget={budget}
                activeRow={openRowKey}
                onOpen={(row) => setOpenRowKey(row.rowKey)}
              />
            </Panel>
          )}

          {/* 模組效果彙總（PLAN-052-G C-4）。放在武器列之後 —— 玩家先配武器、
              模組是後面才碰的那一層，而它的入口在中欄的四部位卡上。 */}
          {(isMobile || !effectivePicker) && !openRow && !openModuleRef && ctx.mech && (
            <Panel title="模組效果"><EquippedEffects ctx={ctx} /></Panel>
          )}

          {(isMobile || !effectivePicker) && !openRow && !openModuleRef && ctx.mech && (
            <>
              {/* ⏸ 四部位表仍然下架，但**理由只剩一半了**（PLAN-052-G C-6）：
                     模組接口已經可以配（入口是槽位圖下方的四部位卡，彙總在右欄「模組效果」），
                     而四個部位仍然 100% 來自本機甲 —— 這張表現在列出來還是把機甲詳情頁的
                     同一張表再抄一遍。等部件混搭（Phase D）開放後，它才開始回答
                     「這一套是怎麼拼出來的」，屆時連同「來源」欄一起復原。
                  ⚠ MechPartsTable 自帶卡片框與標題（052-A 共用元件），復原時不要再包一層 Panel。
                  ⚠ 下面那句佔位文案**不要照抄回來**：模組那半已經不成立了。
              <div className="space-y-2">
                <MechPartsTable mech={ctx.mech} />
              </div>
              */}
              <p className="text-[11px] text-text-dim leading-relaxed px-1">
                想看完整資料？前往
                <Link to={`/mechs/${ctx.mech.id}`} className="text-accent-orange no-underline mx-1">
                  {ctx.mech.name} 詳情頁
                </Link>
                。
              </p>
            </>
          )}
        </div>
      </div>

      {/* ── 手機：所有挑選器一律走 BottomSheet（底部常駐預算列是必須不是加分） ── */}
      {isMobile && effectivePicker?.kind === 'pilot' && (
        <PickerShell
          open title="選擇機師" variant="pilotGrid" filters={PILOT_FILTERS} selectedId={ctx.pilot?.id}
          hint={pilotWallHint(ctx)}
          entries={pilotEntries} toRow={pilotRow} replaceNote={(p) => pilotSwapNote(ctx, p)}
          budgetLine={budgetLine} loading={loading} useSheet
          onPick={(p) => { send({ type: 'selectPilot', pilotId: p.id }); setPicker(null) }}
          onResolve={resolve} onClose={closePicker}
        />
      )}
      {isMobile && effectivePicker?.kind === 'mech' && (
        <PickerShell
          open title="選擇機甲" variant="mechCard" selectedId={ctx.mech?.id}
          entries={mechEntries} toRow={mechRow} budgetLine={budgetLine} loading={loading} useSheet
          onPick={(m) => { send({ type: 'selectMech', mechId: m.id }); setPicker(null) }}
          onResolve={resolve} onClose={closePicker}
        />
      )}
      {isMobile && effectivePicker?.kind === 'weapon' && (
        <PickerShell
          open
          title={`選擇 ${slotLabel(effectivePicker.ref)} 的武器`}
          filters={WEAPON_FILTERS}
          blockedReason={blockedReason(ctx, effectivePicker.ref)}
          entries={weaponEntries}
          toRow={weaponRow}
          remainingAfter={(w) => loadoutBudget(ctx, { add: { ref: mountRefFor(w, effectivePicker.ref), weight: w.weight } }).remaining}
          replaceNote={(w) => replaceNote(ctx, effectivePicker.ref, w)}
          budgetLine={budgetLine}
          loading={loading}
          altAction={backAlt(effectivePicker.ref, () => setPicker({ kind: 'backpack' }))}
          useSheet
          onPick={(w) => send({ type: 'equipWeapon', ref: mountRefFor(w, effectivePicker.ref), weaponId: w.id })}
          onResolve={resolve}
          onClose={closePicker}
        />
      )}
      {isMobile && effectivePicker?.kind === 'backpack' && (
        <PickerShell
          open
          title="選擇背包"
          filters={BACKPACK_FILTERS}
          blockedReason={blockedReason(ctx, { bank: 'main', slot: WeaponEquipSlot.BACK })}
          entries={backpackEntries}
          toRow={backpackRow}
          remainingAfter={(b) => loadoutBudget(ctx, { add: { ref: { bank: 'main', slot: WeaponEquipSlot.BACK }, weight: b.weight, backpackId: b.id } }).remaining}
          budgetLine={budgetLine}
          loading={loading}
          altAction={BACK_WEAPON_ALT(() => setPicker({ kind: 'weapon', ref: { bank: 'main', slot: WeaponEquipSlot.BACK } }))}
          useSheet
          onPick={(b) => send({ type: 'equipBackpack', backpackId: b.id })}
          onResolve={resolve}
          onClose={closePicker}
        />
      )}

      {/* ── 底部固定操作列（F-1）──
          ⚠ **不可貼底**：Layout 已經有一條 `fixed bottom-0` 的手機 Tab Bar
            （h-14 ＝ 3.5rem ＋ safe-area），貼底會把站上的主導覽整條蓋掉。
          ⚠ 底色用不透明的 `bg-bg-tooltip`：`bg-bg-card` 帶 0.65 alpha，捲動的內容會從底下透出來（A-1 已記）。
          ⚠ z-40：要壓在內容之上，但要低於 BottomSheet 與 Tab Bar 的 z-50。 */}
      {bp === 'narrow' && (
        <div
          className="fixed inset-x-0 z-40 border-t border-border-accent bg-bg-tooltip px-3 py-2"
          style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center gap-1.5">{actionButtons}</div>
        </div>
      )}

      {shelfOpen && <LocalShelfDialog
        onClose={() => setShelfOpen(false)}
        indexes={shareIndexes}
        world={world}
        currentCode={ctx.mech && !loading ? encodeCurrent() : null}
        onApply={(draft) => send({ type: 'loadDraft', draft })}
        onCopyLink={copyLinkFor}
        onShelfChange={setShelfCount}
        loading={loading}
      />}

      {pasteOpen && <PasteCodeDialog
        onClose={() => setPasteOpen(false)}
        loading={loading}
        indexes={shareIndexes}
        world={world}
        onApply={(draft) => send({ type: 'loadDraft', draft })}
        onCheckStale={checkStale}
        onReload={reloadGameData}
      />}

      {/* 從分享連結進來、但有東西解不開時的說明。**不是錯誤**——配裝已經套用了，
          這只是在交代「為什麼有幾格是空的」，所以用黃字而不是紅字。 */}
      {shareNotice && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-50 max-w-[min(34rem,calc(100vw-2rem))] hud-cut-sm border border-accent-yellow/50 bg-bg-tooltip px-3.5 py-2 text-[12px] text-text-secondary leading-relaxed"
          style={{ bottom: bp === 'narrow' ? 'calc(7rem + env(safe-area-inset-bottom))' : '1rem' }}
        >
          {shareNotice}
          <button
            type="button"
            onClick={() => setShareNotice(null)}
            className="ml-3 text-text-dim hover:text-text-primary cursor-pointer whitespace-nowrap"
          >
            知道了
          </button>
        </div>
      )}

      {/* 複製失敗要說出來：非安全來源（http）與部分行動瀏覽器會直接拒絕剪貼簿，
          而按鈕文字不變等於「按了沒反應」 */}
      {copied === 'fail' && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-50 hud-cut-sm border border-accent-red/50 bg-bg-tooltip px-3.5 py-2 text-[12px] text-accent-red"
          style={{ bottom: bp === 'narrow' ? 'calc(7rem + env(safe-area-inset-bottom))' : '1rem' }}
        >
          複製失敗，你的瀏覽器不允許本站寫入剪貼簿。
        </div>
      )}
      {/* ⚠ 匯出失敗一定要說出來：這顆按鈕的成功回饋是「瀏覽器開始下載」，
          失敗時若什麼都不做，使用者只會看到按鈕跳回原狀，以為自己沒按到 */}
      {exportError && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-50 hud-cut-sm border border-accent-red/50 bg-bg-tooltip px-3.5 py-2 text-[12px] text-accent-red"
          // 窄版要讓開底部兩層固定列，否則訊息會被蓋在後面（等同沒有回饋）
          style={{ bottom: bp === 'narrow' ? 'calc(7rem + env(safe-area-inset-bottom))' : '1rem' }}
        >
          匯出配裝圖失敗：{exportError}
          <button
            type="button"
            onClick={() => setExportError(null)}
            className="ml-3 text-text-dim hover:text-text-primary cursor-pointer"
          >
            關閉
          </button>
        </div>
      )}

      {exporting && ctx.mech && (
        <LoadoutExportRunner
          ctx={ctx}
          budget={budget}
          ndLevels={ndLevels}
          ndAbilityMap={ndAbilityMap}
          ndZones={ndZones}
          name={state.draft.name}
          shareCode={exportShareCode}
          onDone={finishExport}
        />
      )}

      <CascadeToast
        notice={state.notice}
        raised={bp === 'narrow'}
        onUndo={() => send({ type: 'undo' })}
        onDismiss={() => send({ type: 'dismissNotice' })}
      />
    </div>
  )
}

// ─── 小元件與映射 ───────────────────────────────────────────────────────────

function Panel({
  title, titleExtra, action, children,
}: {
  title: string
  /** 標題右側的補充（機甲名、裝甲徽章…） */
  titleExtra?: React.ReactNode
  /** 標題列最右邊的一顆動作鍵 */
  action?: { label: string; onClick: () => void; disabled?: boolean }
  children: React.ReactNode
}) {
  return (
    <section className={`${HUD_PANEL} p-3.5 space-y-2`}>
      <div className="flex items-center gap-2 min-w-0">
        <h2 className={`${HUD.cardTitle} text-text-primary shrink-0`}>{title}</h2>
        {titleExtra}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className="hud-cut-sm ml-auto shrink-0 px-3 py-1 border border-border-accent bg-bg-dark/80 text-[12px] text-text-primary hover:border-accent-orange/60 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {action.label}
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function HudCard({
  label, children, active, disabled, onClick,
}: {
  label: string
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`hud-cut-sm flex-1 min-w-[9rem] max-w-[16rem] text-left px-2.5 py-1.5 border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
        active ? 'border-accent-orange bg-accent-orange/10' : 'border-border bg-bg-card hover:border-border-accent'
      }`}
    >
      <div className={`${HUD.labelCjk} text-text-dim leading-tight`}>{label}</div>
      <div className={`${HUD.bodyStrong} text-text-primary mt-0.5 truncate`}>{children}</div>
    </button>
  )
}

/**
 * 方案名稱輸入框（PLAN-052-I E-1）。
 *
 * ⚠ **顯示的是本地未清洗的原字，落盤的是清洗過的**，兩者刻意分離：
 *   `sanitizeLoadoutName()` 會 trim 尾端空白，若直接把清洗結果餵回 input，
 *   使用者打「星芒 」的那個空白會在放開按鍵的瞬間被吃掉，於是永遠打不出
 *   「星芒 雙持」——中間那個空白鍵按下去就消失。
 *
 * 外部改動（載入草稿／未來的分享碼）仍要能覆蓋本地字：用「render 期間調整 state」比對
 * `seen`（上一次我們自己送出去的清洗結果），只有真的來自外部的變動才重設。
 * 這是 React 官方的 derived-state 模式，站上 `FallbackImage` 用的是同一招。
 *
 * ⚠ `maxLength` 是 UTF-16 長度、`LOADOUT_NAME_MAX` 是碼點數，兩者對中英文一致、
 *   對 emoji 會提早擋住。這是刻意取保守側：真正的上限由 `sanitizeLoadoutName()` 決定，
 *   input 只是別讓人打了一長串才發現被截。
 */
function LoadoutNameField({
  value, disabled, full, onChange,
}: {
  value: string | undefined
  disabled?: boolean
  /** 單欄版面：吃滿整列（此時它不在 HUD 那一排裡，沒有要跟誰並排） */
  full?: boolean
  onChange: (raw: string) => void
}) {
  const [raw, setRaw] = useState(value ?? '')
  const [seen, setSeen] = useState(value ?? '')
  if (seen !== (value ?? '')) {
    setSeen(value ?? '')
    setRaw(value ?? '')
  }

  const handle = (next: string) => {
    setRaw(next)
    setSeen(sanitizeLoadoutName(next) ?? '')
    onChange(next)
  }

  return (
    <label
      className={`hud-cut-sm block px-2.5 py-1.5 border bg-bg-card transition-colors ${
        full ? 'w-full min-w-0' : 'flex-1 min-w-[10rem] max-w-[20rem]'
      } ${
        disabled ? 'border-border opacity-40' : 'border-border focus-within:border-accent-orange/60'
      }`}
    >
      <span className={`${HUD.labelCjk} text-text-dim leading-tight block`}>方案名稱</span>
      <input
        type="text"
        value={raw}
        disabled={disabled}
        maxLength={LOADOUT_NAME_MAX}
        // 清洗會吃掉尾端空白，所以離開焦點時把畫面對回真正存下來的字
        onBlur={() => setRaw(value ?? '')}
        onChange={(e) => handle(e.target.value)}
        placeholder="未命名（會印在匯出圖上）"
        className={`${HUD.bodyStrong} w-full mt-0.5 bg-transparent text-text-primary placeholder:text-text-dim placeholder:font-normal focus:outline-none disabled:cursor-not-allowed`}
      />
    </label>
  )
}

// ⚠ `icon` 給的是 `p.portrait`，也就是**頭像** `half.webp`（1240×1080 的全身像另有其路，
//   見 `pilotFullArtPath()`）。頭像牆要的正是頭像。
const pilotRow = (p: Pilot): PickerRowItem => ({
  id: p.id, name: p.name, icon: p.portrait,
  meta: `${p.class ?? ''} · ${p.license}`.replace(/^ · /, ''),
  // 職業色只取 `text-*` 那一段：CLASS_CONFIG 的值是「文字色 底色 框線」三件一組
  tone: CLASS_CONFIG[p.class]?.split(' ')[0],
  badge: p.rarity,
})

const mechRow = (m: Mech): PickerRowItem => {
  const cap = mechSlotCapacity(m)
  return {
    id: m.id, name: m.name, icon: m.portrait,
    weight: m.weight,
    meta: `${m.armorType}${m.quality ? ` · ${m.quality}` : ''}`,
    tone: ARMOR_TONE[m.armorType],
    // 槽位數是「這台裝得下什麼」的第一個答案，比品質更值得佔這一行
    sub: `出力 ${m.output.toLocaleString()} · 手${cap.singleHand}${cap.shoulder ? ` 肩${cap.shoulder}` : ''} 背${cap.back}`,
    // ⚠ 出力 0 ＝ 官方數值尚未公布的佔位機甲（如 mech_090_美杜莎MK2），**不是**壞資料。
    //   不寫這一句，它會渲染成一台什麼都裝不下的機甲，看起來像 bug。
    warning: m.output === 0 ? '官方數值尚未公布，暫時無法計算可用出力' : undefined,
  }
}

/** 裝甲類型的主色。與槽位圖的分段色無關，只是讓三種機甲在卡片上分得開。 */
const ARMOR_TONE: Record<string, string> = {
  輕型: 'text-accent-cyan',
  中甲: 'text-accent-purple',
  重型: 'text-accent-orange',
}

// ─── 挑選器的篩選晶片（PLAN-052-I C-2／C-3）──────────────────────────────────
//
// ⚠ `test` 一律比對**資料欄位**而不是 `row.meta` 的字串 —— 副標措辭改一個字就會
//   讓字串比對靜默失效，而那種失效沒有任何錯誤訊息，只是篩出零筆。

const PILOT_CLASSES = ['守護者', '突擊手', '格鬥家', '狙擊手', '戰術家', '機械師', '調構師'] as const

const PILOT_FILTERS: readonly PickerFilterGroup<Pilot>[] = [
  {
    key: 'class', label: '職業',
    options: PILOT_CLASSES.map((c) => ({ value: c, label: c, tone: CLASS_CONFIG[c]?.split(' ')[0] })),
    test: (p, v) => p.class === v,
  },
  {
    key: 'license', label: '執照',
    options: [
      { value: '輕型', label: '輕型' },
      { value: '中型', label: '中型' },
      { value: '重型', label: '重型' },
    ],
    test: (p, v) => p.license === v,
  },
  {
    key: 'rarity', label: '品質',
    options: [{ value: 'S', label: 'S' }, { value: 'A', label: 'A' }, { value: 'B', label: 'B' }],
    test: (p, v) => p.rarity === v,
  },
]

// ⚠ **機甲挑選器刻意沒有篩選列。** 機師的執照本來就把裝甲類型限死成一種
//   （中型執照 → 只有中甲），再給一排「輕型／中甲／重型」的晶片，其中兩顆按下去
//   必然是零筆 —— 那不是篩選，是把已經成立的限制再問一次。
//   清單直接就是「這位機師開得動的機甲」；開不動的仍由 `HiddenCountBar` 摺疊成
//   一行計數（「共 90 項：因執照不符隱藏 54」），要看原因按一下就展開。

// ─── 武器挑選器的篩選（使用者要求：品質 ＋ 類型）──────────────────────────────

/** 武器與背包共用同一組品質值域（`WeaponRarity`），由高到低。 */
const RARITY_OPTIONS = (['SS', 'S+', 'S', 'A', 'B'] as const).map((r) => ({ value: r, label: r }))


const WEAPON_FILTERS: readonly PickerFilterGroup<Weapon>[] = [
  {
    key: 'type', label: '類型',
    // ⚠ 刻意**不含「特殊」**：那是固定武裝專用的 type（衝擊炮／嵐質儲能艙／多功能彈倉），
    //   而固定武裝一律被 `canEquipWeapon` 以 FIXED_ARMAMENT 擋在挑選器外。
    //   列出來會是一顆按下去恆為零筆的晶片。
    options: [
      { value: WeaponType.Melee, label: WeaponType.Melee },
      { value: WeaponType.Sniper, label: WeaponType.Sniper },
      { value: WeaponType.Assault, label: WeaponType.Assault },
      { value: WeaponType.Heavy, label: WeaponType.Heavy },
    ],
    test: (w, v) => w.type === v,
  },
  {
    key: 'rarity', label: '品質',
    options: RARITY_OPTIONS,
    test: (w, v) => w.rarity === v,
  },
]

// ─── 背包挑選器的篩選（使用者要求：種類 ＋ 品質）────────────────────────────
//
// ⚠ 種類的**值是英文 enum**（'PowerAdd' / 'EMP' / 'Flow'…），標籤一律走圖鑑那一份
//   `BACKPACK_TYPE_CONFIG` —— 直接印 `b.type` 會讓篩選列出現一排只有開發者看得懂的字。
// ⚠ 這裡把 11 種全列出來，沒有的種類由 PickerShell 自動隱藏（例：中甲裝不了的那些）。
const BACKPACK_FILTERS: readonly PickerFilterGroup<Backpack>[] = [
  {
    key: 'type', label: '種類',
    options: Object.entries(BACKPACK_TYPE_CONFIG).map(([value, cfg]) => ({
      value,
      label: cfg.label,
      // className 是「文字色 底色 框線」三件一組，晶片只要文字色那一段
      tone: cfg.className.split(' ')[0],
    })),
    test: (b, v) => b.type === v,
  },
  {
    key: 'rarity', label: '品質',
    options: RARITY_OPTIONS,
    test: (b, v) => b.rarity === v,
  },
]

/**
 * 「選了這位機師會換掉目前的機甲」。
 *
 * ⚠ **不擋也不灰掉**，只印一句話 —— 與武器的 `replaceNote` 同一條原則（決策三）。
 *   換機師本來就是可以做的事，reconcile 會把裝不上的機甲掃掉並跳出可復原的提示；
 *   在這裡擋下來只會逼玩家先清空機甲再選人。
 */
function pilotWallHint(ctx: ReturnType<typeof buildContext>): React.ReactNode {
  if (!ctx.mech) return null
  const need = REQUIRED_LICENSE_LABEL[ctx.mech.armorType] ?? ctx.mech.armorType
  return (
    <>
      目前的機甲<strong className="text-text-primary">{ctx.mech.name}</strong>需要
      <strong className="text-text-primary">{need}執照</strong>。
      標了 <span className="text-accent-yellow font-bold">!</span> 的機師執照不符 ——
      仍然可以選，只是選了會一併換掉機甲（會跳出可復原的提示）。
    </>
  )
}

/** 裝甲類型 → 開得動它的執照名。兩套詞彙只差一個字（中甲 vs 中型），不可直接印。 */
const REQUIRED_LICENSE_LABEL: Record<string, string> = {
  輕型: '輕型', 中甲: '中型', 重型: '重型',
}

function pilotSwapNote(ctx: ReturnType<typeof buildContext>, p: Pilot): string | undefined {
  if (!ctx.mech || ctx.pilot?.id === p.id) return undefined
  if (licenseAllows(p.license, ctx.mech.armorType)) return undefined
  return `${p.license}執照開不了${ctx.mech.name}，選了會換掉它`
}

const weaponRow = (w: Weapon): PickerRowItem => ({
  id: w.id, name: w.name, icon: w.icon, weight: w.weight, isExclusive: w.isExclusive,
  meta: `${w.type} · ${w.kind} · ${w.rarity}`,
})

// ❌ 不可直接印 `b.type`：背包的 type 是**英文 enum**（'PowerAdd' / 'EMP' / 'Heal'…）——
//    直接渲染會讓挑選器出現一排只有開發者看得懂的字。中文標籤共用圖鑑的那一份。
const backpackRow = (b: Backpack): PickerRowItem => ({
  id: b.id, name: b.name, icon: b.icon, weight: b.weight,
  meta: `${BACKPACK_TYPE_CONFIG[b.type]?.label ?? b.type} · ${b.rarity}`,
})

/**
 * 整個挑選器不該開的原因（`blocked` tier）。降級並說明，不是給一個空清單。
 *
 * 兩個實際會走到的來源：全鎖形態（虛粒子／巡航）與機甲數值未公布（美杜莎MK2）。
 */
function blockedReason(ctx: ReturnType<typeof buildContext>, ref: WeaponSlotRef): string | null {
  if (ctx.lock) return `${ctx.lock.formName}的武裝已鎖死，這個形態無法調整任何裝備。`
  const occ = ctx.occupied.get(slotKey(ref))
  if (occ) {
    const w = ctx.world.weapons.get(occ.mount.weaponId)
    return `${slotLabel(occ.ref)}已由固定武裝${w ? `「${w.name}」` : ''}佔用，無法更換。`
  }
  if (ctx.chassis && ctx.chassis.output === 0) {
    return `${ctx.mech?.name ?? '這台機甲'}的官方數值尚未公布，無法計算可用出力，因此暫不提供配裝。`
  }
  return null
}

/**
 * 背槽專用的切換鍵。背包與背部武器共用同一格但是兩份不同的清單，
 * 而其他槽位沒有另一份清單可換 —— 回 `undefined` 就不會長出那顆鍵。
 */
function backAlt(ref: WeaponSlotRef, onClick: () => void) {
  return ref.slot === WeaponEquipSlot.BACK ? { label: '改選背包', onClick } : undefined
}

const BACK_WEAPON_ALT = (onClick: () => void) => ({ label: '改選背部武器', onClick })

/**
 * 「裝上將取代 右手 麥克斯」。
 *
 * ⚠ 只印字，**不灰掉也不阻擋**（決策三）：換手上那把是配裝最常見的動作，
 *   擋下來只會逼玩家先卸再裝、多按一次。
 */
function replaceNote(ctx: ReturnType<typeof buildContext>, ref: WeaponSlotRef, w: Weapon): string | undefined {
  const targets = w.equipSlot === WeaponEquipSlot.DUAL_HAND
    ? ctx.set.mounts.filter((m) => m.bank === ref.bank && (m.slot === WeaponEquipSlot.SINGLE_HAND || m.slot === WeaponEquipSlot.DUAL_HAND))
    : ctx.set.mounts.filter((m) => m.bank === ref.bank && m.slot === ref.slot && m.side === ref.side)
  if (targets.length === 0) return undefined
  const names = targets.map((m) => {
    const cur = ctx.world.weapons.get(m.weaponId)
    return `${slotLabel({ bank: m.bank, slot: m.slot, side: m.side })} ${cur?.name ?? m.weaponId}`
  })
  return `裝上將取代 ${names.join('、')}`
}
