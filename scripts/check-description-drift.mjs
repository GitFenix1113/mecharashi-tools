#!/usr/bin/env node
/**
 * 描述欄位漂移檢查（唯讀）— PLAN-058，2026-10-13
 *
 * ── 為什麼需要這支 ────────────────────────────────────────────────────────
 * 模組與 BUFF 的效果描述曾經存了兩份（頂層＋各等級），都能手動改、又沒人規定誰是正本，
 * 於是修正只修到一邊：燎原模組頂層補了 [燃燒地形]、8 個等級全缺，而模組卡顯示的正是等級。
 * PLAN-058 把**各等級定為唯一正本**：
 *   · 模組頂層 description／數值＝LV.MAX 的鏡像，後台存檔時自動寫入
 *   · 分級 BUFF 頂層＝選填的「通用說明」，不寫數字，留空時前台自動列各級
 * 後台守得住「從後台存檔」的那條路，守不住腳本寫入與舊資料——這支就是補那個洞。
 *
 * ── 判準直接 import 站上正在跑的那份實作 ────────────────────────────────────
 * 鏡像規則用 `src/utils/moduleRules.ts` 的 `syncModuleTopFromMaxLevel`，不在這裡另寫一份；
 * 規則改了，這支跟著改，不會出現「檢查說對、畫面說錯」。
 *
 * 使用：
 *   node scripts/check-description-drift.mjs        ← 唯讀；模組鏡像有落差時 exit 1
 *
 * 只有 ❶ 計入離開碼。❷～❺ 是「該有人看一眼」的清單，列出來但不擋。
 */

import admin from 'firebase-admin'
import fs from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { syncModuleTopFromMaxLevel, MODULE_STAT_KEYS } from '../src/utils/moduleRules.ts'
import { generalTextHasNumber } from '../src/utils/buffDescription.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const KEY = resolve(ROOT, 'serviceAccountKey.json')
if (!fs.existsSync(KEY)) {
  console.error('✗ 找不到 serviceAccountKey.json')
  process.exit(1)
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY, 'utf8'))) })
const db = admin.firestore()

const [modSnap, buffSnap] = await Promise.all([db.collection('modules').get(), db.collection('buffs').get()])
const mods = modSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
const buffs = buffSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
const brackets = (s) => [...(s ?? '').matchAll(/\[([^\]]+)\]/g)].map((m) => m[1])

// ❶ 模組頂層 ≠ LV.MAX（鏡像沒同步）
const mirrorDrift = []
for (const m of mods) {
  const want = syncModuleTopFromMaxLevel(m)
  if (want === m) continue   // 沒有 levels：新建中，頂層是暫存
  const diffs = []
  if ((m.description ?? '') !== want.description) diffs.push('描述')
  for (const k of MODULE_STAT_KEYS) if (m[k] !== want[k]) diffs.push(`${k} ${m[k] ?? '∅'}→${want[k] ?? '∅'}`)
  if (diffs.length) mirrorDrift.push(`${m.name}（${m.id}）：${diffs.join('、')}`)
}

// ❷ 模組等級正文的 [xxx] 沒有對應引用（自有引用表沒有、共用表也沒有）
const unlinked = []
for (const m of mods) {
  for (const lv of m.levels ?? []) {
    const own = lv.descriptionRefs && Object.keys(lv.descriptionRefs).length ? lv.descriptionRefs : null
    const table = own ?? m.descriptionRefs ?? {}
    const miss = [...new Set(brackets(lv.description))].filter((k) => !table[k])
    if (miss.length) unlinked.push(`${m.name} Lv${lv.level}：[${miss.join('] [')}]${own ? '（本級有自己的引用表，不會回退共用表）' : ''}`)
  }
}

// ❸ 分級 BUFF 的通用說明：抄了某一級、或寫了數字
const generalIssues = []
for (const b of buffs) {
  if (!b.levels?.length) continue
  const g = (b.description ?? '').trim()
  if (!g) continue
  const same = b.levels.find((l) => (l.description ?? '').trim() === g)
  if (same) generalIssues.push(`${b.name}（${b.id}）：通用說明和 Lv${same.level} 一字不差 → 清空即可`)
  else if (generalTextHasNumber(g)) generalIssues.push(`${b.name}（${b.id}）：通用說明有數字「${g}」→ 數字屬於各等級`)
}

// ❹ 分級 BUFF 有等級沒寫描述（前台列各級時會略過它）
const emptyLevels = []
for (const b of buffs) {
  for (const l of b.levels ?? []) if (!(l.description ?? '').trim()) emptyLevels.push(`${b.name}（${b.id}）Lv${l.level}`)
}

// ❺ 模組頂層 descriptionRefs 有、但任何一級都沒用到的 key（共用表裡的孤兒）
const orphanRefs = []
for (const m of mods) {
  const used = new Set((m.levels ?? []).flatMap((l) => brackets(l.description)))
  const orphan = Object.keys(m.descriptionRefs ?? {}).filter((k) => !used.has(k.split('|')[0]))
  if (orphan.length && m.levels?.length) orphanRefs.push(`${m.name}（${m.id}）：${orphan.join('、')}`)
}

// ─── 報告：照抄清單 ─────────────────────────────────────────────────────────
const section = (mark, title, items, fix) => {
  console.log(`\n${items.length ? mark : '✅'} ${title}：${items.length} 筆`)
  for (const s of items.slice(0, 40)) console.log(`   · ${s}`)
  if (items.length > 40) console.log(`   …另 ${items.length - 40} 筆`)
  if (items.length && fix) console.log(`   → ${fix}`)
}
console.log(`描述欄位漂移檢查（modules ${mods.length}、buffs ${buffs.length}）`)
section('❌', '❶ 模組頂層與 LV.MAX 不同步', mirrorDrift,
  '後台「模組管理」打開該模組、直接按儲存即可（存檔會自動從 LV.MAX 同步）。不要去改頂層——它是唯讀的。')
section('⬜', '❷ 模組等級正文有未指派的 [xxx]', unlinked,
  '後台「等級資料」該級的引用面板指派；或在「基本資訊」的共用引用表指派（該級沒有自己的引用表時才會沿用）。')
section('⬜', '❸ 分級 BUFF 的通用說明可能是副本', generalIssues,
  '後台「BUFF 管理」清空或改寫通用說明（不寫數字；留空前台會自動列出各級）。')
section('⬜', '❹ 分級 BUFF 有等級沒寫描述', emptyLevels,
  '確認是刻意的佔位（例：官方沒公開該級）還是漏填。只列不擋。')
section('⬜', '❺ 模組共用引用表有沒人用的 key', orphanRefs,
  '多半無害（改字後留下的舊 key）；後台共用引用表會標成殘留，確認後清掉。只列不擋。')

console.log(mirrorDrift.length ? '\n❌ 有模組鏡像落差（exit 1）' : '\n✅ 模組鏡像全部同步')
process.exit(mirrorDrift.length ? 1 : 0)
