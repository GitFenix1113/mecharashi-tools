import { useState } from 'react'
import type { PatchHalf, ArmamentRaid } from '../../data/patchVersions/types'
import AdminTimedActivityEditor, { weekdayInfo, toInputDate, fromInputDate } from './AdminTimedActivityEditor'
import { DEFAULT_HALF_WEEKS } from '../timeline/ganttGeometry'

// ── 共用小元件 ─────────────────────────────────────────────────────────────────

/** 動態字串列表編輯器（機師 / 機甲 / 選配等） */
function StringListEditor({
  values,
  onChange,
  placeholder,
  addLabel = '+ 新增',
}: {
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  addLabel?: string
}) {
  function update(idx: number, val: string) {
    onChange(values.map((v, i) => (i === idx ? val : v)))
  }

  return (
    <div className="space-y-1.5">
      {values.map((v, idx) => (
        <div key={idx} className="flex gap-1.5">
          <input
            type="text"
            value={v}
            onChange={e => update(idx, e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-bg-card border border-border rounded px-2 py-1 text-xs text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50 min-w-0"
          />
          <button
            type="button"
            onClick={() => onChange(values.filter((_, i) => i !== idx))}
            className="px-2 text-text-dim hover:text-accent-red transition-colors text-sm"
            title="刪除"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, ''])}
        className="text-[11px] text-accent-purple hover:text-accent-purple/80 transition-colors"
      >
        {addLabel}
      </button>
    </div>
  )
}

/** 武裝討伐子表單 */
function ArmamentRaidEditor({
  raids,
  onChange,
}: {
  raids: ArmamentRaid[]
  onChange: (raids: ArmamentRaid[]) => void
}) {
  function updateRaid(idx: number, patch: Partial<ArmamentRaid>) {
    onChange(raids.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  function removeRaid(idx: number) {
    onChange(raids.filter((_, i) => i !== idx))
  }

  function addWeapon(raidIdx: number) {
    const raid = raids[raidIdx]
    updateRaid(raidIdx, {
      weapons: [...(raid.weapons ?? []), ''],
      weaponPilots: [...(raid.weaponPilots ?? new Array(raid.weapons?.length ?? 0).fill('')), ''],
    })
  }

  function updateWeapon(raidIdx: number, wi: number, val: string) {
    const arr = (raids[raidIdx].weapons ?? []).map((v, i) => (i === wi ? val : v))
    updateRaid(raidIdx, { weapons: arr })
  }

  function updateWeaponPilot(raidIdx: number, wi: number, val: string) {
    const raid = raids[raidIdx]
    const base = raid.weaponPilots ?? new Array(raid.weapons?.length ?? 0).fill('')
    const arr = base.map((v: string, i: number) => (i === wi ? val : v))
    updateRaid(raidIdx, { weaponPilots: arr.some((v: string) => v) ? arr : undefined })
  }

  function removeWeapon(raidIdx: number, wi: number) {
    const raid = raids[raidIdx]
    const newWeapons = (raid.weapons ?? []).filter((_, i) => i !== wi)
    const newPilots = (raid.weaponPilots ?? []).filter((_, i) => i !== wi)
    updateRaid(raidIdx, {
      weapons: newWeapons.length ? newWeapons : undefined,
      weaponPilots: newPilots.some(v => v) ? newPilots : undefined,
    })
  }

  function addSubItem(idx: number, field: 'backpacks') {
    const raid = raids[idx]
    updateRaid(idx, { [field]: [...(raid[field] ?? []), ''] })
  }

  function updateSubItem(raidIdx: number, field: 'backpacks', itemIdx: number, val: string) {
    const raid = raids[raidIdx]
    const arr = (raid[field] ?? []).map((v, i) => (i === itemIdx ? val : v))
    updateRaid(raidIdx, { [field]: arr })
  }

  function removeSubItem(raidIdx: number, field: 'backpacks', itemIdx: number) {
    const raid = raids[raidIdx]
    updateRaid(raidIdx, { [field]: (raid[field] ?? []).filter((_, i) => i !== itemIdx) })
  }

  return (
    <div className="space-y-2">
      {raids.map((raid, idx) => (
        <div key={idx} className="bg-bg-dark border border-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              value={raid.name}
              onChange={e => updateRaid(idx, { name: e.target.value })}
              placeholder="關卡名稱（如：無名之輩）"
              className="flex-1 bg-bg-card border border-border rounded px-2 py-1 text-xs text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50"
            />
            <button
              type="button"
              onClick={() => removeRaid(idx)}
              className="text-text-dim hover:text-accent-red transition-colors text-sm w-6 text-center"
              title="刪除此關卡"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 ml-1">
            {/* 武器 + 專武機師 */}
            <div>
              <div className="text-[10px] text-text-dim mb-1 tracking-wider uppercase">武器掉落</div>
              <div className="space-y-1.5">
                {(raid.weapons ?? []).map((w, wi) => (
                  <div key={wi} className="border border-border/50 rounded-md p-2 bg-bg-card/30 space-y-1">
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={w}
                        onChange={e => updateWeapon(idx, wi, e.target.value)}
                        placeholder="武器名稱"
                        className="flex-1 bg-bg-card border border-border rounded px-2 py-0.5 text-[11px] text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50"
                      />
                      <button
                        type="button"
                        onClick={() => removeWeapon(idx, wi)}
                        className="text-text-dim hover:text-accent-red text-xs w-5"
                      >✕</button>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-text-dim shrink-0 w-12">專武機師</span>
                      <input
                        type="text"
                        value={raid.weaponPilots?.[wi] ?? ''}
                        onChange={e => updateWeaponPilot(idx, wi, e.target.value)}
                        placeholder="機師名稱（選填）"
                        className="flex-1 bg-bg-card border border-border/50 rounded px-2 py-0.5 text-[11px] text-accent-cyan placeholder-text-dim outline-none focus:border-accent-cyan/50"
                      />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addWeapon(idx)}
                  className="text-[10px] text-accent-cyan hover:text-accent-cyan/80 transition-colors"
                >+ 加武器</button>
              </div>
            </div>

            {/* 背包 */}
            <div>
              <div className="text-[10px] text-text-dim mb-1 tracking-wider uppercase">背包掉落</div>
              <div className="space-y-1">
                {(raid.backpacks ?? []).map((b, bi) => (
                  <div key={bi} className="flex gap-1">
                    <input
                      type="text"
                      value={b}
                      onChange={e => updateSubItem(idx, 'backpacks', bi, e.target.value)}
                      placeholder="背包名稱"
                      className="flex-1 bg-bg-card border border-border rounded px-2 py-0.5 text-[11px] text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50"
                    />
                    <button
                      type="button"
                      onClick={() => removeSubItem(idx, 'backpacks', bi)}
                      className="text-text-dim hover:text-accent-red text-xs w-5"
                    >✕</button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addSubItem(idx, 'backpacks')}
                  className="text-[10px] text-accent-cyan hover:text-accent-cyan/80 transition-colors"
                >+ 加背包</button>
              </div>
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...raids, { name: '' }])}
        className="text-[11px] text-accent-purple hover:text-accent-purple/80 transition-colors"
      >
        + 新增武裝討伐關卡
      </button>
    </div>
  )
}

// ── 區塊標頭 ──────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold text-text-dim tracking-[3px] uppercase mb-2 mt-5 pt-4 border-t border-border first:mt-0 first:pt-0 first:border-t-0">
      {children}
    </div>
  )
}

// ── 日期輸入（含星期顯示 + 週四警告） ─────────────────────────────────────────

function DateField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const wd = weekdayInfo(value)
  return (
    <div>
      <label className="text-xs text-text-dim block mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={value ? toInputDate(value) : ''}
          onChange={e => onChange(e.target.value ? fromInputDate(e.target.value) : '')}
          className="bg-bg-card border border-border rounded px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-purple/50"
        />
        {wd && (
          <span className={`text-xs font-bold ${wd.isThur ? 'text-accent-green' : 'text-accent-red'}`}>
            {wd.label}{!wd.isThur && ' ⚠ 非週四'}
          </span>
        )}
      </div>
    </div>
  )
}

// ── 主元件 ────────────────────────────────────────────────────────────────────

interface Props {
  value: PatchHalf
  onChange: (value: PatchHalf) => void
}

type ActivityTab = 'cn' | 'tw'
const ACTIVITY_TABS: { key: ActivityTab; label: string }[] = [
  { key: 'cn', label: '陸服活動' },
  { key: 'tw', label: '台服活動' },
]

export default function AdminHalfEditorPanel({ value, onChange }: Props) {
  // 純檢視狀態（看哪一服），不進 formData —— 切個頁籤不該讓版本文件變成「有未存變更」
  const [activityTab, setActivityTab] = useState<ActivityTab>('cn')

  function update(patch: Partial<PatchHalf>) {
    onChange({ ...value, ...patch })
  }

  const pilots        = value.pilots        ?? []
  const mechs         = value.mechs         ?? []
  const pilotSel      = value.pilotSelection ?? []
  const mechSel       = value.mechSelection  ?? []
  const armament      = value.armamentRaids  ?? []
  const bpPilots      = value.battlePass?.pilots ?? []
  const bpMechs       = value.battlePass?.mechs  ?? []
  const cnActivities  = value.cnActivities   ?? []
  const twActivities  = value.twActivities   ?? []

  return (
    <div>
      {/* 起始日 */}
      <SectionLabel>起始日</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DateField
          label="陸服起始日（cnDate）"
          value={value.cnDate}
          onChange={v => update({ cnDate: v })}
        />
        <div>
          <DateField
            label="台服起始日（twDate）"
            value={value.twDate ?? ''}
            onChange={v => update({ twDate: v || undefined })}
          />
          <label className="flex items-center gap-2 mt-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value.twIsPredicted ?? false}
              onChange={e => update({ twIsPredicted: e.target.checked || undefined })}
              className="accent-accent-yellow"
            />
            <span className="text-xs text-text-dim">預測值（台服日期未確認）</span>
          </label>
        </div>
      </div>

      {/* 半版本長度：留空即慣例的 3 週，只有例外才要填 */}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-text-secondary">本半版本長度</span>
        <input
          type="number"
          min={1}
          max={12}
          value={value.weeks ?? ''}
          placeholder={String(DEFAULT_HALF_WEEKS)}
          onChange={e => {
            const v = e.target.value.trim()
            update({ weeks: v === '' ? undefined : Math.max(1, parseInt(v) || DEFAULT_HALF_WEEKS) })
          }}
          className="w-16 bg-bg-card border border-border rounded px-2 py-1 text-xs text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50"
        />
        <span className="text-xs text-text-dim">
          週 —— 留空即預設 {DEFAULT_HALF_WEEKS} 週。
          <strong className="text-text-secondary">上半通常不必填</strong>：它的長度直接由下半起始日算出來，
          比慣例可靠；這一格只在算不出來時才生效。
        </span>
      </div>
      <p className="mt-1 text-[10px] text-text-dim">
        跨版本的活動（例如 6 週戰令跨進下個版本）不會把週軸拉長，長條會在版本結束處切平 ——
        拉長會讓甘特顯示出不屬於這個版本的週次。
      </p>

      {/* 機師 / 機甲 */}
      <SectionLabel>新卡池</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <div className="text-xs text-text-secondary mb-2">機師（新角色池）</div>
          <StringListEditor
            values={pilots}
            onChange={v => update({ pilots: v.length ? v : undefined })}
            placeholder="機師名稱"
            addLabel="+ 新增機師"
          />
        </div>
        <div>
          <div className="text-xs text-text-secondary mb-2">機甲（新機甲池）</div>
          <StringListEditor
            values={mechs}
            onChange={v => update({ mechs: v.length ? v : undefined })}
            placeholder="機甲名稱"
            addLabel="+ 新增機甲"
          />
        </div>
      </div>

      {/* 角雕特遣 / 跨域海運（選配池） */}
      <SectionLabel>選配池</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <div className="text-xs text-text-secondary mb-2">角雕特遣（pilotSelection）</div>
          <StringListEditor
            values={pilotSel}
            onChange={v => update({ pilotSelection: v.length ? v : undefined })}
            placeholder="機師名稱"
            addLabel="+ 新增機師"
          />
        </div>
        <div>
          <div className="text-xs text-text-secondary mb-2">跨域海運（mechSelection）</div>
          <StringListEditor
            values={mechSel}
            onChange={v => update({ mechSelection: v.length ? v : undefined })}
            placeholder="機甲名稱"
            addLabel="+ 新增機甲"
          />
        </div>
      </div>

      {/* 武裝討伐 */}
      <SectionLabel>武裝討伐</SectionLabel>
      <ArmamentRaidEditor
        raids={armament}
        onChange={v => update({ armamentRaids: v.length ? v : undefined })}
      />

      {/* 戰令 */}
      <SectionLabel>戰令</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <div className="text-xs text-text-secondary mb-2">角色選項</div>
          <StringListEditor
            values={bpPilots}
            onChange={v => update({ battlePass: { ...value.battlePass, pilots: v.length ? v : undefined } })}
            placeholder="機師名稱"
            addLabel="+ 新增"
          />
        </div>
        <div>
          <div className="text-xs text-text-secondary mb-2">機甲選項</div>
          <StringListEditor
            values={bpMechs}
            onChange={v => update({ battlePass: { ...value.battlePass, mechs: v.length ? v : undefined } })}
            placeholder="機甲名稱"
            addLabel="+ 新增"
          />
        </div>
      </div>

      {/* 甘特圖活動 —— 陸服／台服分頁。
          兩邊各有近十筆卡片，上下疊起來要捲很久才碰得到第二組；而編輯時
          幾乎不會同時動兩服（一次補一邊的檔期）。分頁把捲動距離砍半。
          筆數印在頁籤上，否則被收起來的那一邊有沒有東西完全看不出來。 */}
      <SectionLabel>甘特圖活動</SectionLabel>
      <div className="flex border-b border-border mb-4">
        {ACTIVITY_TABS.map(({ key, label }) => {
          const count = (key === 'cn' ? cnActivities : twActivities).length
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActivityTab(key)}
              className={`px-4 py-2 text-[13px] font-medium transition-colors border-b-2 -mb-px ${
                activityTab === key
                  ? 'text-accent-purple border-accent-purple'
                  : 'text-text-dim border-transparent hover:text-text-secondary'
              }`}
            >
              {label}
              <span className="ml-1.5 text-[11px] opacity-70">{count}</span>
            </button>
          )
        })}
      </div>
      {activityTab === 'cn' ? (
        <AdminTimedActivityEditor
          label="陸服活動（cnActivities）"
          activities={cnActivities}
          onChange={v => update({ cnActivities: v.length ? v : undefined })}
        />
      ) : (
        <AdminTimedActivityEditor
          label="台服活動（twActivities）"
          activities={twActivities}
          onChange={v => update({ twActivities: v.length ? v : undefined })}
        />
      )}
    </div>
  )
}
