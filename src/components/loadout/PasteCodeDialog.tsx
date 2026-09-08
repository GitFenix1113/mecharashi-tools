// 貼碼對話框 —— PLAN-052-C Phase C / C-1
//
// 「別人把連結貼給我，我要看到他的配裝」的另一半：使用者手上只有一串文字時的入口。
//
// ⚠ **套用之前一定要先給預覽。** 貼碼會覆蓋掉使用者手上正在配的那一套，
//   而那一套沒有第二份備份（本機草稿只有一份）。先看到「這是誰的什麼配裝」再決定，
//   是這個對話框存在的全部理由 —— 少了它，這裡就只是一個會吃掉你半小時的輸入框。
//
// ⚠ **解不開時不要急著說「已下架」**（決策四的舊快取防護）：本週剛上線的武器，
//   在快取還沒失效的瀏覽器上查不到號碼，語意剛好相反。先問 `onCheckStale()`。
//
// ── 配裝圖也收（PLAN-052-O）──────────────────────────────────────────────────
// PC 玩家拿到別人的配裝圖，手機掃得到 QR、電腦卻只能一個字一個字抄 base64url。
// 所以這裡同時收圖：Ctrl+V 貼圖、拖進視窗、或按「選擇圖片」，交給 `readLoadoutFromImage()`
// （PNG 內嵌 → 原生偵測器 → zxing）讀出連結後 **整串塞進 textarea**，後面全走既有的
// 預覽→套用流程 —— 圖片只是另一種輸入法，不是另一條路徑。
//
// ⚠ 圖片讀取是非同步的，而使用者在等的時候可能又貼了第二張、或改回手打：
//   用 `reqSeq` 讓過期的結果一律作廢，否則第一張慢慢解出來的連結會蓋掉第二張的。
// ⚠ paste 監聽掛在 `window`（對話框是 modal，這樣「焦點不在輸入框也能貼」才成立），
//   但 textarea 裡的純文字貼上**不攔**：那是瀏覽器原生行為，攔了會失去游標位置插入與復原。

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { LoadoutDraft } from '../../types/loadout'
import type { LoadoutWorld } from '../../utils/loadoutRules'
import { decodeLoadout, type ShareIndexes, type DecodeResult } from '../../utils/loadoutCode/codec'
import { readShareCode, SHARE_PARAM } from '../../utils/loadoutCode/shareLink'
import {
  imageFromDataTransfer,
  readLoadoutFromImage,
  type ImageImportFailure,
  type ImageImportResult,
  type ImageImportSource,
} from '../../utils/loadoutCode/imageImport'
import { HUD_PANEL, SHARE_KIND_LABEL } from './loadoutTheme'

/** 圖片讀取的狀態列。`head` 只在 `not-share-link` 時有：QR 內容的開頭幾個字，讓使用者知道自己貼到了什麼。 */
type ImageState =
  | { phase: 'idle' }
  | { phase: 'busy' }
  | { phase: 'ok'; source: ImageImportSource }
  | { phase: 'fail'; reason: ImageImportFailure | 'not-share-link' | 'drop-without-file'; head?: string }

/** 共用同一個物件：重複 set 進去時 React 直接略過重繪（`Object.is` 相等）。 */
const IMAGE_IDLE: ImageState = { phase: 'idle' }

/** 狀態列文案與色調。`null` ＝ 不顯示。 */
function imageStateText(s: ImageState): { text: string; tone: 'dim' | 'ok' | 'err' } | null {
  switch (s.phase) {
    case 'idle':
      return null
    case 'busy':
      return { text: '正在讀取圖片…', tone: 'dim' }
    case 'ok':
      return s.source === 'qr'
        ? { text: '已從圖片的 QR 讀出分享連結', tone: 'ok' }
        : { text: '已從圖檔內嵌的資料讀出分享連結（原始匯出圖，最準確）', tone: 'ok' }
    case 'fail':
      switch (s.reason) {
        case 'not-image':
          return { text: '這不是圖片檔', tone: 'err' }
        case 'too-large':
          return { text: '圖片太大（超過 40 MB 或 5,000 萬像素），讀不動', tone: 'err' }
        case 'unreadable':
          return { text: '這張圖讀不出來 —— 格式不支援（例如 HEIC）或檔案損壞', tone: 'err' }
        case 'no-qr':
          return {
            text: '圖裡找不到讀得出來的 QR。可能是這張圖匯出時碼太長、沒有畫 QR，或截圖被壓得太小；請改貼圖底那串完整分享碼。',
            tone: 'err',
          }
        case 'not-share-link':
          return { text: `圖裡的 QR 讀得出來，但不是本站的分享連結（內容開頭：「${s.head ?? ''}」）`, tone: 'err' }
        case 'decoder-failed':
          return { text: 'QR 解碼器載入失敗（可能是網路問題），請稍後再試，或改貼分享碼。', tone: 'err' }
        case 'drop-without-file':
          return {
            text: '拖進來的不是圖片檔。從網頁直接拖圖常常拖不到檔案本身 —— 先另存圖片、或截圖再貼。',
            tone: 'err',
          }
      }
  }
}

const IMAGE_TONE_CLASS = { dim: 'text-text-dim', ok: 'text-accent-cyan', err: 'text-accent-red' } as const

/** 分享碼在網址裡的樣子（`?b=`／`&b=`）。圖片讀出的文字長這樣就當作本站連結，不必先解得開。 */
const SHARE_URL_FORM = new RegExp(`[?&]${SHARE_PARAM}=`)

/**
 * 「不是本站連結」時印給使用者看的 QR 內容開頭。
 *
 * ⚠ 這是**完全不受信任**的字串（別人的 QR 裡寫什麼都有可能）：控制字元、零寬字元與
 *   雙向覆寫（U+202E 會把錯誤列後半段整個反過來顯示）一律濾掉；
 *   而且要按 code point 切而不是按 UTF-16 單位切，否則 emoji 會被切成半個。
 */
function previewHead(text: string, max = 40): string {
  // eslint-disable-next-line no-control-regex -- 就是要濾控制字元
  const cleaned = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
  const cps = Array.from(cleaned)
  return cps.slice(0, max).join('') + (cps.length > max ? '…' : '')
}

interface Props {
  /**
   * ⚠ **由呼叫端條件式掛載**（`{open && <PasteCodeDialog …/>}`），本元件不收 `open`。
   *   收 `open` 就得在 effect 裡把內部狀態清乾淨，而那是 effect 的誤用
   *   （eslint `react-hooks` 會擋，理由也對：會觸發串聯渲染）。
   *   卸載即歸零 —— 不必寫任何清理程式碼，也不可能忘記清哪一個欄位。
   */
  onClose: () => void
  /**
   * 遊戲資料還在載入。**為真時一律不給套用**：索引還不完整，`decodeLoadout()` 會把
   * 還沒載到的集合全部判成「查不到」，套用出去的是一套沒有武器的配裝——而畫面上
   * 看起來只是「這串代碼裡有東西下架了」。
   */
  loading?: boolean
  indexes: ShareIndexes
  world: LoadoutWorld
  onApply: (draft: LoadoutDraft) => void
  /**
   * 檢查本機遊戲資料是否落後於伺服器。回 `true` ＝ 落後，此時「查無此號」很可能是
   * 快取太舊而不是真的下架。不傳則一律以「已下架」呈現（降級，不是壞掉）。
   */
  onCheckStale?: () => Promise<boolean>
  /** 重新載入遊戲資料（`GameDataContext.reload()`）。落後時才會顯示那顆按鈕。 */
  onReload?: () => void
}

export function PasteCodeDialog({ onClose, loading, indexes, world, onApply, onCheckStale, onReload }: Props) {
  const [raw, setRaw] = useState('')
  /**
   * 版本檢查的結果，**連同它是針對哪一串輸入算的**一起存。
   *
   * 只存 `boolean` 會有一個看不出來的錯：貼了 A（資料落後）之後改貼 C，
   * 在非同步查詢回來之前，畫面會用 A 的答案去描述 C —— 使用者看到的是一句
   * 針對別串代碼的說明。帶上 `raw` 就自然對得起來。
   */
  const [staleFor, setStaleFor] = useState<{ raw: string; stale: boolean } | null>(null)
  const [imageState, setImageState] = useState<ImageState>(IMAGE_IDLE)
  const [dragging, setDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  /** 最新一次圖片讀取的序號；結果回來時序號不符＝過期，丟掉。 */
  const reqSeq = useRef(0)
  /** 卸載後不 setState（解碼可能還在跑，而對話框已經被關掉了）。 */
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /**
   * 使用者手動給的文字（打字、或焦點不在輸入框時貼上的純文字）。
   * 同時讓還在跑的圖片讀取作廢 —— 「已從圖片讀出」的說明對一串手打的字不成立，
   * 而一張慢慢解出來的圖也不該蓋掉使用者剛打的東西。
   */
  const manualInput = useCallback((text: string) => {
    reqSeq.current++
    setRaw(text)
    setImageState(IMAGE_IDLE)
  }, [])

  const handleImage = useCallback(async (file: File) => {
    const seq = ++reqSeq.current
    setImageState({ phase: 'busy' })
    // `readLoadoutFromImage()` 自己不 throw；這層 catch 是最後一道保險（例如瀏覽器把某個 API 整個拔掉）
    const r = await readLoadoutFromImage(file).catch((): ImageImportResult => ({ ok: false, reason: 'decoder-failed' }))
    if (!alive.current || seq !== reqSeq.current) return
    if (!r.ok) {
      setImageState({ phase: 'fail', reason: r.reason })
      return
    }
    // ⚠ 「是本站連結」的判定不能只靠 `readShareCode()`：它對裸碼的寬鬆匹配會把任何純英數／空白的
    //   QR 內容（"HELLO WORLD 123"）當成碼，於是狀態列說「已讀出分享連結」、下面卻印一行
    //   解碼失敗的紅字，兩句互相打臉。規則改成：網址形式（`?b=`）就算數 —— 解不開時下面那行
    //   紅字（未來版本、校驗失敗）本來就是要給使用者看的；裸碼則要**真的解得開**才算。
    const code = readShareCode(r.text)
    if (code && (SHARE_URL_FORM.test(r.text) || decodeLoadout(code, indexes).ok)) {
      // 整串塞進 textarea：後面的預覽、舊快取判斷、套用全部沿用貼文字那條路徑
      setRaw(r.text)
      setImageState({ phase: 'ok', source: r.source })
    } else {
      setImageState({ phase: 'fail', reason: 'not-share-link', head: previewHead(r.text) })
    }
  }, [indexes])

  // paste 掛在 window：對話框是 modal，掛全域沒問題；卸載即移除
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text') ?? ''
      const inTextarea = e.target === textareaRef.current
      // ⚠ 文字本身就是分享碼時**文字優先**：剪貼簿同時帶圖與文字（從網頁複製一則含圖訊息）
      //   的情況下，解圖是繞遠路 —— 而且焦點在 textarea 時要放行原生貼上，不攔。
      if (readShareCode(text)) {
        if (inTextarea) return
        e.preventDefault()
        manualInput(text)
        return
      }
      const file = imageFromDataTransfer(e.clipboardData)
      if (file) {
        e.preventDefault()
        void handleImage(file)
        return
      }
      // 沒有圖：textarea 裡的純文字貼上照舊、不攔；焦點在別處時代為貼進去
      if (inTextarea || !text.trim()) return
      e.preventDefault()
      manualInput(text)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [handleImage, manualInput])

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const file = imageFromDataTransfer(e.dataTransfer)
    if (file) { void handleImage(file); return }
    // ⚠ 沒有檔不等於拖錯：把一段選取的文字或一條連結拖進來也是拖放（textarea 原生就收），
    //   一律報「不是圖片檔」等於把那條路封掉。有文字就當成手動輸入。
    const text = e.dataTransfer.getData('text') || e.dataTransfer.getData('text/uri-list')
    if (text.trim()) { manualInput(text); return }
    setImageState({ phase: 'fail', reason: 'drop-without-file' })
  }, [handleImage, manualInput])

  const imageText = imageStateText(imageState)

  const result = useMemo<DecodeResult | null>(() => {
    const code = readShareCode(raw)
    return code ? decodeLoadout(code, indexes) : null
  }, [raw, indexes])

  // 有解不開的引用時才去問版本（1 次讀取）。沒有的話一個網路請求都不發
  const unresolvedCount = result?.ok ? result.unresolved.length : 0
  useEffect(() => {
    if (!unresolvedCount || !onCheckStale) return
    let alive = true
    const forRaw = raw
    onCheckStale()
      .then((v) => { if (alive) setStaleFor({ raw: forRaw, stale: v }) })
      .catch(() => { if (alive) setStaleFor({ raw: forRaw, stale: false }) })
    return () => { alive = false }
  }, [raw, unresolvedCount, onCheckStale])
  const stale = staleFor?.raw === raw ? staleFor.stale : null

  const preview = useMemo(() => {
    if (!result?.ok) return null
    const d = result.draft
    const pilot = d.pilotId ? world.pilots.get(d.pilotId)?.name ?? d.pilotId : null
    const mech = d.mechId ? world.mechs.get(d.mechId)?.name ?? d.mechId : null
    const setKeys = Object.keys(d.sets)
    const weapons = setKeys.reduce((n, k) => n + (d.sets[k].mounts?.length ?? 0), 0)
    const backpacks = setKeys.filter((k) => d.sets[k].backpackId).length
    // ⚠ 模組與元件也要數（052-G E-1 實地驗收補上）。本段是 052-C 寫的，那時
    //   元件（052-D）與模組（052-G）都還不存在，於是一份**只有模組**的配裝在這裡
    //   會顯示成「武器 0 把」——看起來像貼了一個空的東西，而下一顆按鈕寫著
    //   「套用會取代你目前正在配的這一套」。預覽的用途就是讓人知道自己要換掉什麼，
    //   少數兩類等於在最需要它的那一刻失能。
    const modules = Object.values(d.modules ?? {}).filter(Boolean).length
    const components = setKeys.reduce((n, k) => n + (d.sets[k].mounts ?? []).reduce(
      (m, mt) => m + (mt.setup?.triggerComponentIds?.length ?? 0) + (mt.setup?.effectComponentIds?.length ?? 0), 0), 0)
    return { pilot, mech, sets: setKeys.length, weapons, backpacks, modules, components, name: d.name, note: d.note }
  }, [result, world])

  const apply = useCallback(() => {
    if (loading) return
    if (result?.ok) { onApply(result.draft); onClose() }
  }, [loading, result, onApply, onClose])

  return (
    <div
      // ⚠ z-[60]：手機底部 Tab Bar 與 BottomSheet 都是 z-50，而它們在 DOM 裡更後面
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      // 拖放掛在整個 overlay：它蓋滿視窗，檔案丟到哪裡都接得住（不會變成瀏覽器直接開那張圖）
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!dragging) setDragging(true)
      }}
      // ⚠ dragleave 在移到子元素時也會發：只有 relatedTarget 不在 overlay 裡（真的離開）才關
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="貼上分享碼或配裝圖"
        // ⚠ `ring-inset`：`hud-cut` 是 clip-path 切角，畫在外面的 ring 會被整圈剪掉
        className={`${HUD_PANEL} w-full max-w-lg p-4 sm:p-5 transition-shadow ${dragging ? 'ring-2 ring-inset ring-accent-cyan/70' : ''}`}
      >
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[15px] font-bold text-text-primary">貼上分享碼或配裝圖</h2>
          <button type="button" onClick={onClose} className="text-[12px] text-text-dim hover:text-text-primary cursor-pointer">
            關閉
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={raw}
          onChange={(e) => manualInput(e.target.value)}
          rows={3}
          autoFocus
          placeholder="把別人給你的連結或代碼整串貼進來；配裝圖也可以直接貼"
          className="w-full bg-bg-dark border border-border px-2.5 py-2 text-[12px] font-mono text-text-primary placeholder:text-text-dim focus:border-border-accent outline-none resize-none"
        />

        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="hud-cut-sm shrink-0 text-[12px] px-3 py-1.5 border border-border text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            選擇圖片
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''      // 清掉才能重選同一張圖（否則 change 不會再發）
              if (file) void handleImage(file)
            }}
          />
          <p className={`text-[11px] leading-snug ${dragging ? 'text-accent-cyan' : 'text-text-dim'}`}>
            也可以把配裝圖直接貼上（Ctrl+V）或拖進這個視窗
          </p>
        </div>

        {/* aria-live 區塊常駐、內容進出：螢幕閱讀器才會念出「正在讀取」與結果 */}
        <div aria-live="polite">
          {imageText && (
            <p className={`mt-2 text-[12px] leading-relaxed ${IMAGE_TONE_CLASS[imageText.tone]}`}>{imageText.text}</p>
          )}
        </div>

        {/* 空白時不給任何紅字：使用者還沒貼完就先被罵，是最沒必要的一種回饋 */}
        {raw.trim() && !result && (
          <p className="mt-3 text-[12px] text-text-dim">
            這段文字裡找不到分享碼。連結長得像 <span className="font-mono">…/simulator?b=…</span>，代碼則是一長串英數字。
          </p>
        )}

        {result && !result.ok && (
          <p className="mt-3 text-[12px] text-accent-red leading-relaxed">{result.message}</p>
        )}

        {result?.ok && preview && (
          <div className="mt-3 space-y-2">
            <div className="hud-cut-sm border border-border bg-bg-dark px-3 py-2 text-[12px] text-text-secondary leading-relaxed">
              {preview.name && <div className="text-[13px] text-text-primary font-bold mb-1">{preview.name}</div>}
              <div>
                <span className="text-text-dim">機師</span> {preview.pilot ?? '未選'}
                <span className="mx-2 text-border">·</span>
                <span className="text-text-dim">機甲</span> {preview.mech ?? '未選'}
              </div>
              <div className="mt-0.5">
                {preview.sets > 1 && <>{preview.sets} 套配裝<span className="mx-2 text-border">·</span></>}
                武器 {preview.weapons} 把
                {preview.backpacks > 0 && <><span className="mx-2 text-border">·</span>背包 {preview.backpacks}</>}
                {preview.modules > 0 && <><span className="mx-2 text-border">·</span>模組 {preview.modules} 顆</>}
                {preview.components > 0 && <><span className="mx-2 text-border">·</span>元件 {preview.components} 個</>}
              </div>
              {/* ⚠ 貼進來的碼帶備註卻不顯示，使用者會以為沒帶到（PLAN-052-L C-4）。
                  ⚠ 標「由分享者填寫」：這一段是**別人寫的字**，與上面那幾行本站算出來的
                     資料共用同一個框，不標的話會被讀成本站的判斷。 */}
              {preview.note && (
                <div className="mt-1.5 pt-1.5 border-t border-border/70">
                  <div className="text-[10px] text-text-dim leading-tight mb-0.5">備註（由分享者填寫）</div>
                  <p className="text-[12px] text-text-secondary leading-relaxed whitespace-pre-line">{preview.note}</p>
                </div>
              )}
            </div>

            {loading && (
              <p className="hud-cut-sm border border-border bg-bg-dark px-3 py-2 text-[12px] text-text-dim leading-relaxed">
                遊戲資料還在載入，先不能套用（現在算出來的「查不到」不作數）。
              </p>
            )}

            {!loading && unresolvedCount > 0 && (
              <div className="hud-cut-sm border border-accent-yellow/40 bg-accent-yellow/5 px-3 py-2 text-[12px] text-text-secondary leading-relaxed">
                {stale === true ? (
                  <>
                    有 {unresolvedCount} 項裝備在你這裡查不到，而<strong className="text-accent-yellow">你手上的遊戲資料不是最新的</strong>——
                    很可能是這一版剛上線的東西。建議先重新載入資料再套用。
                    {onReload && (
                      <button
                        type="button"
                        onClick={onReload}
                        className="ml-2 underline text-accent-cyan hover:text-accent-cyan/80 cursor-pointer"
                      >
                        重新載入資料
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    有 {unresolvedCount} 項裝備在站上查不到（
                    {[...new Set(result.unresolved.map((u) => SHARE_KIND_LABEL[u.kind]))].join('、')}
                    ），套用後那幾格會是空的。其餘內容都會照樣載入。
                  </>
                )}
              </div>
            )}

            {result.unmodeled.length > 0 && (
              <p className="text-[11px] text-text-dim leading-relaxed">
                這串代碼裡有 {result.unmodeled.length} 段本站目前讀不懂的內容（多半來自更新的版本），已略過。
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="hud-cut-sm text-[12px] px-3 py-1.5 border border-border text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!result?.ok || loading}
            className="hud-cut-sm text-[12px] px-3 py-1.5 border border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            套用這套配裝
          </button>
        </div>

        {/* 覆蓋警告放在按鈕下方而不是彈第二層確認：多一層點擊擋不住誤操作，
            只會讓每一次正常操作都多按一下 */}
        <p className="mt-2 text-[11px] text-text-dim text-right">套用會取代你目前正在配的這一套。</p>
      </div>
    </div>
  )
}
