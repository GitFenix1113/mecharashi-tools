// PLAN-030 Phase C 級聯刪除：模擬器破壞性測試 —— 級聯正確性全站覆蓋
//
// 核心問題：「9 個集合的每一類引用站點都真的被清了嗎？沒被引用的資料真的一字未動嗎？」
//
//   timeout 240 node --test --test-force-exit --import ./tests/emulator/register.mjs tests/emulator/suites/cascade-e2e.test.ts
//
// 通道紀律：
//   · 待測邏輯（deleteBuff / deletePilotSkill / deleteGlossaryTerm / planCascadeDelete）
//     一律走 client 路徑（signInAs 之後動態 import src 模組 → 執行安全規則）。
//   · 驗證資料庫真實狀態一律走 adminDb（readDoc / listColl / allLogs），不信任回傳值。
//
// 斷言策略：fixture 常數既是種入值也是 byte-for-byte 比對的依據——
// 每個案例除了逐站點的定點斷言，最後還有「全庫 deepEqual 精確預期狀態」的收尾比對，
// 任何未預期的欄位增刪、型別漂移、順帶誤傷都會在收尾被抓到。

import assert from 'node:assert/strict'
import {
  emuSuite, seedDocs, seedUser, signInAs,
  readDoc, listColl, allLogs, ADMIN_USER,
} from '../helpers.ts'
import type {
  CascadeDeleteResult,
  CascadePlanOutcome,
} from '../../../src/lib/api/cascadeDelete.ts'

type Doc = Record<string, unknown>

// ─── Fixture（種入值 = 斷言依據，勿在測試中修改）─────────────────────────────
//
// 目標 buff_目標（name '目標'）被以下站點引用，覆蓋全部 9 個掃描集合：
//   pilots        talents[].buffIds(@N) / talents[].descriptionRefs / talents[].description(數值 token)
//                 / talents[].ndVariants[].descriptionRefs / skills[] 嵌入物件 buffIds+descriptionRefs
//                 / neuralDrive[].levels[].buffIds+descriptionRefs
//   pilotSkills   buffIds / descriptionRefs
//   buffs         兄弟文件 descriptionRefs（→ 同集合改寫 → targetCollHasSiblingEdits）
//   glossaryTerms descriptionRefs
//   neuralDriveAbilities buffIds / descriptionRefs
//   modules       buffIds / levels[].descriptionRefs（map key 刻意含 '.'，測往返保真）
//   weapons       skills[].buffIds / skills[].descriptionRefs
//   backpacks     mainSkill.buffIds / mainSkill.descriptionRefs
//   components    descriptionRefs
// 另有 nameSoftRef（talents[].effects[].condition.hasBuff = '目標'）——設計為只警示不清除。

const DESC_原文 = '賦予[目標]，最多疊<buff_目標.maxStack>層，並附帶[無辜]'
const DESC_凍結 = '賦予[目標]，最多疊5層，並附帶[無辜]'

const FIXTURE: Record<string, Array<Doc & { id: string }>> = {
  buffs: [
    { id: 'buff_目標', name: '目標', description: '測試目標 BUFF', maxStack: 5, duration: 2 },
    {
      id: 'buff_兄弟', name: '兄弟', description: '與[目標]互動',
      descriptionRefs: { 目標: { refType: 'buff', refId: 'buff_目標' } },
    },
    { id: 'buff_無辜', name: '無辜', description: '不引用任何刪除目標', maxStack: 3 },
    {
      // 案例 f：termRef + descriptionRefs(term) 同文件
      id: 'buff_持詞條', name: '持詞條', description: '解釋見[詞條]', termRef: 'term_目標',
      descriptionRefs: { 詞條: { refType: 'term', refId: 'term_目標' } },
    },
    // 案例 f：只有 termRef 的文件 → mutation 只有 unset、set 為空的邊界
    { id: 'buff_純termRef', name: '純詞條引用', termRef: 'term_目標' },
  ],
  glossaryTerms: [
    { id: 'term_目標', name: '詞條', description: '機制解釋文字' },
    {
      id: 'term_引目標', name: '引目標', description: '解釋[目標]機制',
      descriptionRefs: { 目標: { refType: 'buff', refId: 'buff_目標' } },
    },
  ],
  pilotSkills: [
    {
      id: 'skill_甲', name: '技能甲', description: '技能甲賦予[目標]',
      descriptionRefs: { 目標: { refType: 'buff', refId: 'buff_目標' } },
      buffIds: ['buff_目標', 'buff_無辜'],
    },
    { id: 'skill_目標', name: '目標技能', description: '案例 e 要刪的技能' },
    { id: 'skill_留下', name: '留下技能', description: '無關技能' },
  ],
  pilots: [
    {
      id: 'p_主', name: '主測機師', lore: '簡介純文字',
      talents: [
        {
          name: '天賦甲',
          description: DESC_原文,
          descriptionRefs: {
            目標: { refType: 'buff', refId: 'buff_目標', label: '目標', level: 2 },
            無辜: { refType: 'buff', refId: 'buff_無辜' },
          },
          buffIds: ['buff_目標@3', 'buff_無辜'],
          // nameSoftRef：設計為只警示、不自動清除（案例 c）
          effects: [{ type: 'atkUp', value: 10, condition: { hasBuff: '目標' } }],
          ndVariants: [
            {
              minSum: 12, description: '算力強化：賦予[目標]',
              descriptionRefs: { 目標: { refType: 'buff', refId: 'buff_目標' } },
            },
          ],
        },
        {
          name: '天賦乙', description: '無關天賦', buffIds: ['buff_無辜'],
          descriptionRefs: { 無辜: { refType: 'buff', refId: 'buff_無辜' } },
        },
      ],
      skills: [
        'skill_字串留下',
        {
          name: '內嵌技能甲', description: '內嵌技能賦予[目標]',
          descriptionRefs: { 目標: { refType: 'buff', refId: 'buff_目標' } },
          buffIds: ['buff_目標', 'buff_無辜'],
        },
      ],
      neuralDrive: [
        {
          name: '算力區甲',
          levels: [
            {
              level: 1, effect: '獲得[目標]', buffIds: ['buff_目標@2'],
              descriptionRefs: { 目標: { refType: 'buff', refId: 'buff_目標' } },
            },
            { level: 3, effect: '無關效果', buffIds: ['buff_無辜'] },
          ],
        },
      ],
    },
    {
      // 案例 e：混合陣列（字串引用 + 嵌入物件 + 字串引用）
      id: 'p_技能', name: '技能測機師',
      skills: [
        'skill_目標',
        { name: '內嵌技能乙', description: '嵌入物件不受傷', buffIds: ['buff_無辜'] },
        'skill_留下',
      ],
    },
    {
      // 案例 b：全程一字未動的對照組
      id: 'p_無辜', name: '無辜機師', lore: '完全不引用刪除目標',
      talents: [
        {
          name: '路人天賦', description: '賦予[無辜]', buffIds: ['buff_無辜'],
          descriptionRefs: { 無辜: { refType: 'buff', refId: 'buff_無辜' } },
        },
      ],
    },
  ],
  neuralDriveAbilities: [
    {
      id: 'nda_甲', name: '神驅能力甲', description: '賦予[目標]',
      descriptionRefs: { 目標: { refType: 'buff', refId: 'buff_目標' } },
      buffIds: ['buff_目標'],
    },
  ],
  modules: [
    {
      id: 'm_甲', name: '模組甲', description: '模組頂層描述',
      buffIds: ['buff_目標', 'buff_無辜'],
      levels: [
        {
          level: 1, description: 'Lv1 賦予[目標.強化]',
          // map key 刻意含 '.'：驗證 segments 權威路徑與整欄改寫的往返保真
          descriptionRefs: {
            '目標.強化': { refType: 'buff', refId: 'buff_目標' },
            '無辜.鍵': { refType: 'buff', refId: 'buff_無辜' },
          },
        },
        { level: 2, description: 'Lv2 無關' },
      ],
    },
  ],
  weapons: [
    {
      id: 'w_甲', name: '武器甲', description: '武器描述',
      skills: [
        {
          name: '武技甲', description: '賦予[目標]',
          descriptionRefs: { 目標: { refType: 'buff', refId: 'buff_目標' } },
          buffIds: ['buff_目標@1'],
        },
        { name: '武技乙', description: '無關', buffIds: ['buff_無辜'] },
      ],
    },
  ],
  backpacks: [
    {
      id: 'bp_甲', name: '背包甲',
      mainSkill: {
        name: '背包主技', description: '賦予[目標]',
        descriptionRefs: { 目標: { refType: 'buff', refId: 'buff_目標' } },
        buffIds: ['buff_目標'],
      },
    },
  ],
  components: [
    {
      id: 'c_甲', name: '元件甲', description: '元件描述[目標]',
      descriptionRefs: { 目標: { refType: 'buff', refId: 'buff_目標' } },
    },
  ],
}

// ─── 小工具 ──────────────────────────────────────────────────────────────────

/** 取種入值副本（不含 id）——deepEqual 的期望值來源。 */
function seedOf(coll: string, id: string): Doc {
  const found = FIXTURE[coll].find((d) => d.id === id)
  if (!found) throw new Error(`fixture 缺 ${coll}/${id}`)
  const { id: _omit, ...rest } = structuredClone(found)
  return rest
}

/** 沿路徑取巢狀節點（斷言便利用；路徑不存在直接讓後續斷言炸掉即可）。 */
function at(o: unknown, ...path: (string | number)[]): Doc {
  let cur: unknown = o
  for (const p of path) cur = (cur as Record<PropertyKey, unknown>)[p]
  return cur as Doc
}

/**
 * deleteBuff('buff_目標') 之後的全庫精確預期狀態。
 * 從種入值出發、只施加「應該發生」的變更——其餘任何 byte 差異都是缺陷。
 */
function expectedPostBuffDelete(): Record<string, Record<string, Doc>> {
  const state: Record<string, Record<string, Doc>> = {}
  for (const [coll, docs] of Object.entries(FIXTURE)) {
    state[coll] = {}
    for (const d of docs) {
      if (coll === 'buffs' && d.id === 'buff_目標') continue // 目標本身被刪
      state[coll][d.id] = seedOf(coll, d.id)
    }
  }
  // pilots/p_主
  const p = state.pilots['p_主']
  const t0 = at(p, 'talents', 0)
  t0.description = DESC_凍結                              // textFreeze 烘焙
  t0.buffIds = ['buff_無辜']                              // @3 元素被精確移除
  delete (t0.descriptionRefs as Doc)['目標']              // mapKeyDelete（僅該 key）
  at(p, 'talents', 0, 'ndVariants', 0).descriptionRefs = {}
  const sk1 = at(p, 'skills', 1)
  sk1.buffIds = ['buff_無辜']
  sk1.descriptionRefs = {}
  const nd0 = at(p, 'neuralDrive', 0, 'levels', 0)
  nd0.buffIds = []
  nd0.descriptionRefs = {}
  // pilotSkills/skill_甲
  state.pilotSkills['skill_甲'].buffIds = ['buff_無辜']
  state.pilotSkills['skill_甲'].descriptionRefs = {}
  // buffs/buff_兄弟（同集合兄弟文件）
  state.buffs['buff_兄弟'].descriptionRefs = {}
  // glossaryTerms/term_引目標
  state.glossaryTerms['term_引目標'].descriptionRefs = {}
  // neuralDriveAbilities/nda_甲
  state.neuralDriveAbilities['nda_甲'].buffIds = []
  state.neuralDriveAbilities['nda_甲'].descriptionRefs = {}
  // modules/m_甲：含 '.' 的無辜 key 必須原樣存活
  state.modules['m_甲'].buffIds = ['buff_無辜']
  at(state.modules['m_甲'], 'levels', 0).descriptionRefs = {
    '無辜.鍵': { refType: 'buff', refId: 'buff_無辜' },
  }
  // weapons/w_甲
  const ws0 = at(state.weapons['w_甲'], 'skills', 0)
  ws0.buffIds = []
  ws0.descriptionRefs = {}
  // backpacks/bp_甲
  const ms = at(state.backpacks['bp_甲'], 'mainSkill')
  ms.buffIds = []
  ms.descriptionRefs = {}
  // components/c_甲
  state.components['c_甲'].descriptionRefs = {}
  return state
}

// ─── 套件 ────────────────────────────────────────────────────────────────────

emuSuite('cascade-e2e: 級聯正確性全站覆蓋', async (t) => {
  const adminUid = await seedUser(ADMIN_USER, 'OWNER')
  await seedDocs(FIXTURE)
  await signInAs(ADMIN_USER)

  const { deleteBuff } = await import('../../../src/lib/api/buffs.ts')
  const { deletePilotSkill } = await import('../../../src/lib/api/skills.ts')
  const { deleteGlossaryTerm } = await import('../../../src/lib/api/glossary.ts')
  const { planCascadeDelete } = await import('../../../src/lib/api/cascadeDelete.ts')

  let plannedA: CascadePlanOutcome = null
  let resA: CascadeDeleteResult | null = null
  let versionA = ''                                        // 案例 a 的版本戳，供 e/f 對照

  // ── 案例 g（先跑：此時資料庫只有種子，log 與 meta 應為零）────────────────────
  await t.test('案例 g：刪不存在的 id → 回傳 null、無 log、無版本 bump', async () => {
    assert.equal(await deleteBuff('buff_不存在'), null, 'deleteBuff 應回傳 null')
    assert.equal(await deletePilotSkill('skill_不存在'), null, 'deletePilotSkill 應回傳 null')
    assert.equal(await deleteGlossaryTerm('term_不存在'), null, 'deleteGlossaryTerm 應回傳 null')
    assert.equal((await allLogs()).length, 0, '不應寫入任何 changeHistory log')
    assert.equal(await readDoc('meta', 'gameData'), null, '不應 bump 任何版本（meta/gameData 不應存在）')
  })

  // ── 案例 a：跨 9 集合逐站點驗證 ───────────────────────────────────────────────
  await t.test('案例 a：deleteBuff 級聯清除 9 個集合的每一類引用站點', async (st) => {
    // plan 先留檔（只讀、不寫）：案例 c 要驗 softWarnings 的回報契約
    plannedA = await planCascadeDelete('buff', 'buff_目標')
    assert.ok(plannedA, '目標存在，plan 不應為 null')
    assert.equal(plannedA!.blockers.length, 0, '乾淨資料不應有 blocker')
    assert.equal(plannedA!.unresolvedTokens.length, 0, 'maxStack 可解析，不應有 unresolved token')

    resA = await deleteBuff('buff_目標')
    assert.ok(resA, 'deleteBuff 應回傳結果')

    // ── 帶外逐站點驗證 ──
    assert.equal(await readDoc('buffs', 'buff_目標'), null, '目標文件應已刪除')

    const p = (await readDoc('pilots', 'p_主'))!
    const t0 = at(p, 'talents', 0)
    assert.deepEqual(t0.buffIds, ['buff_無辜'], 'talents[].buffIds：@3 元素精確移除、無辜元素保留')
    assert.deepEqual(Object.keys(t0.descriptionRefs as Doc), ['無辜'], 'talents[].descriptionRefs：只刪目標 key')
    assert.equal(t0.description, DESC_凍結, 'talents[].description：數值 token 烘焙為常數 5')
    assert.deepEqual(at(p, 'talents', 0, 'ndVariants', 0).descriptionRefs, {}, 'ndVariants[].descriptionRefs 清空')
    assert.equal((p.skills as unknown[])[0], 'skill_字串留下', 'skills[] 字串元素不受 buff 刪除影響')
    assert.deepEqual(at(p, 'skills', 1).buffIds, ['buff_無辜'], 'skills[] 嵌入物件 buffIds 清目標')
    assert.deepEqual(at(p, 'skills', 1).descriptionRefs, {}, 'skills[] 嵌入物件 descriptionRefs 清空')
    assert.deepEqual(at(p, 'neuralDrive', 0, 'levels', 0).buffIds, [], 'neuralDrive[].levels[].buffIds（@2）清空')
    assert.deepEqual(at(p, 'neuralDrive', 0, 'levels', 0).descriptionRefs, {}, 'neuralDrive[].levels[].descriptionRefs 清空')
    st.diagnostic(`p_主.talents[0] 帶外讀回: ${JSON.stringify(t0)}`)

    const sk = (await readDoc('pilotSkills', 'skill_甲'))!
    assert.deepEqual(sk.buffIds, ['buff_無辜'], 'pilotSkills.buffIds 清目標')
    assert.deepEqual(sk.descriptionRefs, {}, 'pilotSkills.descriptionRefs 清空')

    const sibling = (await readDoc('buffs', 'buff_兄弟'))!
    assert.deepEqual(sibling.descriptionRefs, {}, 'buffs 兄弟文件 descriptionRefs 清空（同集合改寫）')

    const term = (await readDoc('glossaryTerms', 'term_引目標'))!
    assert.deepEqual(term.descriptionRefs, {}, 'glossaryTerms.descriptionRefs 清空')

    const nda = (await readDoc('neuralDriveAbilities', 'nda_甲'))!
    assert.deepEqual(nda.buffIds, [], 'neuralDriveAbilities.buffIds 清空')
    assert.deepEqual(nda.descriptionRefs, {}, 'neuralDriveAbilities.descriptionRefs 清空')

    const m = (await readDoc('modules', 'm_甲'))!
    assert.deepEqual(m.buffIds, ['buff_無辜'], 'modules.buffIds 清目標')
    assert.deepEqual(
      at(m, 'levels', 0).descriptionRefs,
      { '無辜.鍵': { refType: 'buff', refId: 'buff_無辜' } },
      'modules.levels[].descriptionRefs：含 . 的目標 key 被刪、含 . 的無辜 key 原樣存活',
    )
    st.diagnostic(`m_甲.levels[0].descriptionRefs 帶外讀回: ${JSON.stringify(at(m, 'levels', 0).descriptionRefs)}`)

    const w = (await readDoc('weapons', 'w_甲'))!
    assert.deepEqual(at(w, 'skills', 0).buffIds, [], 'weapons.skills[].buffIds（@1）清空')
    assert.deepEqual(at(w, 'skills', 0).descriptionRefs, {}, 'weapons.skills[].descriptionRefs 清空')

    const bp = (await readDoc('backpacks', 'bp_甲'))!
    assert.deepEqual(at(bp, 'mainSkill').buffIds, [], 'backpacks.mainSkill.buffIds 清空')
    assert.deepEqual(at(bp, 'mainSkill').descriptionRefs, {}, 'backpacks.mainSkill.descriptionRefs 清空')

    const c = (await readDoc('components', 'c_甲'))!
    assert.deepEqual(c.descriptionRefs, {}, 'components.descriptionRefs 清空')
  })

  // ── 案例 a-2：版本 bump 與刪除 log 快照（同一次刪除的邊際效果）────────────────
  await t.test('案例 a-2：9 個受影響集合共用同一版本戳；log 快照含 21 筆修補單', async (st) => {
    const meta = (await readDoc('meta', 'gameData'))!
    const versions = meta.versions as Record<string, string>
    assert.deepEqual(
      Object.keys(versions).sort(),
      Object.keys(FIXTURE).sort(),
      '受影響集合 = 全部 9 個掃描集合，不多不少',
    )
    assert.equal(new Set(Object.values(versions)).size, 1, '同一次刪除共用同一版本戳')
    versionA = versions.weapons
    assert.deepEqual(resA!.versions, versions, '回傳的 versions 應與 meta/gameData 帶外讀回一致')
    st.diagnostic(`meta/gameData.versions 帶外讀回: ${JSON.stringify(versions)}`)

    const logs = await allLogs()
    assert.equal(logs.length, 1, '應恰有一筆 delete log')
    const log = logs[0]
    assert.equal(log.id, resA!.logId, '回傳 logId 應指向該筆 log')
    assert.equal(log.target, 'buff')
    assert.equal(log.action, 'delete')
    assert.equal(log.targetId, 'buff_目標')
    assert.equal(log.targetName, '目標')
    assert.equal(log.actorUid, adminUid, 'actorUid 應為執行刪除的管理員')

    const snapshot = log.snapshot as { doc: Doc; patches: Doc[] }
    assert.deepEqual(snapshot.doc, seedOf('buffs', 'buff_目標'), '快照 doc 應與被刪文件 byte-for-byte 相同')
    assert.equal(snapshot.patches.length, 21, '21 處引用各對應一筆反向修補單')

    const freeze = snapshot.patches.find((x) => x.op === 'textFreeze')
    assert.ok(freeze, '應有 textFreeze 修補單')
    assert.equal(freeze!.value, DESC_原文, 'textFreeze patch 應存「凍結前」原文（含 token）')

    const dotted = snapshot.patches.find((x) => x.docId === 'm_甲' && x.op === 'mapKeyDelete')
    assert.ok(dotted, '應有 m_甲 的 mapKeyDelete 修補單')
    assert.deepEqual(
      dotted!.segments,
      ['levels', 0, 'descriptionRefs', '目標.強化'],
      '含 . 的 map key 必須以 segments 陣列保真（path 字串不可為權威）',
    )
    assert.deepEqual(dotted!.value, { refType: 'buff', refId: 'buff_目標' }, 'mapKeyDelete value 應存完整 EntityRef')
    st.diagnostic(`m_甲 修補單帶外讀回: ${JSON.stringify(dotted)}`)
  })

  // ── 案例 b：未涉及的欄位與文件 byte-for-byte 不變 ────────────────────────────
  await t.test('案例 b：全庫 deepEqual 精確預期——未涉及的欄位與文件一字未動', async () => {
    const expected = expectedPostBuffDelete()
    for (const [coll, docs] of Object.entries(expected)) {
      assert.deepEqual(
        Object.fromEntries(await listColl(coll)),
        docs,
        `${coll} 集合整體狀態應與「種入值＋僅預期變更」完全一致`,
      )
    }
  })

  // ── 案例 c：nameSoftRef 只警示、不清除 ──────────────────────────────────────
  await t.test('案例 c：nameSoftRef（condition.hasBuff 同名）留在原地，plan 有列警示', async (st) => {
    const p = (await readDoc('pilots', 'p_主'))!
    assert.deepEqual(
      at(p, 'talents', 0, 'effects', 0),
      { type: 'atkUp', value: 10, condition: { hasBuff: '目標' } },
      'hasBuff 名稱軟引用必須原樣留存（設計為只警示）',
    )
    assert.equal(plannedA!.softWarnings.length, 1, 'plan 應回報恰 1 筆軟引用警示')
    assert.equal(plannedA!.softWarnings[0].siteId, 'pilots.talents[].effects[].condition.hasBuff')
    assert.equal(plannedA!.softWarnings[0].docId, 'p_主')
    st.diagnostic(`softWarnings: ${JSON.stringify(plannedA!.softWarnings.map((x) => x.siteId))}`)
  })

  // ── 案例 d：同集合兄弟改寫旗標 ──────────────────────────────────────────────
  await t.test('案例 d：targetCollHasSiblingEdits === true（buff→buff 引用）', async () => {
    assert.equal(resA!.targetCollHasSiblingEdits, true, '兄弟 BUFF 被改寫 → 旗標必須為 true')
    assert.equal(resA!.patchedDocs, 9, '9 份引用來源文件被改寫')
    assert.equal(resA!.patchCount, 21, '21 處引用被移除/凍結')
  })

  // ── 案例 e：deletePilotSkill 混合陣列 ───────────────────────────────────────
  await t.test('案例 e：deletePilotSkill——字串元素移除、同陣列嵌入物件不受傷', async (st) => {
    const resE = await deletePilotSkill('skill_目標')
    assert.ok(resE, 'deletePilotSkill 應回傳結果')

    assert.equal(await readDoc('pilotSkills', 'skill_目標'), null, '技能文件應已刪除')

    const p = (await readDoc('pilots', 'p_技能'))!
    assert.deepEqual(
      p.skills,
      [
        { name: '內嵌技能乙', description: '嵌入物件不受傷', buffIds: ['buff_無辜'] },
        'skill_留下',
      ],
      '字串元素 skill_目標 被移除；嵌入物件與另一個字串元素 byte-for-byte 保留',
    )
    assert.equal(p.name, '技能測機師', '其他欄位不動')
    st.diagnostic(`p_技能.skills 帶外讀回: ${JSON.stringify(p.skills)}`)

    assert.equal(resE!.patchedDocs, 1)
    assert.equal(resE!.patchCount, 1)
    assert.equal(resE!.targetCollHasSiblingEdits, false, 'pilotSkills 內無兄弟引用 → false')

    const logs = await allLogs()
    assert.equal(logs.length, 2, '第二筆 delete log')
    const logE = logs.find((l) => l.targetId === 'skill_目標')!
    assert.ok(logE, '應有 skill_目標 的 log')
    assert.equal(logE.target, 'pilotSkill')
    assert.equal(logE.action, 'delete')
    const patches = (logE.snapshot as { patches: Doc[] }).patches
    assert.equal(patches.length, 1)
    assert.equal(patches[0].op, 'arrayRemove')
    assert.equal(patches[0].value, 'skill_目標')
    assert.deepEqual(patches[0].segments, ['skills'], '修補單路徑應正規化為指向陣列本身（非元素索引）')

    // 版本：只 bump pilots 與 pilotSkills；其餘集合維持案例 a 的版本戳
    const versions = ((await readDoc('meta', 'gameData'))!.versions) as Record<string, string>
    assert.equal(versions.pilots, versions.pilotSkills, '兩個受影響集合共用同一新版本戳')
    assert.notEqual(versions.pilots, versionA, 'pilots 版本應前進')
    assert.equal(versions.weapons, versionA, '未涉及集合（weapons）版本不得被 bump')
    assert.equal(Object.keys(versions).length, 9, 'merge 寫入不得抹掉其他集合的版本')
  })

  // ── 案例 f：deleteGlossaryTerm 的 deleteField 語意 ──────────────────────────
  await t.test('案例 f：deleteGlossaryTerm——buffs.termRef 欄位整個消失（非 null）', async (st) => {
    const resF = await deleteGlossaryTerm('term_目標')
    assert.ok(resF, 'deleteGlossaryTerm 應回傳結果')

    assert.equal(await readDoc('glossaryTerms', 'term_目標'), null, '詞條文件應已刪除')

    const b1 = (await readDoc('buffs', 'buff_持詞條'))!
    assert.ok(
      !Object.prototype.hasOwnProperty.call(b1, 'termRef'),
      'termRef 欄位應整個消失（deleteField 語意），不是留一個 null',
    )
    assert.deepEqual(
      b1,
      { name: '持詞條', description: '解釋見[詞條]', descriptionRefs: {} },
      '同文件的 descriptionRefs(term) 一併清除，其餘欄位不動',
    )
    st.diagnostic(`buff_持詞條 帶外讀回: ${JSON.stringify(b1)}（keys: ${Object.keys(b1).join(',')}）`)

    const b2 = (await readDoc('buffs', 'buff_純termRef'))!
    assert.ok(!Object.prototype.hasOwnProperty.call(b2, 'termRef'), '只有 termRef 的文件：欄位也應整個消失')
    assert.deepEqual(b2, { name: '純詞條引用' }, 'set 為空、只有 unset 的 mutation 邊界正確')

    assert.equal(resF!.targetCollHasSiblingEdits, false, 'glossaryTerms 內無兄弟引用 → false')
    assert.equal(resF!.patchedDocs, 2)
    assert.equal(resF!.patchCount, 3, 'fieldClear x2 + mapKeyDelete x1')

    const logs = await allLogs()
    assert.equal(logs.length, 3, '第三筆 delete log')
    const logF = logs.find((l) => l.targetId === 'term_目標')!
    assert.ok(logF)
    const patches = (logF.snapshot as { patches: Doc[] }).patches
    assert.equal(patches.length, 3)
    assert.equal(patches.filter((x) => x.op === 'fieldClear').length, 2)
    assert.equal(patches.filter((x) => x.op === 'mapKeyDelete').length, 1)
  })

  // ── 收尾：三次刪除後的全庫精確狀態（未涉及文件全程一字未動）──────────────────
  await t.test('收尾：全庫狀態 = 種入值＋三次刪除的精確預期，無任何順帶誤傷', async () => {
    const expected = expectedPostBuffDelete()
    // 案例 e 的影響
    expected.pilots['p_技能'].skills = [
      { name: '內嵌技能乙', description: '嵌入物件不受傷', buffIds: ['buff_無辜'] },
      'skill_留下',
    ]
    delete expected.pilotSkills['skill_目標']
    // 案例 f 的影響
    delete expected.glossaryTerms['term_目標']
    delete expected.buffs['buff_持詞條'].termRef
    expected.buffs['buff_持詞條'].descriptionRefs = {}
    delete expected.buffs['buff_純termRef'].termRef

    for (const [coll, docs] of Object.entries(expected)) {
      assert.deepEqual(
        Object.fromEntries(await listColl(coll)),
        docs,
        `${coll} 全集合最終狀態`,
      )
    }
  })
})
