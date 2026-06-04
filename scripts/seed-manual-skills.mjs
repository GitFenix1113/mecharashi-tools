/**
 * PLAN-004 — 手動/條件技能補充（爬蟲無法擷取的 form-gated / 條件技能）
 *
 * 有些技能（如 粒子爆發）只在特定形態下可用，不在官網的固有技能列表中，
 * 爬蟲的 biometicComputer 擷取抓不到。這些以 manual:true 寫進 pilotSkills，
 * 爬蟲 --patch 模式不會覆寫或刪除 manual 技能。
 *
 * 使用方式：
 *   node scripts/seed-manual-skills.mjs            ← 互動確認後寫入
 *   node scripts/seed-manual-skills.mjs --inspect  ← 只印出，不寫入
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
const INSPECT = args.includes('--inspect')

// ── 要補的手動技能 ──────────────────────────────────────────────────────────
const MANUAL_SKILLS = [
  {
    id: 'skill_粒子爆發',
    name: '粒子爆發',
    type: '指令技能',
    ap: '0',
    cd: '0',
    description:
      '消耗所有[激發能]切換為[虛粒子形態]，獲得所有形態增益效果，並對2格內所有敵機所有部位造成相當於[海莉絲]機甲軀幹最大耐久值15%的[固定傷害]，行動2次後切換回當前形態；本技能不消耗任何AP',
    descriptionRefs: {
      '激發能':    { refType: 'buff',  refId: 'buff_激發能' },
      '虛粒子形態': { refType: 'buff',  refId: 'buff_虛粒子形態' },
      '海莉絲':    { refType: 'pilot', refId: 'pilot_049_海莉絲', label: '海莉絲' },
      '固定傷害':  { refType: 'term',  refId: 'term_固定傷害', label: '固定傷害' },
    },
    icon: '',
    iconLocal: '',
    effects: [],
    buffIds: ['buff_虛粒子形態'], // 賦予邊（PLAN-019 Layer 2）：此技能切換到虛粒子形態
    manual: true,
  },
]

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
  console.log(`🔧 手動技能補充（${INSPECT ? 'INSPECT 只讀' : '寫入'}）\n`)
  MANUAL_SKILLS.forEach(s => console.log(`   · ${s.id}（${s.name} / ${s.type}）`))
  if (INSPECT) { console.log('\n[INSPECT] 未寫入。'); return }

  initFirebase()
  const ok = await promptConfirm(`\n確認寫入 pilotSkills ${MANUAL_SKILLS.length} 筆（merge）？ [y/N] `)
  if (!ok) { console.log('已取消。'); process.exit(0) }

  const batch = db.batch()
  for (const s of MANUAL_SKILLS) batch.set(db.collection('pilotSkills').doc(s.id), s, { merge: true })
  await batch.commit()
  console.log(`✅ 已寫入 ${MANUAL_SKILLS.length} 筆 manual 技能。記得 bump 版本。`)
}

main().catch(err => {
  console.error('\n❌ 失敗：', err.message)
  console.error(err.stack)
  process.exit(1)
})
