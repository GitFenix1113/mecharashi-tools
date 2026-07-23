/**
 * PLAN-031 武器製作關係層 — A-1 進階鏈推導腳本
 *
 * 讀取所有 weapons，用「極大真子集」推導武器進階／複合製作關係：
 *   對每把有技能的武器 child，找出「技能名集合為 child 之真子集」的所有武器，
 *   套用硬約束守衛後，取「極大者」（不被其他候選包含者）為母武器 fromWeaponId。
 *
 * 硬約束守衛（PLAN-031 決策，違反者不建邊、丟進報告等人工確認）：
 *   ① 稀有度單調：rank(parent) ≤ rank(child)（B<A<S<S+<SS）
 *   ② 同 kind：parent.kind === child.kind
 *
 * 複合武器判別（雙判別式須一致，不一致才人工介入）：
 *   主：同稀有度邊（parent.rarity === child.rarity，實測全站恰 2 條 SS→SS）
 *   交叉驗證：delta 技能的 buffIds 有以 '6' 開頭者（背包命名空間）
 *
 * ⚠ 推導鍵一律用 skill.name，不可用 skill.icon（name→icon 1:1，icon→name 非 1:1）。
 * ⚠ 本腳本純唯讀，不寫 Firestore。寫入由 C-1 patch-weapon-upgrade.mjs 執行。
 *
 * 使用方式：
 *   node scripts/derive-weapon-upgrade.mjs            ← dry-run：打 live 唯讀、印報告、寫對照檔
 *
 * 產物（gitignored）：scripts/temp_scripts/plan031-upgrade-edges.json
 *   { edges: [{ childId, fromWeaponId, isComposite, deltaSkills, fusedBuffIds }], ambiguous, unresolvedByGuard }
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const OUT_DIR = resolve(ROOT, 'scripts/temp_scripts')
const OUT_FILE = resolve(OUT_DIR, 'plan031-upgrade-edges.json')

// ── Firebase 初始化（同 migrate-plan004-skills.mjs）─────────────────────────────
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

// ── 工具 ────────────────────────────────────────────────────────────────────────
const norm = (s) => (s ?? '').toString().trim()

/** 稀有度排名（越大越高階）。未知值 → 0，會被守衛擋下並進報告。 */
const RARITY_RANK = { B: 1, A: 2, S: 3, 'S+': 4, SS: 5 }
const rank = (r) => RARITY_RANK[norm(r)] ?? 0

/** 由武器物件取技能名集合（推導鍵 = skill.name，絕不用 icon） */
function skillNameSet(w) {
  const arr = Array.isArray(w.skills) ? w.skills : []
  return new Set(arr.map(s => norm(s.name)).filter(Boolean))
}

/** a ⊆ b ? */
function isSubset(a, b) {
  for (const x of a) if (!b.has(x)) return false
  return true
}
/** a ⊊ b ?（真子集：a ⊆ b 且 |a| < |b|） */
function isProperSubset(a, b) {
  return a.size < b.size && isSubset(a, b)
}

async function main() {
  console.log('🔧 PLAN-031 A-1 進階鏈推導（DRY-RUN 唯讀，打 live）\n')
  initFirebase()

  const snap = await db.collection('weapons').get()
  const weapons = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.id.localeCompare(b.id))   // 決定性排序
  console.log(`📦 讀到 ${weapons.length} 把武器`)

  // 預算每把武器的技能名集合；只有「有技能」者能當 child 或 parent
  const withSkills = weapons
    .map(w => ({ w, set: skillNameSet(w) }))
    .filter(x => x.set.size > 0)
  console.log(`   其中有技能武器：${withSkills.length}\n`)

  const edges = []               // { childId, childName, fromWeaponId, fromName, ... }
  const ambiguous = []           // { childId, childName, candidates:[ids] } 多個極大候選
  const unresolvedByGuard = []   // { childId, childName, filtered:[{id,reason}] } 有子集候選但被守衛全擋
  const roots = []               // 無任何真子集候選（進階鏈起點）

  for (const { w: child, set: childSet } of withSkills) {
    // 1) 找所有「技能名為 child 真子集」的武器（尚未套守衛）
    const rawCandidates = withSkills.filter(({ w: p, set: pSet }) =>
      p.id !== child.id && isProperSubset(pSet, childSet))

    if (rawCandidates.length === 0) { roots.push(child); continue }

    // 2) 套硬約束守衛：稀有度單調 + 同 kind
    const filteredOut = []
    const valid = rawCandidates.filter(({ w: p }) => {
      const reasons = []
      if (rank(p.rarity) > rank(child.rarity)) reasons.push(`稀有度 ${p.rarity}>${child.rarity}`)
      if (norm(p.kind) !== norm(child.kind)) reasons.push(`kind ${p.kind}≠${child.kind}`)
      if (reasons.length) { filteredOut.push({ id: p.id, reason: reasons.join(' / ') }); return false }
      return true
    })

    if (valid.length === 0) {
      unresolvedByGuard.push({ childId: child.id, childName: child.name, filtered: filteredOut })
      continue
    }

    // 3) 取極大者：不被其他有效候選之技能集真包含者
    const maximal = valid.filter(({ set: aSet }) =>
      !valid.some(({ set: bSet }) => isProperSubset(aSet, bSet)))

    if (maximal.length > 1) {
      ambiguous.push({
        childId: child.id, childName: child.name,
        candidates: maximal.map(({ w: p }) => `${p.id}（${p.name}）`),
      })
      continue
    }

    // 4) 唯一母武器 → 建邊
    const parent = maximal[0].w
    const parentSet = maximal[0].set
    const deltaSkills = [...childSet].filter(n => !parentSet.has(n))

    // 複合判別：主＝同稀有度邊；交叉＝delta 技能帶 6 開頭 buffId
    const sameRarity = norm(parent.rarity) === norm(child.rarity)
    const deltaSkillObjs = (child.skills || []).filter(s => deltaSkills.includes(norm(s.name)))
    const fusedBuffIds = deltaSkillObjs
      .flatMap(s => Array.isArray(s.buffIds) ? s.buffIds : [])
      .filter(id => String(id).startsWith('6'))
    const hasBackpackBuff = fusedBuffIds.length > 0
    const descHasBackpack = norm(child.description).includes('背包')

    edges.push({
      childId: child.id, childName: child.name,
      fromWeaponId: parent.id, fromName: parent.name,
      childRarity: child.rarity, parentRarity: parent.rarity, kind: child.kind,
      deltaSkills,
      // 複合武器：主判別式（同稀有度）與交叉驗證（背包 buffId）
      compositeBySameRarity: sameRarity,
      compositeByBuffId: hasBackpackBuff,
      descHasBackpack,
      fusedBuffIds,
      // 兩判別式一致才視為確定的複合武器
      isComposite: sameRarity && hasBackpackBuff,
      compositeConflict: sameRarity !== hasBackpackBuff,   // 不一致 → 人工介入
    })
  }

  // ── fan-out 檢查：一個母武器指向多個子武器 ────────────────────────────────────
  const fanOut = new Map()
  for (const e of edges) {
    if (!fanOut.has(e.fromWeaponId)) fanOut.set(e.fromWeaponId, [])
    fanOut.get(e.fromWeaponId).push(e.childId)
  }
  const multiFanOut = [...fanOut.entries()].filter(([, kids]) => kids.length > 1)

  // ── 報告 ─────────────────────────────────────────────────────────────────────
  console.log('── 推導結果 ──────────────────────────────')
  console.log(`  有技能武器：      ${withSkills.length}`)
  console.log(`  唯一邊：          ${edges.length}`)
  console.log(`  歧義（多極大）：  ${ambiguous.length}`)
  console.log(`  守衛全擋（unresolved）：${unresolvedByGuard.length}`)
  console.log(`  進階鏈起點（無母）：${roots.length}`)
  console.log(`  fan-out>1 的母武器：${multiFanOut.length}`)

  const composites = edges.filter(e => e.isComposite)
  const conflicts = edges.filter(e => e.compositeConflict)
  const ssToss = edges.filter(e => norm(e.parentRarity) === 'SS' && norm(e.childRarity) === 'SS')
  const splusToss = edges.filter(e => norm(e.parentRarity) === 'S+' && norm(e.childRarity) === 'SS')
  console.log(`\n  稀有度躍遷：      S+→SS ${splusToss.length} 條 / SS→SS ${ssToss.length} 條`)
  console.log(`  確定複合武器（雙判別式一致）：${composites.length}`)
  console.log(`  複合判別式衝突（需人工）：    ${conflicts.length}`)

  if (composites.length) {
    console.log('\n── 複合武器（同稀有度 + 背包 buffId 皆命中）──')
    composites.forEach(e => console.log(
      `  ${e.childName}（${e.childId}）← 母 ${e.fromName}｜融合技能 [${e.deltaSkills.join(', ')}]｜buffId ${e.fusedBuffIds.join(',')}`))
  }
  if (conflicts.length) {
    console.log('\n⚠ ── 複合判別式衝突（同稀有度與背包 buffId 不一致，須人工確認）──')
    conflicts.forEach(e => console.log(
      `  ${e.childName}（${e.childId}）← ${e.fromName}｜sameRarity=${e.compositeBySameRarity} buffId=${e.compositeByBuffId} desc含背包=${e.descHasBackpack}`))
  }
  if (ambiguous.length) {
    console.log('\n⚠ ── 歧義：多個極大真子集候選（須人工指定母武器）──')
    ambiguous.forEach(a => console.log(`  ${a.childName}（${a.childId}）候選：${a.candidates.join(' , ')}`))
  }
  if (unresolvedByGuard.length) {
    console.log('\n⚠ ── 有子集候選但被守衛全擋（確認守衛是否過嚴 / 是否真無母）──')
    unresolvedByGuard.forEach(u => console.log(
      `  ${u.childName}（${u.childId}）被擋：${u.filtered.map(f => `${f.id}[${f.reason}]`).join(' ; ')}`))
  }
  if (multiFanOut.length) {
    console.log('\n── fan-out>1（一母多子，未來需反向索引改陣列）──')
    multiFanOut.forEach(([p, kids]) => console.log(`  ${p} → ${kids.join(' , ')}`))
  }

  // ── 已知正解回歸抽查（站長提供 + 計畫書記載）──────────────────────────────────
  console.log('\n── 已知正解回歸抽查 ──')
  const findEdge = (childKey) => edges.find(e => e.childName.includes(childKey) || e.childId.includes(childKey))
  const checks = [
    ['終末之嘆', '夜魘'],   // 夜魘·改 → 終末之嘆
    ['熠光', '炬塔'],       // 炬塔·改 → 熠光
    ['裁決者', '熠光'],     // 熠光 → 裁決者（複合）
    ['糖衣毀滅者', '草莓'], // 草莓通心粉 → 糖衣毀滅者（複合）
  ]
  for (const [childKey, expectParentKey] of checks) {
    const e = findEdge(childKey)
    if (!e) { console.log(`  ✗ ${childKey}：無邊（未推出母武器）`); continue }
    const ok = e.fromName.includes(expectParentKey)
    console.log(`  ${ok ? '✓' : '✗'} ${e.childName} ← ${e.fromName}（期望母含「${expectParentKey}」）${e.isComposite ? ' [複合]' : ''}`)
  }

  // ── 天燼現況（站長口述、浮游炮系，備份時未確認是否已上線）──────────────────────
  console.log('\n── 天燼現況（浮游炮系複合武器，站長口述）──')
  const tianjin = weapons.filter(w => norm(w.name).includes('天燼'))
  if (tianjin.length === 0) {
    console.log('  ✗ live 查無「天燼」→ 若確為新武器，需先跑 data-patch 重抓 weapons')
  } else {
    tianjin.forEach(w => {
      const e = edges.find(x => x.childId === w.id)
      console.log(`  ✓ ${w.name}（${w.id}）rarity=${w.rarity} kind=${w.kind} 技能數=${(w.skills||[]).length}` +
        (e ? `｜推出母 ${e.fromName}${e.isComposite ? ' [複合]' : ''}` : '｜無母武器邊'))
    })
  }

  // ── 寫對照檔（gitignored）──────────────────────────────────────────────────────
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    counts: {
      weapons: weapons.length, withSkills: withSkills.length,
      edges: edges.length, ambiguous: ambiguous.length,
      unresolvedByGuard: unresolvedByGuard.length, roots: roots.length,
      composites: composites.length, conflicts: conflicts.length,
    },
    edges, ambiguous, unresolvedByGuard,
  }, null, 2), 'utf-8')
  console.log(`\n📝 對照檔已寫出：${path.relative(ROOT, OUT_FILE)}`)
  console.log('\n[DRY-RUN] 未寫入 Firestore。審閱報告與對照檔無誤後，再進 A-2 型別與 C-1 寫入。')
}

main().catch(err => {
  console.error('\n❌ 失敗：', err.message)
  console.error(err.stack)
  process.exit(1)
})
