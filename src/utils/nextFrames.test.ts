// nextFrames —— 背景分頁不觸發 rAF 時的逾時退場
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這支測試的唯一主角是「rAF 永遠不來」那條路：站上四處匯出圖都靠它才不會卡死。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextFrames } from './nextFrames.ts'

/** 暫時裝上一個假的 requestAnimationFrame，跑完還原。 */
function withRaf<T>(impl: ((cb: FrameRequestCallback) => number) | null, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as { requestAnimationFrame?: unknown }
  const saved = g.requestAnimationFrame
  if (impl) g.requestAnimationFrame = impl
  else delete g.requestAnimationFrame
  return fn().finally(() => {
    if (saved === undefined) delete g.requestAnimationFrame
    else g.requestAnimationFrame = saved
  })
}

test('幀正常送達時走 rAF 那條路，且剛好等 n 幀', async () => {
  let calls = 0
  await withRaf((cb) => { calls++; setTimeout(() => cb(0), 0); return calls }, async () => {
    await nextFrames(2)
  })
  assert.equal(calls, 2)
})

test('背景分頁（rAF 永遠不觸發）會逾時退場，而不是永遠不 resolve', async () => {
  // 這正是 bug 的本體：裸的雙層 rAF 在這個情境下 Promise 永遠不 resolve，
  // toPng 不會被呼叫、沒有錯誤，按鈕停在「匯出中…」。
  const t0 = Date.now()
  await withRaf(() => 1, async () => {          // 收下 callback 但**永遠不呼叫**
    await nextFrames(2, 30)
  })
  assert.ok(Date.now() - t0 >= 25, '應該等到逾時才放行')
})

test('逾時是 resolve 不是 reject —— 目的是讓匯出走完，不是讓它爆掉', async () => {
  await withRaf(() => 1, async () => {
    // 若改成 reject，背景分頁的匯出會變成「跳錯誤」而不是「拍到少一次重排的圖」，
    // 對使用者來說是更差的結果
    await assert.doesNotReject(() => nextFrames(1, 20))
  })
})

test('沒有 rAF 的環境（SSR／單元測試）不會卡住', async () => {
  await withRaf(null, async () => {
    await assert.doesNotReject(() => nextFrames(2, 500))
  })
})

test('n <= 0 直接放行，不排程任何一幀', async () => {
  let calls = 0
  await withRaf((cb) => { calls++; setTimeout(() => cb(0), 0); return calls }, async () => {
    await nextFrames(0)
  })
  assert.equal(calls, 0)
})
