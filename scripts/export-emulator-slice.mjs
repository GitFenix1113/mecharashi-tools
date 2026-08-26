#!/usr/bin/env node
/**
 * 匯出「模擬器測試用資料切片」（唯讀，PLAN-030 Phase 0 / 0-4）
 *
 * 從「正式」Firestore 撈出一小份、但引用關係完整的資料，供本地模擬器種子使用：
 *   · 指定的 1 名機師（預設引用關係最豐富的一位）
 *   · buffs / glossaryTerms / pilotSkills / neuralDriveAbilities 四個「字典型」集合整包
 *     （它們本來就是全站共用字典，量不大；整包帶走可免去在此重建引用圖）
 *
 * ⚠ 唯讀：只呼叫 .get()，**絕不寫入 Firestore**。這是整個 Phase 0 對正式資料庫的唯一一次接觸。
 *
 * 輸出：emulator-seed/<collection>.json（已被 .gitignore）
 *
 * ── `--simulator`：配裝模擬器需要的整包資料（PLAN-052-C 後補）──────────────────
 *
 * 上面那份切片是為 PLAN-030 的 rules 測試設計的（1 名機師 ＋ 四個字典集合），
 * **配裝模擬器一台機甲都看不到**：它要 mechs／weapons／backpacks／forms 才跑得起來。
 * 而沒有本機資料的代價，是每一個 052-x 子計畫都只能靠單元測試背書 ——
 * 元件互斥、模組接口、書架三態這些「要用眼睛看」的東西全部驗不了。
 *
 * 因此加一個 `--simulator`：機師全帶、模擬器要的集合整包帶，另外帶 `meta/gameData`
 * （快取層的版本 gate 讀它）與 `patchVersions`（匯出圖的「遊戲版本」欄位讀它）。
 * 量級約 1,100 份文件、數 MB，對模擬器來說是一次性的成本。
 *
 *   node scripts/export-emulator-slice.mjs
 *   node scripts/export-emulator-slice.mjs --pilot pilot_艾達
 *   node scripts/export-emulator-slice.mjs --list-pilots     # 只列出可選機師，不匯出
 *   node scripts/export-emulator-slice.mjs --simulator       # 配裝模擬器用的整包
 */

import fs from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import admin from 'firebase-admin'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// 整包帶走的字典型集合（全站共用、量小、引用關係的另一端）
//
// ⚠ neuralDriveAbilities 是 PLAN-034 Phase 0 補上的（該計畫「地雷三」）：
//   PLAN-023 flip 後，機師 neuralDrive[].levels[] 只留 abilityId，能力內容全在此集合。
//   少了它，模擬器裡的機師頁 resolveNeuralDriveLevel() 會退回（已全空的）嵌入欄位，
//   任何與神經驅動能力相關的驗證都會「看起來完全正常」而測不出回歸 —— 恆綠、零資訊量。
const DICT_COLLECTIONS = ['buffs', 'glossaryTerms', 'pilotSkills', 'neuralDriveAbilities']

/**
 * `--simulator` 額外整包帶走的集合。
 *
 * · forms／mechs／weapons／backpacks：`useLoadoutGameData()` 的 equip 階段清單，缺一頁就空白。
 * · components／modules：052-D／052-G 要用；先帶著，免得屆時又要回頭改這支腳本。
 * · backpackSkills：背包詳情引用它（PLAN-043 漏掛過一次的那個集合）。
 * · patchVersions：匯出圖右下角的「遊戲版本」；取不到就整欄不印，於是驗不到那一欄。
 */
const SIM_COLLECTIONS = [
  'forms', 'mechs', 'weapons', 'backpacks', 'backpackSkills',
  'components', 'modules', 'patchVersions',
]

const args = process.argv.slice(2)
const getArg = (flag) => {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : null
}
const LIST_ONLY = args.includes('--list-pilots')
const SIMULATOR = args.includes('--simulator')

function loadEnv(filename) {
  const envPath = resolve(ROOT, filename)
  if (!fs.existsSync(envPath)) return
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
    const eqIdx = line.indexOf('=')
    if (eqIdx > 0) {
      const k = line.slice(0, eqIdx).trim()
      const v = line.slice(eqIdx + 1).trim()
      if (k && v && !k.startsWith('#')) process.env[k] = v
    }
  })
}

let db
function initFirebase() {
  // 安全檢查：這支腳本要打的是「正式」資料庫，不該有模擬器環境變數殘留，
  // 否則會從空的模擬器撈出 0 筆資料還以為成功。
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      `偵測到 FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST}\n` +
        '   本腳本需連「正式」資料庫做唯讀匯出，請先清掉這個環境變數。',
    )
  }
  loadEnv('.env')
  loadEnv('.env.migration')
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS 未設定（請於 .env / .env.migration 指定服務帳號金鑰）')
  const absCredPath = resolve(ROOT, credPath)
  if (!fs.existsSync(absCredPath)) throw new Error(`找不到服務帳號金鑰：${absCredPath}`)
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(absCredPath, 'utf-8'))) })
  db = admin.firestore()
}

/** 粗略數一份機師文件裡的引用密度，用來挑「最適合當測試素材」的機師 */
function countRefs(pilot) {
  const json = JSON.stringify(pilot)
  // descriptionRefs 側錄表項目數（可機械移除的那類）
  const descRefs = (json.match(/"refId"/g) || []).length
  // buffIds 陣列的「元素」總數 —— 注意不能數 "buffIds" 欄位名出現次數，
  // 那是結構性的（每位機師都一樣多），完全無法區分引用密度。
  const buffIds = [...json.matchAll(/"buffIds":\[(.*?)\]/g)]
    .reduce((sum, m) => sum + (m[1].trim() ? m[1].split(',').length : 0), 0)
  // 內嵌在文案字串裡的數值 token <refId(.lvN)?.attr> —— 需要「凍結」處理的那類
  const numRefs = (json.match(/<[^<>]+\.[A-Za-z]/g) || []).length
  return { descRefs, buffIds, numRefs, total: descRefs + buffIds + numRefs }
}

async function main() {
  console.log('📦 匯出模擬器測試切片（唯讀）\n')
  initFirebase()

  // ── 挑機師 ────────────────────────────────────────────────────────────────
  const pilotSnap = await db.collection('pilots').get()
  const pilots = pilotSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const ranked = pilots
    .map((p) => ({ id: p.id, name: p.name, ...countRefs(p) }))
    .sort((a, b) => b.total - a.total)

  if (LIST_ONLY) {
    console.log('引用密度前 15 名機師（total = descRefs + buffIds + numRefs）：\n')
    ranked.slice(0, 15).forEach((p, i) => {
      console.log(
        `  ${String(i + 1).padStart(2)}. ${String(p.id).padEnd(28)} ${String(p.name ?? '').padEnd(10)} ` +
          `total=${String(p.total).padStart(3)}  (refId=${p.descRefs} buffIds=${p.buffIds} numRef=${p.numRefs})`,
      )
    })
    console.log('\n用 --pilot <id> 指定，或不指定則自動取第 1 名。')
    return
  }

  // 可指定多位（逗號分隔）。不同機師覆蓋不同的引用機制：
  // descriptionRefs 側錄表多的 vs 內嵌數值 token 多的，兩類都要有測試素材。
  const wantIds = (getArg('--pilot') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const chosen = wantIds.length
    ? wantIds.map((id) => {
        const p = pilots.find((x) => x.id === id)
        if (!p) throw new Error(`找不到機師：${id}`)
        return p
      })
    : [pilots.find((p) => p.id === ranked[0]?.id)].filter(Boolean)
  if (!chosen.length) throw new Error('在 pilots 集合中找不到任何文件')

  if (SIMULATOR) console.log(`模式：--simulator（機師全帶 ${pilots.length} 位 ＋ 模擬器集合整包）
`)

  console.log(`選定 ${chosen.length} 位機師：`)
  for (const p of chosen) {
    const s = countRefs(p)
    console.log(
      `  · ${String(p.id).padEnd(24)} ${String(p.name ?? '—').padEnd(8)} ` +
        `refId=${s.descRefs} buffIds=${s.buffIds} numRef=${s.numRefs}`,
    )
  }
  console.log()

  // ── 寫出 ──────────────────────────────────────────────────────────────────
  const outDir = resolve(ROOT, 'emulator-seed')
  fs.mkdirSync(outDir, { recursive: true })

  const write = (name, docs) => {
    fs.writeFileSync(
      resolve(outDir, `${name}.json`),
      JSON.stringify({ collection: name, exportedAt: new Date().toISOString(), count: docs.length, docs }, null, 2),
      'utf-8',
    )
    console.log(`  · ${name.padEnd(16)} ${String(docs.length).padStart(5)} docs`)
  }

  write('pilots', SIMULATOR ? pilots : chosen)
  for (const col of DICT_COLLECTIONS) {
    const snap = await db.collection(col).get()
    write(col, snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  }

  if (SIMULATOR) {
    for (const col of SIM_COLLECTIONS) {
      const snap = await db.collection(col).get()
      write(col, snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    }
    // 版本 gate：`meta/gameData` 少了它，前端每次都會判定快取失效而重抓 ——
    // 在模擬器裡不痛，但也就測不到快取層本身
    const meta = await db.collection('meta').get()
    write('meta', meta.docs.map((d) => ({ id: d.id, ...d.data() })))
  }

  console.log(`\n✅ 完成 → ${outDir}`)
  console.log('   下一步：npm run emu（另開終端機）→ npm run emu:seed')
}

main().catch((err) => {
  console.error('\n❌ 失敗：', err.message)
  process.exit(1)
})
