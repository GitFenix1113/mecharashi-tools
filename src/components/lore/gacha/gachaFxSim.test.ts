import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { evalCurve, evalGradient, evalMinMax, ParticleSim } from './gachaFxSim.ts'
import type { FxSystem, GachaFxData } from './gachaFxTypes.ts'

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

test('站上每一台的卡池動態：跑 10 秒不出現 NaN、貼圖都在 public/images/game/fx/', () => {
  const list = allFx()
  assert.ok(list.length >= 1, '至少有芬里厄（2054）')
  for (const [file, data] of list) {
    assert.equal(data.v, 1, file)
    const tex = new Set([...data.systems.map((s) => s.material.tex), ...data.flows.flatMap((f) => [f.mainTex, f.disturbTex])])
    for (const t of tex) assert.ok(fs.existsSync(texFile(t)), `${file}：缺貼圖 ${t}.png`)
    for (const def of data.systems) {
      const s = new ParticleSim(def, seeded(7))
      for (let i = 0; i < 600; i++) s.update(1 / 60)
      for (const p of s.parts) assert.ok(p.pos.every(Number.isFinite) && Number.isFinite(p.size), `${file} ${def.name}：粒子座標或大小不是有限數`)
    }
  }
})
