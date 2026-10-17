import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { evalCurve, evalGradient, evalMinMax, ParticleSim, uvFrame, uvRect } from './gachaFxSim.ts'
import type { FxSystem, FxUV, GachaFxData } from './gachaFxTypes.ts'

const FX_DIR = new URL('../../../data/gachaFx/', import.meta.url)
const texFile = (name: string) => new URL(`../../../../public/images/game/fx/${name}.png`, import.meta.url)
const allFx = (): [string, GachaFxData][] =>
  fs.readdirSync(FX_DIR).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(fs.readFileSync(new URL(f, FX_DIR), 'utf8')) as GachaFxData])

/** 固定亂數，結果可重現 */
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646

const sys = (over: Partial<FxSystem> = {}): FxSystem => ({
  name: 't', pos: [0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1], order: 0,
  render: { mode: 0, lengthScale: 1, velocityScale: 0, maxSize: 1 },
  material: { tex: 'x', strength: 1, texRotate: 0 },
  duration: 5, looping: true, prewarm: false, simSpeed: 1,
  initial: {
    lifetime: { mode: 0, scalar: 1 }, speed: { mode: 0, scalar: 0 }, size: { mode: 0, scalar: 1 }, maxParticles: 1,
    rotation: { mode: 0, scalar: 0 }, color: { mode: 0, maxColor: [1, 1, 1, 1] }, gravity: { mode: 0, scalar: 0 },
  },
  emission: { rate: { mode: 0, scalar: 1 }, bursts: [] },
  ...over,
})

test('曲線：端點取值、Hermite 內插、無限斜率是階梯、空曲線＝1', () => {
  const k: [number, number, number, number][] = [[0, 0, 0, 1], [1, 1, 1, 0]]
  assert.equal(evalCurve(k, -1), 0)
  assert.equal(evalCurve(k, 2), 1)
  assert.ok(Math.abs(evalCurve(k, 0.5) - 0.5) < 1e-9, '直線斜率 1 的中點')
  assert.equal(evalCurve([[0, 0.3, null, null], [1, 0.9, null, null]], 0.7), 0.3)
  assert.equal(evalCurve([], 0.4), 1)
  assert.equal(evalMinMax({ mode: 1, scalar: 2, maxCurve: k }, 1, 0), 2)
  assert.equal(evalMinMax({ mode: 3, scalar: 6, minScalar: 10 }, 0, 0.25), 9)
})

test('漸層：顏色與透明度各自內插；fixed 不內插', () => {
  const g = { colors: [[0, 0, 0, 0], [1, 1, 0.5, 0]] as [number, number, number, number][], alphas: [[0, 1], [0.5, 0]] as [number, number][] }
  assert.deepEqual(evalGradient(g, 0.5), [0.5, 0.25, 0, 0])
  assert.deepEqual(evalGradient({ ...g, fixed: true }, 0.2), [1, 0.5, 0, 0])
})

test('先老化移除、再發射：上限 1 顆的光暈死掉的那一格就補上，不會斷一拍（試作 10-16 修掉的閃爍）', () => {
  const s = new ParticleSim(sys(), seeded())
  for (let i = 0; i < 12; i++) {
    s.update(1)
    assert.equal(s.parts.length, 1, `第 ${i + 1} 秒`)
  }
})

test('預熱：建構完就已經有粒子（開場不是空的）', () => {
  const s = new ParticleSim(sys({ prewarm: true, initial: { ...sys().initial, maxParticles: 50, lifetime: { mode: 0, scalar: 3 } }, emission: { rate: { mode: 0, scalar: 10 }, bursts: [] } }), seeded())
  assert.ok(s.parts.length >= 25, `${s.parts.length} 顆`)
})

type Shape = NonNullable<FxSystem['shape']>
const box = (over: Partial<Shape> = {}): Shape => ({
  type: 5, radius: 1, thickness: 1, angle: 25, length: 5, randomDir: 0, scale: [1, 2.66, 8.52], rotation: [0, 0, 0], position: [0, 0, 0], ...over,
})
/** 發射 n 顆、速度 2 的粒子 */
const emitBox = (shape: Shape, over: Partial<FxSystem> = {}, n = 400) => {
  const base = sys()
  const s = new ParticleSim(sys({ shape, initial: { ...base.initial, maxParticles: n, speed: { mode: 0, scalar: 2 } }, ...over }), seeded(5))
  s.emit(n)
  return s.parts
}
const close = (a: readonly number[], b: readonly number[], eps = 1e-9) => a.every((x, i) => Math.abs(x - b[i]) < eps)

test('方塊（Box）：發射點落在以原點為中心、邊長＝scale 的方塊裡，而且整個體積都有（不是只在表面）', () => {
  const parts = emitBox(box())
  const half = [0.5, 1.33, 4.26]
  for (const p of parts) assert.ok(p.pos.every((v, i) => Math.abs(v) <= half[i] + 1e-9), `${p.pos} 超出方塊`)
  // 三軸各自分布到兩側；內側一半的小方塊（體積 1/8）也有粒子
  for (let i = 0; i < 3; i++) {
    assert.ok(parts.some((p) => p.pos[i] > half[i] * 0.8) && parts.some((p) => p.pos[i] < -half[i] * 0.8), `第 ${i} 軸沒有散開`)
  }
  const inner = parts.filter((p) => p.pos.every((v, i) => Math.abs(v) < half[i] / 2)).length
  assert.ok(inner > parts.length / 16 && inner < parts.length / 4, `內側 ${inner}／${parts.length} 顆`)
})

test('方塊：初速一律沿形狀的 +z，不吃 scale；scale 某軸是 0 時那一軸壓扁（2053 獵鬥士的 x）', () => {
  for (const p of emitBox(box())) assert.ok(close(p.vel, [0, 0, 2]), `${p.vel}`)
  for (const p of emitBox(box({ scale: [0, 2.66, 8.52] }))) assert.equal(p.pos[0], 0)
  // z 是 0 也一樣朝 +z（方向不吃 scale）
  for (const p of emitBox(box({ scale: [1, 1, 0] }))) assert.ok(p.pos[2] === 0 && close(p.vel, [0, 0, 2]))
})

test('方塊：形狀的旋轉、位移套在方塊與方向上（繞 x 轉 −90° 後 +z 朝上）', () => {
  for (const p of emitBox(box({ scale: [1, 1, 4], rotation: [-90, 0, 0], position: [3, 0, 0] }))) {
    assert.ok(close(p.vel, [0, 2, 0]), `${p.vel}`)
    // 長邊（z 4）轉成 y；位移把中心推到 x 3
    assert.ok(Math.abs(p.pos[0] - 3) <= 0.5 + 1e-9 && Math.abs(p.pos[1]) <= 2 + 1e-9 && Math.abs(p.pos[2]) <= 0.5 + 1e-9, `${p.pos}`)
  }
})

test('方塊：粒子系統節點的旋轉（1052 莫比烏斯X 的灰燼）——長邊在畫面上斜向左下，初速沿長邊', () => {
  // Particle_Ash_01 的 m_LocalRotation：x 軸轉進螢幕深處，y → (0.40, −0.92)、z → (−0.92, −0.40)
  const parts = emitBox(box(), { rot: [-0.69217, -0.14457, 0.69217, -0.14457] })
  for (const p of parts) {
    const d = p.vel.map((v) => v / 2)
    assert.ok(close(d, [-0.916, -0.4, 0], 2e-3), `${d}`)
  }
  // 畫面上（x, y）的散布：沿長邊 ±4.26、沿短邊 ±1.33
  const along = parts.map((p) => -0.916 * p.pos[0] - 0.4 * p.pos[1]), across = parts.map((p) => 0.4 * p.pos[0] - 0.916 * p.pos[1])
  assert.ok(Math.max(...along.map(Math.abs)) > 3.5 && Math.max(...along.map(Math.abs)) <= 4.27)
  assert.ok(Math.max(...across.map(Math.abs)) > 1 && Math.max(...across.map(Math.abs)) <= 1.34)
})

/** Unity 預設的序列幀：整張、依壽命、frameOverTime 是 0→0.9999 的直線 */
const LINEAR = { mode: 1, scalar: 0.9999, maxCurve: [[0, 0, 0, 1], [1, 1, 1, 0]] } as const satisfies FxUV['frameOverTime']
const uv = (over: Partial<FxUV> = {}): FxUV => ({ tilesX: 2, tilesY: 2, animationType: 0, timeMode: 0, frameOverTime: LINEAR, cycles: 1, startFrame: { mode: 0, scalar: 0 }, ...over })
const R0 = [0, 0, 0] as const

test('序列幀（依壽命）：照壽命比例從第 0 格走到最後一格，cycles 讓它轉幾輪', () => {
  assert.deepEqual([0, 0.2, 0.3, 0.6, 0.99].map((age) => uvFrame(uv(), age, 1, R0)), [0, 0, 1, 2, 3])
  // 壽命 2 秒：同樣的年齡走得慢一半
  assert.equal(uvFrame(uv(), 0.99, 2, R0), 1)
  // 兩輪：過半就回到第 0 格
  assert.deepEqual([0.2, 0.45, 0.55, 0.99].map((age) => uvFrame(uv({ cycles: 2 }), age, 1, R0)), [1, 3, 0, 3])
  // 2×8 的閃電：16 格
  assert.equal(uvFrame(uv({ tilesY: 8 }), 0.5, 1, R0), 7)
})

test('序列幀：startFrame 與 frameOverTime 的「兩個常數之間隨機」各用自己的亂數、整顆粒子固定', () => {
  // frameOverTime 隨機常數（43 個系統這樣用：每顆粒子固定一格），r[0]＝0.6 → 0.6×0.9999×4 → 第 2 格
  const pick = uv({ frameOverTime: { mode: 3, minScalar: 0, scalar: 0.9999 } })
  assert.deepEqual([0, 0.5, 0.99].map((age) => uvFrame(pick, age, 1, [0.6, 0, 0])), [2, 2, 2])
  // startFrame 隨機起點：r[1]＝0.6 → 從第 2 格開始，超過一輪從頭
  const start = uv({ startFrame: { mode: 3, minScalar: 0, scalar: 0.9999 } })
  assert.deepEqual([0, 0.3, 0.6].map((age) => uvFrame(start, age, 1, [0, 0.6, 0])), [2, 3, 0])
})

test('序列幀（依 fps）：每秒 fps 格、與壽命無關，startFrame 是正規化值（騰蛇的彈殼 3×2、10 fps）', () => {
  const casing = uv({ tilesX: 3, tilesY: 2, timeMode: 2, fps: 10, frameOverTime: undefined, cycles: undefined, startFrame: { mode: 0, scalar: 0.5 } })
  assert.deepEqual([0, 0.05, 0.15, 0.25, 0.35].map((age) => uvFrame(casing, age, 5, R0)), [3, 3, 4, 5, 0])
  assert.equal(uvFrame(casing, 0.25, 0.5, R0), 5, '壽命不影響')
})

test('序列幀（只播一列）：固定列或每顆隨機一列，格號是整張的編號', () => {
  const row = uv({ animationType: 1, rowMode: 0, rowIndex: 1 })
  assert.deepEqual([0, 0.6].map((age) => uvFrame(row, age, 1, R0)), [2, 3])
  const rand = uv({ animationType: 1, rowMode: 1 })
  assert.equal(uvFrame(rand, 0, 1, [0, 0, 0.3]), 0)
  assert.equal(uvFrame(rand, 0.6, 1, [0, 0, 0.7]), 3)
})

test('序列幀的 UV：第 0 格在左上（Unity UV 原點左下，所以 v 最大）、先橫後直', () => {
  assert.deepEqual(uvRect(uv(), 0), [0, 0.5, 0.5, 1])
  assert.deepEqual(uvRect(uv(), 1), [0.5, 0.5, 1, 1])
  assert.deepEqual(uvRect(uv(), 2), [0, 0, 0.5, 0.5])
  assert.deepEqual(uvRect(uv({ tilesY: 8 }), 3), [0.5, 0.75, 1, 0.875])
})

test('序列幀的亂數只在有序列幀的系統才抽：沒有的系統粒子不帶 uvr、亂數序列不變', () => {
  const plain = new ParticleSim(sys(), seeded(3)), sheet = new ParticleSim(sys({ uv: uv() }), seeded(3))
  plain.update(1); sheet.update(1)
  assert.equal(plain.parts[0].uvr, undefined)
  assert.equal(sheet.parts[0].uvr?.length, 3)
  // 序列幀的亂數接在既有的之後抽：同一顆粒子其他的亂數一模一樣
  assert.deepEqual(sheet.parts[0].r, plain.parts[0].r)
})

test('站上每一台的卡池動態：跑 10 秒不出現 NaN、貼圖都在 public/images/game/fx/', () => {
  const list = allFx()
  assert.ok(list.length >= 1, '至少有芬里厄（2054）')
  for (const [file, data] of list) {
    assert.equal(data.v, 1, file)
    // 流動圖層的擾動圖、遮罩是選填（沒有＝引擎綁 shader 預設的純色）
    const flowTex = data.flows.flatMap((f) => [f.mainTex, f.disturbTex, f.mask?.tex]).filter((t): t is string => !!t)
    const tex = new Set([...data.systems.map((s) => s.material.tex), ...flowTex])
    for (const t of tex) assert.ok(fs.existsSync(texFile(t)), `${file}：缺貼圖 ${t}.png`)
    for (const def of data.systems) {
      const s = new ParticleSim(def, seeded(7))
      for (let i = 0; i < 600; i++) s.update(1 / 60)
      for (const p of s.parts) assert.ok(p.pos.every(Number.isFinite) && Number.isFinite(p.size), `${file} ${def.name}：粒子座標或大小不是有限數`)
      if (def.uv) for (const p of s.parts) {
        const k = uvFrame(def.uv, p.age, p.life, p.uvr!)
        assert.ok(Number.isInteger(k) && k >= 0 && k < def.uv.tilesX * def.uv.tilesY, `${file} ${def.name}：序列幀格號 ${k} 超出範圍`)
      }
    }
  }
})
