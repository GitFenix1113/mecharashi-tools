import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Backpack, Mech, Pilot, PilotSkillDoc, Weapon } from '../../types'
import type { LoadoutDraft } from '../../types/loadout'
import type { ModuleSlotRef, SlotKey, WeaponSlotRef } from '../../types/slots'
import { slotKey } from '../../types/slots'
import { WeaponEquipSlot, WeaponKind, WeaponType } from '../../types/enums'
import type { MechPartPosition } from '../../types/enums'
import { useLoadoutGameData, type LoadoutStage } from '../../hooks/useFirestore'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useLayoutBreakpoint } from '../../hooks/useLayoutBreakpoint'
import { equipSetKeys, equipSetLabel, hasIndependentLoadouts, lockedFormCards, DEFAULT_EQUIP_SET_KEY } from '../../utils/forms'
import { slotLabel } from '../../utils/mechSlots'
// ⏸ 部件混搭未開放前，四部位表暫時下架（見下方 JSX 內註解）。模組槽已於 052-G Phase C 開放
import { MechPartsTable } from '../../components/mechs/MechSlotPanel'
import { PilotIcon } from '../../components/icons/PilotIcon'
import LoadoutIcon from '../../components/icons/LoadoutIcon'
import { LoadoutRig } from '../../components/loadout/LoadoutRig'
import { OutputBar } from '../../components/loadout/OutputBar'
import { PickerShell } from '../../components/loadout/PickerShell'
import { FormTabs } from '../../components/loadout/FormTabs'
import { LockedFormCard } from '../../components/loadout/LockedFormCard'
// ⏸ 攻擊力口徑未定，「裝配武器」面板暫時下架（見 infoPanel 內註解）
// import { EquippedStats } from '../../components/loadout/EquippedStats'
// ⏸ 「配裝概況」面板已下架（見下方 infoPanel 的註解）；LoadoutSummary.tsx 本體保留備用
// import { LoadoutSummary } from '../../components/loadout/LoadoutSummary'
import { PilotIdentityCard } from '../../components/loadout/PilotIdentityCard'
import { WeaponComponentList } from '../../components/loadout/WeaponComponentList'
import { weaponRows } from '../../utils/loadoutRows'
import { ComponentPanel } from '../../components/loadout/ComponentPanel'
import { ModulePanel } from '../../components/loadout/ModulePanel'
import { SkillPanel } from '../../components/loadout/SkillPanel'
import { CarriedSkillRow } from '../../components/loadout/CarriedSkillRow'
import { EquippedEffects, ModuleThumbStrip } from '../../components/loadout/EquippedEffects'
import { LoadoutExportRunner } from '../../components/loadout/LoadoutExportCard'
import { loadoutSummaryText } from '../../utils/loadoutSummaryText'
import {
  sanitizeLoadoutName, LOADOUT_NAME_MAX,
  sanitizeLoadoutNote, LOADOUT_NOTE_MAX, LOADOUT_NOTE_MAX_LINES,
} from '../../utils/loadoutName'
import { NdPowerBar } from '../../components/common/NdPowerBar'
import { buildNdAbilityMap } from '../../utils/neuralDriveAbilities'
import { defaultNdLevels, ndAffectZones } from '../../utils/ndOverrides'
import { ndPowerBonus, effectiveNdLevels } from '../../utils/ndPowerBonus'
import { HUD, HUD_BTN, HUD_BTN_DANGER, HUD_INPUT, HUD_PANEL } from '../../components/loadout/loadoutTheme'
import { CLASS_CONFIG } from '../../components/badges/PilotBadges'
import { mechSlotCapacity } from '../../utils/mechSlots'
import { licenseAllows } from '../../utils/normalizeArmorType'
import type { PickerFilterGroup } from '../../components/loadout/PickerShell'
import { CascadeToast } from '../../components/loadout/CascadeToast'
import { PasteCodeDialog } from '../../components/loadout/PasteCodeDialog'
import { ShelfDialog } from '../../components/loadout/ShelfDialog'
import { readShelf, SHELF_LIMIT } from '../../lib/localBuilds'
import { buildShareIndex } from '../../utils/loadoutCode/shareId'
import { shareIdAliases, shareIdRegisteredIds } from '../../utils/loadoutCode/shareIdRegistry'
import { encodeLoadout, decodeLoadout, type ShareIndexes } from '../../utils/loadoutCode/codec'
import { readShareCode, buildShareUrl, staleCacheKeys } from '../../utils/loadoutCode/shareLink'
import { useGameData } from '../../contexts/GameDataContext'
import { buildSkillMap } from '../../utils/pilotSkills'
import { PilotTalentStrip } from '../../components/loadout/PilotTalentStrip'
import { WeaponSkillPanel, WeaponSkillStrip } from '../../components/loadout/WeaponSkillPanel'
import { usePatchVersions } from '../../hooks/usePatchVersions'
import { WORKER_ENABLED, getWorkerDataVersions } from '../../lib/api/workerData'
import { getDataVersions } from '../../lib/api/versions'
import type { PickerRowItem } from '../../components/loadout/RejectionRow'
import { BACKPACK_TYPE_CONFIG } from '../../components/badges/BackpackBadges'
import {
  backpackChoices, buildContext, buildWorld, canSelectMech, loadoutBudget, mountRefFor, slotsOverlap,
  slotHasCandidates, slotOccupant, weaponChoices, type PickerEntry, type ResolutionAction,
} from '../../utils/loadoutRules'
import { INITIAL_SIM_STATE, isEmptyDraft, simReduce, type LoadoutAction, type SimState } from './simReducer'

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

  /**
   * 右欄鑽進技能面板的那一格（PLAN-052-L D-4）。存**格號**而不是技能 id：
   * 那一格可能是空的，而「第 2 格」在換機師之後仍然是第 2 格。
   * 與 `openModulePos` 存部位、`openRowKey` 存 key 同一條 —— 不存快照。
   */
  const [openSkillIndex, setOpenSkillIndex] = useState<number | null>(null)

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
    if (next) { setOpenRowKey(null); setOpenSkillIndex(null) }
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
  const [pending, setPending] = useState<{ draft?: LoadoutDraft; code?: string } | null>(() => {
    // ⚠ 順序就是優先權，不要調換：**網址上的分享碼永遠贏過本機草稿**。
    //   點開別人連結的人，要的是那一套；把他自己上次配到一半的東西端出來，
    //   會讓「連結壞掉了」變成最合理的解讀。
    //   （原本這裡還有第三條：ProfilePage 用 `location.state.build` 送 v1 `Build` 進來。
    //   那條連同 `legacyBuildToDraft()` 已於 052-E B-6 刪除 —— 集合實測 0 筆，沒有東西要遷。
    //   雲端書架改走 `buildsApi`，送進來的一律是分享代碼，與這裡的 `code` 同一條路徑。）
    const shared = readShareCode(window.location.search)
    if (shared) return { code: shared }
    const cached = readDraftCache()
    return cached ? { draft: cached } : null
  })

  /** 分享碼送進來的東西解不開時要說出來（那幾格會是空的）。 */
  const [shareNotice, setShareNotice] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  /**
   * 複製回饋。**要分得出複製的是哪一種東西**（PLAN-052-L E-1 起有兩顆複製鍵）——
   * 只存 `'ok'` 的話，按「複製摘要」會讓旁邊的「複製分享連結」跟著變成「已複製」，
   * 而使用者手上的剪貼簿裡其實是另一種東西。
   */
  const [copied, setCopied] = useState<'link' | 'summary' | 'fail' | null>(null)

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
  // ⚠ 提前到 `world` 之前宣告：`buildWorld()` 現在要吃技能庫（見下方「技能庫」那一段
  //   的完整理由）。`useGameData()` 是同一個 context，多取一次沒有成本。
  const gd = useGameData()
  const gdSkills = gd.pilotSkills
  // ⚠ `world` 要**連技能庫一起帶**（PLAN-052-L D-3）：`reconcile()` 的候選池檢查靠它，
  //   而它刻意不在 `LOADOUT_STAGE_KEYS` 裡（見下方技能庫那一段）。空 Map 時 reconcile
  //   會跳過驗證而不是清空 —— 那條 gate 寫在 `reconcileSkills()` 裡。
  const world = useMemo(() => buildWorld({ ...data, pilotSkills: gdSkills }), [data, gdSkills])

  // ── 技能庫（PLAN-032 的 `pilotSkills`）──────────────────────────────────────
  //
  // 武器技能與機師專武的天賦強化都住在這裡。**刻意不放進 `LOADOUT_STAGE_KEYS`**：
  //
  //   ① 那份清單的 `loading` 同時是**分享碼的編碼閘門**（`ctx.mech && !loading` 才敢編）。
  //      技能與分享碼毫無關係，把它加進去等於讓「複製分享連結」多等一個集合。
  //   ② 它只在 `equip` 階段有意義（要先有武器才有武器技能），而 `ensureLoaded()`
  //      本來就會記住已載入的集合，重複呼叫是零成本的。
  //
  // ⚠ 空 Map ＝ **還沒載入**，不是「這些武器沒有技能」（同 components／modules 那一條）。
  //   兩者都會渲染成空清單，但意思相反，故一律連 `skillsLoading` 一起傳下去。
  /**
   * ⚠ **一有機師就要載，不是等到 `equip`**（PLAN-052-L D-4 瀏覽器實測抓到）。
   *
   * 原本寫的是 `stage === 'equip'`（武器技能要先有武器）。但 D-4 的技能卡 gate 是
   * `ctx.pilot` —— 技能是機師的屬性，選機甲之前就該選得動。於是在「選完機師、
   * 還沒選機甲」那一段，`skillMap` 是空的而 `skillsLoading` 是 **false**
   * （`needSkills` 為假就恆為假）⇒ 卡片把「還沒載入」渲染成
   * 「這位機師的技能資料還沒建到可以挑選的程度」——一句**指控資料有缺**的話，
   * 而實際上只是集合還沒去拿。這正是本計畫反覆警告的那一類：
   * 空 Map ＝ 還沒載入，不是「沒有」。
   *
   * ⚠ 這**不等於**把 `pilotSkills` 加進 `LOADOUT_STAGE_KEYS`：那份 `loading` 同時是
   *   別處的閘門（見上方註解①），加進去會讓「複製分享連結」多等一個集合。
   *   這裡動的只有「什麼時候去拿」。
   */
  const needSkills = !!state.draft.pilotId
  useEffect(() => { if (needSkills) void gd.ensureLoaded(['pilotSkills']) }, [needSkills, gd])
  const skillMap = useMemo(() => buildSkillMap(gdSkills), [gdSkills])
  const skillsLoading = needSkills && !gd.loadedKeys.has('pilotSkills')

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
    /**
     * ⚠ 技能的來源刻意是**登錄簿而不是 `gd.pilotSkills`**（PLAN-052-L D-2）。
     *
     * 這一格是本檔最容易長出上面那兩個 ⚠ 的地方：`pilotSkills` **不在**
     * `LOADOUT_STAGE_KEYS` 裡（見 `useFirestore.ts` 與下方技能庫那一段），
     * 所以「集合還沒到」在這裡是**常態**。接成 `gd.pilotSkills` 的話，
     * 在它到齊之前按下「複製分享連結」，三個技能會被**靜默濾掉** ——
     * 而那正是 052-D 元件那個漏了三個 Phase 的坑。
     *
     * 技能的號碼 100% 來自登錄簿（doc id 推不出數字），登錄簿又是靜態 JSON、永遠在
     * ⇒ 直接拿它當來源，encode／decode 都不必等任何集合。理由全文見
     * `shareIdRegisteredIds()`。
     *
     * ⚠ 這**不代表**技能面板不必等集合：號碼查得到，但技能的**名稱與圖示**還是要
     *   `pilotSkills` 才有 —— 那一半由 `skillsLoading` 負責（見匯出鍵的 `busy`）。
     */
    pilotSkill: buildShareIndex('pilotSkill', shareIdRegisteredIds('pilotSkill'), shareIdAliases('pilotSkill')),
  }), [data])

  const send = useCallback((a: LoadoutAction) => {
    setState((s) => simReduce(s, a, world))
    setHovered(null)
  }, [world])

  // 還原：資料齊了就在 render 期間併進 state（React 官方的「render 期間調整 state」模式 ——
  // 同一次 render 內立即重跑，不會多畫一幀，也不必用 effect 製造串聯渲染）。
  if (pending && !loading) {
    let draft = pending.draft
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

  // ── 分頁鍵：一律取自 equipSetKeys()（分頁列 UI 見 <FormTabs>，PLAN-052-F B-1）──
  //
  // ⚠ 不可改成 Object.keys(state.draft.sets)：那是「已經存過東西的分頁」，
  //   新建的配裝一個鍵都沒有 ⇒ 分頁整排消失，而且不會報錯。
  const setKeys = useMemo(
    () => (state.draft.pilotId ? equipSetKeys(state.draft.pilotId, data.forms) : [DEFAULT_EQUIP_SET_KEY]),
    [state.draft.pilotId, data.forms],
  )
  const activeKey = setKeys.includes(state.draft.activeSetKey) ? state.draft.activeSetKey : setKeys[0]
  const ctx = useMemo(() => buildContext(state.draft, activeKey, world), [state.draft, activeKey, world])
  const budget = useMemo(() => loadoutBudget(ctx), [ctx])

  /** 「全部清空」要不要 disable。與 reducer 共用同一支判斷，不各判各的 */
  const draftEmpty = isEmptyDraft(state.draft)

  // ── 底部固定列的實際高度（PLAN-052-L）────────────────────────────────────
  //
  // 為什麼要量而不是寫死：這一列的按鈕數會變（超重時多一顆「自動卸至符合」），
  // 而字級是使用者設定（Layout 的 FONT_SIZE_MAP，root 19px 起跳）—— 兩者一疊加，
  // 390px 上就會換行、整列從一排變兩排。原本 toast 的 `bottom: 7rem` 與內容的
  // `paddingBottom: 3.25rem` 都是照「一排」寫死的常數，換行時 toast 會被壓在列底下，
  // 而 toast 上有 [復原] —— 清空之後唯一救得回來的那顆按鈕。
  // 量一次餵給兩邊，這條假設就不會再被下一顆按鈕弄壞。
  const barRef = useRef<HTMLDivElement | null>(null)
  const [barH, setBarH] = useState(0)
  useEffect(() => {
    const el = barRef.current
    if (!el) { setBarH(0); return }
    // offsetHeight 而不是 contentRect：這一列有 py-2 與上框線，contentRect 量不到
    const measure = () => setBarH(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [bp])
  /** 首次 render（還沒量到）時的保底值：一排按鈕實測約 40px */
  const barPx = barH || 40
  /** 固定列上緣再留一點呼吸空間 —— toast 與內容都靠它讓開 */
  const raisedBottom = `calc(3.5rem + ${barPx}px + 0.75rem + env(safe-area-inset-bottom))`

  // ── 唯讀形態卡：鎖死整套配裝、因此不佔分頁的那幾個形態（PLAN-052-F C-1）──
  //
  // ⚠ 判準是 `lockedFormCards()`（＝「這位機師**有沒有分頁列**」），
  //   不是「有沒有 fixedArmament 形態」：曜同樣有一個（巡航），但他沒有分頁列，
  //   畫了就是站上多出一個遊戲沒有的東西。規則收在 utils/forms.ts，本頁不自己判。
  //
  // ⚠ 每一張卡吃**自己那個 formId 的 ctx**，不是目前分頁那一份：
  //   全鎖形態的整套 100% 由 form.restrict.mounts derive，`loadoutWeightSet()`
  //   對 `ctx.lock` 有專門的分支；傳錯會算出別頁的重量、掛上這一頁的名字。
  const lockedForms = useMemo(
    () => (state.draft.pilotId ? lockedFormCards(state.draft.pilotId, data.forms) : []),
    [state.draft.pilotId, data.forms],
  )
  const lockedCards = useMemo(
    () => lockedForms.map((form) => ({ form, ctx: buildContext(state.draft, form.id, world) })),
    [lockedForms, state.draft, world],
  )

  // ── 挑選器 ──
  // 沒有機師／機甲時，情境欄自動停在該選的那一步 —— 不必先點一下才知道要從哪裡開始。
  // 包 useMemo 是因為它會進到下面幾支 useMemo 的依賴：每次 render 產生新物件會讓清單白算一次
  //
  // ⚠ **對話框開著時一律不開挑選器**（D-1 瀏覽器實測）：還沒選機師的人一進頁面，
  //   挑選器就自動開著；手機版它是 BottomSheet，會整片蓋在書架／貼碼對話框上面
  //   —— 而那正是新訪客最可能先按書架的時機。「自動停在該選的那一步」在對話框開著時
  //   本來就不成立：現在該做的是那個對話框裡的事。`picker` 本身不清掉，關掉就回來。
  //
  // ⚠ **技能面板開著時同樣不自動開挑選器**（PLAN-052-L D-4 瀏覽器實測抓到）：
  //   技能卡的 gate 是 `ctx.pilot`（技能是機師的屬性，選機甲之前就該選得動），
  //   但「還沒選機甲」正是自動挑選器會佔住右欄的時候 —— 於是點下第 1 格什麼都不會發生，
  //   而畫面上沒有任何訊息說得出為什麼。`openSkillSlot()` 已經把 `picker` 清掉了，
  //   擋不住的是這裡的**自動回退**。理由與上面那條對話框完全相同：
  //   「自動停在該選的那一步」在使用者剛剛親手點開別的東西時本來就不成立。
  const effectivePicker = useMemo<ActivePicker>(
    () => (pasteOpen || shelfOpen || openSkillIndex !== null
      ? null
      : picker ?? (!state.draft.pilotId ? { kind: 'pilot' } : !state.draft.mechId ? { kind: 'mech' } : null)),
    [picker, pasteOpen, shelfOpen, openSkillIndex, state.draft.pilotId, state.draft.mechId],
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
    setOpenSkillIndex(null)
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
    setOpenSkillIndex(null)
  }, [setPicker])

  /**
   * 開技能面板（PLAN-052-L D-4）。中欄的三格整格可點，共用這一支。
   *
   * ⚠ 進來時把切換鏈上的其他三種都關掉，理由與 `openModule` 逐字相同：
   *   右欄是一欄多種內容，同時開兩種會讓返回鍵不知道要退回哪一層。
   */
  const openSkillSlot = useCallback((index: number) => {
    setPicker(null)
    setOpenRowKey(null)
    setOpenModulePos(null)
    setOpenSkillIndex(index)
  }, [setPicker])

  // ── 挑選器清單 ──
  const pilotEntries = useMemo<PickerEntry<Pilot>[]>(
    () => data.pilots.map((p) => ({ item: p, rejection: null })),
    [data.pilots],
  )
  // 預設排序：選得上的在前 → 品質 S→A→B → 登場版本新→舊（使用者要求 2026-08-29）。
  //
  // ⚠ **「選得上的在前」必須留在最外層**：開不動的機甲由 `HiddenCountBar` 摺成一行計數，
  //   而它摺的是清單尾端連續的那一段 —— 品質排到前面去會把它拆散。
  // ⚠ 第四層用名稱收尾**不是可有可無**：`Array.prototype.sort` 的穩定性保證的是
  //   「比較結果相等時維持原順序」，而原順序來自 Firestore 的回傳，同品質同版本的兩台
  //   會在不同 session 換位置。定住它，清單才不會每次開都長得不一樣。
  const mechEntries = useMemo<PickerEntry<Mech>[]>(
    () => data.mechs
      .map((m) => ({ item: m, rejection: canSelectMech(ctx.pilot, m) }))
      .sort((a, b) =>
        (a.rejection ? 1 : 0) - (b.rejection ? 1 : 0)
        || (MECH_QUALITY_ORDER[a.item.quality ?? ''] ?? 99) - (MECH_QUALITY_ORDER[b.item.quality ?? ''] ?? 99)
        || debutRank(b.item) - debutRank(a.item)
        || a.item.name.localeCompare(b.item.name, 'zh-Hant'),
      ),
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
  //   挑選器反過來是一份清單，固定寬度就夠；把 1fr 讓給槽位圖，
  //   視窗越寬機甲 HUD 越舒展，而不是把空間浪費在一份清單的右側留白上。
  //   （槽位圖自己還會量容器寬度切換窄版與立繪級距，見 LoadoutRig 的
  //    DENSE_MAX_WIDTH / ROOMY_MIN_WIDTH。）
  //
  // ⚠ PLAN-052-I C-1 起是**三塊**：機師身分卡（左，320px，含配裝概況）／
  //   裝備與模組 HUD（中，1fr）／挑選器（右，420px）。順序刻意照設計畫布——
  //   機師在左、機甲在中，與玩家腦中的「誰開這台」一致。
  //   兩欄版把機師卡疊在槽位圖上方（同一欄）。
  //
  //   中欄實際寬度 ＝ min(視窗, 1920) − 804（外距 32 ＋ 320 ＋ 420 ＋ 兩道 gap 32）：
  //     1280 → 476 ／ 1440 → 636 ／ 1600 → 796 ／ 1760 → 956 ／ 1920 → 1116
  //   對照 LoadoutRig 的三道門檻（610 窄版 ／ 780、950 立繪放大），
  //   1440 起脫離窄版、1600 起立繪 210px、1760 起 240px。
  const gridClass =
    // ⚠ 右欄 380 → 420（使用者回饋 2026-08-27）：模組面板的清單列要同時放下
    //   模組名、＋N 級與兩顆徽章，380px 扣掉內距只剩約 330px，名字被壓成一個字。
    //   欄寬與那一列的排版是**一起**修的 —— 只放寬欄寬，換個更長的模組名還是會被壓掉。
    //   ⚠ 所以「放大中間」時**動的是左欄不是右欄**（使用者要求 2026-08-28）：
    //     右欄收回 400 就等於把上面那個修好的東西推回去一半。
    // ⚠ 左欄 360 → 320（2026-08-28）：中欄各斷點因此 +40px。320 扣掉內距約 296px，
    //   與兩欄版那一欄的寬度同級 —— 而左欄的內容（機師卡／天賦條／算力）本來就已經
    //   照著那個寬度做過截斷處理（見 `PilotTalentStrip` 的專武按鈕註解）。
    bp === 'wide' ? 'grid grid-cols-[320px_minmax(0,1fr)_420px] gap-4 items-start'
    : bp === 'medium' ? 'grid grid-cols-[minmax(0,1fr)_420px] gap-4 items-start'
    : 'flex flex-col gap-4'

  // 挑選器底部的帳本列。⚠ 也要帶形態名：挑選器一開，面板抬頭那排分頁就被蓋掉了，
  // 而挑選器本身正是「這一格要裝什麼」的地方 —— 玩家最需要確定自己在配哪一套的時刻。
  const budgetLine = (
    <OutputBar
      budget={previewBudget ?? budget}
      compact
      onHoverSegment={setHoverSegment}
      formName={setKeys.length > 1 ? equipSetLabel(activeKey, data.forms) : null}
    />
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

  /** 一串代碼 → 可以直接貼給別人的絕對網址。**只有這一支**（剪貼簿與 QR 都問它）。 */
  const shareUrlFor = useCallback(
    (code: string) => buildShareUrl(code, window.location.origin, import.meta.env.BASE_URL),
    [],
  )

  /** 任意文字進剪貼簿。**兩顆複製鍵共用**，於是「被瀏覽器拒絕」的處置只有一種。 */
  const writeClipboard = useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 剪貼簿在非安全來源（http）與部分行動瀏覽器會直接拒絕
      return false
    }
  }, [])

  /** 把任一串代碼變成連結並放進剪貼簿。書架的每張卡也走這一支 —— 兩處給的必須是同一種東西。 */
  const copyLinkFor = useCallback(
    (code: string) => writeClipboard(shareUrlFor(code)),
    [writeClipboard, shareUrlFor],
  )

  const copyShareLink = useCallback(async () => {
    const code = encodeCurrent()
    setCopied(code && await copyLinkFor(code) ? 'link' : 'fail')
  }, [encodeCurrent, copyLinkFor])

  // ── 神經驅動算力（PLAN-052-I D-1）──
  //
  // ⚠ **宣告位置提前到動作鍵之前**（PLAN-052-L E-1）：算力面板、匯出圖、純文字摘要
  //   三個消費者，而後兩者住在上面的按鈕列裡。const 有 TDZ，排在後面會直接爆。
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

  /**
   * 模組給的算力加成（PLAN-052-M）。強擊模組 LV.MAX ／ 觀星者單元 ——
   * 「已解鎖的神經驅動分區中最低的區域算力 +3」。
   *
   * ⚠ 收的是 `ndLevels`（**投入**值），吐的是「加在哪一區、加完幾級」。
   *   絕不能把 `ndLevelsEffective` 餵回去 —— 那會每 render 再加一次 3。
   * ⚠ 走 `ctx.stacks`（含天生貢獻）：疾嘯那 8 級是**天生**的，
   *   四部位各 2 級湊滿 LV.MAX，玩家一格接口都不必插。
   */
  const ndBonus = useMemo(
    () => ndPowerBonus(ctx.pilot?.neuralDrive, ndLevels, ctx.stacks, ctx.moduleBlocks),
    [ctx.pilot, ndLevels, ctx.stacks, ctx.moduleBlocks],
  )
  /**
   * **生效**的分區 Lv ＝ 投入 ＋ 加成。
   *
   * 「哪些能力亮著」「圖上與純文字摘要印幾級」一律用這一份；
   * 「玩家投入多少 / γ 預算用掉多少」一律用上面的 `ndLevels`。
   * ⚠ 兩者在有加成時**本來就不相等**（投入 23 可以生效 26）——
   *   混用不會報錯，只會讓條上的格子與徽章的數字對不起來。
   */
  const ndLevelsEffective = useMemo(() => effectiveNdLevels(ndLevels, ndBonus), [ndLevels, ndBonus])

  // 匯出圖右下角的分享碼（052-C E-1）與圖底 QR 的連結（052-L E-2）。
  // **只在真的要拍照時才編**：平常沒人看它，而每次改一格配裝就重編一次是白工。
  // 編不出來時兩者都是 undefined ⇒ 整條分享碼帶不印（元件的約定），
  // 因為印一串解不開的碼會有人拿去貼。
  const exportShareCode = useMemo(
    () => (exporting ? encodeCurrent() ?? undefined : undefined),
    [exporting, encodeCurrent],
  )
  const exportShareUrl = useMemo(
    () => (exportShareCode ? shareUrlFor(exportShareCode) : undefined),
    [exportShareCode, shareUrlFor],
  )

  /**
   * 匯出圖上的攜帶技能（PLAN-052-L D-5）。**解析好才傳**，元件保持純渲染。
   *
   * ⚠ 查不到的 id 直接跳過而不是塞一個佔位：這張圖是印刷品，一顆寫著 `skill_xxx`
   *   的 chip 讀者無從查證。真的斷鏈時圖上少一個，畫面上的三格則會顯示 doc id
   *   （`CarriedSkillRow` 那一段）—— 兩邊的角色不同：畫面要能除錯，圖只要誠實。
   */
  const carriedSkillDocs = useMemo(
    () => (state.draft.skills?.carried ?? [])
      .map((id) => skillMap.get(id))
      .filter((d): d is PilotSkillDoc => !!d),
    [state.draft.skills?.carried, skillMap],
  )

  /**
   * 匯出閘門（PLAN-052-L D-6）。
   *
   * ⚠ `waitForRenderReady()` **只等圖與字體、不等集合** —— 在 `pilotSkills` 到齊之前
   *   開拍，拍到的是一張技能區空白的圖，而「沒帶技能」與「還沒載入」在那張圖上
   *   長得一模一樣（B-3 的 α／β 那一條也是同一種病）。
   *
   * ⚠ 條件式而不是把 `pilotSkills` 加進 `LOADOUT_STAGE_KEYS`：那份 `loading` 同時是
   *   別的東西的閘門，加進去會讓每一次「複製分享連結」都多等一個集合。
   *   **沒帶技能的人一秒都不必等**（今天絕大多數的圖）。
   *
   * ⚠ 分享碼**不需要**這道閘門：技能的號碼來自靜態登錄簿而不是集合
   *   （見上方 `shareIndexes` 的 `pilotSkill`），所以編碼從來不會因為集合沒到而漏東西。
   */
  const skillsNotReady = skillsLoading && (state.draft.skills?.carried?.length ?? 0) > 0

  /**
   * 「複製配裝摘要（純文字）」（PLAN-052-L E-1）。
   *
   * 團隊回饋 1：本站的優勢是「資料詳細、可引用」——而 PNG 不可引用、不可搜尋、
   * 不可貼進 wiki。這顆按鈕給的就是那個可引用的出口。
   *
   * ⚠ **走與「複製分享連結」同一條剪貼簿路徑**（`writeClipboard`）：http 與部分行動
   *   瀏覽器會直接拒絕，而錯誤文案只該有一份。
   * ⚠ 連結**編不出來就整段不印**（`shareUrl` 傳 undefined），不塞佔位字串 ——
   *   同匯出圖的處置，理由也一樣：印一串打不開的東西會有人拿去貼。
   * ⚠ 技能與匯出圖共用 `carriedSkillDocs`，所以這顆也吃同一道 `skillsNotReady` 閘門：
   *   `pilotSkills` 還沒到齊時複製出來的摘要會少一整段，而「沒帶技能」與「還沒載入」
   *   在那段文字裡長得一模一樣。
   */
  const copySummary = useCallback(async () => {
    const code = encodeCurrent()
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const text = loadoutSummaryText({
      ctx, budget, ndAbilityMap,
      ndLevels: ndLevelsEffective,
      ndBonus,
      name: state.draft.name,
      note: state.draft.note,
      skills: carriedSkillDocs,
      setCount: setKeys.length,
      shareUrl: code ? shareUrlFor(code) : undefined,
      generatedAt: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
      gameVersion,
    })
    setCopied(await writeClipboard(text) ? 'summary' : 'fail')
  }, [
    ctx, budget, ndLevelsEffective, ndBonus, ndAbilityMap, state.draft.name, state.draft.note,
    carriedSkillDocs, setKeys.length, encodeCurrent, shareUrlFor, gameVersion, writeClipboard,
  ])

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
      className={`${HUD_BTN} text-[12px] px-2.5 py-1.5 whitespace-nowrap`}
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
      className={`${HUD_BTN} text-[12px] px-2.5 py-1.5 whitespace-nowrap`}
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
        {copied === 'link' ? '已複製連結' : bp === 'narrow' ? '複製連結' : '複製分享連結'}
      </button>
      {/* ── 複製配裝摘要（PLAN-052-L E-1）──
          團隊說本站的優勢是「資料詳細、可引用」，而 PNG 不可引用、不可搜尋、
          不可貼進 wiki。這顆給的是可 Ctrl+F 的那一份。
          ⚠ 與匯出圖吃**同一道** `skillsNotReady` 閘門：摘要裡也有攜帶技能那一段，
            而「沒帶技能」與「還沒載入」在純文字裡同樣分不出來。
          ⚠ 樣式刻意與左邊的連結鍵同一支青色：兩顆都是「把這一套交出去」，
            用不同顏色會讓人以為其中一顆會改到配裝。 */}
      <button
        type="button"
        onClick={copySummary}
        disabled={!ctx.mech || loading || skillsNotReady}
        className="hud-cut-sm text-[12px] px-2.5 py-1.5 border border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
      >
        {copied === 'summary' ? '已複製摘要' : bp === 'narrow' ? '摘要' : '複製摘要'}
      </button>
      <button
        type="button"
        onClick={() => { setExportError(null); setExporting(true) }}
        disabled={!ctx.mech || exporting || loading || skillsNotReady}
        className="hud-cut-sm text-[12px] px-2.5 py-1.5 border border-accent-orange/50 bg-accent-orange/10 text-accent-orange hover:bg-accent-orange/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
      >
        {/* ⚠ 窄版縮成「匯出圖」（E-1）：底部固定列多了一顆「摘要」，
            而改版前四顆在 390px ＋「大」字級下只剩 32px 餘裕。 */}
        {exporting ? '產生中…' : bp === 'narrow' ? '匯出圖' : '匯出配裝圖'}
      </button>
      {budget.over && (
        <button
          type="button"
          onClick={() => send({ type: 'autoUnloadToFit' })}
          className="hud-cut-sm text-[12px] px-2.5 py-1.5 border border-accent-red/40 text-accent-red hover:bg-accent-red/10 transition-colors cursor-pointer whitespace-nowrap"
        >
          {/* ⚠ 窄版縮成「卸至符合」（E-1，390px ＋「大」字級實測）：多了「摘要」那顆之後，
              長標籤會被 flex 壓到換行。
              （換行本身在 052-L 之後**不再是災難**：固定列改成量高度餵給 toast 與內容
              留白，見上方 `barH`。但擠成一列仍然比較好讀，短標籤照留。） */}
          {bp === 'narrow' ? '卸至符合' : '自動卸至符合'}
        </button>
      )}
      {/* ── 兩顆清空鍵（使用者回饋 2026-08-30）──
          原本只有一顆「清空」，做的是「這一套的裝備」；但畫面上另外三顆按鈕都是
          「把整份配裝交出去」，於是那顆孤零零的「清空」讀起來像「全部重來」——
          想換一位機師從頭配的人按下去，機師與機甲卻還在原位。
          拆成兩顆之後**兩件事都講得出範圍**，而不是靠使用者按一次來發現。

          ⚠ 兩顆刻意用不同顏色（灰／紅框）：它們相鄰、標籤只差兩個字，
            同色的話按錯只是機率問題，而右邊那顆會把機師與機甲一起帶走。
          ⚠ 兩顆都不做二次確認，改為事後可 [復原]（見 simReducer 的 commitClear）。 */}
      <button
        type="button"
        onClick={() => send({ type: 'clearSet' })}
        disabled={!ctx.mech}
        className={`${HUD_BTN} text-[12px] px-2.5 py-1.5 whitespace-nowrap`}
      >
        {/* 窄版縮一個字（同列其餘四顆的量測見上面幾則 ⚠） */}
        {bp === 'narrow' ? '清裝備' : '清空裝備'}
      </button>
      <button
        type="button"
        onClick={() => send({ type: 'clearAll' })}
        // ⚠ 這顆的 disabled **不看 ctx.mech**：只選了機師還沒選機甲的人，
        //   要的正是這顆（清掉重挑）。判準是「草稿裡還有沒有東西」。
        disabled={draftEmpty}
        className={`${HUD_BTN_DANGER} text-[12px] px-2.5 py-1.5 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border-accent disabled:hover:text-text-secondary`}
      >
        {bp === 'narrow' ? '全清空' : '全部清空'}
      </button>
    </>
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
        // ⚠ 這裡傳**投入**值：γ 預算閘門要讀它，而加成不花預算。
        //   傳生效值的症狀是「裝上加成模組，反而少能點一格」。
        levels={ndLevels}
        affectZones={ndZones}
        abilityMap={ndAbilityMap}
        bonus={ndBonus}
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
      // ⚠ **本頁刻意比站上其他頁寬**（`max-w-7xl` ＝ 1280px）：三欄同時常駐是這一頁的
      //   整個設計前提（機師／槽位 HUD／情境欄），1280px 底下中欄只剩約 340px，
      //   槽位圖會被自己的 `DENSE_MAX_WIDTH` 逼進窄版。
      //   1600 → 1920（使用者回饋 2026-08-27：1920 螢幕上左右還有 320px 沒用到）。
      //   不做無上限：超寬螢幕上一列從左到右掃過去，眼睛要走的距離比多看到的東西值錢。
      className="max-w-[1920px] mx-auto px-3 sm:px-4 py-4"
      // 單欄版面底部有兩層固定列（本頁操作列 ＋ Layout 的手機 Tab Bar），
      // 內容要讓開，否則最後一個面板永遠被蓋住一半
      style={bp === 'narrow' ? { paddingBottom: `calc(${barPx}px + 1.25rem + env(safe-area-inset-bottom))` } : undefined}
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
        本版提供<strong className="text-text-primary">槽位配裝、重量／出力計算、元件、模組槽、部件混搭、形態分頁、分享碼與雲端存檔</strong>。
        武器改裝<strong className="text-text-primary">尚在後續階段</strong>；
        傷害數字因官方公式未知，本站不提供猜測值
        （<strong className="text-text-primary">元件的觸發機率</strong>同理，面板只列出配對關係與 Lv）。
        {/* ⚠ 052-E E-4（2026-08-29）：拿掉「部件混搭、雲端存檔尚在後續階段」——
            部件混搭在 052-G Phase D 就出貨了（052-K E-3 記過，但當時歸屬 052-G 而它已歸檔，
            等於沒人認領），雲端存檔則由 052-E 出貨。兩者都改列進「本版提供」。
            ⚠ 「形態分頁開發中」那句黃字已於 PLAN-052-F D-3 移除 —— 這是**常駐橫幅**不是暫時公告
            （總綱決策四），留著就是站上自己說了一句不再成立的話。
            取而代之的是一句只在有分頁列時出現的說明：分頁列本身講得出「有幾套」，
            但講不出「切過去之後哪些東西會跟著換、哪些不會」，而那正是玩家第一次看到三個分頁時會問的。 */}
        {showBanner && (
          <>
            <br />
            <span className="text-accent-cyan/90">
              {ctx.pilot?.name ?? '這位機師'}的每個戰鬥形態<strong className="text-text-primary">各有一套獨立配裝</strong> ——
              武器、背包、元件與重量／出力<strong className="text-text-primary">逐頁分開</strong>；
              機甲、模組與神經驅動算力<strong className="text-text-primary">四套共用</strong>。
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
                {/* ⚠ 印的是**軀幹那台**（`identityMech`），與面板抬頭、中央立繪、匯出圖同一個判準
                    （使用者回報 2026-08-29：「左上的替換機甲沒有跟著變動」）。
                    這一格與那三處講的是同一件事「這是哪一台」，各自答一次就會不一致。 */}
                <span className="truncate">{(ctx.identityMech ?? ctx.mech).name}</span>
                <span className="text-[10px] text-text-dim shrink-0">{ctx.mech.armorType}</span>
                {/* ⚠ **這顆卡片按下去換的是基底**，不是上面印的那台 —— 不講的話它會變成
                    「我按了帕斯卡，結果換掉的是整台」。面板抬頭寫「軀幹來源 · 基底 X」，
                    這裡欄位窄，只留後半段。 */}
                {ctx.identityMech && ctx.identityMech.id !== ctx.mech.id && (
                  <span className="text-[10px] text-text-dim shrink-0 whitespace-nowrap">
                    基底 {ctx.mech.name}
                  </span>
                )}
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
              // 分頁列已搬到「裝備與模組」面板抬頭（使用者回饋 2026-08-28：擺在 sticky 裡
              // 太不顯眼、找了一陣子才找到）。搬走之後這條 sticky 的數字就少了歸屬 ——
              // 捲到頁面下半部時，「3,675」看不出是哪一個形態的。這一行把形態名補回來：
              // 一個小標籤，不是第二排分頁（那會讓同一件事在畫面上出現兩次）。
              formName={setKeys.length > 1 ? equipSetLabel(activeKey, data.forms) : null}
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
            {/* 天賦條緊貼機師卡：兩者回答的是同一個問題（「這位機師帶來什麼」），
                而專武強化只有在天賦旁邊才對比得起來 */}
            <PilotTalentStrip
              ctx={ctx}
              skillMap={skillMap}
              loading={skillsLoading}
              onEquipWeapon={(ref, weaponId) => send({ type: 'equipWeapon', ref, weaponId })}
            />
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
          {/* ⚠ 窄版的天賦條只留縮圖不留名稱（`compact`）：這一欄同時是槽位圖那一欄，
              四個天賦名一路排下來會把槽位圖推出首屏。 */}
          {bp !== 'wide' && (
            <PilotTalentStrip
              ctx={ctx}
              skillMap={skillMap}
              loading={skillsLoading}
              compact={bp === 'narrow'}
              onEquipWeapon={(ref, weaponId) => send({ type: 'equipWeapon', ref, weaponId })}
            />
          )}
          {/* ⚠ 抬頭與機師卡的「更換機師」對稱：兩個主要選擇都在**自己的區塊裡**
              各有一顆換裝鍵，而不是只有機師有、機甲得回頂上的 HUD 找（PLAN-052-I 驗收） */}
          <Panel
            // ⚠ 不叫「槽位」（使用者要求 2026-08-28）：這張面板從 052-G 起就同時裝著
            //   武器槽位圖與四部位模組卡，而「槽位」只講到了上半部 —— 找模組的人
            //   會略過這個抬頭。抬頭要蓋住裡面實際有的兩件事。
            title="裝備與模組"
            // ⚠ 分頁列掛在**這裡**，不在 sticky 抬頭裡（使用者回饋 2026-08-28：
            //   「這邊有點不顯眼，我找了一陣子才找到形態切換的操作」）。
            //   原本的擺法是為了讓分頁與正下方的重量／出力條一起 sticky，
            //   但那一排混在機師／機甲／方案名稱那幾顆同色卡片之間，看起來像又一個欄位。
            //   面板抬頭是「這一套裝了什麼」的標題列 —— 分頁換的正是那個「這一套」，
            //   而且它就在槽位圖正上方，切完之後眼睛不用移動。
            //   代價（sticky 的數字失去歸屬）由 OutputBar 的 formName 標籤補上。
            titleExtra={(ctx.mech || setKeys.length > 1) ? (
              <span className="flex items-center gap-2 flex-wrap min-w-0">
                {ctx.mech && (
                  <>
                    {/* ⚠ 印的是**軀幹那台**（`identityMech`，使用者要求 2026-08-29）：
                        混搭之後「這是哪一台」由軀幹決定，中間的立繪也跟著它換。 */}
                    <span className={`${HUD.bodyStrong} text-text-primary truncate`}>
                      {(ctx.identityMech ?? ctx.mech).name}
                    </span>
                    {/* ⚠ 裝甲徽章一律取**基底**：混搭不能跨裝甲類型（總綱決策七）⇒ 兩者必然相同，
                        而這一格回答的是「這套配裝屬於哪個裝甲級距」，那是基底的屬性。 */}
                    <span className={`hud-cut-sm shrink-0 px-1.5 py-0.5 text-[11px] font-bold border border-current/40 bg-bg-dark/70 ${
                      ARMOR_TONE[ctx.mech.armorType] ?? 'text-text-secondary'
                    }`}>
                      {ctx.mech.armorType}
                    </span>
                    {/* ⚠ 兩者不同時**一定要把基底講出來**：右邊那顆「更換機甲」換的是基底，
                        不講的話它看起來像在換上面印的那台（＝軀幹來源）。 */}
                    {ctx.identityMech && ctx.identityMech.id !== ctx.mech.id && (
                      <span className="text-[11px] text-text-dim shrink-0 whitespace-nowrap">
                        軀幹來源 · 基底 {ctx.mech.name}
                      </span>
                    )}
                  </>
                )}
                {setKeys.length > 1 && (
                  <FormTabs
                    setKeys={setKeys}
                    activeKey={activeKey}
                    forms={data.forms}
                    sets={state.draft.sets}
                    onSelect={(key) => send({ type: 'setActiveSet', key })}
                    // 分頁列尾端的唯讀標記（C-1）。**不是分頁、不可點**——點進去什麼都不能改，
                    // 那是一個假的互動。它只負責回答「官方形態頁上的第四格呢」，
                    // 完整的說明在槽位圖下方那張 <LockedFormCard>。
                    // 視覺上靠 052-I 已定的規則分辨：切角＝可互動，圓角＝唯讀。
                    lockedForms={lockedForms}
                  />
                )}
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
                // 升級走的就是 `equipWeapon`（同一格換一把）—— 取代、toast、[復原] 全部沿用既有那條
                onUpgrade={(ref, weaponId) => send({ type: 'equipWeapon', ref, weaponId })}
                onOpenModule={openModule}
                activeModule={openModulePos}
                compact={compactRig}
                onOpenSlot={openSlot}
                onClearSlot={clearSlot}
                onApplyChassis={(sourceMechId) => send({ type: 'applyChassisOf', sourceMechId })}
              />
            ) : (
              <p className="text-[12px] text-text-dim leading-relaxed">
                選好機師與機甲之後，這裡會列出它全部的裝備槽位與模組接口。
              </p>
            )}
            {/* ⏸ 「選擇背包」按鈕已移除（PLAN-052-G C-8，使用者裁決 2026-08-27）：
                   它與槽位圖上的**背部**那一格是同一件事。背包在任何狀態下都是
                   ≤2 次點擊可達 —— `openSlot()` 依現況決定開哪一邊（已裝背包 → 背包清單；
                   否則 → 武器清單），而兩邊的挑選器抬頭都帶著「改選背包／改選背部武器」
                   的切換鍵（`backAlt` / `BACK_WEAPON_ALT`）。
                ⚠ 代價是「背槽也能放背包」要點進去才發現。可接受的理由是那個發現點
                   就在挑選器抬頭 —— 比一顆孤立在槽位圖外的按鈕更靠近使用情境。
                   若日後要補回入口，該補的是**背部那一格的空態文案**，不是這顆按鈕。 */}
          </Panel>

          {/* ── 唯讀形態卡（PLAN-052-F C-1）──
              位置刻意在**槽位圖之後**：這一欄由上而下回答的是「這一套裝了什麼」，
              而這張卡回答的是同一個問題的第四個答案（那個玩家改不了的形態）。
              放在槽位圖之前會把主操作區推下去，而它是一張讀完就不會再看的參考卡。
              ⚠ gate 用 `lockedCards`（＝有分頁列才有卡），不是 `ctx.mech`：
                沒選機甲時它仍然該出現——「這個形態鎖哪三把」與機甲無關，
                而那正是玩家還在挑機甲時會想知道的事。 */}
          {lockedCards.map(({ form, ctx: lockedCtx }) => (
            <LockedFormCard key={form.id} form={form} ctx={lockedCtx} />
          ))}

          {/* ── 攜帶技能（PLAN-052-L D-4，團隊回饋 3）──
              位置在**槽位圖之後、備註之前**。這一欄由上而下是「這一套裝了什麼」→
              「機師帶什麼上場」→「為什麼這樣配」→「它實際加了多少」。
              技能屬於第二個問題：它與武器一樣是「帶了什麼」，只是帶的是機師那一半。
              ⚠ 排在備註**之前**（備註是 C-4 定的「配完之後才問得出來的問題」），
                與匯出圖右欄的順序刻意不同 —— 圖上備註在最前面是因為那是分享者的話，
                而畫面上這一欄是操作區，操作在說明之前。
              ⚠ gate 用 `ctx.pilot` 而不是 `ctx.mech`：技能是**機師**的屬性，
                與 `ndLevels` 同一條（選機甲之前就該看得到、也該選得動）。 */}
          {ctx.pilot && (
            <Panel title="攜帶技能">
              <CarriedSkillRow
                pilot={ctx.pilot}
                skillMap={skillMap}
                loading={skillsLoading}
                carried={state.draft.skills?.carried ?? []}
                activeIndex={openSkillIndex}
                onOpenSlot={openSkillSlot}
              />
            </Panel>
          )}

          {/* ── 方案備註（PLAN-052-L C-4）──
              位置在**槽位圖之後、效果兩欄之前**：這一欄由上而下是「這一套裝了什麼」→
              「為什麼這樣配」→「它實際加了多少」。備註屬於第二個問題，而那個問題
              只有在配完之後才問得出來。
              ⚠ 不放進 sticky 抬頭（方案名稱在那裡）：那是一條**兩行的輸入框**，
                常駐在抬頭等於長期佔掉一整列，而多數人不會填它。
              ⚠ gate 用 `ctx.mech`，與方案名稱同一條：沒選機甲時整套配裝還不存在，
                這時填備註只會在換機甲時變成一句對不上的話。 */}
          {ctx.mech && (
            <LoadoutNoteField
              value={state.draft.note}
              onChange={(note) => send({ type: 'setNote', note })}
            />
          )}

          {/* ── 效果兩欄（使用者要求 2026-08-27）──
              模組與武器各佔半邊，收合態是縮圖、展開態是細節（見 `Panel` 的 `preview`）。

              ⚠ 兩欄的高度**刻意不對齊**（`items-start`）：一邊展開一邊收合是常態，
                拉成等高會讓收合的那一欄長出一大塊空白。
              ⚠ 窄版改單欄：半個中欄在窄版只剩 ~170px，縮圖排不下一行。 */}
          {ctx.mech && (
            <div className={`grid gap-3 items-start ${bp === 'narrow' ? 'grid-cols-1' : 'grid-cols-2'}`}>
              <Panel title="模組效果" preview={<ModuleThumbStrip ctx={ctx} />}>
                <EquippedEffects ctx={ctx} />
              </Panel>
              <Panel
                title="武器技能"
                preview={<WeaponSkillStrip ctx={ctx} skillMap={skillMap} loading={skillsLoading} />}
              >
                <WeaponSkillPanel ctx={ctx} skillMap={skillMap} loading={skillsLoading} />
              </Panel>
            </div>
          )}

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
              filters={MECH_FILTERS}
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
              hint={formWeaponHint(ctx)}
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
                同時常駐的話，中欄要讓出第四欄的寬度 —— 1440px 螢幕上只剩約 490px，
                低於 `LoadoutRig` 的 `DENSE_MAX_WIDTH`（570），機甲 HUD 會被逼進窄版，
                等於為了同時看見一份清單而把整頁的主視覺壓扁。
                （2026-08-27 放寬到 1920 之後，**滿版時**中欄約 640px 已經撐得住，
                 但那只成立於最寬的那一檔；門檻本身沒有變。）
                切換內容則沿用這一欄本來就有的行為（沒開挑選器時放機甲唯讀資訊），
                不新增 z-index 層級、focus trap 與 Esc 這三份互動負債。 */}
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
              // 一鍵裝滿不指定格 —— 動哪幾格由 `planModuleFill()` 決定（使用者要求 2026-08-27）
              onFill={(m) => send({ type: 'fillModule', moduleId: m.id })}
              onResolve={resolve}
              // 部件混搭（Phase D）。換成基底機甲＝還原為選定機甲，由 reducer 收掉那個鍵 ——
              // 呼叫端不必自己判斷該派 swapPart 還是 resetPart
              onSwapPart={(src) => send({
                type: 'swapPart', position: openModuleRef.position, sourceMechId: src.id,
              })}
            />
          )}

          {/* 技能面板 —— 切換鏈的第五種內容（PLAN-052-L D-4）。入口是中欄的三格 */}
          {(isMobile || !effectivePicker) && !openRow && !openModuleRef && openSkillIndex !== null && (
            <SkillPanel
              pilot={ctx.pilot}
              skillMap={skillMap}
              loading={skillsLoading}
              index={openSkillIndex}
              carried={state.draft.skills?.carried ?? []}
              onBack={() => setOpenSkillIndex(null)}
              onPick={(skillId) => send({ type: 'equipSkill', index: openSkillIndex, skillId })}
              onClear={(skillId) => send({ type: 'unequipSkill', skillId })}
            />
          )}

          {(isMobile || !effectivePicker) && !openRow && !openModuleRef && openSkillIndex === null && ctx.mech && (
            <Panel title="武器與元件">
              <WeaponComponentList
                ctx={ctx}
                budget={budget}
                activeRow={openRowKey}
                onOpen={(row) => setOpenRowKey(row.rowKey)}
              />
            </Panel>
          )}

          {/* ⏸ 「武器技能」與「模組效果」已於 2026-08-27 移到**中欄槽位圖下方**（使用者要求）。
                 兩者原本掛在這一欄，但這一欄只有 380px，兩個逐列展開的清單疊起來是一根長條，
                 而中欄下方（四部位卡以下）本來就是空的。搬過去後改成「收合＝縮圖／展開＝細節」，
                 並且**不再受挑選器開合影響** —— 開著挑選器挑武器時仍看得到目前的技能與加成，
                 那正是要比較的時候。 */}

          {(isMobile || !effectivePicker) && !openRow && !openModuleRef && openSkillIndex === null && ctx.mech && (
            <>
              {/* 四部位表 —— PLAN-052-G Phase D 復原（下架的兩個理由現在都不成立了）。
                  下架時的理由逐字是「四個部位現在 100% 固定來自本機甲，這裡列出來只是把
                  機甲詳情頁的同一張表再抄一遍」。混搭開放後它才開始回答「這一套是怎麼拼出來的」——
                  而那是槽位圖上的四張卡答不出來的：卡上只印得下一個來源名，
                  這張表同時給得出四格的重量、火力與合計。
                  ⚠ 一定要傳 `ctx.chassis`：這支元件自己 `resolveChassis(mech)` 會解出**選定機甲那台**，
                     於是表格印四行「彌造者」而上方總重是混搭後的數字，兩者當場打臉。
                  ⚠ MechPartsTable 自帶卡片框與標題（052-A 共用元件），不要再包一層 Panel。 */}
              <MechPartsTable
                mech={ctx.mech}
                chassis={ctx.chassis}
                nameOf={(id) => ctx.world.mechs.get(id)?.name}
              />
              {/* ⚠ 連的是**軀幹那台**（`identityMech`）：這一句緊接在四部位表下方，
                  而那張表逐格印的就是來源 —— 表上四行寫著帕斯卡、下面卻請人去看彌造者，
                  讀起來像連錯了。混搭時另外把基底那台也給一條路，不然它就沒有入口了。 */}
              <p className="text-[11px] text-text-dim leading-relaxed px-1">
                想看完整資料？前往
                <Link to={`/mechs/${(ctx.identityMech ?? ctx.mech).id}`} className="text-accent-orange no-underline mx-1">
                  {(ctx.identityMech ?? ctx.mech).name} 詳情頁
                </Link>
                {ctx.identityMech && ctx.identityMech.id !== ctx.mech.id && (
                  <>
                    ／基底
                    <Link to={`/mechs/${ctx.mech.id}`} className="text-accent-orange no-underline mx-1">
                      {ctx.mech.name}
                    </Link>
                  </>
                )}
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
          open title="選擇機甲" variant="mechCard" filters={MECH_FILTERS} selectedId={ctx.mech?.id}
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
          hint={formWeaponHint(ctx)}
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
          ref={barRef}
          className="fixed inset-x-0 z-40 border-t border-border-accent bg-bg-tooltip px-3 py-2"
          style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom))' }}
        >
          {/* ⚠ `flex-wrap`：390px ＋「大」字級下，超重時的六顆（複製連結／摘要／匯出圖／
              卸至符合／清裝備／全清空）排不進一列。不換行的代價不是難看，是最右邊那顆
              **整顆看不見也按不到**（本列沒有橫向捲軸）。換行造成的高度變化由上面的
              `barH` 量測吸收 —— 這是那個寫死常數退場的原因。 */}
          <div className="flex flex-wrap items-center gap-1.5">{actionButtons}</div>
        </div>
      )}

      {shelfOpen && <ShelfDialog
        onClose={() => setShelfOpen(false)}
        indexes={shareIndexes}
        world={world}
        currentCode={ctx.mech && !loading ? encodeCurrent() : null}
        pilotId={state.draft.pilotId ?? null}
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
          style={{ bottom: bp === 'narrow' ? raisedBottom : '1rem' }}
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
          style={{ bottom: bp === 'narrow' ? raisedBottom : '1rem' }}
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
          style={{ bottom: bp === 'narrow' ? raisedBottom : '1rem' }}
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
          // 圖印**當前這一套**（ctx 就是 activeKey 那一份），分享碼帶的是整份配裝 ——
          // 兩者語意不同，所以圖上要講出分頁總數（D-2）。
          setCount={setKeys.length}
          budget={budget}
          // 圖上印的是**生效**算力（含模組加成），來源另外用一行交代 —— 見 `NeuralDriveBand`
          ndLevels={ndLevelsEffective}
          ndBonus={ndBonus}
          ndAbilityMap={ndAbilityMap}
          ndZones={ndZones}
          name={state.draft.name}
          note={state.draft.note}
          skills={carriedSkillDocs}
          shareCode={exportShareCode}
          shareUrl={exportShareUrl}
          onDone={finishExport}
        />
      )}

      <CascadeToast
        notice={state.notice}
        raisedBottom={bp === 'narrow' ? raisedBottom : undefined}
        onUndo={() => send({ type: 'undo' })}
        onDismiss={() => send({ type: 'dismissNotice' })}
      />
    </div>
  )
}

// ─── 小元件與映射 ───────────────────────────────────────────────────────────

function Panel({
  title, titleExtra, action, preview, children,
}: {
  title: string
  /** 標題右側的補充（機甲名、裝甲徽章…） */
  titleExtra?: React.ReactNode
  /** 標題列最右邊的一顆動作鍵 */
  action?: { label: string; onClick: () => void; disabled?: boolean }
  /**
   * 收合態的內容（縮圖條）。**給了才變成可收合面板**，且預設是收合的。
   *
   * ⚠ 收合態刻意**不是空的**（使用者要求 2026-08-27）：一個收起來什麼都看不到的面板，
   *   等於把資訊藏進一顆要按的按鈕，玩家配裝時每換一把武器就得再按一次。
   *   收合＝縮圖（一眼知道「裝了什麼」），展開＝細節（讀得到「加多少、怎麼生效」）。
   *
   * ⚠ 預設收合而不是預設展開：這兩區加起來比槽位圖還長，展開態當預設會把
   *   四部位卡推出首屏 —— 而那是配裝的主操作區。
   */
  preview?: React.ReactNode
  children: React.ReactNode
}) {
  const collapsible = preview !== undefined
  const [open, setOpen] = useState(false)

  return (
    <section className={`${HUD_PANEL} p-3.5 space-y-2`}>
      {/* ⚠ `flex-wrap`：`titleExtra` 自 PLAN-052-F 起可能帶著形態分頁列（3 顆按鈕 ＋ 1 個唯讀標記），
          不換行的話 360px 上會把「彌造者」壓成一個字再加省略號。換行讓分頁自己掉到第二列，
          `action` 的 `ml-auto` 在第一列照舊靠右。 */}
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <h2 className={`${HUD.cardTitle} text-text-primary shrink-0`}>{title}</h2>
        {titleExtra}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className={`${HUD_BTN} ml-auto shrink-0 px-3 py-1 text-[12px] inline-flex items-center gap-1.5`}
          >
            <LoadoutIcon name="swap" className="w-3.5 h-3.5 shrink-0" />
            {action.label}
          </button>
        )}
        {collapsible && (
          // 互動語彙沿用「目前生效」那顆（NdActiveAbilities）——同一頁裡的兩顆收合鍵
          // 長得不一樣，會讓人以為它們做的是不同的事
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={`hud-cut-sm ml-auto shrink-0 px-2 py-0.5 text-[11px] border transition-colors cursor-pointer ${
              open
                ? 'border-accent-orange/50 text-accent-orange bg-accent-orange/10'
                : 'border-border text-text-secondary hover:border-border-accent'
            }`}
          >
            {open ? '▼ 收合' : '▶ 展開'}
          </button>
        )}
      </div>
      {collapsible && !open ? preview : children}
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
      // ⚠ 這兩顆（機師／機甲）長得像唯讀資訊欄 —— 它們**是按鈕**，點下去開挑選器。
      //   右側補一顆 `swap` 圖示：標籤不會有圖示，那是最短的一句「這裡按得下去」
      //   （使用者回報 2026-08-27：看不出哪裡可以按）。
      className={`hud-cut-sm flex-1 min-w-[9rem] max-w-[16rem] text-left px-2.5 py-1.5 border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed group ${
        active ? 'border-accent-orange bg-accent-orange/10' : 'border-border bg-bg-card hover:border-accent-orange/60'
      }`}
    >
      <div className={`${HUD.labelCjk} text-text-dim leading-tight`}>{label}</div>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className={`${HUD.bodyStrong} text-text-primary min-w-0 truncate`}>{children}</span>
        <LoadoutIcon
          name="swap"
          className="w-3.5 h-3.5 ml-auto shrink-0 text-text-dim group-hover:text-accent-orange transition-colors"
        />
      </div>
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
      // ⚠ 用 `HUD_INPUT`（切角 ＋ 2px 底線）：沒有底線時它看起來就是一顆長按鈕，
      //   玩家不會想到可以在裡面打字（使用者回報 2026-08-27）
      className={`${HUD_INPUT} block px-2.5 py-1.5 ${
        full ? 'w-full min-w-0' : 'flex-1 min-w-[10rem] max-w-[20rem]'
      } ${disabled ? 'opacity-40' : 'focus-within:border-accent-orange/60 focus-within:border-b-accent-orange'}`}
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


/**
 * 方案備註輸入框（PLAN-052-L C-4，團隊回饋 2）。
 *
 * ⚠ `raw` / `seen` 的 derived-state 模式**與 `LoadoutNameField` 逐字相同**，理由也相同：
 *   清洗會 trim 尾端空白與空行，直接把清洗結果餵回 textarea 的話，使用者按下 Enter
 *   的那一刻換行就被吃掉 —— 於是永遠打不出第二行。
 *
 * ⚠ **有字數計數器**（名稱那顆沒有）：名稱的上限靠 `maxLength` 就擋得住，
 *   而備註同時受「100 碼點」與「6 行」兩條限制，後者 `maxLength` 表達不了。
 *   不給計數器的話，第七行會在送出的那一刻無聲消失。
 *
 * ⚠ 提示文字要講出**它會被印在公開圖上**：這是全站唯一一個「使用者寫的字會出現在
 *   別人看到的圖上」的欄位，而匯出圖那一側也標了「由分享者填寫」。兩邊都講一次。
 */
function LoadoutNoteField({
  value, disabled, onChange,
}: {
  value: string | undefined
  disabled?: boolean
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
    setSeen(sanitizeLoadoutNote(next) ?? '')
    onChange(next)
  }

  // 碼點數，不是 `raw.length`（UTF-16）—— 上限本身就是用碼點算的
  const used = [...raw].length
  const over = used > LOADOUT_NOTE_MAX

  return (
    <label
      className={`${HUD_INPUT} block px-2.5 py-1.5 w-full min-w-0 ${
        disabled ? 'opacity-40' : 'focus-within:border-accent-orange/60 focus-within:border-b-accent-orange'
      }`}
    >
      <span className="flex items-baseline gap-2">
        <span className={`${HUD.labelCjk} text-text-dim leading-tight`}>方案備註</span>
        <span className="text-[11px] text-text-dim leading-tight">會印在匯出圖與分享碼上</span>
        <span className={`${HUD.numSm} ml-auto ${over ? 'text-accent-orange' : 'text-text-dim'}`}>
          {used} / {LOADOUT_NOTE_MAX}
        </span>
      </span>
      <textarea
        value={raw}
        disabled={disabled}
        rows={2}
        // ⚠ 這個 `maxLength` 是 UTF-16 長度、且**含換行**，只是別讓人打了一大段才發現被截。
        //   真正的上限（碼點數 ＋ 行數）由 `sanitizeLoadoutNote()` 決定。
        maxLength={LOADOUT_NOTE_MAX * 2}
        onBlur={() => setRaw(value ?? '')}
        onChange={(e) => handle(e.target.value)}
        placeholder={`為什麼這樣配？（最多 ${LOADOUT_NOTE_MAX_LINES} 行）`}
        className={`${HUD.body} w-full mt-0.5 bg-transparent text-text-primary placeholder:text-text-dim resize-y min-h-[2.6rem] focus:outline-none disabled:cursor-not-allowed`}
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

// ─── 機甲挑選器的篩選與排序（使用者要求 2026-08-29）──────────────────────────
//
// ⚠ **只有品質這一組，刻意沒有「裝甲類型」。** 機師的執照本來就把裝甲類型限死成一種
//   （中型執照 → 只有中甲），再給一排「輕型／中甲／重型」的晶片，其中兩顆按下去
//   必然是零筆 —— 那不是篩選，是把已經成立的限制再問一次。品質不同：S／A／B 在
//   任何一種執照底下都同時存在（線上 S 64 / A 16 / B 10），三顆都篩得出東西。
//   開不動的機甲仍由 `HiddenCountBar` 摺疊成一行計數，要看原因按一下就展開。

/**
 * 品質階序。**同時決定兩件事**：晶片的排列順序，以及清單的預設排序（S→A→B）。
 *
 * ⚠ 這份與 `MechsPage` 的 `QUALITY_ORDER` 是**兩份刻意分開的複本**，因為兩邊的排序
 *   優先序相反：圖鑑以「版本新→舊」為主鍵（看改版新增了什麼），挑選器以「品質」為主鍵
 *   （選裝時先問這台強不強）。共用一份常數不會讓兩邊的排序變成同一件事，只會讓
 *   下一個改其中一邊的人以為改了另一邊。
 *
 * `EX` 目前無機甲使用，先列著讓值域完整 —— `PickerShell` 會自動隱藏這份清單裡
 * 一筆都沒有的選項（見它的 `available`），所以列著不會多出一顆按了是零筆的晶片。
 */
const MECH_QUALITY_ORDER: Record<string, number> = { EX: 0, S: 1, A: 2, B: 3 }

const MECH_FILTERS: readonly PickerFilterGroup<Mech>[] = [
  {
    key: 'quality', label: '品質',
    // 不給 tone：同一個對話框裡機甲名已經用 `ARMOR_TONE` 上了色（輕型青／中甲紫／
    // 重型橘），品質晶片再上一組色會讓紫色同時代表「中甲」與「A 級」。
    // 武器／背包的品質晶片也是無色的，這裡跟著它們走。
    options: Object.keys(MECH_QUALITY_ORDER).map((q) => ({ value: q, label: q })),
    test: (m, v) => m.quality === v,
  },
]

/**
 * 登場版本轉成可比大小的數字。無版本回 -1（新→舊排序時自然沉到最後）。
 *
 * ⚠ **不用 `parseFloat`**（圖鑑那份用了）：`'3.10'` 會被解成 3.1，與 `'3.1'` 撞在一起。
 *   目前官方的次版號沒破過 8（1.0–1.8 → 2.0），所以圖鑑那份還沒踩到；
 *   這裡按段拆比較，多一行就不必賭它永遠不破 9。
 */
function debutRank(m: Mech): number {
  const [maj, min] = (m.debutVersion ?? '').split('.').map(Number)
  return Number.isFinite(maj) ? maj * 1000 + (Number.isFinite(min) ? min : 0) : -1
}

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
    // ── 種類：類型的**子篩選**（使用者要求 2026-08-27）────────────────────
    //
    // 「篩了格鬥就該看得到刀劍／長柄／電鋸」。這一排只在選了類型之後才出現，
    // 且只列得出該類型底下**這一格真的裝得上**的種類 —— 由 `PickerShell` 實測算出，
    // 這裡不維護任何「類型 → 種類」對照表（見 `dependsOn` 的註解）。
    //
    // ⚠ 選項刻意直接鋪 `WeaponKind` 全 17 值，包含「固定武裝」：多餘的值一律由
    //   `available` 濾掉（固定武裝被 `canEquipWeapon` 擋在挑選器外，永遠不會出現）。
    //   在這裡先手動剔除，等於把同一條規則寫兩次，而第二份會在官方新增種類時過期。
    key: 'kind', label: '種類',
    dependsOn: 'type',
    options: Object.values(WeaponKind).map((k) => ({ value: k, label: k })),
    test: (w, v) => w.kind === v,
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
 * 「這個形態只收某幾類武器」的說明（PLAN-052-F B-3）。
 *
 * ⚠ **這一條非有不可，因為那個規則今天在挑選器裡是完全隱形的。**
 *   `FORM_WEAPON_TYPE` 是 `structural` tier，而 052-I 驗收後 PickerShell
 *   把 structural 的項目**整批不列**（原本會摺疊成一行計數，改成不列的理由是
 *   「那一行對玩家沒有可行動的資訊」）。於是切到戰術形態、點開右手那一格，
 *   玩家看到的是一句「這一格沒有任何可裝的裝備。」—— 規則本身、以及規則講得
 *   一清二楚的那句「戰術形態只能裝備戰術類武器」，一個字都不會出現。
 *
 *   `canEquipWeapon()` 的那句 reason 之所以到不了畫面，是因為它只掛在被濾掉的列上。
 *   本函式把同一件事講在**清單之上**：不論清單是短了一截還是整個空掉，都看得到。
 *
 * ⚠ 不重複實作 allow 清單的判斷 —— 直接讀 `ctx.form.restrict`，
 *   與 `canEquipWeapon()` 的 `FORM_WEAPON_TYPE` 分支同一個來源。
 *   全鎖形態（`fixedArmament`）不走這裡：那是 `blockedReason()` 的 `ctx.lock`，
 *   整個挑選器降級，不是「清單短了一截」。
 */
function formWeaponHint(ctx: ReturnType<typeof buildContext>): string | null {
  const r = ctx.form?.restrict
  if (r?.kind !== 'weaponType') return null
  return `${ctx.form!.name}只能裝備${r.allow.join('／')}類武器，其餘不列入清單。`
}

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
    // ⚠ 判準是 `chassis.output`（**只有軀幹有出力**），所以缺數值的是**軀幹那台**，
    //   不是基底 —— 混搭時講錯名字會讓人去翻一台資料其實齊全的機甲。
    return `${(ctx.identityMech ?? ctx.mech)?.name ?? '這台機甲'}的官方數值尚未公布，無法計算可用出力，因此暫不提供配裝。`
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
