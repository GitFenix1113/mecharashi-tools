// 機甲卡池動態（PLAN-042-B Phase J）的資料格式：src/data/gachaFx/<wap>.json。
//
// 由 scripts/build-gacha-fx.mjs 從卡池 prefab 的匯出瘦身而來，欄位就是 Unity 粒子系統的子集
// （名稱改短、只留引擎會讀的）。座標是 prefab 的畫布座標：2600×1080、原點在正中央、y 朝上；
// 粒子內部是 Unity 單位，畫的時候 ×`unit`（Coffee UIParticle 的 m_Scale3D）換成畫布像素。

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]
export type RGBA = [number, number, number, number]

/** Hermite 曲線的關鍵影格：[time, value, inSlope, outSlope]；斜率 null＝無限大（階梯） */
export type CurveKey = [number, number, number | null, number | null]

/** Unity MinMaxCurve。mode：0 常數、1 曲線、2 兩條曲線之間隨機、3 兩個常數之間隨機 */
export interface FxMinMax {
  mode: 0 | 1 | 2 | 3
  scalar: number
  minScalar?: number
  minCurve?: CurveKey[]
  maxCurve?: CurveKey[]
}

/** Unity Gradient：顏色鍵 [t, r, g, b]、透明度鍵 [t, a]，t 為 0–1；fixed＝不內插 */
export interface FxGradient {
  fixed?: true
  colors: [number, number, number, number][]
  alphas: [number, number][]
}

/** Unity MinMaxGradient。mode：0 單色、1 漸層、2 兩色之間隨機、3 兩條漸層之間隨機、4 漸層上隨機取色 */
export interface FxMinMaxGradient {
  mode: 0 | 1 | 2 | 3 | 4
  minColor?: RGBA
  maxColor?: RGBA
  minGradient?: FxGradient
  maxGradient?: FxGradient
}

export interface FxBurst { time: number; count: FxMinMax; cycles: number; interval: number; probability: number }

/** 一個粒子系統（Unity ParticleSystem＋ParticleSystemRenderer 的子集） */
export interface FxSystem {
  name: string
  /** 畫布座標（anchoredPosition） */
  pos: [number, number]
  rot: Quat
  /** scalingMode＝Local 時的 localScale；其他模式 [1,1,1] */
  scale: Vec3
  /** sortingOrder：小的先畫 */
  order: number
  /** mode 0＝billboard、1＝沿速度拉伸；maxSize＝佔畫布高度的比例上限 */
  render: { mode: number; lengthScale: number; velocityScale: number; maxSize: number }
  /** 貼圖（官方檔名，public/images/game/fx/）、顏色強度、主貼圖旋轉（弧度） */
  material: { tex: string; strength: number; texRotate: number }
  duration: number
  looping: boolean
  prewarm: boolean
  simSpeed: number
  initial: {
    lifetime: FxMinMax
    speed: FxMinMax
    size: FxMinMax
    /** 只有 size3D 時有 */
    sizeY?: FxMinMax
    maxParticles: number
    rotation: FxMinMax
    color: FxMinMaxGradient
    gravity: FxMinMax
  }
  /** null＝發射模組關閉 */
  emission: { rate: FxMinMax; bursts: FxBurst[] } | null
  /** type：0 球、4 圓錐、8 圓錐體積；rotation 是尤拉角（度） */
  shape?: { type: number; radius: number; thickness: number; angle: number; length: number; randomDir: number; scale: Vec3; rotation: Vec3; position: Vec3 }
  velocity?: { x: FxMinMax; y: FxMinMax; z: FxMinMax; world: boolean }
  force?: { x: FxMinMax; y: FxMinMax; z: FxMinMax; world: boolean }
  clamp?: { magnitude: FxMinMax; dampen: number }
  noise?: { frequency: number; scroll: FxMinMax; strength: FxMinMax; amount: FxMinMax }
  rotationOverLife?: FxMinMax
  colorOverLife?: FxMinMaxGradient
  /** y 只有 separateAxes 時有 */
  sizeOverLife?: { x: FxMinMax; y?: FxMinMax }
}

/** 流動圖層（Image＋UI_CommonFlow）：擾動貼圖捲動推移主貼圖的 UV，疊加在最上層 */
export interface FxFlow {
  name: string
  pos: [number, number]
  /** 畫布像素（sizeDelta × localScale） */
  size: [number, number]
  /** Image 顏色 × 材質 _Color */
  color: RGBA
  mainTex: string
  disturbTex: string
  mainValue: number
  disturbValue: number
  /** 主貼圖縱向重複（_VRepeatSwitch） */
  vRepeat: boolean
  disturbFlow: [number, number]
  /** tiling.xy＋offset.zw */
  mainTO: [number, number, number, number]
  disturbTO: [number, number, number, number]
}

export interface GachaFxData {
  v: 1
  /** 來源 prefab 名稱（查證用） */
  prefab: string
  canvas: [number, number]
  unit: number
  systems: FxSystem[]
  flows: FxFlow[]
}
