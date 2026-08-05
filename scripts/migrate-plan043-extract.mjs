/**
 * PLAN-043 背包技能集合 — 遷移 Stage 1（抽出）
 *
 * 讀取所有 backpacks，把內嵌的 mainSkill 抽成獨立的 backpackSkills 文件，
 * 並把對應的 doc id 寫回 Backpack.skillIds[]。
 *
 * **本腳本不刪除 mainSkill**（那是 Stage 2 migrate-plan043-flip.mjs 的事）。
 * 兩段式的理由見計畫書決策四：前台改讀 skillIds 必須先上線，否則活站整區空白。
 * 此階段結束後兩種格式並存，前台仍讀舊的，零風險。
 *
 * 使用方式：
 *   node scripts/migrate-plan043-extract.mjs            ← dry-run：只算、印報告、寫對照檔，不碰 Firestore
 *   node scripts/migrate-plan043-extract.mjs --apply    ← 互動確認後寫入，並自動 bump 兩個集合的版本
 *
 * 產物（gitignored）：scripts/temp_scripts/plan043-backpack-skill-map.json
 *   { skills: BackpackSkillDoc[], backpackSkillIds: { [backpackId]: string[] } }
 *
 * ── 去重鍵：一律用 skill.name，絕不可用 icon ────────────────────────────────
 * PLAN-032 實測：107 個 icon 中有 11 個對到 2–3 個不同技能名。以 icon 去重會把
 * 不同技能合併成同一筆，而合併後看起來完全正常——沒有任何錯誤訊息。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'
import readline from 'readline'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')

const OUT_DIR = resolve(ROOT, 'scripts/temp_scripts')
const OUT_FILE = resolve(OUT_DIR, 'plan043-backpack-skill-map.json')

// ── Firebase 初始化（同 migrate-plan004-skills.mjs）────────────────────────────
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

// ── 工具 ──────────────────────────────────────────────────────────────────────
const norm = (s) => (s ?? '').toString().trim()
/** Firestore 文件 ID 不可含 '/'；技能名極少含之，仍保險替換 */
const slugName = (name) => norm(name).replace(/\//g, '_')

/**
 * 圖示路徑正規化：DB 內的 mainSkill.icon 存的是 scraper 寫入的 bare key
 * （如 'Icon_skill_passive_1234'）或扁平路徑，與技能庫的 `/images/...` 慣例不一致。
 *
 * ⚠ 這裡只補副檔名與 `/images/skills/` 前綴，**不**把它移進「背包技能/」子資料夾——
 * 那些圖現在實際躺在哪裡由檔案系統決定，腳本猜不得。前端的 normalizeSkillPath 會依
 * 檔名前綴解析到「被動技能/」，維持與遷移前完全相同的顯示結果。
 * 待 E-1 圖庫資料夾建好、圖片實際放進去後，再由後台逐筆改指到「背包技能/」。
 */
function normalizeIcon(icon) {
  const v = norm(icon)
  if (!v) return ''
  if (/^https?:\/\//i.test(v)) return v          // 官方 CDN 絕對網址，原樣保留
  if (v.includes('/')) return v                  // 已是路徑形式，不動
  return `/images/skills/${v}${/\.\w+$/.test(v) ? '' : '.png'}`
}

/** 由內嵌 mainSkill 建出 BackpackSkillDoc（省略 undefined，Firestore 不接受） */
function buildDoc(id, skill) {
  const doc = {
    id,
    name: norm(skill.name),
    // 遊戲內背包技能欄位標「類型：被動技能」；舊資料無此欄位，統一給預設值。
    // 若日後出現主動型背包技能，由後台逐筆改，不在此猜。
    skillType: '被動技能',
    description: norm(skill.description),
    icon: normalizeIcon(skill.icon),
    effects: [],                                  // 舊 mainSkill 無結構化 effects，待後台補
    buffIds: Array.isArray(skill.buffIds) ? skill.buffIds.filter(Boolean) : [],
  }
  if (skill.descriptionRefs !== undefined) doc.descriptionRefs = skill.descriptionRefs
  // 官方數字 id（如 '62304'）：純備查。Phase E flip 刪掉 mainSkill 後就再也找不回來
  if (norm(skill.id)) doc.officialId = norm(skill.id)
  // 舊格式的四個平坦數值與 specialEffects 沒有對應欄位。**不可靜默丟棄** ——
  // 有值就轉成 effects 條目（stat 名與 SkillEffect 對齊），specialEffects 併進 flavor。
  const flat = [['dmg', skill.dmg], ['crit', skill.crit], ['critDmg', skill.critDmg], ['acc', skill.acc]]
  for (const [stat, value] of flat) {
    if (typeof value === 'number' && value !== 0) {
      doc.effects.push({ stat, value, scope: 'self', condition: null })
    }
  }
  // specialEffects 在正式庫實測 0/22 有值，故 BackpackSkillDoc 沒有對應欄位。
  // 萬一真的出現就**大聲失敗**而非靜默丟掉——遷移最不該做的事就是無聲遺失資料。
  const se = Array.isArray(skill.specialEffects) ? skill.specialEffects.filter(Boolean) : []
  if (se.length) {
    throw new Error(
      `技能「${doc.name}」的 mainSkill.specialEffects 有值（${JSON.stringify(se)}），` +
      `但 BackpackSkillDoc 無對應欄位。請先決定要收進哪裡（description？新欄位？）再重跑。`,
    )
  }
  return doc
}

/** 「較豐富者勝」：同名技能在不同背包上各有部分手動資料時，合併而非讓先遇到的空殼獲勝 */
function mergeRicher(doc, skill) {
  if ((doc.buffIds?.length ?? 0) === 0 && Array.isArray(skill.buffIds) && skill.buffIds.length) {
    doc.buffIds = skill.buffIds.filter(Boolean)
  }
  if (!doc.descriptionRefs && skill.descriptionRefs) doc.descriptionRefs = skill.descriptionRefs
  if (!doc.icon && skill.icon) doc.icon = normalizeIcon(skill.icon)
  if (!doc.description && skill.description) doc.description = norm(skill.description)
}

async function main() {
  console.log(`🔧 PLAN-043 Stage 1 背包技能抽出（${APPLY ? 'APPLY 寫入' : 'DRY-RUN 預覽'}）\n`)
  initFirebase()

  const snap = await db.collection('backpacks').get()
  // 以 doc id 排序確保去重的「base 名稱歸屬」具決定性（重跑結果相同）
  const backpacks = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.id.localeCompare(b.id))
  console.log(`📦 讀到 ${backpacks.length} 個背包\n`)

  // name -> [{ desc, id, backpackIds:Set, doc }]
  const byName = new Map()
  const skills = []              // 去重後的 doc 陣列
  const backpackSkillIds = {}    // backpackId -> [skillId,...]
  let withSkill = 0
  const alreadyMigrated = []
  const byRarity = {}

  for (const bp of backpacks) {
    byRarity[bp.rarity] = (byRarity[bp.rarity] ?? 0) + 1

    // 已有 skillIds（重跑本腳本、或後台已手動掛過）→ 原樣保留，不覆蓋
    if (Array.isArray(bp.skillIds) && bp.skillIds.length) {
      alreadyMigrated.push(bp.id)
      backpackSkillIds[bp.id] = bp.skillIds
      continue
    }

    const skill = bp.mainSkill
    if (!skill || !norm(skill.name)) { backpackSkillIds[bp.id] = []; continue }
    withSkill++

    const name = norm(skill.name)
    const desc = norm(skill.description)
    let entry = byName.get(name)
    if (!entry) { entry = []; byName.set(name, entry) }
    let found = entry.find(e => e.desc === desc)
    if (!found) {
      // 同名不同效 → 加背包 id 後綴區分（報告會標出來要求人工確認）
      const isFirst = entry.length === 0
      const id = isFirst ? `bpskill_${slugName(name)}` : `bpskill_${slugName(name)}_${bp.id}`
      const doc = buildDoc(id, skill)
      found = { desc, id, backpackIds: new Set(), doc }
      entry.push(found)
      skills.push(doc)
    } else {
      mergeRicher(found.doc, skill)
    }
    found.backpackIds.add(bp.id)
    backpackSkillIds[bp.id] = [found.id]
  }

  // ── 報告 ──────────────────────────────────────────────────────────────────
  const shared = []
  const collisions = []
  for (const [name, entry] of byName) {
    if (entry.length > 1) collisions.push({ name, ids: entry.map(e => e.id) })
    for (const e of entry) if (e.backpackIds.size > 1) shared.push({ id: e.id, count: e.backpackIds.size })
  }
  const noBuffIds = skills.filter(s => s.buffIds.length === 0).length
  const noIcon = skills.filter(s => !s.icon).length
  const withRefs = skills.filter(s => s.descriptionRefs).length
  const withEffects = skills.filter(s => s.effects.length > 0).length

  console.log('── 背包稀有度分佈 ────────────────────────')
  Object.entries(byRarity).sort().forEach(([r, n]) => console.log(`  ${r.padEnd(3)} ${n}`))

  console.log('\n── 抽出結果 ──────────────────────────────')
  console.log(`  含 mainSkill 的背包：${withSkill}`)
  console.log(`  去重後唯一技能：    ${skills.length}`)
  console.log(`  跨背包共用（>1）：  ${shared.length}`)
  console.log(`  同名不同效碰撞：    ${collisions.length}`)
  if (alreadyMigrated.length) {
    console.log(`  已有 skillIds 而跳過：${alreadyMigrated.length}（${alreadyMigrated.slice(0, 5).join(', ')}${alreadyMigrated.length > 5 ? ' …' : ''}）`)
  }

  console.log('\n── 資料完整度（待後台補的量）────────────')
  console.log(`  buffIds 為空：      ${noBuffIds}/${skills.length}`)
  console.log(`  icon 為空：         ${noIcon}/${skills.length}`)
  console.log(`  有 descriptionRefs：${withRefs}/${skills.length}`)
  console.log(`  有 effects（由平坦數值轉出）：${withEffects}/${skills.length}`)

  if (shared.length) {
    console.log('\n── 共用技能（多個背包指向同一 doc）──')
    shared.sort((a, b) => b.count - a.count)
      .forEach(s => console.log(`  ×${s.count}  ${s.id}`))
  }
  if (collisions.length) {
    console.log('\n⚠ 同名不同效（已用 _<backpackId> 後綴區分，請人工確認是否真的是不同技能）')
    collisions.forEach(c => console.log(`  「${c.name}」→ ${c.ids.join(' , ')}`))
  }

  console.log('\n── 技能一覽 ──────────────────────────────')
  skills.forEach(s => {
    const holders = byName.get(s.name)?.find(e => e.id === s.id)?.backpackIds.size ?? 0
    console.log(`  ${s.id}`)
    console.log(`      掛載 ${holders} 個背包 · buffIds ${s.buffIds.length} · icon ${s.icon || '(無)'}`)
    console.log(`      ${s.description.slice(0, 70)}${s.description.length > 70 ? '…' : ''}`)
  })

  // ── 一致性檢查：Stage 2 flip 的前置條件 ──────────────────────────────────
  const lost = backpacks.filter(bp =>
    bp.mainSkill && norm(bp.mainSkill.name) && !(backpackSkillIds[bp.id] ?? []).length)
  if (lost.length) {
    console.error(`\n❌ 有 ${lost.length} 個背包的 mainSkill 沒對應到任何 skillId：${lost.map(b => b.id).join(', ')}`)
    console.error('   這代表抽出邏輯有漏，Stage 2 flip 會直接遺失資料。中止。')
    process.exit(1)
  }

  // ── 寫對照檔（gitignored）────────────────────────────────────────────────
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify({ skills, backpackSkillIds }, null, 2), 'utf-8')
  console.log(`\n📝 對照檔已寫出：${path.relative(ROOT, OUT_FILE)}`)

  if (!APPLY) {
    console.log('\n[DRY-RUN] 未寫入 Firestore。審閱上方報告（特別是同名不同效那段）無誤後加 --apply。')
    return
  }

  // ── 寫入（互動確認，不盲寫）──────────────────────────────────────────────
  const bpUpdates = Object.entries(backpackSkillIds)
  console.log(`\n將寫入：backpackSkills ${skills.length} 筆新文件；backpacks ${bpUpdates.length} 筆補上 skillIds（不動 mainSkill）。`)
  const ok = await promptConfirm('確認寫入 Firestore？ [y/N] ')
  if (!ok) { console.log('已取消。'); process.exit(0) }

  let written = 0
  for (let i = 0; i < skills.length; i += 400) {
    const batch = db.batch()
    for (const doc of skills.slice(i, i + 400)) {
      batch.set(db.collection('backpackSkills').doc(doc.id), doc, { merge: true })
    }
    await batch.commit()
    written += Math.min(400, skills.length - i)
    console.log(`  …backpackSkills 已寫入 ${written}/${skills.length}`)
  }

  let patched = 0
  for (let i = 0; i < bpUpdates.length; i += 400) {
    const batch = db.batch()
    for (const [bpId, ids] of bpUpdates.slice(i, i + 400)) {
      // update 而非 set：文件必定存在，若此刻已不存在應該失敗而非重建成殘缺文件
      batch.update(db.collection('backpacks').doc(bpId), { skillIds: ids })
    }
    await batch.commit()
    patched += Math.min(400, bpUpdates.length - i)
    console.log(`  …backpacks 已補 skillIds ${patched}/${bpUpdates.length}`)
  }

  // ── bump 版本（寫在腳本裡，不靠人記）──────────────────────────────────────
  // 漏 bump 的症狀是「使用者持續讀到舊 localStorage 快取」，而操作者自己看起來一切正常。
  const version = new Date().toISOString()
  await db.doc('meta/gameData').set({
    versions: { backpacks: version, backpackSkills: version },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })

  console.log(`\n✅ 完成。backpackSkills ${skills.length} 筆、backpacks ${patched} 筆已更新。`)
  console.log(`   版本已 bump：backpacks / backpackSkills → ${version}`)
  console.log('   下一步：Phase C/D 讓前後台改讀 skillIds，確認線上正常後才可跑 Stage 2 flip。')
}

main().catch(err => {
  console.error('\n❌ 失敗：', err.message)
  console.error(err.stack)
  process.exit(1)
})
