/**
 * PLAN-019 Layer 1 驗證用 seed 腳本
 *
 * 以「海莉絲」的天賦「悖想先驅」為例，示範引用層：
 *   1. 在 buffs 集合種入 3 筆 BUFF（形態增益 / 虛粒子形態 / 激發能）
 *   2. 為悖想先驅天賦填入 descriptionRefs，把描述中的 [xxx] 對應到上述 buff
 *
 * 使用方式：
 *   node scripts/seed-plan019-demo.mjs --inspect   ← 只印出海莉絲的天賦原文，不寫入
 *   node scripts/seed-plan019-demo.mjs             ← 實際寫入（互動確認）
 *   node scripts/seed-plan019-demo.mjs --auto      ← 略過確認直接寫入
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
const AUTO = args.includes('--auto')

const PILOT_NAME = '海莉絲'
const TALENT_NAME = '悖想先驅'

// ── 要種入的 BUFF ───────────────────────────────────────────────────────────
const BUFFS = [
  {
    id: 'buff_形態增益',
    name: '形態增益',
    buffType: 'statBoost',
    description:
      '先鋒形態：使用格鬥或射擊武器主動攻擊對戰時，命中率提升15%，發動[連續攻擊]，造成0.3倍傷害，觸發效果後移除；\n' +
      '突擊形態：使用突擊武器主動攻擊時，暴擊率提升15%，戰後對目標所有部位造成共計0.4倍武器攻擊力的[固定傷害]，觸發效果後移除；\n' +
      '戰術形態：使用戰術武器主動攻擊時，傷害提升15%，戰後對命中的目標施加[遭受傷害提升Ⅱ]，持續2回合，觸發效果後移除',
    descriptionRefs: {
      '連續攻擊':      { refType: 'term', refId: 'term_連續攻擊',      label: '連續攻擊' },
      '固定傷害':      { refType: 'term', refId: 'term_固定傷害',      label: '固定傷害' },
      '遭受傷害提升Ⅱ': { refType: 'term', refId: 'term_遭受傷害提升',  label: '遭受傷害提升Ⅱ' },
    },
    effects: [],
  },
  {
    id: 'buff_虛粒子形態',
    name: '虛粒子形態',
    buffType: 'state',
    mutexGroup: 'hailisi_forms',
    description: '粒子形態的受限狀態；累積5點[激發能]後可使用[粒子爆發]解除其限制。',
    descriptionRefs: {
      '激發能':   { refType: 'buff',  refId: 'buff_激發能' },
      '粒子爆發': { refType: 'skill', refId: 'skill_粒子爆發', label: '粒子爆發' },
    },
    effects: [],
  },
  {
    id: 'buff_激發能',
    name: '激發能',
    buffType: 'resource',
    maxStack: 5,
    description: '每次行動開始與[啟動]時獲得1點，累積5點後可使用[粒子爆發]。',
    descriptionRefs: {
      '啟動':     { refType: 'term',  refId: 'term_啟動', label: '啟動' },
      '粒子爆發': { refType: 'skill', refId: 'skill_粒子爆發', label: '粒子爆發' },
    },
    effects: [],
  },
]

// ── 悖想先驅天賦 description（更新為截圖中的當前遊戲原文，含 [xxx] 標記）──────
// 註：Firestore 既有為較舊/較短的擷取版本（缺 粒子爆發/虛粒子形態/形態增益 段落），
//     依使用者提供的截圖更新為當前台版完整原文，供引用層驗證。
const TALENT_DESCRIPTION =
  '駕駛的機甲擁有多種形態，擁有獨特的形態效果並可以獨立裝備武器背包；' +
  '每次行動開始和[啟動]時，獲得1點[激發能]，累積5點後可以使用[粒子爆發]解除[虛粒子形態]限制，每回合只能使用1次；' +
  '行動開始時，根據自身形態立即獲得相應的[形態增益]，攜帶[形態增益]時最終傷害提升15%'

// ── 悖想先驅天賦的 descriptionRefs ──────────────────────────────────────────
const TALENT_DESCRIPTION_REFS = {
  '啟動':      { refType: 'term',  refId: 'term_啟動',        label: '啟動' },
  '激發能':    { refType: 'buff',  refId: 'buff_激發能' },
  '粒子爆發':  { refType: 'skill', refId: 'skill_粒子爆發',   label: '粒子爆發' },
  '虛粒子形態': { refType: 'buff',  refId: 'buff_虛粒子形態' },
  '形態增益':  { refType: 'buff',  refId: 'buff_形態增益' },
}

// ── Firebase 初始化 ─────────────────────────────────────────────────────────
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
async function promptConfirm(q) {
  if (AUTO) return true
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim().toLowerCase() === 'y') }))
}

async function findPilot() {
  const snap = await db.collection('pilots').get()
  const matches = snap.docs.filter(d => {
    const n = d.data().name ?? ''
    const fn = d.data().fullName ?? ''
    return n.includes(PILOT_NAME) || fn.includes(PILOT_NAME)
  })
  return matches
}

async function main() {
  console.log(`🔧 PLAN-019 驗證 seed（${INSPECT ? 'INSPECT 只讀' : '寫入'}）\n`)
  initFirebase()

  const matches = await findPilot()
  if (matches.length === 0) {
    console.log(`❌ 找不到名稱含「${PILOT_NAME}」的機師。`)
    process.exit(1)
  }
  console.log(`📦 找到 ${matches.length} 位機師：`)
  matches.forEach(d => console.log(`   · id=${d.id}  name=${d.data().name}  fullName=${d.data().fullName ?? ''}`))

  // 取第一位（或精確 name 相符者）
  const pilotDoc = matches.find(d => d.data().name === PILOT_NAME) ?? matches[0]
  const pilot = pilotDoc.data()
  const talents = Array.isArray(pilot.talents) ? pilot.talents : []
  console.log(`\n🎯 使用機師 id=${pilotDoc.id}（${pilot.name}），天賦 ${talents.length} 個：`)
  talents.forEach((t, i) => console.log(`   [${i}] ${t.name}`))

  const tIdx = talents.findIndex(t => t.name === TALENT_NAME)
  if (tIdx < 0) {
    console.log(`\n❌ 找不到天賦「${TALENT_NAME}」。請確認天賦名稱。`)
    process.exit(1)
  }
  const talent = talents[tIdx]
  console.log(`\n── 天賦「${talent.name}」description 原文 ──`)
  console.log(talent.description)
  console.log(`── 現有 descriptionRefs：${JSON.stringify(talent.descriptionRefs ?? null)} ──`)

  // 檢查括號 token 是否與我們的 refs key 對得上
  const bracketTokens = [...(talent.description ?? '').matchAll(/\[([^\]]+)\]/g)].map(m => m[1])
  console.log(`\n🔎 description 內的 [xxx] token：${JSON.stringify(bracketTokens)}`)
  const refKeys = Object.keys(TALENT_DESCRIPTION_REFS)
  const matched = refKeys.filter(k => bracketTokens.includes(k))
  const missing = refKeys.filter(k => !bracketTokens.includes(k))
  console.log(`   ✓ 對得上：${JSON.stringify(matched)}`)
  if (missing.length) console.log(`   ⚠ 對不上（描述中無此 token，將不會顯示可點擊）：${JSON.stringify(missing)}`)

  if (INSPECT) {
    console.log('\n[INSPECT] 未寫入任何資料。')
    return
  }

  console.log('\n將寫入：')
  console.log(`   · buffs 集合 3 筆：${BUFFS.map(b => b.id).join(', ')}`)
  console.log(`   · pilots/${pilotDoc.id} 的天賦「${TALENT_NAME}」description（更新為截圖原文）+ descriptionRefs`)
  console.log(`\n   新 description：\n   ${TALENT_DESCRIPTION}`)
  const ok = await promptConfirm('\n確認寫入 Firestore？ [y/N] ')
  if (!ok) { console.log('已取消。'); process.exit(0) }

  // 1) 種 buffs
  const batch = db.batch()
  for (const b of BUFFS) {
    batch.set(db.collection('buffs').doc(b.id), b, { merge: true })
  }
  await batch.commit()
  console.log(`✅ 已寫入 ${BUFFS.length} 筆 buffs`)

  // 2) patch talent description + descriptionRefs（只動目標天賦，其餘保留）
  const newTalents = talents.map((t, i) =>
    i === tIdx ? { ...t, description: TALENT_DESCRIPTION, descriptionRefs: TALENT_DESCRIPTION_REFS } : t
  )
  await db.collection('pilots').doc(pilotDoc.id).update({ talents: newTalents })
  console.log(`✅ 已更新 pilots/${pilotDoc.id} 天賦「${TALENT_NAME}」的 descriptionRefs`)

  console.log('\n🎉 完成！前台到「海莉絲」詳情頁 → 天賦分頁，點擊 [形態增益] 等詞條即可看到抽屜。')
}

main().catch(err => {
  console.error('\n❌ 失敗：', err.message)
  console.error(err.stack)
  process.exit(1)
})
