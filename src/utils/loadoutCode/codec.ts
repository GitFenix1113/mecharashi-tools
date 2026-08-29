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

import type { LoadoutDraft, EquipSet, LoadoutMount, LoadoutSkills } from '../../types/loadout'
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
  /**
   * 方案備註（PLAN-052-L C-3）。**追加段，不 bump `FMT_VERSION`**：
   * 舊 client 遇到不認得的 tag 會跳過並記進 `unmodeled`，不拒收整串 ⇒ 零遷移。
   *
   * ⚠ **必須寫在 §NAME 之後**（`encodeLoadout` 的順序就是版面順序）：
   *   插在前面會讓所有既有的 golden fixture 碼位元不同 —— 那些是「已經流出去的碼」。
   */
  NOTE: 6,
  /**
   * 攜帶技能（PLAN-052-L D-3）。**追加段，不 bump `FMT_VERSION`**，理由同 `NOTE`。
   *
   * ⚠ **排在 §NOTE 之後**（＝整串的最後）：`encodeLoadout()` 的順序就是版面順序，
   *   插在前面會讓所有既有的 golden fixture 碼位元不同 —— 那些是已經流出去的碼。
   */
  SKILLS: 7,
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
  /**
   * 方案備註：`LOADOUT_NOTE_MAX` 是 100 碼點，最壞 4 bytes/碼點 ＝ 400。
   * 取 512 留餘裕 —— 這個數字是**炸彈引信**不是「合理值」，寬到不會誤殺、窄到炸不掉瀏覽器。
   */
  noteBytes: 512,
  /**
   * 攜帶技能格數。**這是炸彈引信不是規則** —— 真正的規則是
   * `CARRIED_SKILL_SLOTS`（3），由 `reconcile()` 裁到那個長度。
   *
   * 這裡取 8 而不是 3：解碼器的工作是「別讓一段 3 bytes 的代碼宣告十萬個項目」，
   * 不是替遊戲規則把關。哪天官方開第四格，收得下的碼一律照收 ——
   * 上限只能放寬不能收緊（052-E 決策二），而在這裡誤殺的症狀是整串碼被拒收。
   */
  skills: 8,
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
 * §SKILLS 的內容（PLAN-052-L D-3）。
 *
 * 版面：`NCARRIED varint ＋ 號碼 varint × N ＋ MOD varint`（`MOD` 為 0 ＝ 沒有）。
 *
 * ⚠ **`mod` 恆寫一個 varint，即使是 0**：省掉它就得靠「段內還有沒有剩」來判斷有無，
 *   而 `decodeLoadout()` 的既有規約是「段內沒讀完 ⇒ 記進 `unmodeled`」——
 *   於是每一份不帶「改」技能的碼都會多出一筆假的未知段落。1 byte 換掉那個歧義。
 *
 * ⚠ 查不到號碼的技能**整個跳過**（同 `encodePositionMap` 的既有作法）。今天不會發生：
 *   853／853 都在登錄簿裡（D-2），而 `scripts/check-share-ids.mjs` 會在上線前
 *   把「還沒發號」報出來 —— 那正是它新增 `pendingAliases` 的理由。
 */
function encodeSkills(skills: LoadoutSkills | undefined, index: ShareIndex): Writer {
  const w = new Writer()
  if (!skills) return w
  const carried = (skills.carried ?? [])
    .map((id) => index.toShareId(id))
    .filter((n): n is number => n !== null)
  const mod = skills.mod ? index.toShareId(skills.mod) ?? 0 : 0
  if (carried.length === 0 && mod === 0) return w
  if (carried.length > LIMITS.skills) {
    throw new Error(`[codec] 攜帶技能數超過上限（${carried.length} > ${LIMITS.skills}）`)
  }
  w.varint(carried.length)
  for (const n of carried) w.varint(n)
  w.varint(mod)
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
  // ⚠ §NOTE 必須排在 §NAME 之後（見 `TAG.NOTE` 的註解）
  if (draft.note) {
    const noteBody = new Writer()
    noteBody.str(draft.note, LIMITS.noteBytes)
    section(w, TAG.NOTE, noteBody)
  }
  // ⚠ §SKILLS 排在最後（見 `TAG.SKILLS` 的註解）
  section(w, TAG.SKILLS, encodeSkills(draft.skills, ix.pilotSkill))

  const body = w.toBytes()
  const out = new Uint8Array(body.length + 1)
  out.set(body)
  out[body.length] = checksum8(body)
  if (out.length > LIMITS.bytes) throw new Error(`[codec] 代碼過長（${out.length} > ${LIMITS.bytes} bytes）`)
  return toBase64Url(out)
}

/**
 * 同一套配裝的**識別鍵**（PLAN-052-L C-6）。
 *
 * ── 為什麼需要它 ────────────────────────────────────────────────────────────
 * 書架與雲端的「已存過」判定原本是**比對整串代碼字串**。加上備註之後，
 * 「只改了備註」＝新字串 ⇒「已在雲端」徽章翻假、再存一次會佔掉第二格而不是就地更新。
 * 而「三個只差一點的方案」正是這個機制最脆弱的輸入 —— 它們的差別可能只在備註裡。
 *
 * ⇒ 拿掉三樣東西之後再比：
 *   · **§NAME**   方案名稱是標籤，不是配裝
 *   · **§NOTE**   備註是說明，不是配裝
 *   · **GAMEVER** header 那個「不參與解析」的版本提示。它記的是**這串碼是哪一版做的**，
 *                 不是這一套裝了什麼；留著的話，同一套配裝在改版前後存兩次會佔兩格。
 *
 * 回傳的字串**只用來比對**，不可以拿去解碼、更不可以存起來當代碼
 * （它沒有 checksum，而且丟掉了名稱與備註）。
 *
 * 解不開時回 `null` —— 呼叫端請退回比對原字串（那是改寫前的行為，至少不會更糟）。
 *
 * ⚠ 純位元組操作，**不經 `decodeLoadout()`**：那需要六份 shareId 索引，而書架這一層
 *   （`localBuilds.ts`）刻意零依賴。而且解碼再重編會把「解不開的引用」洗成 0，
 *   兩串不同的碼會因此撞成同一個鍵。
 */
export function loadoutIdentity(raw: string): string | null {
  const s = cleanCodeInput(raw)
  if (!s) return null
  const all = fromBase64Url(s)
  if (!all || all.length < 5 || all.length > LIMITS.bytes) return null
  const body = all.subarray(0, all.length - 1)   // 去掉 CHK

  try {
    const r = new Reader(body)
    const w = new Writer()
    w.byte(r.byte())      // FMT
    r.byte()              // GAMEVER —— 讀掉但不寫回（見上方）
    w.varint(r.varint())  // PILOT
    w.varint(r.varint())  // MECH

    while (r.remaining > 0) {
      const tag = r.byte()
      const len = r.varint()
      if (len > r.remaining) return null
      const start = r.offset
      r.skip(len)
      // 未知 tag 一律**保留**：它是別的 client 加的配裝資料，丟掉會讓兩套不同的
      // 配裝撞成同一個鍵（而症狀是「存第二套時被當成重複、就地覆蓋掉第一套」）
      if (tag === TAG.NAME || tag === TAG.NOTE) continue
      w.byte(tag)
      w.varint(len)
      w.bytes(body.subarray(start, start + len))
    }
    return toBase64Url(w.toBytes())
  } catch {
    return null
  }
}

/**
 * 比對「是不是同一套配裝」時用的鍵（PLAN-052-L C-6）。
 *
 * ＝ `loadoutIdentity()`，但**解不開時退回原字串**。書架與雲端的三個去重點一律走這一支，
 * 各自寫一次 `?? code` 的話，總有一處會忘記而變成「壞掉的舊碼永遠被判定成不重複」。
 */
export function loadoutKey(code: string): string {
  return loadoutIdentity(code) ?? code
}

/** 兩串碼是不是同一套配裝（忽略方案名稱、備註與遊戲版本提示）。 */
export function sameLoadout(a: string, b: string): boolean {
  return a === b || loadoutKey(a) === loadoutKey(b)
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

/**
 * 讀 §SKILLS（PLAN-052-L D-3）。版面見 `encodeSkills()`。
 *
 * ⚠ 查不到 doc id 的號碼進 `unresolved` 並**跳過那一格**，不整串拒收（決策四④）：
 *   對方可能在分享一個本站剛下架／還沒同步的技能。
 * ⚠ **不裁到三格**：那是 `reconcile()` 的事。codec 只把 bytes 變回結構，
 *   在這裡多裁一次會讓 round-trip 測試的相等失效，而那個相等正是把關的東西。
 */
function readSkills(r: Reader, index: ShareIndex, unresolved: UnresolvedRef[]): LoadoutSkills | null {
  const n = r.varint()
  if (n > LIMITS.skills) throw new RangeError('too-many-items')
  const carried: string[] = []
  for (let i = 0; i < n; i++) {
    const num = r.varint()
    const id = index.toDocId(num)
    if (id) carried.push(id)
    else unresolved.push({ kind: 'pilotSkill', shareId: num, at: `skill:${i + 1}` })
  }
  const modNum = r.varint()
  const out: LoadoutSkills = { carried }
  if (modNum > 0) {
    const id = index.toDocId(modNum)
    if (id) out.mod = id
    else unresolved.push({ kind: 'pilotSkill', shareId: modNum, at: 'skill:mod' })
  }
  return carried.length > 0 || out.mod ? out : null
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
        case TAG.NOTE: {
          // ⚠ 這裡**不清洗**：codec 只負責把 bytes 變回字串，清洗是 `reconcile()` 的事
          //   （寫入邊界兩道，見 `sanitizeLoadoutNote` 的檔頭）。在這裡多清一次，
          //   會讓「解出來的」與「reconcile 之後的」在測試裡對不起來，而 round-trip
          //   測試正是靠那個相等在把關。
          const note = sub.str(LIMITS.noteBytes)
          if (note) draft.note = note
          break
        }
        case TAG.SKILLS: {
          const skills = readSkills(sub, indexes.pilotSkill, unresolved)
          if (skills) draft.skills = skills
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
