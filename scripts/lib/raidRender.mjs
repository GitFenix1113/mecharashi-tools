/**
 * PLAN-064：武裝討伐「轉成人讀」的純函式（scripts/import-raid-dungeons.mjs 用；有 node:test）。
 *
 * 擷取段（scripts/extract-raid-dungeons.py）只負責把資料包的結構原樣搬出來；這裡把它們變成前台要的樣子：
 *   convertTags   遊戲標籤 <buf ID=n>[名]</buf>、<skill …>、<terrian …/>、<range>、<color> → ⟦…⟧ 引用記號（決策七）
 *   statLines     純數值修正 Buff 的屬性 → 「耐久 +29.7%」（A-5，對照表 raidPropertyLabels.json）
 *   whenOf／deriveTimeline  戰場觸發器 → 增援時程與固定事件（決策五，對照表 raidTriggerTypes.json）
 *   twStatusOf／matchTimeline  台版是否已開放（決策九）
 *   classifyBossMismatch     BossID 與實際首領不同時的分類（A-6）
 *
 * 文字模板都是站上自己的台版用字；遊戲原文（單位名、Buff 名…）一律以 ⟦…⟧ 記號表示，翻譯在 raidI18n.mjs。
 */

import triggerTypes from './raidTriggerTypes.json' with { type: 'json' }
import propLabels from './raidPropertyLabels.json' with { type: 'json' }

// ─── 首領判定 ────────────────────────────────────────────────────────────────

/** 首領＝ref 為 BOSS／BOSS1／#BOSS2…（雙首領關用編號）。與擷取段 BOSS_REF_RE 同一條規則。 */
export const BOSS_REF_RE = /^#?BOSS\d*$/
export const isBossRef = (ref) => BOSS_REF_RE.test(ref || '')

/** 單位字典的鍵：戰術單位用模板 ID，載具加 v 前綴（兩張表的 ID 會撞號）。 */
export const unitKey = (kind, configId) => (kind === 'vehicle' ? `v${configId}` : String(configId))

// ─── 遊戲標籤 → ⟦…⟧ ──────────────────────────────────────────────────────────

const SKILL_TAG = { mainSkill: 'main', passiveSkill: 'passive', activeSkill: 'active' }

/**
 * 遊戲說明文字的標籤轉成引用記號；回傳 { text, unknownTags }。
 *   <buf ID=98305013>[加能防固]</buf> → ⟦buf:98305013|加能防固⟧（沒附名稱 → ⟦buf:98305013⟧，名稱由字典補）
 *   <skill mainSkill=8820522></skill> → ⟦main:8820522⟧；<terrian ID=88329010 /> → ⟦terrain:88329010⟧
 *   <range type=1>面前2×5格</range> → 面前2×5格；<color=#F74848>2</color> → ⟦em:2⟧
 */
export function convertTags(raw) {
  if (raw == null) return { text: raw, unknownTags: [] }
  let s = String(raw)
  // 標籤可能帶屬性：<buf ID=900022 click=false>[援護防禦]</buf>（遊戲內不可點，站上照樣當引用）
  s = s.replace(/<buf ID=(\d+)[^>]*>(.*?)<\/buf>/g, (_, id, inner) => {
    const label = inner.replace(/^\[|\]$/g, '').trim()
    return label ? `⟦buf:${id}|${label}⟧` : `⟦buf:${id}⟧`
  })
  s = s.replace(/<skill (mainSkill|passiveSkill|activeSkill)=(\d+)[^>]*>(.*?)<\/skill>/g, (_, kind, id, inner) => {
    const label = inner.replace(/^\[|\]$/g, '').trim()
    return label ? `⟦${SKILL_TAG[kind]}:${id}|${label}⟧` : `⟦${SKILL_TAG[kind]}:${id}⟧`
  })
  s = s.replace(/<terrian ID=(\d+)\s*\/>/g, (_, id) => `⟦terrain:${id}⟧`)
  s = s.replace(/<range[^>]*>(.*?)<\/range>/g, '$1')
  s = s.replace(/<color=[^>]*>(.*?)<\/color>/g, (_, inner) => (inner && !/[⟦<]/.test(inner) ? `⟦em:${inner}⟧` : inner))
  const unknownTags = []
  s = s.replace(/<\/?([a-zA-Z]+)[^>]*>/g, (_, tag) => {
    unknownTags.push(tag)
    return ''
  })
  return { text: s, unknownTags }
}

/** 文字裡的 ⟦kind:id⟧ 引用鍵（不含 em），例 ['buf:98321014', 'unit:853502']。 */
export function tokenRefs(text) {
  const out = new Set()
  for (const m of String(text || '').matchAll(/⟦(buf|main|passive|active|terrain|unit):([^|⟧]+)(?:\|[^⟧]*)?⟧/g)) {
    out.add(`${m[1]}:${m[2]}`)
  }
  return [...out]
}

// ─── 屬性 → 人讀文字 ─────────────────────────────────────────────────────────

const EPS = 1e-6

function fmtValue(v, unit) {
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±'
  const abs = Math.abs(v)
  if (unit === '%') {
    const pct = Math.round(abs * 1000) / 10
    return `${sign}${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`
  }
  const n = Math.round(abs * 100) / 100
  return `${sign}${n}`
}

/**
 * 屬性列（[{ key, value }]，key＝PropertiesId 去前綴）→ { lines, unknown }。
 * 同一組（四部位耐久…）全到齊且數值相同時合併成一行；其餘逐行；對照表沒收的屬性進 unknown（報告列 ⬜）。
 */
export function statLines(props, labels = propLabels) {
  const total = new Map()
  for (const p of props || []) {
    if (!p || !p.key || !p.value) continue
    total.set(p.key, (total.get(p.key) || 0) + p.value)
  }
  for (const [k, v] of total) if (Math.abs(v) < EPS) total.delete(k)
  const lines = []
  const unknown = []
  for (const g of labels.groups) {
    if (!g.props.every((k) => total.has(k))) continue
    const v0 = total.get(g.props[0])
    if (!g.props.every((k) => Math.abs(total.get(k) - v0) < EPS)) continue
    lines.push(`${g.label} ${fmtValue(v0, '%')}`)
    for (const k of g.props) total.delete(k)
  }
  for (const [k, v] of total) {
    const wt = /^(.+)Attack(Add|Multi)$/.exec(k)
    if (wt && labels.weaponTypes[wt[1]]) {
      lines.push(`${labels.weaponTypes[wt[1]]}攻擊 ${fmtValue(v, wt[2] === 'Multi' ? '%' : '')}`)
      continue
    }
    const lab = labels.props[k]
    if (!lab) {
      unknown.push(k)
      continue
    }
    lines.push(`${lab.label} ${fmtValue(v, lab.unit)}`)
  }
  return { lines, unknown }
}

/** 難度強化 Buff：不給玩家看、名稱帶 Raid（Raid强化新3（S++）、回血版Raid强化…、Raid-OB8-死境…）。 */
export const isDifficultyBuff = (b) => !!b && !b.visible && /raid/i.test(b.name || '')

// ─── 觸發器 → 時點 ───────────────────────────────────────────────────────────

const START_EVENTS = new Set(Object.keys(triggerTypes.events).filter((k) => triggerTypes.events[k].start))

/**
 * 一個戰場的參照索引：ref（開場單位的 m_refName、召喚時指定的名字）→ 單位。
 * 觸發器用 ref 指單位，有時是前綴（'Enemy' 指 Enemy1、Enemy2…；'add2' 指 add2-1、add2-2）。
 */
export function createBattleContext(battle, opts = {}) {
  const refs = new Map()
  const add = (ref, kind, configId) => {
    if (!ref || !kind || (kind !== 'unit' && kind !== 'vehicle')) return
    const list = refs.get(ref) || []
    if (!list.some((x) => x.kind === kind && x.configId === configId)) list.push({ kind, configId })
    refs.set(ref, list)
  }
  for (const a of battle.actors || []) add(a.ref, a.kind, a.configId)
  const setters = new Map()
  const initVals = new Map()
  for (const t of battle.triggers || []) {
    for (const a of t.actions) {
      if (a.t === 'summon') add(a.as, a.kind, a.configId)
      if (a.t === 'setVar') {
        if (START_EVENTS.has(t.event) && !t.conds.length) {
          initVals.set(a.key, a.value)
        } else {
          const list = setters.get(a.key) || []
          list.push({ value: a.value, trigger: t })
          setters.set(a.key, list)
        }
      }
    }
  }
  const resolveRef = (s) => {
    if (!s) return []
    if (refs.has(s)) return refs.get(s)
    const out = []
    for (const [ref, list] of refs) {
      if (ref.startsWith(s)) for (const x of list) if (!out.some((y) => y.kind === x.kind && y.configId === x.configId)) out.push(x)
    }
    return out
  }
  // 同名的不同模板（兩隻「老練傭兵」、開場與重新部署的「自律戴亞斯」）只列一次；nameOf 由呼叫端給（單位字典的原名）
  const nameOf = opts.nameOf || ((key) => key)
  const refText = (s) => {
    const list = resolveRef(s)
    if (!list.length) return '特定單位'
    const seen = new Set()
    const toks = []
    for (const x of list) {
      const key = unitKey(x.kind, x.configId)
      const nm = nameOf(key)
      if (seen.has(nm)) continue
      seen.add(nm)
      toks.push(`⟦unit:${key}⟧`)
    }
    return toks.slice(0, 3).join('、') + (toks.length > 3 ? '等' : '')
  }
  return { battle, refs, resolveRef, refText, nameOf, setters, initVals, triggerTypes: opts.triggerTypes || triggerTypes }
}

/** 把文字裡的 ⟦unit:…⟧ 換成原名：只用來判斷「兩句是不是同一句」（去重），不輸出。 */
const nameSig = (ctx, text) => String(text).replace(/⟦unit:([^⟧]+)⟧/g, (_, k) => `⟦${ctx.nameOf(k)}⟧`)

function fillTemplate(tpl, c, ctx) {
  const tt = ctx.triggerTypes
  return tpl.replace(/\{([a-z]+)(?::([a-z0-9]+))?\}/g, (_, name, arg) => {
    switch (name) {
      case 's': return ctx.refText(c.s)
      case 's2': return ctx.refText(c.s2)
      case 'p1': case 'p2': case 'p3': case 'p4': return String(c[name] ?? 0)
      case 'part': return tt.parts[String(c[arg] ?? 0)] || '部位'
      case 'pct': { const v = (c[arg] ?? 0) / 100; return `${Number.isInteger(v) ? v : v.toFixed(1)}%` }
      case 'buf': return `⟦buf:${c[arg]}⟧`
      case 'active': return `⟦active:${c[arg]}⟧`
      case 'terrain': return `⟦terrain:${c[arg]}⟧`
      case 'team': return tt.teams[String(c[arg] ?? 0)] || ''
      default: return ''
    }
  })
}

/** RaidWhen → 一句話（黑板變數反推、報告用）。unknown 回 null。 */
export function whenText(w) {
  if (!w) return null
  switch (w.kind) {
    case 'start': return '開戰時'
    case 'turn': return `第 ${w.turns.join('、')} 回合${w.timing === 'end' ? '結束' : '開始'}`
    case 'everyTurn': return `${w.from ? `第 ${w.from} 回合起` : ''}每回合${w.timing === 'end' ? '結束' : '開始'}`
    case 'condition': return w.text
    default: return null
  }
}

const stripTail = (s) => String(s || '').replace(/時$/, '')

function blackboardText(c, trigger, ctx, depth) {
  const key = c.s || ''
  const v = c.p1 ?? 0
  const init = ctx.initVals.has(key) ? ctx.initVals.get(key) : 0
  const setters = (ctx.setters.get(key) || []).filter((x) => x.trigger !== trigger)
  if (depth > 1 || !setters.length) return null
  const describe = (list) => {
    const texts = [...new Set(list.map((x) => whenText(whenOf(x.trigger, ctx, depth + 1).when)))]
    return texts.length === 1 && texts[0] ? stripTail(texts[0]) : null
  }
  if (v === init) {
    const others = setters.filter((x) => x.value !== init)
    if (!others.length) return null
    const t = describe(others)
    return t ? `${t}之前` : null
  }
  const same = setters.filter((x) => x.value === v)
  if (!same.length) return null
  const t = describe(same)
  return t ? `${t}之後` : null
}

/**
 * 觸發器 → { when: RaidWhen, also: string[], unknown: string[] }。
 * unknown 有值時 when 一律是 { kind: 'unknown' }（前台「特定條件觸發」），不猜。
 */
export function whenOf(trigger, ctx, depth = 0) {
  const tt = ctx.triggerTypes
  const ev = tt.events[trigger.event]
  const unknown = []
  if (!ev) unknown.push(`event:${trigger.event}`)
  const turns = []
  let turnAfter = null
  const moments = []
  const also = []
  for (const c of trigger.conds || []) {
    const def = tt.conditions[c.t]
    if (!def) { unknown.push(`cond:${c.t}`); continue }
    switch (def.role) {
      case 'turn': turns.push(c.p1 ?? 0); break
      case 'turnAfter': turnAfter = (c.p1 ?? 0) + 1; break
      case 'neutral': case 'orBegin': case 'orEnd': break
      case 'blackboard': {
        const t = blackboardText(c, trigger, ctx, depth)
        if (t) also.push(t)
        else unknown.push(`blackboard:${c.s || ''}`)
        break
      }
      case 'moment': {
        const tpl = c.not && def.notText ? def.notText : def.text
        moments.push(fillTemplate(tpl, c, ctx))
        break
      }
      case 'also': {
        const tpl = c.not && def.notText ? def.notText : def.text
        also.push(fillTemplate(tpl, c, ctx))
        break
      }
      default: unknown.push(`cond:${c.t}`)
    }
  }
  if (unknown.length) return { when: { kind: 'unknown' }, also, unknown }

  if (ev.start && !turns.length && !moments.length && turnAfter == null) {
    return { when: { kind: 'start' }, also, unknown }
  }
  if (ev.timing) {
    if (moments.length) return { when: { kind: 'condition', text: `${moments.join('且')}（回合${ev.timing === 'end' ? '結束' : '開始'}時判定）` }, also, unknown }
    if (turns.length) return { when: { kind: 'turn', turns: [...new Set(turns)].sort((a, b) => a - b), timing: ev.timing }, also, unknown }
    if (turnAfter != null) return { when: { kind: 'everyTurn', timing: ev.timing, from: turnAfter }, also, unknown }
    if (trigger.repeat) return { when: { kind: 'everyTurn', timing: ev.timing }, also, unknown }
    if (!also.length) return { when: { kind: 'turn', turns: [1], timing: ev.timing }, also, unknown }
    return { when: { kind: 'condition', text: `${also.join('且')}時（回合${ev.timing === 'end' ? '結束' : '開始'}判定，僅一次）` }, also: [], unknown }
  }
  // 非回合型事件：被擊破時、行動結束時…（事件本身沒有文字時靠 moment 條件描述；
  // 只有附帶條件時，＝「每次行動結束後檢查到條件成立時」，把附帶條件當時點）
  let text = moments.length ? moments.join('且') : ev.text
  if (!text && also.length) {
    text = `${also.join('且')}時`
    also.length = 0
  }
  if (!text) return { when: { kind: 'unknown' }, also, unknown: [`moment:${trigger.event}`] }
  const turnNote = turns.length ? `（第 ${[...new Set(turns)].join('、')} 回合）` : ''
  return { when: { kind: 'condition', text: `${text}${turnNote}` }, also, unknown }
}

// ─── 增援時程與固定事件 ─────────────────────────────────────────────────────

const WHEN_ORDER = { start: 0, turn: 1, everyTurn: 2, condition: 3, unknown: 4 }

function whenSortKey(w) {
  return [WHEN_ORDER[w.kind] ?? 9, w.kind === 'turn' ? w.turns[0] : w.from ?? 0, w.timing === 'end' ? 1 : 0]
}

function cmpKeys(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

const firstLevel = (lv) => {
  const n = parseInt(String(lv || '').split('/')[0], 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * 戰場觸發器 → { reinforcements, events, unknown }。
 *   召喚動作 → 增援（同時點、同條件合併；同模板合成 ×N）；召喚點若被別的觸發器先「開啟」→ warn（增援預警）。
 *   掛 Buff／被動在敵方身上的動作 → 固定事件（只收玩家看得到的：opts.showBuff／opts.showPassive 決定）。
 *   unknown：對不到的條件／事件型別（報告列 ⬜）。
 */
export function deriveTimeline(battle, ctx, opts = {}) {
  const showBuff = opts.showBuff || (() => false)
  const showPassive = opts.showPassive || (() => false)
  const isEnemyTarget = (tgt) => {
    if (!tgt) return false
    if (tgt.team != null) return tgt.team === 4 || tgt.team === 3
    const ref = tgt.ref || tgt.teamOf || ''
    const list = ctx.resolveRef(ref)
    return list.length > 0 || isBossRef(ref)
  }
  // 召喚點標記：名字 → 開啟它的觸發器
  const openers = new Map()
  for (const t of battle.triggers || []) {
    for (const a of t.actions) {
      if (a.t === 'marker' && a.open && a.name) {
        const list = openers.get(a.name) || []
        list.push(t)
        openers.set(a.name, list)
      }
    }
  }
  const unknown = []
  const rfMap = new Map()
  const events = []
  for (const t of battle.triggers || []) {
    const summons = t.actions.filter((a) => a.t === 'summon' && (a.kind === 'unit' || a.kind === 'vehicle'))
    const buffActs = t.actions.filter((a) => (a.t === 'addBuff' || a.t === 'removeBuff') && showBuff(a.buffId) && isEnemyTarget(a.target))
    const passiveActs = t.actions.filter((a) => a.t === 'addPassive' && a.skill && showPassive(a.skill) && isEnemyTarget(a.target))
    if (!summons.length && !buffActs.length && !passiveActs.length) continue
    const { when, also, unknown: unk } = whenOf(t, ctx)
    unknown.push(...unk.map((u) => (summons.length ? u : `event-only ${u}`)))
    if (summons.length) {
      // 預警：召喚點在別的觸發器裡先被開啟
      let warn
      for (const a of summons) {
        const op = (openers.get(a.at) || []).find((o) => o !== t)
        if (op) {
          const w = whenOf(op, ctx).when
          if (w.kind !== 'unknown') { warn = w; break }
        }
      }
      const sig = JSON.stringify([when, also, warn || null])
      const rf = rfMap.get(sig) || { when, ...(also.length ? { also } : {}), ...(warn ? { warn } : {}), units: [] }
      for (const a of summons) {
        const key = unitKey(a.kind, a.configId)
        const ally = a.team === 1 || a.team === 2
        const level = firstLevel(a.level)
        const hit = rf.units.find((u) => u.unit === key && (u.level ?? null) === (level ?? null) && !!u.ally === ally)
        if (hit) hit.count++
        else rf.units.push({ unit: key, count: 1, ...(level ? { level } : {}), ...(ally ? { ally: true } : {}) })
      }
      rfMap.set(sig, rf)
    }
    // 時點推不出來的事件不列（事件是次要資訊，列「特定條件」只會變成雜訊）；增援則照列並標「特定條件觸發」
    if (when.kind === 'unknown') continue
    for (const a of buffActs) {
      const verb = a.t === 'addBuff' ? '獲得' : '失去'
      const who = a.target.team != null ? '敵方全體' : ctx.refText(a.target.ref || a.target.teamOf)
      events.push({ when, ...(also.length ? { also } : {}), text: `${who}${verb}⟦buf:${a.buffId}⟧` })
    }
    for (const a of passiveActs) {
      const id = String(a.skill).split(':')[1]
      events.push({ when, ...(also.length ? { also } : {}), text: `${ctx.refText(a.target.ref)}獲得⟦passive:${id}⟧` })
    }
  }
  const byWhen = (a, b) => cmpKeys(whenSortKey(a.when), whenSortKey(b.when))
  const reinforcements = [...rfMap.values()].sort(byWhen)
  // 同一句事件只留一次（四個召喚點各掛一次同一個 Buff 這類）
  const seen = new Set()
  const uniqEvents = events.filter((e) => {
    const k = nameSig(ctx, JSON.stringify([e.when, e.also || null, e.text]))
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).sort(byWhen)
  return { reinforcements, events: uniqEvents, unknown: [...new Set(unknown)] }
}

// ─── 台版開放狀態（決策九）─────────────────────────────────────────────────

/** 陸版開放時間「2024/7/8  5:00:00」→「2024-07-08」 */
export function parseCnOpen(text) {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(String(text || '').trim())
  if (!m) return undefined
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

/** 時間線 twDate（YYYY/MM/DD）與今天比：已過或當天 → open，未到 → planned。 */
export function twStatusOf(twDate, today) {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(String(twDate || '').trim())
  if (!m) return undefined
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return d <= today ? 'open' : 'planned'
}

/**
 * 時間線 armamentRaids（[{ name, versionId, twDate }]）對上一期：以台版期名比對（twName 已轉繁）。
 * 回 { entry } 或 null。「重裝征伐」這類不是 RaidDungeon 的條目由呼叫端另外略過。
 */
export function matchTimeline(twName, raids) {
  const norm = (s) => String(s || '').replace(/\s+/g, '')
  return raids.find((r) => norm(r.name) === norm(twName)) || null
}

// ─── 異常偵測（A-6）─────────────────────────────────────────────────────────

/**
 * BossID（關卡表）與戰場實際首領不同時分類：
 *   'displayOnly'  BossID 指向別的難度的同名首領（顯示用，無害）
 *   'notEnhanced'  高難度實際用了初試的首領模板，且沒有任何難度強化來源（疑似陸版設定錯誤：110202、113203）
 *   null           一致，或高難度共用模板但有強化來源（第 20–21 期的正常做法）
 * @param {{code: string, bossIdField: number, actual: number[], normalActual: number[], enhanced: boolean}} v
 */
export function classifyBossMismatch(v) {
  const sameAsNormal = v.code !== 'normal' && v.actual.length > 0 && v.actual.every((t) => v.normalActual.includes(t))
  if (sameAsNormal && !v.enhanced) return 'notEnhanced'
  if (v.bossIdField && !v.actual.includes(v.bossIdField)) return 'displayOnly'
  return null
}
