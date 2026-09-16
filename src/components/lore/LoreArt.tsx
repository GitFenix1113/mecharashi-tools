import { useCallback, useEffect, useRef, useState } from 'react'
import { FallbackImage } from '../common/FallbackImage'

/**
 * 機師故事館的「顯影」立繪（PLAN-042-A C-1）。
 *
 * ── 三層構造 ──────────────────────────────────────────────────────────────
 * 底 `lore-art__sketch`  灰階原圖
 * 中 `lore-art__dodge`   同一張圖反相＋模糊，`mix-blend-mode: color-dodge`
 *                        ⇒ 兩層疊起來就是「鉛筆線稿」（dodge 把灰階平面推爆成白，
 *                          只有明暗急遽變化的邊緣留得住 ⇒ 邊緣＝線）
 * 上 `lore-art__color`   彩色原圖，opacity 0 → 1 淡入蓋掉線稿
 *
 * ⚠ **isolate 容器自帶固定中性底 `#0a0c10`（字面值，寫在 index.css）**。
 *   color-dodge 混的是 backdrop，而館內 `--color-bg-dark` 已被覆寫成紙色 ——
 *   底色若寫成 `var(--color-bg-dark)`，去背區的 backdrop 接近白，
 *   `dodge(接近白, 任何值)` 直接飽和成純白，顯影效果**整個消失且不報錯**，
 *   看起來只像「線稿層沒生效」。這也是 `isolation: isolate` 無條件必須的理由：
 *   沒有它，color-dodge 會混到頁面上任意的祖先背景，量測基準全部作廢。
 *
 * ── 只動 opacity ──────────────────────────────────────────────────────────
 * blur / brightness 的**數值不做動畫**：filter 動畫每幀都要重跑一次模糊，
 * 863×1600 的圖在中階機上直接掉幀。動的只有彩色層的 `opacity`（合成器可獨立處理），
 * 線稿的 blur 從頭到尾是固定值，由 `--lore-art-blur` / `--lore-art-brightness` 帶進 CSS。
 *
 * ── reduced-motion ────────────────────────────────────────────────────────
 * 元件端**不寫 `matchMedia`**，全交給 index.css 的 `@media (prefers-reduced-motion: reduce)`
 * ——那邊直接 `display: none` 掉兩層線稿並把淡入壓到 150ms。
 * 元件的狀態機照跑（transitionend 仍會來），差別只在肉眼看到什麼。
 *
 * 所有 `.lore-art*` class 由 C-4a 寫在 `src/index.css`，本檔不自帶 `<style>`。
 */

export interface LoreArtProps {
  /**
   * FallbackImage 的候選清單，呼叫端用 imageCandidates() 產生。
   * ⚠ **三層一律使用 candidates[0]**（線稿兩層直接用它，彩色層交給 FallbackImage 逐層退回）。
   *   呼叫端必須保證 candidates[0] 是實際存在的檔案——FallbackImage 把「最後成功的是哪一個」
   *   關在自己的 state 裡，外面拿不到（FallbackImage.tsx:17-33）。
   *   今天 88 位全部成立（tall 只有一條候選；wide 的 candidates[0] 是 full.webp／阿列娜是 full.png，都存在）。
   */
  candidates: string[]
  alt: string
  /**
   * 構圖。呼叫端必須在**渲染前**用 hasPilotArt() 決定，不可等圖載失敗才換。
   * 'tall' = art.webp 863×1600 直式全身；'wide' = full.webp 1240×1080 橫式半身。
   */
  variant: 'tall' | 'wide'
  /** per-pilot 調參的查表鍵。機師傳 pilotArtDir(pilot)。未傳或查無 → 用預設參數。 */
  artKey?: string
  /** 顯影延遲。機師 450、機甲 250（官網兩區實測值不同）——不得寫死在元件內。 */
  revealDelayMs?: number
  /** 顯影時長，預設 900。 */
  revealDurationMs?: number
  /** 底部 mask。**預設 `variant === 'wide'`**，呼叫端只在要覆寫預設時才傳。 */
  bottomMask?: boolean
  /** 顯影結束後回呼一次。 */
  onRevealed?: () => void
  className?: string
}

/** 個別機師的顯影退路。零觸發 54.2% 高光門檻，關掉線稿層只留淡入。 */
export interface LoreArtTuning {
  /** false = 不掛線稿層（只淡入） */
  lineArt?: boolean
  /** color-dodge 層的 blur 半徑 px，預設 6 */
  blurPx?: number
  /** color-dodge 層的 brightness，預設 1 */
  brightness?: number
}

/**
 * 查表鍵是 **pilotArtDir(pilot)（圖片資料夾名）**，不是機師的顯示名稱。
 * （這裡刻意不寫出那個屬性名，好讓地雷 M-15 的 grep 在本目錄保持零命中。）
 * ⚠ 驗收樣本的「凱登」指資料夾 `凱登/`（有 art.webp），不是 `淬鋒凱登/`（沒有）——兩者是不同機師。
 * 臨界樣本（先不調、留作驗收）：戰部渡 26.7% / 卡米拉 26.2% / 虎王 25.2%；凱登 1.8% 是最暗對照。
 *
 * ⚠ 要壓某一位的爆光請在這裡加 `blurPx` / `brightness`，**不要動全域預設**——
 *   全域預設是所有量測值的基準。
 */
export const LORE_ART_TUNING: Record<string, LoreArtTuning> = {
  零: { lineArt: false },
}

/** 顯影延遲預設值（ms）。呼叫端一律明寫，這裡只是漏傳時的退路。 */
const DEFAULT_DELAY_MS = 450
/** 顯影時長預設值（ms）。 */
const DEFAULT_DURATION_MS = 900
/** color-dodge 層的模糊半徑預設值（px）。⚠ 未經實機量測，見契約第 7 節開放問題 2。 */
const DEFAULT_BLUR_PX = 6
/** color-dodge 層的亮度預設值（無單位）。 */
const DEFAULT_BRIGHTNESS = 1
/** transitionend 沒來時的保險餘裕（ms）。 */
const SETTLE_GRACE_MS = 100

type Phase = {
  /** 這組狀態屬於哪一張圖。candidates 換人時整組歸零。 */
  key: string
  revealed: boolean
  settled: boolean
  lineArtFailed: boolean
}

const FRESH = { revealed: false, settled: false, lineArtFailed: false }

export default function LoreArt({
  candidates,
  alt,
  variant,
  artKey,
  revealDelayMs,
  revealDurationMs,
  bottomMask,
  onRevealed,
  className,
}: LoreArtProps) {
  const tuning = LORE_ART_TUNING[artKey ?? '']
  const delay = revealDelayMs ?? DEFAULT_DELAY_MS
  const dur = revealDurationMs ?? DEFAULT_DURATION_MS
  const blurPx = tuning?.blurPx ?? DEFAULT_BLUR_PX
  const brightness = tuning?.brightness ?? DEFAULT_BRIGHTNESS
  const masked = bottomMask ?? (variant === 'wide')

  // 一張圖＝一輪顯影。內容比對（不是陣列 identity），呼叫端每次 render 重新產生
  // imageCandidates() 也不會誤觸重播。
  const cycleKey = `${artKey ?? ''}|${variant}|${candidates.join('|')}`

  // ⚠ 這裡刻意**不用 useEffect 歸零**：D-3 的 `/lore/pilots/:id` 換人時 React Router
  //   不會卸載頁面元件，effect 歸零會先讓上一位的「已顯影」狀態多活一幀，
  //   下一位就是「圖直接出現、沒有顯影」。改用 render 期間調整 state
  //   （React 官方「prop 改變時調整 state」模式，站上先例：FallbackImage.tsx:23）。
  const [phase, setPhase] = useState<Phase>({ key: cycleKey, ...FRESH })
  if (phase.key !== cycleKey) setPhase({ key: cycleKey, ...FRESH })
  const cur = phase.key === cycleKey ? phase : { key: cycleKey, ...FRESH }

  // onRevealed 走 ref：呼叫端多半傳 inline 箭頭，進了依賴陣列就是每次 render 重跑一輪顯影。
  const onRevealedRef = useRef(onRevealed)
  useEffect(() => {
    onRevealedRef.current = onRevealed
  }, [onRevealed])

  // 每輪只收工一次。用「已收工的 cycleKey」而不是布林旗標，
  // 換下一位時自然重新開放，不必再寫一段清除邏輯。
  const settledKeyRef = useRef<string | null>(null)

  /**
   * 收工：補上 revealed（背景分頁沒有 rAF，這是唯一會讓圖顯示出來的路徑）、
   * 掛 settled（底色轉透明、卸掉兩層線稿）、回呼一次。冪等。
   */
  const settle = useCallback(() => {
    if (settledKeyRef.current === cycleKey) return
    settledKeyRef.current = cycleKey
    setPhase((p) => (p.key === cycleKey ? { ...p, revealed: true, settled: true } : p))
    onRevealedRef.current?.()
  }, [cycleKey])

  useEffect(() => {
    if (candidates.length === 0) return
    // ⚠ 雙層 rAF：class 與元素同時掛載就沒有 from 幀，transition 不會觸發
    //   ——而且不會有任何錯誤訊息，只是圖「啪」地一下出現。
    //   （站上先例：LoreLayout.tsx 的進場遮罩。）
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        setPhase((p) => (p.key === cycleKey ? { ...p, revealed: true } : p))
      })
    })
    // 保險：rAF 在**背景分頁不會被觸發**，transitionend 也就永遠不會來
    //（見 utils/nextFrames.ts 的同款地雷）。少了這條，使用者在背景開分頁再切回來
    // 只會看到一片 #0a0c10 的黑框。
    const bail = window.setTimeout(settle, delay + dur + SETTLE_GRACE_MS)
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
      clearTimeout(bail)
    }
  }, [cycleKey, candidates.length, delay, dur, settle])

  /**
   * 線稿層載入失敗 → 拆掉線稿、直接收工，退化成乾淨的淡入。
   * 少了這條，`candidates[0]` 哪天 404 會留下兩層破圖，畫面上是一片靜默的淡灰幽靈，
   * 看起來像「線稿沒生效」而不是「圖不見了」。
   */
  const handleLineArtError = () => {
    setPhase((p) => (p.key === cycleKey ? { ...p, lineArtFailed: true } : p))
    settle()
  }

  // 賽拉：portrait 是空字串，imageCandidates(undefined) 回 []，沒有東西可顯影。
  // ⚠ hooks 必須全部跑完才准 return，這行不能往上搬。
  if (candidates.length === 0) return null

  const showLineArt = tuning?.lineArt !== false && !cur.lineArtFailed && !cur.settled
  const aspectClass = variant === 'tall' ? 'aspect-[863/1600]' : 'aspect-[1240/1080]'

  return (
    <div
      className={`lore-art${masked ? ' lore-art--masked' : ''}${cur.revealed ? ' lore-art--revealed' : ''}${cur.settled ? ' lore-art--settled' : ''} ${aspectClass} ${className ?? ''}`}
      style={{
        '--lore-art-delay': `${delay}ms`,
        '--lore-art-dur': `${dur}ms`,
        '--lore-art-blur': `${blurPx}px`,
        '--lore-art-brightness': `${brightness}`,
      } as React.CSSProperties}
    >
      {showLineArt && (
        <img
          className="lore-art__layer lore-art__sketch"
          src={candidates[0]}
          alt=""
          aria-hidden="true"
          onError={handleLineArtError}
        />
      )}
      {showLineArt && (
        <img className="lore-art__layer lore-art__dodge" src={candidates[0]} alt="" aria-hidden="true" />
      )}
      <FallbackImage
        className="lore-art__layer lore-art__color"
        candidates={candidates}
        alt={alt}
        // 收工訊號。只認 opacity——這層沒有別的 transition，但寫死比事後追查便宜。
        onTransitionEnd={(e) => {
          if (e.propertyName === 'opacity') settle()
        }}
      />
    </div>
  )
}
