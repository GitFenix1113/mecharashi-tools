// ── 寫入預算熔斷器（PLAN-046 決策七）────────────────────────────────────────
//
// 目標：**統計自己壞掉可以，但不可以拖累網站，也不可以無聲無息地燒錢。**
//
// 做法上刻意不引進任何新服務：analyticsDaily 這份文件本來每次就要寫，順手加一個
// `writes` 欄位自增，它就是當日寫入次數的權威來源 —— 不需要 KV（免費層每日只有
// 1,000 次寫入，per-request 計數根本不夠用），更不需要 Durable Objects（要付費方案）。
//
// 預算取向（2026-08-08 修訂）：從「省額度」改為「資料完整優先」，預設 50,000。
// 理由是低預算會在**流量暴增日**觸發熔斷 —— 中國宣傳鋪開、被大站轉發、遊戲改版
// 當天 —— 而那些正是最想知道「多少人來、看什麼」的日子。費用面完全不構成理由：
// 單日 50,000 次寫入超出免費額度的部分僅約 US$0.05。
// 第一道通知請用 Firebase 用量告警（建議設 20,000），熔斷器只當防惡意攻擊的最後防線。

import { readCounterField } from './firestoreRest'
import type { ServiceAccount } from './gcpAuth'

const DEFAULT_BUDGET = 50000

/**
 * isolate 層級的近似計數。
 *
 * Worker 會有多個 isolate 各自持有一份，所以 `known + localSince` 是**低估**
 * （看不到其他 isolate 剛寫的量）。對熔斷器而言這個誤差方向可以接受：最壞情況是
 * 稍微超過預算才跳脫，而預算本身已經留了很大餘裕。要精確就得用 Durable Objects，
 * 為了一個保險裝置付月費不划算。
 */
let cache = { dateKey: '', known: 0, knownAt: 0, localSince: 0 }

/** 已經為哪一天寫過 truncatedAt 標記（同一天只標一次）。 */
let truncatedMarkedFor = ''

export function budgetLimit(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUDGET
}

/**
 * 依「離預算多遠」決定回查間隔：平時很省，逼近時才查得勤。
 *
 * 正常情況（離預算很遠）每個 isolate 10 分鐘查一次，以約 10 個活躍 isolate 估
 * 約 1,440 reads／日，佔免費讀取額度 50,000 的 2.9%，實質成本為 0。
 */
function recheckTtl(est: number, limit: number): number {
  if (est < limit * 0.5) return 600_000 // 10 分鐘
  if (est < limit * 0.8) return 120_000 // 2 分鐘
  return 30_000
}

/**
 * 這次請求是否放行寫入。
 *
 * 讀取失敗一律**放行**：熔斷器讀不到計數時若選擇擋下，等於讓一個輔助裝置的故障
 * 變成統計的全面停擺 —— 那比偶爾超一點預算糟得多。
 */
export async function shouldWrite(
  sa: ServiceAccount,
  token: string,
  dayKey: string,
  limit: number,
): Promise<boolean> {
  if (cache.dateKey !== dayKey) {
    cache = { dateKey: dayKey, known: 0, knownAt: 0, localSince: 0 }
  }
  const est = cache.known + cache.localSince
  if (Date.now() - cache.knownAt > recheckTtl(est, limit)) {
    try {
      cache.known = await readCounterField(sa, token, 'analyticsDaily', dayKey, 'writes')
      cache.knownAt = Date.now()
      cache.localSince = 0
    } catch {
      cache.knownAt = Date.now() // 避免讀取一直失敗時每個請求都重試
      return true
    }
  }
  return cache.known + cache.localSince < limit
}

/** 記下本 isolate 剛寫了幾份文件。 */
export function noteWrites(n: number): void {
  cache.localSince += n
}

/**
 * 這一天是否還需要寫 truncatedAt 標記。
 *
 * 為什麼一定要標：**最危險的不是熔斷，是熔斷了但報表看不出來。**
 * 若某天下午三點熔斷、之後資料全丟，儀表板卻照樣畫出一條完整曲線，
 * 你會拿一個「看起來正常但少了半天」的數字去做決策 —— 那比沒有統計更糟。
 * 標記後由後台把該日資料點改成紅色虛線，並自動排除在趨勢與 TOP N 之外。
 */
export function needsTruncatedMark(dayKey: string): boolean {
  if (truncatedMarkedFor === dayKey) return false
  truncatedMarkedFor = dayKey
  return true
}
