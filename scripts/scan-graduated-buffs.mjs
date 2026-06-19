#!/usr/bin/env node
/**
 * 階梯式 BUFF 盤點（DRY-RUN · 唯讀）— 為「問題二：buff 等級化」抉擇 / PLAN 撰寫提供數據
 *
 * 唯讀掃描 buffs 集合，以「去掉等級尾碼後的詞幹」分組，量化：
 *   1. 全站有幾族「同詞幹、多等級」的 buff（凝勢 I/II/III、傷害提升 I~V…）
 *   2. 每族是「結構型階梯」（per-level 連 maxStack/互斥都不同，如凝勢）
 *      還是「數值型階梯」（per-level 只差一個數值，如傷害提升 / 各種 debuff 程度遞增）
 *      —— ⚠ 兩者都是真 BUFF（領域確認：傷害提升即一個「數值增益」強化 BUFF），
 *         debuff 階梯（減益程度遞增）本質也是數值型，不因 buffType≠statBoost 就算結構型。
 *         區分只決定「等級化時 levels[] 要承載『完整能力』還是『單一數值』」。
 *   3. 去重潛力、族大小分布、effects 結構化現況、mutex 一致性、缺階/重複/無尾碼污染健檢
 *
 * 解讀（對應 _local-notes/buff-等級化vs屬性覆寫_評估.md）：
 *   · 階梯族數可觀（數十族）+ effects 多為空（數值待結構化）+ 引用 token 尚未鋪開
 *     → 三條件同時成立時，方案 C（真等級化）是「趁早做對」而非過度工程。
 *   · 結構型族＝levels[] 要裝完整能力（接近 ModuleLevel）；數值型族＝levels[] 各一個 value。
 *
 * ⚠ 詞幹分組為「尾碼啟發式」（羅馬／阿拉伯數字），明細請人工複核；不寫入任何資料。
 *
 *   node scripts/scan-graduated-buffs.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

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

let db
function initFirebase() {
  loadEnv('.env')
  loadEnv('.env.migration')
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS 未設定（請於 .env / .env.migration 指定服務帳號金鑰）')
  const absCredPath = resolve(ROOT, credPath)
  if (!fs.existsSync(absCredPath)) throw new Error(`找不到服務帳號金鑰：${absCredPath}`)
  const serviceAccount = JSON.parse(fs.readFileSync(absCredPath, 'utf-8'))
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  db = admin.firestore()
}

// ─── 等級尾碼解析（啟發式）──────────────────────────────────────────────────────
// 涵蓋：全形羅馬 Ⅰ-Ⅻ（U+2160–217F，含「組合式」Ⅰ+Ⅴ 與「單碼式」Ⅳ）、拉丁羅馬 I/II/III…、阿拉伯 1-99。
// 不含中文數字（一二三…）以降低誤傷；如有需要再放寬。
// ⚠ 全形必須先轉拉丁再做「減法」解析：Ⅰ+Ⅴ = IV = 4（不是逐字加總的 6）。
const FW_TO_LATIN = {
  'Ⅰ':'I','Ⅱ':'II','Ⅲ':'III','Ⅳ':'IV','Ⅴ':'V','Ⅵ':'VI','Ⅶ':'VII','Ⅷ':'VIII','Ⅸ':'IX','Ⅹ':'X','Ⅺ':'XI','Ⅻ':'XII',
  'Ⅼ':'L','Ⅽ':'C','Ⅾ':'D','Ⅿ':'M',
  'ⅰ':'I','ⅱ':'II','ⅲ':'III','ⅳ':'IV','ⅴ':'V','ⅵ':'VI','ⅶ':'VII','ⅷ':'VIII','ⅸ':'IX','ⅹ':'X','ⅺ':'XI','ⅻ':'XII',
}
const ROMAN_VAL = { I:1, V:5, X:10, L:50, C:100, D:500, M:1000 }

function romanLatinToInt(s) {
  let total = 0, prev = 0
  for (let i = s.length - 1; i >= 0; i--) {
    const v = ROMAN_VAL[s[i]]
    if (!v) return null
    if (v < prev) total -= v; else { total += v; prev = v }
  }
  return total
}

function tierToInt(raw) {
  if (/^\d+$/.test(raw)) return parseInt(raw, 10)
  // 全形羅馬（組合式 Ⅰ+Ⅴ 或單碼式 Ⅳ）→ 先展開為拉丁字母，再用減法規則解析
  if ([...raw].every(c => FW_TO_LATIN[c])) return romanLatinToInt([...raw].map(c => FW_TO_LATIN[c]).join(''))
  if (/^[IVXLCDM]+$/.test(raw)) return romanLatinToInt(raw)
  return null
}

// 結尾尾碼：詞幹（非貪婪）+ 可選分隔 + （全形羅馬｜拉丁羅馬｜1~2 位阿拉伯）
const TIER_TAIL_RE = /^(.*?)[\s·_-]*([Ⅰ-ⅿ]+|[IVXLCDM]+|\d{1,2})$/u

/** 回傳 { stem, tier, raw }；無可辨識尾碼或詞幹會被吃空 → tier=null（自成一族）。 */
function stripTier(name) {
  const s = (name ?? '').toString().trim()
  const m = s.match(TIER_TAIL_RE)
  if (!m || !m[1]) return { stem: s, tier: null, raw: null }   // 詞幹空（名稱整串是尾碼）→ 不分級
  const tier = tierToInt(m[2])
  if (tier == null) return { stem: s, tier: null, raw: null }
  return { stem: m[1].trim(), tier, raw: m[2] }
}

const effSummary = (effects) => {
  if (!Array.isArray(effects) || effects.length === 0) return '∅'
  return effects
    .map(e => `${e.stat}${e.valueType === 'override' ? '=' : '+'}${e.value}${e.scope && e.scope !== 'self' ? `@${e.scope}` : ''}`)
    .join(',')
}

async function main() {
  console.log('🔍 階梯式 BUFF 盤點（DRY-RUN · 唯讀）— 問題二 buff 等級化決策數據\n')
  initFirebase()
  const snap = await db.collection('buffs').get()
  console.log(`讀取 ${snap.size} 個 BUFF\n`)

  // stem → 成員[]
  const families = new Map()
  let withTier = 0
  let emptyName = 0
  let withEffects = 0

  for (const doc of snap.docs) {
    const b = doc.data()
    const name = (b.name ?? '').toString().trim()
    if (!name) { emptyName++; continue }
    const { stem, tier, raw } = stripTier(name)
    if (tier != null) withTier++
    const effLen = Array.isArray(b.effects) ? b.effects.length : 0
    if (effLen > 0) withEffects++
    const member = {
      id: doc.id, name, tier, raw,
      buffType: b.buffType ?? '?',
      maxStack: b.maxStack ?? null,
      mutexGroup: b.mutexGroup ?? null,
      effects: effSummary(b.effects),
      effLen,
    }
    const arr = families.get(stem) ?? []
    arr.push(member)
    families.set(stem, arr)
  }

  // 階梯族 = 詞幹相同、且「帶等級尾碼的成員」有 ≥2 個不同 tier
  const graduated = []
  for (const [stem, members] of families) {
    const tierMembers = members.filter(m => m.tier != null)   // 真正的階梯成員（無尾碼者不參與 tier 判定）
    const tiers = tierMembers.map(m => m.tier)
    const distinct = new Set(tiers)
    if (distinct.size < 2) continue

    // 結構型 vs 數值型（兩者皆真 buff）：
    //   結構型 = per-level 連結構都變（maxStack 跨級變化 / 有互斥）→ 凝勢型，levels[] 承載完整能力
    //   數值型 = per-level 純數值遞增（含 statBoost 與 debuff）        → 傷害提升型，levels[] 各一個 value
    //   ⚠ buffType 不參與判定：debuff 的程度遞增階梯本質也是數值型。
    const stackVaries = new Set(tierMembers.map(m => m.maxStack ?? '∅')).size > 1
    const anyMutex = members.some(m => m.mutexGroup)
    const structural = stackVaries || anyMutex
    const verdict = structural ? '結構型階梯' : '數值型階梯'

    // mutexGroup 一致性
    const mset = new Set(members.map(m => m.mutexGroup || null))
    const mutexStatus = mset.size === 1
      ? (members[0].mutexGroup ? `共用「${members[0].mutexGroup}」` : '全無互斥')
      : mset.has(null) ? '部分缺' : '不一致'

    // 健檢：重複 / 中間缺階 / 起始非 1（可能缺低階）/ 無尾碼污染
    const sortedT = [...tiers].sort((a, b) => a - b)
    const minT = sortedT[0], maxT = sortedT[sortedT.length - 1]
    const dup = sortedT.length !== distinct.size
    const midGap = (maxT - minT + 1) !== distinct.size
    const lowGap = minT > 1
    const orphan = members.length > tierMembers.length      // 含無尾碼成員（可能是同名污染）
    const health = [dup && '有重複', midGap && '中間缺階', lowGap && `從${minT}起`].filter(Boolean).join('、') || '連續'

    graduated.push({ stem, members, tierMembers, distinct: distinct.size, verdict, structural, mutexStatus, health, orphan })
  }

  const structural = graduated.filter(g => g.structural)
  const numeric = graduated.filter(g => !g.structural)
  const totalGradMembers = graduated.reduce((s, g) => s + g.members.length, 0)

  console.log('── 規模 ────────────────────────────────────')
  console.log(`  BUFF 總數：             ${snap.size}`)
  console.log(`  空白名稱（略過）：      ${emptyName}`)
  console.log(`  帶等級尾碼的 BUFF：     ${withTier}`)
  console.log(`  去尾碼後的詞幹數：      ${families.size}`)
  console.log(`  effects 已結構化的：    ${withEffects} / ${snap.size}  ← 其餘數值仍只活在描述文字（等級化可順手結構化）`)
  console.log('')

  console.log('── 階梯族總覽（核心決策數字）──────────────')
  console.log(`  階梯族（≥2 階同詞幹）： ${graduated.length}   ← 都是真 buff、都是方案 B/C 的對象`)
  console.log(`    ├ 結構型階梯：       ${structural.length}  ← per-level 能力不同（凝勢型），levels[] 承載完整能力`)
  console.log(`    └ 數值型階梯：       ${numeric.length}  ← per-level 只差數值（含 debuff 程度遞增），levels[] 各一個 value`)
  console.log(`  階梯族總成員數：        ${totalGradMembers}`)
  if (totalGradMembers > 0) {
    const save = totalGradMembers - graduated.length
    console.log(`  若塌縮成 1 文件/族：    ${totalGradMembers} → ${graduated.length}（省 ${save} 份文件，${(save / totalGradMembers * 100).toFixed(0)}%）`)
  }
  console.log('')

  // 族大小分布
  const dist = new Map()
  for (const g of graduated) {
    const k = g.members.length >= 5 ? '5+' : String(g.members.length)
    dist.set(k, (dist.get(k) ?? 0) + 1)
  }
  console.log('── 族大小分布 ──────────────────────────────')
  for (const k of ['2', '3', '4', '5+']) console.log(`  ${k} 階：${(dist.get(k) ?? 0)} 族`)
  console.log('')

  const printFamily = (g) => {
    const seq = [...g.members].sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99))
    const orphanTag = g.orphan ? '｜⚠含無尾碼成員' : ''
    console.log(`\n   ▌${g.stem}（${g.members.length} 階｜${g.mutexStatus}｜${g.health}${orphanTag}）`)
    for (const m of seq) {
      const tier = m.tier != null ? `[${m.raw}=${m.tier}]` : '[無尾碼]'
      const stk = m.maxStack != null ? ` stack=${m.maxStack}` : ''
      console.log(`     ${tier.padEnd(10)} ${m.buffType.padEnd(9)}${stk}  eff=${m.effects}`)
    }
  }

  console.log('── 結構型階梯族明細（凝勢型；levels[] 需承載完整能力）──')
  if (structural.length === 0) console.log('  （無）')
  else [...structural].sort((a, b) => b.members.length - a.members.length).forEach(printFamily)
  console.log('')

  console.log('── 數值型階梯族明細（傷害提升型；levels[] = 各級數值）──')
  if (numeric.length === 0) console.log('  （無）')
  else [...numeric].sort((a, b) => b.members.length - a.members.length).forEach(printFamily)
  console.log('')

  // 健檢彙整
  const unhealthy = graduated.filter(g => g.health !== '連續')
  const orphans = graduated.filter(g => g.orphan)
  const mutexIssue = structural.filter(g => g.mutexStatus === '部分缺' || g.mutexStatus === '不一致')
  console.log('── 健檢（遷移前需人工確認）──────────────────')
  console.log(`  缺階/重複的族：         ${unhealthy.length}${unhealthy.length ? '（' + unhealthy.map(g => `${g.stem}:${g.health}`).join('、') + '）' : ''}`)
  console.log(`  含無尾碼成員的族：      ${orphans.length}${orphans.length ? '（' + orphans.map(g => g.stem).join('、') + '）  ← 需確認該無尾碼 buff 是否真屬此族' : ''}`)
  console.log(`  結構型族 mutex 異常：   ${mutexIssue.length}${mutexIssue.length ? '（' + mutexIssue.map(g => `${g.stem}:${g.mutexStatus}`).join('、') + '）' : ''}`)
  console.log('')

  console.log('[DRY-RUN] 未寫入任何資料。此清單為 PLAN 遷移腳本的輸入；遷移前請：')
  console.log('  1) 人工複核「含無尾碼成員」「缺階」的族，確認歸屬與是否真缺；')
  console.log('  2) 先做一份資料庫靜態備份（遷移可回滾的安全網）。')
}

main().catch(err => {
  console.error('\n❌ 失敗：', err.message)
  console.error(err.stack)
  process.exit(1)
})
