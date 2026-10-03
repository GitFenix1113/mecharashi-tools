export type ChangelogType = 'feat' | 'fix' | 'perf' | 'style' | 'refactor'

export interface ChangelogEntry {
  date: string   // YYYY-MM-DD
  type: ChangelogType
  summary: string
  /**
   * 功能已合併、但入口還收著（例如 2026-10-03 起的機師故事館，見 src/hooks/useLoreEntry.ts）：
   * 條目先寫好、**不顯示**。功能正式公開時拿掉這個旗標，並把 date 改成公開日。
   */
  unreleased?: boolean
}

export interface ChangelogMonth {
  month: string  // YYYY-MM
  entries: ChangelogEntry[]
}
