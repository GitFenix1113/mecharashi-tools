// 機甲卡池動態（PLAN-042-B Phase J）：Unity 粒子系統的模擬（純計算，不碰 DOM／WebGL，node --test 直接載入）。
//
// 逐行移植自 10-16 的芬里厄試作（_local-notes/2026-10/2026-10-16_機甲故事館_規劃/fenrir-proto/index.html），
// 那份已和站長的遊戲視窗並排校準過——改這裡的公式前，先在試作頁上比對，不要憑感覺「修正」成更像 Unity 文件的寫法。
// 試作刻意保留的幾個怪地方（照抄、別改）：
//   ・randomDirectionAmount 的三個分量各取一個新的隨機方向（Unity 是同一個）
//   ・MinMaxCurve 模式 2 的下限曲線乘 minScalar（沒有才用 scalar）
//   ・重力在一個循環內取同一個值（random＝0.5）

import type { CurveKey, FxBurst, FxGradient, FxMinMax, FxMinMaxGradient, FxSystem, FxUV, Quat, RGBA, Vec3 } from './gachaFxTypes.ts'

export type Rand = () => number

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// ── Unity 曲線／漸層 ─────────────────────────────────────────────────────────

/** Hermite 曲線。沒有關鍵影格＝1（Unity 的空曲線乘上 scalar 就是常數） */
export function evalCurve(keys: readonly CurveKey[] | undefined, t: number): number {
  if (!keys || !keys.length) return 1
  if (t <= keys[0][0]) return keys[0][1]
  const last = keys[keys.length - 1]
  if (t >= last[0]) return last[1]
  for (let i = 0; i < keys.length - 1; i++) {
    const [ta, va, , outA] = keys[i]
    const [tb, vb, inB] = keys[i + 1]
    if (t < ta || t > tb) continue
    const dt = tb - ta
    if (dt <= 0) return vb
    if (outA === null || inB === null) return va   // 無限斜率＝階梯
    const s = (t - ta) / dt, s2 = s * s, s3 = s2 * s
    const m0 = outA * dt, m1 = inB * dt
    return (2 * s3 - 3 * s2 + 1) * va + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * vb + (s3 - s2) * m1
  }
  return 1
}

export function evalMinMax(c: FxMinMax | undefined, t: number, r: number): number {
  if (!c) return 0
  switch (c.mode) {
    case 0: return c.scalar
    case 1: return c.scalar * evalCurve(c.maxCurve, t)
    case 2: return lerp((c.minScalar ?? c.scalar) * evalCurve(c.minCurve, t), c.scalar * evalCurve(c.maxCurve, t), r)
    case 3: return lerp(c.minScalar ?? 0, c.scalar, r)
    default: return c.scalar
  }
}

/** 漸層的一個通道：keys 每筆 [t, …通道]，ch 是通道在陣列裡的位置 */
function pickKeys(keys: readonly (readonly number[])[], t: number, ch: number, fixed: boolean): number {
  if (!keys.length) return 1
  if (t <= keys[0][0]) return keys[0][ch]
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1]
    if (t > b[0]) continue
    if (fixed) return b[ch]
    const s = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0
    return a[ch] + (b[ch] - a[ch]) * s
  }
  return keys[keys.length - 1][ch]
}

export function evalGradient(g: FxGradient, t: number): RGBA {
  const fixed = !!g.fixed
  return [pickKeys(g.colors, t, 1, fixed), pickKeys(g.colors, t, 2, fixed), pickKeys(g.colors, t, 3, fixed), pickKeys(g.alphas, t, 1, fixed)]
}

const WHITE: RGBA = [1, 1, 1, 1]
const lerp4 = (a: RGBA, b: RGBA, r: number): RGBA => [lerp(a[0], b[0], r), lerp(a[1], b[1], r), lerp(a[2], b[2], r), lerp(a[3], b[3], r)]

export function evalMinMaxGradient(g: FxMinMaxGradient | undefined, t: number, r: number): RGBA {
  if (!g) return WHITE
  const max = g.maxGradient, min = g.minGradient
  switch (g.mode) {
    case 0: return g.maxColor ?? WHITE
    case 1: return max ? evalGradient(max, t) : WHITE
    case 2: return lerp4(g.minColor ?? WHITE, g.maxColor ?? WHITE, r)
    case 3: return max && min ? lerp4(evalGradient(min, t), evalGradient(max, t), r) : WHITE
    case 4: return max ? evalGradient(max, r) : WHITE
    default: return g.maxColor ?? WHITE
  }
}

// ── 序列幀（UVModule）────────────────────────────────────────────────────────

/** 一輪幾格：整張＝tilesX×tilesY、只播一列＝tilesX */
export const uvFrameCount = (uv: FxUV) => (uv.animationType === 1 ? uv.tilesX : uv.tilesX * uv.tilesY)

/** 速率照 [下限, 上限] 對到 0–1（依速度的模組共用；上下限相同時取 0） */
export const speedT = (range: readonly [number, number], sp: number) => {
  const [lo, hi] = range
  return hi > lo ? Math.min(1, Math.max(0, (sp - lo) / (hi - lo))) : 0
}

/**
 * 粒子現在是第幾格（0 起算，整張的編號：左上第 0 格、先橫後直）。照 Unity：
 *   依壽命：startFrame ＋ frameOverTime(年齡÷壽命) × cycles
 *   依速度：startFrame ＋ frameOverTime(速率照 speedRange 對到 0–1)（10-29 起；sp＝這一格的速率）
 *   依 fps ：startFrame ＋ 年齡 × fps ÷ 幀數（cycles 只對依壽命有意義）
 * 取小數部分（超過一輪就從頭）× 幀數、無條件捨去。只播一列時再加上列的偏移。
 * r＝粒子固定的亂數：[frameOverTime, startFrame, 隨機列]
 */
export function uvFrame(uv: FxUV, age: number, life: number, r: readonly [number, number, number], sp = 0): number {
  const n = uvFrameCount(uv)
  const t = uv.timeMode === 2 ? (age * (uv.fps ?? 0)) / n
    : uv.timeMode === 1 ? evalMinMax(uv.frameOverTime, speedT(uv.speedRange ?? [0, 1], sp), r[0])
    : evalMinMax(uv.frameOverTime, age / life, r[0]) * (uv.cycles ?? 1)
  const x = evalMinMax(uv.startFrame, 0, r[1]) + t
  const k = Math.min(Math.floor((x - Math.floor(x)) * n), n - 1)
  if (uv.animationType !== 1) return k
  const row = uv.rowMode === 1 ? Math.min(Math.floor(r[2] * uv.tilesY), uv.tilesY - 1) : Math.min(uv.rowIndex ?? 0, uv.tilesY - 1)
  return row * uv.tilesX + k
}

/**
 * 第 k 格的 UV 範圍 [u0, v0, u1, v1]。Unity 的 UV 原點在左下（引擎上傳貼圖時 UNPACK_FLIP_Y，對得上），
 * 所以第 0 列（最上面）是 v 最大的那一條。
 */
export function uvRect(uv: FxUV, k: number): [number, number, number, number] {
  const du = 1 / uv.tilesX, dv = 1 / uv.tilesY
  const u0 = (k % uv.tilesX) * du, v0 = 1 - (Math.floor(k / uv.tilesX) + 1) * dv
  return [u0, v0, u0 + du, v0 + dv]
}

// ── 3D 小工具 ────────────────────────────────────────────────────────────────

const D2R = Math.PI / 180

/**
 * 速度模組 orbital 的單位換成弧度的倍率：1＝rad/s、D2R＝°/s。Unity 文件沒寫單位；
 * 10-29 用 3028 天角獸（Particle_Spark2 orbitalX −0.9、Particle_Smoke_2 orbitalY 0.44）對 Global 遊戲畫面比對，rad/s 比較像
 */
export const ORBITAL_RAD = 1
export const ORBITAL_DEG = D2R

export interface SimOptions {
  /** orbital 的單位倍率（見 ORBITAL_RAD）；負值＝反方向，0＝關掉。省略＝ORBITAL_RAD */
  orbitalScale?: number
  /**
   * 照 prefab 的 simulationSpeed 加速／減速；省略＝照（10-30 起：站上已上線的 17 台有 ×0.5～×3，先維持 10-16 校準的行為），
   * false＝一律 ×1。EN wiki（HuyT）10-29 的版本預設不照：遊戲裡粒子由 UIParticle 自己呼叫 Simulate(deltaTime)，
   * 它的程式沒讀 simulationSpeed；對 3028 天角獸的 ×10 火花（Particle_Spark4／5）比對遊戲畫面，×1 比較像。
   * 芬里厄 10-16 校準時是照的（火花 ×0.5、×0.7），要改成不照得先對過遊戲畫面
   */
  honorSimSpeed?: boolean
}

/** Unity Quaternion.Euler：先 Z、再 X、再 Y（角度） */
export function rotEuler(v: Vec3, ex: number, ey: number, ez: number): Vec3 {
  let [x, y, z] = v
  let c = Math.cos(ez * D2R), s = Math.sin(ez * D2R);
  [x, y] = [c * x - s * y, s * x + c * y]
  c = Math.cos(ex * D2R); s = Math.sin(ex * D2R);
  [y, z] = [c * y - s * z, s * y + c * z]
  c = Math.cos(ey * D2R); s = Math.sin(ey * D2R);
  [x, z] = [c * x + s * z, -s * x + c * z]
  return [x, y, z]
}

export function rotQuat(v: Vec3, q: Quat): Vec3 {
  const [qx, qy, qz, qw] = q, [vx, vy, vz] = v
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx)
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)]
}

const norm3 = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l] }

const randUnit = (rand: Rand): Vec3 => {
  const z = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z)
  return [r * Math.cos(a), r * Math.sin(a), z]
}

// ── 3D Perlin（噪聲模組的近似）─────────────────────────────────────────────

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
const grad3 = (h: number, x: number, y: number, z: number) => {
  const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z)
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v)
}

export function makePerlin(rand: Rand): (x: number, y: number, z: number) => number {
  const P = new Uint8Array(512)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]] }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255]
  return (x, y, z) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z)
    const u = fade(x), v = fade(y), w = fade(z)
    const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z
    return lerp(
      lerp(lerp(grad3(P[AA] & 15, x, y, z), grad3(P[BA] & 15, x - 1, y, z), u), lerp(grad3(P[AB] & 15, x, y - 1, z), grad3(P[BB] & 15, x - 1, y - 1, z), u), v),
      lerp(lerp(grad3(P[AA + 1] & 15, x, y, z - 1), grad3(P[BA + 1] & 15, x - 1, y, z - 1), u), lerp(grad3(P[AB + 1] & 15, x, y - 1, z - 1), grad3(P[BB + 1] & 15, x - 1, y - 1, z - 1), u), v),
      w,
    )
  }
}

// ── 粒子系統 ─────────────────────────────────────────────────────────────────

export interface Particle {
  /** 相對粒子系統原點的位置（Unity 單位） */
  pos: Vec3
  vel: Vec3
  /** 這一格實際的速度（含速度模組與噪聲）：拉伸 billboard 用它決定方向與長度 */
  vel3: Vec3
  age: number
  life: number
  size: number
  sizeY: number
  /** 弧度 */
  rot: number
  col: RGBA
  /** 每顆粒子固定的亂數（各模組「兩者之間隨機」用） */
  r: [number, number, number, number, number]
  /** 序列幀用的固定亂數（見 uvFrame）；系統沒有序列幀就沒有——不多抽亂數，其他系統的亂數序列維持原樣 */
  uvr?: [number, number, number]
  /** 拖尾（系統有 trail、而且這顆有抽中 ratio 才有）；同樣沒有拖尾的系統不多抽亂數 */
  trail?: ParticleTrail
}

export interface ParticleTrail {
  /** 走過的點，新的在前：[x, y, z（相對系統原點，Unity 單位）, 加入時的系統時間] */
  pts: [number, number, number, number][]
  /** 拖尾壽命（秒）：點的年齡超過就丟掉 */
  life: number
  /** colorOverTrail／colorOverLifetime 的固定亂數 */
  r: number
}

export class ParticleSim {
  readonly sys: FxSystem
  readonly parts: Particle[] = []
  /** 粒子死了、拖尾還沒消完的（dieWithParticles 關時）：age 停在 life，只剩拖尾的點繼續過期 */
  readonly orphans: Particle[] = []
  /** 播放時間（秒，不含 startDelay，跟 Unity 的 ParticleSystem.time 一樣） */
  t = 0
  /** startDelay 還剩幾秒：等的時候整個系統停住（t 不走、不發射） */
  wait: number
  /** 被片段關掉的時候 false（sys.active，見 setActive） */
  on = true
  /** 這一格系統原點的畫布座標（sys.pos，被 TweenPos2 平移時引擎每格改，見 sys.move） */
  origin: [number, number]
  /** 這一格發射用的位移（模擬單位）與旋轉（sys.emitter，world 空間的系統被片段移動時引擎每格改；預設 0 與 sys.rot） */
  emitOff: Vec3 = [0, 0, 0]
  emitRot: Quat
  private emitAcc = 0
  private bursts: { time: number; next: number; done: number; burst: FxBurst }[] = []
  private readonly rand: Rand
  private readonly perlin: (x: number, y: number, z: number) => number
  private readonly orbitalScale: number
  private readonly simSpeed: number

  constructor(sys: FxSystem, rand: Rand = Math.random, perlin = makePerlin(rand), opts: SimOptions = {}) {
    this.sys = sys
    this.rand = rand
    this.perlin = perlin
    this.orbitalScale = opts.orbitalScale ?? ORBITAL_RAD
    this.simSpeed = opts.honorSimSpeed !== false ? sys.simSpeed || 1 : 1
    this.origin = sys.pos
    this.emitRot = sys.rot
    this.wait = 0
    this.start()
  }

  /** 從頭播：延遲、burst、預熱都重來（建構時與 setActive 打開時） */
  private start(): void {
    const S = this.sys
    this.t = 0
    this.emitAcc = 0
    this.bursts = (S.emission?.bursts ?? []).map((b) => ({ time: b.time, next: b.time, done: 0, burst: b }))
    // 兩個常數之間隨機才抽亂數：沒有延遲（或延遲是常數）的系統亂數序列不變
    const d = S.delay
    this.wait = d ? Math.max(0, evalMinMax(d, 0, d.mode === 3 ? this.rand() : 0)) : 0
    // 預熱：開場就是「已經跑了一輪」的樣子（預熱＋延遲 Unity 不給並用，builder 不會輸出這種組合）
    if (S.prewarm) for (let i = 0; i < Math.ceil(S.duration * 30); i++) this.update(1 / 30)
  }

  /**
   * 片段開關 GameObject（sys.active，10-29 起）：關掉時粒子與拖尾清掉、不再跑；再打開時從頭播（Unity 的 OnEnable＋playOnAwake）
   */
  setActive(on: boolean): void {
    if (on === this.on) return
    this.on = on
    this.parts.length = 0
    this.orphans.length = 0
    if (on) this.start()
  }

  /** 丟掉年齡超過拖尾壽命的點（最舊的在後面） */
  private trimTrail(T: ParticleTrail): void {
    while (T.pts.length && this.t - T.pts[T.pts.length - 1][3] > T.life) T.pts.pop()
  }

  emit(n: number): void {
    const S = this.sys, I = S.initial, sh = S.shape, R = this.rand
    const tn = (this.t % S.duration) / S.duration
    for (let k = 0; k < n; k++) {
      if (this.parts.length >= I.maxParticles) return
      const life = evalMinMax(I.lifetime, tn, R()), speed = evalMinMax(I.speed, tn, R())
      const size = evalMinMax(I.size, tn, R())
      const sizeY = I.sizeY ? evalMinMax(I.sizeY, tn, R()) || size : size
      // 形狀：0 球、4 圓錐、5 方塊、8 圓錐體積、10 圓形（其餘當點）
      let lp: Vec3 = [0, 0, 0]
      let dir = randUnit(R)
      if (sh && (sh.type === 4 || sh.type === 8)) {
        const a = R() * Math.PI * 2, rr = Math.sqrt(lerp((1 - sh.thickness) ** 2, 1, R()))
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr
        lp = [px * sh.radius, py * sh.radius, sh.type === 8 ? R() * sh.length : 0]
        const tan = Math.tan(sh.angle * D2R)
        dir = norm3([px * tan, py * tan, 1])
        if (sh.type === 8) { lp[0] += dir[0] * lp[2]; lp[1] += dir[1] * lp[2] }
      } else if (sh && sh.type === 0) {
        const u = randUnit(R), rr = sh.radius * Math.cbrt(lerp((1 - sh.thickness) ** 3, 1, R()))
        lp = [u[0] * rr, u[1] * rr, u[2] * rr]
        dir = u
      } else if (sh && sh.type === 10) {
        // 圓形（10-29 起）：xy 平面上的圓盤（thickness＝從外緣往內多厚，面積均勻），方向從圓心往外；
        // arc 只做 Random 模式：角度在 0～arc 之間均勻亂數，從 +x 往 +y 量（builder 會報其他模式）
        const a = R() * (sh.arc != null ? sh.arc * D2R : Math.PI * 2), rr = Math.sqrt(lerp((1 - sh.thickness) ** 2, 1, R()))
        lp = [Math.cos(a) * rr * sh.radius, Math.sin(a) * rr * sh.radius, 0]
        dir = [Math.cos(a), Math.sin(a), 0]
      } else if (sh && sh.type === 5) {
        // 方塊（Unity 的 Box＝從體積發射）：邊長 1、以原點為中心，下面乘上形狀的 scale 就是方塊大小（Unity 編輯器的方塊 gizmo 也是
        // size＝scale）。方向一律是形狀的前方 +z、不吃 scale，只跟著形狀旋轉（Unity 手冊：粒子沿發射器的 forward (Z) 移動）
        lp = [R() - 0.5, R() - 0.5, R() - 0.5]
        dir = [0, 0, 1]
      }
      if (sh) {
        if (sh.randomDir) { const d = dir; dir = norm3([0, 1, 2].map((i) => lerp(d[i], randUnit(R)[i], sh.randomDir)) as Vec3) }
        const [sx, sy, sz] = sh.scale, [rx, ry, rz] = sh.rotation, [ox, oy, oz] = sh.position
        const p = rotEuler([lp[0] * sx, lp[1] * sy, lp[2] * sz], rx, ry, rz)
        lp = [p[0] + ox, p[1] + oy, p[2] + oz]
        dir = rotEuler(dir, rx, ry, rz)
      }
      // 粒子系統本身的旋轉與縮放（Local scaling）；被片段移動的 world 空間系統用這一格的旋轉與位移（emitRot／emitOff）
      const sc = S.scale, eo = this.emitOff
      lp = rotQuat([lp[0] * sc[0], lp[1] * sc[1], lp[2] * sc[2]], this.emitRot)
      lp = [lp[0] + eo[0], lp[1] + eo[1], lp[2] + eo[2]]
      dir = rotQuat(dir, this.emitRot)
      const vel: Vec3 = [dir[0] * speed, dir[1] * speed, dir[2] * speed]
      // 拖尾：抽 ratio、壽命（發射時取一次，跟著系統時間取曲線）、顏色用的亂數；第一個點就是出生的位置。
      // 壽命的「兩條曲線之間隨機」照 Unity（兩條都乘 scalar），不用檔頭那個試作的怪地方（下限乘 minScalar）：
      // 1018 的 minScalar 是 1、scalar 0.05，照試作會變成粒子壽命的 4%–99%，曳光彈拖著整條飛行路徑
      let trail: ParticleTrail | undefined
      if (S.trail && R() < S.trail.ratio) {
        const T = S.trail, LT = T.lifetime
        const lt = LT.mode === 2 ? lerp(LT.scalar * evalCurve(LT.minCurve, tn), LT.scalar * evalCurve(LT.maxCurve, tn), R()) : evalMinMax(LT, tn, R())
        const k = lt * (T.sizeAffectsLifetime ? size * sc[0] : 1)
        trail = { pts: [[lp[0], lp[1], lp[2], this.t]], life: Math.max(Math.max(life, 1e-3) * k, 1e-3), r: R() }
      }
      this.parts.push({
        pos: lp, vel, vel3: [...vel], age: 0, life: Math.max(life, 1e-3),
        size: size * sc[0], sizeY: sizeY * sc[1], rot: -evalMinMax(I.rotation, tn, R()),
        col: evalMinMaxGradient(I.color, tn, R()), r: [R(), R(), R(), R(), R()],
        ...(S.uv ? { uvr: [R(), R(), R()] as [number, number, number] } : {}),
        ...(trail ? { trail } : {}),
      })
    }
  }

  update(dt: number): void {
    if (!this.on) return
    const S = this.sys
    dt *= this.simSpeed
    // startDelay 只在開始播放時等一次，之後每輪不再等；等完那一格剩下的時間照常跑
    if (this.wait > 0) {
      if (dt < this.wait) { this.wait -= dt; return }
      dt -= this.wait
      this.wait = 0
    }
    this.t += dt
    // 粒子死了的拖尾：點照樣過期，消完就丟
    for (let i = this.orphans.length - 1; i >= 0; i--) {
      const tr = this.orphans[i].trail!
      this.trimTrail(tr)
      if (!tr.pts.length) this.orphans.splice(i, 1)
    }
    const dur = S.duration, tn = (this.t % dur) / dur
    const V = S.velocity, F = S.force, L = S.clamp, N = S.noise, RM = S.rotationOverLife, RS = S.rotationBySpeed
    const grav = evalMinMax(S.initial.gravity, tn, 0.5) * 9.81
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i]
      q.age += dt
      if (q.age >= q.life) {
        this.parts.splice(i, 1)
        if (q.trail && !S.trail?.dieWithParticles) { q.age = q.life; this.orphans.push(q) }
        continue
      }
      const a = q.age / q.life
      q.vel[1] -= grav * dt
      if (F) {
        let f: Vec3 = [evalMinMax(F.x, a, q.r[0]), evalMinMax(F.y, a, q.r[1]), evalMinMax(F.z, a, q.r[2])]
        if (!F.world) f = rotQuat(f, S.rot)
        q.vel = [q.vel[0] + f[0] * dt, q.vel[1] + f[1] * dt, q.vel[2] + f[2] * dt]
      }
      if (L) {
        const lim = evalMinMax(L.magnitude, a, q.r[3]), sp = Math.hypot(...q.vel)
        if (sp > lim && sp > 0) {
          const k = 1 - Math.pow(1 - L.dampen, dt * 30), s = lerp(1, lim / sp, k)
          q.vel = [q.vel[0] * s, q.vel[1] * s, q.vel[2] * s]
        }
      }
      let ext: Vec3 = [0, 0, 0]
      if (V) {
        ext = [evalMinMax(V.x, a, q.r[0]), evalMinMax(V.y, a, q.r[1]), evalMinMax(V.z, a, q.r[2])]
        if (!V.world) ext = rotQuat(ext, S.rot)
      }
      let nz: Vec3 = [0, 0, 0]
      if (N) {
        const fr = N.frequency, sc = evalMinMax(N.scroll, a, q.r[4]) * this.t
        const st = evalMinMax(N.strength, a, q.r[4]) * evalMinMax(N.amount, a, q.r[4]) * 2
        const [x, y, z] = q.pos
        nz = [
          this.perlin(x * fr + sc, y * fr, z * fr + 11.3) * st,
          this.perlin(x * fr, y * fr + sc + 37.1, z * fr) * st,
          this.perlin(x * fr + 71.7, y * fr, z * fr + sc) * st,
        ]
      }
      // orbital／radial：這一格位置繞中心轉、往外推的位移，換成速度加進 vel3（跟線性速度一樣不累積，拉伸 billboard 也照實際方向）。
      // 中心＝系統原點＋offset；world 以外在系統自己的座標轉（先把位置轉回系統座標、算完再轉出來）
      let ob: Vec3 = [0, 0, 0]
      if (V && (V.orbital || V.radial) && dt > 0) {
        const inv: Quat = [-S.rot[0], -S.rot[1], -S.rot[2], S.rot[3]]
        const p = V.world ? q.pos : rotQuat(q.pos, inv)
        const c: Vec3 = V.offset ? [evalMinMax(V.offset.x, a, q.r[0]), evalMinMax(V.offset.y, a, q.r[1]), evalMinMax(V.offset.z, a, q.r[2])] : [0, 0, 0]
        const rel: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]
        let np = rel
        if (V.orbital) {
          const k = (dt * this.orbitalScale) / D2R
          np = rotEuler(rel, evalMinMax(V.orbital.x, a, q.r[0]) * k, evalMinMax(V.orbital.y, a, q.r[1]) * k, evalMinMax(V.orbital.z, a, q.r[2]) * k)
        }
        if (V.radial) {
          const n = norm3(rel), r = evalMinMax(V.radial, a, q.r[3]) * dt
          np = [np[0] + n[0] * r, np[1] + n[1] * r, np[2] + n[2] * r]
        }
        let d: Vec3 = [(np[0] - rel[0]) / dt, (np[1] - rel[1]) / dt, (np[2] - rel[2]) / dt]
        if (!V.world) d = rotQuat(d, S.rot)
        ob = d
      }
      // speedModifier（10-29 補）：Unity 手冊「沿著／繞著目前的行進方向」乘速度，所以乘在粒子本身的速度＋線性＋繞軸上；噪聲是另一個模組，不乘。
      // 有限速（clamp）的話乘完再限一次：1036 幻影的 Glow_4／5 是 ×10 配限速 3.7／3.11、dampen 1，不限的話一格就飛出畫面（3600 px），
      // 照設計意圖限速是管最後的速度。沒有 speedModifier 的系統照原本的加法順序（浮點結果逐位元不變）
      const SM = V?.speedModifier
      if (SM) {
        const k = evalMinMax(SM, a, q.r[3])
        let mv = [0, 1, 2].map((i) => (q.vel[i] + ext[i] + ob[i]) * k) as Vec3
        if (L) {
          const lim = evalMinMax(L.magnitude, a, q.r[3]), sp = Math.hypot(...mv)
          if (sp > lim && sp > 0) {
            const s = lerp(1, lim / sp, 1 - Math.pow(1 - L.dampen, dt * 30))
            mv = [mv[0] * s, mv[1] * s, mv[2] * s]
          }
        }
        q.vel3 = [mv[0] + nz[0], mv[1] + nz[1], mv[2] + nz[2]]
      } else q.vel3 = [q.vel[0] + ext[0] + nz[0] + ob[0], q.vel[1] + ext[1] + nz[1] + ob[1], q.vel[2] + ext[2] + nz[2] + ob[2]]
      q.pos = [q.pos[0] + q.vel3[0] * dt, q.pos[1] + q.vel3[1] * dt, q.pos[2] + q.vel3[2] * dt]
      // 拖尾：離上一個點超過 minVertexDistance 才加新點（畫的時候頭一律接到目前位置）
      if (q.trail) {
        const T = q.trail, last = T.pts[0]
        if (!last || Math.hypot(q.pos[0] - last[0], q.pos[1] - last[1], q.pos[2] - last[2]) >= S.trail!.minVertexDistance) T.pts.unshift([q.pos[0], q.pos[1], q.pos[2], this.t])
        this.trimTrail(T)
      }
      if (RM) q.rot -= evalMinMax(RM, a, q.r[2]) * dt
      // 依速度旋轉（10-29 補）：這一格實際速率（vel3）照 range 對到 0–1 取曲線，轉速的單位與方向同 rotationOverLife
      if (RS) q.rot -= evalMinMax(RS.curve, speedT(RS.range, Math.hypot(...q.vel3)), q.r[2]) * dt
    }
    // ⚠ 發射放在更新之後（Unity 的順序）：先老化、移除，再補新的——
    //   反過來的話「最多 1 顆」的光暈每輪都會斷一拍、整片閃爍（試作 10-16 修掉的關鍵）
    const E = S.emission
    if (!E || !(S.looping || this.t <= dur)) return
    this.emitAcc += evalMinMax(E.rate, tn, this.rand()) * dt
    const n = Math.floor(this.emitAcc)
    this.emitAcc -= n
    if (n) this.emit(n)
    for (const b of this.bursts) {
      const cycleT = this.t % dur, B = b.burst
      while (this.t >= b.next) {
        if (!B.cycles || b.done < B.cycles) {
          const c = Math.round(evalMinMax(B.count, cycleT / dur, this.rand()))
          if (this.rand() <= B.probability) this.emit(c)
        }
        b.done++
        if (B.interval > 0 && (!B.cycles || b.done < B.cycles)) b.next += B.interval
        else { b.next = Math.ceil((this.t + 1e-6) / dur) * dur + b.time; b.done = 0 }
      }
    }
  }
}
