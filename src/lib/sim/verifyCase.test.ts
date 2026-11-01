import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { SimRequestV1, SimResponseV1, SimResultV1 } from './contract.ts'
import {
  buildCaseFile, caseFileName, compareJob, emptyMeasure, getAtPointer, hasMismatch, parseHitLog,
  SIM_CASE_KIND, summarizeHits, toPointer,
} from './verifyCase.ts'
import { buildSourceNameIndex, REASON_LABEL, sourceLabel, SOURCE_KIND_LABEL } from './sourceNames.ts'
import type { Pilot, PilotSkillDoc, Weapon } from '../../types/index.ts'

describe('parseHitLog', () => {
  it('一般、暴擊、未命中與部位前綴', () => {
    const { hits, errors } = parseHitLog('1234 1500! 980*\nx 體:1200 左:miss 右:1300！ 腿:閃')
    assert.deepEqual(errors, [])
    assert.deepEqual(hits, [
      { damage: 1234, crit: false },
      { damage: 1500, crit: true },
      { damage: 980, crit: true },
      { damage: null, crit: false },
      { damage: 1200, crit: false, part: 'body' },
      { damage: null, crit: false, part: 'larm' },
      { damage: 1300, crit: true, part: 'rarm' },
      { damage: null, crit: false, part: 'leg' },
    ])
  })

  it('英文部位鍵、全形冒號、逗號分隔', () => {
    const { hits } = parseHitLog('body:10, larm：20、leg:30')
    assert.deepEqual(hits.map((h) => h.part), ['body', 'larm', 'leg'])
  })

  it('認不得的記號列進 errors、不默默丟掉', () => {
    const { hits, errors } = parseHitLog('1,234 abc 頭:100 12a')
    // 1,234 被逗號拆成 1 與 234（不支援千分位，文件已註明）
    assert.deepEqual(hits.map((h) => h.damage), [1, 234])
    assert.deepEqual(errors, ['abc', '頭:100', '12a'])
  })

  it('空輸入', () => {
    assert.deepEqual(parseHitLog('  \n '), { hits: [], errors: [] })
  })
})

describe('summarizeHits', () => {
  it('命中率以出手數為分母、暴擊率以命中數為分母', () => {
    const s = summarizeHits(parseHitLog('100 200! x 體:300 體:400!').hits)
    assert.equal(s.attempts, 5)
    assert.equal(s.landed, 4)
    assert.equal(s.crits, 2)
    assert.equal(s.hitRate, 0.8)
    assert.equal(s.critRate, 0.5)
    assert.equal(s.meanLanded, 250)
    assert.equal(s.meanNonCrit, 200)
    assert.equal(s.meanCrit, 300)
    assert.deepEqual(s.byPart, { body: 2 })
  })

  it('全部未命中', () => {
    const s = summarizeHits(parseHitLog('x x').hits)
    assert.equal(s.hitRate, 0)
    assert.equal(s.critRate, null)
    assert.equal(s.meanLanded, null)
  })
})

describe('JSON Pointer', () => {
  const doc = { a: { 'b/c': [10, { '~d': 5 }] }, z: 0 }
  it('來回轉換與跳脫', () => {
    const p = toPointer(['a', 'b/c', 1, '~d'])
    assert.equal(p, '/a/b~1c/1/~0d')
    assert.equal(getAtPointer(doc, p), 5)
    assert.equal(getAtPointer(doc, '/z'), 0)
    assert.equal(getAtPointer(doc, ''), doc)
  })
  it('不存在的路徑回 undefined', () => {
    assert.equal(getAtPointer(doc, '/a/x'), undefined)
    assert.equal(getAtPointer(doc, '/a/b~1c/9'), undefined)
    assert.equal(getAtPointer(doc, '/a/b~1c/01'), undefined)
    assert.equal(getAtPointer(doc, 'a'), undefined)
    assert.equal(getAtPointer(undefined, '/a'), undefined)
    assert.equal(getAtPointer({ toString: 1 }, '/constructor'), undefined)
  })
})

const result = (over: Partial<SimResultV1> = {}): SimResultV1 => ({
  job: 0,
  status: 'partial',
  L0: {
    perAction: { mean: 9000 },
    segments: [{ stage: '首擊', occurProb: 1, hits: 6, expected: 9000, perHitMean: 1600, hitRate: 0.9375, critRate: 0.25 }],
    approx: true,
    badge: 'approx',
  },
  L2: { parts: { body: { nonCrit: 1500.4 } } },
  switches: [],
  derived: { panel: {} },
  warnings: [],
  ...over,
})

describe('compareJob', () => {
  it('預覽四項：擊數要完全相同、機率 ±1 個百分點、單擊 ±1（取 L2 指定路徑）', () => {
    const rows = compareJob(result(), {
      preview: { perHit: 1501, hits: 6, hitPct: 94, critPct: 27 },
      hitLog: '',
      perHitPointer: '/parts/body/nonCrit',
    })
    const by = Object.fromEntries(rows.map((r) => [r.key, r]))
    assert.equal(by.previewPerHit.predicted, 1500.4)
    assert.equal(by.previewPerHit.ok, true)
    assert.equal(by.previewHits.ok, true)
    assert.ok(Math.abs(by.previewHit.diff - 0.25) < 1e-9)
    assert.equal(by.previewHit.ok, true)
    assert.equal(by.previewCrit.ok, false)
    assert.equal(hasMismatch(rows), true)
  })

  it('沒指定 L2 路徑就不比對預覽單擊；路徑取到的不是數字也不比對', () => {
    assert.equal(compareJob(result(), { preview: { perHit: 1500 }, hitLog: '' }).length, 0)
    assert.equal(compareJob(result(), { preview: { perHit: 1500 }, hitLog: '', perHitPointer: '/parts' }).length, 0)
    assert.equal(compareJob(result({ L2: undefined }), { preview: { perHit: 1500 }, hitLog: '', perHitPointer: '/parts/body/nonCrit' }).length, 0)
  })

  it('實際跳字只列參考（ok 為 null）', () => {
    const rows = compareJob(result(), { preview: {}, hitLog: '1500 1700! x 1600' })
    assert.deepEqual(rows.map((r) => r.key), ['actualMean', 'actualHit', 'actualCrit'])
    assert.ok(rows.every((r) => r.ok === null))
    assert.equal(rows[0].measured, 1600)
    assert.equal(rows[0].diff, 0)
    assert.equal(rows[1].note, '3／4')
    assert.equal(hasMismatch(rows), false)
  })

  it('沒有 L0（unsupported）時只剩 L2 的單擊比對', () => {
    const rows = compareJob(result({ status: 'unsupported', L0: undefined }), { preview: { hits: 6 }, hitLog: '100' })
    assert.equal(rows.length, 0)
  })
})

describe('buildCaseFile', () => {
  const request = {
    v: 1, locale: 'zh-TW', mode: 'single', loadouts: [], targets: [], scenarios: [],
    jobs: [{ l: 0, t: 0, s: 0, action: { weaponKey: 'm-rh', skill: 'default' } }, { l: 0, t: 0, s: 0, action: { weaponKey: 'm-lh', skill: 'default' } }],
    output: { level: 'L2' },
  } as unknown as SimRequestV1
  const response = {
    contract: 'v1', engineVersion: '0.1.0', dataVersion: 'cn376', buildNum: '7', overridesVersion: 'o1', flagsDigest: 'f0',
    limits: {}, budget: { units: 2, max: 2000 }, results: [result(), result({ job: 1, L2: undefined })],
  } as unknown as SimResponseV1

  it('版本、管理者旗標、實測與 job 同序（缺的補空白）', () => {
    const f = buildCaseFile({
      createdAt: new Date('2026-11-01T05:06:07Z'),
      title: '  18-1 黛博拉  ',
      note: '',
      shareCode: 'ABC',
      context: { pilot: '海莉絲', mech: 'X', target: '18-1', weapons: { 'm-rh': '槍' } },
      request,
      response,
      measures: [{ preview: { hits: 6 }, hitLog: '100 x' }],
    })
    assert.equal(f.kind, SIM_CASE_KIND)
    assert.equal(f.v, 1)
    assert.equal(f.createdAt, '2026-11-01T05:06:07.000Z')
    assert.equal(f.title, '18-1 黛博拉')
    assert.deepEqual(f.source, { shareCode: 'ABC' })
    assert.deepEqual(f.engine, { engineVersion: '0.1.0', dataVersion: 'cn376', buildNum: '7', overridesVersion: 'o1', flagsDigest: 'f0' })
    assert.equal(f.admin, true)
    assert.equal(f.measurements.length, 2)
    assert.deepEqual(f.measurements[0].hits, [{ damage: 100, crit: false }, { damage: null, crit: false }])
    assert.deepEqual(f.measurements[1], { ...emptyMeasure(), job: 1, hits: [] })
    // 不能夾帶任何登入憑證
    assert.ok(!JSON.stringify(f).toLowerCase().includes('bearer'))
  })

  it('沒有 L2 時 admin 為 false', () => {
    const f = buildCaseFile({
      createdAt: new Date(), title: '', note: '', context: { pilot: '', mech: '', target: '', weapons: {} },
      request, response: { ...response, results: [result({ L2: undefined })] }, measures: [],
    })
    assert.equal(f.admin, false)
    assert.deepEqual(f.source, {})
  })

  it('檔名：本地日期＋安全字元', () => {
    const d = new Date(2026, 10, 1, 23, 59)
    assert.equal(caseFileName(d, '18-1 海莉絲/右手'), 'sim-case_2026-11-01_18-1_海莉絲_右手.json')
    assert.equal(caseFileName(d, ''), 'sim-case_2026-11-01.json')
  })
})

describe('sourceLabel', () => {
  const idx = buildSourceNameIndex({
    pilots: [{ id: 'p1', name: '海莉絲', gameRef: { pilotInfoId: 101 } } as unknown as Pilot],
    weapons: [{ id: 'w1', name: '碎狼牙', gameRef: { weaponInfoId: 500 } } as unknown as Weapon],
    pilotSkills: [{ id: 's1', name: '星爆', gameRef: { passiveSkillIds: [500, 600] } } as unknown as PilotSkillDoc],
  })

  it('查得到：種類＋名稱；同一個 ID 對到多個集合時依種類挑', () => {
    assert.equal(sourceLabel({ kind: 'pilotTpl', id: 101, owner: 'atk' }, idx), '機師〈海莉絲〉')
    assert.equal(sourceLabel({ kind: 'weapon', id: 500, owner: 'atk', slot: 'm-rh' }, idx), '武器〈碎狼牙〉（m-rh）')
    assert.equal(sourceLabel({ kind: 'weaponPassive', id: 500, owner: 'atk' }, idx), '武器被動〈星爆〉')
    assert.equal(sourceLabel({ kind: 'talent', id: 600, owner: 'atk', level: 3 }, idx), '天賦〈星爆〉 Lv.3')
  })

  it('查不到：種類＋ID；有歧義又沒有偏好時不猜', () => {
    assert.equal(sourceLabel({ kind: 'research', id: 9, owner: 'atk' }, idx), '科研 #9')
    assert.equal(sourceLabel({ kind: 'mapGlobal', id: 500, owner: 'def' }, idx), '地圖效果 #500')
  })

  it('每個種類與原因碼都有中文說明', () => {
    for (const v of Object.values(SOURCE_KIND_LABEL)) assert.ok(v.length > 0)
    for (const v of Object.values(REASON_LABEL)) assert.ok(v.length > 0)
  })
})
