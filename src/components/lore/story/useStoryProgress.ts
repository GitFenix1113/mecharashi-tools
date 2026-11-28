import { useSyncExternalStore } from 'react'
import { storyProgress, type BookProgress } from './storyProgress'

/**
 * 某一本的閱讀進度，寫入後自動重畫（PLAN-042-I B-5）。
 * storyProgress.ts 刻意不碰 React（node --test 要能直接跑），訂閱接在這一層。
 */
export function useStoryProgress(bookId: string): BookProgress {
  useSyncExternalStore(storyProgress.subscribe, storyProgress.getVersion, storyProgress.getVersion)
  return storyProgress.progressOf(bookId)
}

/** 館首頁用：任何一本有寫入就重畫（只需要讀完幾關的數字） */
export function useStoryProgressVersion(): number {
  return useSyncExternalStore(storyProgress.subscribe, storyProgress.getVersion, storyProgress.getVersion)
}
