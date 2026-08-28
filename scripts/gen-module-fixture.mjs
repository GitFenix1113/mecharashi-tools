// 產出模組守門測試的 fixture —— PLAN-052-G Phase A / A-5
//
//   node scripts/gen-module-fixture.mjs
//
// 直讀正式 Firestore 的 `modules` 集合，把守門測試需要的最小欄位集寫成
// `src/utils/__fixtures__/modules.json`（進版控）。
//
// ── 為什麼是 fixture 而不是讓測試連線 ────────────────────────────────────
// `npm test` 走 `node --test`，不帶憑證也不該連外 —— CI 與離線開發都要跑得動。
// 而守門測試要守的是「`moduleCandidates()` 對這批已知資料圈出來的池對不對」，
// 那批資料的快照本身就是測試的一部分。
//
// ── 只留最小欄位 ────────────────────────────────────────────────────────
// 全欄位快照會把 `description` 與每一階的效果文字一起帶進版控，而那些字每次改版都會動
// —— diff 於是淹沒在與本測試無關的變動裡。`levels` 只留 `level`（守門要的是覆蓋率與階數），
// 不留任何數值欄位。
//
// ── 什麼時候要重跑 ──────────────────────────────────────────────────────
// 官方改版新增／改名模組之後（data-patch 流程寫入 Firestore 並 bump 版本之後）。
// 重跑後如果 `moduleRules.test.ts` 掛掉，代表官方改了模組的分類方式 ——
// 那時該修的是 `moduleRules.ts` 或資料，**不是把斷言的數字改到剛好通過**。
import admin from 'firebase-admin'
import fs from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'src/utils/__fixtures__/modules.json')
const KEY = resolve(ROOT, 'serviceAccountKey.json')

if (!fs.existsSync(KEY)) {
  console.error('✗ 找不到 serviceAccountKey.json')
  process.exit(1)
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY, 'utf8'))) })

const snap = await admin.firestore().collection('modules').get()

/**
 * 數值欄位的鍵空間：**全庫所有 `levels[]` 出現過的數值鍵聯集**（`level` 本身不算）。
 *
 * ⚠ 不可改成「取每一筆自己的 levels[0] 的鍵」：那樣每筆檢查的欄位數都不同，
 *   欄位少的那些會比較容易被判成「頂層全 0」，數字於是失去意義（實測差 1 筆）。
 *   也不在腳本裡手抄 30 個鍵 —— 官方新增欄位時手抄的那份會靜默漏掉。
 */
const STAT_KEYS = [...new Set(
  snap.docs.flatMap((d) => (d.data().levels ?? []).flatMap((l) =>
    Object.keys(l).filter((k) => k !== 'level' && typeof l[k] === 'number'))),
)]

const items = snap.docs
  .map((d) => {
    const m = d.data()
    return {
      id: d.id,
      name: m.name,
      slot: m.slot ?? '',
      rarity: m.rarity ?? '',
      // ⚠ `null` 與「欄位不存在」在這裡是同一件事（＝不綁機甲），一律正規化成 null，
      //   否則 JSON 裡會出現 undefined 被吃掉、而測試讀到的是「欄位在不在」而非值。
      boundMechId: m.boundMechId ?? null,
      boundPart: m.boundPart ?? null,
      available: m.available ?? null,
      moduleAddLevel: m.moduleAddLevel ?? null,
      source: m.source ?? null,
      managedBy: m.managedBy ?? null,
      levels: (m.levels ?? []).map((l) => ({ level: l.level })),
      // PLAN-052-K 的兩個結構化欄位。帶進 fixture 是為了讓守門測試盯的是**正式庫的那 8 格**，
      // 而不是測試自己捏出來的假物件 —— 這兩個欄位今天只有 8 筆有值，
      // 而「有值的那幾筆消失了」正是最需要被擋下來的那種變動。
      slotLevelMultiplier: m.slotLevelMultiplier ?? null,
      unlockCondition: m.unlockCondition ?? null,
      // 頂層那排平坦數值欄位是不是**全 0**。守門測試靠它釘住「讀數值一律走 levels[]」
      // 那條規則的依據 —— 不存布林而存原始數值的話，每次改版都會有一堆與本測試無關的 diff。
      flatAllZero: STAT_KEYS.every((k) => !m[k]),
    }
  })
  .sort((a, b) => a.id.localeCompare(b.id))

fs.mkdirSync(dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(items, null, 1) + '\n', 'utf8')

const slots = items.reduce((m, x) => ({ ...m, [x.slot]: (m[x.slot] ?? 0) + 1 }), {})
console.log(`✅ 寫入 ${items.length} 筆 → src/utils/__fixtures__/modules.json`)
console.log(`   ${JSON.stringify(slots)}`)
process.exit(0)
