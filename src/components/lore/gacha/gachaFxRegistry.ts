// 誰有卡池動態（機甲 PLAN-042-B Phase J、機師 PLAN-042-A Phase J）：src/data/gachaFx/ 底下有檔就有。
//
//   機甲  gachaFx/<wap>.json              → 鍵 `<wap>`（例 '2054'）
//   機師  gachaFx/pilots/<gameId>.json    → 鍵 `pilots/<gameId>`（例 'pilots/10103174'）
//
// 用 import.meta.glob 的 lazy 模式：名單在打包時就定了（同步查得到，不必先打一個 404 去試），
// 資料本身各自切成一個 chunk，打開鑑賞才下載。新增一台／一位＝跑 scripts/build-gacha-fx.mjs 產出那份 JSON，這裡不用改。

import type { GachaFxData } from './gachaFxTypes'

const loaders = import.meta.glob<GachaFxData>('../../../data/gachaFx/**/*.json', { import: 'default' })
const byKey = new Map(Object.entries(loaders).map(([path, load]) => [path.replace(/^.*\/gachaFx\/(.+)\.json$/, '$1'), load]))

/** 機甲的動態鍵＝wap */
export const mechGachaFxKey = (wap: string | undefined): string | undefined => wap
/** 機師的動態鍵＝`pilots/<gameId>`（與機甲的 4 碼 wap 分開放，不靠位數區分） */
export const pilotGachaFxKey = (gameId: string | undefined): string | undefined => (gameId ? `pilots/${gameId}` : undefined)

/** 這個鍵（見上）有沒有卡池動態 */
export function hasGachaFx(key: string | undefined): key is string {
  return !!key && byKey.has(key)
}

export function loadGachaFx(key: string): Promise<GachaFxData> {
  const load = byKey.get(key)
  if (!load) return Promise.reject(new Error(`沒有 ${key} 的卡池動態`))
  return load()
}
