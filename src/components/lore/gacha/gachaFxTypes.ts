// 機甲卡池動態（PLAN-042-B Phase J）的資料格式：src/data/gachaFx/<wap>.json。
//
// 由 scripts/build-gacha-fx.mjs 從卡池 prefab 的匯出瘦身而來，欄位就是 Unity 粒子系統的子集
// （名稱改短、只留引擎會讀的）。座標是 prefab 的畫布座標：2600×1080、原點在正中央、y 朝上；
// 粒子內部是 Unity 單位，畫的時候 ×`unit`（Coffee UIParticle 的 m_Scale3D）換成畫布像素。

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]
export type RGBA = [number, number, number, number]

/**
 * 裁切矩形 [x0, y0, x1, y1]（畫布座標）：遊戲裡祖先的 RectMask2D 把粒子／圖層裁在這裡面。
 * 只有切進遊戲畫面（根節點 2500×1080）的邊才有值，其餘邊在畫布邊上；省略＝不裁。見 build-gacha-fx.mjs 的 clipOf
 */
export type FxClip = [number, number, number, number]

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

/**
 * 序列幀（Unity UVModule＝Texture Sheet Animation，只收 Grid 模式）：貼圖切成 tilesX×tilesY 格，
 * 第 0 格在左上、先橫後直。frameOverTime／startFrame 是 Unity 存的正規化值（0–1，×幀數＝第幾格；
 * 預設曲線停在 0.9999 是為了不跨到下一輪的第 0 格）。
 */
export interface FxUV {
  tilesX: number
  tilesY: number
  /** 0＝整張依序（幀數 tilesX×tilesY）、1＝只播一列（幀數 tilesX） */
  animationType: 0 | 1
  /** 只播一列時：0＝固定第 rowIndex 列（由上往下數）、1＝每顆粒子隨機一列 */
  rowMode?: 0 | 1
  rowIndex?: number
  /** 0＝依壽命（frameOverTime × cycles）、2＝依 fps（每秒 fps 格，與壽命無關） */
  timeMode: 0 | 2
  /** 只有 timeMode 0 時有 */
  frameOverTime?: FxMinMax
  cycles?: number
  /** 只有 timeMode 2 時有 */
  fps?: number
  startFrame: FxMinMax
}

/** 一個粒子系統（Unity ParticleSystem＋ParticleSystemRenderer 的子集） */
export interface FxSystem {
  name: string
  /** 畫布座標（累積了祖先的位移、旋轉、縮放；祖先都沒有變換時＝自己的 anchoredPosition） */
  pos: [number, number]
  /** 累積了祖先的旋轉 */
  rot: Quat
  /** scalingMode＝Local 時的 localScale；其他模式 [1,1,1] */
  scale: Vec3
  /** sortingOrder：小的先畫 */
  order: number
  clip?: FxClip
  /** mode 0＝billboard、1＝沿速度拉伸；maxSize＝佔畫布高度的比例上限 */
  render: { mode: number; lengthScale: number; velocityScale: number; maxSize: number }
  /**
   * 貼圖（官方檔名，public/images/game/fx/）、顏色強度、主貼圖旋轉（弧度）。
   * blend：'alpha'＝一般透明（Unity 材質 _Dst3＝10 → SrcAlpha, OneMinusSrcAlpha）；省略＝疊加（SrcAlpha, One）。
   * strengthAlpha：強度也乘 alpha（UI/Flow1 的 _MainValue 乘在最後、四個通道都乘）；省略＝只乘 RGB（UIFx_Alpha、UI_CommonFlow）
   */
  material: { tex: string; strength: number; texRotate: number; blend?: 'alpha'; strengthAlpha?: true }
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
  /**
   * type：0 球、4 圓錐、5 方塊（從體積發射，大小＝scale、以原點為中心，方向＋z）、8 圓錐體積；rotation 是尤拉角（度）。
   * radius／thickness／angle／length 只有球與圓錐用得到
   */
  shape?: { type: number; radius: number; thickness: number; angle: number; length: number; randomDir: number; scale: Vec3; rotation: Vec3; position: Vec3 }
  velocity?: { x: FxMinMax; y: FxMinMax; z: FxMinMax; world: boolean }
  force?: { x: FxMinMax; y: FxMinMax; z: FxMinMax; world: boolean }
  clamp?: { magnitude: FxMinMax; dampen: number }
  noise?: { frequency: number; scroll: FxMinMax; strength: FxMinMax; amount: FxMinMax }
  rotationOverLife?: FxMinMax
  colorOverLife?: FxMinMaxGradient
  /** y 只有 separateAxes 時有 */
  sizeOverLife?: { x: FxMinMax; y?: FxMinMax }
  /** 序列幀；省略＝整張貼圖 */
  uv?: FxUV
}

/** tiling.xy＋offset.zw */
export type FxTO = [number, number, number, number]

/**
 * 流動圖層的遮罩（UI_CommonFlow 的 _Mask1）：貼圖 r×a 經 softness 的 smoothstep 乘進 alpha。
 * UV＝(uv×st.xy＋st.zw) 以 0.5 為中心旋轉 rotate →（disturbed 時加擾動）→ to 以 0.5 為中心的位移＋tiling。
 */
export interface FxFlowMask {
  tex: string
  /** 貼圖槽的 tiling／offset（材質 m_TexEnvs，TRANSFORM_TEX），在旋轉之前 */
  st: FxTO
  /** _MaskTex1TO，在旋轉之後 */
  to: FxTO
  /** 弧度（_Mask1Rotate） */
  rotate: number
  /** _Mask1Softness（0–0.49） */
  softness: number
  /** _Mask1Revert2：遮罩反轉 */
  revert: boolean
  /** _MaskModeSwitch：遮罩也吃擾動 */
  disturbed: boolean
  /** 貼圖 wrap＝Repeat（否則夾邊） */
  repeat: boolean
}

/** 流動圖層兩種 shader 共用的版面欄位 */
interface FxFlowBase {
  name: string
  /** 矩形中心（畫布座標，累積了祖先的變換） */
  pos: [number, number]
  /** 畫布像素（矩形大小 × localScale × 祖先的縮放）；寬為負＝水平鏡像（自己的 localScale.x < 0，貼圖跟著左右翻） */
  size: [number, number]
  /** 畫布平面上的旋轉（弧度，逆時針，含祖先）；省略＝不轉 */
  rot?: number
  clip?: FxClip
  /** 遊戲裡階層在所有 UIParticle 之前：先畫這層、再畫粒子；省略＝粒子都畫完才畫 */
  under?: true
}

/**
 * 流動圖層（Image＋UI_CommonFlow）：擾動貼圖捲動推移主貼圖的 UV，疊加在最上層。
 * mainST 之後的欄位是 10-17 照 shader 補的，預設值就省略（芬里厄的 JSON 因此不變）。
 */
export interface FxCommonFlow extends FxFlowBase {
  shader?: undefined
  /** Image 顏色 × 材質 _Color */
  color: RGBA
  mainTex: string
  /** 省略＝材質沒指定，用 shader 預設的 black（擾動是常數偏移，不是 0） */
  disturbTex?: string
  mainValue: number
  disturbValue: number
  /** 主貼圖縱向重複（_VRepeatSwitch） */
  vRepeat: boolean
  disturbFlow: [number, number]
  /** 以 0.5 為中心的 tiling＋位移（_MainTex1TO），在擾動與捲動之後 */
  mainTO: FxTO
  disturbTO: FxTO
  /** 主貼圖槽的 tiling／offset（材質 m_TexEnvs，TRANSFORM_TEX），在旋轉之前；省略＝[1,1,0,0] */
  mainST?: FxTO
  /** 主貼圖旋轉（弧度，_MainTexRotate；擾動圖的 UV 也跟著轉）；省略＝0 */
  mainRotate?: number
  /** 主貼圖隨時間捲動（_Tex1Flow，每秒 UV）；省略＝不捲動 */
  mainFlow?: [number, number]
  /** 主貼圖橫向重複（貼圖 wrapU＝Repeat）；省略＝夾邊 */
  mainRepeatU?: true
  /** 省略＝材質沒指定 _Mask1，用 shader 預設的 white（不遮） */
  mask?: FxFlowMask
}

/** UI/Flow1 用到的一張貼圖：官方檔名＋wrap（Repeat，否則夾邊；匯出的貼圖兩軸 wrap 都相同） */
export interface FxFlow1Tex { tex: string; repeat?: true }

/**
 * 流動圖層（Image／RawImage＋UI/Flow1）。公式照 shader 反組譯（_local-notes/2026-10/2026-10-17_卡池動態_Flow1/）：
 *   out＝主貼圖（旋轉→捲動→擾動→TO）× 遮罩 1、2 × 溶解 × 顏色貼圖 × 頂點色 × mainValue，四個通道都乘。
 * 所有貼圖都選填：省略＝shader 預設的 white。旋轉是弧度，方向照 shader（UV 乘 [[c, s], [−s, c]]）。
 */
export interface FxFlow1 extends FxFlowBase {
  shader: 'flow1'
  /** 頂點色（Image／RawImage 的 color）× 材質 _Color */
  color: RGBA
  /** 'alpha'＝_Dst 10（一般透明）；省略＝疊加（_Dst 1） */
  blend?: 'alpha'
  /** _MainValue */
  mainValue: number
  /** _MainTex1（主貼圖；沒有 TRANSFORM_TEX，材質貼圖槽的 tiling 對它沒作用） */
  main?: FxFlow1Tex
  /** _MainTexRotate（擾動圖的 UV 也跟著轉）；省略＝0 */
  mainRotate?: number
  /** _Tex1Flow（每秒 UV，擾動圖也跟著捲）；省略＝不捲動 */
  mainFlow?: [number, number]
  /** _MainTex1TO：位移加在擾動之前、tiling 在擾動之後（都以 0.5 為中心）；省略＝[1,1,0,0] */
  mainTO?: FxTO
  /** _VRepeatSwitch＝0：主貼圖的 v 夾在 0–1（預設 1＝交給貼圖 wrap）；u 一律交給 wrap */
  vClamp?: true
  /** _ChannelChoose＝1：主貼圖四個通道（含 alpha）都取 R */
  channelR?: true
  /** _MainTex（顏色貼圖；RawImage 指定的 texture 優先）＋貼圖槽的 tiling／offset 與 _ColorRotate */
  colorTex?: FxFlow1Tex & { st?: FxTO; rotate?: number }
  /** 擾動：D＝_DisturbTex 的 r（省略貼圖＝white，D＝1）；uv 往 D 內插 0.1×value。value 是 0 就整個省略 */
  disturb?: {
    tex?: FxFlow1Tex
    value: number
    /** _DisturbFlow（另外再加 mainFlow） */
    flow: [number, number]
    /** _DisturbTO */
    to: FxTO
    /** 單軸擾動（_ModeCtrl1＝1）時推哪一軸（_ModeCtrl2）；省略＝兩軸。溶解的單軸固定推 V */
    axis?: 'u' | 'v'
  }
  /** 溶解：t＝smoothstep((遮罩×n＋1.1−2.1×value−softness)/(1−2×softness))，n＝溶解貼圖的 r×a（revert 時 1−n） */
  dissolve?: {
    tex?: FxFlow1Tex
    st: FxTO
    /** _DisFlowU／_DisFlowV */
    flow: [number, number]
    mask?: FxFlow1Tex
    maskST: FxTO
    value: number
    softness: number
    revert?: true
  }
  /** _Mask1：r×a 經 softness 的 smoothstep（revert 反轉）；UV＝uv×st 以 0.5 為中心轉 rotate */
  mask1?: { tex: FxFlow1Tex; st: FxTO; rotate: number; softness: number; revert?: true }
  /** _Mask2：同上，不轉 */
  mask2?: { tex: FxFlow1Tex; st: FxTO; softness: number; revert?: true }
}

export type FxFlow = FxCommonFlow | FxFlow1

export interface GachaFxData {
  v: 1
  /** 來源 prefab 名稱（查證用） */
  prefab: string
  canvas: [number, number]
  unit: number
  systems: FxSystem[]
  flows: FxFlow[]
}
