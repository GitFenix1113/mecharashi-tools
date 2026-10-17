// 哪幾台機甲有卡池動態（PLAN-042-B Phase J）：src/data/gachaFx/<wap>.json 有檔就有。
//
// 用 import.meta.glob 的 lazy 模式：名單在打包時就定了（同步查得到，不必先打一個 404 去試），
// 資料本身各自切成一個 chunk，打開鑑賞才下載。新增一台＝跑 scripts/build-gacha-fx.mjs 產出那台的 JSON，這裡不用改。

import type { GachaFxData } from './gachaFxTypes'

const loaders = import.meta.glob<GachaFxData>('../../../data/gachaFx/*.json', { import: 'default' })
const byWap = new Map(Object.entries(loaders).map(([path, load]) => [path.replace(/^.*\/(\w+)\.json$/, '$1'), load]))

/** 這台（遊戲 ID，例 '2054'）有沒有卡池動態 */
export function hasGachaFx(wap: string | undefined): wap is string {
  return !!wap && byWap.has(wap)
}

export function loadGachaFx(wap: string): Promise<GachaFxData> {
  const load = byWap.get(wap)
  if (!load) return Promise.reject(new Error(`沒有 ${wap} 的卡池動態`))
  return load()
}
