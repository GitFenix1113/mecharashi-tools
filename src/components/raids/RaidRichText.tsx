import { useState, type ReactNode } from 'react'
import type { RaidRefDict, RaidUnitEntry } from '../../types/boss'
import { parseRaidText } from '../../utils/raidView'

// ─── 武裝討伐的說明文字（PLAN-064 決策七）────────────────────────────────────
//
// 匯入端把遊戲標籤轉成 ⟦…⟧ 記號（見 src/types/boss.ts 的 RaidRefEntry 註解）。這裡畫成：
//   ⟦buf:…⟧／⟦main:…⟧／⟦terrain:…⟧ → 可點開說明的 [名稱]（字典在 stage.raid.refDict／boss.refDict）
//   ⟦unit:…⟧ → 單位名（字典在 stage.raid.unitDict）；名字是機轉時加虛線底線＝待校
//   ⟦em:…⟧ → 遊戲以顏色強調的數字
// 敵方 Buff 不在站上 buffs 集合，所以不走 EntityRef（ReferenceContext）：字典就在文件裡，點開即看。

export function PendingName({ children, pending, className = '' }: { children: ReactNode; pending?: boolean; className?: string }) {
  if (!pending) return <span className={className}>{children}</span>
  return (
    <span className={`border-b border-dashed border-text-dim/70 ${className}`} title="譯名待校（目前是簡轉繁暫譯）">
      {children}
    </span>
  )
}

function RefChip({ name, desc, refDict, unitDict, depth }: {
  name: string; desc?: string; refDict: RaidRefDict; unitDict?: Record<string, RaidUnitEntry>; depth: number
}) {
  const [open, setOpen] = useState(false)
  if (!desc || depth > 1) return <span className="text-accent-purple">[{name}]</span>
  return (
    <span className="relative inline">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        aria-expanded={open}
        className="text-accent-purple hover:text-accent-purple/80 underline decoration-dotted decoration-accent-purple/50 underline-offset-2 cursor-help"
      >
        [{name}]
      </button>
      {open && (
        <span className="block my-1 px-2.5 py-1.5 rounded border border-accent-purple/30 bg-bg-tooltip text-[12.5px] leading-relaxed text-text-secondary not-italic">
          <span className="font-bold text-accent-purple">{name}</span>：
          <RaidRichText text={desc} refDict={refDict} unitDict={unitDict} depth={depth + 1} />
        </span>
      )}
    </span>
  )
}

export function RaidRichText({ text, refDict = {}, unitDict, depth = 0 }: {
  text?: string | null
  refDict?: RaidRefDict
  unitDict?: Record<string, RaidUnitEntry>
  /** 說明裡再引用說明時的層數（防無限展開） */
  depth?: number
}) {
  if (!text) return null
  return (
    <>
      {parseRaidText(text).map((tk, i) => {
        switch (tk.t) {
          case 'text':
            return <span key={i}>{tk.v}</span>
          case 'em':
            return <span key={i} className="text-accent-red font-semibold">{tk.v}</span>
          case 'unit': {
            const u = unitDict?.[tk.key]
            return <PendingName key={i} pending={u?.pending} className="text-accent-orange">{u?.name ?? '特定單位'}</PendingName>
          }
          case 'ref': {
            const e = refDict[tk.key]
            return <RefChip key={i} name={tk.label ?? e?.name ?? '效果'} desc={e?.desc} refDict={refDict} unitDict={unitDict} depth={depth} />
          }
        }
      })}
    </>
  )
}
