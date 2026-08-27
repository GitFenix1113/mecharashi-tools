#!/usr/bin/env node
/**
 * 模組數值欄位漂移檢查（唯讀）— 2026-08-27
 *
 * ── 為什麼需要這支 ────────────────────────────────────────────────────────
 * 模組的 21 個「武器增傷」欄位（`dmg_blade` / `dmg_chainsaw` …）**官方來源沒有**，
 * 100% 靠人工鍵入（`scrape-modules.js` 對這些欄位只從 Firestore 帶前值）。
 * 人工鍵入會抄錯行，而抄錯的後果是**畫面上完全看不出異常**：
 *
 *     「刀劍模組Ⅱ」印出「浮游炮傷害 +5%」——字有、數字有、沒有錯誤訊息，
 *      只是那個加成掛在錯的武器種類上，而玩家會照著它配裝。
 *
 * 2026-08-27 的全庫掃描找到 41 個這種欄位（見 `patch-module-weapon-dmg-fields.mjs`），
 * 其中一顆還帶著 `dmg_pile = -5` 這種沒有人會發現的負值。
 *
 * ── 判準：每一階的敘述文字 ────────────────────────────────────────────────
 * 官方敘述的格式是固定的（「X的傷害提升N%」），由它推 `(欄位, 數值)` 零歧義。
 * 敘述推不出來的階（條件式效果，「攻擊時有N%的概率…」）一律略過 ——
 * 那些本來就不落在這 21 欄上，硬要對照會變成猜。
 *
 * ⚠ **為什麼不是單元測試**：`moduleRules.test.ts` 吃的 fixture 刻意不留數值欄位與
 *   敘述文字（見 `gen-module-fixture.mjs` 的檔頭：全欄位快照會讓 diff 淹沒在
 *   與守門無關的文字變動裡）。這條檢查要看的正是那兩樣，所以它屬於
 *   **data-patch 流程的收尾**，與 `check-nd-minsum-drift.mjs` 同一類。
 *
 * 使用：
 *   node scripts/check-module-stat-drift.mjs        ← 唯讀，有落差時 exit 1
 */

import admin from 'firebase-admin'
import fs from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const KEY = resolve(ROOT, 'serviceAccountKey.json')

if (!fs.existsSync(KEY)) {
  console.error('✗ 找不到 serviceAccountKey.json')
  process.exit(1)
}

/** 21 個武器增傷欄位，與 `src/types/module.ts` 的三段增傷欄位一致。 */
const WEAPON_DMG_FIELDS = [
  'dmg_assault', 'dmg_melee', 'dmg_shooting', 'dmg_tactical',
  'dmg_blade', 'dmg_polearm', 'dmg_missile', 'dmg_rocket',
  'dmg_shotgun', 'dmg_machinegun', 'dmg_heavy_machinegun',
  'dmg_railgun', 'dmg_funnel', 'dmg_sniper_light', 'dmg_sniper',
  'dmg_fist', 'dmg_pile', 'dmg_chainsaw', 'dmg_flamethrower',
  'dmg_counter', 'dmg_enemy_phase',
]

/** ⚠ 長詞必須排在短詞前（「重機槍」先於「機槍」），否則會比對到錯的那一個。 */
const TERM_TO_FIELD = [
  ['重機槍', 'dmg_heavy_machinegun'], ['輕型狙擊步槍', 'dmg_sniper_light'],
  ['狙擊步槍', 'dmg_sniper'], ['機槍', 'dmg_machinegun'],
  ['刀劍', 'dmg_blade'], ['長柄', 'dmg_polearm'], ['導彈', 'dmg_missile'], ['火箭', 'dmg_rocket'],
  ['霰彈槍', 'dmg_shotgun'], ['電磁炮', 'dmg_railgun'], ['浮游炮', 'dmg_funnel'],
  ['拳套', 'dmg_fist'], ['打樁機', 'dmg_pile'], ['電鋸', 'dmg_chainsaw'], ['噴火器', 'dmg_flamethrower'],
  ['突擊', 'dmg_assault'], ['格鬥', 'dmg_melee'], ['射擊', 'dmg_shooting'], ['戰術', 'dmg_tactical'],
]

function expectedFrom(description) {
  const m = /^(.+?)的傷害提升(\d+(?:\.\d+)?)%/.exec((description ?? '').trim())
  if (!m) return null
  for (const [term, field] of TERM_TO_FIELD) {
    if (m[1].startsWith(term)) return { field, value: Number(m[2]) }
  }
  return null
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY, 'utf8'))) })
const snap = await admin.firestore().collection('modules').get()

const problems = []
for (const d of snap.docs) {
  const m = { id: d.id, ...d.data() }
  for (const [i, lv] of (m.levels ?? []).entries()) {
    const want = expectedFrom(lv.description)
    if (!want) continue
    for (const f of WEAPON_DMG_FIELDS) {
      const cur = lv[f]
      if (f === want.field) {
        if (cur !== want.value) {
          problems.push(`${m.id}「${m.name}」Lv${i + 1}：敘述「${lv.description}」→ 應 ${f}=${want.value}，實際 ${cur ?? '無此欄位'}`)
        }
      } else if (cur !== undefined && cur !== 0) {
        // 不該存在的欄位。0 放行 —— 那是爬蟲補的預設值，不影響任何加總
        problems.push(`${m.id}「${m.name}」Lv${i + 1}：敘述「${lv.description}」卻另外掛著 ${f}=${cur}`)
      }
    }
  }
}

console.log(`掃描 ${snap.size} 筆模組。`)
if (problems.length === 0) {
  console.log('✅ 武器增傷欄位與各階敘述一致，無漂移。')
  process.exit(0)
}

console.log(`\n❌ ${problems.length} 處與敘述對不上：`)
problems.forEach((p) => console.log(`   · ${p}`))
console.log('\n   修法：node scripts/patch-module-weapon-dmg-fields.mjs（先看 dry-run）')
console.log('   ⚠ 若官方真的改了數值，該改的是 TARGETS 清單與這裡的認知，不是把檢查放寬。')
process.exit(1)
