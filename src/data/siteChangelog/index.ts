export type { ChangelogEntry, ChangelogMonth, ChangelogType } from './types'

import oct2026 from './2026-10'
import sep2026 from './2026-09'
import aug2026 from './2026-08'
import jul2026 from './2026-07'
import jun2026 from './2026-06'
import may2026 from './2026-05'
import type { ChangelogMonth } from './types'

// 依時間倒序排列（最新月份在前）
export const SITE_CHANGELOG: ChangelogMonth[] = [
  oct2026,
  sep2026,
  aug2026,
  jul2026,
  jun2026,
  may2026,
]
