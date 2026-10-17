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

/**
 * 粒子現在是第幾格（0 起算，整張的編號：左上第 0 格、先橫後直）。照 Unity：
 *   依壽命：startFrame ＋ frameOverTime(年齡÷壽命) × cycles
 *   依 fps ：startFrame ＋ 年齡 × fps ÷ 幀數（cycles 只對依壽命有意義）
 * 取小數部分（超過一輪就從頭）× 幀數、無條件捨去。只播一列時再加上列的偏移。
 * r＝粒子固定的亂數：[frameOverTime, startFrame, 隨機列]
 */
export function uvFrame(uv: FxUV, age: number, life: number, r: readonly [number, number, number]): number {
  const n = uvFrameCount(uv)
  const t = uv.timeMode === 2 ? (age * (uv.fps ?? 0)) / n : evalMinMax(uv.frameOverTime, age / life, r[0]) * (uv.cycles ?? 1)
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
}

export class ParticleSim {
  readonly sys: FxSystem
  readonly parts: Particle[] = []
  t = 0
  private emitAcc = 0
  private readonly bursts: { time: number; next: number; done: number; burst: FxBurst }[]
  private readonly rand: Rand
  private readonly perlin: (x: number, y: number, z: number) => number

  constructor(sys: FxSystem, rand: Rand = Math.random, perlin = makePerlin(rand)) {
    this.sys = sys
    this.rand = rand
    this.perlin = perlin
    this.bursts = (sys.emission?.bursts ?? []).map((b) => ({ time: b.time, next: b.time, done: 0, burst: b }))
    // 預熱：開場就是「已經跑了一輪」的樣子
    if (sys.prewarm) for (let i = 0; i < Math.ceil(sys.duration * 30); i++) this.update(1 / 30)
  }

  emit(n: number): void {
    const S = this.sys, I = S.initial, sh = S.shape, R = this.rand
    const tn = (this.t % S.duration) / S.duration
    for (let k = 0; k < n; k++) {
      if (this.parts.length >= I.maxParticles) return
      const life = evalMinMax(I.lifetime, tn, R()), speed = evalMinMax(I.speed, tn, R())
      const size = evalMinMax(I.size, tn, R())
      const sizeY = I.sizeY ? evalMinMax(I.sizeY, tn, R()) || size : size
      // 形狀：0 球、4 圓錐、5 方塊、8 圓錐體積（其餘當點）
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
      // 粒子系統本身的旋轉與縮放（Local scaling）
      const sc = S.scale
      lp = rotQuat([lp[0] * sc[0], lp[1] * sc[1], lp[2] * sc[2]], S.rot)
      dir = rotQuat(dir, S.rot)
      const vel: Vec3 = [dir[0] * speed, dir[1] * speed, dir[2] * speed]
      this.parts.push({
        pos: lp, vel, vel3: [...vel], age: 0, life: Math.max(life, 1e-3),
        size: size * sc[0], sizeY: sizeY * sc[1], rot: -evalMinMax(I.rotation, tn, R()),
        col: evalMinMaxGradient(I.color, tn, R()), r: [R(), R(), R(), R(), R()],
        ...(S.uv ? { uvr: [R(), R(), R()] as [number, number, number] } : {}),
      })
    }
  }

  update(dt: number): void {
    const S = this.sys
    dt *= S.simSpeed || 1
    this.t += dt
    const dur = S.duration, tn = (this.t % dur) / dur
    const V = S.velocity, F = S.force, L = S.clamp, N = S.noise, RM = S.rotationOverLife
    const grav = evalMinMax(S.initial.gravity, tn, 0.5) * 9.81
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i]
      q.age += dt
      if (q.age >= q.life) { this.parts.splice(i, 1); continue }
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
      q.vel3 = [q.vel[0] + ext[0] + nz[0], q.vel[1] + ext[1] + nz[1], q.vel[2] + ext[2] + nz[2]]
      q.pos = [q.pos[0] + q.vel3[0] * dt, q.pos[1] + q.vel3[1] * dt, q.pos[2] + q.vel3[2] * dt]
      if (RM) q.rot -= evalMinMax(RM, a, q.r[2]) * dt
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
