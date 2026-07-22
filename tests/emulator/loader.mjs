// PLAN-030 模擬器整合測試：Node resolve hook
//
// 兩件事：
// ① extensionless import 補完 —— src/ 內的 `from '../firebase'`、`from '../../types'`
//    是 Vite 慣例，Node ESM 要求顯式副檔名。先試原樣，失敗再補 .ts，再試 /index.ts。
// ② firebase 替身 —— src/lib/firebase.ts 用 import.meta.env（Vite 專屬，Node 下是
//    undefined 取屬性直接 TypeError）。凡解析結果落在該檔，一律改給
//    tests/emulator/firebase-stub.ts（連本機模擬器的同名匯出）。
//    這讓 cascadeDelete.ts / changeHistory.ts 等**待測模組原封不動**——
//    測的是真正上線的程式，不是為了測試而複製的版本。

const STUB_URL = new URL('./firebase-stub.ts', import.meta.url).href

const RETRYABLE = new Set([
  'ERR_MODULE_NOT_FOUND',
  'ERR_UNSUPPORTED_DIR_IMPORT',
])

export async function resolve(specifier, context, nextResolve) {
  let resolved
  try {
    resolved = await nextResolve(specifier, context)
  } catch (err) {
    if (!RETRYABLE.has(err?.code)) throw err
    try {
      resolved = await nextResolve(`${specifier}.ts`, context)
    } catch {
      resolved = await nextResolve(`${specifier}/index.ts`, context)
    }
  }
  if (resolved.url.endsWith('/src/lib/firebase.ts')) {
    return { ...resolved, url: STUB_URL, shortCircuit: true }
  }
  return resolved
}
