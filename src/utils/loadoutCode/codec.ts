// 分享碼 codec v1 —— PLAN-052-C Phase B / B-1
//
// ── 這一層在做什麼 ──────────────────────────────────────────────────────────
// 總綱決策二讓分享碼**同時是唯一的落盤格式**，所以這不只是分享功能：
// encode 錯了＝玩家存的配裝壞掉；decode throw 了＝整頁白畫面。
// 「數字是誰」由 `shareId.ts` 回答，本檔只負責把數字塞進 bytes 再拿出來。
//
// ── 版面（v1）──────────────────────────────────────────────────────────────
//   header（**跨版本永久凍結**，未來的 Worker OG 只解這一段）
//     FMT      1B      格式版本 = 1（⚠ 與文件 schema 版本分開，不共用常數）
//     GAMEVER  1B      遊戲版本提示，**不參與解析**（見 `packGameVersion`）
//     PILOT    varint   0 ＝ 未選
//     MECH     varint   0 ＝ 未選
//   body（一連串 section，每段 `tag 1B + len varint + payload`）
//     未知 tag 一律**跳過並記入 unmodeled** —— 這是 TLV 的全部意義：
//     舊 client 讀得懂新 client 的碼（只是少幾段），不必為了加一段而升版本洗掉舊碼。
//   tail
//     CHK      1B      FNV-1a 低 8 位，專治 Discord 在 ~70 字元處插入的換行
//
// ── 為什麼 §PARTS／§MODULES／元件段在 v1 就開 ─────────────────────────────
// 總綱「MVP 三件絕對不能省的事」第②條。它們今天沒有 UI（052-D／052-G），
// 但版面一旦上線就有人存了碼，事後補段等於升版本並遷移全部既有資料。
//
// ── 與計畫書規格的兩處出入（2026-08-26，實作時定案）─────────────────────
// ① 決策二寫 `FORM 1B`，但**沒有可用的 1 byte 形態身分**：決策八禁止用
//    `form.order`（`FormAdmin.tsx` 是自由輸入欄位，後台重排就讓舊碼指向另一個形態），
//    而形態 doc id 是 `form_海莉絲_先鋒` 這種純名稱、沒有數字可推。
//    ⇒ 改成**長度前綴的 UTF-8 內嵌**。典型配裝只有一個 `default` 鍵（+8 bytes），
//      海莉絲三套最壞 +64 bytes，對 Discord 的 2000 字元上限仍有大量餘裕。
//      換來零解析器耦合、精確 round-trip，且形態被改名時說得出「原本是哪個鍵」。
// ② 決策二寫 mount 的 `NCOMP ＋ COMP[]`，但 `MountSetup` 是**觸／應兩條清單**。
//    ⇒ 改成 `NTRIG 1B ＋ NEFF 1B ＋ ids`。合成一條就得再找一個位元存「這顆是觸還是應」，
//      而 varint 裡沒有空位元可借。
//
// 純函式、無 React／Firestore 依賴，可單測（npm test）。

import type { LoadoutDraft, EquipSet, LoadoutMount } from '../../types/loadout'
import type { SlotBank, SlotSide } from '../../types/slots'
import type { MechPartPosition, WeaponEquipSlot } from '../../types/enums'
import { slotKey } from '../../types/slots.ts'
import type { ShareIdKind, ShareIndex } from './shareId.ts'

// ─── 常數 ────────────────────────────────────────────────────────────────────

/** 本檔產出的格式版本。**與文件 schema 版本刻意不共用常數**（總綱決策八）。 */
export const FMT_VERSION = 1

/**
 * 段落 tag。**號碼一旦發出就永久保留**，即使該段之後不再產生 ——
 * 舊碼裡還有它，而解碼器永不刪除（決策六③）。
 */
export const TAG = {
  SETS: 1,
  PARTS: 2,
  MODULES: 3,
  /** 算力（PLAN-052-I D-2）。v1 就開，否則之後補要升版本並遷移既有碼。 */
  ND: 4,
  /** 方案名稱（PLAN-052-I E-1）。 */
  NAME: 5,
} as const

/** 槽位 → 3 bits。**保留 8 個位置**，遊戲加第五種槽位時是加值而非升版本。 */
const SLOT_CODE: Record<string, number> = { singleHand: 0, dualHand: 1, shoulder: 2, back: 3 }
const SLOT_OF: Record<number, WeaponEquipSlot> = { 0: 'singleHand', 1: 'dualHand', 2: 'shoulder', 3: 'back' }
const SIDE_CODE: Record<string, number> = { none: 0, left: 1, right: 2 }
const SIDE_OF: Record<number, SlotSide | undefined> = { 0: undefined, 1: 'left', 2: 'right' }
const BANK_OF: Record<number, SlotBank> = { 0: 'main', 1: 'backup' }

const PART_CODE: Record<string, number> = { torso: 0, leftArm: 1, rightArm: 2, legs: 3 }
const PART_OF: Record<number, MechPartPosition> = { 0: 'torso', 1: 'leftArm', 2: 'rightArm', 3: 'legs' }

/**
 * 結構防護的上限（決策四②）。
 *
 * 這些數字不是「合理值」而是**炸彈引信**：少了它們，一段 3 bytes 的代碼可以宣告
 * 「接下來有十萬個 mount」，解碼器就會忠實地配置十萬個物件。上限一律取
 * 「今天的最大值 × 2 以上」，寬到不會誤殺、窄到炸不掉瀏覽器。
 */
export const LIMITS = {
  /** base64url 字元數。實測最壞估計 ≈991 字元（743 bytes），取 4 倍餘裕 */
  codeChars: 4096,
  bytes: 3072,
  /** 今天最多 3 套（海莉絲） */
  sets: 8,
  /** 今天最多 7 格（雙手 2 ＋ 雙肩 2 ＋ 背 1 ＋ 備用 2） */
  mountsPerSet: 16,
  /** `componentLimit` 上限是 4（SS／S+） */
  componentsPerKind: 8,
  parts: 4,
  modules: 8,
  /** 分區數逐機師不同，今天最多 4 */
  ndZones: 16,
  /** 形態鍵／分區名的 UTF-8 位元組數 */
  keyBytes: 64,
  /** 方案名稱：`LOADOUT_NAME_MAX` 是 24 碼點，最壞 4 bytes/碼點 */
  nameBytes: 128,
} as const

// ─── 位元組讀寫 ──────────────────────────────────────────────────────────────

class Writer {
  private buf: number[] = []
  byte(n: number) { this.buf.push(n & 0xff) }
  bytes(a: Uint8Array) { for (const b of a) this.buf.push(b) }
  /**
   * LEB128 varint。**超過 3 bytes 直接 throw** —— 那代表 shareId 超出
   * `SHARE_ID_MAX`，是呼叫端的 bug；靜默截斷會產生一串解得開卻指向錯誤實體的碼。
   */
  varint(n: number) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`[codec] varint 只吃非負整數，收到 ${n}`)
    let v = n, written = 0
    do {
      let b = v & 0x7f
      v >>>= 7
      if (v > 0) b |= 0x80
      this.buf.push(b)
      written++
      if (written > 3) throw new Error(`[codec] varint 超過 3 bytes（${n}）—— shareId 應受 SHARE_ID_MAX 限制`)
    } while (v > 0)
  }
  /** 長度前綴的 UTF-8 字串。長度本身是 varint。 */
  str(s: string, maxBytes: number) {
    const b = new TextEncoder().encode(s)
    if (b.length > maxBytes) throw new Error(`[codec] 字串過長（${b.length} > ${maxBytes} bytes）：${s.slice(0, 20)}…`)
    this.varint(b.length)
    this.bytes(b)
  }
  get length() { return this.buf.length }
  toBytes(): Uint8Array { return Uint8Array.from(this.buf) }
}

/**
 * 讀取器。**任何越界一律回 `null`／丟 `RangeError` 給呼叫端的 try 接住**，
 * 對外永不逃逸例外 —— `decodeLoadout()` 是唯一的公開入口，它把一切包起來。
 */
class Reader {
  private i = 0
  private readonly b: Uint8Array
  // 參數屬性（`constructor(private b: …)`）不是可抹除語法，`erasableSyntaxOnly` 會擋
  constructor(bytes: Uint8Array) { this.b = bytes }
  get offset() { return this.i }
  get remaining() { return this.b.length - this.i }
  byte(): number {
    if (this.i >= this.b.length) throw new RangeError('truncated')
    return this.b[this.i++]
  }
  varint(): number {
    let result = 0, shift = 0, read = 0
    for (;;) {
      const b = this.byte()
      result |= (b & 0x7f) << shift
      read++
      if ((b & 0x80) === 0) break
      shift += 7
      // ⚠ 這一條同時是「varint 炸彈」的防護：沒有它，一串 0x80 可以讓迴圈跑到記憶體耗盡
      if (read >= 3) throw new RangeError('varint-overflow')
    }
    return result >>> 0
  }
  str(maxBytes: number): string {
    const len = this.varint()
    if (len > maxBytes) throw new RangeError('string-too-long')
    if (len > this.remaining) throw new RangeError('truncated')
    const s = new TextDecoder('utf-8', { fatal: false }).decode(this.b.subarray(this.i, this.i + len))
    this.i += len
    return s
  }
  skip(n: number) {
    if (n > this.remaining) throw new RangeError('truncated')
    this.i += n
  }
  sub(n: number): Reader {
    if (n > this.remaining) throw new RangeError('truncated')
    const r = new Reader(this.b.subarray(this.i, this.i + n))
    this.i += n
    return r
  }
}

/** FNV-1a 的低 8 位。挑它不是為了安全性，是為了抓「Discord 換行截斷」這一種錯。 */
export function checksum8(bytes: Uint8Array): number {
  let h = 0x811c9dc5
  for (const b of bytes) {
    h ^= b
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h & 0xff
}

// ─── base64url（不補 =）───────────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const B64_INV = (() => {
  const m = new Int8Array(128).fill(-1)
  for (let i = 0; i < B64.length; i++) m[B64.charCodeAt(i)] = i
  return m
})()

/** 手寫而不用 `btoa`：`btoa` 要先把 bytes 轉成 latin1 字串，多一層可能出錯的轉換。 */
export function toBase64Url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    if (b1 === undefined) break
    out += B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]
    if (b2 === undefined) break
    out += B64[b2 & 63]
  }
  return out
}

/** 認不得的字元一律回 `null`（不是丟例外，也不是靜默跳過）。 */
export function fromBase64Url(s: string): Uint8Array | null {
  const out: number[] = []
  let acc = 0, bits = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const v = c < 128 ? B64_INV[c] : -1
    if (v < 0) return null
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 0xff)
    }
  }
  // 尾端剩下的 bits 必須全為 0，否則是被截斷或竄改過的碼
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) return null
  return Uint8Array.from(out)
}

// ─── 對外型別 ────────────────────────────────────────────────────────────────

/** 六個集合的索引。encode 要 docId→號碼，decode 要號碼→docId。 */
export type ShareIndexes = Readonly<Record<ShareIdKind, ShareIndex>>

export interface EncodeOptions {
  indexes: ShareIndexes
  /** 遊戲版本字串（如 `'3.3'`）。只當提示，解析完全不看它。 */
  gameVersion?: string
}

/** 語意層解不開的一筆。**一律放行並標警示**，不因此拒絕整串碼（決策四④）。 */
export interface UnresolvedRef {
  kind: ShareIdKind
  shareId: number
  /** 出現的位置，給錯誤文案用（如 `main:singleHand:left`／`torso`） */
  at: string
}

/** 未知 tag：來自比本 client 更新的版本，已安全跳過。 */
export interface UnmodeledSection {
  tag: number
  bytes: number
}

export type DecodeFailure =
  | 'empty'
  | 'charset'
  | 'too-long'
  | 'checksum'
  | 'truncated'
  | 'trailing-bytes'
  | 'varint-overflow'
  | 'too-many-items'
  | 'future-version'

export interface DecodeOk {
  ok: true
  draft: LoadoutDraft
  /** header 帶的遊戲版本提示（`'3.3'`）。取不到回 `undefined`。 */
  gameVersion?: string
  unresolved: UnresolvedRef[]
  unmodeled: UnmodeledSection[]
}

export interface DecodeErr {
  ok: false
  reason: DecodeFailure
  /** 給使用者看的中文文案（決策四③：要誠實而且給得出下一步） */
  message: string
}

export type DecodeResult = DecodeOk | DecodeErr

// ─── 遊戲版本（1 byte 的提示欄位）────────────────────────────────────────────

/**
 * `'3.3'` → 33。**只給提示文案用，不參與解析。**
 *
 * ⚠ 上限是 v25.5（25 × 10 + 5 = 255）。header 是永久凍結的，所以這個天花板也是永久的 ——
 *   接受它是因為這一欄的全部用途是在匯出圖上印「這是哪一版的數值」，
 *   而超出時記 0（未知）比記一個錯的版本號誠實。
 */
export function packGameVersion(v: string | undefined): number {
  if (!v) return 0
  const m = /^(\d+)\.(\d+)$/.exec(v.trim())
  if (!m) return 0
  const major = Number(m[1]), minor = Number(m[2])
  const packed = major * 10 + minor
  return minor <= 9 && packed >= 1 && packed <= 255 ? packed : 0
}

export function unpackGameVersion(n: number): string | undefined {
  return n >= 1 && n <= 255 ? `${Math.floor(n / 10)}.${n % 10}` : undefined
}

// ─── encode ──────────────────────────────────────────────────────────────────

/**
 * 一筆 mount 的 SLOTB 位元組。
 * `bit0-2 slot ｜ bit3-4 side ｜ bit5 bank ｜ bit6 hasComp ｜ bit7 保留`
 */
function packSlotByte(m: LoadoutMount, hasComp: boolean): number {
  const slot = SLOT_CODE[m.slot]
  if (slot === undefined) throw new Error(`[codec] 認不得的槽位：${m.slot}`)
  const side = SIDE_CODE[m.side ?? 'none']
  const bank = m.bank === 'backup' ? 1 : 0
  return slot | (side << 3) | (bank << 5) | (hasComp ? 1 << 6 : 0)
}

/** 一個 section：`tag ＋ len ＋ payload`。payload 為空就整段不寫。 */
function section(w: Writer, tag: number, body: Writer) {
  if (body.length === 0) return
  w.byte(tag)
  w.varint(body.length)
  w.bytes(body.toBytes())
}

function encodeSets(draft: LoadoutDraft, ix: ShareIndexes): Writer {
  const w = new Writer()
  // canonical order：鍵排序後寫入，否則兩份內容相同的配裝會產出不同的代碼，
  // 而 deepEqual 測試會變成在測 Object.keys 的插入順序
  const keys = Object.keys(draft.sets).sort()
  if (keys.length === 0) return w
  if (keys.length > LIMITS.sets) throw new Error(`[codec] 分頁數超過上限（${keys.length} > ${LIMITS.sets}）`)

  w.varint(keys.length)
  // ACTIVE：指向下方清單的索引。0xff ＝ 不在清單內（decode 退回第一套）
  const activeIdx = keys.indexOf(draft.activeSetKey)
  w.byte(activeIdx >= 0 ? activeIdx : 0xff)

  for (const key of keys) {
    const set: EquipSet = draft.sets[key]
    w.str(key, LIMITS.keyBytes)

    const mounts = [...(set.mounts ?? [])].sort((a, b) => slotKey(a).localeCompare(slotKey(b)))
    if (mounts.length > LIMITS.mountsPerSet) {
      throw new Error(`[codec] 單套 mount 數超過上限（${mounts.length} > ${LIMITS.mountsPerSet}）`)
    }
    w.byte(mounts.length)
    for (const m of mounts) {
      const trig = (m.setup?.triggerComponentIds ?? []).map((id) => ix.component.toShareId(id)).filter((n): n is number => n !== null).sort((a, b) => a - b)
      const eff = (m.setup?.effectComponentIds ?? []).map((id) => ix.component.toShareId(id)).filter((n): n is number => n !== null).sort((a, b) => a - b)
      const hasComp = trig.length > 0 || eff.length > 0
      w.byte(packSlotByte(m, hasComp))
      // 武器推不出號碼 ⇒ 寫 0（＝這一格空著）。丟例外會讓「有一把武器暫時不可分享」
      // 變成「整套配裝分享不出去」，不成比例
      w.varint(ix.weapon.toShareId(m.weaponId) ?? 0)
      if (hasComp) {
        if (trig.length > LIMITS.componentsPerKind || eff.length > LIMITS.componentsPerKind) {
          throw new Error('[codec] 單一武器的元件數超過上限')
        }
        w.byte(trig.length)
        w.byte(eff.length)
        for (const n of trig) w.varint(n)
        for (const n of eff) w.varint(n)
      }
    }

    const bp = set.backpackId ? ix.backpack.toShareId(set.backpackId) : null
    w.byte(bp === null ? 0 : 1)
    if (bp !== null) w.varint(bp)
  }
  return w
}

function encodePositionMap(
  map: Partial<Record<MechPartPosition, string>> | undefined,
  index: ShareIndex,
  limit: number,
): Writer {
  const w = new Writer()
  const entries = Object.entries(map ?? {})
    .filter(([pos, id]) => PART_CODE[pos] !== undefined && !!id)
    .map(([pos, id]) => [PART_CODE[pos], index.toShareId(id as string)] as const)
    .filter((e): e is readonly [number, number] => e[1] !== null)
    .sort((a, b) => a[0] - b[0])
  if (entries.length === 0) return w
  if (entries.length > limit) throw new Error(`[codec] 部位對照數超過上限（${entries.length} > ${limit}）`)
  w.varint(entries.length)
  for (const [pos, n] of entries) { w.byte(pos); w.varint(n) }
  return w
}

function encodeNd(ndLevels: Record<string, number> | undefined): Writer {
  const w = new Writer()
  const entries = Object.entries(ndLevels ?? {})
    .filter(([, lv]) => Number.isInteger(lv) && lv >= 0 && lv <= 255)
    .sort((a, b) => a[0].localeCompare(b[0]))
  if (entries.length === 0) return w
  if (entries.length > LIMITS.ndZones) throw new Error(`[codec] 算力分區數超過上限（${entries.length} > ${LIMITS.ndZones}）`)
  w.varint(entries.length)
  // 分區名內嵌（`γ1` 只有 3 bytes）：與形態鍵同一個理由，見檔頭「與規格的出入」①
  for (const [zone, lv] of entries) { w.str(zone, LIMITS.keyBytes); w.byte(lv) }
  return w
}

/**
 * 把一份草稿編成分享碼。
 *
 * **會 throw**（與 `decodeLoadout` 相反）：這裡的例外一律是呼叫端的 bug
 * （超過上限、認不得的槽位、varint 溢位），而 bug 應該在測試裡爆掉，
 * 不是產生一串解開會指向別人的碼。呼叫端請自行 try/catch 並顯示「這套配裝目前無法分享」。
 */
export function encodeLoadout(draft: LoadoutDraft, opts: EncodeOptions): string {
  const ix = opts.indexes
  const w = new Writer()
  w.byte(FMT_VERSION)
  w.byte(packGameVersion(opts.gameVersion))
  w.varint(draft.pilotId ? ix.pilot.toShareId(draft.pilotId) ?? 0 : 0)
  w.varint(draft.mechId ? ix.mech.toShareId(draft.mechId) ?? 0 : 0)

  section(w, TAG.SETS, encodeSets(draft, ix))
  section(w, TAG.PARTS, encodePositionMap(draft.parts, ix.mech, LIMITS.parts))
  section(w, TAG.MODULES, encodePositionMap(draft.modules, ix.module, LIMITS.modules))
  section(w, TAG.ND, encodeNd(draft.ndLevels))
  if (draft.name) {
    const nameBody = new Writer()
    nameBody.str(draft.name, LIMITS.nameBytes)
    section(w, TAG.NAME, nameBody)
  }

  const body = w.toBytes()
  const out = new Uint8Array(body.length + 1)
  out.set(body)
  out[body.length] = checksum8(body)
  if (out.length > LIMITS.bytes) throw new Error(`[codec] 代碼過長（${out.length} > ${LIMITS.bytes} bytes）`)
  return toBase64Url(out)
}

// ─── decode ──────────────────────────────────────────────────────────────────

/**
 * 輸入清洗（決策四①）。吃得下這些形狀：
 *   `AQMy…`／`?b=AQMy…`／`https://…/simulator?b=AQMy…`／中間被 Discord 插了換行的
 */
export function cleanCodeInput(raw: string): string {
  let s = String(raw ?? '')
  const at = s.lastIndexOf('b=')
  if (at >= 0) s = s.slice(at + 2)
  // 網址參數可能被 encode 過（base64url 本身不含 % 或 +，所以這一步是安全的）
  if (s.includes('%')) { try { s = decodeURIComponent(s) } catch { /* 壞的 escape 就當原樣 */ } }
  const amp = s.indexOf('&')
  if (amp >= 0) s = s.slice(0, amp)
  // Discord 會在 ~70 字元處插入換行；順手把所有空白清掉
  return s.replace(/\s+/g, '')
}

const FAIL: Record<DecodeFailure, string> = {
  empty: '沒有讀到分享碼。請確認整串都複製到了。',
  charset: '這串代碼含有不屬於分享碼的字元，可能是複製時混到了其他文字。',
  'too-long': '這串代碼太長了，不像是本站產生的分享碼。',
  checksum: '這串代碼不完整——最常見的原因是聊天軟體換行時被截斷。請重新複製完整的一整串。',
  truncated: '這串代碼在中途就結束了，應該是複製時少了一段。',
  'trailing-bytes': '這串代碼的結尾多了讀不懂的內容，可能已被修改過。',
  'varint-overflow': '這串代碼裡有超出範圍的數值，不是本站產生的。',
  'too-many-items': '這串代碼宣稱的項目數量超過合理範圍，已拒絕載入。',
  'future-version': '這串代碼來自比你手上更新的版本。請重新整理頁面（Ctrl+F5）後再試一次。',
}

const err = (reason: DecodeFailure): DecodeErr => ({ ok: false, reason, message: FAIL[reason] })

function readSets(
  r: Reader,
  ix: ShareIndexes,
  unresolved: UnresolvedRef[],
): { sets: Record<string, EquipSet>; activeSetKey?: string } {
  const n = r.varint()
  if (n > LIMITS.sets) throw new RangeError('too-many-items')
  const activeIdx = r.byte()
  const sets: Record<string, EquipSet> = {}
  const keys: string[] = []

  for (let i = 0; i < n; i++) {
    const key = r.str(LIMITS.keyBytes)
    keys.push(key)
    const nm = r.byte()
    if (nm > LIMITS.mountsPerSet) throw new RangeError('too-many-items')
    const mounts: LoadoutMount[] = []
    for (let j = 0; j < nm; j++) {
      const sb = r.byte()
      const slot = SLOT_OF[sb & 0b111]
      const side = SIDE_OF[(sb >> 3) & 0b11]
      const bank = BANK_OF[(sb >> 5) & 0b1]
      const hasComp = ((sb >> 6) & 0b1) === 1
      const wid = r.varint()
      let setup: LoadoutMount['setup']
      if (hasComp) {
        const nt = r.byte(), ne = r.byte()
        if (nt > LIMITS.componentsPerKind || ne > LIMITS.componentsPerKind) throw new RangeError('too-many-items')
        const trig: string[] = [], eff: string[] = []
        for (let k = 0; k < nt; k++) {
          const cn = r.varint()
          const id = ix.component.toDocId(cn)
          if (id) trig.push(id); else unresolved.push({ kind: 'component', shareId: cn, at: key })
        }
        for (let k = 0; k < ne; k++) {
          const cn = r.varint()
          const id = ix.component.toDocId(cn)
          if (id) eff.push(id); else unresolved.push({ kind: 'component', shareId: cn, at: key })
        }
        if (trig.length || eff.length) {
          setup = {}
          if (trig.length) setup.triggerComponentIds = trig
          if (eff.length) setup.effectComponentIds = eff
        }
      }
      // 認不得的槽位（未來版本新增的第五種）⇒ 跳過這一格，不整串拒絕
      if (!slot) { unresolved.push({ kind: 'weapon', shareId: wid, at: `slot#${sb & 0b111}` }); continue }
      if (wid === 0) continue                       // 0 ＝ 編碼時就推不出號碼的空格
      const docId = ix.weapon.toDocId(wid)
      if (!docId) {
        unresolved.push({ kind: 'weapon', shareId: wid, at: side ? `${bank}:${slot}:${side}` : `${bank}:${slot}` })
        continue
      }
      const mount: LoadoutMount = { weaponId: docId, bank, slot }
      if (side) mount.side = side
      if (setup) mount.setup = setup
      mounts.push(mount)
    }
    const set: EquipSet = { mounts }
    if (r.byte() === 1) {
      const bn = r.varint()
      const bid = ix.backpack.toDocId(bn)
      if (bid) set.backpackId = bid
      else unresolved.push({ kind: 'backpack', shareId: bn, at: key })
    }
    sets[key] = set
  }
  return { sets, activeSetKey: activeIdx < keys.length ? keys[activeIdx] : undefined }
}

function readPositionMap(
  r: Reader,
  index: ShareIndex,
  kind: ShareIdKind,
  limit: number,
  unresolved: UnresolvedRef[],
): Partial<Record<MechPartPosition, string>> {
  const n = r.varint()
  if (n > limit) throw new RangeError('too-many-items')
  const out: Partial<Record<MechPartPosition, string>> = {}
  for (let i = 0; i < n; i++) {
    const pos = PART_OF[r.byte()]
    const num = r.varint()
    const id = index.toDocId(num)
    if (!pos) continue
    if (id) out[pos] = id
    else unresolved.push({ kind, shareId: num, at: pos })
  }
  return out
}

function readNd(r: Reader): Record<string, number> {
  const n = r.varint()
  if (n > LIMITS.ndZones) throw new RangeError('too-many-items')
  const out: Record<string, number> = {}
  for (let i = 0; i < n; i++) {
    const zone = r.str(LIMITS.keyBytes)
    const lv = r.byte()
    if (zone) out[zone] = lv
  }
  return out
}

/**
 * 把分享碼解回草稿。**永不 throw** —— 一個壞碼讓整頁白畫面，比解不開更糟（決策四）。
 *
 * 兩層判準刻意不同：
 *   · **結構錯誤一律拒絕**（長度／字元集／checksum／varint／數量上限／尾端殘餘）——
 *     那不是「舊版配裝」，而是損毀或惡意輸入。
 *   · **語意錯誤一律放行並標警示**（號碼查無此物、認不得的槽位）——
 *     對方可能在分享改版前的配裝，或想看看改了什麼。**絕不因此拒絕套用。**
 *
 * ⚠ 呼叫端在判定「已下架」之前，請先照決策四的舊快取防護打一次 `/api/versions`：
 *   本週新上線的武器若因快取落後而查不到，會被顯示成「已下架裝備 #181」，語意完全相反。
 */
export function decodeLoadout(raw: string, indexes: ShareIndexes): DecodeResult {
  const s = cleanCodeInput(raw)
  if (!s) return err('empty')
  if (s.length > LIMITS.codeChars) return err('too-long')

  const all = fromBase64Url(s)
  if (!all) return err('charset')
  if (all.length < 5) return err('truncated')       // FMT + GAMEVER + 兩個最小 varint + CHK
  if (all.length > LIMITS.bytes) return err('too-long')

  const body = all.subarray(0, all.length - 1)
  if (checksum8(body) !== all[all.length - 1]) return err('checksum')

  const unresolved: UnresolvedRef[] = []
  const unmodeled: UnmodeledSection[] = []
  try {
    const r = new Reader(body)
    const fmt = r.byte()
    if (fmt > FMT_VERSION) return err('future-version')
    const gameVersion = unpackGameVersion(r.byte())
    const pilotNum = r.varint()
    const mechNum = r.varint()

    const draft: LoadoutDraft = { activeSetKey: 'default', sets: {} }
    if (pilotNum > 0) {
      const id = indexes.pilot.toDocId(pilotNum)
      if (id) draft.pilotId = id
      else unresolved.push({ kind: 'pilot', shareId: pilotNum, at: 'header' })
    }
    if (mechNum > 0) {
      const id = indexes.mech.toDocId(mechNum)
      if (id) draft.mechId = id
      else unresolved.push({ kind: 'mech', shareId: mechNum, at: 'header' })
    }

    while (r.remaining > 0) {
      const tag = r.byte()
      const len = r.varint()
      const sub = r.sub(len)
      switch (tag) {
        case TAG.SETS: {
          const { sets, activeSetKey } = readSets(sub, indexes, unresolved)
          draft.sets = sets
          if (activeSetKey) draft.activeSetKey = activeSetKey
          else if (Object.keys(sets).length) draft.activeSetKey = Object.keys(sets)[0]
          break
        }
        case TAG.PARTS: {
          const m = readPositionMap(sub, indexes.mech, 'mech', LIMITS.parts, unresolved)
          if (Object.keys(m).length) draft.parts = m
          break
        }
        case TAG.MODULES: {
          const m = readPositionMap(sub, indexes.module, 'module', LIMITS.modules, unresolved)
          if (Object.keys(m).length) draft.modules = m
          break
        }
        case TAG.ND: {
          const nd = readNd(sub)
          if (Object.keys(nd).length) draft.ndLevels = nd
          break
        }
        case TAG.NAME: {
          const name = sub.str(LIMITS.nameBytes)
          if (name) draft.name = name
          break
        }
        default:
          // TLV 的全部意義：不認得就跳過並記下來，而不是整串拒絕
          unmodeled.push({ tag, bytes: len })
          // ⚠ 要真的把它讀掉：留著未讀的位元組，下面那條「段內沒讀完」會把同一段
          //   再記一次，呼叫端就會看到兩筆一模一樣的未知段落
          sub.skip(sub.remaining)
      }
      // 段內沒讀完 ⇒ 該段比本 client 認識的版本更長（欄位是 additive 加的），不是錯誤
      if (sub.remaining > 0) unmodeled.push({ tag, bytes: sub.remaining })
    }

    return { ok: true, draft, gameVersion, unresolved, unmodeled }
  } catch (e) {
    const m = e instanceof RangeError ? e.message : 'truncated'
    if (m === 'varint-overflow') return err('varint-overflow')
    if (m === 'too-many-items') return err('too-many-items')
    if (m === 'string-too-long') return err('too-many-items')
    return err('truncated')
  }
}
