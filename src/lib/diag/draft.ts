// ── 後台編輯草稿本機暫存（PLAN-045 Phase D-1）─────────────────────────────────
//
// 查明登出原因是手段，不讓維護者的編輯蒸發才是目的。
//
// 現況：12 個後台編輯頁的草稿全部只活在 React state
// （`const [editing, setEditing] = useState<T|null>(null)`），沒有任何本機暫存。
// 無論是被登出、寫入被拒、還是單純誤觸重整，填了半小時的數值一律歸零。
//
// 本檔是純儲存層（可單測、不依賴 React）；接線用的 hook 在 useDraftAutosave.ts。

const PREFIX = 'mecharashi_draft_'

/** 一份暫存草稿。 */
export interface StoredDraft<T = unknown> {
  /** 草稿所屬的後台分頁識別（通常等於集合名，如 'pilots'） */
  kind: string
  /** 被編輯項目的 id。用來偵測「草稿與目前選取的項目不是同一筆」 */
  id: string
  /** 顯示名稱，讓還原提示能說出「你在編輯《艾達》」而不是一串 id */
  name: string
  /** 暫存時間（ms epoch） */
  savedAt: number
  /** 編輯中的完整物件 */
  data: T
}

const isBrowser = (): boolean => typeof window !== 'undefined'

const keyOf = (kind: string): string => PREFIX + kind

/** 讀某個後台分頁的草稿。格式壞掉或欄位不齊一律當作沒有。 */
export function readDraft<T = unknown>(kind: string): StoredDraft<T> | null {
  if (!isBrowser()) return null
  try {
    const raw = window.localStorage.getItem(keyOf(kind))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredDraft<T>>
    if (!parsed || typeof parsed.id !== 'string' || parsed.data === undefined) return null
    return {
      kind,
      id: parsed.id,
      name: typeof parsed.name === 'string' ? parsed.name : parsed.id,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
      data: parsed.data as T,
    }
  } catch {
    return null
  }
}

/**
 * 寫入草稿。
 *
 * 配額滿時**靜默清掉自己的草稿再放棄**：草稿是為了防止資料遺失而存在，
 * 若它自己把 localStorage 撐爆，反而會誘發我們正在追查的儲存清除問題。
 * 寧可失去暫存能力，也不能讓暫存機制變成故障來源。
 */
export function writeDraft<T>(draft: StoredDraft<T>): void {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(keyOf(draft.kind), JSON.stringify(draft))
  } catch {
    try {
      window.localStorage.removeItem(keyOf(draft.kind))
    } catch {
      /* 連清除都失敗，只能放棄 */
    }
  }
}

/** 清除某個後台分頁的草稿（存檔成功、或使用者選擇捨棄時）。 */
export function clearDraft(kind: string): void {
  if (!isBrowser()) return
  try {
    window.localStorage.removeItem(keyOf(kind))
  } catch {
    /* 忽略 */
  }
  restoredKinds.delete(kind)
}

// ── 還原保護（PLAN-045）──────────────────────────────────────────────────────
//
// 使用者按下「還原」之後，那份草稿進入受保護狀態：**只能由存檔成功或明確捨棄清除**，
// 不再受自動 dirty 判斷影響。
//
// 沒有這層保護會有個很難察覺的資料遺失：還原後編輯器重新掛載，
// useDraftWrite 的 dirty 基準變成「草稿內容」本身 —— 若使用者還原後想先去查點東西
// 而切換分頁，dirty 判斷會認定「什麼都沒改」而把剛救回來的草稿清掉。
//
// module-scope 而非 localStorage：這是「本次瀏覽的操作狀態」，不需要跨分頁或跨 session。

const restoredKinds = new Set<string>()

/** 標記某分頁的草稿是還原來的（受保護）。 */
export const markRestored = (kind: string): void => { restoredKinds.add(kind) }

/** 該分頁的草稿是否受還原保護。 */
export const isRestored = (kind: string): boolean => restoredKinds.has(kind)

/** 解除保護但不刪草稿（切換編輯對象時用——保護只對還原的那一筆有意義）。 */
export const unmarkRestored = (kind: string): void => { restoredKinds.delete(kind) }

/**
 * 表單內容回到「打開編輯器時的基準值」時，是否該清掉草稿。
 *
 * 抽成純函式是因為這三種狀態在畫面上長得一模一樣，卻要有不同結果，
 * 而判斷錯的後果是**靜默的資料遺失**（初版沒有這個判斷、無條件 clearDraft，
 * 導致「還原後還沒動過就切走」會把剛救回來的內容清掉）：
 *
 *   · 寫過草稿 + 未受保護 → 使用者改了又改回原樣，清掉自己剛寫的那份（避免假草稿）
 *   · 沒寫過草稿          → 只是打開看看，本來就沒有草稿可清
 *   · 受還原保護          → 剛按過還原、還沒動過，**絕不可清**
 */
export function shouldClearOnRevert(hasWritten: boolean, restored: boolean): boolean {
  return hasWritten && !restored
}

/**
 * 目前是否存在任何未清除的草稿。
 *
 * 供登出診斷判斷「要不要在橫幅上說『你的編輯已保住』」——
 * 沒草稿卻這樣寫，只會讓使用者去找一個不存在的還原入口。
 */
export function hasAnyDraft(): boolean {
  if (!isBrowser()) return false
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(PREFIX)) return true
    }
  } catch {
    return false
  }
  return false
}

/** 列出所有草稿（供未來做一頁「未存草稿總覽」；目前僅測試與除錯使用）。 */
export function listDrafts(): StoredDraft[] {
  if (!isBrowser()) return []
  const out: StoredDraft[] = []
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      const d = readDraft(k.slice(PREFIX.length))
      if (d) out.push(d)
    }
  } catch {
    /* 忽略 */
  }
  return out.sort((a, b) => b.savedAt - a.savedAt)
}
