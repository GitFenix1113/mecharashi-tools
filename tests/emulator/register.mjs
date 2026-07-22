// PLAN-030 模擬器整合測試：module hooks 進入點
//
//   node --test --test-force-exit --import ./tests/emulator/register.mjs tests/emulator/suites/<suite>.test.ts
//
// --test-force-exit 不可省：firebase SDK 的常駐連線會讓事件迴圈不清空，
// 測試全過後 process 仍掛著不退出。
//
// 作用：註冊 loader.mjs 的 resolve hook，讓 Node 能直接載入 src/ 下的正式模組
// （extensionless import 補 .ts、src/lib/firebase.ts 重導向到模擬器替身）。
import { register } from 'node:module'

register('./loader.mjs', import.meta.url)
