// 遊戲身分鍵回填（scripts/backfill-game-join-keys.mjs）的規則測試：決定動作、diff、統計、還原、結構漂移。
// 測試裡的 ID 都是假的；這支腳本不管對照怎麼算（那在私有 repo），只管「建議 × 站上現值 → 寫不寫」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decideAction, planBackfill, buildDiff, summarize, totals, compareDeclaredSummary, planRollback,
  validateGameRef, itemProblems, canonicalGameRef, sameGameRef, parseAcceptFile, checkProposalsFile,
  nextSteps, headlineOf, renderReport,
  GAME_REF_FIELDS, GAME_REF_TYPE_NAMES, COLLECTIONS, PROPOSALS_SCHEMA,
} from './backfill-game-join-keys.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const item = (over = {}) => ({ collection: 'pilots', docId: 'pilot_001_甲', siteName: '甲', status: 'unique', gameRef: { pilotInfoId: 101 }, evidence: '測試', ...over })
const doc = (gameRef, name = '甲') => ({ name, gameRef })
const site = (entries) => {
  const out = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]))
  for (const [key, d] of Object.entries(entries)) {
    const [c, id] = key.split('/')
    out[c].set(id, d)
  }
  return out
}

// ─── decideAction ────────────────────────────────────────────────────────────

test('unique＋站上沒有 → 寫入（寫正規化後的值）', () => {
  const d = decideAction(item(), doc(undefined))
  assert.equal(d.action, 'write')
  assert.equal(d.before, null)
  assert.deepEqual(d.after, { pilotInfoId: 101 })
})

test('站上已有相同 gameRef → 略過（鍵順序、陣列順序與重複都不算差異）', () => {
  assert.equal(decideAction(item(), doc({ pilotInfoId: 101 })).action, 'same')
  const sk = item({ collection: 'pilotSkills', docId: 'SKILL_甲', gameRef: { passiveSkillIds: [3, 1], mainSkillIds: [9] } })
  assert.equal(decideAction(sk, doc({ mainSkillIds: [9], passiveSkillIds: [1, 3, 3] })).action, 'same')
})

test('站上已有不同 gameRef → 衝突、不寫，報告帶出兩邊的值', () => {
  const d = decideAction(item(), doc({ pilotInfoId: 999 }))
  assert.equal(d.action, 'conflict')
  assert.deepEqual(d.before, { pilotInfoId: 999 })
  assert.deepEqual(d.after, { pilotInfoId: 101 })
  // 多一個選填欄位也算不同（不做部分合併）
  const m = item({ collection: 'modules', docId: 'mod_1', gameRef: { entryId: 5, itemId: 7 } })
  assert.equal(decideAction(m, doc({ entryId: 5 })).action, 'conflict')
})

test('站上找不到文件 → missingDoc，任何分類都一樣', () => {
  for (const status of ['unique', 'needsConfirm', 'unmatched']) {
    const it = status === 'unmatched' ? item({ status, gameRef: undefined }) : item({ status })
    assert.equal(decideAction(it, undefined).action, 'missingDoc')
  }
})

test('equivalent：沒加 --accept-equivalent 不寫；加了才寫', () => {
  const it = item({ status: 'equivalent', alternatives: [{ gameRef: { pilotInfoId: 102 }, label: '另一筆' }] })
  assert.equal(decideAction(it, doc(undefined)).action, 'holdEquivalent')
  assert.equal(decideAction(it, doc(undefined), { acceptEquivalent: true }).action, 'write')
  // accept 檔對 equivalent 沒有作用（C14 是整批裁決）
  assert.equal(decideAction(it, doc(undefined), { accepted: new Set(['pilots/pilot_001_甲']) }).action, 'holdEquivalent')
})

test('needsConfirm：沒列在 accept 檔不寫；列了才寫', () => {
  const it = item({ status: 'needsConfirm' })
  assert.equal(decideAction(it, doc(undefined)).action, 'holdConfirm')
  assert.equal(decideAction(it, doc(undefined), { accepted: new Set(['pilots/別人']) }).action, 'holdConfirm')
  assert.equal(decideAction(it, doc(undefined), { accepted: new Set(['pilots/pilot_001_甲']) }).action, 'write')
})

test('已寫過的待確認／等價，重跑時不帶 accept 也是「已相同」（照抄清單才會全 ✅）', () => {
  assert.equal(decideAction(item({ status: 'needsConfirm' }), doc({ pilotInfoId: 101 })).action, 'same')
  const eq = item({ status: 'equivalent', alternatives: [{ gameRef: { pilotInfoId: 102 } }] })
  assert.equal(decideAction(eq, doc({ pilotInfoId: 101 })).action, 'same')
  // 但站上值不同時，就算接受了也是衝突
  assert.equal(decideAction(item({ status: 'needsConfirm' }), doc({ pilotInfoId: 5 }), { accepted: new Set(['pilots/pilot_001_甲']) }).action, 'conflict')
})

test('unmatched／notApplicable → 不寫；站上已有值時附註提醒', () => {
  const um = item({ status: 'unmatched', gameRef: undefined })
  assert.equal(decideAction(um, doc(undefined)).action, 'unmatched')
  assert.equal(decideAction(um, doc(undefined)).reason, '')
  assert.match(decideAction(um, doc({ pilotInfoId: 1 })).reason, /站上已有/)
  const na = item({ collection: 'pilotSkills', docId: 'SKILL_乙', status: 'notApplicable', gameRef: undefined })
  assert.equal(decideAction(na, doc(undefined)).action, 'notApplicable')
})

test('格式不對的建議 → invalid，絕不寫（即使站上沒有值）', () => {
  assert.equal(decideAction(item({ gameRef: { pilotInfoId: '101' } }), doc(undefined)).action, 'invalid')
  assert.equal(decideAction(item({ gameRef: undefined }), doc(undefined)).action, 'invalid')
  assert.equal(decideAction(item({ status: 'unmatched' }), doc(undefined)).action, 'invalid')  // unmatched 不該帶 gameRef
  assert.equal(decideAction(item({ status: 'maybe' }), doc(undefined)).action, 'invalid')
  assert.equal(decideAction(item({ collection: 'buffs' }), doc(undefined)).action, 'invalid')
  assert.equal(decideAction(item({ status: 'equivalent' }), doc(undefined), { acceptEquivalent: true }).action, 'invalid')  // 等價卻沒列其餘
})

test('站上的空物件 gameRef 視同沒有', () => {
  assert.equal(decideAction(item(), doc({})).action, 'write')
  assert.equal(decideAction(item(), doc(null)).action, 'write')
})

// ─── 結構檢查 ────────────────────────────────────────────────────────────────

test('validateGameRef：必填、選填、陣列、多餘欄位', () => {
  assert.deepEqual(validateGameRef('modules', { entryId: 1 }), [])
  assert.deepEqual(validateGameRef('modules', { entryId: 1, itemId: 2 }), [])
  assert.ok(validateGameRef('modules', { itemId: 2 }).some((p) => p.includes('entryId')))
  assert.ok(validateGameRef('weapons', { weaponInfoId: 1, extra: 2 }).some((p) => p.includes('extra')))
  assert.ok(validateGameRef('weapons', { weaponInfoId: 1.5 }).length)
  assert.ok(validateGameRef('weapons', { weaponInfoId: 0 }).length)
  assert.deepEqual(validateGameRef('pilotSkills', { activeSkillIds: [1] }), [])
  assert.ok(validateGameRef('pilotSkills', {}).length, '技能文件至少要有一個陣列')
  assert.ok(validateGameRef('pilotSkills', { mainSkillIds: [] }).length, '空陣列不算')
  assert.ok(validateGameRef('pilotSkills', { mainSkillIds: [1, '2'] }).length)
  assert.ok(validateGameRef('forms', null).length)
})

test('itemProblems：alternatives 也檢查結構', () => {
  assert.deepEqual(itemProblems(item({ alternatives: [{ gameRef: { pilotInfoId: 2 }, label: 'x' }] })), [])
  assert.ok(itemProblems(item({ alternatives: [{ gameRef: { suitId: 2 } }] })).length)
  assert.ok(itemProblems(item({ docId: 'a/b' })).length)
})

test('canonicalGameRef／sameGameRef', () => {
  assert.deepEqual(canonicalGameRef({ b: [3, 1, 3], a: 1, c: undefined }), { a: 1, b: [1, 3] })
  assert.equal(canonicalGameRef({}), null)
  assert.ok(sameGameRef(undefined, null))
  assert.ok(sameGameRef({}, undefined))
  assert.ok(!sameGameRef({ a: 1 }, { a: 2 }))
})

test('parseAcceptFile：格式與集合名稱都要對', () => {
  assert.deepEqual([...parseAcceptFile({ accept: ['pilots/pilot_049_海莉絲', 'weapons/w_1'] })], ['pilots/pilot_049_海莉絲', 'weapons/w_1'])
  assert.throws(() => parseAcceptFile(['pilots/x']))
  assert.throws(() => parseAcceptFile({ accept: ['pilot_049'] }))
  assert.throws(() => parseAcceptFile({ accept: ['buffs/x'] }))
  assert.throws(() => parseAcceptFile({ accept: ['pilots/'] }))
})

test('checkProposalsFile：schema 不對直接丟錯；缺欄位只提醒', () => {
  assert.throws(() => checkProposalsFile({ schema: 'gameref-proposals/v2', items: [] }))
  assert.throws(() => checkProposalsFile({ schema: PROPOSALS_SCHEMA }))
  assert.deepEqual(checkProposalsFile({ schema: PROPOSALS_SCHEMA, items: [], generatedAt: 'x', dataPackage: { buildNum: 'b' }, summary: {} }), [])
  assert.equal(checkProposalsFile({ schema: PROPOSALS_SCHEMA, items: [] }).length, 3)
})

// ─── planBackfill／buildDiff／summarize ───────────────────────────────────────

function fixture() {
  const proposals = {
    schema: PROPOSALS_SCHEMA,
    items: [
      item(),                                                                                  // 寫入
      item({ docId: 'pilot_002_乙', siteName: '乙', gameRef: { pilotInfoId: 102 } }),           // 已相同
      item({ docId: 'pilot_003_丙', siteName: '丙', gameRef: { pilotInfoId: 103 } }),           // 衝突
      item({ docId: 'pilot_004_丁', siteName: '丁', status: 'needsConfirm', gameRef: { pilotInfoId: 104 } }),  // 待確認未接受
      item({ docId: 'pilot_005_戊', siteName: '戊', status: 'needsConfirm', gameRef: { pilotInfoId: 105 } }),  // 待確認已接受
      item({ docId: 'pilot_999_幽靈', siteName: '幽靈', gameRef: { pilotInfoId: 199 } }),      // 站上找不到
      item({ collection: 'weapons', docId: 'weapon_001_刀', siteName: '刀', status: 'equivalent', gameRef: { weaponInfoId: 11 }, alternatives: [{ gameRef: { weaponInfoId: 12 }, label: '同參數' }] }),
      item({ collection: 'weapons', docId: 'weapon_002_槍', siteName: '舊名', gameRef: { weaponInfoId: 21 } }),  // 寫入（名稱不同）
      item({ collection: 'modules', docId: 'mod_1', siteName: '模', status: 'unmatched', gameRef: undefined }),
      item({ collection: 'pilotSkills', docId: 'SKILL_甲', siteName: '技', status: 'notApplicable', gameRef: undefined }),
      item({ collection: 'mechs', docId: 'mech_001_甲', siteName: '機', gameRef: { suitId: 'x' } }),  // 格式不對
      item({ collection: 'forms', docId: 'form_1', siteName: '形', gameRef: { passiveSkillId: 1 } }),  // 重複
      item({ collection: 'forms', docId: 'form_1', siteName: '形', gameRef: { passiveSkillId: 2 } }),
    ],
  }
  const s = site({
    'pilots/pilot_001_甲': doc(undefined, '甲'),
    'pilots/pilot_002_乙': doc({ pilotInfoId: 102 }, '乙'),
    'pilots/pilot_003_丙': doc({ pilotInfoId: 333 }, '丙'),
    'pilots/pilot_004_丁': doc(undefined, '丁'),
    'pilots/pilot_005_戊': doc(undefined, '戊'),
    'pilots/pilot_006_己': doc(undefined, '己'),                // 站上有、建議檔沒列
    'pilots/pilot_007_庚': doc({ pilotInfoId: 7 }, '庚'),      // 站上有、建議檔沒列、但已有值
    'weapons/weapon_001_刀': doc(undefined, '刀'),
    'weapons/weapon_002_槍': doc(undefined, '新名'),
    'modules/mod_1': doc(undefined, '模'),
    'pilotSkills/SKILL_甲': doc(undefined, '技'),
    'mechs/mech_001_甲': doc(undefined, '機'),
    'forms/form_1': doc(undefined, '形'),
  })
  return { proposals, site: s }
}

test('planBackfill：每筆動作、重複條目、accept 沒作用、未列入建議檔', () => {
  const { proposals, site: s } = fixture()
  const accepted = new Set(['pilots/pilot_005_戊', 'pilots/pilot_001_甲', 'pilots/打錯'])
  const p = planBackfill({ proposals, site: s, accepted })
  const act = Object.fromEntries(p.rows.map((r) => [`${r.key}#${r.index}`, r.action]))
  assert.deepEqual(act, {
    'pilots/pilot_001_甲#0': 'write',
    'pilots/pilot_002_乙#1': 'same',
    'pilots/pilot_003_丙#2': 'conflict',
    'pilots/pilot_004_丁#3': 'holdConfirm',
    'pilots/pilot_005_戊#4': 'write',
    'pilots/pilot_999_幽靈#5': 'missingDoc',
    'weapons/weapon_001_刀#6': 'holdEquivalent',
    'weapons/weapon_002_槍#7': 'write',
    'modules/mod_1#8': 'unmatched',
    'pilotSkills/SKILL_甲#9': 'notApplicable',
    'mechs/mech_001_甲#10': 'invalid',
    'forms/form_1#11': 'invalid',
    'forms/form_1#12': 'invalid',
  })
  assert.match(p.rows[11].reason, /不只一次/)
  assert.ok(p.rows[7].nameDiffers)
  assert.equal(p.rows[7].siteName, '新名')
  assert.deepEqual(p.unusedAccept.map((x) => x.key).sort(), ['pilots/pilot_001_甲', 'pilots/打錯'])
  assert.deepEqual(p.uncovered.pilots, [
    { docId: 'pilot_006_己', name: '己', hasGameRef: false },
    { docId: 'pilot_007_庚', name: '庚', hasGameRef: true },
  ])
  assert.equal(p.uncovered.weapons, undefined)
})

test('buildDiff：只收「寫入」，依集合分組、文件排序；寫入前一律是空', () => {
  const { proposals, site: s } = fixture()
  const p = planBackfill({ proposals, site: s, accepted: new Set(['pilots/pilot_005_戊']), acceptEquivalent: true })
  const d = buildDiff(p.rows)
  assert.deepEqual(d.collections, ['pilots', 'weapons'])
  assert.deepEqual(d.byCollection.pilots.map((e) => e.docId), ['pilot_001_甲', 'pilot_005_戊'])
  assert.deepEqual(d.byCollection.weapons.map((e) => [e.docId, e.after]), [['weapon_001_刀', { weaponInfoId: 11 }], ['weapon_002_槍', { weaponInfoId: 21 }]])
  assert.equal(d.total, 4)
  assert.ok(d.entries.every((e) => e.before === null))
})

test('summarize／totals：分類筆數與動作筆數', () => {
  const { proposals, site: s } = fixture()
  const stats = summarize(planBackfill({ proposals, site: s }).rows)
  assert.deepEqual(
    { total: stats.pilots.total, unique: stats.pilots.unique, needsConfirm: stats.pilots.needsConfirm },
    { total: 6, unique: 4, needsConfirm: 2 },
  )
  assert.equal(stats.pilots.actions.write, 1)
  assert.equal(stats.pilots.actions.holdConfirm, 2)
  assert.equal(stats.pilots.actions.conflict, 1)
  assert.equal(stats.pilots.actions.missingDoc, 1)
  assert.equal(stats.weapons.equivalent, 1)
  assert.equal(stats.forms.actions.invalid, 2)
  const t = totals(stats)
  assert.equal(t.total, 13)
  assert.equal(t.actions.write, 2)
  assert.equal(Object.values(t.actions).reduce((a, b) => a + b, 0), 13)
})

test('compareDeclaredSummary：建議檔自己宣告的統計對不上就列出來', () => {
  const { proposals, site: s } = fixture()
  const stats = summarize(planBackfill({ proposals, site: s }).rows)
  assert.deepEqual(compareDeclaredSummary(undefined, stats), [])
  const ok = Object.fromEntries(Object.entries(stats).map(([c, v]) => [c, { total: v.total, unique: v.unique, equivalent: v.equivalent, needsConfirm: v.needsConfirm, unmatched: v.unmatched, notApplicable: v.notApplicable }]))
  assert.deepEqual(compareDeclaredSummary(ok, stats), [])
  const bad = { ...ok, pilots: { ...ok.pilots, unique: 99 }, components: { total: 3 } }
  const m = compareDeclaredSummary(bad, stats)
  assert.ok(m.some((x) => x.startsWith('pilots.unique')))
  assert.ok(m.some((x) => x.startsWith('components.total')))
})

// ─── 報告 ────────────────────────────────────────────────────────────────────

function model(over = {}) {
  const { proposals, site: s } = fixture()
  const p = planBackfill({ proposals, site: s })
  const stats = summarize(p.rows)
  const m = {
    meta: { today: '2026-10-28', reportAt: 'x', proposalsPath: 'p.json', modeLabel: 'dry-run', siteSourceLabel: 'backup', acceptEquivalent: false },
    mode: 'firestore', stats, tot: totals(stats), rows: p.rows, diff: buildDiff(p.rows),
    unusedAccept: p.unusedAccept, uncovered: p.uncovered, uncoveredMissing: 1, nameMismatch: 1,
    summaryMismatch: [], fileWarnings: [], writeResult: null, acceptedList: [],
    cmd: { acceptPath: 'accept.json', dryRun: 'node x', write: 'node x --write', rollback: '' },
    ...over,
  }
  m.headline = headlineOf(m)
  return m
}

test('照抄清單：有待處理時是 ⬜，全部處理完才 ✅', () => {
  const steps = nextSteps(model())
  assert.ok(steps.some((s) => !s.ok && s.text.includes('待確認')))
  assert.ok(steps.some((s) => !s.ok && s.text.includes('衝突')))
  assert.ok(steps.some((s) => s.cmd === 'node x --write'))
  assert.ok(steps.some((s) => s.text.includes('重新整理後台')), '有要寫的就要提醒管理者重新整理')
  assert.equal(steps.at(-2).ok, false, '重跑確認那一步不能先打勾')

  // 全部處理完：沒有要寫、沒有分歧 → 除了「未連結」那一項（不擋）之外全 ✅
  const clean = { action: 'same', item: { collection: 'pilots', docId: 'a', status: 'unique' }, key: 'pilots/a', before: { pilotInfoId: 1 }, after: { pilotInfoId: 1 } }
  const stats = summarize([clean])
  const done = nextSteps(model({ rows: [clean], stats, tot: totals(stats), diff: buildDiff([clean]), unusedAccept: [], uncoveredMissing: 0, nameMismatch: 0 }))
  assert.ok(done.every((s) => s.ok), done.filter((s) => !s.ok).map((s) => s.text).join('／'))
})

test('照抄清單：離線試跑一定提醒改讀正式庫再跑一次', () => {
  const steps = nextSteps(model({ mode: 'backup' }))
  assert.ok(steps.some((s) => !s.ok && s.text.includes('--from-backup')))
})

test('照抄清單：寫入後顯示備份夾與 bump 結果', () => {
  const m = model()
  const writeResult = { backupDir: '_local-notes/db-backup-x_gameref', written: m.diff.entries, skipped: [], error: null, bump: { version: 'v', collections: ['pilots', 'weapons'], verified: true, failed: [] } }
  const steps = nextSteps({ ...m, writeResult })
  assert.ok(steps.some((s) => s.ok && s.text.includes('db-backup-x_gameref')))
  assert.ok(steps.some((s) => s.ok && s.text.includes('versions.pilots')))
  const failed = nextSteps({ ...m, writeResult: { ...writeResult, bump: { ...writeResult.bump, verified: false, failed: ['weapons'] } } })
  assert.ok(failed.some((s) => !s.ok && s.text.includes('bump 沒有生效')))
})

test('renderReport：產得出 HTML，內容會跳脫', () => {
  const m = model()
  m.rows[0].item.evidence = '<script>x</script>'
  const html = renderReport(m)
  assert.match(html, /^<!DOCTYPE html>/)
  assert.ok(html.includes('下一步'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('<script>x'))
  assert.ok(html.includes('&quot;accept&quot;') && html.includes('pilots/pilot_004_丁'), '有待確認時附 accept 檔樣板（列出未接受的那幾筆）')
})

// ─── 還原 ────────────────────────────────────────────────────────────────────

test('planRollback：只還原「現值仍是當初寫入的值」的', () => {
  const writes = [
    { collection: 'pilots', docId: 'a', before: null, after: { pilotInfoId: 1 } },
    { collection: 'pilots', docId: 'b', before: null, after: { pilotInfoId: 2 } },
    { collection: 'pilots', docId: 'c', before: null, after: { pilotInfoId: 3 } },
    { collection: 'pilots', docId: 'd', before: null, after: { pilotInfoId: 4 } },
  ]
  const current = new Map([
    ['pilots/a', { gameRef: { pilotInfoId: 1 } }],   // 還原
    ['pilots/b', { gameRef: undefined }],            // 已是寫入前
    ['pilots/c', { gameRef: { pilotInfoId: 30 } }],  // 寫入後又被改
    ['pilots/d', null],                              // 文件不見了
  ])
  const r = planRollback(writes, current)
  assert.deepEqual(r.map((x) => x.action), ['restore', 'skip', 'skip', 'skip'])
  assert.match(r[1].reason, /寫入前/)
  assert.match(r[2].reason, /改過/)
  assert.match(r[3].reason, /不存在/)
})

// ─── 漂移守門 ────────────────────────────────────────────────────────────────

test('GAME_REF_FIELDS 與 src/types/gameRef.ts 的型別一致', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/types/gameRef.ts'), 'utf8')
  const ifaces = {}
  for (const m of src.matchAll(/export interface (\w+) \{([^}]*)\}/g)) {
    const fields = {}
    for (const f of m[2].matchAll(/^\s*(\w+)(\?)?:\s*([\w[\]]+)/gm)) {
      const base = f[3] === 'number' ? 'int' : f[3] === 'number[]' ? 'int[]' : f[3]
      fields[f[1]] = base + (f[2] ? '?' : '')
    }
    ifaces[m[1]] = fields
  }
  for (const c of COLLECTIONS) {
    assert.deepEqual(GAME_REF_FIELDS[c], ifaces[GAME_REF_TYPE_NAMES[c]], `${c} ↔ ${GAME_REF_TYPE_NAMES[c]}`)
  }
})

test('每個集合的實體型別都掛著對應的 gameRef 型別', () => {
  const files = { pilots: 'pilot', mechs: 'mech', weapons: 'weapon', modules: 'module', components: 'component', backpacks: 'backpack', pilotSkills: 'pilot', forms: 'form' }
  for (const c of COLLECTIONS) {
    const src = fs.readFileSync(path.join(ROOT, `src/types/${files[c]}.ts`), 'utf8')
    assert.ok(src.includes(`gameRef?: ${GAME_REF_TYPE_NAMES[c]}`), `src/types/${files[c]}.ts 應有 gameRef?: ${GAME_REF_TYPE_NAMES[c]}`)
  }
})
