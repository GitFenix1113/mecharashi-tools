#!/usr/bin/env node
/**
 * PLAN-064 A-7：武裝討伐組裝段——擷取結果（中性 JSON）→ 站上文件草稿 ＋ 照抄清單報告。
 *
 * ── 新一期討伐的例行流程（站長照抄；不需要開發者）──────────────────────────────────
 *   ① 陸版改版、資料包重新擷取後（工具會輸出到新目錄），跑：
 *        node scripts/import-raid-dungeons.mjs
 *      擷取結果過期會自己呼叫 scripts/extract-raid-dungeons.py。預設 dry-run：只出報告，不寫任何東西。
 *   ② 打開報告 _local-notes/<YYYY-MM>/<YYYY-MM-DD>_武裝討伐匯入.html，照「下一步」清單做（✅ 已完成、⬜ 待處理）。
 *   ③ 寫入草稿：node scripts/import-raid-dungeons.mjs --write
 *      只寫 raidDrafts（後台限定），永不直接寫前台讀的 raidSeasons／stages／bosses。
 *   ④ 到後台 /admin/raids 校對譯名、看差異與異常，按「發布」。
 *   ⑤ 重跑 ①，確認清單全 ✅。
 *   只有遊戲改了規則（新的觸發器型別、新屬性、新結構）才需要開發者——那些會在報告以 ⬜／⚠ 出現，不會默默產出錯資料。
 *
 * ── 參數 ──────────────────────────────────────────────────────────────
 *   --write             寫入 raidDrafts（以及「站上既有譯名」進 raidTerms，只補缺不覆蓋）
 *   --season 9,21       只處理這幾期
 *   --refresh           強制重新擷取
 *   --extract <檔案>     指定擷取結果（不檢查是否過期）
 *   --from-backup <dir> 不連 Firestore，改讀本機備份（_local-notes/db-backup-*）：離線試跑用，不能和 --write 一起用
 *   --dump              草稿另存一份到 _local-notes/<YYYY-MM>/<日期>_武裝討伐匯入_草稿/（逐期 JSON，人工檢查用）
 *   --today YYYY-MM-DD  判定「台版已開放」用的日期（預設今天）
 *
 * ── 判定與規則（計畫書決策）──────────────────────────────────────────────
 *   決策九  依期名對上時間線 armamentRaids：twDate 已過 → 台版已開放、未到 → 台版預計開放；
 *           期號小於已對上的最小期 → 視為早已開放；時間線還沒有的期不產草稿，只在報告列出。
 *   決策六  首領＝戰場 ref 為 BOSS／BOSS1… 的單位（BossID 只供顯示）；面板是推算值；異常見 scripts/lib/raidAnomalies.json。
 *   決策八  譯名查表見 scripts/lib/raidI18n.mjs；人工校對只存在 raidTerms，草稿與發布文件都是套表的結果。
 *   決策十  時間線上的「重裝征伐」（RaidActivity）不在本計畫，報告標「略過」。
 */

import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import * as R from './lib/raidRender.mjs'
import { Translator, TERM_KINDS, termHash } from './lib/raidI18n.mjs'
import { localDate } from './lib/gameDump.mjs'
import anomaliesCfg from './lib/raidAnomalies.json' with { type: 'json' }
import regression from './lib/raidRegression.json' with { type: 'json' }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_ROOT = 'E:/Mecharashi_Data'
const EXTRACT_DIR = path.join(DATA_ROOT, 'raid-extract')
const PY = path.join(DATA_ROOT, 'unitypy-venv/Scripts/python.exe')
const EXTRACT_SCRIPT = path.join(ROOT, 'scripts/extract-raid-dungeons.py')
const ESTIMATE_SCRIPT = path.join(ROOT, 'scripts/lib/raid_estimate.py')
const DIFF_ORDER = ['normal', 'hard', 'hell', 'd4']
/** 時間線上不是 RaidDungeon 的條目（決策十）：報告標「略過」，不算未對上 */
const SKIP_TIMELINE = { '重裝征伐': '略過：RaidActivity（重裝征伐），不在 PLAN-064' }
const PART_MAP = { body: 'torso', larm: 'leftArm', rarm: 'rightArm', leg: 'legs' }
const KIND_LABEL = { main: '主動', passive: '被動', talent: '天賦', mech: '機體固有', weapon: '武器', level: '等級加成' }
const SLOT_LABEL = { main: 'main', passive: 'passive', talent: 'talent', mech: 'mech', weapon: 'weapon', level: 'level' }
const DOC_SOFT_LIMIT = 900_000

// ─── 參數 ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
const WRITE = flag('--write')
const REFRESH = flag('--refresh')
const ONLY = opt('--season') ? new Set(opt('--season').split(',').map(Number)) : null
const FROM_BACKUP = opt('--from-backup')
const TODAY = opt('--today') || localDate()
if (WRITE && FROM_BACKUP) {
  console.error('✗ --from-backup 是離線試跑，不能和 --write 一起用')
  process.exit(1)
}

// ─── ① 擷取結果 ───────────────────────────────────────────────────────────
function latestPackage() {
  const dirs = fs.readdirSync(DATA_ROOT).filter((d) => d.startsWith('遊戲參數資料包_') && fs.existsSync(path.join(DATA_ROOT, d, '遊戲資料.sqlite')))
  return dirs.sort().at(-1)
}
function parserVersion() {
  const m = /^PARSER_VERSION\s*=\s*(\d+)/m.exec(fs.readFileSync(EXTRACT_SCRIPT, 'utf8'))
  return m ? Number(m[1]) : null
}
function newestExtract() {
  if (!fs.existsSync(EXTRACT_DIR)) return null
  const files = fs.readdirSync(EXTRACT_DIR).filter((f) => /^raid-extract_.*\.json$/.test(f))
    .map((f) => path.join(EXTRACT_DIR, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return files[0] || null
}
function runExtract(reason) {
  console.log(`… 重新擷取（${reason}）`)
  const r = spawnSync(PY, ['-I', EXTRACT_SCRIPT], { stdio: 'inherit', cwd: ROOT })
  if (r.status !== 0) {
    console.error('✗ 擷取失敗：venv 在嗎？見 scripts/export-gacha-prefab.py 檔頭的環境說明')
    process.exit(1)
  }
}
function loadExtract() {
  if (opt('--extract')) return JSON.parse(fs.readFileSync(opt('--extract'), 'utf8'))
  const pkg = latestPackage()
  let file = newestExtract()
  let data = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  let reason = null
  if (REFRESH) reason = '--refresh'
  else if (!data) reason = '還沒有擷取結果'
  else if (pkg && data.meta.build.package !== pkg) reason = `資料包換新：${data.meta.build.package} → ${pkg}`
  else if (data.meta.parserVersion !== parserVersion()) reason = `擷取規則改版：v${data.meta.parserVersion} → v${parserVersion()}`
  else if (fs.existsSync(ESTIMATE_SCRIPT) && fs.statSync(ESTIMATE_SCRIPT).mtimeMs > fs.statSync(file).mtimeMs) reason = '面板推算段有更新'
  else if (!data.meta.estimate && fs.existsSync(ESTIMATE_SCRIPT)) reason = '面板推算段已就位'
  if (reason) {
    runExtract(reason)
    file = newestExtract()
    data = JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  return data
}

// ─── ② 站上資料（時間線、對照表、已發布版本）──────────────────────────────────
async function loadSite() {
  const names = (docs) => new Set(docs.map((d) => d.name).filter(Boolean))
  if (FROM_BACKUP) {
    const read = (c) => {
      const f = path.join(FROM_BACKUP, `${c}.json`)
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).docs : []
    }
    const toMap = (docs) => Object.fromEntries(docs.map((d) => [d.id, d]))
    return {
      db: null, FieldValue: null,
      patchVersions: read('patchVersions'),
      termDocs: toMap(read('raidTerms')),
      published: { seasons: toMap(read('raidSeasons')), stages: toMap(read('stages')), bosses: toMap(read('bosses')) },
      drafts: toMap(read('raidDrafts')),
      known: { mech: names(read('mechs')), unit: names(read('pilots')), weapon: names(read('weapons')), backpack: names(read('backpacks')) },
    }
  }
  const key = path.join(ROOT, 'serviceAccountKey.json')
  if (!fs.existsSync(key)) {
    console.error('✗ 找不到 serviceAccountKey.json（離線試跑可用 --from-backup <備份目錄>）')
    process.exit(1)
  }
  const { default: admin } = await import('firebase-admin')
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(key, 'utf8'))) })
  const db = admin.firestore()
  // admin SDK 看到 FIRESTORE_EMULATOR_HOST 會改打模擬器；印出來，免得以為在測試、其實寫進正式庫（或反過來）
  console.log(`  Firestore：${process.env.FIRESTORE_EMULATOR_HOST ? `模擬器 ${process.env.FIRESTORE_EMULATOR_HOST}` : '正式庫'}${WRITE ? '（--write：會寫入 raidDrafts）' : '（唯讀）'}`)
  const all = async (c) => (await db.collection(c).get()).docs.map((d) => ({ id: d.id, ...d.data() }))
  const toMap = (docs) => Object.fromEntries(docs.map((d) => [d.id, d]))
  const [patchVersions, terms, seasons, stages, bosses, drafts, mechs, pilots, weapons, backpacks] = await Promise.all(
    ['patchVersions', 'raidTerms', 'raidSeasons', 'stages', 'bosses', 'raidDrafts', 'mechs', 'pilots', 'weapons', 'backpacks'].map(all),
  )
  return {
    db, FieldValue: admin.firestore.FieldValue, patchVersions,
    termDocs: toMap(terms),
    published: { seasons: toMap(seasons), stages: toMap(stages), bosses: toMap(bosses) },
    drafts: toMap(drafts),
    known: { mech: names(mechs), unit: names(pilots), weapon: names(weapons), backpack: names(backpacks) },
  }
}

function timelineRaids(patchVersions) {
  const out = []
  for (const v of patchVersions) {
    for (const half of ['upper', 'lower']) {
      for (const r of v[half]?.armamentRaids || []) {
        if (r?.name) out.push({ name: r.name, versionId: v.id, half, twDate: v[half].twDate || null, weapons: r.weapons || [], backpacks: r.backpacks || [] })
      }
    }
  }
  return out
}

// ─── ③ 組裝 ───────────────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0')
const seasonId = (seq) => `raid-${pad2(seq)}`
const stripUndefined = (o) => JSON.parse(JSON.stringify(o))
const firstLevel = (lv) => { const n = parseInt(String(lv || '').split('/')[0], 10); return Number.isFinite(n) && n > 0 ? n : undefined }
const bossSlot = (ref) => { const m = /(\d+)$/.exec(ref || ''); return m ? Number(m[1]) : 1 }
const bossDocsInStage = (bossMap, stageId) => [...bossMap.values()].filter((x) => x.stageId === stageId).length

/**
 * 每週規則（站上自己的台版用字；數字取自遊戲設定，遊戲改了重跑匯入就跟著變）。
 * 來源：ConfigableConst RaidDungeonSelectGroupMaxCount、StringTable 1116／1129／1333（擷取段 meta.rules）。
 */
function raidRules(rules = {}) {
  const out = []
  if (rules.selectGroupMax) out.push(`每週可把 ${rules.selectGroupMax} 個關卡組設為目標；領取戰鬥獎勵時才消耗挑戰機會。`)
  if (rules.finalNeedsWeek) out.push('最終關要先在本週完成同難度的其他關卡，才能進入戰鬥。')
  out.push('選擇較高難度時，同時取得較低難度的關卡獎勵。')
  if (rules.freeFirstPass) out.push('新解鎖的關卡組，首次戰鬥不消耗挑戰機會。')
  return out
}

class Assembler {
  constructor(ex, tr, report) {
    this.ex = ex
    this.tr = tr
    this.report = report
  }

  unitRaw(key) {
    return key.startsWith('v') ? this.ex.vehicles[key.slice(1)] : this.ex.units[key]
  }

  /** 遊戲說明 → 引用記號 → 台版用字 */
  richText(raw, season, kind = 'text') {
    if (!raw) return undefined
    const { text, unknownTags } = R.convertTags(raw)
    for (const t of unknownTags) this.report.unknownTags.add(t)
    return this.tr.text(kind, text, season)
  }

  buff(id) { return this.ex.buffs[String(id)] }

  /** ⟦…⟧ 引用 → 字典條目（名稱＋說明）；說明裡又有引用時一併收進來（最多三層） */
  buildRefDict(texts, season) {
    const dict = {}
    let queue = texts.flatMap((t) => R.tokenRefs(t))
    for (let depth = 0; depth < 3 && queue.length; depth++) {
      const next = []
      for (const key of queue) {
        if (dict[key] || key.startsWith('unit:')) continue
        const [kind, id] = key.split(':')
        let entry = null
        if (kind === 'buf') {
          const b = this.buff(id)
          if (b) entry = { name: this.tr.name('buff', b.name || '', season) || '效果', desc: b.devnote ? undefined : this.richText(b.desc, season) }
        } else if (kind === 'terrain') {
          const t = this.ex.terrains[id]
          if (t) entry = { name: this.tr.name('terrain', t.name || '', season), desc: this.richText(t.desc, season) }
        } else {
          const s = this.ex.skills[`${kind}:${id}`]
          if (s) entry = { name: this.tr.name('skill', s.name || '', season), desc: this.richText(s.desc, season) }
        }
        if (!entry) { this.report.missingRefs.add(key); continue }
        dict[key] = stripUndefined(entry)
        if (entry.desc) next.push(...R.tokenRefs(entry.desc))
      }
      queue = next
    }
    return dict
  }

  /** 難度強化：首領模板 DefaultBuffs、關卡全域（敵方／全體）、開戰時觸發器掛給首領或敵方全隊的 Buff */
  difficultyBuffs(battle, bossTemplateIds) {
    const ids = new Set()
    for (const tid of bossTemplateIds) for (const b of this.ex.units[String(tid)]?.defaultBuffs || []) ids.add(b)
    const gb = battle.globalBuffs || {}
    for (const b of [...(gb.defender || []), ...(gb.all || [])]) ids.add(b)
    for (const t of battle.triggers || []) {
      for (const a of t.actions) {
        if (a.t !== 'addBuff') continue
        if (a.target.team === 4 || R.isBossRef(a.target.ref)) ids.add(a.buffId)
      }
    }
    return [...ids].filter((id) => R.isDifficultyBuff(this.buff(id)))
  }

  statText(buffIds) {
    const props = buffIds.flatMap((id) => this.buff(id)?.props || [])
    const { lines, unknown } = R.statLines(props)
    for (const k of unknown) this.report.unknownProps.add(k)
    return lines
  }

  skillOf(ref, slot, season) {
    const s = this.ex.skills[ref]
    if (!s) return null
    return stripUndefined({
      name: this.tr.name('skill', s.name || '', season),
      description: this.richText(s.desc, season) || '',
      icon: s.icon || undefined,
      kind: SLOT_LABEL[slot] || 'passive',
      ap: s.ap || undefined,
    })
  }

  /** 一期 → { season, stages, bosses, anecdotes } */
  season(s, tl) {
    const seq = s.id
    const sid = seasonId(seq)
    const tr = this.tr
    const atlas = this.ex.atlas.filter((a) => s.groups.some((g) => Object.values(g.variants).some((v) => a.levelIds.includes(v.levelId))))
    const faction = atlas.find((a) => a.faction)?.faction
    const stages = []
    const bosses = new Map()
    const anecdotes = []
    const seasonAnoms = []

    for (const g of s.groups) {
      const stageId = `${sid}-g${g.group}`
      const codes = DIFF_ORDER.filter((c) => g.variants[c])
      const unitKeys = new Set()
      const texts = []
      const variants = {}
      const normalBattle = this.ex.battles[String(g.variants[codes[0]].battleId)]
      const normalBosses = (normalBattle?.actors || []).filter((a) => a.kind === 'unit' && R.isBossRef(a.ref)).map((a) => a.configId)

      for (const code of codes) {
        const lv = g.variants[code]
        const b = this.ex.battles[String(lv.battleId)]
        if (!b) { this.report.issues.push(`第 ${seq} 期 ${code} 關 ${lv.levelId}：找不到戰場 ${lv.battleId}`); continue }
        let bossActors = b.actors.filter((a) => a.kind === 'unit' && R.isBossRef(a.ref))
        if (!bossActors.length) bossActors = b.actors.filter((a) => a.kind === 'unit' && a.configId === lv.bossIdField)
        if (!bossActors.length) this.report.issues.push(`第 ${seq} 期 ${code} 關 ${lv.levelId}：戰場 ${lv.battleId} 找不到首領`)
        const bossTids = bossActors.map((a) => a.configId)

        // 難度強化與異常
        const diffBuffs = this.difficultyBuffs(b, bossTids)
        const difficultyText = this.statText(diffBuffs)
        const anomalies = []
        // 「有強化」也包括改給玩家方的減益（第 21 期死境／煉獄第 3 關：初試沒有的「故障迭積」）
        const normalAttacker = new Set(normalBattle?.globalBuffs?.attacker || [])
        const playerDebuff = (b.globalBuffs?.attacker || []).some((id) => !normalAttacker.has(id))
        const cls = R.classifyBossMismatch({ code, bossIdField: lv.bossIdField, actual: bossTids, normalActual: normalBosses, enhanced: diffBuffs.length > 0 || playerDebuff })
        if (cls === 'notEnhanced') {
          const known = anomaliesCfg.levels[String(lv.levelId)]
          if (known) anomalies.push(known.note)
          else this.report.newAnomalies.push({ season: seq, code, levelId: lv.levelId, battleId: lv.battleId, bossIdField: lv.bossIdField, actual: bossTids })
          seasonAnoms.push({ levelId: lv.levelId, code, type: cls, registered: !!known })
        } else if (cls === 'displayOnly') {
          this.report.displayOnly.push({ season: seq, code, levelId: lv.levelId, bossIdField: lv.bossIdField, actual: bossTids })
        }

        // 增援時程與固定事件
        const ctx = R.createBattleContext(b, { nameOf: (k) => this.unitRaw(k)?.name || k })
        const tlx = R.deriveTimeline(b, ctx, {
          showBuff: (id) => { const x = this.buff(id); return !!(x && x.visible && x.name && !x.devnote) },
          showPassive: (k) => { const x = this.ex.skills[k]; return !!(x && x.name && x.desc) },
        })
        for (const u of tlx.unknown) this.report.unknownTriggers.set(u, (this.report.unknownTriggers.get(u) || 0) + 1)

        // 開場陣容（首領以外）
        const units = []
        for (const a of b.actors) {
          if (a.kind !== 'unit' && a.kind !== 'vehicle') continue
          if (bossActors.includes(a)) continue
          if (a.team === 7) continue
          const key = R.unitKey(a.kind, a.configId)
          const ally = a.team === 1 || a.team === 2
          const level = firstLevel(a.level)
          const hit = units.find((u) => u.unit === key && (u.level ?? null) === (level ?? null) && !!u.ally === ally)
          if (hit) hit.count++
          else units.push(stripUndefined({ unit: key, count: 1, level, ally: ally || undefined }))
          unitKeys.add(key)
        }
        for (const rf of tlx.reinforcements) for (const u of rf.units) unitKeys.add(u.unit)
        for (const a of bossActors) unitKeys.add(R.unitKey('unit', a.configId))

        // 關卡特性：玩家看得到的那段被動；沒有的話列可見的全域 Buff
        const features = []
        const gb = b.globalBuffs || {}
        if (gb.feature && this.ex.skills[gb.feature]) {
          const f = this.ex.skills[gb.feature]
          features.push(stripUndefined({ name: tr.name('skill', f.name || '', seq), desc: this.richText(f.desc, seq) }))
        }
        for (const id of [...(gb.attacker || []), ...(gb.defender || []), ...(gb.all || [])]) {
          const x = this.buff(id)
          if (!x || !x.visible || x.devnote || !x.name || R.isDifficultyBuff(x)) continue
          const name = tr.name('buff', x.name, seq)
          if (features.some((f) => f.name === name)) continue
          features.push(stripUndefined({ name, desc: this.richText(x.desc, seq) }))
        }
        const terrain = (b.terrain || []).map((id) => this.ex.terrains[String(id)]).filter((t) => t && t.show)
          .map((t) => stripUndefined({ name: tr.name('terrain', t.name || '', seq), desc: this.richText(t.desc, seq) }))

        const bounties = lv.bounties.map((o) => stripUndefined({
          name: tr.name('bounty', o.achievement?.name || '', seq),
          desc: this.richText(o.achievement?.desc, seq),
          clue: o.clue ? stripUndefined({ name: tr.name('clue', o.clue.name || '', seq), desc: this.richText(o.clue.desc, seq), details: this.richText(o.clue.details, seq) }) : undefined,
        }))

        const bossIds = [...new Set(bossActors.map((a) => `${stageId}-b${bossSlot(a.ref)}`))]
        const variant = stripUndefined({
          levelId: lv.levelId, battleId: lv.battleId,
          name: tr.name('level', lv.name || '', seq), desc: this.richText(lv.desc, seq),
          battleName: b.name ? tr.name('battle', b.name, seq) : undefined,
          winText: this.richText(b.winText, seq), loseText: this.richText(b.loseText, seq),
          turnLimit: b.turnLimit || 0,
          bossIds,
          features: features.length ? features : undefined,
          terrain: terrain.length ? terrain : undefined,
          difficultyText: difficultyText.length ? difficultyText : undefined,
          units,
          reinforcements: tlx.reinforcements,
          events: tlx.events.length ? tlx.events : undefined,
          bounties,
          clueGate: lv.clueGate,
          anomalies: anomalies.length ? anomalies : undefined,
        })
        variants[code] = variant
        texts.push(...[variant.desc, variant.winText, variant.loseText].filter(Boolean))
        for (const f of [...(variant.features || []), ...(variant.terrain || [])]) if (f.desc) texts.push(f.desc)
        for (const e of tlx.events) texts.push(e.text, ...(e.also || []))
        for (const rf of tlx.reinforcements) {
          for (const w of [rf.when, rf.warn]) if (w?.kind === 'condition') texts.push(w.text)
          texts.push(...(rf.also || []))
        }
        for (const bt of bounties) texts.push(...[bt.desc, bt.clue?.desc, bt.clue?.details].filter(Boolean))
        for (const t of texts) for (const k of R.tokenRefs(t)) if (k.startsWith('unit:')) unitKeys.add(k.slice(5))

        // 首領（每個難度一個變體；雙首領關各自一份文件）
        for (const a of bossActors) {
          const bid = `${stageId}-b${bossSlot(a.ref)}`
          const u = this.ex.units[String(a.configId)]
          if (!u) continue
          const panel = this.ex.panels?.[`${lv.battleId}:${a.configId}`] || null
          const skills = (u.skills || []).map((x) => this.skillOf(x.ref, x.slot, seq)).filter(Boolean)
          const weapons = (u.weapons || []).map((w) => stripUndefined({
            name: tr.name('weapon', w.name || '', seq),
            level: panel?.weapons?.find((p) => p.id === w.id)?.level ?? w.level,
            attack: panel?.weapons?.find((p) => p.id === w.id)?.attack,
          }))
          const notCounted = []
          if (panel) {
            // 條件式 Buff 的名字多半是內部代號（「BOSS3天賦」），改用掛它的那個技能的名字（玩家看得到的）
            for (const cb of panel.conditionalBuffs || []) {
              const owner = (u.skills || []).find((x) => (this.ex.skills[x.ref]?.buffs || []).includes(cb))
              const sk = owner && this.ex.skills[owner.ref]
              const xb = this.buff(cb)
              if (sk?.name) notCounted.push(`${KIND_LABEL[owner.slot] || '技能'}「${tr.name('skill', sk.name, seq)}」的條件效果`)
              else if (xb && xb.visible && xb.name && !xb.devnote) notCounted.push(tr.name('buff', xb.name, seq))
            }
            if ((panel.notCounted || []).includes('pilotAdapt')) notCounted.push('機師適性')
          }
          const bv = stripUndefined({
            templateId: a.configId,
            level: panel?.level ?? firstLevel(a.level) ?? u.level,
            mech: u.mech ? tr.name('mech', u.mech, seq) : undefined,
            weapons,
            parts: panel ? Object.fromEntries(Object.entries(panel.parts).map(([k, p]) => [PART_MAP[k], { durable: p.hp, armor: p.armor }])) : undefined,
            hpTotal: panel?.hpTotal,
            antiCrit: panel?.parts?.body?.antiCrit,
            dodge: panel?.parts?.leg?.dodge,
            pilotStats: panel?.pilot,
            skills,
            difficultyText: difficultyText.length ? difficultyText : undefined,
            notCounted: notCounted.length ? [...new Set(notCounted)] : undefined,
            estimated: !!panel,
            anomaly: anomalies[0],
          })
          if (!bosses.has(bid)) {
            const nm = tr.lookup('unit', u.name || '', seq)
            bosses.set(bid, { id: bid, name: nm.tw, nameCn: u.name, seasonId: sid, stageId, skills: [], variants: {}, _pending: nm.pending, _cnName: u.name })
          }
          bosses.get(bid).variants[code] = bv
        }
      }

      // 單位字典
      const unitDict = {}
      for (const key of unitKeys) {
        const raw = this.unitRaw(key)
        if (!raw) continue
        const nm = tr.lookup('unit', raw.name || '', seq)
        unitDict[key] = stripUndefined({
          name: nm.tw || '未知單位',
          kind: key.startsWith('v') ? 'vehicle' : 'unit',
          mech: raw.mech ? tr.name('mech', raw.mech, seq) : undefined,
          level: raw.level || undefined,
          weapons: raw.weapons?.length ? raw.weapons.map((w) => tr.name('weapon', w.name || '', seq)) : undefined,
          pending: nm.pending || undefined,
        })
      }
      // 不同模板、同名同等級的單位（兩種「老練傭兵」）合成一列 ×N：玩家看到的是名字，不是模板
      const mergeByName = (list) => {
        const out = []
        for (const u of list) {
          const nm = unitDict[u.unit]?.name ?? u.unit
          const hit = out.find((x) => (unitDict[x.unit]?.name ?? x.unit) === nm && (x.level ?? null) === (u.level ?? null) && !!x.ally === !!u.ally)
          if (hit) {
            hit.count += u.count
            if (u.unit !== hit.unit && !(hit.merged || []).includes(u.unit)) hit.merged = [...(hit.merged || []), u.unit]
          } else out.push({ ...u })
        }
        return out
      }
      for (const v of Object.values(variants)) {
        v.units = mergeByName(v.units)
        for (const rf of v.reinforcements) rf.units = mergeByName(rf.units)
      }
      const first = variants[codes[0]]
      const bossIds = [...new Set(codes.flatMap((c) => variants[c]?.bossIds || []))]
      stages.push(stripUndefined({
        id: stageId, name: first?.name || stageId, category: '討伐', bossIds,
        raid: { kind: 'dungeon', seasonId: sid, group: g.group, order: g.order, isFinal: g.isFinal, variants, unitDict, refDict: this.buildRefDict(texts, seq) },
      }))
    }

    // 首領文件收尾：頂層 skills／parts 取最低難度；技能引用字典；強敵圖鑑（人物層）
    const bossDocs = []
    for (const b of bosses.values()) {
      const low = DIFF_ORDER.map((c) => b.variants[c]).find(Boolean)
      b.skills = low?.skills || []
      if (low?.parts) b.parts = low.parts
      const texts = Object.values(b.variants).flatMap((v) => v.skills.map((x) => x.description))
      b.refDict = this.buildRefDict(texts, seq)
      const stage = stages.find((st) => st.id === b.stageId)
      const levelIds = Object.values(stage?.raid.variants || {}).map((v) => v.levelId)
      // 圖鑑條目一個關卡組一筆：先比名字（圖鑑常用短名：「吉諾維斯」對「吉諾維斯·盧諾」），再比模板 ID；
      // 雙首領關的另一位本來就沒有圖鑑，不算不一致
      const tids = Object.values(b.variants).map((v) => v.templateId)
      const inGroup = atlas.filter((x) => x.levelIds.some((l) => levelIds.includes(l)))
      const at = inGroup.find((x) => x.name && b._cnName && (b._cnName === x.name || b._cnName.includes(x.name)))
        || inGroup.find((x) => x.enemies.some((e) => tids.includes(e.templateId)))
        || (bossDocsInStage(bosses, b.stageId) === 1 ? inGroup[0] : null)
      if (at) {
        if (!(b._cnName || '').includes(at.name)) this.report.atlasMismatch.push({ season: seq, boss: b.id, atlas: at.id, atlasName: at.name, bossName: b._cnName })
        const normal = stage?.raid.variants.normal
        const e0 = at.enemies[0]
        if (normal && e0 && (e0.battleId !== normal.battleId || !Object.values(b.variants).some((v) => v.templateId === e0.templateId))) {
          this.report.atlasMismatch.push({ season: seq, boss: b.id, atlas: at.id, atlasName: at.name, note: `圖鑑指向戰場 ${e0.battleId}／模板 ${e0.templateId}，與關卡組初試不一致` })
        }
        b.atlasId = at.id
        b.quote = at.quote ? this.tr.text('quote', at.quote, seq) : undefined
        b.anecdoteCount = at.anecdotes.length || undefined
        for (const an of at.anecdotes) {
          anecdotes.push(stripUndefined({
            bossId: b.id, atlasId: at.id, anecdoteId: an.id, unlockLevel: an.unlockLevel,
            title: this.tr.name('anecdote', an.title || '', seq), body: this.tr.text('anecdote', an.body || '', seq),
            titleCn: an.title, bodyCn: an.body, hash: an.hash,
          }))
        }
      } else if (!inGroup.length) {
        this.report.atlasMismatch.push({ season: seq, boss: b.id, bossName: b._cnName, note: '強敵圖鑑沒有這個關卡組' })
      }
      const pending = b._pending
      delete b._pending
      delete b._cnName
      bossDocs.push(stripUndefined({ ...b, i18nPending: pending ? ['name'] : undefined }))
    }

    // 同一角色在其他期的出場（只做互連）
    const groupsOut = stages.map((st) => ({
      stageId: st.id, group: st.raid.group, name: st.name, isFinal: st.raid.isFinal,
      bosses: bossDocs.filter((b) => b.stageId === st.id).map((b) => ({ id: b.id, name: b.name })),
    }))

    // 期本身
    const nameRes = tl.name ? { tw: tl.name, pending: false } : tr.lookup('season', s.name || '', seq)
    const factionRes = faction?.name ? tr.lookup('faction', faction.name, seq) : null
    const scope = this.ex.meta.rules?.weekBuffScope || ''
    const dn = this.ex.meta.difficultyNames || {}
    const weekDiffs = DIFF_ORDER.filter((c) => dn[c] && (scope.includes(dn[c]) || scope.includes(dn[c].replace('炼', '练'))))
    const weekBuffs = s.weekBuffs.map((w) => {
      const x = this.buff(w.buffId)
      return stripUndefined({
        week: w.week, name: tr.name('buff', x?.name || '', seq), desc: x?.devnote ? undefined : this.richText(x?.desc, seq),
        effects: this.statText([w.buffId]), difficulties: weekDiffs,
      })
    })
    const season = stripUndefined({
      id: sid, seq, name: nameRes.tw, nameCn: s.name, subtitleEn: s.subtitle || undefined,
      faction: faction ? stripUndefined({ name: factionRes.tw, emblemKey: faction.emblem || undefined }) : undefined,
      difficulties: DIFF_ORDER.filter((c) => s.difficulties.includes(c)),
      difficultyNames: Object.fromEntries(DIFF_ORDER.filter((c) => dn[c]).map((c) => [c, tr.name('ui', dn[c], seq)])),
      cnOpenDate: R.parseCnOpen(s.cnOpen),
      twVersion: tl.versionId || undefined, twDate: tl.twDate || undefined, twStatus: tl.status,
      groups: groupsOut, weekBuffs,
      rules: raidRules(this.ex.meta.rules),
      published: true,
      parserVersion: this.ex.meta.parserVersion, sourceBuild: this.ex.meta.build.buildNum,
      i18nPending: [nameRes.pending && 'name', factionRes?.pending && 'faction'].filter(Boolean),
    })
    if (!season.i18nPending.length) delete season.i18nPending
    return { season, stages, bosses: bossDocs, anecdotes, anomalies: seasonAnoms }
  }
}

// ─── ④ 回歸基準 ────────────────────────────────────────────────────────────
function checkRegression(ex) {
  const out = []
  if (!ex.panels) return [{ key: '-', who: '（面板推算段不在本機，略過）', ok: null }]
  for (const [key, want] of Object.entries(regression.cases)) {
    const p = ex.panels[key]
    if (!p) { out.push({ key, who: want.who, ok: false, detail: '找不到推算結果' }); continue }
    const diffs = []
    const cmp = (label, got, exp) => { if (exp != null && Math.abs((got ?? NaN) - exp) > 1) diffs.push(`${label} ${got} ≠ ${exp}`) }
    cmp('四部位耐久', p.hpTotal, want.hpTotal)
    if (want.parts?.torso) { cmp('軀幹耐久', p.parts.body?.hp, want.parts.torso[0]); cmp('軀幹裝甲', p.parts.body?.armor, want.parts.torso[1]) }
    cmp('軀幹裝甲', p.parts.body?.armor, want.torsoArmor)
    cmp('武器攻擊', p.weapons[0]?.attack, want.attack)
    cmp('防禦', p.pilot?.defense, want.defense)
    out.push({ key, who: want.who, ok: !diffs.length, detail: diffs.join('；') })
  }
  return out
}

// ─── ⑤ 與已發布版本比對 ─────────────────────────────────────────────────────
const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== 'updatedAt' && kk !== 'published').sort(([a], [b]) => (a < b ? -1 : 1))) : v))
function diffAgainst(result, published) {
  if (!published.seasons[result.season.id]) return { status: 'new', changed: [] }
  const changed = []
  const cmp = (doc, pub) => { if (!pub || stable(doc) !== stable(pub)) changed.push(doc.id) }
  cmp(result.season, published.seasons[result.season.id])
  for (const st of result.stages) cmp(st, published.stages[st.id])
  for (const b of result.bosses) cmp(b, published.bosses[b.id])
  return { status: changed.length ? 'changed' : 'same', changed }
}

// ─── ⑥ 報告 ────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
function writeReport(rep) {
  const outBase = path.join(ROOT, '_local-notes', TODAY.slice(0, 7), `${TODAY}_武裝討伐匯入`)
  fs.mkdirSync(path.dirname(outBase), { recursive: true })
  fs.writeFileSync(`${outBase}.json`, JSON.stringify(rep, null, 1))
  const step = (ok, text, cmd) => `<li class="${ok ? 'ok' : 'todo'}">${ok ? '✅' : '⬜'} ${text}${cmd ? `<pre>${esc(cmd)}</pre>` : ''}</li>`
  const rows = rep.seasons.map((s) => `<tr><td>${s.seq}</td><td>${esc(s.name)}<div class="dim">${esc(s.nameCn)}</div></td><td>${esc(s.twStatus === 'open' ? '台版已開放' : s.twStatus === 'planned' ? `台版預計 ${s.twDate}` : s.twStatus)}</td><td>${esc(s.twVersion || '')}</td><td>${s.stages}／${s.bosses}</td><td>${s.pending}</td><td>${s.anomalies}</td><td>${esc({ new: '新期', changed: `有差異（${s.changed} 份）`, same: '與已發布相同' }[s.diff])}</td><td>${(s.bytes / 1024).toFixed(0)} KB${s.bytes > DOC_SOFT_LIMIT ? ' ⚠' : ''}</td></tr>`).join('')
  const list = (title, items) => (items.length ? `<h3>${esc(title)}（${items.length}）</h3><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '')
  const html = `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><title>武裝討伐匯入 ${TODAY}</title>
<style>body{font-family:"Segoe UI","Noto Sans TC",sans-serif;background:#0f1117;color:#e4e6ec;max-width:1100px;margin:0 auto;padding:24px;line-height:1.7}
h1{border-bottom:2px solid #a78bfa;padding-bottom:8px}h2{color:#38bdf8;margin-top:36px}h3{color:#a78bfa}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #2a2e3a;padding:5px 8px;text-align:left;vertical-align:top}th{color:#a78bfa}
.dim{color:#6b7280;font-size:12px}pre{background:#000;color:#34d399;padding:6px 10px;border-radius:6px;margin:4px 0}
li.ok{color:#aab0bd}li.todo{color:#fbbf24}.warn{color:#f87171}</style></head><body>
<h1>武裝討伐匯入報告 ${TODAY}</h1>
<p class="dim">資料包 ${esc(rep.meta.package)}（BuildNum ${esc(rep.meta.buildNum)}）・擷取規則 v${rep.meta.parserVersion}・面板推算 ${rep.meta.estimate ? `v${rep.meta.estimateVersion}` : '未啟用'}・${rep.meta.mode}</p>
<h2>下一步</h2><ol>
${step(rep.meta.extractFresh, `擷取結果是最新資料包（${esc(rep.meta.package)}）`)}
${step(rep.meta.estimate, '面板推算段在本機（scripts/lib/raid_estimate.py；不在時首領面板整組空白）', '從 E:\\Mecharashi_Data\\script-archive\\2026-10-11\\_本機獨有的保留檔備份\\scripts\\lib\\raid_estimate.py 複製回 scripts\\lib\\')}
${step(rep.regression.every((r) => r.ok !== false), `回歸基準相符（${rep.regression.filter((r) => r.ok).length}／${rep.regression.length}）`)}
${step(!rep.unknownTriggers.length, `觸發器型別全都認得${rep.unknownTriggers.length ? `：${rep.unknownTriggers.length} 種沒對到（前台會顯示「特定條件觸發」），新型別要開發者補 scripts/lib/raidTriggerTypes.json` : ''}`)}
${step(!rep.unknownProps.length, `屬性標籤都有對照${rep.unknownProps.length ? `：${rep.unknownProps.join('、')} 沒收，補 scripts/lib/raidPropertyLabels.json` : ''}`)}
${step(!rep.newAnomalies.length, `異常都已登記${rep.newAnomalies.length ? `：${rep.newAnomalies.length} 筆新的「高難度未強化」，確認後登記到 scripts/lib/raidAnomalies.json` : ''}`)}
${step(!rep.atlasMismatch.length, `強敵圖鑑與關卡組對得上${rep.atlasMismatch.length ? `：${rep.atlasMismatch.length} 筆不一致（見下方）` : ''}`)}
${step(!rep.notInTimeline.length, `時間線都有收錄${rep.notInTimeline.length ? `：${rep.notInTimeline.map((x) => `第 ${x.seq} 期 ${x.name}`).join('、')} 時間線還沒有，不產草稿（時間線補上後重跑）` : ''}`)}
${step(rep.pendingTotal === 0, `譯名待校 ${rep.pendingTotal} 筆（名詞 ${rep.pendingNames}）——到後台 /admin/raids 的譯名校對逐條確認；不校也能發布，前台會標「待校」`)}
${step(rep.meta.written || rep.seasons.every((s) => s.draftSame), rep.meta.written ? '草稿已寫入 raidDrafts' : '寫入草稿（只寫 raidDrafts，不碰前台）', rep.meta.written ? null : 'node scripts/import-raid-dungeons.mjs --write')}
${step(rep.seasons.every((s) => s.diff === 'same'), `後台審核發布：${rep.seasons.filter((s) => s.diff !== 'same').length} 期有差異或是新期——到 /admin/raids 看差異、按「發布」`)}
</ol>
<h2>各期</h2><table><tr><th>期</th><th>期名</th><th>台版</th><th>版本</th><th>關卡組／首領</th><th>待校</th><th>異常</th><th>與已發布比較</th><th>草稿大小</th></tr>${rows}</table>
${rep.skippedTimeline.length ? `<p class="dim">時間線上略過：${rep.skippedTimeline.map(esc).join('；')}</p>` : ''}
<h2>明細</h2>
${list('回歸基準', rep.regression.map((r) => `${r.ok === null ? '—' : r.ok ? '✅' : '⚠'} ${r.who}（${r.key}）${r.detail ? `：${r.detail}` : ''}`))}
${list('沒對到的觸發器型別（次數）', rep.unknownTriggers.map(([k, n]) => `${k} ×${n}`))}
${list('新的異常（未登記）', rep.newAnomalies.map((a) => `第 ${a.season} 期 ${a.code} 關 ${a.levelId}（戰場 ${a.battleId}）：BossID ${a.bossIdField}、實際 ${a.actual.join('／')}`))}
${list('BossID 只是顯示用（無害）', rep.displayOnly.map((a) => `第 ${a.season} 期 ${a.code} 關 ${a.levelId}：BossID ${a.bossIdField}、實際 ${a.actual.join('／')}`))}
${list('強敵圖鑑不一致', rep.atlasMismatch.map((a) => `第 ${a.season} 期 ${a.boss}：${a.note || `圖鑑「${a.atlasName}」≠ 首領「${a.bossName}」`}`))}
${list('沒轉換的文字標籤', rep.unknownTags)}
${list('解不出的引用', rep.missingRefs)}
${list('其他問題', rep.issues)}
${list(`待校名詞（前 300，依出現次數）`, rep.pendingTop.map((p) => `[${p.kind}] ${p.cn} → ${p.tw}（${p.count} 次，${p.source}）`))}
</body></html>`
  fs.writeFileSync(`${outBase}.html`, html)
  return outBase
}

// ─── 主程式 ────────────────────────────────────────────────────────────────
async function main() {
  const ex = loadExtract()
  const site = await loadSite()
  const raids = timelineRaids(site.patchVersions)
  const tr = new Translator(site.termDocs, site.known)
  const report = {
    unknownTags: new Set(), unknownProps: new Set(), unknownTriggers: new Map(), missingRefs: new Set(),
    newAnomalies: [], displayOnly: [], atlasMismatch: [], issues: [],
  }
  const asm = new Assembler(ex, tr, report)

  // 決策九：期名 → 時間線
  const matched = new Map()
  for (const s of ex.seasons) {
    const tw = tr.lookup('season', s.name || '', s.id).tw
    const hit = R.matchTimeline(tw, raids)
    if (hit) matched.set(s.id, hit)
  }
  const minMatched = Math.min(...matched.keys())
  const usedTimeline = new Set([...matched.values()].map((m) => `${m.versionId}:${m.name}`))
  const skippedTimeline = []
  const unmatchedTimeline = []
  for (const r of raids) {
    if (usedTimeline.has(`${r.versionId}:${r.name}`)) continue
    if (SKIP_TIMELINE[r.name]) skippedTimeline.push(`${r.versionId} ${r.name}：${SKIP_TIMELINE[r.name]}`)
    else unmatchedTimeline.push(`${r.versionId} ${r.name}`)
  }
  if (unmatchedTimeline.length) report.issues.push(`時間線上對不到任何一期的討伐：${unmatchedTimeline.join('、')}——請在對照表（season）補這一期的台版期名`)

  const results = []
  const notInTimeline = []
  for (const s of ex.seasons) {
    if (ONLY && !ONLY.has(s.id)) continue
    const m = matched.get(s.id)
    let tl
    if (m) tl = { name: m.name, versionId: m.versionId, twDate: m.twDate, status: R.twStatusOf(m.twDate, TODAY) || 'planned' }
    else if (matched.size && s.id < minMatched) tl = { status: 'open' }  // 時間線只從 v2.8 起有資料：比它早的期早已開放
    else { notInTimeline.push({ seq: s.id, name: s.name }); continue }
    results.push(asm.season(s, tl))
  }

  // C-3：站上既有譯名（時間線期名＋機轉恰好等於站上名稱的）→ 對照表已校
  const seeds = []
  for (const [seq, m] of matched) {
    const s = ex.seasons.find((x) => x.id === seq)
    seeds.push({ kind: 'season', cn: s.name, tw: m.name, source: 'timeline', firstSeason: seq })
  }
  for (const h of tr.siteHits.values()) seeds.push({ kind: h.kind, cn: h.cn, tw: h.tw, source: 'site' })
  const newSeeds = seeds.filter((x) => !site.termDocs[x.kind]?.entries?.[termHash(x.cn)])

  const pendingAll = tr.pendingList()
  const seasonsRep = results.map((r) => {
    const d = diffAgainst(r, site.published)
    const draft = { id: r.season.id, seq: r.season.seq, ...r, pending: pendingAll.filter((p) => p.seasons.includes(r.season.seq)) }
    const bytes = Buffer.byteLength(JSON.stringify(draft))
    const prev = site.drafts[r.season.id]
    return {
      seq: r.season.seq, id: r.season.id, name: r.season.name, nameCn: r.season.nameCn,
      twStatus: r.season.twStatus, twVersion: r.season.twVersion, twDate: r.season.twDate,
      stages: r.stages.length, bosses: r.bosses.length, anecdotes: r.anecdotes.length,
      pending: draft.pending.length, anomalies: r.anomalies.length, diff: d.status, changed: d.changed.length, bytes,
      draftSame: !!prev && stable({ ...prev, generatedAt: null }) === stable({ ...buildDraft(draft, ex, d), generatedAt: null }),
      _draft: buildDraft(draft, ex, d),
    }
  })

  if (flag('--dump')) {
    const dir = path.join(ROOT, '_local-notes', TODAY.slice(0, 7), `${TODAY}_武裝討伐匯入_草稿`)
    fs.mkdirSync(dir, { recursive: true })
    for (const s of seasonsRep) fs.writeFileSync(path.join(dir, `${s.id}.json`), JSON.stringify(s._draft, null, 1))
    console.log(`  草稿另存：${path.relative(ROOT, dir)}`)
  }

  let written = false
  if (WRITE) {
    const db = site.db
    for (const s of seasonsRep) {
      if (s.bytes > 1_000_000) { console.error(`✗ ${s.id} 草稿 ${s.bytes} bytes 超過 Firestore 1 MB 上限，略過`); continue }
      await db.collection('raidDrafts').doc(s.id).set(s._draft)
    }
    const byKind = {}
    for (const x of newSeeds) {
      (byKind[x.kind] ||= {})[termHash(x.cn)] = { cn: x.cn, tw: x.tw, status: 'verified', source: x.source, ...(x.firstSeason ? { firstSeason: x.firstSeason } : {}), updatedAt: new Date().toISOString() }
    }
    for (const [kind, entries] of Object.entries(byKind)) {
      await db.collection('raidTerms').doc(kind).set({ kind, entries }, { merge: true })
    }
    written = true
    console.log(`✓ 寫入 raidDrafts ${seasonsRep.length} 期；raidTerms 補 ${newSeeds.length} 筆站上既有譯名`)
  }

  const pendingNames = pendingAll.filter((p) => !['text', 'anecdote', 'quote'].includes(p.kind)).length
  const rep = {
    meta: {
      package: ex.meta.build.package, buildNum: ex.meta.build.buildNum, parserVersion: ex.meta.parserVersion,
      estimate: ex.meta.estimate, estimateVersion: ex.meta.estimateVersion,
      extractFresh: !opt('--extract') && ex.meta.build.package === latestPackage(),
      mode: FROM_BACKUP ? `離線（備份 ${path.basename(FROM_BACKUP)}）` : WRITE ? '寫入' : 'dry-run', written, today: TODAY,
    },
    seasons: seasonsRep.map(({ _draft, ...s }) => s),
    notInTimeline, skippedTimeline,
    regression: checkRegression(ex),
    unknownTriggers: [...report.unknownTriggers.entries()].sort((a, b) => b[1] - a[1]),
    unknownProps: [...report.unknownProps], unknownTags: [...report.unknownTags], missingRefs: [...report.missingRefs],
    newAnomalies: report.newAnomalies, displayOnly: report.displayOnly, atlasMismatch: report.atlasMismatch, issues: report.issues,
    pendingTotal: pendingAll.length, pendingNames,
    pendingTop: pendingAll.filter((p) => !['text', 'anecdote', 'quote'].includes(p.kind)).sort((a, b) => b.count - a.count).slice(0, 300),
    newSeeds: newSeeds.length,
  }
  const out = writeReport(rep)
  const sizes = seasonsRep.reduce((a, s) => a + s.bytes, 0)
  console.log(`武裝討伐：${seasonsRep.length} 期上草稿（台版已開放 ${seasonsRep.filter((s) => s.twStatus === 'open').length}、預計 ${seasonsRep.filter((s) => s.twStatus === 'planned').length}）；時間線未收錄 ${notInTimeline.length}`)
  console.log(`  草稿合計 ${(sizes / 1024).toFixed(0)} KB；待校 ${rep.pendingTotal}（名詞 ${pendingNames}）；未知觸發器 ${rep.unknownTriggers.length} 種；回歸 ${rep.regression.filter((r) => r.ok).length}／${rep.regression.length}`)
  console.log(`  報告：${path.relative(ROOT, out)}.html`)
  if (!WRITE) console.log('  （dry-run：沒有寫入任何東西；確認報告後加 --write）')
}

/** raidDrafts 文件：三個集合的待發布內容＋逸聞＋待校＋異常＋差異摘要（後台 /admin/raids 讀這份） */
function buildDraft(d, ex, diff) {
  return stripUndefined({
    id: d.id, seq: d.seq,
    parserVersion: ex.meta.parserVersion, estimateVersion: ex.meta.estimateVersion ?? null,
    sourceBuild: ex.meta.build.buildNum, sourcePackage: ex.meta.build.package,
    generatedAt: new Date().toISOString(),
    season: d.season, stages: d.stages, bosses: d.bosses, anecdotes: d.anecdotes,
    pending: d.pending.map((p) => ({ kind: p.kind, cn: p.cn, tw: p.tw, source: p.source, count: p.count })),
    anomalies: d.anomalies,
    diff: { status: diff.status, changed: diff.changed },
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
