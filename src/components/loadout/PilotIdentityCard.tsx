import type { Pilot } from '../../types'
import { imageCandidates, pilotFullArtPath } from '../../utils/assets'
import { FallbackImage } from '../common/FallbackImage'
import { CLASS_CONFIG } from '../badges/PilotBadges'
import { HUD, HUD_BTN, HUD_TAG } from './loadoutTheme'
import LoadoutIcon from '../icons/LoadoutIcon'

// ─── 機師身分卡（PLAN-052-I C-1）────────────────────────────────────────────
//
// 站上有 87 位機師的去背立繪（1240×1080），改版前模擬器一張都沒用到 ——
// 玩家在配一台看不見的機甲，也在扮演一位看不見的機師。這張卡把立繪掛成常駐身分卡。
//
// ⚠ **不做入場動畫**（計畫書決策二）。「選角 → 全身照 → 滑動 → 展開配裝」的演出
//   成本不在第一次而在第五次：玩家換一把武器想看重量差多少，不該再看一次演出。
//   「選角感」改掛在頭像牆挑選器（C-2）與形態切換（052-F）那種真的有兩個狀態要對比的地方。
//
// ⚠ **卡片高度寫死**。立繪是非同步載入的，讓圖決定高度會在它到位那一刻把整個左欄
//   往下推（下面還有配裝概況、之後還有算力面板）。固定高度 ＋ 出血裁切，
//   載入前後版面完全不動。
//
// ⚠ 立繪**靠右下出血**、左側壓一層深色漸層：`full.webp` 是去背橫式圖，
//   人物重心偏中上，直接鋪滿會讓左側的名字與徽章壓在臉上。
//
// ⚠ **這裡刻意不用官方原稿 `art.webp`**（2026-08-28 實測後的決定）。
//
//   站上有兩種機師立繪，構圖不同、不是同一張的兩種尺寸：
//     · `full.webp`  1240×1080  橫式半身特寫（官方 CDN 裁切圖，87/88 位有）
//     · `art.webp`    863×1600  直式完整全身（官方原稿，只有 52/88 位有）
//
//   直式全身版本做出來比對過：在這張卡的尺寸下，**半身特寫的臉更大、更認得出是誰**，
//   而全身圖為了塞下腿部，頭只剩約 38px。身分卡要回答的是「這位是誰」，不是「他站著長怎樣」。
//   加上原稿只有 59% 覆蓋率，用它等於讓四成機師走另一種版面。
//
//   機師原稿改留給**機師故事館**那種有整頁高度可用、且以「看人物」為目的的頁面。
//   查詢工具在 `utils/assets`（`hasPilotArt()` / `pilotKeyArtPath()`）已經備好，這裡只是不用。

/** 職業色只取 `text-*` 那一段 —— CLASS_CONFIG 的值是「文字色 底色 框線」三件一組。 */
function classText(pilotClass: string): string {
  return CLASS_CONFIG[pilotClass]?.split(' ')[0] ?? 'text-text-secondary'
}

export function PilotIdentityCard({
  pilot, onChange, compact,
}: {
  pilot: Pilot | null
  onChange: () => void
  compact?: boolean
}) {
  const height = compact ? 'h-[170px]' : 'h-[228px]'

  if (!pilot) {
    return (
      <section
        className={`hud-cut relative ${height} border border-border-accent bg-bg-card flex flex-col items-center justify-center gap-2`}
      >
        <span className={`${HUD.label} text-text-dim`}>Pilot</span>
        <p className={`${HUD.body} text-text-dim px-4 text-center`}>還沒有選機師。</p>
        <button
          type="button"
          onClick={onChange}
          className={`${HUD_BTN} px-4 py-1.5 text-[13px] inline-flex items-center gap-1.5`}
        >
          <LoadoutIcon name="plus" className="w-3.5 h-3.5" strokeWidth={2.4} />
          選擇機師
        </button>
      </section>
    )
  }

  const art = imageCandidates(pilotFullArtPath(pilot))
  const tone = classText(pilot.class)

  return (
    <section className={`hud-cut relative ${height} overflow-hidden border border-border-accent bg-bg-card`}>
      {art.length > 0 && (
        <FallbackImage
          candidates={art}
          alt={pilot.name}
          loading="lazy"
          className="absolute -right-8 bottom-0 h-full w-auto max-w-none object-contain object-bottom drop-shadow-[0_12px_26px_rgba(0,0,0,0.55)]"
          // 立繪載不出來就整張不畫：留一個破圖框比沒有圖更糟，
          // 而卡片本身（名字與三顆徽章）在沒有立繪時仍然完整可讀
          fallback={null}
        />
      )}
      {/* 左側遮罩：讓名字與徽章在任何一張立繪上都讀得到 */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,12,16,0.94)_26%,rgba(10,12,16,0.3)_64%,transparent)]"
      />

      <div className="relative h-full flex flex-col gap-2 px-4 py-3.5">
        <span className={`${HUD.label} text-text-dim`}>Pilot</span>

        <div className="flex flex-col gap-1.5 min-w-0">
          <h2 className={`${HUD.sectionTitle} text-text-primary truncate`}>{pilot.name}</h2>
          <div className="flex flex-wrap gap-1.5">
            <Chip tone={tone}>{pilot.class}</Chip>
            <Chip tone="text-accent-orange">{pilot.rarity}</Chip>
            <Chip>{pilot.license}執照</Chip>
          </div>
        </div>

        {/* ⚠ 這裡**不放 AP／回復**：那是戰鬥資源，與「這台裝得下什麼」無關，
            放上來只是把機師詳情頁的數字再抄一份。這張卡只回答身分問題
            （誰、什麼職業、開得了哪一級機甲）。 */}

        <button
          type="button"
          onClick={onChange}
          // ⚠ 這顆鍵與上方三個標籤原本長得一模一樣（切角＋框線＋深底），
          //   四個框排在一起沒有任何線索指出哪一個按得下去（使用者回報 2026-08-27）。
          //   現在標籤讓出切角改圓角，按鈕保留切角並補一顆圖示與 hover。
          className={`${HUD_BTN} mt-auto self-start px-3.5 py-1.5 text-[13px] inline-flex items-center gap-1.5`}
        >
          <LoadoutIcon name="swap" className="w-3.5 h-3.5" />
          更換機師
        </button>
      </div>
    </section>
  )
}

/**
 * 職業／品質／執照三個**唯讀標籤**。
 *
 * ⚠ **圓角、不是切角**（使用者要求 2026-08-27）：切角在配裝器裡是「可互動」的語彙，
 *   標籤佔著它會讓旁邊真正的按鈕失去辨識度。站上既有的徽章元件本來就是圓角，
 *   這裡只是把漏掉的那個例外補回來。
 */
function Chip({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`${HUD_TAG} px-2 py-0.5 text-[12px] font-bold border-current/40 ${tone ?? 'text-text-secondary'}`}>
      {children}
    </span>
  )
}

