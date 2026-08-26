// 產出元件族守門測試的 fixture —— PLAN-052-D Phase A / A-2
//
//   node scripts/gen-component-fixture.mjs
//
// 直讀正式 Firestore 的 `components` 集合，把守門測試需要的最小欄位集寫成
// `src/utils/__fixtures__/components.json`（進版控）。
//
// ── 為什麼是 fixture 而不是讓測試連線 ────────────────────────────────────
// `npm test` 走 `node --test`，不帶憑證也不該連外 —— CI 與離線開發都要跑得動。
// 而守門測試要守的是「`componentFamilyKey()` 對這批已知資料推得對不對」，
// 那批資料的快照本身就是測試的一部分。
//
// ── 什麼時候要重跑 ──────────────────────────────────────────────────────
// 官方改版新增／改名元件之後（data-patch 流程寫入 Firestore 並 bump 版本之後）。
// 重跑後如果 `componentRules.test.ts` 掛掉，代表官方改了命名規則 ——
// 那時該修的是 `componentFamilyKey()`，不是把斷言的數字改到剛好通過。
import admin from 'firebase-admin'
import fs from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'src/utils/__fixtures__/components.json')
const KEY = resolve(ROOT, 'serviceAccountKey.json')

if (!fs.existsSync(KEY)) {
  console.error('✗ 找不到 serviceAccountKey.json')
  process.exit(1)
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY, 'utf8'))) })

const snap = await admin.firestore().collection('components').get()

// 只留守門測試與規則測試用得到的欄位。全欄位快照會把描述文字一起帶進版控，
// 而那些字每次改版都會動 —— diff 於是淹沒在與本測試無關的變動裡。
const items = snap.docs
  .map((d) => {
    const c = d.data()
    const out = {
      id: d.id,
      name: c.name,
      componentType: c.componentType,
      componentsWType: c.componentsWType,
      rarity: c.rarity,
      probabilityLevel: c.probabilityLevel,
      allowedWeaponTypes: c.allowedWeaponTypes ?? [],
    }
    // condition 只有觸元件有，且守門測試要拿它驗雙射
    if (c.componentType === 'Condition') out.condition = c.condition ?? ''
    return out
  })
  .sort((a, b) => a.id.localeCompare(b.id))

fs.mkdirSync(dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(items, null, 1) + '\n', 'utf8')

const kinds = items.reduce((m, x) => ({ ...m, [x.componentType]: (m[x.componentType] ?? 0) + 1 }), {})
console.log(`✅ 寫入 ${items.length} 筆 → src/utils/__fixtures__/components.json`)
console.log(`   ${JSON.stringify(kinds)}`)
process.exit(0)
