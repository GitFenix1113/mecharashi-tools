#!/usr/bin/env node
/**
 * 天賦配裝修正（loadoutMods）健檢 — PLAN-052-N A-5
 *
 * ── 為什麼需要這支 ────────────────────────────────────────────────────────
 * `PilotTalent.loadoutMods` 是**純人工維護**的欄位——官方 API 沒有這份資料，
 * 爬蟲只會把天賦正文刷新。於是有三種錯法，**畫面上全都看不出來**：
 *
 *   ① 漏填    新機師上線，正文寫著「火箭的負重降低130」，但沒有人去填規則
 *             ⇒ 模擬器少算 130，玩家帶得動的配裝被判成超重。
 *   ② 對象打錯 `kind: '火箭炮'`（正確是「火箭」）匹配到 0 把武器
 *             ⇒ 與「沒填」完全一樣：沒有錯誤、沒有紅字，只是安靜地不生效。
 *   ③ 數值漂移 官方把 −130 調成 −150，爬蟲更新了正文、`loadoutMods` 停在舊值
 *             ⇒ **兩邊都有值**，①② 都抓不到，而站上會用一個過期的數字算重量。
 *
 * ③ 是這支真正的價值：另外兩類至少「缺了東西」，而 ③ 是兩份資料各自完整、
 * 只是互相矛盾——沒有任何既有檢查會出聲。
 *
 * ⚠ 唯讀：只 .get() Firestore，不寫任何東西、不打官方 API。
 *
 *   node scripts/check-talent-loadout-mods.mjs              # 全部機師
 *   node scripts/check-talent-loadout-mods.mjs --pilot=維娜  # 單一機師
 *   node scripts/check-talent-loadout-mods.mjs --json out.json
 *
 * 離開碼：有 ①②③ 任一 → 1（可串進 CI / data-patch 收尾檢查）；全部乾淨 → 0
 */

import fs from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import admin from 'firebase-admin'
// 偵測邏輯的單一資料源，與後台 PilotAdmin 的黃字提示共用（Node 24 直接吃 .ts 的型別剝離）。
// ⚠ 不要在本檔另抄一份關鍵字：後台與健檢對「要不要填」給出不同答案時，
//   管理者只看得到後台那一個，而 CI 會為了另一個一直紅。
import { needsLoadoutModsHint, loadoutModHintWords } from '../src/utils/talentLoadoutMods.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null }
const ONE_PILOT = (args.find((a) => a.startsWith('--pilot=')) || '').split('=')[1] || ''
const JSON_OUT = getArg('--json')

const log = (...a) => console.log(...a)

// ── env / firebase ──────────────────────────────────────────────────────────

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

let db
function initFirebase() {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(`偵測到 FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST}；本腳本針對正式資料庫，請先清掉。`)
  }
  loadEnv('.env')
  loadEnv('.env.migration')
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'serviceAccountKey.json'
  const abs = resolve(ROOT, credPath)
  if (!fs.existsSync(abs)) throw new Error(`找不到服務帳號金鑰：${abs}`)
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(abs, 'utf-8'))) })
  db = admin.firestore()
}

// ── 對象的中文名（③ 用它在正文裡定位句子）──────────────────────────────────
//
// ⚠ 背包要的是**中文標籤**而不是 enum 值：正文寫「修理背包負重降低300」，
//   而 `type` 存的是 `'Heal'`——拿 'Heal' 去正文裡找，一筆都找不到。
const BACKPACK_LABEL = {
  Heal: '修理', Ammo: '彈藥', Interference: '誘導', Invisible: '隱形',
  BackupEquipment: '武器擴充', MovePointAdd: '移動', Flow: '飛行',
  Radar: '雷達', EMP: '干擾', Enhance: '強化', PowerAdd: '出力',
}

/** 屬性 → 正文裡會出現的詞（③ 用來確認「這個句子在講的是同一個屬性」） */
const STAT_WORDS = {
  weight:     ['負重', '重量'],
  ammoCount:  ['彈倉', '彈藥'],
  maxRange:   ['射程'],
  minRange:   ['射程'],
  durability: ['耐久'],
}

function targetLabel(t) {
  if (!t || typeof t !== 'object') return '(未設定)'
  if (t.on === 'weaponKind')   return t.kind ?? '(空)'
  if (t.on === 'backpackType') return BACKPACK_LABEL[t.type] ?? t.type ?? '(空)'
  if (t.on === 'weaponId')     return t.id ?? '(空)'
  return `(未知 on=${t.on})`
}

/** ② 這個對象在庫裡匹配得到東西嗎 */
function matchCount(t, weapons, backpacks) {
  if (t?.on === 'weaponKind')   return weapons.filter((w) => w.kind === t.kind).length
  if (t?.on === 'backpackType') return backpacks.filter((b) => b.type === t.type).length
  if (t?.on === 'weaponId')     return weapons.filter((w) => w.id === t.id).length
  return 0
}

/**
 * ③ 從正文裡找出「同時提到這個對象與這個屬性」的句子，抽出其中的數字。
 *
 * ⚠ 切句是必要的：整段正文裡到處都是數字（「造成0.2倍傷害」「可疊加25層」），
 *   不切句就會把任何一個巧合的數字當成佐證，讓這個檢查變成永遠通過。
 */
function sentencesFor(text, targetName, statKey) {
  const words = STAT_WORDS[statKey] ?? []
  return String(text || '')
    .split(/[；;。\n]/)
    .map((s) => s.trim())
    .filter((s) => s.includes(targetName) && words.some((w) => s.includes(w)))
}

const numbersIn = (s) => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)

async function main() {
  initFirebase()
  log('▶ 天賦配裝修正健檢（唯讀）\n')

  const [pilotSnap, weaponSnap, backpackSnap] = await Promise.all([
    db.collection('pilots').get(),
    db.collection('weapons').get(),
    db.collection('backpacks').get(),
  ])
  const weapons   = weaponSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const backpacks = backpackSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const pilots    = pilotSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => !ONE_PILOT || p.name === ONE_PILOT)

  const report = { missing: [], badTarget: [], drift: [], unverifiable: [], filled: 0 }

  for (const p of pilots) {
    for (const t of p.talents ?? []) {
      const mods = t.loadoutMods ?? []

      // ① 漏填
      if (needsLoadoutModsHint(t)) {
        report.missing.push({ pilot: p.name, talent: t.name, words: loadoutModHintWords(t) })
        continue
      }
      if (!mods.length) continue
      report.filled += mods.length

      const full = `${t.description ?? ''}\n${t.descriptionMax ?? ''}`
      for (const m of mods) {
        const label = targetLabel(m.target)

        // ② 對象匹配不到任何東西
        const n = matchCount(m.target, weapons, backpacks)
        if (n === 0) {
          report.badTarget.push({ pilot: p.name, talent: t.name, target: label, mod: m })
          continue
        }

        // ③ 數值漂移（僅 stat 類；allowEquip 沒有值可比）
        if (m.kind !== 'stat') continue
        const sents = sentencesFor(full, label, m.stat)
        if (!sents.length) {
          report.unverifiable.push({ pilot: p.name, talent: t.name, target: label, stat: m.stat })
          continue
        }
        // pct 存小數（−0.15），正文寫百分點（15）——比對前換算回去
        const want = m.mode === 'pct' ? Math.abs(m.amount) * 100 : Math.abs(m.amount)
        const found = sents.flatMap(numbersIn)
        if (!found.some((v) => Math.abs(v - want) < 0.001)) {
          report.drift.push({ pilot: p.name, talent: t.name, target: label, stat: m.stat, want, found, sents })
        }
      }
    }
  }

  // ── 輸出 ──────────────────────────────────────────────────────────────────
  log(`  已填規則 ${report.filled} 條（掃過 ${pilots.length} 位機師）\n`)

  if (report.missing.length) {
    // 強訊號＝實測零誤報（負重／重量／額外裝備／可裝備）；弱訊號誤報多
    // （「耐久值高於50%」「治療射程+1」講的是戰鬥效果，不是裝備屬性）。
    // 分兩組印，是為了讓管理者的眼睛先落在該落的地方——混成一坨的清單等於沒有清單。
    const strongRe = /負重|重量|額外裝備|可裝備/
    const strong = report.missing.filter((m) => m.words.some((w) => strongRe.test(w)))
    const weak   = report.missing.filter((m) => !m.words.some((w) => strongRe.test(w)))

    log(`❶ 疑似漏填（正文像在講裝備、但一條規則都沒有）—— ${report.missing.length} 筆`)
    if (strong.length) {
      log(`   ▶ 強訊號 ${strong.length} 筆（提到負重／重量／額外裝備 —— 建檔當下實測零誤報）`)
      for (const m of strong) log(`      · ${m.pilot}〈${m.talent}〉 提到：${m.words.join('、')}`)
    }
    if (weak.length) {
      log(`   ▶ 弱訊號 ${weak.length} 筆（射程／耐久／彈藥 —— 多數是戰鬥效果，誤報為常態）`)
      for (const m of weak) log(`      · ${m.pilot}〈${m.talent}〉 提到：${m.words.join('、')}`)
    }
    log('   → 到後台「機師管理 › 天賦」填規則；此天賦確實不改裝備就忽略。')
    log('   ⚠ 本項**不計入離開碼**：關鍵字必然誤報（建檔當下 32 命中／18 真需要），')
    log('     當成 gate 會讓這支永遠是紅的，而永遠紅的檢查等於沒有檢查。\n')
  }
  if (report.badTarget.length) {
    log(`❷ 對象匹配不到任何裝備（＝這條規則對誰都沒生效）—— ${report.badTarget.length} 筆`)
    for (const b of report.badTarget) log(`   ✗ ${b.pilot}〈${b.talent}〉 對象「${b.target}」在庫中 0 筆`)
    log('   → 多半是種類名打錯。後台的對象欄位是 enum 下拉，改用下拉重選即可\n')
  }
  if (report.drift.length) {
    log(`❸ 數值與正文不符（官方調過數字？）—— ${report.drift.length} 筆`)
    for (const d of report.drift) {
      log(`   ✗ ${d.pilot}〈${d.talent}〉 ${d.target}/${d.stat}：規則寫 ${d.want}，正文只找到 ${d.found.join('、') || '(無數字)'}`)
      d.sents.forEach((s) => log(`        正文：${s}`))
    }
    log('   → 對照遊戲確認後，改後台的 amount（正文由爬蟲維護，通常正文才是新的）\n')
  }
  if (report.unverifiable.length) {
    log(`（無法驗證 ${report.unverifiable.length} 筆：正文裡找不到同時提到對象與該屬性的句子）`)
    for (const u of report.unverifiable) log(`   · ${u.pilot}〈${u.talent}〉 ${u.target}/${u.stat}`)
    log('   這不算錯——官方可能改了措辭。但若數量變多，代表 ❸ 的涵蓋率正在下降\n')
  }

  if (JSON_OUT) {
    const p = resolve(ROOT, JSON_OUT)
    fs.mkdirSync(dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(report, null, 2), 'utf-8')
    log(`已輸出：${p}`)
  }

  // ⚠ 只有 ❷❸ 計入離開碼：那兩類是「已填的東西壞了」（確定性錯誤），
  //   而 ❶ 是「可能有東西該填」（探索性提示，必然誤報）。混在一起會讓這支永遠 exit 1。
  const problems = report.badTarget.length + report.drift.length
  if (problems) { log(`\n❌ 共 ${problems} 項需要處理（❷❸）。`); process.exit(1) }
  log(`✅ 已填的 ${report.filled} 條規則：對象全部有效、數值與正文一致。`)
  if (report.missing.length) log(`   （❶ 的 ${report.missing.length} 筆提示不影響離開碼，請自行掃視上方清單）`)
}

main().catch((e) => { console.error('\n❌', e.message); process.exit(1) })
