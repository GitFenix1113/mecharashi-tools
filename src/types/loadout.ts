// ─── 配裝草稿模型（PLAN-052-B Phase A / A-1）─────────────────────────────────
//
// 「一套配裝是什麼形狀」的唯一定義。落盤格式（分享碼）是 052-C 的事，本檔只管
// **記憶體中的結構化型別** —— 總綱決策二逐字：「落盤是一串分享代碼，記憶體是結構化型別」。
//
// ⚠ 不另造第四套部位詞彙（PLAN-047 決策一）：`slot` 沿用 `WeaponEquipSlot`、
//   `bank` 沿用 `SlotBank`、座標一律走 `slotKey()`。本檔只是把「一格裝了什麼」補上。

import type { SlotBank, SlotSide } from './slots'
import type { MechPartPosition, WeaponEquipSlot } from './enums'

/**
 * 掛在**這一把武器上**的元件／改裝設定。
 *
 * ⚠ **內嵌在 mount 上，不旁掛 `Record<SlotKey, …>`**（總綱決策二）：旁掛表與 mounts 陣列
 *   是兩份要手動同步的資料，刪掉左手武器忘了刪 key，下一把同槽武器會**靜默繼承**
 *   上一把的元件。與 form.ts 拒絕 lockedSkillIds、weapon.ts 拒絕反向索引是同一條理由。
 *
 * 本輪（052-B）不渲染元件面板（052-D），欄位先開好讓 mount 的形狀不必再遷移一次。
 */
export interface MountSetup {
  /** 觸元件 doc id（上限見 Weapon.componentLimit，規則在 052-D） */
  triggerComponentIds?: string[]
  /** 應元件 doc id */
  effectComponentIds?: string[]
}

/**
 * 一格上裝著的武器。
 *
 * ⚠ **`dualHand` 是一筆 mount，不是兩筆**：雙手武器佔滿左右臂，但它是一把武器、
 *   一組元件。存成兩筆會讓元件設定分裂成兩份（改一邊不改另一邊，靜默不同步），
 *   也會讓「卸下」變成必須成對操作。渲染時才由 `LoadoutRig` 合併成一個寬格。
 *
 * ⚠ **不開武器等級欄位**（總綱決策十）：LV.70 是武器等級、與改裝無關，
 *   而「70 級才開始，70 以下的事情都沒有資格被考慮」⇒ 全站一律滿級假設。
 *   開一個恆為 70 的欄位，只會讓分享碼多帶一個永遠不變的位元組。
 */
export interface LoadoutMount {
  weaponId: string
  bank: SlotBank
  slot: WeaponEquipSlot
  /** 單手／肩部必填；雙手與背部不得填（與 `ArmamentMount` 同一條不變式） */
  side?: SlotSide
  setup?: MountSetup
}

/**
 * 一個形態（或無形態機師的 `default`）的整套裝備。
 *
 * ⚠ `mounts` 是**所有已裝備武器的唯一清單，背部武器不例外**。不要為了「背槽比較特別」
 *   而另開 `backWeaponId` —— 那會讓每一支走訪武器的程式都得記得多看一個欄位，
 *   而漏看的症狀是靜默少算一把武器的重量。
 *
 * ⚠ `backpackId` **不存 `null`，用「欄位不存在」表示沒有**：三態（有值／null／undefined）
 *   撞上 `stripUndefined`（firestoreCore.ts）會變成「一旦填了就再也清不掉」——
 *   PLAN-047 決策六與被凍結的 `Mech.leftShoulderSlot` 都栽在這裡。
 *
 * ⚠ 背包與背部武器**共用同一格**（`main:back`）。型別上不擋，因為擋不住——
 *   互斥由 `loadoutRules` 的 BACK_SLOT_TAKEN 統一處理（SlotCapacity.back = 1）。
 */
export interface EquipSet {
  mounts: LoadoutMount[]
  backpackId?: string
}

export const EMPTY_EQUIP_SET: EquipSet = { mounts: [] }

/**
 * 一份配裝草稿：一位機師 ＋ 一台機甲 ＋ 每個形態各一套裝備。
 *
 * ⚠ `sets` 的鍵一律來自 `equipSetKeys(pilotId, forms)`（src/utils/forms.ts），
 *   **UI 禁止 map over `Object.keys(sets)`**：後者是「已經存過東西的分頁」，
 *   新建的配裝一個鍵都沒有 → 分頁整排消失；而且鍵的順序由寫入順序決定。
 *
 * ⚠ 全鎖形態（海莉絲虛粒子／曜巡航）**不出現在 sets 裡**（總綱決策四）：
 *   那一套 100% 由 `form.restrict.mounts` derive，落盤第二份就有兩份對不上的可能，
 *   而玩家本來就改不了。
 *
 * `mechId` / `pilotId` 用選填而非 `null`，理由同 `backpackId`。
 */
export interface LoadoutDraft {
  pilotId?: string
  mechId?: string
  /**
   * 方案名稱（PLAN-052-I E-1）。顯示在主版面標題列，並且是匯出長圖上**最大的一行**。
   *
   * ⚠ 一律經 `sanitizeLoadoutName()`（`src/utils/loadoutName.ts`）之後才進來：
   *   換行會把匯出圖的版面撐開、控制字元會渲染成豆腐格、雙向覆寫字元會讓圖上的字
   *   與輸入框裡的字順序不同。清洗放在寫入邊界（reducer 的 `setName` ＋ `reconcile`），
   *   不放渲染端 —— 渲染端清洗會讓「存進去的」與「看到的」是兩個字串，而落盤的是髒的那個。
   *
   * ⚠ 未命名時**欄位不存在**（同 `backpackId` / `ndLevels`），不存空字串。
   *
   * ⚠ **命名不需登入**（052-E A-2 裁決，2026-08-29）：原本總綱寫「命名與雲端保存需登入」，
   *   但名稱早已編進分享碼的 `§NAME` 段、也印在匯出圖上，回頭 gate 會讓訪客既有的分享碼與
   *   匯出圖失去名稱，換來的好處是零（名稱不佔 Firestore、不是特權、也不是配額）。
   *   **只有「存到雲端」需要登入**（見本檔 `CloudBuildDoc`）。
   */
  name?: string
  /** 目前顯示中的分頁鍵。恆為 `equipSetKeys()` 的成員之一，由 reconcile 保證 */
  activeSetKey: string
  sets: Record<string, EquipSet>
  /**
   * 神經驅動算力配置：**分區名 → 選定 Lv**（PLAN-052-I D-2）。
   *
   * ⚠ **放頂層、不放進 `EquipSet`**：算力是機師的屬性，不隨形態變動。掛在 set 上會讓
   *   同一位機師的三個形態分頁各存一份算力，而玩家改了其中一頁之後，另外兩頁的天賦
   *   敘述會與這一頁不一致 —— 那是同一個機師的同一條神經驅動。
   *
   * ⚠ **不存 `null`，用「欄位不存在」表示未設定**（同 `backpackId`）：三態撞上
   *   `stripUndefined`（firestoreCore.ts）會變成「一旦填了就再也清不掉」。
   *   未設定時由 `defaultNdLevels()`（ndOverrides.ts）供應預設值 —— 那份預設會隨機師的
   *   `buffUpgrades` 決定給 Lv1 還是滿級，寫死一份初始值必然與它漂移。
   *
   * ⚠ 鍵是**分區名**（`NeuralDrive.name`，如 `γ1`）而不是索引：分區數與順序逐機師不同，
   *   索引在換機師時會靜默指到另一條神經驅動上。`reconcile()` 會掃掉不屬於目前機師的鍵。
   *
   * ⚠ 門檻與上限**一律問 `src/utils/ndOverrides.ts`**（`ND_RULES.gammaPairCap` / `zonePower()`），
   *   本檔不複製第二份 —— 那份與 PLAN-034 的 BUFF 階覆寫層共用，各留一份必然漂移。
   *
   * 052-C 的 codec v1 必須把這一段一起編碼；v1 上線後再補等於升版本並遷移既有分享碼。
   */
  ndLevels?: Record<string, number>
  /**
   * 部件混搭：**部位 → 來源機甲 doc id**。只記與選定機甲不同的部位（PLAN-052-G）。
   *
   * ⚠ **052-C 的 codec v1 先開這個欄位，UI 與 `reconcile()` 由 052-G 補。**
   *   理由是總綱決策八「MVP 三件不能省的事」第②條：分享碼同時是唯一的落盤格式，
   *   v1 不含這一段，等 052-G 上線時玩家選的部件就存不下來，而畫面看起來一切正常。
   *   欄位先在、值恆為 undefined，代價只是型別多一行；反過來則要遷移所有已存的分享碼。
   *
   * ⚠ 今天沒有任何程式會寫入它，因此 `reconcile()` 也**還不會**在換機甲時清掉它。
   *   052-G 接手時第一件事就是補上那條級聯 —— 換了機甲卻留著舊機甲的部件是靜默的錯。
   */
  parts?: Partial<Record<MechPartPosition, string>>
  /**
   * 模組接口：**部位 → 模組 doc id**，每個部位一個（PLAN-052-G）。
   *
   * ⚠ **不存 level**（總綱決策六）：模組等級由「部位品質階級 × 部位種類」推導，
   *   存下來就是第二個真相源。等級一律由 `ResolvedChassis` 出。
   *
   * 與 `parts` 同理，欄位由 052-C 的 codec v1 先開，UI 與級聯屬 052-G。
   */
  modules?: Partial<Record<MechPartPosition, string>>
}

/** 沒有機師也沒有機甲的空草稿。`activeSetKey` 用 forms.ts 的保留字，不用空字串。 */
export const EMPTY_DRAFT: LoadoutDraft = {
  activeSetKey: 'default',
  sets: {},
}

// ─── 雲端存檔的落盤形狀（PLAN-052-E B-1）─────────────────────────────────────
//
// `users/{uid}/builds/{pilotId}` —— **一位機師一份文件**，`slots` 是 `'0'`～`'4'` 的 map，
// 每一格的內容就是一串 base64url 分享代碼（總綱決策二：儲存＝分享，沒有第二套序列化）。
//
// ⚠ **刻意放在 loadout 領域而不是 `types/user.ts`**：它屬於配裝而不是使用者，而 `user.ts`
//   裡那份 v1 `Build` 正要被 B-6 刪掉 —— 兩份存檔型別擺在同一個檔，會讓「哪一個是現行的」
//   變成要用讀的才知道。
//
// ⚠ **只存代碼**（比照 `localBuilds.ts` 規則①）：不存機師名快照、不存機甲名、不存解好的
//   草稿。卡片上要顯示的一切都由代碼**當場解**出來 —— 第二個真相源遲早會與第一個對不上，
//   而對不上的那天不會有任何錯誤訊息。
//
// ⚠ 與訪客本機書架**語意不同**：訪客是「本機書架 7/10」（全站共用一個配額），
//   登入者是「海莉絲 3/5」（每機師各 5 格）。UI 文案要分開寫。

/** 一位機師的五個存檔格。**map key 而非陣列索引** —— 見 `CLOUD_SLOTS_PER_PILOT`。 */
export type CloudSlot = '0' | '1' | '2' | '3' | '4'

/** 五個合法格位，順序即顯示順序。 */
export const CLOUD_SLOTS: readonly CloudSlot[] = ['0', '1', '2', '3', '4']

/**
 * 每位機師的存檔格數。
 *
 * ⚠ 這個數字在 `firestore.rules` 裡有**第二份**（`slots.keys().hasOnly(['0','1','2','3','4'])`）。
 *   規則語言讀不到 TS 常數，兩邊只能手動同步，而**規則才是權威**：規則沒放行的格子，
 *   client 寫進去只會拿到 403。改這裡就要一起改那裡，並補一條 emulator 測試。
 *
 * 用 map key 白名單而不是「一個計數欄位」：5 格因此是**結構性事實**而不是一個會漂移的數字
 *   —— 計數欄位可以被 client 寫成 99，key 白名單不行。
 */
export const CLOUD_SLOTS_PER_PILOT = 5

/**
 * 單格代碼的字元上限，與 `firestore.rules` 的 `size() <= 4096` 同步。
 *
 * **為什麼是 4096 而不是計畫書原訂的 1024**（052-E B-4 實測後裁決，2026-08-29）：
 * 這個數字刻意與 codec 自己的解碼上限 `LIMITS.codeChars` **對齊** —— 兩邊不一致就會出現
 * 一段「解得開卻存不了」的落差，而落差裡的症狀是「這一套存不進去，別的可以」，
 * 使用者無從得知為什麼。實測（B-4）：
 *
 * | 情境 | 碼長 |
 * |---|---|
 * | 今天真實滿載（海莉絲 3 形態 × 7 mount × 4 元件 ＋ 4 部件 ＋ 4 模組 ＋ 24 字名稱） | 654–686 |
 * | 號碼全滿（shareId 吃滿 3-byte varint）＋ 真實形態鍵 | 842 |
 * | 號碼全滿 ＋ 形態鍵吃滿 64 bytes | 1006 |
 * | 號碼全滿 · **4 套形態** | **1051** ← 1024 在這裡就破了 |
 *
 * 每多一套獨立形態約 **+160 字元**。官方哪天給某位機師第 4 套形態，1024 就會開始拒收，
 * 而依決策二自己的規矩「上限只能放寬、不能收緊」——挑小了才是不可逆的錯。
 * 單份文件最壞 5 × 4096 ≈ 20 KB，對 Firestore 的 1 MiB 上限無感；而 A-3 已裁決接受
 * 「文件份數無界」，所以每格上限本來就不是真正的防濫用手段，它的工作是**別誤殺合法存檔**。
 *
 * ⚠ 規則語言的 `string.size()` 回的是**字元數**不是位元組數。base64url 全為 ASCII，
 *   所以「4096 字元 == 4096 bytes」**剛好**成立 —— 這是巧合不是保證：
 *   **這一格只准放 base64url**。哪天有人往裡面塞中文，上限就悄悄變成 16 KB。
 *
 * ⚠ 與 `LIMITS.codeChars` 的一致性由 `codec.test.ts` 釘住（不在此 import，
 *   否則 `types/` 會反向依賴 `utils/loadoutCode/`，而 codec 本來就 import 本檔）。
 */
export const CLOUD_CODE_MAX_CHARS = 4096

/** `'0'`～`'4'` 以外一律不是合法格位（外來輸入的唯一入口）。 */
export function isCloudSlot(x: unknown): x is CloudSlot {
  return typeof x === 'string' && (CLOUD_SLOTS as readonly string[]).includes(x)
}

/**
 * 一位機師的雲端存檔文件。doc id **就是** `pilotId`。
 *
 * ⚠ `slots` 是 `Partial`：**沒存的格子沒有那個 key**，不是空字串。空字串會通過
 *   「有沒有這一格」的檢查卻解不出任何東西，UI 會渲染出一張空白卡片。
 */
export interface CloudBuildDoc {
  slots: Partial<Record<CloudSlot, string>>
  /** ISO 字串（與 `profile` 同慣例）。整份文件一個，不是每格一個。 */
  updatedAt: string
}
