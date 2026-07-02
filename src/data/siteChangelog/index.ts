export type { ChangelogEntry, ChangelogMonth, ChangelogType } from './types'

import jul2026 from './2026-07'
import jun2026 from './2026-06'
import may2026 from './2026-05'
import type { ChangelogMonth } from './types'

// 依時間倒序排列（最新月份在前）
export const SITE_CHANGELOG: ChangelogMonth[] = [
  jul2026,
  jun2026,
  may2026,
]
