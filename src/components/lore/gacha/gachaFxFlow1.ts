// 機甲卡池動態（PLAN-042-B Phase J）：UI/Flow1 流動圖層的 uniform 打包與繪製分段（純計算，給 gachaFxEngine.ts 用）。
//
// 公式照 shader 反組譯（_local-notes/2026-10/2026-10-17_卡池動態_Flow1/），GLSL 在 gachaFxEngine.ts 的 FS_FLOW1。
// 這裡把 FxFlow1 的選填欄位換成 shader 要的數字：省略的欄位一律換成「恰好恆等」的值（旋轉 (1, 0)、TO [1,1,0,0]、
// 擾動量 0、溶解常數 1.1），配合 shader 寫成「線性部分＋只含 uniform 的常數」，預設值時 UV 逐位元不變。

import type { FxFill, FxFlow, FxFlow1, FxFlow1Params, FxImage, FxSpeedLine, FxTO, FxUICommonLayer } from './gachaFxTypes'

const TO_ID: FxTO = [1, 1, 0, 0]

export interface Flow1Uniforms {
  /** 旋轉 (cos, sin)：主貼圖（擾動圖跟著轉）、顏色貼圖、遮罩 1 */
  mainRot: [number, number]
  colorRot: [number, number]
  mask1Rot: [number, number]
  mainFlow: [number, number]
  disturbFlow: [number, number]
  dissolveFlow: [number, number]
  /** 擾動推哪幾軸（1＝推）：兩軸 (1, 1)、單軸 U (1, 0)、單軸 V (0, 1)；溶解的單軸固定推 V */
  axis: [number, number]
  dissolveAxis: [number, number]
  mainTO: FxTO
  disturbTO: FxTO
  colorST: FxTO
  mask1ST: FxTO
  mask2ST: FxTO
  dissolveST: FxTO
  dissolveMaskST: FxTO
  /** 0.1 × _DisturbValue（uv 往 D 內插的比例） */
  k: number
  vClamp: number
  channelR: number
  mask1Soft: number
  mask1Rev: number
  mask2Soft: number
  mask2Rev: number
  dissolveRev: number
  /** 2 × (0.55 − 1.05 × _DissolveValue)：shader 裡溶解的常數項 */
  dissolveC: number
  dissolveSoft: number
  mainValue: number
  /** 第二張主貼圖：強度（0＝沒有，主貼圖 ＋0 逐位元不變）、次方、捲動、TO、ST */
  tex2I: number
  tex2Pow: number
  tex2Flow: [number, number]
  tex2TO: FxTO
  tex2ST: FxTO
}

const cs = (a: number | undefined): [number, number] => (a ? [Math.cos(a), Math.sin(a)] : [1, 0])

export function flow1Uniforms(f: FxFlow1Params): Flow1Uniforms {
  const d = f.disturb, s = f.dissolve
  return {
    mainRot: cs(f.mainRotate),
    colorRot: cs(f.colorTex?.rotate),
    mask1Rot: cs(f.mask1?.rotate),
    mainFlow: f.mainFlow ?? [0, 0],
    disturbFlow: d?.flow ?? [0, 0],
    dissolveFlow: s?.flow ?? [0, 0],
    axis: d?.axis === 'u' ? [1, 0] : d?.axis === 'v' ? [0, 1] : [1, 1],
    dissolveAxis: d?.axis ? [0, 1] : [1, 1],
    mainTO: f.mainTO ?? TO_ID,
    disturbTO: d?.to ?? TO_ID,
    colorST: f.colorTex?.st ?? TO_ID,
    mask1ST: f.mask1?.st ?? TO_ID,
    mask2ST: f.mask2?.st ?? TO_ID,
    dissolveST: s?.st ?? TO_ID,
    dissolveMaskST: s?.maskST ?? TO_ID,
    k: d ? 0.1 * d.value : 0,
    vClamp: f.vClamp ? 1 : 0,
    channelR: f.channelR ? 1 : 0,
    mask1Soft: f.mask1?.softness ?? 0,
    mask1Rev: f.mask1?.revert ? 1 : 0,
    mask2Soft: f.mask2?.softness ?? 0,
    mask2Rev: f.mask2?.revert ? 1 : 0,
    dissolveRev: s?.revert ? 1 : 0,
    dissolveC: 2 * (0.55 - 1.05 * (s?.value ?? 0)),
    dissolveSoft: s?.softness ?? 0,
    mainValue: f.mainValue,
    tex2I: f.main2?.intensity ?? 0,
    tex2Pow: f.main2?.pow ?? 1,
    tex2Flow: f.main2?.flow ?? [0, 0],
    tex2TO: f.main2?.to ?? TO_ID,
    tex2ST: f.main2?.st ?? TO_ID,
  }
}

export const isFlow1 = (f: FxFlow): f is FxFlow1 => f.shader === 'flow1'
export const isImage = (f: FxFlow): f is FxImage => f.shader === 'alpha'
export const isSpeedLine = (f: FxFlow): f is FxSpeedLine => f.shader === 'speedLine'
export const isUICommon = (f: FxFlow): f is FxUICommonLayer => f.shader === 'uiCommon'

/**
 * 繪製分段：under（遊戲裡階層在所有 UIParticle 之前）→ 粒子 → 其他圖層，各段內照資料順序（＝階層順序）。
 * 夾在兩組粒子之間的（beforeGroup）放進 before[組號]，引擎畫到那組粒子之前畫。
 * 已上站的 UI_CommonFlow 圖層都沒有 under，跟 10-17 前一樣全部畫在粒子之後。
 */
export function splitFlows<T>(items: readonly T[], at: (x: T) => { under?: true; beforeGroup?: number }): { under: T[]; over: T[]; before: T[][] } {
  const out = { under: [] as T[], over: [] as T[], before: [] as T[][] }
  for (const x of items) {
    const a = at(x)
    if (a.under) out.under.push(x)
    else if (a.beforeGroup) (out.before[a.beforeGroup] ??= []).push(x)
    else out.over.push(x)
  }
  return out
}

// ── Image 的 Filled（10-29 起）──────────────────────────────────────────────
// 照 uGUI 的 Image.GenerateFilledSprite／RadialCut（Unity 開源的 UI 套件）逐行搬：在 0–1 的矩形上切，位置與 UV 同一組座標
// （sprite 匯出時裁成整張，UV 也是 0–1）。每個四邊形 4 個點 [x0, y0, …, x3, y3]，順序同 Unity 的 AddQuad（左下、左上、右上、右下，
// 三角形 0-1-2、2-3-0），切過的角會疊在一起變成三角形。

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** RadialCut：把一個四邊形從 corner 那個角開始切成 fill（0–1）的扇形；全空回 false */
function radialCut(xy: number[][], fill: number, invert: boolean, corner: number): boolean {
  if (fill < 0.001) return false
  if ((corner & 1) === 1) invert = !invert
  if (!invert && fill > 0.999) return true
  let angle = clamp01(fill)
  if (invert) angle = 1 - angle
  angle *= Math.PI / 2
  let cos = Math.cos(angle), sin = Math.sin(angle)
  const i0 = corner, i1 = (corner + 1) % 4, i2 = (corner + 2) % 4, i3 = (corner + 3) % 4
  if ((corner & 1) === 1) {
    if (sin > cos) {
      cos /= sin; sin = 1
      if (invert) { xy[i1][0] = lerp(xy[i0][0], xy[i2][0], cos); xy[i2][0] = xy[i1][0] }
    } else if (cos > sin) {
      sin /= cos; cos = 1
      if (!invert) { xy[i2][1] = lerp(xy[i0][1], xy[i2][1], sin); xy[i3][1] = xy[i2][1] }
    } else { cos = 1; sin = 1 }
    if (!invert) xy[i3][0] = lerp(xy[i0][0], xy[i2][0], cos)
    else xy[i1][1] = lerp(xy[i0][1], xy[i2][1], sin)
  } else {
    if (cos > sin) {
      sin /= cos; cos = 1
      if (!invert) { xy[i1][1] = lerp(xy[i0][1], xy[i2][1], sin); xy[i2][1] = xy[i1][1] }
    } else if (sin > cos) {
      cos /= sin; sin = 1
      if (invert) { xy[i2][0] = lerp(xy[i0][0], xy[i2][0], cos); xy[i3][0] = xy[i2][0] }
    } else { cos = 1; sin = 1 }
    if (invert) xy[i3][1] = lerp(xy[i0][1], xy[i2][1], sin)
    else xy[i1][0] = lerp(xy[i0][0], xy[i2][0], cos)
  }
  return true
}

/** Filled 的 Image 在 amount 時要畫的四邊形（0–1 座標）；amount < 0.001 什麼都不畫 */
export function fillQuads(F: FxFill, amount: number): number[][] {
  if (amount < 0.001) return []
  let x0 = 0, y0 = 0, x1 = 1, y1 = 1
  if (F.method === 0) { if (F.origin === 1) x0 = 1 - amount; else x1 = amount }
  else if (F.method === 1) { if (F.origin === 1) y0 = 1 - amount; else y1 = amount }
  if (F.method !== 4 || amount >= 1) return [[x0, y0, x0, y1, x1, y1, x1, y0]]
  const out: number[][] = []
  for (let corner = 0; corner < 4; corner++) {
    const fx0 = corner < 2 ? 0 : 0.5, fx1 = corner < 2 ? 0.5 : 1
    const fy0 = corner === 0 || corner === 3 ? 0 : 0.5, fy1 = corner === 0 || corner === 3 ? 0.5 : 1
    const xy = [[fx0, fy0], [fx0, fy1], [fx1, fy1], [fx1, fy0]]
    const k = (corner + F.origin) % 4
    const val = F.clockwise ? amount * 4 - k : amount * 4 - (3 - k)
    if (radialCut(xy, clamp01(val), F.clockwise, (corner + 2) % 4)) out.push(xy.flat())
  }
  return out
}
