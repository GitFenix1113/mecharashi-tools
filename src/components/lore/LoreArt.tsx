import { useCallback, useEffect, useRef, useState } from 'react'
import { FallbackImage } from '../common/FallbackImage'
import { LORE_ART_TUNING } from './loreArtTuning'

/**
 * 機師故事館的「顯影」立繪（PLAN-042-A C-1 建立；PLAN-042-C A-1～A-3／F-3 改寫）。
 *
 * ── 兩層構造 ──────────────────────────────────────────────────────────────
 * 下 `lore-art__sketch`  **紙上鉛筆線稿**。沒有 `sketchSrc` 時用同一張彩圖經 SVG 濾鏡
 *                        `#lore-sketch`（定義在 LoreLayout）即時算出：灰階 → 反相模糊 →
 *                        color-dodge → 白轉透明、線轉墨色 → 裁回原圖輪廓。輸出是**透明底的墨線**，
 *                        容器不需要任何底色，直接畫在紙上。官方手繪線稿（8 位）由呼叫端傳
 *                        `sketchSrc` 直接顯示、不套濾鏡。
 * 上 `lore-art__color`   彩圖。兩層各掛一段 keyframes（index.css 的 `lore-line-in` /
 *                        `lore-color-in`，照官網 heroLine / heroColor 移植）：縮放 1.2→1、
 *                        上移 3%→0、斜切擦入；彩圖到 40% 才開始淡入並帶 1px 模糊收斂。
 *
 * ── 為什麼從三層＋黑框改成這樣（042-C 盤點的三個真因）──────────────────────
 * ① 舊版時間軸從掛載起算、不等圖片：冷快取（art.webp 延遲 900ms）實測**線稿 0 幀**。
 *    現在先 `decode()` 再進 `--revealed`，逾時 2s 也放行（慢網路不能永遠空著）。
 * ② 舊版 color-dodge 需要 backdrop，容器因此塗了 `#0a0c10` 黑框：線稿是白色負片、
 *    黑框在紙色館內是一塊突兀的長方形。SVG 濾鏡把整條管線收在單一 <img> 內，
 *    黑框、mix-blend-mode、isolate 容器的量測基準問題一起消失。
 * ③ 舊版只動 opacity，沒有運鏡。
 *
 * ── 時間軸 ──────────────────────────────────────────────────────────────
 * 掛載 → `--loading`（微弱 shimmer）→ 圖片 decode 完成（或逾時）→ `--revealed`（兩段 keyframes 開跑）
 * → 彩圖 animationend（或保險 timer）→ `--settled`（拆掉線稿層）→ `onRevealed()` 一次。
 * 換人（cycleKey 變）時把上一張彩圖留作 `lore-art__prev` 底層，新圖開始顯影時 200ms 淡出（F-3），
 * 不再有「舊圖瞬間消失 → 空框 → 新圖」。
 *
 * ── reduced-motion ────────────────────────────────────────────────────────
 * 元件端**不寫 `matchMedia`**，全交給 index.css：線稿層 `display: none`、彩圖改 150ms 純淡入
 * （animation 名換成 `lore-fade-in`，下方 animationend 兩個名字都認）。元件的狀態機照跑。
 *
 * ⚠ 背景分頁：`document.hidden` 時 Chrome 不推進 CSS animation，animationend 永遠不來，
 *   靠保險 timer 收工；分頁一可見動畫會自己播完。這是正常行為，不要為它加更多保險。
 */

export interface LoreArtProps {
  /**
   * 彩圖的候選清單，呼叫端用 imageCandidates() 產生。**線稿沒有 `sketchSrc` 時一律用 candidates[0]**。
   * 呼叫端必須保證 candidates[0] 是實際存在的檔案——FallbackImage 把「最後成功的是哪一個」
   * 關在自己的 state 裡，外面拿不到。今天 88 位全部成立。
   */
  candidates: string[]
  alt: string
  /**
   * 構圖。呼叫端必須在**渲染前**用 hasOfficialArt() / hasPilotArt() 決定，不可等圖載失敗才換。
   * 'tall'     art.webp 863×1600 直式全身（object-fit: contain）
   * 'wide'     full.webp 1240×1080 橫式半身（contain ＋ 底部噪點 mask）
   * 'official' 官網 hero 圖層（PLAN-042-C C-2）：半身、下緣出血，object-fit: cover 靠頂
   */
  variant: 'tall' | 'wide' | 'official'
  /** per-pilot 調參的查表鍵。機師傳 pilotArtDir(pilot)（PLAN-054 起是遊戲 ID）。未傳或查無 → 用預設。 */
  artKey?: string
  /** 線稿來源。未傳 → 由 candidates[0] 經 SVG 濾鏡即時產生；傳入（官方手繪線稿）→ 直接顯示、不套濾鏡。 */
  sketchSrc?: string
  /** 顯影時長（兩段 keyframes 共用）。官網機師 1050 / 機甲 900——不得寫死在元件內。預設 1050。 */
  revealDurationMs?: number
  /** 底部 mask。**預設 `variant === 'wide'`**，呼叫端只在要覆寫預設時才傳。 */
  bottomMask?: boolean
  /** 顯影結束後回呼一次。 */
  onRevealed?: () => void
  className?: string
}

/** 顯影時長預設值（ms）。呼叫端一律明寫，這裡只是漏傳時的退路。 */
const DEFAULT_DURATION_MS = 1050
/** 等圖片 decode 的上限（ms）：超過就放行淡入，慢網路不能永遠空著。 */
const DECODE_TIMEOUT_MS = 2000
/** animationend 沒來時的保險餘裕（ms）。 */
const SETTLE_GRACE_MS = 250

type Phase = {
  /** 這組狀態屬於哪一張圖。candidates 換人時整組歸零。 */
  key: string
  revealed: boolean
  settled: boolean
  lineArtFailed: boolean
  /** 上一輪已顯影的彩圖，換人時留作底層交叉淡出；null ＝ 沒有上一輪 */
  prev: string | null
  /** 本輪的彩圖（candidates[0]），settle 後成為下一輪的 prev */
  own: string | null
}

/** 用 `decode()` 等一張圖真的可畫；404 或不支援一律 reject，交由呼叫端決定要不要放行。 */
function decodeImage(url: string): Promise<void> {
  const img = new Image()
  img.src = url
  return img.decode()
}

export default function LoreArt({
  candidates,
  alt,
  variant,
  artKey,
  sketchSrc,
  revealDurationMs,
  bottomMask,
  onRevealed,
  className,
}: LoreArtProps) {
  const tuning = LORE_ART_TUNING[artKey ?? '']
  const dur = revealDurationMs ?? DEFAULT_DURATION_MS
  const masked = bottomMask ?? (variant === 'wide')
  const sketchUrl = sketchSrc ?? candidates[0]

  // 一張圖＝一輪顯影。內容比對（不是陣列 identity），呼叫端每次 render 重新產生
  // imageCandidates() 也不會誤觸重播。
  const cycleKey = `${artKey ?? ''}|${variant}|${sketchSrc ?? ''}|${candidates.join('|')}`

  // ⚠ 這裡刻意**不用 useEffect 歸零**：D-3 的 `/lore/pilots/:id` 換人時 React Router
  //   不會卸載頁面元件，effect 歸零會先讓上一位的「已顯影」狀態多活一幀。
  //   改用 render 期間調整 state（React 官方「prop 改變時調整 state」模式，站上先例：FallbackImage）。
  //   上一輪的彩圖存在 state 的 own／prev 裡而不是 ref：render 期間不能讀 ref（react-hooks/refs）。
  const makePhase = (prev: string | null): Phase => ({
    key: cycleKey, revealed: false, settled: false, lineArtFailed: false, prev, own: candidates[0] ?? null,
  })
  const [phase, setPhase] = useState<Phase>(() => makePhase(null))
  // 換人：上一輪若已顯影完成，它的彩圖留作本輪底層交叉淡出（F-3）；還沒完成就不留（半成品不值得墊）
  if (phase.key !== cycleKey) setPhase(makePhase(phase.settled ? phase.own : null))
  const cur = phase.key === cycleKey ? phase : makePhase(phase.settled ? phase.own : null)

  // onRevealed 走 ref：呼叫端多半傳 inline 箭頭，進了依賴陣列就是每次 render 重跑一輪顯影。
  const onRevealedRef = useRef(onRevealed)
  useEffect(() => {
    onRevealedRef.current = onRevealed
  }, [onRevealed])

  // 每輪只收工一次。用「已收工的 cycleKey」而不是布林旗標，換下一位時自然重新開放。
  const settledKeyRef = useRef<string | null>(null)

  /**
   * 收工：補上 revealed（背景分頁沒有 animationend，這是唯一會讓圖顯示出來的路徑）、
   * 掛 settled（卸掉線稿層與上一張底圖）、回呼一次。冪等。
   */
  const settle = useCallback(() => {
    if (settledKeyRef.current === cycleKey) return
    settledKeyRef.current = cycleKey
    setPhase((p) => (p.key === cycleKey ? { ...p, revealed: true, settled: true } : p))
    onRevealedRef.current?.()
  }, [cycleKey])

  // ① 等圖片 decode 完成再開始顯影（A-1）。線稿層與彩圖同一張時只等一次；
  //    官方變體兩張不同，彩圖也要等——不等它會在 40% 處硬跳出來。
  useEffect(() => {
    if (candidates.length === 0) return
    let cancelled = false
    const jobs: Promise<'ok' | 'sketch-failed'>[] = [
      decodeImage(sketchUrl).then(() => 'ok' as const, () => 'sketch-failed' as const),
    ]
    if (sketchSrc) {
      // 彩圖失敗交給 FallbackImage 逐層退回，這裡只是不要搶在它前面開演
      jobs.push(decodeImage(candidates[0]).then(() => 'ok' as const, () => 'ok' as const))
    }
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), DECODE_TIMEOUT_MS))
    Promise.race([Promise.all(jobs), timeout]).then((result) => {
      if (cancelled) return
      const sketchFailed = Array.isArray(result) && result.includes('sketch-failed')
      setPhase((p) => (p.key === cycleKey ? { ...p, revealed: true, lineArtFailed: p.lineArtFailed || sketchFailed } : p))
    })
    return () => {
      cancelled = true
    }
  }, [cycleKey, candidates, sketchUrl, sketchSrc])

  // ② 保險：animationend 在背景分頁不會來（見檔頭），時間到就收工。從**開始顯影**起算，
  //    不是從掛載起算——那正是 042-A 的病灶。
  useEffect(() => {
    if (!cur.revealed || cur.settled) return
    const bail = window.setTimeout(settle, dur + SETTLE_GRACE_MS)
    return () => clearTimeout(bail)
  }, [cur.revealed, cur.settled, dur, settle])

  /**
   * 線稿層載入失敗 → 拆掉線稿、照樣顯影。少了這條，`candidates[0]` 哪天 404 會留下一片破圖。
   * （decode 已先擋過一輪；這裡是 <img> 元素本身失敗的第二道。）
   */
  const handleLineArtError = () => {
    setPhase((p) => (p.key === cycleKey ? { ...p, lineArtFailed: true } : p))
  }

  /** 上一張底圖若載不到（候選當時退到別張），直接拿掉，不留破圖。 */
  const dropPrev = () => {
    setPhase((p) => (p.key === cycleKey ? { ...p, prev: null } : p))
  }

  // 賽拉：portrait 是空字串，imageCandidates(undefined) 回 []，沒有東西可顯影。
  // ⚠ hooks 必須全部跑完才准 return，這行不能往上搬。
  if (candidates.length === 0) return null

  const showSketch = tuning?.lineArt !== false && !cur.lineArtFailed && !cur.settled
  const aspectClass =
    variant === 'tall' ? 'aspect-[863/1600]' : variant === 'wide' ? 'aspect-[1240/1080]' : ''

  const classes = [
    'lore-art',
    `lore-art--${variant}`,
    masked ? 'lore-art--masked' : '',
    cur.revealed ? 'lore-art--revealed' : 'lore-art--loading',
    cur.settled ? 'lore-art--settled' : '',
    aspectClass,
    className ?? '',
  ].filter(Boolean).join(' ')

  return (
    <div className={classes} style={{ '--lore-art-dur': `${dur}ms` } as React.CSSProperties}>
      {cur.prev && !cur.settled && (
        <img className="lore-art__layer lore-art__prev" src={cur.prev} alt="" aria-hidden="true" onError={dropPrev} />
      )}
      {showSketch && (
        <img
          className={`lore-art__layer lore-art__sketch${sketchSrc ? '' : ' lore-art__sketch--filtered'}`}
          src={sketchUrl}
          alt=""
          aria-hidden="true"
          onError={handleLineArtError}
        />
      )}
      <FallbackImage
        className="lore-art__layer lore-art__color"
        candidates={candidates}
        alt={alt}
        // 收工訊號。只認兩段顯影動畫的名字——這層沒有別的 animation，但寫死比事後追查便宜。
        onAnimationEnd={(e) => {
          if (e.animationName === 'lore-color-in' || e.animationName === 'lore-fade-in') settle()
        }}
      />
    </div>
  )
}
