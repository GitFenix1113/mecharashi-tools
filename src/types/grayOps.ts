// ─── 灰燼行動名單 ──────────────────────────────────────────────────────────────

export interface GrayOpsMechEntry {
  name: string
  version?: string
}

export interface GrayOpsRoster {
  companies: Record<string, GrayOpsMechEntry[]>
}
