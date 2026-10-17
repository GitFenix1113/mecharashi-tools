// 機甲卡池動態（PLAN-042-B Phase J）：UI/Flow1 流動圖層的 uniform 打包與繪製分段（純計算，給 gachaFxEngine.ts 用）。
//
// 公式照 shader 反組譯（_local-notes/2026-10/2026-10-17_卡池動態_Flow1/），GLSL 在 gachaFxEngine.ts 的 FS_FLOW1。
// 這裡把 FxFlow1 的選填欄位換成 shader 要的數字：省略的欄位一律換成「恰好恆等」的值（旋轉 (1, 0)、TO [1,1,0,0]、
// 擾動量 0、溶解常數 1.1），配合 shader 寫成「線性部分＋只含 uniform 的常數」，預設值時 UV 逐位元不變。

import type { FxFlow, FxFlow1, FxTO } from './gachaFxTypes'

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
}

const cs = (a: number | undefined): [number, number] => (a ? [Math.cos(a), Math.sin(a)] : [1, 0])

export function flow1Uniforms(f: FxFlow1): Flow1Uniforms {
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
  }
}

export const isFlow1 = (f: FxFlow): f is FxFlow1 => f.shader === 'flow1'

/**
 * 繪製分段：under（遊戲裡階層在所有 UIParticle 之前）→ 粒子 → 其他圖層，各段內照資料順序（＝階層順序）。
 * 已上站的 UI_CommonFlow 圖層都沒有 under，跟 10-17 前一樣全部畫在粒子之後。
 */
export function splitFlows<T>(items: readonly T[], under: (x: T) => boolean): { under: T[]; over: T[] } {
  return { under: items.filter(under), over: items.filter((x) => !under(x)) }
}
