// 劇情的閱讀進度（PLAN-042-I A-3）：上次讀到哪一關、哪幾關讀完了。
//
// 只存在這台瀏覽器的 localStorage（計畫書決策五）：個人便利功能，不花 Firestore read、不必登入。
// 讀不到（無痕視窗、被清掉、storage 會丟例外）就當沒讀過，頁面照常運作——所以每一次讀寫都包 try/catch，
// 而且壞掉的 JSON 不會讓整份進度變成例外，只會被當成空的重新開始。
//
// 整份放在一個鍵裡：{ [書 ID]: { last, read[] } }。43 本、每本最多 28 關，幾 KB 而已。
// 關卡 key 是遊戲設定 ID，改版重跑匯入也不會變；萬一某一關被拿掉，殘留的 key 由讀的那一端過濾（readCount 的 valid）。

export const STORY_PROGRESS_KEY = 'mecharashi_story_progress'

export interface BookProgress {
  /** 上次讀到的關卡 key（明確選過的那一關，見 StoryBookPage 的記錄時機） */
  last: string | null
  /** 讀完的關卡 key（關末出現在畫面上） */
  read: string[]
}

type ProgressMap = Record<string, BookProgress>
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const EMPTY: BookProgress = Object.freeze({ last: null, read: [] }) as BookProgress

/** 只收形狀對的那幾本；任何一本長歪了就丟掉那一本，不連累其他本 */
function sanitize(raw: unknown): ProgressMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ProgressMap = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const { last, read } = v as { last?: unknown; read?: unknown }
    out[id] = {
      last: typeof last === 'string' ? last : null,
      read: Array.isArray(read) ? read.filter((k): k is string => typeof k === 'string') : [],
    }
  }
  return out
}

/**
 * 建一份進度存取器。storage 用 getter 注入：測試給假的，前台給 localStorage；
 * getter 本身丟例外（某些瀏覽器設定下光是碰 window.localStorage 就會丟）也當作沒有 storage。
 */
export function createStoryProgress(getStorage: () => StorageLike | null) {
  let cache: ProgressMap | null = null
  let version = 0
  const listeners = new Set<() => void>()

  const storage = (): StorageLike | null => {
    try { return getStorage() } catch { return null }
  }
  const load = (): ProgressMap => {
    if (cache) return cache
    try {
      const raw = storage()?.getItem(STORY_PROGRESS_KEY)
      cache = raw ? sanitize(JSON.parse(raw)) : {}
    } catch {
      cache = {}
    }
    return cache
  }
  const save = (next: ProgressMap) => {
    cache = next
    version++
    try { storage()?.setItem(STORY_PROGRESS_KEY, JSON.stringify(next)) } catch { /* 寫不進去：這次工作階段照樣記在記憶體裡 */ }
    listeners.forEach((fn) => fn())
  }

  return {
    progressOf(bookId: string): BookProgress {
      return load()[bookId] ?? EMPTY
    },
    /** 記下「上次讀到這一關」 */
    visit(bookId: string, key: string): void {
      const all = load()
      const cur = all[bookId] ?? EMPTY
      if (cur.last === key) return
      save({ ...all, [bookId]: { ...cur, last: key } })
    },
    /** 記下「這一關讀完了」（重複呼叫不會重複寫） */
    markRead(bookId: string, key: string): void {
      const all = load()
      const cur = all[bookId] ?? EMPTY
      if (cur.read.includes(key)) return
      save({ ...all, [bookId]: { ...cur, read: [...cur.read, key] } })
    },
    /** 讀完幾關。給了 valid（這本書現有的關卡 key）就只數還存在的 */
    readCount(bookId: string, valid?: ReadonlySet<string>): number {
      const { read } = load()[bookId] ?? EMPTY
      return valid ? read.filter((k) => valid.has(k)).length : read.length
    },
    /** useSyncExternalStore 用：寫入一次 version 就加一 */
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    getVersion: (): number => version,
  }
}

export type StoryProgressStore = ReturnType<typeof createStoryProgress>

/** 前台用的那一份。localStorage 不存在（node、SSR）時回 null，不在模組載入時碰 window */
export const storyProgress = createStoryProgress(() => (typeof localStorage === 'undefined' ? null : localStorage))
