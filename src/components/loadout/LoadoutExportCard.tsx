import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { toPng } from 'html-to-image'
import type { Component, NeuralDrive, NeuralDriveAbility, Pilot, PilotSkillDoc } from '../../types'
import { hasMechArt, imageCandidates, pilotFullArtPath, mechKeyArtPath } from '../../utils/assets'
import { FallbackImage } from '../common/FallbackImage'
import { moduleRows, slotComponents, wastedModuleStacks, weaponRows } from '../../utils/loadoutRows'
import { ComponentsWType } from '../../types/enums'
import type { WeaponSlotRef } from '../../types/slots'
import { rigLayout, rigSlots } from '../../utils/rigLayout'
import { defaultNdLevels, printedNdZones, zonePower } from '../../utils/ndOverrides'
import type { NdPowerBonus } from '../../utils/ndPowerBonus'
import { resolveNeuralDriveLevel } from '../../utils/neuralDriveAbilities'
import type { LoadoutBudget, LoadoutContext } from '../../utils/loadoutRules'
import { moduleFamilyKey } from '../../utils/moduleRules'
import { SEG_LABEL, type SegKey } from './loadoutTheme'
import { ExportRig, ExportRigLegend } from './export/ExportRig'
import { C, EXPORT_PIXEL_RATIO, MONO, ORB, SEG_HEX } from './export/exportTheme'
import { loadoutQr } from '../../utils/loadoutQr'
import { usePatchVersions } from '../../hooks/usePatchVersions'
import { SITE_DOMAIN, SITE_NAME, SITE_TITLE } from '../../lib/siteMeta'
import { nextFrames } from '../../utils/nextFrames'

// ─── 匯出配裝長圖（PLAN-052-I E-2）──────────────────────────────────────────
//
// **不共用螢幕版面，這是刻意的**（計畫書 E-2 逐字）。螢幕版面的每一個決定都建立在
// 「可以捲、可以點、可以 hover」之上；印刷品一個都沒有。共用的結果會是兩邊互相拖累：
// 螢幕版要為了截圖犧牲互動，截圖要為了螢幕版留下點不動的按鈕。
//
// ⚠ **固定 1000px 寬、高度隨內容**。寬度固定是因為 toPng 的產出尺寸就是這個元素的尺寸，
//   而分享出去的圖需要一個可預期的寬度；高度不固定是因為槽位數、算力分區數、能力數
//   逐機師不同 —— 寫死高度的下場是內容被裁掉，而裁掉的是最下面的算力表。
//
// ⚠ **內距、字級、顏色全部寫死在這個檔裡，不吃 loadoutTheme 的類別**。
//   兩個理由：① 這張圖的字級階與螢幕版不同（主標 44px，螢幕版最大 30px）；
//   ② html-to-image 會把 computed style 內聯，用 CSS 變數與 Tailwind 類別在這裡沒有好處，
//   反而讓「圖上為什麼長這樣」得跨三個檔案才查得到。
//
// ⚠ **只放配裝與算力，不放技能表**（計畫書 E-2）。技能是機師詳情頁的事；把它塞進來
// 會讓這張圖從「我的配裝」變成「機師懶人包」，而後者本站已經有一頁了。
//   （PLAN-052-L Phase D 會加上**攜帶技能**三格 —— 那是「這一套帶了哪三個」，
//    不是技能表，且不印敘述。上面那一條仍然成立。）
//
// ⚠ 空槽與無槽**必須出現在十字上**（`rigLayout()`）：看圖的人不能點開來確認
//   「是沒裝，還是這台根本沒有這一格」。
//
// ⚠ **裝備區已從條列表改成位置化的十字**（PLAN-052-L B-2／B-5）。團隊逐字：
//   「遊戲中是有相對位置的，條列有點不好對」。幾何（哪一列、哪一欄、哪個部位）
//   一律問 `src/utils/rigLayout.ts`，畫法在 `./export/ExportRig.tsx`；
//   本檔只負責把它們排進整張圖的順序裡。

// 顏色、字體、卡片寬度已搬出到 `./export/exportTheme`（PLAN-052-L B-2）——
// 本檔不再是匯出圖的唯一元件（十字在 `./export/ExportRig`），
// 而兩邊各抄一份調色盤就是漂移的起點。值一個都沒動。


interface HeroLayout {
  /** hero 區塊高度 */
  h: number
  /** 左側橘色斜切色塊 */
  skew: { left: number; top: number; width: number; height: number }
  mech: CSSProperties
  pilot: CSSProperties
  /** 文字區塊的落點（`right` 固定 24，兩套一致） */
  text: { left: number; top: number; gap: number }
}

/**
 * 主視覺的**兩套版面**（2026-08-29）。由 `hasMechArt()` 選，不是由使用者選。
 *
 * ⚠ 兩套的差別不只是機甲那張圖的尺寸，是**整個 hero 的構圖與高度**：
 *
 *   - `cutout`（83 台有去背原稿 `art.webp`）：**垂直兩段**、hero 高 600。
 *     文字帶讓開整條上方，兩張圖貼底並排；機甲鎖高 421 ⇒ 機體實寬約 530px、右側出血。
 *   - `photo`（5 台只有 `portrait.webp`）：**水平三段**、hero 高 356 —— 也就是 052-D 初版
 *     的比例（機師 372 ｜ 文字 404 起 ｜ 機甲 350 貼右）。機甲留邊、不出血。
 *
 * **為什麼不硬湊成一套**：`portrait.webp` 只有 560×340。`cutout` 那套要 421 高，
 * 換算過去要放大 1.24 倍 —— 而 `photo` 的 350 寬是**縮小**，同一張圖反而銳利。
 * 600px 的高帶對一張放不大的圖來說也太空：兩個毛病是同一件事的兩面，
 * 因為**那套版面的每個數字都是照 1600×864 的原稿算的**。
 *
 * ⚠ **不是因為 portrait 沒去背**（2026-08-29 更正，實測全 88 台的 alpha）：`portrait`
 *   **也是去背圖**（透明像素 10–36%，88/88）。曾有一台不是（星夜女神），當天換圖修掉了。
 *   分流的理由請只講解析度 —— 拿去背與否當理由，下次補圖的人會不知道該補什麼。
 *
 * ⚠ **同一套內的數字互相咬合**（文字帶下緣 ↔ 圖的上緣 ↔ hero 高度），改任一個都要
 *   把那一套的三處一起重算。**跨套之間沒有關係，不要順手同步** —— 它們本來就該不一樣。
 *
 * ⚠ 補上某台的 `art.webp` 之後，那台會**自動換到 `cutout`**（索引由 `generate-art-index.mjs`
 *   在 build/predev 重掃）。這是預期行為：`photo` 是退路，不是另一種風格選項。
 */
const HERO: Record<'cutout' | 'photo', HeroLayout> = {
  cutout: {
    h: 600,
    skew: { left: -120, top: -80, width: 660, height: 800 },
    // 原稿一律 1600×864（實測 83 張），而**機體只佔畫框約 68% 寬**（其餘是透明留白）
    // —— 所以「高 421」換算出的機體實寬約 530px（初版水平三段時只有約 340px）。
    //
    // ⚠ **鎖高不鎖寬**（`height` ＋ `width:auto`）：會撞到文字帶的是**上緣**，而上緣
    //   只由高度決定。421 高、`bottom:-8` ⇒ 佔 y 171–592，上緣落在文字帶（到 y≈157）
    //   下方 14px —— 這 14px 就是全部的餘裕，動高度前先量。
    //
    // `right:-86` 是為了讓**機體**（而不是那個含 32% 透明留白的畫框）貼近右邊界；
    // 不推的話右側會空掉 85px，看起來像機體浮在半空。
    mech: {
      right: -86, bottom: -8, height: 421, width: 'auto', maxWidth: 900, opacity: 0.94,
      filter: 'drop-shadow(0 16px 30px rgba(0,0,0,0.7))',
    },
    // ⚠ 跟著機甲一起長（372 → 470）：只放大機甲的話，機師會被比成一個小人。
    //   `full.webp` 是 1240×1080 的橫式半身特寫 ⇒ 470 寬 ≈ 409 高，
    //   `bottom:-18` ⇒ 佔 y 209–618（下緣出血），頭頂同樣落在文字帶下方。
    pilot: { left: -6, bottom: -18, width: 470 },
    // 文字帶佔上方整條 ⇒ 左右邊界可以放寬；`left:34` 與左邊那道橘色斜切對齊。
    // `gap:6` 是為了把整塊壓在 y≤160（LOADOUT SHEET 11 ＋ 標題 44 ＋ 分隔 3 ＋ 兩行 37）。
    text: { left: 34, top: 26, gap: 6 },
  },
  photo: {
    h: 356,
    skew: { left: -120, top: -60, width: 620, height: 500 },
    // 350 寬：比原圖的 560 小 ⇒ 是**縮小**，銳利。硬撐到 cutout 那套的尺寸只會糊。
    // `bottom:58` 讓它與底部那條橘線之間留一段呼吸，而不是坐在線上。
    mech: {
      right: 22, bottom: 58, width: 350, opacity: 0.94,
      filter: 'drop-shadow(0 16px 30px rgba(0,0,0,0.7))',
    },
    pilot: { left: 18, bottom: -12, width: 372 },
    // 文字在中欄：`left:404` 讓開機師（18 ＋ 372 ＝ 390），可用寬度只剩 572 ——
    // 長方案名會換行，`nameSize()` 已按字數降級，這裡不再另外處理。
    text: { left: 404, top: 66, gap: 8 },
  },
}

export interface LoadoutExportCardProps {
  ctx: LoadoutContext
  /**
   * 這位機師一共有幾個配裝分頁（＝ `equipSetKeys().length`，PLAN-052-F D-2）。
   *
   * 圖上印的**只有 `ctx` 那一套**（一張圖塞四套會失去「一眼看懂」的價值），
   * 但分享碼帶的是**整份配裝**。兩者語意不同，而收圖的人手上只有這張圖 ——
   * 不講的話，他會以為那串碼貼下去只會得到圖上這一套。
   * `<= 1` 時整句不印：88 位機師只有一套，多印一句只是雜訊。
   */
  setCount?: number
  budget: LoadoutBudget
  /**
   * 已疊過 `defaultNdLevels` 的完整算力配置。
   *
   * ⚠ 呼叫端要傳**生效值**（`effectiveNdLevels()`，含模組加成）而不是投入值：
   *   圖上要印的是「哪些能力亮著」。加成的來源另外由 `ndBonus` 交代 —— 只印生效值
   *   不講來源的話，讀者會拿它去對遊戲裡自己點的那幾格，然後以為本站算錯。
   */
  ndLevels: Record<string, number>
  /**
   * 潛能等級 0–5（PLAN-052-N D-3）。**未傳＝滿潛**（同 `LoadoutDraft.potential`）。
   *
   * ⚠ 只在**未滿潛**時印上圖：滿潛是預設值，每張圖都印「潛能 5」只是雜訊；
   *   但少了它，同一套配裝在不同潛能下的兩張圖會看起來像其中一張算錯了。
   */
  potential?: number
  /**
   * 模組給的算力加成（PLAN-052-M）。**沒有就傳 undefined，那一行整個不印。**
   * 有值時在算力段末尾補一句來源（強擊模組 LV.MAX ／ 觀星者單元）。
   */
  ndBonus?: NdPowerBonus | null
  ndAbilityMap: Map<string, NeuralDriveAbility>
  /** ★ 分區（此區算力會改寫敘述） */
  ndZones: Set<string>
  /** 方案名稱。未命名時印機師名當標題 —— 標題留白會讓整張圖看起來像沒做完 */
  name?: string
  /**
   * 方案備註（PLAN-052-L C-5）。**沒填時整塊不印**，不留空框。
   *
   * ⚠ 與 `name` 一樣由呼叫端傳入而不是從 `ctx` 取：`LoadoutContext` 是「這一套裝了什麼」
   *   的解析結果，名稱與備註都不在裡面（它們不隨形態分頁變動）。
   * ⚠ 這是**別人寫的自由文字**，圖上必須標「由分享者填寫」——見 `NoteBand`。
   */
  note?: string
  /**
   * 攜帶技能（PLAN-052-L D-5）。**已解析好的技能文件**，由呼叫端查表 ——
   * 同 `name` / `note` / `ndAbilityMap`：`LoadoutContext` 是「這一套裝了什麼」的解析
   * 結果，而技能不隨形態分頁變動，不在裡面。
   *
   * ⚠ 呼叫端要在 `pilotSkills` **載入完成之後**才開拍（見 `LoadoutPage` 的匯出閘門）：
   *   `waitForRenderReady()` 只等圖與字體、不等集合，拍到一張「技能區空白」的圖
   *   是看不出來的 —— 沒帶技能與還沒載入在這張圖上長得一模一樣。
   *
   * ⚠ 只放三格自由替換的那幾個。「改」技能不印（見 `SkillBand`）。
   */
  skills?: readonly PilotSkillDoc[]
  /** 產生日期 `YYYY-MM-DD`。由呼叫端傳入而不是這裡取 `new Date()`，元件才保持純渲染 */
  generatedAt: string
  /** 遊戲版本（如 `3.3`）。取不到時傳 undefined，該欄整個不印 */
  gameVersion?: string
  /**
   * 分享碼（`encodeLoadout()` 的產物）。**沒值時該欄整個不印**——
   * 印一個佔位字串會讓人拿去貼，而它解不開。
   *
   * ⚠ 由呼叫端編好傳進來，不在這裡編：這個元件是純渲染，而 encode 需要六個集合的
   *   shareId 索引，把它們拉進來等於讓一張圖的版面依賴整份遊戲資料。
   */
  shareCode?: string
  /**
   * 完整分享**連結**（`buildShareUrl()` 的產物）。圖底那顆 QR 編的就是它（E-2）。
   *
   * ⚠ 與 `shareCode` **兩者都要**、不是二選一（使用者裁決 2026-08-29）：
   *   碼給「看得到這張圖的檔案」的人手抄，QR 給「別人螢幕截圖你的圖」的人掃。
   *   兩條還原路徑不同，少哪一條都會有一群人回不去。
   *
   * ⚠ QR 編的是**連結**不是裸碼：掃出來要能直接開，而裸碼掃出來只是一串亂碼。
   *   同呼叫端在 `origin` 上組好傳進來 —— 這個元件讀不到 `window`（它要保持純渲染）。
   */
  shareUrl?: string
}

export function LoadoutExportCard({
  ctx, setCount, budget, ndLevels, ndBonus, ndAbilityMap, ndZones, name, note, skills, potential, generatedAt, gameVersion,
  shareCode, shareUrl,
}: LoadoutExportCardProps) {
  const { pilot, mech } = ctx
  const w = budget.weight

  // ── 位置化槽位（PLAN-052-L B-2）────────────────────────────────────────────
  //
  // ⚠ 版面與計數**共用同一份 `blocks`**：各算一次的話會出現「圖上畫了 6 格、
  //   抬頭寫 5 個槽位」這種錯，而它只有逐張圖數格子才看得出來。
  const rigBlocks = rigLayout(ctx)
  const slots = rigSlots(rigBlocks)
  const usedSlots = slots.filter((s) => s.name !== null).length
  const realSlots = slots.filter((s) => s.state !== 'absent').length

  // ── 主視覺的兩張圖 ────────────────────────────────────────────────────────
  //
  // ⚠ **機師用 `full.webp`（半身特寫）、機甲用 `art.webp`（原稿全身）—— 兩邊來源不同是刻意的**
  //   （2026-08-28，實際輸出比對後的決定）。
  //
  //   機師的直式全身原稿試過了：在這張圖上它會把人物壓成一條窄長的立像，而半身特寫的
  //   臉更大、更像一張「這是誰的配裝」的封面。全身原稿改留給機師故事館那種以看人物為
  //   目的的頁面（查詢工具在 `utils/assets` 已備好：`hasPilotArt()` / `pilotKeyArtPath()`）。
  //
  //   機甲相反：`portrait` 是上半身 3/4 特寫，在這裡放大只是把裁切放大；原稿是完整機體
  //   含武裝，而這張圖有 1000px 可用，放得下它真正的樣子。
  //
  // ⚠ 因此機甲圖**不再與螢幕版共用來源**（螢幕中欄仍是 `portrait`），匯出時多一次下載
  //   約 101KB，不再是快取命中。`toPng` 前已有等待幀的機制（`nextFrames`）。
  //   缺原稿的 5 台由候選鏈自動退回 `portrait`。
  const art = imageCandidates(pilotFullArtPath(pilot))
  // ⚠ **有沒有去背原稿決定整個 hero 的版面，不是只決定機甲那張圖的尺寸**（2026-08-29）。
  //   `art.webp` 是 1600×864 ⇒ 放得大、可以出血 ⇒ 走 `cutout`（垂直兩段、高 600）；
  //   `portrait.webp` 只有 560×340 ⇒ 走 `photo`（水平三段、高 356，052-D 的初版比例）。
  //   兩套的差異與理由寫在 `HERO` 上。
  const mechIsCutout = hasMechArt(mech)
  const L = HERO[mechIsCutout ? 'cutout' : 'photo']
  const mechArt = imageCandidates(mechKeyArtPath(mech), mech?.portrait)

  const named = !!name
  const title = name ?? pilot?.name ?? '未命名配裝'

  /**
   * 分段條的分母（PLAN-052-L A-6）。
   *
   * ⚠ **改寫前分母是 `w.total`**，於是四個分段加起來恆為 100% —— 那條**永遠是滿的**，
   *   與超不超重完全無關，也就是它一個位元的資訊都沒有傳達。
   *
   * 現在分母是「可用出力與總重的較大者」：沒超重時條只填到 `總重 / 出力`（＝還有多少餘裕
   * 一眼看得出來），超重時填滿，而超出的那一段由下面那塊紅色覆蓋標出來。
   *
   * ⚠ **不要照抄螢幕版 `OutputBar` 的「條會自己撐出一截紅色」**：它的分段加總就是
   *   `weight.total`，超重時剛好填滿 100%，紅的只有邊框 —— 那一截紅色不存在。要有就得自己畫。
   */
  const scale = Math.max(budget.output.total, w.total, 1)
  const pct = (n: number) => `${(n / scale) * 100}%`

  return (
    <div style={{
      width: 1000, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
      background: C.bg, color: C.text, overflow: 'hidden',
      fontFamily: "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif",
      lineHeight: 1.7,
    }}>
      {/* ── Key visual：立繪 ＋ 機甲 ＋ 方案名稱 ── */}
      <div style={{
        // ── 兩套版面，由 `L` 決定（見 `HERO`）─────────────────────────────────
        //
        // `cutout`：**垂直兩段**（文字帶佔上方全寬，兩張圖貼底並排）。
        //   2026-08-29 使用者回饋「機甲 art 圖很帥，但佔版面太少」而來 —— 舊的水平三段
        //   把機甲鎖死在 548 寬以內（機體左緣 ＝ 1000 − 0.84×寬，要 ≥ 540 才不壓到標題），
        //   只比初版大 10%，達不到「佔版面」。⇒ 文字必須整條讓開，機體才長得到 530px。
        //
        // `photo`：**水平三段**，也就是初版（052-D）的比例。留給沒有原稿的 5 台。
        position: 'relative', height: L.h, flexShrink: 0, overflow: 'hidden',
        background: 'linear-gradient(118deg, #14161d 0%, #1b1207 42%, #0a0c10 100%)',
      }}>
        <div style={{
          position: 'absolute', ...L.skew,
          transform: 'skewX(-14deg)',
          background: 'linear-gradient(160deg, rgba(255,107,43,0.30), rgba(255,107,43,0.02) 68%)',
        }} />

        {/* ⚠ 機甲先畫、機師後畫：`cutout` 時兩張在底部有重疊帶，機師必須壓在機甲之上
            —— 他是這張圖的主角，而機甲橫幅是背景襯底。（`photo` 時兩張不重疊，
            但順序照舊 —— 兩套共用同一段 JSX，只換 `L`。） */}
        {mechArt.length > 0 && (
          <FallbackImage
            candidates={mechArt}
            alt=""
            fallback={null}
            // 尺寸與落點見 `HERO`（兩套版面各有一組，理由寫在那裡）。
            style={{ position: 'absolute', ...L.mech }}
          />
        )}
        {art.length > 0 && (
          <FallbackImage
            candidates={art}
            alt=""
            fallback={null}
            // 尺寸與落點見 `HERO`：`cutout` 跟著機甲一起長到 470，`photo` 維持初版的 372。
            // ⚠ 兩張圖的大小是**綁在一起**的 —— 只放大機甲的話，這位會被比成一個小人。
            style={{
              position: 'absolute', ...L.pilot,
              filter: 'drop-shadow(0 18px 34px rgba(0,0,0,0.7))',
            }}
          />
        )}

        <div style={{ position: 'absolute', right: 24, top: 20, display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ fontFamily: ORB, fontSize: 13, fontWeight: 900, letterSpacing: 2, color: C.orange }}>MILKHAMA</span>
          <span style={{ width: 1, height: 15, background: C.lineStrong }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: C.sub }}>{SITE_NAME}</span>
        </div>

        <div style={{
          // ⚠ 這一塊在兩套版面裡**站的位置不同**（見 `HERO`）：
          //   `cutout` 佔上方整條（兩張圖都貼底，上緣在 y≈171 之後），
          //   `photo` 是中欄（`left:404`，讓開左邊的機師立繪）。
          position: 'absolute', left: L.text.left, top: L.text.top, right: 24,
          display: 'flex', flexDirection: 'column', gap: L.text.gap,
        }}>
          <div style={{ fontFamily: ORB, fontSize: 11, letterSpacing: 2, color: C.orange }}>LOADOUT SHEET</div>
          {/*
            ⚠ **未命名時把機師名升成主標，而不是另外印一行「未命名配裝」**（也不是把機師名
              印兩次）。未命名是正常狀態 —— 命名要登入（052-E），未登入的人本來就會走到這裡。
              留一行「未命名配裝」等於在別人的分享圖上寫「這張沒做完」；印兩次機師名則是
              把同一個字放大再放小，讀者會以為那是兩個不同的東西。
          */}
          <div style={{
            fontSize: nameSize(title), fontWeight: 900, letterSpacing: 1,
            lineHeight: 1.14, wordBreak: 'break-word',
          }}>
            {title}
          </div>
          <div style={{ width: 78, height: 3, background: C.orange }} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
            {named && <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>{pilot?.name ?? '未選機師'}</span>}
            {pilot?.class && (
              <span style={{
                padding: '2px 10px', fontSize: 13, fontWeight: 700, color: C.yellow,
                background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.5)',
              }}>{pilot.class}</span>
            )}
            {pilot?.license && (
              <span style={{ fontSize: 14, color: C.sub }}>{pilot.license}執照</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, color: C.sub, flexWrap: 'wrap' }}>
            {/* ⚠ 印**軀幹那台**（`identityMech`），與畫面的抬頭、立繪同一個判準。
                兩邊各自決定「這是哪一台」的話，轉發到第三手的人手上只有這張圖，
                而圖與站上的畫面會對不起來 —— 混搭本來就是最需要說清楚的那一種配裝。 */}
            <span style={{ color: C.text, fontWeight: 700 }}>{ctx.identityMech?.name ?? mech?.name ?? '未選機甲'}</span>
            {ctx.identityMech && mech && ctx.identityMech.id !== mech.id && (
              <span style={{ color: C.sub }}>（基底 {mech.name}）</span>
            )}
            {mech?.armorType && <><span style={{ color: C.lineStrong }}>/</span><span>{mech.armorType}</span></>}
            {ctx.form?.name && <><span style={{ color: C.lineStrong }}>/</span><span style={{ color: C.yellow }}>{ctx.form.name}</span></>}
          </div>
        </div>

        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 3,
          background: 'linear-gradient(90deg, #ff6b2b, rgba(255,107,43,0.05))',
        }} />
      </div>

      {/* ── 出力帶（PLAN-052-L A-5）──────────────────────────────────────────
          改寫前是**四格 30px 大字的 `Stat`（85px）＋ 16px 條 ＋ 40px 圖例**，合計約 141px。
          團隊逐字：「出力只要配得進去就不是重要資訊，剩餘出力也不能怎樣，可以縮小版面。
          總算力也不用特別標」。⇒ 收成 18px 條 ＋ 一行資訊列，約 80px。

          ⚠ **`γ 算力合計` 那一格連同它的 `/23` 一起刪掉，這順手修好一個線上錯誤**：
            `ND_RULES.gammaPairCap = 23` 是「上下 16＋7」的**雙區**共用預算，而全庫有
            **10 位 1.0 老角只有單一個 γ 區**（分區名就是單一字元 `γ`，天花板 16）——
            他們的圖上一直印著 `16 / 23`，讀起來像「還差 7 沒點滿」，而那 7 點永遠不存在。
            另一處同樣的分母在下方 `SectionHead` 的 note，一起拿掉。

          ⚠ **不補「火力」**（使用者裁決 2026-08-29）：`chassisFirepower()` 是現成的，
            但它**不含元件、模組、天賦**，而讀者會拿它去比兩套配裝的強弱 —— 那個比較是錯的。
            這張圖明確不談強度；要談的前提是先有一個把元件與模組算進去的口徑。 */}
      <div style={{ position: 'relative', display: 'flex', height: 18, flexShrink: 0, background: C.panel }}>
        <div style={{ width: pct(w.chassis), background: SEG_HEX.chassis }} />
        <div style={{ width: pct(w.hands), background: SEG_HEX.hands }} />
        <div style={{ width: pct(w.shoulder), background: SEG_HEX.shoulder }} />
        <div style={{ width: pct(w.back), background: SEG_HEX.back }} />
        {/* 超出出力預算的那一段。條本身照實畫到 `w.total`，紅色是**蓋在上面**的，
            於是「超了多少」與「哪一段超的」兩件事同時看得到。

            ⚠ **用紅色斜紋而不是半透明紅**（2026-08-29 瀏覽器實測後改）：
              45% 的紅蓋在背部那段的藍（`#3b82f6`）上會混成紫色 —— 而紫色正是圖例裡
              **肩部**的顏色。實測那張圖上肩部是 0，於是條的最右端看起來像「肩部佔了一截」。
              斜紋是**質地**不是顏色，疊在四種底色上都還讀得出「這一段是警告」。 */}
        {budget.over && !budget.dataIncomplete && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0, right: 0,
            left: pct(budget.output.total),
            background: 'repeating-linear-gradient(135deg, rgba(239,68,68,0.92) 0 5px, rgba(239,68,68,0.55) 5px 10px)',
            borderLeft: `2px solid ${C.red}`,
          }} />
        )}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 18, padding: '10px 20px 4px',
        fontSize: 12, color: C.sub, background: C.panel, flexShrink: 0,
      }}>
        <Legend seg="chassis" n={w.chassis} />
        <Legend seg="hands" n={w.hands} />
        <Legend seg="shoulder" n={w.shoulder} />
        <Legend seg="back" n={w.back} />
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 10 }}>
          {/* 總重是主角、出力降級成灰色分母、餘量／超重是唯一的彩色數字 */}
          <span style={{ fontFamily: MONO, fontSize: 20, fontWeight: 800, color: C.text }}>
            {w.total.toLocaleString()}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 13, color: C.dim }}>
            ／ 出力 {budget.output.total.toLocaleString()}
          </span>
          {budget.dataIncomplete ? (
            // ⚠ 不印破折號：那會被讀成「本站算不出來」。講清楚是官方還沒公布
            <span style={{ fontSize: 12, color: C.dim }}>官方數值未公布，餘量無法計算</span>
          ) : (
            <span style={{
              fontFamily: MONO, fontSize: 15, fontWeight: 700,
              color: budget.over ? C.red : C.green,
            }}>
              {budget.over
                ? `超重 ${Math.abs(budget.remaining).toLocaleString()}`
                : `餘 ${budget.remaining.toLocaleString()}`}
            </span>
          )}
        </span>
      </div>
      {/* ⚠ 手部「取較重者」必須寫在圖上：那是最容易被誤判成本站少算的一條規則。
          自成一列而不是擠在圖例右邊 —— 右邊現在是總重那組數字。

          ⚠ **沒有備用槽就整條不印**（使用者裁決 2026-08-30）：全庫 181 個背包只有
            強襲者一個解得開備用槽，於是這句話在絕大多數圖上都是在解釋一個
            **這張配裝裡不存在**的東西 —— 看圖的人得先讀懂一個與自己無關的機制，
            才能確認沒漏看什麼。有備用組時它才是真的在防誤判（那時兩排武器都在圖上，
            而總重只算了其中一排）。同一條裁決也拿掉了十字底下那一列「備用槽」說明格。 */}
      {ctx.capacity.backupHand > 0 && (
        <div style={{
          padding: '0 20px 9px', fontSize: 11, color: C.dim, background: C.panel, flexShrink: 0,
        }}>
          手部取主手／備用<strong style={{ color: C.sub }}>較重者</strong>
          {`，${w.heavierBank === 'main' ? '備用組' : '主手組'} ${Math.min(w.mainHand, w.backupHand).toLocaleString()} 未計入`}
        </div>
      )}
      {/* ⚠ 天賦減重同樣**必須寫在圖上**（PLAN-052-N D-3），而且理由比上一條更硬：
          武器格印的是**原重**（1,100，與官方整備畫面一致），總重卻只算 740。
          看圖的人自己加一遍就會發現對不上，而**這張圖上的數字是對的** ——
          不印這一句，等於讓每一張維娜的配裝圖都自帶一個「本站算錯了」的證據。

          ⚠ 一併印出**潛能等級**：洛莎／艾琳／里貝卡的減重只在第 3 階之後才有，
          少了它，同一套配裝在不同潛能下的兩張圖看起來只是「其中一張算錯」。 */}
      {budget.talentRelief && (
        <div style={{
          padding: '0 20px 9px', fontSize: 11, color: C.cyan, background: C.panel, flexShrink: 0,
        }}>
          天賦減重 <strong>−{budget.talentRelief.total.toLocaleString()}</strong>
          <span style={{ color: C.dim }}>
            {`（${budget.talentRelief.items.map((r) => `${r.name} −${r.reducedBy.toLocaleString()}`).join('、')}`}
            {budget.talentRelief.items[0]?.talentName ? ` · ${budget.talentRelief.items[0].talentName}` : ''}
            {`）　武器格印的是原重，減免只反映在總重 —— 與遊戲內整備畫面一致`}
          </span>
        </div>
      )}

      {/* 未滿潛時必須印：洛莎／艾琳／里貝卡的減重只在潛能第 3 階之後才有，
          少了它，同一套配裝在不同潛能下的兩張圖看起來只是「其中一張算錯」。 */}
      {potential !== undefined && potential < 5 && (
        <div style={{
          padding: '0 20px 9px', fontSize: 11, color: C.dim, background: C.panel, flexShrink: 0,
        }}>
          機師潛能 <strong style={{ color: C.sub }}>{potential} / 5</strong>
          {potential < 3 ? '　天賦未加強（第 3 階解鎖）' : '　天賦已加強'}
        </div>
      )}

      {/* ── 裝備配置：位置化的十字（PLAN-052-L B-2／B-5）────────────────────
          改寫前這裡是「部位／武器／類型／重量」的四欄條列表，與右邊 372px 的算力欄
          並排。現在條列表退場（`loadoutSheetRows()` 一併退場，B-4），十字拿到**整寬
          1000px** —— 而整寬的前提就是算力那一欄先縮成兩條 γ 移出去（B-3）。

          ⚠ 「類型」欄（單手／雙手／肩膀／背後）**不再另闢一欄**：位置本身就是答案，
            而唯一位置講不清楚的雙手武器由格內的「雙手」標記負責。 */}
      <div style={{ borderTop: `1px solid ${C.line}` }}>
        <SectionHead title="裝備配置" note={`已裝 ${usedSlots} / ${realSlots} 格`} tone={C.orange} />
        <ExportRig ctx={ctx} blocks={rigBlocks} />
        <ExportRigLegend />
      </div>

      {/* ── 神經驅動算力 ｜ 備註 ＋ 明細 ───────────────────────────────────
          ── 與 B-5 目標版面的差異（PLAN-052-L C-5，實測後的裁決）────────────
          B-5 原訂「算力 371px ｜ 備註＋技能」一列、下面再接一條整寬的
          「武器元件 ｜ 模組效果」明細帶。實作到 C 才看得出那樣**必然留下空格**：
          備註是選填的（多數圖沒有），Phase D 的技能是三個 chip（約 60px），
          而算力那一欄常常 700px 高 —— 右格會空掉大半，而那正是 B-5 想避免的事。
          ⇒ 改成右欄是一個**由上而下的明細欄**：備註 → 武器與元件 → 模組效果。
            備註的位置仍然符合 C-5 的裁決（「算力右側、技能之上；讀者看完機體之後、
            翻到細節之前」），而且**有沒有備註都不會留下空框**。
            Phase D 的攜帶技能接在備註後面、武器與元件之前。 */}
      <div style={{
        display: 'grid', gridTemplateColumns: '371px minmax(0, 1fr)', gap: 1,
        background: C.line, alignItems: 'stretch', borderTop: `1px solid ${C.line}`,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', background: C.bg, minWidth: 0 }}>
          {/* ⚠ note 恆空：改寫前這裡印 `${gammaSum} / 23`，而 23 是**雙區**共用預算，
              對 10 位只有單一個 γ 區的老機師是一個永遠達不到的分母（A-5 已拿掉）。 */}
          <SectionHead title="神經驅動算力" tone={C.pink} />
          <NeuralDriveBand
            pilot={pilot}
            ndLevels={ndLevels}
            ndBonus={ndBonus}
            ndAbilityMap={ndAbilityMap}
            ndZones={ndZones}
          />
        </div>

        {/* 右欄＝**備註 ＋ 明細欄**：為什麼這樣配、武器上掛了什麼元件、模組給了什麼效果。
            十字回答位置，這裡回答內容。 */}
        <div style={{ display: 'flex', flexDirection: 'column', background: C.bg, minWidth: 0 }}>
          <NoteBand note={note} />
          <SkillBand skills={skills ?? []} />
          <WeaponDetailBand ctx={ctx} />
          <ModuleBand ctx={ctx} />
        </div>
      </div>

      {/* ── 浮水印 footer ── */}
      <div style={{
        position: 'relative', flexShrink: 0,
        background: 'linear-gradient(90deg, #14161d, #0a0c10 62%)',
        borderTop: `2px solid ${C.orange}`, overflow: 'hidden',
      }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 20, padding: '18px 24px' }}>
          {/* 底噪 wordmark：截圖被裁掉 footer 時仍留下一層來源痕跡 */}
          <div style={{
            position: 'absolute', right: -20, top: -34, fontFamily: ORB, fontSize: 84, fontWeight: 900,
            letterSpacing: 8, color: 'rgba(255,255,255,0.032)', whiteSpace: 'nowrap',
          }}>MILKHAMA</div>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontFamily: ORB, fontSize: 15, fontWeight: 900, letterSpacing: 1, color: C.orange }}>
              {SITE_DOMAIN}
            </span>
            <span style={{ fontSize: 12, color: C.sub }}>{SITE_TITLE} · 配裝模擬器</span>
            <span style={{ fontSize: 11, color: C.dim }}>非官方社群工具 · 無營利 · 與官方無關</span>
          </div>
          <div style={{ position: 'relative', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18 }}>
            <FooterField
              label="GENERATED"
              value={gameVersion ? `${generatedAt} · 遊戲版本 ${gameVersion}` : generatedAt}
            />
          </div>
        </div>

        {/* ── 分享碼帶（PLAN-052-C E-1 ／ PLAN-052-L E-2・E-3）──
            沒有碼就**整條不印**：印佔位字串會有人拿去貼，而它解不開。

            ⚠ 碼本身維持**整寬一條 ＋ `break-all`**（052-C E-1 的既有裁決，E-3 覆核後照舊）：
              分享碼是**變長**的（實測空草稿 7 字元、典型 36、含元件與算力 79、
              三套 119；加了 100 字備註後約 +410），而卡片固定 1000px 寬。
              放右欄的話 79 字元起就會把左邊的站名浮水印擠出畫面 —— 而那正是這張圖
              存在的理由。整寬 ＋ `break-all` 讓它自己折行，卡片高度跟著長。

            ⚠ QR 走**固定尺寸的右欄**（E-3）：它與碼不同，尺寸不隨長度變 ——
              一塊會左右伸縮的方塊會讓每張圖的底部看起來都不一樣寬。
              左邊那一欄 `minWidth: 0` 不可省，否則 `break-all` 的長碼會把 QR 推出畫面。 */}
        {shareCode && (
          <div style={{
            // ⚠ `center` 而不是 `flex-start`（2026-08-30 實測後改）：碼通常只有 1–3 行，
            //   而 QR 高 210 —— 靠上對齊時左欄下面會空掉一大塊，看起來像有東西沒印出來。
            position: 'relative', display: 'flex', alignItems: 'center', gap: 20,
            padding: '10px 24px 14px', borderTop: '1px solid #232936',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexGrow: 1, minWidth: 0 }}>
              <span style={{
                fontFamily: ORB, fontSize: 9, letterSpacing: 2, color: C.dim, flexShrink: 0,
              }}>SHARE CODE</span>
              {/* ⚠ 圖上是**一套**、碼裡是**整份**（PLAN-052-F D-2 / 決策四①）。
                  收圖的人手上只有這張圖，不講的話他會以為貼下去只會得到圖上這一套。
                  ⚠ 這一句**不可省**（E-3 明列）：QR 掃出來的也是整份，同一個誤會。 */}
              {(setCount ?? 1) > 1 && (
                <span style={{ fontSize: 11, color: C.dim, flexShrink: 0, whiteSpace: 'nowrap' }}>
                  （含 {setCount} 個形態分頁）
                </span>
              )}
              <span style={{
                fontFamily: MONO, fontSize: 12, lineHeight: 1.45, color: C.sub,
                wordBreak: 'break-all', minWidth: 0,
              }}>{shareCode}</span>
            </div>
            <ShareQr url={shareUrl} />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 圖底的 QR（PLAN-052-L E-2）─────────────────────────────────────────────
//
// 編的是**完整分享連結**，於是「別人螢幕截圖你的圖」也還原得回配裝 —— 那是純文字碼
// 做不到的（二手截圖上要一個字一個字抄 base64url，而 `l/I/1`、`O/0` 分不出來）。
//
// ⚠ **inline SVG ＋ 字面十六進位**，不是 `<img>` 也不是 canvas：
//   `<img src={dataUrl}>` 是非同步的（`waitForRenderReady()` 只等 `img.complete`，
//   但 QR 是在 render 期間才算出來的，來不及進那一輪輪詢）；canvas 要等 effect，
//   而 effect 跑在 `toPng()` 之後。inline SVG 在 render 當下就完成了。
//   ⚠ `html-to-image` 對 `<svg>` 直接**深拷貝**、子元素不經 `cloneCSSStyle()`
//     ⇒ 這裡的顏色只能是 presentation attribute 上的字面值，一個 `var()` 都不能有。
//
// ⚠ **白底 ＋ 靜區**：QR 的規格假設「暗模組在亮底上」，而這張圖的底是 `#0a0c10`。
//   靜區已經算在 `size` 裡（`loadoutQr()` 的 `BORDER`），所以整塊直接鋪白即可，
//   不要再加 padding —— 那會讓實際的每模組像素數與閘門算的不一致。
//
// ⚠ **`loadoutQr()` 回 `null` 時整塊不畫**（超長碼／畫出來會掃不動）。此時左邊的完整碼
//   仍在，還原路徑沒有斷。⚠ 不要在這裡補一個「QR 太長，略」的說明框：
//   那是在向讀者解釋一個他從來沒看過的東西為什麼不見了。

function ShareQr({ url }: { url: string | undefined }) {
  const qr = useMemo(() => (url ? loadoutQr(url, EXPORT_PIXEL_RATIO) : null), [url])
  if (!qr) return null
  return (
    <div style={{
      flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
    }}>
      <div style={{ width: qr.boxPx, height: qr.boxPx, background: '#ffffff' }}>
        <svg
          width={qr.boxPx}
          height={qr.boxPx}
          viewBox={`0 0 ${qr.size} ${qr.size}`}
          // shapeRendering：模組邊界落在非整數像素上時不要抗鋸齒成灰邊（掃描器讀的是黑白）
          shapeRendering="crispEdges"
          style={{ display: 'block' }}
        >
          <path d={qr.d} fill="#0a0c10" />
        </svg>
      </div>
      {/* ⚠ 這一行**不是裝飾**：左邊那串是要用貼的「碼」，這一塊是要用掃的「連結」，
          兩者的用法不同。不講的話，一個沒有標籤的方塊會被讀成「這是什麼？」 */}
      <span style={{ fontSize: 10, color: C.dim, whiteSpace: 'nowrap' }}>掃描直接開啟這一套</span>
    </div>
  )
}

// ─── 模組效果（PLAN-052-G C-5 ／ PLAN-052-L B-5）──────────────────────────

// ⚠ **改印官方敘述、不再印攤平的數值**（PLAN-052-L A-3）。
//
// 改寫前這裡用 `statText()` 把 `ModuleLevel` 的數值欄攤成「命中+15%」。兩個問題：
//
//   ① **候選池 186 顆裡有 119 顆（64%）該階的數值欄全為 0** ⇒ 回空字串
//      ⇒ 圖上三分之二的模組**只有一個名字**。
//   ② 它**會省略觸發條件卻看起來像完整答案**：猛擊裝置的 `statText` 是「格鬥傷害+15%」，
//      而官方敘述是「使用格鬥武器攻擊時**有 70% 的概率發動**，傷害提升 15%」。
//      圖是印刷品、看的人沒辦法點開來對帳 —— 印一個省略了機率的數字比不印更糟。
//
// 取的是**這一族目前等級**那一階的敘述（不是滿階），與螢幕版 `EquippedEffects` 同一個來源。
// 實測 186／186 都有敘述（p50 31 字、p90 63、max 119）；33 筆含換行（故用 `pre-line`）、
// 31 筆含 `[引用]`（原樣印，官方文案本來就長那樣）、**0 筆含 `<token>`**
// ⇒ 候選池不需要 sanitizer（只有天生模組那條路才可能碰到）。
//
// ── B-5 起只印**裝了東西的那幾格** ──────────────────────────────────────────
// 改寫前這裡是四部位各一行（含「未裝」與「無模組接口」）。位置化的十字上線之後，
// 「哪個部位有沒有接口、裝了什麼、Lv 幾」四部位卡上全部都有 —— 再印一次四行「未裝」
// 就是把同一句話在同一張圖上說第二遍，而且它排在十字下方、看起來像另一份資料。
//
// ⚠ 「這台沒有模組接口」（B 品質 10 台）的話**仍然講得出來**：部位卡上印的是
//   「無模組接口」。這一段整個不印不會讓那件事消失。
// ⚠ 超限提醒（`wasted`）必留 —— 那是玩家會照著配的東西，而它在十字上沒有落點。

function ModuleBand({ ctx }: { ctx: LoadoutContext }) {
  // ⚠ **清單本身走 `moduleRows()`**（PLAN-052-L E-1 自本函式抽出去的）：純文字摘要要
  //   列出同一批模組、同一個等級、同一段敘述。原本那 25 行留在這裡的話，兩邊必然漂移，
  //   而漂移的症狀是「圖上寫 Lv4、複製出來的文字寫 Lv2」—— 兩邊都不會報錯。
  //   同族只算一次、等級走 `ctx.stacks`、敘述取該級官方文案，理由都寫在那一支上。
  const lines = moduleRows(ctx)
  const wasted = wastedModuleStacks(ctx)

  // 一顆都沒裝、也沒有超限可講 ⇒ 整段不印（十字上的部位卡已經把「未裝」講完了）
  if (lines.length === 0 && wasted.length === 0) return null

  return (
    <div style={{ borderTop: `1px solid ${C.line}`, background: C.bg }}>
      <SectionHead title="模組效果" note={`${lines.length} 顆`} tone={C.green} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {lines.map((l) => (
          <div key={l.position} style={{
            display: 'flex', gap: 11,
            padding: '10px 16px', borderBottom: `1px solid ${C.line}`, minWidth: 0,
          }}>
            {/* 縮圖欄固定 26px：缺圖時**留空不畫框** —— 一個空方塊夾在三顆正常圖示中間，
                會被讀成「有一顆我不認得的模組」，而實際上只是我們少一張圖 */}
            <span style={{ width: 26, height: 26, flexShrink: 0, marginTop: 2 }}>
              {l.icon && (
                <FallbackImage
                  candidates={imageCandidates(l.icon)}
                  alt=""
                  fallback={null}
                  // ⚠ 直接畫 `<img>` 而不是借用 `ModuleIcon`：那顆帶 Tailwind 類別
                  //   （本檔一律寫死十六進位，見檔頭）、畫的是有框的降級態，
                  //   而且它寫死 `loading="lazy"` —— 匯出宿主在 `left:-10000px`，
                  //   lazy 的圖永遠不會開始載入，`waitForRenderReady()` 會固定燒滿 5 秒逾時。
                  style={{ width: 26, height: 26, objectFit: 'contain', display: 'block' }}
                />
              )}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flexGrow: 1 }}>
              <span style={{ fontSize: 13, color: C.text }}>
                <span style={{ color: C.sub, marginRight: 8 }}>{l.label}</span>
                {l.name}
                {l.stack && (
                  <span style={{
                    fontFamily: MONO, fontSize: 10,
                    color: l.stack.overflow > 0 ? C.yellow : C.dim,
                  }}> Lv{l.stack.level} / {l.stack.cap}</span>
                )}
              </span>
              {l.dup ? (
                <span style={{ fontSize: 11, color: C.dim }}>同族疊加，效果不重複計算</span>
              ) : l.description ? (
                <span style={{
                  fontSize: 11, color: C.sub, lineHeight: 1.6, whiteSpace: 'pre-line',
                }}>{l.description}</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      {/* ── 帶尾（PLAN-052-L A-4）────────────────────────────────────────────
          ⚠ **「四格合計」整段刪除**（團隊逐字：「合計效果先隱藏，這部分站內的資訊不夠詳盡，
            很容易有半成品的感覺」）。它原本是 `statText(Σ activeStacks)`，而上面已經說明
            那個攤平口徑本身就會漏掉觸發條件 —— 把一堆這種數字再加總，只會把誤差放大。

          ⚠ 這一條**只要這一段有印就要有**：模組等級是**本站推算**的（部位品質階 ×
            部位種類，見 PLAN-052-K），而這一輪起圖上印的是「照那個推算等級取出來的官方
            敘述」—— 推導層數比改版前多一層，那句免責因此更需要，不是更不需要。 */}
      <div style={{
        padding: '9px 16px', background: 'rgba(18,21,28,0.5)',
        fontSize: 11, color: C.dim, lineHeight: 1.7,
      }}>
        {wasted.map((st) => (
          <div key={moduleFamilyKey(st.mod)} style={{ color: C.yellow }}>
            ⚠ {st.mod.name} 裝了 {st.positions.length} 顆、合計 {st.sum} 級，
            但上限 {st.cap} 級 —— 超出的 {st.overflow} 級不生效
          </div>
        ))}
        <div>模組等級由部位品質階與部位種類推算，效果取該等級的官方敘述。</div>
      </div>
    </div>
  )
}

// ─── 小元件 ─────────────────────────────────────────────────────────────────

/** 名稱越長字級越小。24 個中文字在 44px 下會是三行，把 banner 撐破。 */
function nameSize(text: string): number {
  const n = [...text].length
  if (n <= 10) return 44
  if (n <= 16) return 36
  return 30
}

// ⏸ `Stat`（四格 30px 大字）已於 PLAN-052-L A-5 退場 —— 見上方「出力帶」的說明。
//    不要為了「圖上總得有個大數字」把它加回來：團隊明說出力與剩餘出力都不重要，
//    而唯一還想印的強度數字（火力）已被裁決不放（口徑不含元件與模組）。

function Legend({ seg, n }: { seg: SegKey; n: number }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <i style={{ width: 9, height: 9, background: SEG_HEX[seg], display: 'block' }} />
      {SEG_LABEL[seg]} {n.toLocaleString()}
    </span>
  )
}

/** `note` 選填：沒有可講的數字時整個右側不畫，不要印一個空字串佔位（PLAN-052-L A-5） */
function SectionHead({ title, note, tone }: { title: string; note?: string; tone: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
      background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${C.lineStrong}`,
    }}>
      <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 2, color: tone }}>{title}</span>
      {note && (
        <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 12, color: C.dim }}>{note}</span>
      )}
    </div>
  )
}


// ─── 方案備註（PLAN-052-L C-5）────────────────────────────────────────────
//
// 團隊回饋 2：分享一套配裝時，說不出「為什麼這樣配」。這一塊就是那句話。
//
// ⚠ 「由分享者填寫」是**必要的反釣魚標記**（計畫書 C-5）：備註與這張圖上其他所有
//   內容共用同一套排版，而其他每一段都是本站從遊戲資料算出來的。不標的話，
//   一句「這套打 XX 副本必過」會被讀成本站的判斷。
//
// ⚠ **沒有備註時整塊不印，不留空框**：一個空的框在一張公開圖上讀起來像「這裡漏了」。
//
// ⚠ 別把備註塞進 HERO 或檔名（計畫書 C-5）：長度不可控（100 碼點／6 行），
//   會把十字整個推下去。
//
// ⚠ `white-space: pre-line`：換行是使用者刻意打的（`sanitizeLoadoutNote()` 特地留著它，
//   那正是備註與方案名稱唯一的實質差別）。

function NoteBand({ note }: { note: string | undefined }) {
  if (!note) return null
  return (
    <div style={{
      margin: '14px 16px', padding: '10px 14px',
      borderLeft: `3px solid ${C.orange}`, background: 'rgba(255,107,43,0.06)',
    }}>
      <div style={{
        fontFamily: ORB, fontSize: 9, letterSpacing: 2, color: C.orange, marginBottom: 5,
      }}>NOTE</div>
      <p style={{
        fontSize: 13, color: C.text, lineHeight: 1.75, whiteSpace: 'pre-line', margin: 0,
      }}>{note}</p>
      <div style={{ fontSize: 10, color: C.dim, marginTop: 6 }}>由分享者填寫，非本站資料</div>
    </div>
  )
}

// ─── 攜帶技能（PLAN-052-L D-5，團隊回饋 3）───────────────────────────────────
//
// 三個 chip：圖示 ＋ 名稱 ＋ 型別。位置在備註之後、武器與元件之前
// （B-5 的目標版面：「Phase D 的攜帶技能接在備註後面」）。
//
// ⚠ **不印技能敘述**：實測 p50 42 字／max 213，而且只有 4 筆含句號 ⇒
//   「只取首句」是 no-op（同 B-3 對神經驅動敘述的那一條）。整段印下去，這張圖會從
//   「我的配裝」變成機師懶人包 —— 而那一頁本站已經有了。
//
// ⚠ **不印格數分母**（「攜帶 2 / 4」）：第四格是「改」技能，站上沒有那份資料、
//   UI 也隱藏著（見 `LoadoutSkills.mod`）。把它算進分母，讀者會以為這張圖漏了一個。
//   要有數字就只講**印出來的那幾個**。
//
// ⚠ 缺 iconLocal 的 14 筆（619 個被持有技能中）畫**實心底 ＋ 型別首字**，
//   不要虛線空框：空框讀起來像「一個我不認得的東西」，而實際上只是我們少一張圖。
//   ⚠ 這與模組帶（A-2）「缺圖就留白不畫框」刻意不同：那裡每一列都有部位標籤與名稱
//     撐著版面，這裡的 chip 只有一顆圖示 ＋ 一個名字，留白會讓那顆 chip 塌掉半邊。
//
// ⚠ 第四格「改」技能整格不印（`draft.skills.mod` 有值也一樣）：站上沒有這份資料，
//   印一個查不到名字的東西只會是一個問號。

function SkillBand({ skills }: { skills: readonly PilotSkillDoc[] }) {
  if (skills.length === 0) return null
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, background: C.bg }}>
      <SectionHead title="攜帶技能" note={`${skills.length} 個`} tone={C.cyan} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '12px 16px' }}>
        {skills.map((sk) => (
          <div key={sk.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
            padding: '6px 10px 6px 6px', background: C.panel, border: `1px solid ${C.lineStrong}`,
          }}>
            {sk.iconLocal ? (
              <FallbackImage
                candidates={imageCandidates(sk.iconLocal)}
                alt=""
                // ⚠ 退化態走下面那顆方塊，不是 `null`：這一格塌掉會讓 chip 少半邊
                fallback={<SkillTypeBox type={sk.type} />}
                style={{ width: 28, height: 28, objectFit: 'cover', display: 'block', flexShrink: 0 }}
              />
            ) : <SkillTypeBox type={sk.type} />}
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, color: C.text, whiteSpace: 'nowrap' }}>{sk.name}</span>
              <span style={{ fontSize: 10, color: C.dim, whiteSpace: 'nowrap' }}>{sk.type}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 缺圖時的退化方塊：實心底 ＋ 型別首字（被／主／指…）。見 `SkillBand` 的 ⚠。 */
function SkillTypeBox({ type }: { type: string }) {
  return (
    <span style={{
      width: 28, height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#1f2530', border: `1px solid ${C.lineStrong}`, fontSize: 13, color: C.sub,
    }}>{[...(type || '?')][0]}</span>
  )
}

// ─── 武器與元件明細（PLAN-052-L B-5）────────────────────────────────────────
//
// 十字回答的是「哪一格裝了什麼」（幾何問題），這一帶回答的是「這一把怎麼改」
// （配置問題）。把元件名塞回 300px 的槽位格上，那一格就得同時表達六種狀態
// ＋ 四個元件名 ＋ 兩個計數 —— 與螢幕版右欄拆出武器列是同一條理由。
//
// ⚠ 順序與清單一律走 `weaponRows()`（＝ `enumerateSlots()` 的順序），與十字同源：
//   兩份東西講同一件事卻排不成同一個順序，讀者只會以為其中一份漏了。
// ⚠ 固定武裝與形態鎖定的武裝**要進這份清單**——它們一樣佔槽、一樣計入總重，
//   而那正是玩家最想確認自己有沒有看漏的幾把。

function WeaponDetailBand({ ctx }: { ctx: LoadoutContext }) {
  const rows = weaponRows(ctx)
  const used = rows.reduce((n, r) => n + r.used, 0)
  const limit = rows.reduce((n, r) => n + r.limit, 0)
  /**
   * 縮圖欄要不要留（見下方那一格）。
   *
   * ⚠ 這裡與十字（`ExportSlotCell`）刻意**不同條**：那邊是獨立的格子，缺圖就不佔位；
   *   這裡是**一份由上而下的清單**，逐列各自決定要不要留 30px，會讓槽位標籤忽左忽右。
   *   實測全庫 182 把有 10 把沒有圖，而那 10 把正是 8 筆固定武裝 ＋ 征伐 ＋ 速射格林炮
   *   —— 也就是最常與別把武器同框出現的那幾把。
   * ⚠ 但**整帶都沒有圖時不留**：那時留下的是一條沒有任何內容的空欄。
   */
  const iconGutter = rows.some((r) => r.weapon?.icon)

  return (
    <>
      <SectionHead
        title="武器與元件"
        note={limit > 0 ? `${rows.length} 把 · 元件 ${used} / ${limit}` : `${rows.length} 把`}
        tone={SEG_HEX.hands}
      />
      {rows.length === 0 ? (
        <p style={{ padding: '14px 16px', fontSize: 12, color: C.dim }}>這一套還沒有裝上任何武器。</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((r) => (
            <div key={r.rowKey} style={{
              display: 'flex', gap: 10,
              padding: '9px 16px', borderBottom: `1px solid ${C.line}`,
            }}>
              {/* 武器縮圖（使用者回饋 2026-08-30）。尺寸與 `ExportSlotCell` 的 30px 同階
                  —— 同一把武器在十字與這裡各出現一次，差一階會看起來像兩件不同的東西。
                  ⚠ 缺圖時**留空不畫框**（同 `ModuleBand` 那一條）：一個空方塊夾在正常圖示
                    中間，會被讀成「有一把我不認得的武器」，而實際上只是我們少一張圖。 */}
              {iconGutter && (
                <span style={{ width: 30, height: 30, flexShrink: 0, marginTop: 1 }}>
                  {r.weapon?.icon && (
                    <FallbackImage
                      candidates={imageCandidates(r.weapon.icon)}
                      alt=""
                      fallback={null}
                      style={{ width: 30, height: 30, objectFit: 'contain', display: 'block' }}
                    />
                  )}
                </span>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, flexGrow: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
                  <span style={{ fontSize: 11, color: C.sub, width: 52, flexShrink: 0 }}>{r.label}</span>
                  <span style={{
                    fontSize: 14, fontWeight: 700, minWidth: 0, wordBreak: 'break-word',
                    color: r.locked ? C.yellow : C.text,
                  }}>{r.name}</span>
                  {/* ⚠ 分母是 componentLimit（觸＋應的**合計**上限），不是兩種各自的格數相加。
                      limit 為 0 的（A／B 品質 39 把與 8 筆固定武裝）印「不可裝元件」而不是 0/0 */}
                  <span style={{
                    marginLeft: 'auto', fontFamily: MONO, fontSize: 11, flexShrink: 0,
                    color: r.limit === 0 ? C.dim : r.used > 0 ? C.orange : C.sub,
                  }}>
                    {r.limit > 0 ? `元件 ${r.used} / ${r.limit}` : '不可裝元件'}
                  </span>
                </div>
                {/* ⚠ 沒裝的照樣印「未裝元件」而不是留白 —— 留白讀起來像「這張圖漏了」。
                    查不到的元件印回 doc id（`slotComponents()`），斷鏈要在圖上看得見。 */}
                {r.limit > 0 && (
                  r.used > 0 ? <ComponentChips ctx={ctx} slot={r.ref} /> : (
                    <span style={{ fontSize: 11, color: C.dim, lineHeight: 1.6 }}>未裝元件</span>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {/* 免責的落點（A-4 註記的那一條）：改版後推導層數更多了 —— 模組 Lv 是本站推算的，
          然後照那個 Lv 去印該階的效果全文。 */}
      <div style={{
        padding: '10px 16px', borderTop: `1px solid ${C.line}`,
        background: 'rgba(18,21,28,0.5)', fontSize: 11, color: C.dim, lineHeight: 1.7,
      }}>
        數值以武器滿級（LV.70）與滿品質階為前提。
      </div>
    </>
  )
}

/**
 * 一列武器上掛的元件：**圖示 ＋ 名稱**（使用者回饋 2026-08-30）。
 *
 * 改寫前這裡是一行「觸元件-共力・應元件-擴膛・…」的頓號串。點名四顆元件要讀四個
 * 六字名，而玩家在遊戲裡認的是那顆圖 —— 十字上的武器格早就畫著同一批圖示
 * （`SlotCell`／`ExportRig`），這一帶卻只有字，同一件事在同一張圖上長成兩個樣子。
 *
 * ⚠ 換行由 `flexWrap` 負責、**名字自己不折**（`nowrap`）：一顆元件的圖與它的名字
 *   斷在兩行，讀起來會像多了一顆沒有名字的元件。
 */
function ComponentChips({ ctx, slot }: { ctx: LoadoutContext; slot: WeaponSlotRef }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px 12px', paddingLeft: 61 }}>
      {slotComponents(ctx, slot).map((c, i) => (
        <span key={`${c.id}#${i}`} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <ExportComponentIcon comp={c.comp} size={26} />
          <span style={{ fontSize: 11, color: C.sub, whiteSpace: 'nowrap' }}>{c.name}</span>
        </span>
      ))}
    </div>
  )
}

/**
 * 元件圖示：外框（觸／應，W 型另一套）＋ 斜掛其上的技能圖，與站上的 `ComponentIcon`
 * 同一個構圖。
 *
 * ⚠ **不借用 `ComponentIcon`**（同 `ModuleBand` 那一條）：那顆帶 Tailwind 類別，
 *   而本檔一律寫死十六進位；它也直接吃 `assetUrl()` 而沒有 `.webp` 退路。
 * ⚠ 外框佔滿整格（站上版是 80%）：26px 的格子裡再縮兩成，斜掛的那張技能圖只剩 12px。
 *   內圖仍是外框的 60%（＝站上 48/80 的同一個比例），構圖因此沒有變，只是整體放大。
 * ⚠ 查不到的元件（`comp` 為 null）不畫框：名字已經退回 doc id 在說這件事了，
 *   補一個空框只會多一個問號。
 */
function ExportComponentIcon({ comp, size }: { comp: Component | null; size: number }) {
  if (!comp) return null
  const isW = comp.componentsWType === ComponentsWType.W
  const outer = comp.outerFrameLocal
    ?? `/images/components/OuterFrame/statetype_${comp.componentType}${isW ? '_W' : ''}.png`
  return (
    <span style={{ position: 'relative', width: size, height: size, flexShrink: 0, display: 'block' }}>
      <FallbackImage
        candidates={imageCandidates(outer)}
        alt=""
        fallback={null}
        style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: '100%', height: '100%', objectFit: 'contain',
        }}
      />
      {comp.iconLocal && (
        <FallbackImage
          candidates={imageCandidates(comp.iconLocal)}
          alt=""
          fallback={null}
          style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-51%, -52%) rotate(16deg)',
            width: '60%', height: '60%', objectFit: 'contain',
          }}
        />
      )}
    </span>
  )
}

// ─── 神經驅動算力：只印 γ（PLAN-052-L B-3）──────────────────────────────────
//
// 團隊逐字：「α 和 β 兩個算力區不用理會，玩家一定會塞滿，真正有差異的是 γ1 和 γ2 ——
// 這邊要滿，玩家必須投入一種昂貴的資源叫做仿生超導體」。
//
// ⚠ **哪幾區要印**一律問 `printedNdZones()`（PLAN-052-L E-1 抽出，與純文字摘要共用）。
//   γ 的判準是 `startsWith('γ')`、α／β 只在偏離預設時才印，兩條 ⚠ 都寫在那一支上
//   —— 尤其「不可寫成 `['γ1','γ2'].includes()`」與「不可印『α／β 全機師一致』」。
//
// ⚠ 敘述**不要寫「只取首句」的截斷**：實測 440 筆能力敘述含句號 0 筆 —— 那個截斷是
//   no-op，只會讓下一個人以為高度有上界。（真的嫌太滿時，退路是「只給每區最高一級
//   印敘述」，那是一行 if。）
//   440 筆 p50 26 字／p90 48／max 100，含 <token> 0 筆 ⇒ 不必為它建 sanitizer；
//   含 [引用] 339 筆 ⇒ 原樣印（官方文案本來就長那樣，同模組敘述的處置）。

function NeuralDriveBand({ pilot, ndLevels, ndBonus, ndAbilityMap, ndZones }: {
  pilot: Pilot | null
  ndLevels: Record<string, number>
  ndBonus?: NdPowerBonus | null
  ndAbilityMap: Map<string, NeuralDriveAbility>
  ndZones: Set<string>
}) {
  const drives = pilot?.neuralDrive ?? []
  const defaults = defaultNdLevels(pilot?.neuralDrive, (aid) => ndAbilityMap.get(aid))
  // ⚠ 過濾走共用的 `printedNdZones()`（PLAN-052-L E-1 抽出）：純文字摘要必須印出
  //   **同一批分區**，各寫一份的漂移症狀是「圖上有 α、複製出來的文字沒有」。
  const shown = printedNdZones(drives, ndLevels, defaults)

  if (drives.length === 0) {
    return <p style={{ padding: '14px 16px', fontSize: 12, color: C.dim }}>這位機師沒有神經驅動資料。</p>
  }

  // ★ 只標**印出來的**那幾區：一個沒出現在圖上的分區名會讓讀者去找一條不存在的條
  const starred = [...ndZones].filter((z) => shown.some((d) => d.name === z))

  return (
    <>
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {shown.map((d, i) => {
          const lv = ndLevels[d.name] ?? 0
          return (
            <div key={d.name} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {i > 0 && <div style={{ height: 1, background: C.line, marginBottom: 6 }} />}
              <ZoneBar drive={d} lv={lv} starred={ndZones.has(d.name)} boosted={ndBonus?.zone === d.name} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(d.levels ?? []).filter((lvl) => lvl.level <= lv).map((lvl) => {
                  const ability = resolveNeuralDriveLevel(lvl, ndAbilityMap)
                  // 資料未遷移且嵌入欄位也空 → 不印一列空白（那一列除了佔位什麼都沒說）
                  if (!ability.name) return null
                  return (
                    <div key={lvl.level} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        {/* ⚠ 寬度要放得下兩位數 minSum（Lv6 · 16）並強制不換行：
                            52px 在 minSum ≥ 10 時會把「· 16」擠到第二行（實測） */}
                        <span style={{
                          fontFamily: MONO, fontSize: 11, color: C.dim,
                          width: 64, flexShrink: 0, whiteSpace: 'nowrap',
                        }}>
                          Lv{lvl.level} · {lvl.minSum}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text, minWidth: 0 }}>{ability.name}</span>
                      </div>
                      {ability.description && (
                        <span style={{ fontSize: 11, color: C.sub, lineHeight: 1.6, paddingLeft: 72 }}>
                          {ability.description}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* α／β 沒有印出來這件事要交代一句 —— 不講的話，看過機師頁的人會以為這張圖漏了兩區。
          ⚠ 措辭不可寫成「α／β 全機師一致」（見上方 ⚠）：這句只講「這張圖印了什麼」，
            不對沒印出來的那幾區做任何斷言。 */}
      {shown.length < drives.length && (
        <div style={{ padding: '0 16px 12px', fontSize: 11, color: C.dim, lineHeight: 1.7 }}>
          本圖只印 γ 區（仿生超導體投入的差異在這裡）；α／β 固定滿級，不另列。
        </div>
      )}

      {/* ── 模組給的算力加成（PLAN-052-M）──────────────────────────────────────
          ⚠ **有加成就一定要印這一行**：上面那幾條 Lv 條印的是**生效**算力，
            而玩家在遊戲裡點出來的是投入值 —— 兩者差一級。不講來源的話，
            收到圖的人會拿它去對自己的畫面，然後以為本站算錯了一格。
          ⚠ 落點會跳（它是「算力最低的 γ 區」），所以要指名**現在**落在哪一區。 */}
      {ndBonus && (
        <div style={{
          margin: '0 16px 14px', padding: '9px 12px',
          background: 'rgba(234,179,8,0.07)', borderLeft: `2px solid ${C.yellow}`,
          fontSize: 11, color: C.sub, lineHeight: 1.7,
        }}>
          <span style={{ color: C.yellow, fontWeight: 700 }}>⊕ {ndBonus.moduleName} LV.MAX</span>
          {ndBonus.zone
            ? `：已解鎖分區中算力最低的一區 +${ndBonus.amount} —— 落在 ${ndBonus.zone}，生效算力 ${ndBonus.power}（上方 Lv 條已含這一級）`
            : `：已解鎖分區中算力最低的一區 +${ndBonus.amount} —— 但 γ 區已滿級，這 ${ndBonus.amount} 點沒有落點`}
        </div>
      )}

      {starred.length > 0 && (
        <div style={{
          margin: '0 16px 14px', padding: '10px 12px',
          background: 'rgba(236,72,153,0.07)', borderLeft: `2px solid ${C.pink}`,
          fontSize: 12, color: C.sub, lineHeight: 1.7,
        }}>
          標<span style={{ color: C.pink, fontWeight: 700 }}> ★ </span>的分區（
          {starred.join('、')}）會就地改寫天賦與技能敘述的階名。
        </div>
      )}
    </>
  )
}
function ZoneBar({ drive, lv, starred, boosted }: {
  drive: NeuralDrive; lv: number; starred: boolean
  /** 這一區吃到模組加成 ⇒ 最上面那一格畫成虛線（見 `NeuralDriveBand` 的 ⚠） */
  boosted?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <span style={{ fontSize: 17, fontWeight: 800, position: 'relative', width: 30, flexShrink: 0 }}>
        {drive.name}
        {starred && (
          <i style={{ position: 'absolute', top: -5, right: -4, fontSize: 11, color: C.pink, fontStyle: 'normal' }}>★</i>
        )}
      </span>
      <span style={{ display: 'flex', gap: 4, flexGrow: 1, minWidth: 0 }}>
        {(drive.levels ?? []).map((l) => {
          // 加成給的就是最上面那一格：畫成虛線描邊的淡黃，與玩家投入的實心格分得開。
          // 與螢幕版 `NdPowerBar` 的加成格同一套視覺語彙（同源，不是各畫各的）。
          const bonusCell = boosted && l.level === lv
          return (
            <i key={l.level} style={{
              flexGrow: 1, minWidth: 0, height: 16, display: 'block', boxSizing: 'border-box',
              background: bonusCell ? 'rgba(234,179,8,0.3)' : l.level <= lv ? C.yellow : C.panel,
              border: bonusCell ? `1px dashed ${C.yellow}` : l.level <= lv ? 'none' : `1px solid #2f3646`,
            }} />
          )
        })}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 14, color: C.text, width: 28, textAlign: 'right', flexShrink: 0 }}>
        {zonePower(drive, lv)}
      </span>
    </div>
  )
}

function FooterField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
      <span style={{ fontFamily: ORB, fontSize: 9, letterSpacing: 2, color: C.dim }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 13, color: C.sub }}>{value}</span>
    </div>
  )
}

// ─── 匯出執行器（PLAN-052-I E-3）────────────────────────────────────────────
//
// **只在按下匯出時才掛載**，掛載即開拍、拍完回報。這樣做的取捨：
//
//   · 常駐一份離屏卡  → 沒有 mount→capture 的競態，但每個進頁的人都要付
//                       `patchVersions` 的讀取與一份 1000px DOM 的 render，
//                       而其中絕大多數人不會匯出。
//   · 按下才掛載（本作法）→ 不匯出的人零成本，代價是要自己等圖與字體就緒。
//
// 等待的部分寫成**輪詢**而不是一次性的 load 監聽：`FallbackImage` 會在載入失敗時
// 換下一個候選，一次性監聽會在第一次 error 就放行，於是拍到一張還沒換好的圖。
//
// ⚠ 拍的是 host 的**子元素**不是 host 本身：host 帶著 `position: fixed; left: -10000px`，
//   html-to-image 會把那份 computed style 一起複製到 clone 上，內容就被推出畫布外了。

interface RunnerProps extends Omit<LoadoutExportCardProps, 'generatedAt' | 'gameVersion'> {
  /** 完成（或失敗）時回報。`error` 為 null ＝ 成功 */
  onDone: (error: Error | null) => void
}

/** 檔名裡不能出現的字元（Windows 最嚴，一律照它清）。 */
const BAD_FILENAME = /[\\/:*?"<>|]/g

export function LoadoutExportRunner({ onDone, ...card }: RunnerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const { data: versions, loading } = usePatchVersions()

  // 台服當前版本。取不到就不印那一欄 —— 印一個猜的版本號比不印更糟
  const gameVersion = useMemo(() => versions.find((v) => v.isTwCurrent)?.version, [versions])
  // 掛載當下取一次就好：拍照過程中跨日的機率不值得為它多一個依賴
  const generatedAt = useMemo(() => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }, [])

  useEffect(() => {
    // patchVersions 未就緒就先不拍：footer 會少一個版本號，而那是這張圖唯一的時間座標
    if (loading) return

    // ⚠ **不要用「已啟動」的 ref 去重**（實測踩過）：StrictMode 會把 effect 跑兩次
    //   （run → cleanup → run），旗標會讓第一次佔住、被 cleanup 取消，第二次直接 return
    //   ⇒ 兩次都沒拍成，按鈕永遠停在「產生中…」。而且這個症狀**只在 dev 出現**，
    //   正式站看起來是好的 —— 那正是最糟的一種：改壞了不會有人發現。
    //   正解是讓這支 effect 本來就可重入：cleanup 取消上一輪，新的一輪重拍。
    let alive = true
    const run = async () => {
      const el = hostRef.current?.firstElementChild as HTMLElement | null
      if (!el) {
        onDone(new Error('匯出版面沒有掛載成功'))
        return
      }
      try {
        await waitForRenderReady(el)
        if (!alive) return
        const dataUrl = await toPng(el, { backgroundColor: '#0a0c10', pixelRatio: EXPORT_PIXEL_RATIO, skipFonts: false })
        if (!alive) return
        // ⚠ 檔名帶上形態名（PLAN-052-F D-2）：海莉絲三個分頁各匯一張，
        //   不帶的話三張是同一個檔名，瀏覽器只會加 (1)(2) —— 而那個編號與形態無關，
        //   存到桌面之後就分不出哪張是哪一套了。這與「圖上要標形態名」是同一個理由，
        //   只是換成檔案總管那一層。沒有形態的機師不加後綴（88 位機師照舊）。
        // 沒有方案名時退回機甲名 —— 取**圖上印的那台**（`identityMech`），
        // 否則檔名會與圖裡的抬頭不同名
        const base = (card.name ?? card.ctx.identityMech?.name ?? card.ctx.mech?.name ?? 'loadout')
          .replace(BAD_FILENAME, '_')
        const suffix = card.ctx.form?.name ? `_${card.ctx.form.name.replace(BAD_FILENAME, '_')}` : ''
        const a = document.createElement('a')
        a.download = `配裝_${base}${suffix}.png`
        a.href = dataUrl
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        onDone(null)
      } catch (err) {
        console.error('[Loadout] export error:', err)
        if (alive) onDone(err instanceof Error ? err : new Error(String(err)))
      }
    }
    void run()
    return () => { alive = false }
  }, [loading, onDone, card.name, card.ctx.identityMech?.name, card.ctx.mech?.name, card.ctx.form?.name])

  return (
    <div
      ref={hostRef}
      aria-hidden
      // 離屏而不是 `display:none`：後者量不到尺寸、圖也不見得會載入
      style={{ position: 'fixed', left: -10000, top: 0, width: 1000, pointerEvents: 'none', zIndex: -1 }}
    >
      <LoadoutExportCard {...card} generatedAt={generatedAt} gameVersion={gameVersion} />
    </div>
  )
}

/** 圖與字體就緒才放行。有硬上限——等不到也要出圖，一張少一張圖好過一個按了沒反應的按鈕。 */
async function waitForRenderReady(el: HTMLElement): Promise<void> {
  try { await document.fonts?.ready } catch { /* 不支援或被拒 → 直接往下走 */ }

  const deadline = Date.now() + 5000
  // 輪詢而不是監聽 load：FallbackImage 換候選時 complete 會再變回 false，
  // 一次性的 load/error 監聽會在第一次失敗就放行
  for (;;) {
    const imgs = [...el.querySelectorAll('img')]
    if (imgs.every((img) => img.complete)) break
    if (Date.now() > deadline) {
      console.warn('[Loadout] 匯出圖等待逾時，仍有圖片未載入完成')
      break
    }
    await new Promise((r) => setTimeout(r, 60))
  }

  // 兩輪 rAF：讓上面 await 期間發生的 src 抽換完成排版後才拍
  await nextFrames(2)
}

