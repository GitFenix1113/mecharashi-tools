// 產出天生模組推導測試的 fixture —— PLAN-052-K Phase A / A-4
//
//   node scripts/gen-innate-mech-fixture.mjs
//
// 直讀正式 Firestore 的 `mechs` 集合，把 `innateModules.test.ts` 需要的最小欄位集寫成
// `src/utils/__fixtures__/innateMechs.json`（進版控）。
//
// ── 為什麼是 fixture 而不是讓測試連線 ────────────────────────────────────
// `npm test` 走 `node --test`，不帶憑證也不該連外 —— CI 與離線開發都要跑得動。
// 而守門測試要守的是「`resolveInnateModules()` 對這批已知資料算出來的矩陣對不對」，
// 那批資料的快照本身就是測試的一部分。與 `gen-module-fixture.mjs` 同一條理由。
//
// ── 只留最小欄位 ────────────────────────────────────────────────────────
// 天生模組的推導只吃 `quality` ＋ 三個模組欄位 ＋ 部位的 `innateModules` 覆寫。
// 數值、lore、接口一律不帶 —— 那些每次改版都會動，diff 會淹沒與本測試無關的變動。
// （接口在 `mechInterfaces.json`，模組在 `modules.json`，各自有各自的守門測試。）
//
// ── 什麼時候要重跑 ──────────────────────────────────────────────────────
// 新增機甲、或修改任何機甲的 `module4Id` / `module8Id` / `moduleFixedIds` 之後。
// 重跑後如果 `innateModules.test.ts` 掛掉，代表規則與資料對不上 ——
// 那時該查的是規則表或那台機甲的資料，**不是把斷言的數字改到剛好通過**。
import admin from 'firebase-admin'
import fs from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'src/utils/__fixtures__/innateMechs.json')
const KEY = resolve(ROOT, 'serviceAccountKey.json')

if (!fs.existsSync(KEY)) {
  console.error('✗ 找不到 serviceAccountKey.json')
  process.exit(1)
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY, 'utf8'))) })

const POS = ['torso', 'leftArm', 'rightArm', 'legs']
const snap = await admin.firestore().collection('mechs').get()

const items = snap.docs
  .map((d) => {
    const m = d.data()
    const out = {
      id: d.id,
      name: m.name,
      quality: m.quality ?? '',
      // ⚠ 三種「沒有」在正式庫裡同時存在：欄位缺席、`null`、**空字串**
      //   （例：帕斯卡的 `module4Id` 是 `''`，它真的沒有特性模組）。
      //   語意相同，一律正規化成 null —— 不正規化的話 fixture 會把這個無意義的差異
      //   帶進版控，而讀的人會以為那三種狀態有分別。
      //   `resolveInnateModules()` 那側用 falsy 判斷，三種都吃得下。
      module4Id: m.module4Id || null,
      module8Id: m.module8Id || null,
      moduleFixedIds: m.moduleFixedIds ?? [],
    }
    // 人工覆寫（PLAN-052-K 決策三）。今天預期 0 台有值 —— 一旦有了，
    // 測試要看得到它，否則「覆寫整格取代」那條規則沒有活的實例守著。
    const overrides = {}
    for (const pos of POS) {
      const ov = m.parts?.[pos]?.innateModules
      if (ov !== undefined) overrides[pos] = ov
    }
    if (Object.keys(overrides).length) out.innateOverrides = overrides
    return out
  })
  .sort((a, b) => a.id.localeCompare(b.id))

fs.mkdirSync(dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(items, null, 1) + '\n', 'utf8')

const tally = (f) => items.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m }, {})
const withOverride = items.filter((x) => x.innateOverrides).length
console.log(`✅ 寫入 ${items.length} 台 → src/utils/__fixtures__/innateMechs.json`)
console.log(`   quality: ${JSON.stringify(tally((x) => x.quality))}`)
console.log(`   module4Id 有值 ${items.filter((x) => x.module4Id).length}　module8Id 有值 ${items.filter((x) => x.module8Id).length}`)
console.log(`   moduleFixedIds 引用 ${items.reduce((a, x) => a + x.moduleFixedIds.length, 0)} 個`)
console.log(`   有人工覆寫的部位：${withOverride} 台`)
process.exit(0)
