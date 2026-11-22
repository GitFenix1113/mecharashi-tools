// 劇情故事館的資料入口：目錄同步可得、每本書 lazy 載入。
//
// 比照 gachaFxRegistry：import.meta.glob 的 lazy 模式讓「有哪些書」在打包時就定了，
// 每本各切成一個 chunk（檔名帶雜湊、可長期快取），打開那一章才下載。不進 Firestore，0 read。
// 新增或改版＝重跑 scripts/import-story.mjs --write，這裡不用改。

import catalogJson from '../../../data/story/index.json'
import type { StoryBook, StoryCatalog, StoryCatalogEntry, StoryKind } from './storyTypes'

export const STORY_CATALOG = catalogJson as StoryCatalog

const loaders = import.meta.glob<StoryBook>('../../../data/story/*/*.json', { import: 'default' })
/** 檔案路徑 main/3.json ⇔ 書 ID main-3 */
const byId = new Map(
  Object.entries(loaders).map(([p, load]) => [p.replace(/^.*\/story\/([a-z]+)\/(\d+)\.json$/, '$1-$2'), load]),
)

export function hasStoryBook(id: string | undefined): id is string {
  return !!id && byId.has(id)
}

export function loadStoryBook(id: string): Promise<StoryBook> {
  const load = byId.get(id)
  if (!load) return Promise.reject(new Error(`沒有 ${id} 這本劇情`))
  return load()
}

export const STORY_KIND_LABEL: Record<StoryKind, string> = {
  main: '主線劇情',
  event: '活動劇情',
  memory: '機師回憶',
}

export const storyEntry = (id: string | undefined): StoryCatalogEntry | undefined =>
  id ? STORY_CATALOG.books.find((b) => b.id === id) : undefined

/** 同一種類裡的上一本／下一本（目錄已依種類與設定 ID 排好） */
export function storyNeighbors(id: string): { prev?: StoryCatalogEntry; next?: StoryCatalogEntry } {
  const cur = storyEntry(id)
  if (!cur) return {}
  const same = STORY_CATALOG.books.filter((b) => b.kind === cur.kind)
  const i = same.findIndex((b) => b.id === id)
  return { prev: same[i - 1], next: same[i + 1] }
}

/** 卡片與連結上的顯示名：主線「Chapter-II 獵豹式物流事故」、其餘直接用名稱 */
export const storyDisplayName = (b: Pick<StoryCatalogEntry, 'kind' | 'title' | 'name'>): string =>
  b.kind === 'main' ? `${b.title} ${b.name}` : b.name
