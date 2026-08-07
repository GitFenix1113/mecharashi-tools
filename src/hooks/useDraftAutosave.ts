import { useEffect, useRef, useState } from 'react'
import {
  clearDraft, readDraft, writeDraft, markRestored, isRestored, unmarkRestored,
  shouldClearOnRevert, type StoredDraft,
} from '../lib/diag/draft'

// ── 後台編輯草稿自動暫存（PLAN-045 Phase D-1）─────────────────────────────────
//
// ⚠ 職責必須拆成兩個 hook，因為**編輯中的資料不在列表層**。
//
// 後台 12 個編輯頁的共同結構是：
//   列表元件   const [editing, setEditing] = useState<T | null>(null)
//   編輯器元件 function XxxEditPanel({ item }) { const [form, setForm] = useState({ ...item }) }
//
// 使用者打字改的是編輯器內部的 `form`；外層的 `editing` 從「打開編輯器」到「按下存檔」
// 之間**完全不變**。初版把 autosave 接在列表層監聽 `editing`，結果存下來的是
// 「打開編輯器那一刻的原始快照」——提示會正確跳出（確實有未存編輯），
// 但還原出來的是原始版本。這比沒有草稿更糟，因為它讓使用者以為救回來了。
//
// 故：
//   · useDraftWrite   — 接在**編輯器內部**，監聽 form，只負責寫
//   · useDraftRestore — 接在**列表層**，負責讀取殘留草稿、顯示提示、還原、存檔後清除
//
// 還原之所以能生效，是因為編輯器用 `useState({ ...item })` 從 prop 初始化：
// 列表層 setEditing(草稿) → 編輯器 mount → form 就是草稿內容。

/** 停止輸入多久之後才寫入 localStorage（毫秒）。 */
const DEBOUNCE_MS = 800

// ─── 寫入側（編輯器內部）──────────────────────────────────────────────────────

/**
 * 把編輯中的表單持續暫存到 localStorage。**在 EditPanel 內部呼叫。**
 *
 * @param kind   後台分頁識別（通常等於集合名，如 'modules'）
 * @param form   編輯器內部的表單 state
 * @param nameOf 從表單取顯示名稱，讓還原提示能說出「你在編輯《折光陣列》」
 *
 * 只在表單**與打開時的原始內容不同**時才寫入（dirty）。否則「點開看一眼就切走」
 * 也會留下草稿，下次進頁跳一個毫無意義的還原提示——那種雜訊會讓人很快學會無視它，
 * 連帶錯過真正需要還原的那次。
 */
export function useDraftWrite<T extends { id: string }>(
  kind: string,
  form: T,
  nameOf: (item: T) => string,
): void {
  // 打開編輯器當下的原始快照，作為 dirty 判斷的基準。
  // 在 render 期間直接寫 ref（不觸發 render，嚴格模式下重複執行也冪等）——
  // 用 useEffect 設定的話，第一次 debounce 會在基準就位前就觸發而誤判為 dirty。
  const baseline = useRef<{ id: string; snapshot: string } | null>(null)
  if (baseline.current === null || baseline.current.id !== form.id) {
    // 換了編輯對象 → 重設基準，並解除上一筆的還原保護
    // （保護只對「被還原的那一筆」有意義；每個 kind 只存一份草稿）
    if (baseline.current !== null) unmarkRestored(kind)
    baseline.current = { id: form.id, snapshot: JSON.stringify(form) }
  }

  // 本次掛載期間是否曾寫過草稿。用來區分兩種「form 與基準相同」的狀態：
  //   · 寫過 → 使用者改了又改回原樣 → 該清掉自己剛寫的那份
  //   · 沒寫過 → 只是打開看看（不該留草稿），或剛還原進來（草稿必須留著）
  const hasWritten = useRef(false)

  // nameOf 放 ref：呼叫端多半寫成 inline 箭頭函式，每次 render 都是新 reference，
  // 放進依賴陣列會讓 debounce 永遠重新計時而寫不進去（靜默失效，無任何錯誤訊息）。
  const nameOfRef = useRef(nameOf)
  nameOfRef.current = nameOf

  useEffect(() => {
    // debounce：大型表單（PilotAdmin 有 1500 行）每次按鍵都寫會明顯卡頓。
    // JSON.stringify 也只在計時器觸發時做一次，不是每次 render。
    const timer = setTimeout(() => {
      const current = JSON.stringify(form)
      if (current === baseline.current?.snapshot) {
        // 改了又改回原樣 → 清掉自己剛寫的那份，別留一份與現況相同的假草稿。
        // 但受還原保護的草稿不能碰：那是使用者剛救回來的內容，
        // 「還原後還沒動過」與「只是打開看看」在這裡長得一模一樣，錯清就是資料遺失。
        if (shouldClearOnRevert(hasWritten.current, isRestored(kind))) {
          clearDraft(kind)
          hasWritten.current = false
        }
        return
      }
      writeDraft<T>({
        kind,
        id: form.id,
        name: nameOfRef.current(form),
        savedAt: Date.now(),
        data: form,
      })
      hasWritten.current = true
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [kind, form])
}

// ─── 讀取側（列表層）──────────────────────────────────────────────────────────

export interface DraftRestore<T> {
  /** 進頁時偵測到的殘留草稿 */
  pending: StoredDraft<T> | null
  /** 取用草稿內容並收起提示。回傳值直接餵給 setEditing */
  restore: () => T
  /** 捨棄草稿（使用者按「捨棄」，或按下編輯器的「取消」） */
  discard: () => void
  /** 存檔成功後呼叫，清除草稿與提示 */
  commit: () => void
}

/**
 * 偵測並還原殘留草稿。**在列表元件呼叫。**
 *
 * **不自動套用**：偵測到就直接覆蓋使用者當前選取的項目，比丟失草稿更難解釋
 * （他明明點開的是 A，畫面卻變成昨天沒存完的 B）。一律問過再說。
 */
export function useDraftRestore<T>(kind: string): DraftRestore<T> {
  // lazy initializer：只在首次 render 讀 localStorage
  const [pending, setPending] = useState<StoredDraft<T> | null>(() => readDraft<T>(kind))

  return {
    pending,
    restore: () => {
      const data = pending!.data
      setPending(null)
      // 刻意**不**清 localStorage：還原後編輯器會 mount，useDraftWrite 接手續存。
      // 真正的清除時機是存檔成功（commit）或使用者明確捨棄（discard）。
      // 標記為受保護，避免「還原後還沒動過」被 dirty 判斷當成「沒改」而清掉。
      markRestored(kind)
      return data
    },
    discard: () => {
      clearDraft(kind)
      setPending(null)
    },
    commit: () => {
      clearDraft(kind)
      setPending(null)
    },
  }
}
