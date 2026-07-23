/**
 * PLAN-031 C-1 — 武器製作關係寫入
 *
 * 讀 A-1 對照檔（scripts/temp_scripts/plan031-upgrade-edges.json），把進階關係寫進 weapons。
 * 分兩階段（用 setDoc merge:true 深層合併，兩階段互不覆蓋）：
 *
 *   base（預設）          ：42 條邊全部寫 { upgrade: { fromWeaponId } } —— 不需實機，推導 0 歧義。
 *   composite（--composite）：3 把複合武器補 { upgrade: { station, fusedBackpackId } }
 *                            fusedBackpackId 需實機確認；未確認者（COMPOSITE_FUSED 為 null）自動跳過。
 *
 * ⚠ 一律用對照檔的 childId / fromWeaponId（＝ doc id）比對，絕不用 name。
 * ⚠ 寫入前做參照完整性檢查：每個 childId 與 fromWeaponId 都必須是 live 上真實存在的 weapon doc。
 *
 * 使用方式：
 *   node scripts/patch-weapon-upgrade.mjs                    ← dry-run base（只印計畫）
 *   node scripts/patch-weapon-upgrade.mjs --apply            ← 寫入 base 42 筆 + bump weapons
 *   node scripts/patch-weapon-upgrade.mjs --composite        ← dry-run composite
 *   node scripts/patch-weapon-upgrade.mjs --composite --apply
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'
import readline from 'readline'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const EDGE_FILE = resolve(ROOT, 'scripts/temp_scripts/plan031-upgrade-edges.json')

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const YES = args.includes('--yes')   // 非互動套用（跳過 y/N 提示）
const PHASE = args.includes('--composite') ? 'composite' : 'base'

/**
 * 複合武器的融合背包（doc id → fusedBackpackId）。實機確認後手動填入；null = 待實機。
 * ⚠ 正解在 60X02405（S+）家族；勿填 606004xx（強化背包·首攻 / Enhance）。
 */
const COMPOSITE_FUSED = {
  'weapon_115_裁決者':     '60102405', // 出力強化背包·首攻（S+ / PowerAdd）—— 站長實機確認
  'weapon_146_糖衣毀滅者': '60102405', // 出力強化背包·首攻 —— 站長實機確認（2026-07-24）
  '天燼審判':              '60102405', // 出力強化背包·首攻 —— 站長實機確認（2026-07-24；doc id 無 weapon_ 前綴，屬實）
}

// ── Firebase 初始化 ─────────────────────────────────────────────────────────────
let db
function loadEnv(filename) {
  const envPath = resolve(ROOT, filename)
  if (!fs.existsSync(envPath)) return
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const eqIdx = line.indexOf('=')
    if (eqIdx > 0) {
      const k = line.slice(0, eqIdx).trim()
      const v = line.slice(eqIdx + 1).trim()
      if (k && v && !k.startsWith('#')) process.env[k] = v
    }
  })
}
function initFirebase() {
  loadEnv('.env')
  loadEnv('.env.migration')
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS 未設定')
  const absCredPath = resolve(ROOT, credPath)
  if (!fs.existsSync(absCredPath)) throw new Error(`找不到服務帳號金鑰：${absCredPath}`)
  const serviceAccount = JSON.parse(fs.readFileSync(absCredPath, 'utf-8'))
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  db = admin.firestore()
}
function promptConfirm(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim().toLowerCase() === 'y') }))
}

async function main() {
  console.log(`🔧 PLAN-031 C-1 武器製作關係寫入 · phase=${PHASE} · ${APPLY ? 'APPLY 寫入' : 'DRY-RUN 預覽'}\n`)

  if (!fs.existsSync(EDGE_FILE)) {
    throw new Error(`找不到 A-1 對照檔：${path.relative(ROOT, EDGE_FILE)}\n   請先跑 node scripts/derive-weapon-upgrade.mjs`)
  }
  const edgeMap = JSON.parse(fs.readFileSync(EDGE_FILE, 'utf-8'))
  const edges = edgeMap.edges ?? []
  console.log(`📄 對照檔：${edges.length} 條邊（產生於 ${edgeMap.generatedAt ?? '?'}）`)
  if (edgeMap.counts?.ambiguous || edgeMap.counts?.unresolvedByGuard) {
    throw new Error(`對照檔含歧義(${edgeMap.counts.ambiguous})/守衛全擋(${edgeMap.counts.unresolvedByGuard})，請先人工處理，不可盲寫。`)
  }

  initFirebase()

  // ── 參照完整性：所有 childId / fromWeaponId 必須是 live 上真實存在的 doc ──────────
  const snap = await db.collection('weapons').get()
  const liveIds = new Set(snap.docs.map(d => d.id))
  const missing = new Set()
  for (const e of edges) {
    if (!liveIds.has(e.childId)) missing.add(e.childId)
    if (!liveIds.has(e.fromWeaponId)) missing.add(e.fromWeaponId)
  }
  if (missing.size) {
    throw new Error(`對照檔與 live 不一致，下列 id 在 weapons 集合不存在（對照檔過期？請重跑 derive）：\n   ${[...missing].join('\n   ')}`)
  }
  console.log(`✅ 參照完整性：${edges.length} 條邊的 child/parent doc 皆存在於 live（共 ${liveIds.size} 把武器）\n`)

  // ── 組寫入清單 ─────────────────────────────────────────────────────────────────
  let writes = []   // { id, upgrade }
  if (PHASE === 'base') {
    writes = edges.map(e => ({ id: e.childId, upgrade: { fromWeaponId: e.fromWeaponId } }))
    console.log('── base：寫入 upgrade.fromWeaponId（42 條邊，深層 merge 不動 station/fusedBackpackId）──')
    edges.forEach(e => console.log(`  ${e.childId.padEnd(28)} ← ${e.fromWeaponId}${e.isComposite ? '  [複合]' : ''}`))
  } else {
    // station 是推導事實（isComposite），3 把全部寫；fusedBackpackId 需實機，只寫已確認者。
    // merge:true 深層合併 → 只寫 station 不會清掉日後補的 fusedBackpackId，也不動 fromWeaponId。
    const composites = edges.filter(e => e.isComposite)
    const pendingFused = []
    for (const e of composites) {
      const fused = COMPOSITE_FUSED[e.childId]   // null = 待實機
      const upgrade = { station: 'specialBackpack' }
      if (fused != null) upgrade.fusedBackpackId = fused
      else pendingFused.push(e.childId)
      writes.push({ id: e.childId, upgrade })
    }
    console.log('── composite：寫入 upgrade.station（3 把全部，不需實機）+ fusedBackpackId（實機已確認者）──')
    writes.forEach(w => console.log(`  ${w.id.padEnd(28)} station=specialBackpack  fusedBackpackId=${w.upgrade.fusedBackpackId ?? '（待實機）'}`))
    if (pendingFused.length) {
      console.log('\n⏳ fusedBackpackId 待實機（station 已寫、複合 badge/facet 已可亮，只差「融合自 ○○」那行）：')
      pendingFused.forEach(id => console.log(`  ${id}`))
    }
  }

  if (writes.length === 0) {
    console.log('\n沒有可寫入的項目。')
    return
  }
  console.log(`\n合計 ${writes.length} 筆待寫入。`)

  if (!APPLY) {
    console.log('\n[DRY-RUN] 未寫入 Firestore。審閱無誤後加 --apply 正式寫入。')
    return
  }

  // ── 寫入（互動確認 + merge，不盲寫）─────────────────────────────────────────────
  const ok = YES || await promptConfirm(`\n確認寫入 weapons 集合 ${writes.length} 筆（merge:true）並 bump weapons 版本？ [y/N] `)
  if (!ok) { console.log('已取消。'); process.exit(0) }

  let written = 0
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch()
    for (const wr of writes.slice(i, i + 400)) {
      batch.set(db.collection('weapons').doc(wr.id), { upgrade: wr.upgrade }, { merge: true })
    }
    await batch.commit()
    written += Math.min(400, writes.length - i)
    console.log(`  …已寫入 ${written}/${writes.length}`)
  }

  // ── bump weapons 版本（同 bump-data-version.mjs 形制，只 bump 這一個 key）──────────
  const version = new Date().toISOString()
  await db.collection('meta').doc('gameData').set(
    { versions: { weapons: version }, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  )
  console.log(`\n✅ 完成。weapons 寫入 ${writes.length} 筆，版本已 bump（weapons=${version}）。`)
  console.log('   下一步：無痕視窗開一個有 upgrade 的武器詳情頁，確認進階鏈點亮。')
}

main().catch(err => {
  console.error('\n❌ 失敗：', err.message)
  process.exit(1)
})
