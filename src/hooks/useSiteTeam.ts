import { useEffect, useState } from 'react'
import { getSiteTeamProfiles } from '../lib/userApi'
import type { SiteTeamMember } from '../types'

let _cache: SiteTeamMember[] | null = null

interface SiteTeam {
  owners: SiteTeamMember[]
  admins: SiteTeamMember[]
  /** 故事館協作編輯（PLAN-042-H） */
  loreEditors: SiteTeamMember[]
}

const EMPTY: SiteTeam = { owners: [], admins: [], loreEditors: [] }

const groupByRole = (profiles: SiteTeamMember[]): SiteTeam => ({
  owners:      profiles.filter(p => p.role === 'OWNER'),
  admins:      profiles.filter(p => p.role === 'ADMIN'),
  loreEditors: profiles.filter(p => p.role === 'LORE_EDITOR'),
})

export function useSiteTeam() {
  const [team, setTeam] = useState<SiteTeam>(() => (_cache ? groupByRole(_cache) : EMPTY))
  const [loading, setLoading] = useState(_cache === null)

  useEffect(() => {
    if (_cache !== null) return
    getSiteTeamProfiles()
      .then(profiles => {
        _cache = profiles
        setTeam(groupByRole(profiles))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return { ...team, loading }
}
