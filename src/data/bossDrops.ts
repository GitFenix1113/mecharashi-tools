/**
 * 元件 BOSS 掉落 — 工具函式
 *
 * PLAN-025 起，掉落資料改存於各元件文件的 `dropStages` 欄位（Firestore，後台可編輯），
 * 不再使用本檔的靜態索引。本檔僅保留與掉落顯示相關的純函式。
 * 圖片路徑規則：/images/components/Stage{N}_Boss/character_{N}_{bossNum}.png
 */

import type { Component, StageDrop } from '../types'

export type { StageDrop }

/** 取得 BOSS 頭像路徑 */
export function getBossImagePath(stage: number, bossNum: number): string {
  return `/images/components/Stage${stage}_Boss/character_${stage}_${bossNum}.png`
}

/** 取得元件的掉落關卡（依 stage 由小到大排序） */
export function getComponentDrops(comp: Component): StageDrop[] {
  return [...(comp.dropStages ?? [])].sort((a, b) => a.stage - b.stage)
}

/** 從一批元件蒐集所有出現過的關卡編號（已排序，供篩選器用） */
export function getAllStages(components: Component[]): number[] {
  const set = new Set<number>()
  for (const c of components) {
    for (const d of c.dropStages ?? []) set.add(d.stage)
  }
  return [...set].sort((a, b) => a - b)
}

/** 檢查元件是否有指定關卡的掉落 */
export function componentDropsFromStage(comp: Component, stage: number): boolean {
  return (comp.dropStages ?? []).some((d) => d.stage === stage)
}
