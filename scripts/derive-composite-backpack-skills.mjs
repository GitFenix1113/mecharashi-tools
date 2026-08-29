/**
 * PLAN-043 Phase F — S+ 複合背包 skillIds 回填（derive + 官方守門）
 *
 * 98 筆 S+ 複合背包的 `skillIds` 全空，模擬器因此對「出力干擾/強化背包·◯◯」算不出出力。
 * 官方 API 其實有這 98 筆的技能文本（`WithPassiveSkills[]`），只是 Phase B 遷移時沒收進
 * `backpackSkills`。本腳本不新建技能 doc，而是把複合背包指回**既有的兩支 S 級技能**：
 *
 *     出力干擾背包·命中 → ['bpskill_出力增幅@3', 'bpskill_命中壓制@3']
 *
 * ── 組合律（2026-08-30 以官方資料自我比對，97/98 逐字相符）───────────────────
 *   複合技能文本 ＝ 功能背包(S級)技能全文 ∪ 變體背包(S級)技能的「非底線行」
 *   複合技能名   ＝ 功能技能名 + '·' + 變體            （98/98）
 *   BufCarried   ＝ 兩者聯集                            （97/98）
 *
 * ⚠ 底線行（「軀幹耐久值提升X%…」）**只認功能側那一份**，變體側的一律丟棄。
 *   `修理裝置Ⅰ` 本身沒有底線行 → 9 筆修理系複合背包**完全沒有**軀幹加成，即使變體側有。
 *   天真地把兩支技能相加會得到軀幹 +20%，修理系還會憑空多出 +10%。
 *
 * ⚠ 唯一不吻合：`彈藥強化背包·首攻`（官方少寫「對戰」二字，buff 600433 vs 600431）。
 *   使用者裁決：那不是筆誤——彈藥包是戰術家用的，戰術家幾乎沒有「對戰」技能，
 *   所以它是真的**另一支技能**而非同一支的錯字。故為它單建一支專用技能 doc（見 EXCEPTIONS），
 *   而不是硬掛 `bpskill_首攻強化@3` 讓畫面多出兩個字。
 *
 * ── 守門 ────────────────────────────────────────────────────────────────────
 * 每一筆都拿**官方**三份文本（複合／功能／變體）現場驗證組合律；不通過就不寫該筆。
 * 官方資料由 `--fetch` 現抓（或吃 scripts/temp_scripts/official-backpacks.json 快取）。
 *
 * 使用方式：
 *   node scripts/derive-composite-backpack-skills.mjs            ← dry-run（預設，不寫入）
 *   node scripts/derive-composite-backpack-skills.mjs --fetch    ← 重抓官方資料
 *   node scripts/derive-composite-backpack-skills.mjs --write    ← 實際寫入 + bump 版本
 */

import fs from 'fs'
import https from 'https'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const CACHE = resolve(ROOT, 'scripts/temp_scripts/official-backpacks.json')

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const FETCH = args.includes('--fetch')

const API_BASE = 'https://ma-activity.zlongame.com/common/infodata/mQuery.do'
const APP_KEY = '1616148215678'

// ── Firebase ────────────────────────────────────────────────────────────────
function loadEnv(f) {
  const p = resolve(ROOT, f)
  if (!fs.existsSync(p)) return
  fs.readFileSync(p, 'utf-8').split('\n').forEach((l) => {
    const i = l.indexOf('=')
    if (i > 0) {
      const k = l.slice(0, i).trim(); const v = l.slice(i + 1).trim()
      if (k && v && !k.startsWith('#')) process.env[k] = v
    }
  })
}
loadEnv('.env'); loadEnv('.env.migration')
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!credPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS 未設定（需 .env.migration 服務帳號）')
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(resolve(ROOT, credPath), 'utf-8'))) })
const db = admin.firestore()

// ── 官方資料 ────────────────────────────────────────────────────────────────
const fetchJson = (url) => new Promise((res, rej) => {
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (r) => {
    if (r.statusCode !== 200) { rej(new Error(`HTTP ${r.statusCode}`)); return }
    let b = ''
    r.on('data', (c) => { b += c })
    r.on('end', () => { try { res(JSON.parse(b)) } catch (e) { rej(e) } })
  }).on('error', rej)
})

async function loadOfficial() {
  if (!FETCH && fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE, 'utf-8'))
  const list = (await fetchJson(`${API_BASE}?appkey=${APP_KEY}&target=backpack_data&type=list`)).data?.data || []
  const out = []
  for (const it of list) {
    const id = String(it.ID ?? it.id)
    const d = (await fetchJson(`${API_BASE}?appkey=${APP_KEY}&target=backpack_data&type=detail&query=${encodeURIComponent(id)}`)).data?.data
    out.push({ id, name: it.name, quality: it.quality, raw: Array.isArray(d) ? d[0] : d })
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true })
  fs.writeFileSync(CACHE, JSON.stringify(out, null, 2))
  return out
}

// ── 文本正規化（守門用；只作用於官方文字，不碰站上資料）─────────────────────
const stripTags = (t) => (t || '').replace(/<[^>]+>/g, '')
const toLines = (t) => stripTags(t).split(/[\n;；]/).map((s) => s.replace(/\s/g, '').replace(/[。，,]$/, '')).filter(Boolean)
/** 底線行：官方一律寫「躯干耐久值提升」（簡體）。 */
const BASELINE = /躯干耐久值提升/
const officialSkill = (b) => (b?.raw?.WithPassiveSkills || [])[0]

/**
 * 人工裁決過的例外：守門擋下、但確認是「官方真的不一樣」而非資料錯的那些。
 *
 * 目前只有一筆。`彈藥強化背包·首攻` 的變體側官方寫「每回合第1次主動攻擊**時**」，
 * 而 S 級 `強化背包·首攻` 是「主動攻擊**對戰**時」——彈藥包是戰術家用的，戰術家幾乎沒有
 * 「對戰」技能，所以這兩個字的有無是實質差異。硬掛 `bpskill_首攻強化@3` 會在畫面上
 * 講出一個這顆背包做不到的條件，因此為它單建一支專用技能（id 帶背包 doc id 後綴，
 * 沿用 `backpackSkills` 的「同名不同效加背包 id」慣例）。
 *
 * ⚠ 這是**擴編一筆**的決定，不是預設路徑。再出現同類情形時先問「是官方真的不同，
 *   還是我們的文本抄錯了」——後者該修既有技能，不是再長一支。
 */
const EXCEPTIONS = [{
  backpackId: '60902405',   // 彈藥強化背包·首攻
  skillIds: ['bpskill_戰術彈量增加@2', 'bpskill_首攻強化_60902405'],
  seedSkill: {
    id: 'bpskill_首攻強化_60902405',
    name: '首攻強化Ⅲ',
    skillType: '被動技能',
    // 與 bpskill_首攻強化@3 逐字相同，**只少了「對戰」二字**——這就是它存在的全部理由。
    description: '每回合第1次主動攻擊時，傷害提升7.5%，暴擊率提升5%；機甲軀幹耐久值提升10%',
    icon: '/images/skills/被動技能/Icon_skill_passive_1011.png',
    effects: [],
    buffIds: [],
    // officialId 不填：61191 是**複合技能**（戰術彈量增加Ⅱ·首攻）的 id，
    // 不是這半邊的 id，填了會讓人以為官方有這支獨立技能。
  },
}]
const EXCEPTION_BY_ID = new Map(EXCEPTIONS.map((e) => [e.backpackId, e]))

// ── 主流程 ──────────────────────────────────────────────────────────────────
const SEP = /[·・]/

async function main() {
  const official = await loadOfficial()
  const officialById = new Map(official.map((o) => [o.id, o]))

  const snap = await db.collection('backpacks').get()
  const bps = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const sTier = bps.filter((b) => b.rarity === 'S')
  /** 功能軸：同 type 的 S 級「純功能背包」（名字不帶間隔號）。 */
  const funcByType = new Map(sTier.filter((b) => b.name.search(SEP) < 0).map((b) => [b.type, b]))
  /** 變體軸：S 級「強化背包·◯◯ / 干擾背包·◯◯」，以名字索引。 */
  const variantByName = new Map(sTier.filter((b) => b.name.search(SEP) >= 0).map((b) => [b.name, b]))

  const plan = []
  const skipped = []
  for (const bp of bps.filter((b) => b.rarity === 'S+')) {
    const sep = bp.name.search(SEP)
    if (sep < 0) { skipped.push([bp.name, '名字無間隔號']); continue }
    const variant = bp.name.slice(sep + 1)
    const m = bp.name.slice(0, sep).match(/^(.*?)(強化|干擾)背包$/)
    if (!m) { skipped.push([bp.name, '名字不符「◯◯強化/干擾背包·變體」文法']); continue }
    const line = m[2]

    const fnBp = funcByType.get(bp.type)
    const vaBp = variantByName.get(`${line}背包·${variant}`)
    if (!fnBp || !vaBp) { skipped.push([bp.name, `找不到來源（功能=${fnBp?.name ?? '✗'} 變體=${vaBp?.name ?? '✗'}）`]); continue }

    const fnSkill = (fnBp.skillIds || [])[0]
    const vaSkill = (vaBp.skillIds || [])[0]
    if (!fnSkill || !vaSkill) { skipped.push([bp.name, '來源背包自己沒掛技能']); continue }

    // ── 守門：拿官方三份文本現場驗證組合律 ──────────────────────────────────
    const oComposite = officialById.get(bp.id)
    const oFunc = officialById.get(fnBp.id)
    const oVariant = officialById.get(vaBp.id)
    let gate = 'ok'
    let detail = ''
    if (!oComposite || !oFunc || !oVariant) {
      gate = 'no-official'
      detail = '官方資料缺一角，無法驗證'
    } else {
      const actual = toLines(officialSkill(oComposite)?.SpecificEffects)
      const pred = [
        ...toLines(officialSkill(oFunc)?.SpecificEffects),
        ...toLines(officialSkill(oVariant)?.SpecificEffects).filter((l) => !BASELINE.test(l)),
      ]
      const missing = actual.filter((l) => !pred.includes(l))
      const extra = pred.filter((l) => !actual.includes(l))
      if (missing.length || extra.length) { gate = 'mismatch'; detail = JSON.stringify({ missing, extra }) }
    }

    // 人工裁決過的例外：改掛指定技能，並把 gate 從 mismatch 轉成 override（可寫入）。
    const ex = EXCEPTION_BY_ID.get(bp.id)
    if (ex) {
      gate = 'override'
      detail = `人工裁決：改掛 ${ex.skillIds.join(' ＋ ')}（原因見 EXCEPTIONS 註解）`
    }

    plan.push({
      id: bp.id,
      name: bp.name,
      type: bp.type,
      from: ex ? '（人工裁決）' : `${fnBp.name} ＋ ${vaBp.name}`,
      skillIds: ex ? ex.skillIds : [fnSkill, vaSkill],
      officialSkillName: officialSkill(oComposite)?.name ?? '',
      gate,
      detail,
    })
  }

  // ── 報告 ──────────────────────────────────────────────────────────────────
  const ok = plan.filter((p) => p.gate === 'ok' || p.gate === 'override')
  const bad = plan.filter((p) => p.gate !== 'ok' && p.gate !== 'override')
  console.log(`S+ 複合背包 ${plan.length + skipped.length} 筆 · 可推導 ${plan.length} · 可寫入 ${ok.length}（含人工裁決 ${plan.filter((p) => p.gate === 'override').length}） · 未過 ${bad.length} · 略過 ${skipped.length}\n`)
  for (const p of plan) {
    const mark = p.gate === 'ok' ? '✔' : (p.gate === 'override' ? '◆' : '⚠')
    console.log(`${mark} ${p.name.padEnd(14)} ← ${p.from.padEnd(26)} → [${p.skillIds.join(', ')}]   官方：${p.officialSkillName}`)
    if (p.detail) console.log(`     ${p.detail}`)
  }
  skipped.forEach(([n, why]) => console.log(`✖ ${n}：${why}`))

  fs.writeFileSync(resolve(ROOT, 'scripts/temp_scripts/plan043-phaseF-plan.json'), JSON.stringify({ plan, skipped }, null, 2))

  if (!WRITE) {
    console.log(`\n[dry-run] 未寫入任何資料。確認無誤後加 --write 執行（會寫 ${ok.length} 筆並 bump backpacks 版本）。`)
    return
  }

  // ── 寫入 ────────────────────────────────────────────────────────────────
  // ⚠ 順序不能顛倒：技能 doc 要先存在，背包才能指過去。反過來寫的話中間那一瞬間
  //   （或腳本中途失敗時）背包會掛著一個查不到的 id，前台雖然會優雅降級成「少一塊」，
  //   但後台挑選器會標紅字，看起來像資料壞了。
  let seeded = 0
  for (const ex of EXCEPTIONS) {
    if (!ok.some((p) => p.id === ex.backpackId)) continue
    await db.collection('backpackSkills').doc(ex.seedSkill.id).set(ex.seedSkill, { merge: true })
    seeded++
    console.log(`已建立專用技能 ${ex.seedSkill.id}（${ex.seedSkill.name}）`)
  }

  let n = 0
  for (let i = 0; i < ok.length; i += 400) {
    const batch = db.batch()
    for (const p of ok.slice(i, i + 400)) {
      batch.update(db.collection('backpacks').doc(p.id), { skillIds: p.skillIds })
      n++
    }
    await batch.commit()
  }
  console.log(`已寫入 ${n} 筆 skillIds。`)

  // 兩個集合都動到就都要 bump——只 bump backpacks 的話，新技能 doc 進不了舊 client 的
  // backpackSkills 快取，那 98 筆會集體解析失敗，畫面表現為「技能框整個不見」。
  //
  // ⚠ 版本號是**時間戳字串**、且住在巢狀的 `versions.<key>`，不是頂層欄位也不是遞增整數
  //   （見 src/lib/api/versions.ts 的 getDataVersions：只讀 `d.version` 與 `d.versions`）。
  //   2026-08-30 本腳本初版在這裡寫成 `(cur.backpacks ?? 0) + 1`，結果把頂層寫進一個
  //   `"2026-07-04T…Z1"` 的垃圾字串，而真正的 `versions.backpacks` 動都沒動 ——
  //   **腳本印出「已 bump」，client 快取卻完全沒失效**，是最難察覺的那種失敗。
  //   （`meta/gameData` 頂層還留著 `mechs: 1` / `modules: 1`，是更早的腳本犯過同一個錯。）
  const metaRef = db.collection('meta').doc('gameData')
  const version = new Date().toISOString()
  const versions = { backpacks: version }
  if (seeded) versions.backpackSkills = version
  await metaRef.set({ versions, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
  console.log(`已 bump meta/gameData.versions：${JSON.stringify(versions)}（所有 client 對應快取失效）`)
  if (bad.length) console.log(`\n⚠ ${bad.length} 筆未過，未寫入：${bad.map((b) => b.name).join('、')}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
