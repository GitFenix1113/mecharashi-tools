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
  /** 0＝依壽命（frameOverTime × cycles）、1＝依速度（10-29 起：粒子速率照 speedRange 對到 0–1 取 frameOverTime）、2＝依 fps（每秒 fps 格，與壽命無關） */
  timeMode: 0 | 1 | 2
  /** timeMode 0、1 時有 */
  frameOverTime?: FxMinMax
  /** 只有 timeMode 1 時有：速率 [下限, 上限]（Unity 單位／秒） */
  speedRange?: [number, number]
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
  /** 第幾組 UIParticle（階層順序，0 起）：有圖層夾在兩組粒子之間時 builder 才輸出（10-29 1051 奔霄），組優先於 order；省略＝0 */
  group?: number
  clip?: FxClip
  /**
   * mode 0＝billboard、1＝沿速度拉伸；maxSize＝佔畫布高度的比例上限。
   * billboard 才有（10-29 起，用到時才輸出）：pivot＝四邊形在粒子座標裡移開多少（粒子大小為單位，Unity 的 Pivot）；
   * align＝Render Alignment Local 時系統旋轉的 2×2 [a, b, c, d]（畫布 x＝a·x＋b·y、y＝c·x＋d·y），省略＝正對畫面
   */
  render: { mode: number; lengthScale: number; velocityScale: number; maxSize: number; pivot?: [number, number]; align?: [number, number, number, number] }
  /**
   * 貼圖（官方檔名，public/images/game/fx/）、顏色強度、主貼圖旋轉（弧度）。
   * blend：'alpha'＝一般透明（Unity 材質 _Dst3＝10 → SrcAlpha, OneMinusSrcAlpha）；省略＝疊加（SrcAlpha, One）。
   * strengthAlpha：強度也乘 alpha（UI/Flow1 的 _MainValue 乘在最後、四個通道都乘）；省略＝只乘 RGB（UIFx_Alpha、UI_CommonFlow）。
   * tint：材質的色調 RGBA，跟貼圖、頂點色、強度相乘（UI/Flow1 的 _Color，四個通道都乘）；省略＝白色
   */
  material: {
    tex: string; strength: number; texRotate: number; blend?: 'alpha'; strengthAlpha?: true; tint?: [number, number, number, number]
    /** UI_CommonFlow 用到遮罩／捲動／tiling／擾動時（10-29 起）：改用流動 shader 畫，strength、texRotate 不用（看 flow 裡的） */
    flow?: FxCommonFlowParams
    /** UI/Flow1 用到單張貼圖以外的設定時（10-29 起）：改用 Flow1 shader 畫，顏色＝粒子顏色 × tint；strength、texRotate 不用 */
    flow1?: FxFlow1Params
    /** UI_General（10-29 起）：用 FS_GENERAL 畫，顏色＝粒子顏色 × tint（_Color）；strength、texRotate 不用 */
    general?: FxGeneralParams
    /** UI/Common（10-29 起）：用 FS_UI_COMMON 畫，顏色＝粒子顏色；strength、texRotate、tint 不用 */
    uiCommon?: FxUICommonParams
  }
  duration: number
  looping: boolean
  prewarm: boolean
  /**
   * startDelay（秒）：開始播放後等這麼久才開始跑，只等一次（之後每輪不再等）；省略＝不延遲。
   * 只會是 mode 0（常數）或 3（兩個常數之間隨機，每次播放抽一次），見 build-gacha-fx.mjs 的 startDelay
   */
  delay?: FxMinMax
  /**
   * Animator 片段開關這個節點（或祖先）的 GameObject（m_IsActive，10-29 起）：len 秒一輪，on 是開著的區間 [起, 迄)（秒）。
   * 關著時粒子清掉、不跑；打開時從頭播（延遲、預熱照常）。省略＝一直開著
   */
  active?: { len: number; on: [number, number][] }
  /**
   * 節點被 TweenPos2 平移（10-29 起，只有 local 空間的系統）：len 秒一輪，d 是每格的 [dx, dy]（相對 pos 的畫布像素，格數 d.length/2，
   * 最後一格＝結尾），引擎線性內插、粒子與拖尾整組平移。省略＝不動
   */
  move?: { len: number; d: number[] }
  /**
   * world 空間的系統被 Animator 片段移動／旋轉（10-29 起）：len 秒一輪，d 每格 6 個數 [dx, dy, qx, qy, qz, qw]（相對 pos 的畫布像素、
   * 世界旋轉），引擎線性內插；只在發射時用（粒子出生的位置與方向），已發射的粒子留在原地。省略＝用 pos／rot
   */
  emitter?: { len: number; d: number[] }
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
   * radius／thickness／angle／length 只有球與圓錐用得到；arc（度）只有圓形、不是 360° 才有
   */
  shape?: { type: number; radius: number; thickness: number; angle: number; length: number; randomDir: number; scale: Vec3; rotation: Vec3; position: Vec3; arc?: number }
  /**
   * orbital：繞 x／y／z 軸轉（rad/s，見 gachaFxSim.ts 的 ORBITAL_RAD）、offset：轉動中心、radial：離中心的速度。
   * 都是 0 就省略（沒用到的台 JSON 不變）
   */
  velocity?: {
    x: FxMinMax; y: FxMinMax; z: FxMinMax; world: boolean
    orbital?: { x: FxMinMax; y: FxMinMax; z: FxMinMax }
    offset?: { x: FxMinMax; y: FxMinMax; z: FxMinMax }
    radial?: FxMinMax
    /** 速度倍率（依壽命）：乘在粒子整體的移動上（線性＋繞軸），噪聲不乘；1 就省略 */
    speedModifier?: FxMinMax
  }
  force?: { x: FxMinMax; y: FxMinMax; z: FxMinMax; world: boolean }
  clamp?: { magnitude: FxMinMax; dampen: number }
  noise?: { frequency: number; scroll: FxMinMax; strength: FxMinMax; amount: FxMinMax }
  rotationOverLife?: FxMinMax
  /** 依速度旋轉：粒子速率照 range 對到 0–1 取 curve（z 軸轉速，弧度／秒）；兩個常數之間隨機時跟速度無關 */
  rotationBySpeed?: { curve: FxMinMax; range: [number, number] }
  colorOverLife?: FxMinMaxGradient
  /** y 只有 separateAxes 時有 */
  sizeOverLife?: { x: FxMinMax; y?: FxMinMax }
  /** 依速度縮放（10-29 起）：粒子速率照 range 對到 0–1 取 x（y 只有 separateAxes 時有），乘在 sizeOverLife 之外 */
  sizeBySpeed?: { x: FxMinMax; y?: FxMinMax; range: [number, number] }
  /** 序列幀；省略＝整張貼圖 */
  uv?: FxUV
  /** 拖尾（Unity TrailModule 的 PerParticle 模式，10-29 起）；render.mode 5（None）時只畫拖尾 */
  trail?: FxTrail
}

/**
 * 拖尾：每顆粒子記下走過的點（移動超過 minVertexDistance 才加一點），點的年齡超過 lifetime 就丟掉，畫成沿路徑的帶子。
 * 沿拖尾的參數 s＝點的年齡 ÷ 拖尾壽命（0＝頭、1＝尾），widthOverTrail／colorOverTrail 照 s 取；colorOverLifetime 照粒子的年齡比例取
 */
export interface FxTrail {
  /** 有拖尾的粒子比例（0–1） */
  ratio: number
  /** 拖尾壽命＝粒子壽命 × 這個（發射時取一次） */
  lifetime: FxMinMax
  /** Unity 單位 */
  minVertexDistance: number
  /** 0 Stretch（照距離）、1 Tile（每單位一次）、2 DistributePerSegment（每段平均）、3 RepeatPerSegment（每段一次） */
  textureMode: 0 | 1 | 2 | 3
  dieWithParticles: boolean
  sizeAffectsWidth: boolean
  sizeAffectsLifetime: boolean
  inheritParticleColor: boolean
  colorOverLifetime: FxMinMaxGradient
  widthOverTrail: FxMinMax
  colorOverTrail: FxMinMaxGradient
  /** 拖尾的材質（renderer 的第二個材質槽）；只支援粒子 shader 的那一種（plain） */
  material: FxSystem['material']
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
  /**
   * 三個角 [左下 x, y, 右下 x, y, 左上 x, y]（畫布座標；右上＝右下＋左上−左下）。層或祖先繞 x／y 軸轉、歪斜、祖先鏡像時才有
   * （10-29 起，3027 巨像的探照燈），有的話引擎照它畫平行四邊形、不看 pos／size／rot
   */
  quad?: number[]
  /** Animator 片段烘成的軌（10-29 起）：有的話優先於 quad／pos／size／rot */
  anim?: FxLayerAnim
  /** Image 的 Filled 類型（10-29 起，10103140 哈德威的滑桿與扇形）：照 uGUI 切掉沒填滿的部分，見 gachaFxFlow1.ts 的 fillQuads */
  fill?: FxFill
  /**
   * 祖先的 TweenRot 一直繞 z 轉（10-29 起，10103118 艾達的箭頭光）：四角（含 anim／quad 算出的）再繞 c（畫布座標）轉 w×時間（弧度，逆時針為正）。
   * 只有轉整圈、線性、循環的才輸出，所以時間一直加上去也接得起來；第 0 秒的角度已算進 pos／rot／quad
   */
  spin?: { c: [number, number]; w: number }
  clip?: FxClip
  /** 遊戲裡階層在所有 UIParticle 之前：先畫這層、再畫粒子；省略＝粒子都畫完才畫 */
  under?: true
  /** 遊戲裡階層夾在兩組 UIParticle 之間：畫完 group < beforeGroup 的粒子後、group ≥ beforeGroup 的粒子前畫（10-29 1051 奔霄的 Image02） */
  beforeGroup?: number
}

/**
 * builder 烘成的逐格軌（Animator 片段，或圖層自己的 TweenAlpha）：len 秒循環，每條軌各自 n＋1 格平均分布在 0～len
 * （最後一格＝結尾，循環時等於第 0 格），引擎線性內插。quad：每格 6 個數（同 FxFlowBase.quad），變換被片段動到才有；
 * alpha：每格的頂點 alpha（取代 color[3]），CanvasGroup alpha 或 Image 顏色的 a 被片段動到、或有 TweenAlpha 才有。
 * 以下是片段經遊戲的 UIShaderVariableProxy 改的材質屬性（10-29 起），取代圖層的靜止值：
 * disturbValue：每格 1 個數（UI_CommonFlow 的 _DisturbValue）；maskTO：每格 4 個數（UI_CommonFlow 的 _MaskTex1TO）；
 * mask1ST：每格 4 個數（UI/Flow1 的 _Mask1_ST）；shiny：每格 1 個數（UIShiny 的 m_EffectFactor，取代 FxImage.shiny.factor）
 */
/**
 * Image 的 Filled（type 3）：method 0 Horizontal、1 Vertical、4 Radial360（Radial90／180 builder 報 ⚠）；origin＝m_FillOrigin；
 * clockwise＝m_FillClockwise；amount＝m_FillAmount（片段動到時第 0 秒的值，逐格的在 anim.fill）。片段寫欄位不經過 setter，可以超過 1
 */
export interface FxFill { method: 0 | 1 | 4; origin: number; clockwise: boolean; amount: number }

export interface FxLayerAnim {
  len: number
  quad?: number[]
  alpha?: number[]
  disturbValue?: number[]
  maskTO?: number[]
  mask1ST?: number[]
  shiny?: number[]
  /** 每格 1 個數（Image 的 m_FillAmount，10-29 起），取代 fill.amount */
  fill?: number[]
  /** 每格 4 個數（UIShiny 的四角位置，片段動 m_Rotation 時，10-29 起），取代 FxImage.shiny.corners */
  shinyCorners?: number[]
  /** 每格 1 個數（UI/Flow1 的 _DissolveValue，10-29 起），取代 dissolve.value */
  dissolveValue?: number[]
  /** 每格 1 個數（UI_General 的 _SoftDissValue，10-31 起，艾達的掃光），取代 general.soft.value */
  softValue?: number[]
}

/**
 * 流動圖層（Image＋UI_CommonFlow）：擾動貼圖捲動推移主貼圖的 UV，疊加在最上層。
 * mainST 之後的欄位是 10-17 照 shader 補的，預設值就省略（芬里厄的 JSON 因此不變）。
 */
export interface FxCommonFlow extends FxFlowBase, FxCommonFlowParams {
  shader?: undefined
  /** Image 顏色 × 材質 _Color */
  color: RGBA
  /** 'alpha'＝材質 _Dst＝10 一般透明（10-29 起，亮度不乘校準的 FLOW_GAIN）；省略＝疊加 */
  blend?: 'alpha'
}

/** UI_CommonFlow 材質的參數：流動圖層與粒子（FxSystem.material.flow）共用 */
export interface FxCommonFlowParams {
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
  /** 擾動貼圖槽的 tiling／offset（材質 m_TexEnvs 的 _DisturbTex，TRANSFORM_TEX），在旋轉之前；省略＝[1,1,0,0]（10-29 補） */
  disturbST?: FxTO
  /** 擾動只推 V（_ModeCtrl1＝_ModeCtrl2＝1，10-29 補）；省略＝照校準只推 U */
  disturbV?: true
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
export interface FxFlow1 extends FxFlowBase, FxFlow1Params {
  shader: 'flow1'
  /** 頂點色（Image／RawImage 的 color）× 材質 _Color */
  color: RGBA
  /** 'alpha'＝_Dst 10（一般透明）；省略＝疊加（_Dst 1） */
  blend?: 'alpha'
}

/** UI/Flow1 材質的參數：流動圖層與粒子（FxSystem.material.flow1）共用 */
export interface FxFlow1Params {
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
  /**
   * 第二張主貼圖 _MainTex2（10-29 起，10103106 娜歐蜜的 GlitchSquare）：主貼圖＋＝intensity × r^pow × 主貼圖 a（四個通道），之後 a 夾到 0–1。
   * UV＝(uv×st) 跟主貼圖一樣轉 mainRotate、捲 flow、位移 to.zw、往擾動 D 內插（同軸）、以 0.5 為中心乘 to.xy；不夾 v。
   * intensity 是 0 就整個省略；tex 省略＝white
   */
  main2?: { tex?: FxFlow1Tex; intensity: number; pow?: number; flow?: [number, number]; to?: FxTO; st?: FxTO }
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

/** UI_General 的一個選填貼圖段：貼圖（省略＝white）、tiling／offset、每秒捲動（省略＝[1,1,0,0]／不捲） */
interface FxGeneralLayer { tex?: FxFlow1Tex; st?: FxTO; speed?: [number, number] }

/**
 * UI_General 材質（10-29 反組譯，公式見 gachaFxEngine.ts 的 FS_GENERAL）。選填的段落省略＝那段在 shader 裡恰好是恆等：
 * noise（_NoiseValue＝0 且沒開 _ToggleSwitch3）、edge（沒開 _ToggleSwitch2）、mask1／mask2（沒有貼圖、沒反轉）、soft（沒有貼圖且算出來是 1）。
 * 旋轉是弧度（材質存的是度）
 */
export interface FxGeneralParams {
  main?: FxFlow1Tex
  mainST?: FxTO
  mainSpeed?: [number, number]
  mainRotate?: number
  /** _MainColorRB：R、B 取樣各偏移 0.1×值（色差） */
  colorRB?: [number, number]
  /** _MainColor；省略＝白色 */
  mainColor?: RGBA
  /** _Centre：最後整體乘的倍率 */
  centre: number
  noise?: FxGeneralLayer & { value: number; /** _ToggleSwitch3 */ uOnly?: true }
  edge?: FxGeneralLayer & { value: number; width: number; color: RGBA; /** _ToggleSwitch6 */ revert?: true }
  mask1?: FxGeneralLayer & { rotate?: number; /** _ToggleSwitch0 */ revert?: true }
  mask2?: FxGeneralLayer & { rotate?: number; /** _ToggleSwitch7 */ revert?: true }
  /** value 只有開了 _ToggleSwitch1 才有；float4＝_Float4 */
  soft?: FxGeneralLayer & { value?: number; float4: number; /** _ToggleSwitch5 */ revert?: true }
}

/**
 * UI/Common 材質（10-29 反組譯，公式見 gachaFxEngine.ts 的 FS_UI_COMMON）。選填的段落省略＝恆等：貼圖段（alpha／alpha3／grad）沒貼圖
 * （預設 white）、distort 開關沒開或強度是 0；其他欄位省略＝shader 預設值
 */
export interface FxUICommonParams {
  main?: FxFlow1Tex
  mainST?: FxTO
  /** _Disslve_U1／V1：主貼圖每秒捲動，shader 裡乘的是 0.5×時間 */
  mainSpeed?: [number, number]
  /** _MainPower；省略＝1 */
  power?: number
  /** _Main_Intensity；省略＝1 */
  intensity?: number
  /** _MainColor 的 RGB（alpha 不讀）；省略＝白色 */
  mainColor?: [number, number, number]
  /** _Alpha_Main（「透明通道選擇」）：alpha＝min((a×w)^power, 1)＋dot(rgb, xyz)；省略＝[0,0,0,1] */
  alphaSel?: RGBA
  /** _All_Alpha；省略＝1 */
  allAlpha?: number
  /** _LiziAlpha（_LIZIALPHA_ON）：alpha 乘粒子顏色的 alpha；省略＝不乘 */
  particleAlpha?: true
  /** 扭曲（_Distortions_Tex 的 r）：k＝[_Float2, _Float4]×_DistortionIndensity；main＝主貼圖 UV 加 r×k，alpha＝_AlphaTex 的 UV 乘 (1＋r×k) */
  distort?: FxGeneralLayer & { k: [number, number]; main?: true; alpha?: true }
  alpha?: FxGeneralLayer
  alpha3?: FxGeneralLayer
  /** _Grad2（顏色圖）：RGB 乘上去 */
  grad?: FxGeneralLayer
}

/**
 * Image＋UIFx_Alpha（粒子材質掛在 Image 上，10-29 起；2013 烈焰的光暈）：整張貼圖 × 顏色 × strength，跟粒子同一支 shader。
 * color 的 alpha 已乘上 CanvasGroup 的 alpha（見 build-gacha-fx.mjs 的 groupAlpha）
 */
export interface FxImage extends FxFlowBase {
  shader: 'alpha'
  color: RGBA
  tex: string
  strength: number
  /** 材質 _Color（10-29 起），RGBA 都乘；省略＝白色 */
  tint?: RGBA
  /** 'alpha'＝_Dst3 10（一般透明）；省略＝疊加 */
  blend?: 'alpha'
  /** UIShiny 掃光（10-29 起，只在插畫切片上）：用 FS_SHINY 畫，見 build-gacha-fx.mjs 的 shinyLayer */
  shiny?: FxShiny
  /**
   * 片段換 sprite 的序列幀（10-29 起，10103171 戰部渡的雲海）：sheets＝WebP 圖集（cols×rows 格，左上第 0 格、先橫後直，滿了換下一張）；
   * keys＝攤平的 [時間, 幀號]…（階梯，len 秒一輪）。tex 是 sheets[0]
   */
  seq?: { sheets: string[]; cols: number; rows: number; len: number; keys: number[] }
}

/**
 * UIShiny 的參數（都已量化成 1/255，同遊戲的參數貼圖）：factor＝位置（m_EffectFactor，帶位置在 2×factor−0.5）、width、softness、
 * brightness、gloss；corners＝四個角（左下、右下、右上、左上）的位置座標，引擎在兩個三角形上內插（同 Unity 的逐頂點值）
 */
export interface FxShiny {
  factor: number
  width: number
  softness: number
  brightness: number
  gloss: number
  corners: [number, number, number, number]
}

/**
 * Image＋ProjectFM/UI/SpeedLine（10-29 起，10103118 艾達、10103154 蘿莎的光圈；反組譯在 shaders/SpeedLine/，GLSL 是 gachaFxEngine.ts 的 FS_SPEEDLINE）。
 * UV（×_MainTex_ST）以 0.5 為中心轉 rotate，減掉 offset 後取極座標：半徑 2×長度×u 往外捲（−時間×speed）、角度（圈）×v，
 * 取 Unity 的 Gradient Noise（simpleNoise 時 Simple Noise）比例 10，^density 夾到 1 ＝亮點。
 * 顏色純量＝lerp(x×color1, (1−x)×color2, colorWeight)＋colorScale（x＝轉過的 u，radial 時改用半徑），rgb＝純量×頂點色×亮點；
 * alpha＝環形遮罩 smoothstep(inner±blur)−smoothstep(outer±blur)（離 offset 的距離，沒轉），customMask 時改用貼圖 r；×頂點 a。
 * Blend SrcAlpha One。color1／color2 是 shader 裡的 float，Unity 從材質的 Color 取 x（r）
 */
export interface FxSpeedLine extends FxFlowBase {
  shader: 'speedLine'
  /** Image 顏色 */
  color: RGBA
  rotate?: number
  st?: FxTO
  offset: [number, number]
  u: number
  v: number
  speed: number
  density: number
  simpleNoise?: true
  color1: number
  color2: number
  colorWeight: number
  colorScale: number
  radial?: true
  maskInner: number
  maskOuter: number
  maskBlur: number
  /** _CustumMaskOn：alpha 改用這張貼圖的 r */
  maskTex?: string
}

/**
 * Image＋UI/Common（10-29 起，10103106 娜歐蜜的 Fx_Noise_1／2）：跟粒子同一支 FS_UI_COMMON，UV 是 Image 的 0～1、頂點色是 Image 顏色
 * （× CanvasGroup）。shader 只讀 UV 與頂點色，所以 Image 跟粒子的畫法一樣
 */
export interface FxUICommonLayer extends FxFlowBase, FxUICommonParams {
  shader: 'uiCommon'
  color: RGBA
  /** 'alpha'＝_Dst 10；省略＝疊加 */
  blend?: 'alpha'
}

/**
 * Image＋UI_General（10-31 起，10103118 艾達的 SweepLightGroup/1、2：青色掃光，片段把軟溶解值來回推）：跟粒子同一支 FS_GENERAL，
 * UV 是 Image 的 0～1、頂點色是 Image 顏色 × 材質 _Color（同粒子的 tint，builder 先乘好）× CanvasGroup。shader 只讀 UV 與頂點色，
 * 所以 Image 跟粒子的畫法一樣（同 FxUICommonLayer）
 */
export interface FxGeneralImage extends FxFlowBase {
  shader: 'general'
  color: RGBA
  /** 'alpha'＝_Dst 10；省略＝疊加 */
  blend?: 'alpha'
  general: FxGeneralParams
}

export type FxFlow = FxCommonFlow | FxFlow1 | FxImage | FxSpeedLine | FxUICommonLayer | FxGeneralImage

export interface GachaFxData {
  v: 1
  /** 來源 prefab 名稱（查證用） */
  prefab: string
  canvas: [number, number]
  unit: number
  systems: FxSystem[]
  flows: FxFlow[]
}
