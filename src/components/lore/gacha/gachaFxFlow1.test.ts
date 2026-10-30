import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { flow1Uniforms, splitFlows } from './gachaFxFlow1.ts'
import type { FxFlow1, GachaFxData } from './gachaFxTypes.ts'

const FX_DIR = new URL('../../../data/gachaFx/', import.meta.url)
// 機甲（<wap>.json）＋機師（pilots/<gameId>.json）
const allFx = (): [string, GachaFxData][] =>
  [FX_DIR, new URL('pilots/', FX_DIR)].flatMap((dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f): [string, GachaFxData] => [dir === FX_DIR ? f : `pilots/${f}`, JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'))]))

const layer = (over: Partial<FxFlow1> = {}): FxFlow1 => ({ shader: 'flow1', name: 't', pos: [0, 0], size: [100, 100], color: [1, 1, 1, 1], mainValue: 1, ...over })

test('Flow1 的 uniform：全部省略時是恰好恆等的值（旋轉 (1,0)、TO [1,1,0,0]、不擾動、溶解常數 1.1）', () => {
  const u = flow1Uniforms(layer())
  for (const r of [u.mainRot, u.colorRot, u.mask1Rot]) assert.deepEqual(r, [1, 0])
  for (const t of [u.mainTO, u.disturbTO, u.colorST, u.mask1ST, u.mask2ST, u.dissolveST, u.dissolveMaskST]) assert.deepEqual(t, [1, 1, 0, 0])
  for (const v of [u.mainFlow, u.disturbFlow, u.dissolveFlow]) assert.deepEqual(v, [0, 0])
  assert.equal(u.k, 0)
  assert.deepEqual([u.vClamp, u.channelR, u.mask1Rev, u.mask2Rev, u.dissolveRev, u.mask1Soft, u.mask2Soft, u.dissolveSoft], [0, 0, 0, 0, 0, 0, 0, 0])
  // 白貼圖的溶解：(1 × 1 + 1.1 − 0) / 1 → 夾成 1 → smoothstep(1)＝1，等於沒有溶解
  assert.ok(Math.abs(u.dissolveC - 1.1) < 1e-12)
})

test('Flow1 的擾動：往 D 內插 0.1×value；單軸（_ModeCtrl1）時照 _ModeCtrl2 選軸，溶解的單軸固定推 V', () => {
  const to = [1, 1, 0, 0] as [number, number, number, number]
  const two = flow1Uniforms(layer({ disturb: { value: 0.6, flow: [0, -0.7], to } }))
  assert.ok(Math.abs(two.k - 0.06) < 1e-12)
  assert.deepEqual([two.axis, two.dissolveAxis], [[1, 1], [1, 1]])
  const u = flow1Uniforms(layer({ disturb: { value: 0.2, flow: [0, 0], to, axis: 'u' } }))
  assert.deepEqual([u.axis, u.dissolveAxis], [[1, 0], [0, 1]])
  const v = flow1Uniforms(layer({ disturb: { value: 0.2, flow: [0, 0], to, axis: 'v' } }))
  assert.deepEqual([v.axis, v.dissolveAxis], [[0, 1], [0, 1]])
  // 2055 雪鴞 Fire 的負擾動量：往 D 的反方向推
  assert.ok(Math.abs(flow1Uniforms(layer({ disturb: { value: -0.6, flow: [-0.3, -0.06], to: [4, 4, 0, 0] } })).k + 0.06) < 1e-12)
})

test('Flow1 的旋轉與溶解常數照 shader：(cos, sin)、2×(0.55 − 1.05×value)', () => {
  const u = flow1Uniforms(layer({ mainRotate: Math.PI / 2, colorTex: { tex: 'c', rotate: Math.PI } }))
  assert.ok(Math.abs(u.mainRot[0]) < 1e-12 && Math.abs(u.mainRot[1] - 1) < 1e-12)
  assert.ok(Math.abs(u.colorRot[0] + 1) < 1e-12)
  const d = flow1Uniforms(layer({ dissolve: { st: [0.5, 0.5, 0, 0], flow: [0.2, 0.1], maskST: [1, 1, 0, 0], value: 0.479, softness: 0 } }))
  assert.ok(Math.abs(d.dissolveC - 2 * (0.55 - 1.05 * 0.479)) < 1e-12)
  assert.deepEqual([d.dissolveST, d.dissolveFlow], [[0.5, 0.5, 0, 0], [0.2, 0.1]])
})

test('繪製分段：under 的先畫、beforeGroup 的放到那組粒子之前、其餘在粒子之後，段內照資料（階層）順序', () => {
  const xs: { n: string; under?: true; beforeGroup?: number }[] = [
    { n: 'a' }, { n: 'b', under: true }, { n: 'c' }, { n: 'd', under: true }, { n: 'e', beforeGroup: 1 }, { n: 'f', beforeGroup: 1 },
  ]
  const { under, over, before } = splitFlows(xs, (x) => x)
  assert.deepEqual(under.map((x) => x.n), ['b', 'd'])
  assert.deepEqual(over.map((x) => x.n), ['a', 'c'])
  assert.deepEqual(before[1].map((x) => x.n), ['e', 'f'])
  assert.equal(before[0], undefined)
})

test('站上的 Flow1 圖層：打包出來的 uniform 都是有限數', () => {
  for (const [file, data] of allFx()) {
    for (const f of data.flows) {
      if (f.shader !== 'flow1') continue
      const u = flow1Uniforms(f)
      for (const [k, v] of Object.entries(u)) assert.ok((Array.isArray(v) ? v : [v]).every(Number.isFinite), `${file} ${f.name}：${k} 不是有限數`)
    }
  }
})
