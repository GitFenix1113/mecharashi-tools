// 配裝摘要（純文字）—— PLAN-052-L E-1
//
// ── 這一支在補什麼 ─────────────────────────────────────────────────────────
// 團隊回饋 1：本站的優勢是「資料詳細、可引用」。而匯出圖是 **PNG** ——
// 不可搜尋、不可 Ctrl+F、不可貼進 wiki 的表格、不可被引擎索引。
// 這一支就是那個「真正可引用」的出口：同一套配裝，換成一段可貼進 Discord ／ wiki ／
// 論壇的純文字。
//
// ⚠ **內容與匯出圖是同一批裁決**，只是換一種載體。凡是圖上印的東西，
//   這裡一律走**同一支函式**取值（`rigLayout` / `moduleRows` / `printedNdZones`），
//   不自己再算一次：兩份東西講同一套配裝卻給出不同數字，讀者無從判斷哪一份是對的，
//   而且兩邊都不會報錯。逐條對照見下方各段的註解。
//
// ── 三條寫死的格式規則 ─────────────────────────────────────────────────────
//
// ⚠ ① **一個 markdown 記號都不能用**（星號／井號／減號／底線／大於號）。同一段文字會被
//     貼進至少三種渲染器：Discord（吃 markdown）、wiki（吃另一套）、純文字輸入框（都不吃）。
//     用了記號就得挑一種贏，另外兩種的讀者會看到滿地的星號。
//     ⇒ 階層一律用 `■` 與 `· ` 這種**本身就是字**的符號，在三種渲染器裡長得一樣。
//
// ⚠ ② **分享連結自己獨佔一行**。base64url 含底線，而 Discord 的斜體語法會把裸碼中間的
//     底線吃掉（`shareLink.ts` 檔頭那條）。網址被自動連結、不套 markdown，因此安全 ——
//     但前提是它整串在同一行、前後不黏其他字，否則有些用戶端會把行尾的標點也吃進連結。
//     ⚠ 同理**不印裸碼**：UI 上不給裸碼按鈕的理由，在這裡一字不差地成立。
//
// ⚠ ③ 數字一律 `en-US` 千分位（`3,120`）。用不帶 locale 的 `toLocaleString()` 會讓
//     同一套配裝在不同人的機器上複製出不同的字串，而那不會有任何錯誤訊息。
//
// 純函式、無 React 依賴，可單測（npm test）。

import type { NeuralDriveAbility, PilotSkillDoc } from '../types'
import type { LoadoutBudget, LoadoutContext } from './loadoutRules.ts'
import { rigLayout, rigSlots } from './rigLayout.ts'
import { moduleRows, slotComponentNames, wastedModuleStacks } from './loadoutRows.ts'
import { defaultNdLevels, printedNdZones, zonePower } from './ndOverrides.ts'
import type { NdPowerBonus } from './ndPowerBonus.ts'
import { resolveNeuralDriveLevel } from './neuralDriveAbilities.ts'
import { SITE_NAME } from '../lib/siteMeta.ts'

export interface LoadoutSummaryInput {
  ctx: LoadoutContext
  budget: LoadoutBudget
  /**
   * 已疊過 `defaultNdLevels` 的完整算力配置（與匯出圖收的是同一份）。
   *
   * ⚠ 呼叫端要傳**生效值**（`effectiveNdLevels()`，含模組加成），來源由 `ndBonus` 交代。
   */
  ndLevels: Record<string, number>
  /**
   * 模組給的算力加成（PLAN-052-M）。沒有就省略 —— 那一行整個不印。
   * ⚠ 與匯出圖收的是同一筆，兩邊必須講同一件事。
   */
  ndBonus?: NdPowerBonus | null
  ndAbilityMap: Map<string, NeuralDriveAbility>
  /** 方案名稱。沒有就用機師名當標題（同匯出圖：留白會讓整段看起來像沒做完） */
  name?: string
  /** 方案備註（PLAN-052-L C-5）。沒填時整段不印 */
  note?: string
  /** 攜帶技能，**已由呼叫端解析好**（同匯出圖，這一層不查表） */
  skills?: readonly PilotSkillDoc[]
  /** 這位機師一共幾個配裝分頁。大於 1 時要講出「連結帶的是整份、上面是一套」 */
  setCount?: number
  /**
   * 完整分享連結。**編不出來時整行不印**（同匯出圖的 `shareCode`）——
   * 印一個佔位字串會有人拿去貼，而它打不開。
   */
  shareUrl?: string
  /** 產生日期 `YYYY-MM-DD`。由呼叫端傳入，本函式才是純的 */
  generatedAt: string
  /** 遊戲版本（如 `3.3`）。取不到時省略該欄，不猜 */
  gameVersion?: string
}

/** 見檔頭規則③：固定 `en-US`，不吃執行環境的 locale。 */
const num = (n: number): string => n.toLocaleString('en-US')

/**
 * 官方敘述裡的換行**壓成一個空格**。
 *
 * 匯出圖用 `white-space: pre-line` 原樣保留（實測 186 顆模組有 33 顆含換行），
 * 但在這裡換行會把 `· ` 的階層打斷 —— 第二行看起來像另一個項目。
 *
 * ⚠ 只壓**官方敘述**，不壓備註：備註的換行是使用者自己打的
 *   （`sanitizeLoadoutNote()` 特地留著它，那是備註與方案名稱唯一的實質差別）。
 */
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * 一套配裝 → 一段可貼到任何地方的純文字。
 *
 * 段落順序刻意與匯出圖由上而下一致（身分 → 重量 → 裝備 → 模組 → 算力 → 技能 → 備註 →
 * 出處），這樣「圖與文字對照著看」不需要在兩份東西之間跳。
 */
export function loadoutSummaryText(input: LoadoutSummaryInput): string {
  const { ctx, budget } = input
  const out: string[] = []

  // ── 身分 ──────────────────────────────────────────────────────────────────
  // 同匯出圖：未命名時**把機師名升成主標**，而不是印一行「未命名配裝」再印一次機師名。
  const title = input.name || ctx.pilot?.name || '未命名配裝'
  out.push(`【${title}】`)

  const idParts: string[] = []
  if (input.name && ctx.pilot?.name) idParts.push(ctx.pilot.name)
  // ⚠ 印**軀幹那台**（`identityMech`），與畫面抬頭、立繪、匯出圖同一個判準。
  //   混搭時基底也要講出來，否則這段文字與站上的畫面會對不起來。
  const mechName = ctx.identityMech?.name ?? ctx.mech?.name ?? '未選機甲'
  idParts.push(
    ctx.identityMech && ctx.mech && ctx.identityMech.id !== ctx.mech.id
      ? `${mechName}（基底 ${ctx.mech.name}）`
      : mechName,
  )
  if (ctx.mech?.armorType) idParts.push(ctx.mech.armorType)
  if (ctx.form?.name) idParts.push(ctx.form.name)
  out.push(idParts.join(' · '))

  // ── 重量 ──────────────────────────────────────────────────────────────────
  // ⚠ 這是全文唯一的強度相關數字。**火力不印**（使用者裁決 2026-08-29）：
  //   `chassisFirepower()` 不含元件、模組、天賦，而讀者會拿它去比兩套配裝的強弱。
  const w = budget.weight
  out.push(budget.dataIncomplete
    // ⚠ 不印破折號：那會被讀成「本站算不出來」。講清楚是官方還沒公布
    ? `重量 ${num(w.total)} ／ 出力 ${num(budget.output.total)}（官方數值未公布，餘量無法計算）`
    : `重量 ${num(w.total)} ／ 出力 ${num(budget.output.total)}・${
      budget.over ? `超重 ${num(Math.abs(budget.remaining))}` : `餘 ${num(budget.remaining)}`}`)
  // 「手部取較重者」是最容易被誤判成本站少算的一條規則 —— 有備用組時一定要講。
  if (ctx.capacity.backupHand > 0) {
    out.push(`（手部取主手／備用較重者，${w.heavierBank === 'main' ? '備用組' : '主手組'} ${
      num(Math.min(w.mainHand, w.backupHand))} 未計入）`)
  }

  // ── 裝備 ──────────────────────────────────────────────────────────────────
  // 走 `rigLayout()`／`rigSlots()`，順序與匯出圖的十字**逐格一致**。
  //
  // ⚠ 六種狀態一個都不能少（計畫書決策三）。位置化時最自然的做法是收成
  //   「已裝／空槽／無槽」三種 —— 那會靜默丟掉 `fixed`（機甲焊死）與 `formLocked`
  //   （形態鎖定），而那是唯一在說「這一格你換不了」的訊號。
  const slots = rigSlots(rigLayout(ctx))
  const usedSlots = slots.filter((s) => s.name !== null).length
  const realSlots = slots.filter((s) => s.state !== 'absent').length
  out.push('', `■ 裝備（已裝 ${usedSlots} / ${realSlots} 格）`)
  for (const s of slots) {
    if (s.state === 'absent') {
      out.push(`· ${s.label}：無此槽位 —— ${s.note}`)
      continue
    }
    if (s.name === null) {
      out.push(`· ${s.label}：未裝備`)
      continue
    }
    const bits: string[] = []
    // ⚠ `weight === 0` 與 `weight === null` 不是同一件事：純封鎖型固定武裝
    //   （嵐質儲能艙／多功能彈倉）的重量是真的 0。照印數字、null 就整個不寫。
    if (s.weight !== null) bits.push(`重 ${num(s.weight)}`)
    if (s.note) bits.push(s.note)
    // ⚠ 雙手武器的第二格（`echo`）**不重印元件**：`weaponSiteAt()` 比對的是覆蓋範圍，
    //   從左右任一手都查得到同一把 —— 照查會讓同一組元件在文字裡出現兩次。
    if (s.ref && s.dual !== 'echo') {
      const comps = slotComponentNames(ctx, s.ref)
      if (comps.length > 0) bits.push(`元件：${comps.join('・')}`)
    }
    out.push(`· ${s.label}：${s.name}${bits.length > 0 ? `（${bits.join('｜')}）` : ''}`)
  }

  // ── 模組 ──────────────────────────────────────────────────────────────────
  // 與匯出圖共用 `moduleRows()`（E-1 自 `ModuleBand` 抽出），連同族去重的規則一起。
  const mods = moduleRows(ctx)
  const wasted = wastedModuleStacks(ctx)
  if (mods.length > 0 || wasted.length > 0) {
    out.push('', `■ 模組（${mods.length} 顆）`)
    for (const m of mods) {
      const lv = m.stack ? ` Lv${m.stack.level} / ${m.stack.cap}` : ''
      out.push(`· ${m.label}：${m.name}${lv}`)
      if (m.dup) out.push('  同族疊加，效果不重複計算')
      else if (m.description) out.push(`  ${oneLine(m.description)}`)
    }
    for (const st of wasted) {
      out.push(`· ⚠ ${st.mod.name} 裝了 ${st.positions.length} 顆、合計 ${st.sum} 級，但上限 ${
        st.cap} 級 —— 超出的 ${st.overflow} 級不生效`)
    }
  }

  // ── 神經驅動算力 ──────────────────────────────────────────────────────────
  // γ 恆印、α／β 只在偏離預設時印 —— 判斷走共用的 `printedNdZones()`（見那支的 ⚠）。
  //
  // ⚠ **只印能力名、不印能力敘述**。圖上印全文是因為圖只有一頁、讀者無法點開查證；
  //   這段文字則是要被貼到別處**引用**的，而滿級 γ1 一區就有 6 條敘述
  //   （實測 440 筆 p50 26 字），全塞進來會讓整段文字的一半是官方文案。
  //   要查敘述的人手上有連結。
  //
  // ⚠ **不印 ★ 標記**（圖上有）：★ 的意思是「這一區會就地改寫天賦與技能敘述的階名」，
  //   而這段文字裡根本沒有天賦與技能敘述可改 —— 印一個指向不存在之物的符號比不印更糟。
  const drives = ctx.pilot?.neuralDrive ?? []
  if (drives.length > 0) {
    const defaults = defaultNdLevels(drives, (aid) => input.ndAbilityMap.get(aid))
    const shown = printedNdZones(drives, input.ndLevels, defaults)
    if (shown.length > 0) {
      out.push('', '■ 神經驅動算力')
      for (const d of shown) {
        const lv = input.ndLevels[d.name] ?? 0
        const names = (d.levels ?? [])
          .filter((l) => l.level <= lv)
          .map((l) => resolveNeuralDriveLevel(l, input.ndAbilityMap).name)
          .filter((n) => !!n)
        // ⚠ 不印任何合計分母：`ND_RULES.gammaPairCap = 23` 是**雙區**共用預算，
        //   而全庫有 10 位 1.0 老角只有單一個 γ 區（分區名就是單一字元 γ，天花板 16）——
        //   印 `16 / 23` 會讀成「還差 7 沒點滿」，而那 7 點永遠不存在（問題②）。
        // 落點那一區的算力已含加成（呼叫端傳的是生效值），來源在下面補一行
        const mark = input.ndBonus?.zone === d.name ? '⊕ ' : ''
        out.push(`· ${mark}${d.name} Lv${lv}（算力 ${zonePower(d, lv)}）${names.length > 0 ? `：${names.join('、')}` : ''}`)
      }
      // ⚠ 有加成就一定要講來源：上面印的是**生效**算力，而玩家在遊戲裡點的是投入值，
      //   兩者差一級。不講的話，讀的人會拿它去對自己的畫面然後以為本站算錯。
      if (input.ndBonus) {
        out.push(input.ndBonus.zone
          ? `（⊕ ${input.ndBonus.moduleName} LV.MAX：算力最低的分區 +${input.ndBonus.amount} —— 落在 ${input.ndBonus.zone}，上面的 Lv 已含這一級）`
          : `（⊕ ${input.ndBonus.moduleName} LV.MAX：算力最低的分區 +${input.ndBonus.amount} —— 但 γ 區已滿級，這 ${input.ndBonus.amount} 點沒有落點）`)
      }
      if (shown.length < drives.length) {
        out.push('（本摘要只列 γ 區 —— 仿生超導體投入的差異在這裡；α／β 固定滿級）')
      }
    }
  }

  // ── 攜帶技能 ──────────────────────────────────────────────────────────────
  // ⚠ 不印敘述、不印格數分母（第四格「改」技能站上沒有資料，算進分母會讓人以為漏了一個）。
  const skills = input.skills ?? []
  if (skills.length > 0) {
    out.push('', '■ 攜帶技能')
    for (const sk of skills) out.push(`· ${sk.name}${sk.type ? `（${sk.type}）` : ''}`)
  }

  // ── 備註 ──────────────────────────────────────────────────────────────────
  // ⚠ 「由分享者填寫」是**必要的反釣魚標記**（計畫書 C-5）：備註與這段文字裡其他每一段
  //   共用同一套排版，而其他每一段都是本站從遊戲資料算出來的。不標的話，
  //   一句「這套打 XX 副本必過」會被讀成本站的判斷。
  // ⚠ 換行原樣保留（見 `oneLine()` 的 ⚠）。
  if (input.note) out.push('', '■ 備註（由分享者填寫，非本站資料）', input.note)

  // ── 出處 ──────────────────────────────────────────────────────────────────
  // ⚠ 免責必留、而且比改版前**更需要**：這段文字印的是「照本站推算的模組等級取出來的
  //   官方敘述」，推導層數比印攤平數值時還多一層。
  out.push('', '（數值以武器滿級 LV.70 與滿品質階為前提；模組等級由部位品質階與部位種類推算，效果取該等級的官方敘述）')
  if (input.shareUrl) {
    // ⚠ 上面印的是**一套**、連結帶的是**整份**（PLAN-052-F D-2）。收到這段文字的人
    //   手上只有這段文字，不講的話他會以為連結點開只有上面這一套。
    out.push('', (input.setCount ?? 1) > 1
      ? `分享連結（含 ${input.setCount} 個形態分頁）`
      : '分享連結')
    // ⚠ 獨佔一行，見檔頭規則②。
    out.push(input.shareUrl)
  }
  out.push(`${SITE_NAME} · 配裝模擬器 · ${input.generatedAt}${
    input.gameVersion ? ` · 遊戲版本 ${input.gameVersion}` : ''}`)

  return out.join('\n')
}
