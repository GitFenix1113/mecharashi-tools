#!/usr/bin/env node
/**
 * 槽位一致性校驗（唯讀）— PLAN-052-A D-3
 *
 * ── 為什麼需要這支 ────────────────────────────────────────────────────────
 * 「哪把武器焊在哪一格」這件事在資料庫裡有**兩份記載**：
 *
 *     weapons.equipSlot                  （武器 → 它能裝哪種槽）
 *     mechs.parts.*.fixedArmament[].slot （機甲部件 → 這格焊了什麼）
 *     forms.restrict.mounts[].slot       （機師形態 → 這格焊了什麼）
 *
 * 硬不變式是 `mount.slot === weapons[mount.weaponId].equipSlot`，允許 0 例外。
 * 這條規則**只有在兩邊共用同一個 enum 時才寫得出來**（`WeaponEquipSlot`），
 * 是 PLAN-047 決策一「不另造第四套部位詞彙」最直接的回報。
 *
 * ⚠ 這支的定位是**回歸測試**，不是清理工具。後台的 ArmamentMountEditor 已經把 slot 做成
 *   唯讀（由所選武器的 equipSlot 自動帶入），人為輸入產生不了不一致；會觸發這裡的只剩
 *   「武器改了 equipSlot、但既有 mount 沒跟著改」與腳本直寫兩條路徑。
 *
 * ── 六類檢查 ──────────────────────────────────────────────────────────────
 *   ① 斷鏈       ：mount.weaponId 在 weapons 集合查無
 *   ② 槽位不符   ：mount.slot ≠ weapon.equipSlot（硬不變式）
 *   ③ side 誤用  ：side 只該出現在 singleHand / shoulder；dualHand / back 不得有
 *   ④ side 缺漏  ：singleHand / shoulder 必須有 side（否則兩格分不出來）
 *   ⑤ 重複佔用   ：同一個 (bank, slot, side) 在同一台機甲／形態出現兩次
 *   ⑥ 超出容量   ：佔用數超過 mechSlotCapacity()（肩槽只有中甲有 2 格）
 *
 *   node scripts/validate-mech-slots.mjs                    # 完整報告（讀正式庫）
 *   node scripts/validate-mech-slots.mjs --quiet            # 只輸出結論與問題（CI 用）
 *   node scripts/validate-mech-slots.mjs --fixture=x.json   # 改讀本機 JSON，不連 Firestore
 *
 * --fixture 格式：{ "weapons": [...], "mechs": [...], "forms": [...] }
 * 附 tests/mech-slots.bad.json：刻意造壞的六類問題各一筆。一個只會回報 PASS 的校驗器
 * 等於沒被驗證過，跑它應該讓六類檢查全部觸發並以離開碼 1 結束。
 *
 * 離開碼：有任何問題 → 1（可直接串進 CI）；全部乾淨 → 0
 * ⚠ 唯讀：只用 .get()，不做任何寫入、不 bump 任何版本。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'

const ROOT = resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const QUIET = process.argv.includes('--quiet')
const FIXTURE = process.argv.find((a) => a.startsWith('--fixture='))?.slice('--fixture='.length)

// ⚠ 必須與 src/types/enums.ts 與 src/utils/mechSlots.ts 同步。
//   .mjs 無法 import TS，故在此複寫；改 enum 或容量規則時請一併改這裡。
const SINGLE_HAND = 'singleHand'
const DUAL_HAND   = 'dualHand'
const SHOULDER    = 'shoulder'
const BACK        = 'back'
const ARMOR_MEDIUM = '中甲'
const PART_POSITIONS = ['torso', 'leftArm', 'rightArm', 'legs']
/** 該槽位是否有左右之分（對齊 slotAcceptsSide()） */
const acceptsSide = (slot) => slot === SINGLE_HAND || slot === SHOULDER
/** 對齊 mechSlotCapacity() */
const capacityOf = (armorType) => ({
  [SINGLE_HAND]: 2,
  [SHOULDER]: armorType === ARMOR_MEDIUM ? 2 : 0,
  [BACK]: 1,
})
/** 對齊 slotKey() */
const slotKey = (bank, slot, side) => (side ? `${bank}:${slot}:${side}` : `${bank}:${slot}`)

function loadEnv(filename) {
  const p = resolve(ROOT, filename)
  if (!fs.existsSync(p)) return
  fs.readFileSync(p, 'utf-8').split('\n').forEach((line) => {
    const i = line.indexOf('=')
    if (i > 0) {
      const k = line.slice(0, i).trim()
      const v = line.slice(i + 1).trim()
      if (k && v && !k.startsWith('#')) process.env[k] = v
    }
  })
}

async function loadData() {
  if (FIXTURE) {
    const raw = JSON.parse(fs.readFileSync(resolve(ROOT, FIXTURE), 'utf-8'))
    return {
      weapons: raw.weapons ?? [],
      mechs: raw.mechs ?? [],
      forms: raw.forms ?? [],
    }
  }
  loadEnv('.env.local')
  const keyPath = resolve(ROOT, 'serviceAccountKey.json')
  if (!fs.existsSync(keyPath)) {
    console.error('✗ 找不到 serviceAccountKey.json（或改用 --fixture= 離線驗證）')
    process.exit(2)
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))) })
  const db = admin.firestore()
  const all = async (c) => (await db.collection(c).get()).docs.map((d) => ({ id: d.id, ...d.data() }))
  return { weapons: await all('weapons'), mechs: await all('mechs'), forms: await all('forms') }
}

const { weapons, mechs, forms } = await loadData()
const weaponById = new Map(weapons.map((w) => [w.id, w]))

const problems = { broken: [], slotMismatch: [], strayside: [], missingSide: [], duplicate: [], overCapacity: [] }
let mountCount = 0

/**
 * 檢查一組 mount。
 * @param owner  顯示用來源（`mech_022_帕斯卡.leftArm` / `form_海莉絲_虛粒子`）
 * @param mounts ArmamentMount[]
 * @param seen   同一擁有者共用的 slotKey → owner 對照表（跨部件偵測重複）
 */
function checkMounts(owner, mounts, seen) {
  for (const m of mounts ?? []) {
    mountCount++
    const where = `${owner} → ${m.weaponId}`
    const w = weaponById.get(m.weaponId)
    if (!w) { problems.broken.push(`${where}（weapons 集合查無此 id）`); continue }
    if (w.equipSlot !== m.slot) {
      problems.slotMismatch.push(`${where}：mount.slot='${m.slot}' 但 weapon.equipSlot='${w.equipSlot}'`)
    }
    if (m.side && !acceptsSide(m.slot)) {
      problems.strayside.push(`${where}：slot='${m.slot}' 不分左右，卻填了 side='${m.side}'`)
    }
    if (!m.side && acceptsSide(m.slot)) {
      problems.missingSide.push(`${where}：slot='${m.slot}' 需要 side（左右兩格分不出來）`)
    }
    const key = slotKey('main', m.slot, m.side)
    if (seen.has(key)) problems.duplicate.push(`${where}：${key} 已被 ${seen.get(key)} 佔用`)
    else seen.set(key, where)
  }
}

// ── 機甲 ────────────────────────────────────────────────────────────────────
for (const mech of mechs) {
  const seen = new Map()
  for (const pos of PART_POSITIONS) {
    const part = mech.parts?.[pos]
    if (!part || typeof part === 'number') continue
    checkMounts(`${mech.id}.${pos}`, part.fixedArmament, seen)
  }
  // ⑥ 容量：同一台機甲各類槽的佔用數不得超過 mechSlotCapacity()
  const cap = capacityOf(mech.armorType)
  const used = {}
  for (const key of seen.keys()) {
    const slot = key.split(':')[1]
    used[slot] = (used[slot] ?? 0) + 1
  }
  for (const [slot, n] of Object.entries(used)) {
    // dualHand 佔的是兩格 singleHand，不是獨立容量
    const limit = slot === DUAL_HAND ? cap[SINGLE_HAND] : cap[slot]
    if (limit === undefined) continue
    if (n > limit) {
      problems.overCapacity.push(
        `${mech.id}（${mech.armorType}）：${slot} 佔用 ${n} 格，容量只有 ${limit} 格`
        + (slot === SHOULDER && cap[SHOULDER] === 0 ? '（肩槽只有中甲有）' : ''),
      )
    }
  }
}

// ── 形態 ────────────────────────────────────────────────────────────────────
for (const form of forms) {
  if (form.restrict?.kind !== 'fixedArmament') continue
  if (form.restrict.weaponIds) {
    problems.broken.push(`${form.id}：restrict 殘留舊欄位 weaponIds（應已升級成 mounts，PLAN-052-A C-3）`)
  }
  checkMounts(form.id, form.restrict.mounts, new Map())
}

// ── 報告 ────────────────────────────────────────────────────────────────────
const SECTIONS = [
  ['① 斷鏈：mount.weaponId 在 weapons 查無', problems.broken],
  ['② 槽位不符：mount.slot ≠ weapon.equipSlot（硬不變式）', problems.slotMismatch],
  ['③ side 誤用：dualHand / back 不該有 side', problems.strayside],
  ['④ side 缺漏：singleHand / shoulder 必須有 side', problems.missingSide],
  ['⑤ 重複佔用：同一格被兩筆 mount 佔住', problems.duplicate],
  ['⑥ 超出容量：佔用數超過 mechSlotCapacity()', problems.overCapacity],
]
const total = SECTIONS.reduce((n, [, list]) => n + list.length, 0)

if (!QUIET) {
  console.log(`\n=== 槽位一致性校驗（PLAN-052-A D-3）===`)
  console.log(`資料來源：${FIXTURE ?? 'Firestore 正式庫'}`)
  console.log(`掃描範圍：機甲 ${mechs.length} 台、形態 ${forms.length} 筆、武器 ${weapons.length} 把 → 共 ${mountCount} 筆 mount\n`)
}
for (const [title, list] of SECTIONS) {
  if (!list.length) { if (!QUIET) console.log(`✓ ${title}：0 筆`); continue }
  console.log(`✗ ${title}：${list.length} 筆`)
  list.forEach((x) => console.log(`    ${x}`))
}
console.log(total === 0 ? `\n✅ PASS — ${mountCount} 筆 mount 全數通過六類檢查` : `\n❌ FAIL — 共 ${total} 筆問題`)
process.exit(total === 0 ? 0 : 1)
