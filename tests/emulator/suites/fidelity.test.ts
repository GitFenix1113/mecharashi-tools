// PLAN-030 Phase C 模擬器破壞性測試：快照保真度（Firestore 往返）
//
// 核心問題：「存進 changeHistory 的快照，讀回來還原得了嗎？」
// 單元測試只驗過記憶體中的 JSON 往返；這裡驗 Firestore 型別編碼那一層：
//   a. patches[].segments 的數字索引讀回仍是 number（Phase F 按索引定位的前提）
//   b. descriptionRefs 的 map key 含 '.'（凝勢.強化）：segments 保有正確切分、
//      寫回（含未被刪的兄弟 dotted key 經 client update 往返）不變形
//   c. anchor（by:'name' / 'level' / 'minSum'）完整往返；無錨站點不帶 anchor
//   d. arrayRemove 保留原始 '@N' 字串；mapKeyDelete 保留完整 EntityRef 物件；
//      fieldClear 保留原純量值
//   e. textFreeze：資料庫正文已凍成常數、只凍目標 buff 的 token、其他 buff 的
//      token 原樣；快照 value 是凍結前原文
//   f. snapshot.doc 與種入文件深度相等；expireAt 為 Timestamp 且 ≈ now + 2 年
//   g. 人工還原演練：拿快照用 adminDb 反向套用（doc 寫回 + 逐 patch 還原），
//      帶外比對最終狀態與最初種入完全一致——證明 Phase F 未完成也能人工救回
//
// 通道紀律：刪除一律走 client 路徑（signInAs 後動態 import src 模組，執行安全規則）；
// 驗證一律走 adminDb 帶外通道，不信任待測程式的回傳值。
//
//   timeout 240 node --test --test-force-exit --import ./tests/emulator/register.mjs tests/emulator/suites/fidelity.test.ts

import assert from 'node:assert/strict'
import admin from 'firebase-admin'
import {
  emuSuite, seedDocs, seedUser, signInAs,
  readDoc, allLogs, adminDb, ADMIN_USER,
} from '../helpers.ts'

const { Timestamp } = admin.firestore

// ─── 讀回快照的原始形狀（刻意不 import src 型別：讀回什麼就驗什麼）────────────

interface RawPatch {
  coll: string
  docId: string
  path: string
  segments: (string | number)[]
  op: string
  value: unknown
  anchor?: { by: string; value: unknown }
}
interface RawSnapshot {
  doc: Record<string, unknown>
  patches: RawPatch[]
}

// ─── 種子資料（同一份 const 也是案例 g 的「最初種入」比對基準，全程不可變動）───
//
// 設計要點：
//  · 目標引用一律放在各陣列的**最後一個元素**——案例 g 的人工還原用 append 加回，
//    如此還原後順序與原始完全一致，deepEqual 才成立（快照本就不記陣列內位置）。
//  · 文案同時放「指向目標的 token」與「指向他人的 token」，驗凍結只波及目標。
//  · descriptionRefs 放兩個含 '.' 的 key：一個指向目標（會被刪），一個指向他人
//    （存留，並經 client update 整欄寫回往返——驗 SDK 不會把 dotted key 拆成巢狀）。

const REF_DOTKEY_TARGET = { refType: 'buff', refId: 'buff_target', label: '凝勢', level: 2 }
const REF_DOTKEY_SURVIVOR = { refType: 'buff', refId: 'buff_other', label: '無辜' }
const REF_VARIANT = { refType: 'buff', refId: 'buff_target' }
const REF_OTHER_TO_TARGET = { refType: 'buff', refId: 'buff_target', label: '凝勢' }
const REF_TERM = { refType: 'term', refId: 'term_灼燒', label: '灼燒' }

const TALENT_DESC = '賦予[凝勢.強化]，可疊加<buff_target.maxStack>層，另有<buff_other.duration>回合'
const TALENT_DESC_FROZEN = '賦予[凝勢.強化]，可疊加7層，另有<buff_other.duration>回合'
const ND_EFFECT = '進入<buff_target.lv2.maxStack>層戒備'
const ND_EFFECT_FROZEN = '進入9層戒備'
const OTHER_DESC = '受[凝勢]影響<buff_target.duration>回合，觸發<buff_other.maxTriggers>次'
const OTHER_DESC_FROZEN = '受[凝勢]影響3回合，觸發<buff_other.maxTriggers>次'

const TARGET_SEED = {
  id: 'buff_target',
  name: '凝勢',
  maxStack: 7,
  duration: 3,
  description: '每層提高蓄力速度',
  levels: [
    { level: 1, maxStack: 3, description: '第一階' },
    { level: 2, maxStack: 9, description: '第二階' },
  ],
  tags: ['增益', '疊層'],
  meta: { origin: '測試', weights: [1, 2, 3], hidden: false },
}

const SEEDS: Record<string, Array<Record<string, unknown> & { id: string }>> = {
  buffs: [
    TARGET_SEED,
    { id: 'buff_keep', name: '留下', duration: 2 },
    {
      // 目標集合的兄弟文件：descriptionRefs 指向目標 + 正文含目標/自身兩種 token
      id: 'buff_other',
      name: '無辜',
      duration: 4,
      maxTriggers: 2,
      description: OTHER_DESC,
      descriptionRefs: { 凝勢: REF_OTHER_TO_TARGET },
    },
    {
      // fieldClear 來源：termRef 指向即將被刪的詞條
      id: 'buff_引用者',
      name: '引用者',
      termRef: 'term_灼燒',
      description: '參見[灼燒]',
      descriptionRefs: { 灼燒: REF_TERM },
    },
  ],
  pilots: [
    {
      id: 'p1',
      name: '測試機師',
      talents: [
        {
          name: '悖想先驅',
          buffIds: ['buff_keep', 'buff_target@3'],
          description: TALENT_DESC,
          descriptionRefs: {
            '凝勢.強化': REF_DOTKEY_TARGET,   // ← 會被 mapKeyDelete
            '無辜.殘留': REF_DOTKEY_SURVIVOR, // ← 存留，經整欄寫回往返
          },
          ndVariants: [
            {
              minSum: 120,
              description: '算力提升版描述',
              descriptionRefs: { '凝勢.強化': REF_VARIANT },
            },
          ],
        },
      ],
      neuralDrive: [
        {
          name: '主駕分區',
          levels: [
            { level: 3, buffIds: ['buff_target'], effect: ND_EFFECT },
          ],
        },
      ],
    },
  ],
  pilotSkills: [
    // pilotSkills.buffIds 是「無錨站點」——驗 anchor 欄位確實不存在
    { id: 'skill_s1', name: '技能一', buffIds: ['buff_keep', 'buff_target@2'], description: '無 token 技能' },
  ],
  glossaryTerms: [
    { id: 'term_灼燒', name: '灼燒', description: '每回合受到傷害' },
  ],
}

// ─── 小工具 ──────────────────────────────────────────────────────────────────

/** 快照中應恰有一筆符合 (coll, path, op) 的 patch。 */
function onePatch(patches: RawPatch[], coll: string, path: string, op: string): RawPatch {
  const found = patches.filter((p) => p.coll === coll && p.path === path && p.op === op)
  assert.equal(found.length, 1, `快照中應恰有一筆 ${op}@${coll}:${path}，實得 ${found.length}`)
  return found[0]
}

/** 沿 segments 走訪（還原演練用）。中斷即 assert 失敗。 */
function nodeAt(root: unknown, segments: (string | number)[]): unknown {
  let cur: unknown = root
  for (const seg of segments) {
    assert.ok(cur !== null && typeof cur === 'object',
      `還原走訪中斷：${segments.join('.')} 於 ${String(seg)} 之前遇到非容器`)
    cur = (cur as Record<PropertyKey, unknown>)[seg]
  }
  return cur
}

/**
 * 人工還原演練的核心：完全依快照內容、用帶外通道反向套用。
 *  ① snapshot.doc 原樣寫回目標文件
 *  ② 逐 patch 還原：arrayRemove → 值 append 回陣列（種子設計保證順序）；
 *     mapKeyDelete / fieldClear → 把 key 設回 value；textFreeze → 寫回凍結前原文
 * 不呼叫任何 src 程式——這正是「Phase F 還沒做也能照快照人工還原」的實證。
 */
async function restoreFromSnapshot(coll: string, targetId: string, snapshot: RawSnapshot): Promise<void> {
  await adminDb.doc(`${coll}/${targetId}`).set(snapshot.doc)

  const byDoc = new Map<string, RawPatch[]>()
  for (const p of snapshot.patches) {
    const key = `${p.coll}/${p.docId}`
    const list = byDoc.get(key)
    if (list) list.push(p)
    else byDoc.set(key, [p])
  }

  for (const [docPath, patches] of byDoc) {
    const ref = adminDb.doc(docPath)
    const data = (await ref.get()).data() as Record<string, unknown> | undefined
    assert.ok(data, `還原對象 ${docPath} 應存在`)
    for (const p of patches) {
      if (p.op === 'arrayRemove') {
        const arr = nodeAt(data, p.segments)
        assert.ok(Array.isArray(arr), `arrayRemove 還原點 ${p.path} 應是陣列`)
        arr.push(p.value)
      } else if (p.op === 'mapKeyDelete' || p.op === 'fieldClear' || p.op === 'textFreeze') {
        const parent = p.segments.length > 1 ? nodeAt(data, p.segments.slice(0, -1)) : data
        assert.ok(parent !== null && typeof parent === 'object' && !Array.isArray(parent),
          `${p.op} 還原點 ${p.path} 的父層應是 map`)
        ;(parent as Record<PropertyKey, unknown>)[p.segments[p.segments.length - 1]] = p.value
      } else {
        assert.fail(`快照出現未知 op：${p.op}（${p.path}）`)
      }
    }
    await ref.set(data)
  }
}

// ─── 套件 ────────────────────────────────────────────────────────────────────

emuSuite('fidelity: 刪除快照的 Firestore 往返保真度', async (t) => {
  await seedUser(ADMIN_USER, 'OWNER')
  await seedDocs(SEEDS)
  await signInAs(ADMIN_USER)

  const { deleteBuff } = await import('../../../src/lib/api/buffs.ts')
  const { deleteGlossaryTerm } = await import('../../../src/lib/api/glossary.ts')

  // 兩次刪除：buff 覆蓋 arrayRemove / mapKeyDelete / textFreeze，詞條覆蓋 fieldClear
  const resBuff = await deleteBuff('buff_target')
  const resTerm = await deleteGlossaryTerm('term_灼燒')

  const logs = await allLogs()
  const buffLog = logs.find((l) => l.targetId === 'buff_target')
  const termLog = logs.find((l) => l.targetId === 'term_灼燒')
  assert.ok(buffLog, '應有 buff_target 的 delete log')
  assert.ok(termLog, '應有 term_灼燒 的 delete log')
  const buffSnap = buffLog!.snapshot as RawSnapshot
  const termSnap = termLog!.snapshot as RawSnapshot

  await t.test('sanity: 兩次刪除的統計與資料庫狀態', async () => {
    assert.ok(resBuff, 'deleteBuff 應回傳結果')
    assert.equal(resBuff!.patchedDocs, 3, 'buff 刪除應改寫 p1 / skill_s1 / buff_other 三份文件')
    assert.equal(resBuff!.patchCount, 9, 'buff 刪除應產生 9 筆 patch')
    assert.equal(resBuff!.targetCollHasSiblingEdits, true, 'buff_other 是目標集合的兄弟文件')
    assert.ok(resTerm, 'deleteGlossaryTerm 應回傳結果')
    assert.equal(resTerm!.patchedDocs, 1)
    assert.equal(resTerm!.patchCount, 2, '詞條刪除應產生 fieldClear + mapKeyDelete 各一')
    assert.equal(await readDoc('buffs', 'buff_target'), null, '目標 buff 應已刪除')
    assert.equal(await readDoc('glossaryTerms', 'term_灼燒'), null, '目標詞條應已刪除')
    assert.equal(logs.length, 2, '應恰有兩筆 log')
    assert.equal(buffLog!.action, 'delete')
    assert.equal(buffLog!.target, 'buff')
    assert.equal(buffLog!.targetName, '凝勢')
    assert.equal(buffSnap.patches.length, 9)
    assert.equal(termSnap.patches.length, 2)
  })

  await t.test('a. segments 數字索引經 Firestore 往返仍是 number', async (st) => {
    const talent = onePatch(buffSnap.patches, 'pilots', 'talents.0.buffIds', 'arrayRemove')
    // deepEqual（strict 版）會分辨 0 與 '0'——這行同時驗值與型別
    assert.deepEqual(talent.segments, ['talents', 0, 'buffIds'],
      'segments 應為 [string, number, string] 且值正確')
    assert.equal(typeof talent.segments[1], 'number', 'talents 的索引讀回必須是 number 不是字串')

    const nd = onePatch(buffSnap.patches, 'pilots', 'neuralDrive.0.levels.0.buffIds', 'arrayRemove')
    assert.deepEqual(nd.segments, ['neuralDrive', 0, 'levels', 0, 'buffIds'],
      '多層數字索引也必須全數保型')
    st.diagnostic(`talents patch segments 讀回=${JSON.stringify(talent.segments)} typeof[1]=${typeof talent.segments[1]}`)
    st.diagnostic(`neuralDrive patch segments 讀回=${JSON.stringify(nd.segments)}`)
  })

  await t.test('b. descriptionRefs key 含「.」：segments 切分保真、寫回不變形', async (st) => {
    const p = onePatch(buffSnap.patches, 'pilots', 'talents.0.descriptionRefs.凝勢.強化', 'mapKeyDelete')
    assert.deepEqual(p.segments, ['talents', 0, 'descriptionRefs', '凝勢.強化'],
      'dotted key 必須是單一 segment，不可被切開')
    assert.equal(p.segments.length, 4, 'segments 應為 4 段')
    // path 是 join('.') 的顯示形式——split 回來是 5 段 ≠ segments 的 4 段，
    // 證明 path 不可用於定位（型別註解明言，此處實測固定下來）
    assert.equal(p.path, 'talents.0.descriptionRefs.凝勢.強化')
    assert.equal(p.path.split('.').length, 5, 'path 的 split(".") 會失真（僅供顯示，定位一律用 segments）')

    const v = onePatch(buffSnap.patches, 'pilots', 'talents.0.ndVariants.0.descriptionRefs.凝勢.強化', 'mapKeyDelete')
    assert.deepEqual(v.segments, ['talents', 0, 'ndVariants', 0, 'descriptionRefs', '凝勢.強化'])

    // 整欄寫回後：被刪的 dotted key 消失、存留的 dotted key 原樣（未被 SDK 拆成巢狀 map）
    const p1 = await readDoc('pilots', 'p1')
    const talent = (p1!.talents as Array<Record<string, unknown>>)[0]
    assert.deepEqual(talent.descriptionRefs, { '無辜.殘留': REF_DOTKEY_SURVIVOR },
      '存留的「無辜.殘留」key 經 client update 整欄寫回後必須原樣，不可變形為巢狀')
    st.diagnostic(`寫回後 descriptionRefs=${JSON.stringify(talent.descriptionRefs)}`)
  })

  await t.test('c. anchor 三種形態完整往返；無錨站點不帶 anchor', async (st) => {
    const byName = onePatch(buffSnap.patches, 'pilots', 'talents.0.buffIds', 'arrayRemove')
    assert.deepEqual(byName.anchor, { by: 'name', value: '悖想先驅' })

    const byLevel = onePatch(buffSnap.patches, 'pilots', 'neuralDrive.0.levels.0.buffIds', 'arrayRemove')
    assert.deepEqual(byLevel.anchor, { by: 'level', value: 3 })
    assert.equal(typeof byLevel.anchor!.value, 'number', 'level 錨點值必須保持 number')

    const byMinSum = onePatch(buffSnap.patches, 'pilots', 'talents.0.ndVariants.0.descriptionRefs.凝勢.強化', 'mapKeyDelete')
    assert.deepEqual(byMinSum.anchor, { by: 'minSum', value: 120 })
    assert.equal(typeof byMinSum.anchor!.value, 'number', 'minSum 錨點值必須保持 number')

    const noAnchor = onePatch(buffSnap.patches, 'pilotSkills', 'buffIds', 'arrayRemove')
    assert.equal(noAnchor.anchor, undefined, 'pilotSkills 頂層 buffIds 無錨可用，anchor 欄位應不存在')
    st.diagnostic(`anchors=${JSON.stringify([byName.anchor, byLevel.anchor, byMinSum.anchor])}`)
  })

  await t.test('d. arrayRemove 保留 @N 原字串；mapKeyDelete 是完整 EntityRef；fieldClear 保留純量', async (st) => {
    assert.equal(onePatch(buffSnap.patches, 'pilots', 'talents.0.buffIds', 'arrayRemove').value,
      'buff_target@3', 'arrayRemove 的 value 必須是含 @N 的原始元素字串')
    assert.equal(onePatch(buffSnap.patches, 'pilots', 'neuralDrive.0.levels.0.buffIds', 'arrayRemove').value,
      'buff_target', '無 @N 的元素保持原樣')
    assert.equal(onePatch(buffSnap.patches, 'pilotSkills', 'buffIds', 'arrayRemove').value,
      'buff_target@2')

    assert.deepEqual(
      onePatch(buffSnap.patches, 'pilots', 'talents.0.descriptionRefs.凝勢.強化', 'mapKeyDelete').value,
      REF_DOTKEY_TARGET,
      'mapKeyDelete 的 value 必須是完整 EntityRef 物件（含 label / level）')
    assert.deepEqual(
      onePatch(buffSnap.patches, 'buffs', 'descriptionRefs.凝勢', 'mapKeyDelete').value,
      REF_OTHER_TO_TARGET)
    assert.deepEqual(
      onePatch(termSnap.patches, 'buffs', 'descriptionRefs.灼燒', 'mapKeyDelete').value,
      REF_TERM)

    const fieldClear = onePatch(termSnap.patches, 'buffs', 'termRef', 'fieldClear')
    assert.equal(fieldClear.value, 'term_灼燒', 'fieldClear 的 value 保留原純量')
    const refBuff = await readDoc('buffs', 'buff_引用者')
    assert.ok(!('termRef' in refBuff!), 'termRef 欄位應被 deleteField 整個移除（非設為 null/空字串）')
    st.diagnostic(`mapKeyDelete value 讀回=${JSON.stringify(
      onePatch(buffSnap.patches, 'pilots', 'talents.0.descriptionRefs.凝勢.強化', 'mapKeyDelete').value)}`)
  })

  await t.test('e. textFreeze：正文凍成常數、只凍目標 token；快照存凍結前原文', async (st) => {
    // 資料庫真實狀態：目標 token 已烘焙成常數，指向他人的 token 原樣
    const p1 = await readDoc('pilots', 'p1')
    const talent = (p1!.talents as Array<Record<string, unknown>>)[0]
    assert.equal(talent.description, TALENT_DESC_FROZEN,
      '<buff_target.maxStack> 應凍成 7，<buff_other.duration> 應原樣保留')
    const ndLevel = ((p1!.neuralDrive as Array<Record<string, unknown>>)[0]
      .levels as Array<Record<string, unknown>>)[0]
    assert.equal(ndLevel.effect, ND_EFFECT_FROZEN, '<buff_target.lv2.maxStack> 應照 levels[1].maxStack 凍成 9')
    const other = await readDoc('buffs', 'buff_other')
    assert.equal(other!.description, OTHER_DESC_FROZEN,
      '<buff_target.duration> 凍成 3、buff_other 自身的 token 原樣')

    // 快照側：value 是凍結前的完整原文（還原要回到 token 形式）
    assert.equal(onePatch(buffSnap.patches, 'pilots', 'talents.0.description', 'textFreeze').value, TALENT_DESC)
    assert.equal(onePatch(buffSnap.patches, 'pilots', 'neuralDrive.0.levels.0.effect', 'textFreeze').value, ND_EFFECT)
    assert.equal(onePatch(buffSnap.patches, 'buffs', 'description', 'textFreeze').value, OTHER_DESC)
    st.diagnostic(`凍結後 talent.description=${String(talent.description)}`)
    st.diagnostic(`凍結後 buff_other.description=${String(other!.description)}`)
  })

  await t.test('f. snapshot.doc 深度相等；expireAt 為 Timestamp ≈ now + 2 年', async (st) => {
    const { id: _ignored, ...targetWant } = TARGET_SEED
    assert.deepEqual(buffSnap.doc, targetWant,
      'snapshot.doc 讀回必須與種入文件深度相等（巢狀陣列/map/布林/數字全保真）')

    assert.ok(buffLog!.expireAt instanceof Timestamp,
      `expireAt 讀回應為 Firestore Timestamp，實得 ${Object.prototype.toString.call(buffLog!.expireAt)}`)
    const expireMs = (buffLog!.expireAt as InstanceType<typeof Timestamp>).toMillis()
    const expected = new Date()
    expected.setFullYear(expected.getFullYear() + 2)
    const driftMs = Math.abs(expireMs - expected.getTime())
    assert.ok(driftMs < 10 * 60 * 1000,
      `expireAt 應約等於 now+2 年（偏差 ${Math.round(driftMs / 1000)}s 超過容忍值 600s）`)

    assert.ok(buffLog!.at instanceof Timestamp, 'at（serverTimestamp）讀回也應為 Timestamp')
    st.diagnostic(`expireAt=${new Date(expireMs).toISOString()} 偏差=${Math.round(driftMs / 1000)}s`)
  })

  await t.test('g. 人工還原演練：照快照反向套用後與最初種入完全一致', async (st) => {
    // 只憑快照內容 + adminDb，不呼叫任何 src 還原程式（Phase F 尚未存在）
    await restoreFromSnapshot('buffs', 'buff_target', buffSnap)
    await restoreFromSnapshot('glossaryTerms', 'term_灼燒', termSnap)

    let compared = 0
    for (const [coll, docs] of Object.entries(SEEDS)) {
      for (const { id, ...want } of docs) {
        const got = await readDoc(coll, id)
        assert.deepEqual(got, want, `${coll}/${id} 還原後應與最初種入完全一致`)
        compared++
      }
    }
    assert.equal(compared, 7, '應比對全部 7 份種入文件')
    st.diagnostic(`人工還原後 ${compared} 份文件全數與最初種入 deepEqual`)
  })
})
