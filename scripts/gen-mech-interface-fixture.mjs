// 產出機甲接口守門測試的 fixture —— 2026-08-27
//
//   node scripts/gen-mech-interface-fixture.mjs
//
// 直讀正式 Firestore 的 `mechs` 集合，把守門測試需要的最小欄位集寫成
// `src/utils/__fixtures__/mechInterfaces.json`（進版控）。
//
// ── 為什麼是 fixture 而不是讓測試連線 ────────────────────────────────────
// `npm test` 走 `node --test`，不帶憑證也不該連外 —— CI 與離線開發都要跑得動。
// 而守門測試要守的是「全庫 360 格是否仍符合 expectedInterface() 的規則」，
// 那批資料的快照本身就是測試的一部分。
//
// ── 什麼時候要重跑 ──────────────────────────────────────────────────────
// 新增機甲、或官方改版動到 parts.*.interface 之後（data-patch 流程寫入並 bump 版本之後）。
// 重跑後如果 `mechInterface.test.ts` 掛掉，代表**官方出了一台不符規則的機甲** ——
// 那時該做的是回官方對帳、決定要改規則還是把它列進具名白名單，
// **不是把斷言的數字改到剛好通過**。
import admin from 'firebase-admin'
import fs from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'src/utils/__fixtures__/mechInterfaces.json')
const KEY = resolve(ROOT, 'serviceAccountKey.json')

if (!fs.existsSync(KEY)) {
  console.error('✗ 找不到 serviceAccountKey.json')
  process.exit(1)
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY, 'utf8'))) })

const POS = ['torso', 'leftArm', 'rightArm', 'legs']
const snap = await admin.firestore().collection('mechs').get()

// 只留守門測試用得到的欄位。全欄位快照會把數值與 lore 一起帶進版控，
// 而那些每次改版都會動 —— diff 於是淹沒在與本測試無關的變動裡。
const items = snap.docs
  .map((d) => {
    const m = d.data()
    const out = { id: d.id, name: m.name, quality: m.quality ?? '', armorType: m.armorType ?? '' }
    for (const pos of POS) out[pos] = m.parts?.[pos]?.interface ?? null
    return out
  })
  .sort((a, b) => a.id.localeCompare(b.id))

fs.mkdirSync(dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(items, null, 1) + '\n', 'utf8')

const tally = (f) => items.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m }, {})
const cells = items.flatMap((x) => POS.map((p) => x[p]))
console.log(`✅ 寫入 ${items.length} 台 → src/utils/__fixtures__/mechInterfaces.json`)
console.log(`   quality: ${JSON.stringify(tally((x) => x.quality))}`)
console.log(`   ${cells.length} 格: ${JSON.stringify(cells.reduce((m, v) => { const k = v === '' ? '(空)' : v ?? '(缺部位)'; m[k] = (m[k] ?? 0) + 1; return m }, {}))}`)
