/**
 * PLAN-064 Phase C：武裝討伐的譯名（簡中 → 台版）。
 *
 * 查表順序（決策八）：
 *   ① 譯名對照表 raidTerms 裡的條目（站長在 /admin/raids 校對過的＝已校；infodata／截圖匯入的＝待校但優先於機轉）
 *   ② 站上既有的台版名稱（期名取時間線、與玩家機體同名的敵方機體…；機轉結果恰好等於站上名稱時視為已校）
 *   ③ 簡→繁機械轉換（opencc-js cn→tw，再套 textFixes 的過度轉換修正），標「待校」
 * 長文（技能說明、線索詳情…）沒有整段條目時：先保護 ⟦…⟧ 引用記號（記號裡的名稱另外查表），
 * 再把文中出現的「對照表名詞」換成台版譯名，最後機轉——避免把人名轉成錯字（科斯蒂利亞 vs 科斯蒂莉亞）。
 *
 * raidTerms 只存「人工校對過或來源匯入」的條目；機轉結果不落地（每次重算），所以重新匯入不會洗掉校對。
 * 文件：raidTerms/{kind} → { kind, entries: { [termHash(cn)]: { cn, tw, status, source, firstSeason?, updatedAt? } } }
 * 鍵用雜湊而不是原文：原文可能含 . / 等字元，放進 Firestore 欄位路徑會出事。
 */

import crypto from 'crypto'
import * as OpenCC from 'opencc-js'
import { fixOverConversion } from './textFixes.mjs'

/** 對照表的種類＝raidTerms 的文件 ID（逸聞正文量大，自成一片） */
export const TERM_KINDS = [
  'season', 'faction', 'level', 'battle', 'unit', 'mech', 'weapon', 'backpack',
  'skill', 'buff', 'terrain', 'bounty', 'clue', 'quote', 'ui', 'text', 'anecdote',
]
/** 會出現在長文裡、值得先替換的名詞種類（長文本身、介面字串不算） */
const NAME_KINDS = new Set(['season', 'faction', 'level', 'battle', 'unit', 'mech', 'weapon', 'backpack', 'skill', 'buff', 'terrain'])

export const termHash = (cn) => crypto.createHash('sha1').update(String(cn), 'utf8').digest('hex').slice(0, 16)

const _s2t = OpenCC.Converter({ from: 'cn', to: 'tw' })
/** 簡→繁機械轉換（＋已知過度轉換修正） */
export const machine = (cn) => (cn ? fixOverConversion(_s2t(String(cn))) : cn)

export class Translator {
  /**
   * @param {Record<string, {entries?: Record<string, {cn: string, tw: string, status: string, source?: string}>}>} termDocs raidTerms 各文件
   * @param {Record<string, Set<string>>} [knownTw] 站上既有的台版名稱（依種類）：機轉結果在裡面＝已校、來源 site
   */
  constructor(termDocs = {}, knownTw = {}) {
    this.entries = new Map()
    for (const [kind, doc] of Object.entries(termDocs)) {
      for (const e of Object.values(doc?.entries || {})) {
        if (e && e.cn && e.tw) this.entries.set(`${kind}\u0000${e.cn}`, { kind, ...e })
      }
    }
    this.knownTw = knownTw
    this.pending = new Map()
    this.siteHits = new Map()
    // 長文替換用：對照表裡「機轉會轉錯」的名詞，長的先換
    this.nameSubs = [...this.entries.values()]
      .filter((e) => NAME_KINDS.has(e.kind) && e.cn.length >= 2 && e.tw !== machine(e.cn))
      .sort((a, b) => b.cn.length - a.cn.length)
  }

  _pend(kind, cn, tw, source, season) {
    const k = `${kind}\u0000${cn}`
    const p = this.pending.get(k) || { kind, cn, tw, source, count: 0, seasons: new Set() }
    p.count++
    if (season != null) p.seasons.add(season)
    this.pending.set(k, p)
  }

  /** 名詞（單位名、技能名…）。回 { tw, pending }。 */
  lookup(kind, cn, season) {
    if (cn == null || cn === '') return { tw: cn, pending: false }
    const e = this.entries.get(`${kind}\u0000${cn}`)
    if (e) {
      const pending = e.status !== 'verified'
      if (pending) this._pend(kind, cn, e.tw, e.source || 'table', season)
      return { tw: e.tw, pending }
    }
    const tw = machine(cn)
    if (this.knownTw[kind]?.has(tw)) {
      this.siteHits.set(`${kind}\u0000${cn}`, { kind, cn, tw })
      return { tw, pending: false }
    }
    this._pend(kind, cn, tw, 'machine', season)
    return { tw, pending: true }
  }

  name(kind, cn, season) {
    return this.lookup(kind, cn, season).tw
  }

  /** ⟦buf:1|标签⟧ 這類記號裡的名稱也要翻；其他部分原樣 */
  _token(tok, season) {
    return tok.replace(/^⟦(buf|main|passive|active|terrain):([^|⟧]+)\|([^⟧]*)⟧$/, (_, kind, id, label) => {
      const k = kind === 'buf' ? 'buff' : kind === 'terrain' ? 'terrain' : 'skill'
      return `⟦${kind}:${id}|${this.name(k, label, season)}⟧`
    }).replace(/^⟦em:([^⟧]*)⟧$/, (_, inner) => `⟦em:${machine(inner)}⟧`)
  }

  /** 長文。有整段條目就用條目；否則保護記號 → 替換名詞 → 機轉，標待校。 */
  text(kind, cn, season) {
    if (cn == null || cn === '') return cn
    const e = this.entries.get(`${kind}\u0000${cn}`)
    if (e) {
      if (e.status !== 'verified') this._pend(kind, cn, e.tw, e.source || 'table', season)
      return e.tw
    }
    const slots = []
    const hold = (v) => `\u0001${slots.push(v) - 1}\u0001`
    let s = String(cn).replace(/⟦[^⟧]*⟧/g, (tok) => hold(this._token(tok, season)))
    for (const sub of this.nameSubs) {
      if (s.includes(sub.cn)) s = s.split(sub.cn).join(hold(sub.tw))
    }
    s = machine(s).replace(/\u0001(\d+)\u0001/g, (_, i) => slots[Number(i)])
    this._pend(kind, cn, s, 'machine', season)
    return s
  }

  /** 待校清單（報告與草稿用）：[{ kind, cn, tw, source, count, seasons: number[] }] */
  pendingList() {
    return [...this.pending.values()].map((p) => ({ ...p, seasons: [...p.seasons].sort((a, b) => a - b) }))
  }
}
