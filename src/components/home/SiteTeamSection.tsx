import AvatarDisplay from '../profile/AvatarDisplay'
import { useSiteTeam } from '../../hooks/useSiteTeam'
import type { SiteTeamMember } from '../../types'

function TeamCard({ profile }: { profile: SiteTeamMember }) {
  return (
    <div className="relative group cursor-default">
      <div className="rounded-full ring-2 ring-transparent group-hover:ring-accent-orange/60 transition-all duration-200">
        <AvatarDisplay profile={profile} size="md" />
      </div>
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity duration-150">
        <div className="bg-bg-dark border border-border rounded-lg px-3 py-2 text-xs text-left whitespace-nowrap shadow-lg">
          <div className="font-semibold text-text-primary">{profile.displayName}</div>
          {profile.gameNickname && <div className="text-text-dim mt-0.5">遊戲ID：{profile.gameNickname}</div>}
          {profile.gameServer && <div className="text-text-dim mt-0.5">伺服器：{profile.gameServer}</div>}
          {profile.guild && <div className="text-text-dim mt-0.5">遊戲公會：{profile.guild}</div>}
        </div>
      </div>
    </div>
  )
}

interface CommunityLink {
  label: string
  href: string
  qrSrc?: string
  icon: React.ReactNode
  accentColor: string
}

const COMMUNITY_LINKS: CommunityLink[] = [
  {
    label: 'LINE 社群',
    href: 'https://line.me/ti/g2/OMBj5aaclFFXMmhsj-XWRWg25QmrUX28WvnznQ?utm_source=invitation&utm_medium=link_copy&utm_campaign=default',
    qrSrc: `${import.meta.env.BASE_URL}line-qr.png`,
    accentColor: '#06C755',
    icon: (
      <svg viewBox="0 0 20 20" className="w-5 h-5 shrink-0" fill="none">
        <rect width="20" height="20" rx="4" fill="#06C755" />
        <path d="M10 4.5C6.41 4.5 3.5 6.91 3.5 9.9c0 2.65 2.35 4.87 5.52 5.31-.07.45-.27 1.06-.42 1.56.72-.39 3.38-2.02 4.63-3.45A5.7 5.7 0 0 0 16.5 9.9C16.5 6.91 13.59 4.5 10 4.5z" fill="white" />
      </svg>
    ),
  },
  {
    label: 'Discord 社群',
    href: 'https://discord.gg/bgQP4RDrKC',
    accentColor: '#5865F2',
    icon: (
      <svg viewBox="0 0 20 20" className="w-5 h-5 shrink-0" fill="none">
        <rect width="20" height="20" rx="4" fill="#5865F2" />
        <path d="M14.5 6.1a12 12 0 0 0-3-.93l-.13.27c-.5-.1-1-.16-1.37-.16s-.87.06-1.37.16L8.5 5.17a12 12 0 0 0-3 .93C4.04 8.86 3.6 11.54 3.8 14.2a12.1 12.1 0 0 0 3.7 1.87l.75-1.02a7.9 7.9 0 0 1-1.18-.57l.28-.22a8.6 8.6 0 0 0 7.3 0l.28.22c-.38.21-.78.4-1.18.57l.75 1.02a12.1 12.1 0 0 0 3.7-1.87c.24-2.97-.4-5.63-1.7-8.1zM7.88 12.75c-.66 0-1.2-.6-1.2-1.35s.53-1.35 1.2-1.35 1.21.6 1.2 1.35-.53 1.35-1.2 1.35zm4.24 0c-.66 0-1.2-.6-1.2-1.35s.53-1.35 1.2-1.35 1.2.6 1.2 1.35-.53 1.35-1.2 1.35z" fill="white" />
      </svg>
    ),
  },
]

function CommunityCard({ link }: { link: CommunityLink }) {
  return (
    <div className="relative group">
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
        style={{ color: link.accentColor }}
      >
        {link.icon}
        <span>{link.label}</span>
      </a>
      {link.qrSrc && (
        <div className="pointer-events-none absolute bottom-full left-0 mb-2 z-20 invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity duration-150">
          <div className="bg-bg-dark border border-border rounded-lg p-2 shadow-lg">
            <img src={link.qrSrc} alt={`${link.label} QR Code`} className="block" style={{ width: '300px', height: 'auto' }} draggable={false} />
            <p className="text-center text-[10px] text-text-dim mt-1">掃描加入{link.label}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SiteTeamSection() {
  const { owners, admins, loading } = useSiteTeam()

  if (loading || (owners.length === 0 && admins.length === 0)) return null

  return (
    <div className="flex flex-col gap-2.5">
      {owners.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-text-dim text-xs shrink-0">網站程式碼維護：</span>
          <div className="flex gap-2">
            {owners.map(p => <TeamCard key={p.uid} profile={p} />)}
          </div>
        </div>
      )}
      {admins.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-text-dim text-xs shrink-0">攻略作者/資料彙整者：</span>
          <div className="flex gap-2">
            {admins.map(p => <TeamCard key={p.uid} profile={p} />)}
          </div>
        </div>
      )}
      <div className="flex items-center gap-3">
        <span className="text-text-dim text-xs shrink-0">加入社群：</span>
        <div className="flex gap-4">
          {COMMUNITY_LINKS.map(link => (
            <CommunityCard key={link.label} link={link} />
          ))}
        </div>
      </div>
    </div>
  )
}
