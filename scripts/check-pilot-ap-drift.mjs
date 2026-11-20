#!/usr/bin/env node
/**
 * 機師 AP 對帳（唯讀）— 2026-11-21
 *
 * ── 對什麼 ──────────────────────────────────────────────────────────────────
 * 正式庫的三樣東西 vs 最新的陸版遊戲參數資料包：
 *   ① pilots.ap（潛能 5）        vs PilotPropertiesTemplateInfo（最後一階）的 PilotAP*Base
 *   ② pilots.apBase（潛能 0）    vs 第一階
 *   ③ 神經驅動的 AP 加成合計      vs 官方「無條件」的 AP 屬性
 *      站上：各等級能力 neuralDriveAbilities.apBonus 的加總（src/utils/ndApBonus.ts，機師詳情頁用的同一份）
 *      官方：神經驅動被動技能的 PropertiesList ＋ 沒有啟動條件、沒有觸發、永久的 BUFF 的 PropertiesList，
 *            屬性 352＝初始、28＝上限、32＝回復。條件式（天才4 這類）官方掛的是有 ActiveCondIds 的 BUFF，不算。
 *
 * ── 為什麼需要這支 ──────────────────────────────────────────────────────────
 * AP 加成以前是掃說明文字算的，條件句也會掃中，92 位有 6 位多算，而畫面完全看不出來。
 * 改成存數字（apBonus）之後，錯法變成「新能力漏填」或「填錯共用能力」——一樣不會報錯。
 * 這支直接拿官方資料比，不靠人記得哪些能力該填。
 *
 * ── 怎麼讀結果 ──────────────────────────────────────────────────────────────
 * ③ 不一致時會逐級列出哪一格差多少（以分區順序與等級順序對齊站上與官方）。處置：
 *   · 某個能力該有加成卻沒填（或填錯）→ 後台「神經驅動能力」編輯該能力的 AP 加成欄
 *     ⚠ 共用能力（AP優化2…）改一次會改到所有掛載機師；同名異文的請改掛 `_戰術家` 這類分身，不要直接改共用的
 *   · ①② 不一致 → 後台「機師管理 › 屬性數值・AP」
 * 資料包是陸版：陸版先改、台版還沒跟上時這裡也會報，那種就等台版上線再改。
 *
 * 使用：
 *   node scripts/check-pilot-ap-drift.mjs     ← 唯讀；有落差時 exit 1，找不到資料包 exit 2
 *
 * 對應方式：pilots.gameRef.pilotInfoId，沒有就用 gameId（機師卡編號，與機師記錄 ID 相同的佔多數）。兩者都沒有的列在最後。
 */

import admin from 'firebase-admin'
import fs from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { latestGamePackage, openGamePackage } from './lib/gamePackage.mjs'
import { sumNdApBonus, AP_KEYS } from '../src/utils/ndApBonus.ts'
import { buildNdAbilityMap, resolveNeuralDriveLevel } from '../src/utils/neuralDriveAbilities.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const KEY = resolve(ROOT, 'serviceAccountKey.json')
if (!fs.existsSync(KEY)) {
  console.error('✗ 找不到 serviceAccountKey.json')
  process.exit(1)
}
const pkg = latestGamePackage()
if (!pkg) {
  console.error('✗ 找不到陸版遊戲參數資料包（E:/Mecharashi_Data 底下的 遊戲參數資料包_*／改版調查_*/資料），無法對帳')
  process.exit(2)
}
const P = openGamePackage(pkg)

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY, 'utf8'))) })
const db = admin.firestore()
const [pilotSnap, ndaSnap] = await Promise.all([db.collection('pilots').get(), db.collection('neuralDriveAbilities').get()])
const pilots = pilotSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
const abilityMap = buildNdAbilityMap(ndaSnap.docs.map((d) => ({ id: d.id, ...d.data() })))

// ─── 官方 ───────────────────────────────────────────────────────────────────
const AP_PROP = { 352: 'init', 28: 'max', 32: 'recovery' }
const LABEL = { init: '初始', max: '上限', recovery: '回復' }
const zero = () => ({ init: 0, max: 0, recovery: 0 })
const fmt = (o) => (o ? `${o.init}/${o.max}/${o.recovery}` : '—')
const same = (a, b) => AP_KEYS.every((k) => (a?.[k] ?? 0) === (b?.[k] ?? 0))
const bonusText = (o) => AP_KEYS.filter((k) => o?.[k]).map((k) => `${LABEL[k]}+${o[k]}`).join(' ') || '—'

const isPermanentBuff = (b) => b && !b.ActiveCondIds?.length && !b.ExtraActiveCondIds?.length
  && !b.TriggerType && !b.TriggerType2 && b.LifeTime === -1

/** 一個神經驅動被動技能給的永久 AP 屬性 */
function officialLevelAp(passiveId) {
  const s = P.rec('ConfigDataPassiveSkillInfo', passiveId)
  const out = zero()
  if (!s) return out
  const props = [...(s.PropertiesList ?? [])]
  for (const b of s.BufIds ?? []) {
    const buf = P.rec('ConfigDataActorBufInfo', b)
    if (isPermanentBuff(buf)) props.push(...(buf.PropertiesList ?? []))
  }
  for (const x of props) if (AP_PROP[x.Id]) out[AP_PROP[x.Id]] += P.fx(x.Value)
  return out
}

function official(info) {
  const stars = (info.StarPropertiesTemplateId ?? []).map((t) => P.rec('ConfigDataPilotPropertiesTemplateInfo', t))
  const apOf = (t) => (t ? { init: t.PilotAPInitBase, max: t.PilotAPMaxBase, recovery: t.PilotAPRecoverBase } : null)
  const zones = (P.rec('ConfigDataPilotChipTemplateInfo', info.ChipTemplateId)?.PilotChipZoneInfoList ?? []).map((z) => {
    const zr = P.rec('ConfigDataPilotChipZoneInfo', z)
    return {
      name: P.text(zr?.NameStrKey),
      levels: (zr?.ActiveEffectInfos ?? []).map((e) => {
        const er = P.rec('ConfigDataPilotChipZoneActiveEffectInfo', e)
        return { minSum: er?.PowerCostSumMin, ap: officialLevelAp(er?.EffectPassiveSkillId) }
      }),
    }
  })
  const nd = zero()
  for (const z of zones) for (const lv of z.levels) for (const k of AP_KEYS) nd[k] += lv.ap[k]
  return { ap: apOf(stars.at(-1)), apBase: apOf(stars[0]), nd, zones }
}

// ─── 比對 ───────────────────────────────────────────────────────────────────
const apDrift = [], apBaseDrift = [], ndDrift = [], unmapped = []
let checked = 0
for (const p of pilots.sort((a, b) => a.id.localeCompare(b.id))) {
  const infoId = p.gameRef?.pilotInfoId ?? (p.gameId ? Number(p.gameId) : null)
  const info = infoId ? P.rec('ConfigDataPilotInfo', infoId) : null
  if (!info) { unmapped.push(`${p.name}（${p.id}${infoId ? `，${infoId} 不在資料包` : '，沒有 gameRef／gameId'}）`); continue }
  checked++
  const off = official(info)
  if (!same(p.ap, off.ap)) apDrift.push(`${p.name}：站上 ${fmt(p.ap)}／官方 ${fmt(off.ap)}`)
  if (!same(p.apBase, off.apBase)) apBaseDrift.push(`${p.name}：站上 ${fmt(p.apBase)}／官方 ${fmt(off.apBase)}`)

  const site = sumNdApBonus(p.neuralDrive, abilityMap)
  if (same(site, off.nd)) continue
  // 逐級對齊：分區順序、等級順序與官方相同時，指出是哪一格
  const lines = []
  const zs = p.neuralDrive ?? []
  const aligned = zs.length === off.zones.length && zs.every((z, i) => (z.levels ?? []).length === off.zones[i].levels.length)
  if (aligned) {
    zs.forEach((z, zi) => (z.levels ?? []).forEach((lv, li) => {
      const a = resolveNeuralDriveLevel(lv, abilityMap)
      const want = off.zones[zi].levels[li].ap
      if (!same(a.apBonus, want)) lines.push(`    ${z.name} ≥${lv.minSum}  ${a.name || '?'}（${lv.abilityId ?? '嵌入'}）：站上 ${bonusText(a.apBonus)}／官方 ${bonusText(want)}`)
    }))
  } else {
    lines.push(`    （分區或等級數與官方不同，無法逐級對齊：站上 ${zs.map((z) => `${z.name}×${z.levels?.length ?? 0}`).join(' ')}`
      + `／官方 ${off.zones.map((z) => `${z.name}×${z.levels.length}`).join(' ')}）`)
  }
  ndDrift.push(`${p.name}：站上 ${fmt(site)}／官方 ${fmt(off.nd)}\n${lines.join('\n')}`)
}
P.close()

// ─── 報告 ───────────────────────────────────────────────────────────────────
console.log(`資料包：${pkg.label}　比對 ${checked} 位機師（AP 格式：初始/上限/回復）\n`)
const section = (title, rows) => {
  console.log(`${rows.length ? '✗' : '✓'} ${title}${rows.length ? `：${rows.length} 位` : '：全部一致'}`)
  for (const r of rows) console.log(`  ${r}`)
  if (rows.length) console.log('')
}
section('① ap（潛能 5）', apDrift)
section('② apBase（潛能 0）', apBaseDrift)
section('③ 神經驅動 AP 加成（能力的 apBonus 加總）', ndDrift)
if (unmapped.length) console.log(`\nℹ 沒比到（${unmapped.length}）：${unmapped.join('、')}`)

process.exit(apDrift.length + apBaseDrift.length + ndDrift.length ? 1 : 0)
