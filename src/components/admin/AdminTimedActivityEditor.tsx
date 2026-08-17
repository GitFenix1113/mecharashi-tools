import type { TimedActivity, ActivityTypeId } from '../../data/patchVersions/types'
import { ACTIVITY_TYPE_OPTIONS, isKnownActivityType } from '../timeline/activityTypeRegistry'

/** 未登錄型別的哨兵值；選了它就用 typeLabel 自訂顯示名（新玩法零部署上線） */
const CUSTOM = '__custom__'

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六']

export function toInputDate(d: string) { return d.replace(/\//g, '-') }
export function fromInputDate(d: string) { return d.replace(/-/g, '/') }

export function weekdayInfo(dateStr: string): { label: string; isThur: boolean } | null {
  if (!dateStr || dateStr.length < 10) return null
  const d = new Date(toInputDate(dateStr))
  if (isNaN(d.getTime())) return null
  return { label: `週${WEEKDAY_ZH[d.getDay()]}`, isThur: d.getDay() === 4 }
}

export function computeEndDate(startDate: string, weeks: number | undefined): string {
  if (!startDate || startDate.length < 10 || !weeks || weeks < 1) return ''
  const d = new Date(toInputDate(startDate))
  if (isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + weeks * 7)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}/${m}/${dd}（週${WEEKDAY_ZH[d.getDay()]}）`
}

/**
 * 穩定識別子。甘特↔卡片連動與 React key 都靠它 ——
 * 純 index 在陣列重排後會讓選取狀態跳到別的活動身上。
 */
function makeActivityId(): string {
  return `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function emptyActivity(): TimedActivity {
  return { id: makeActivityId(), name: '', startDate: '', weeks: 1, type: 'skinGacha' }
}

interface Props {
  label: string
  activities: TimedActivity[]
  onChange: (activities: TimedActivity[]) => void
}

export default function AdminTimedActivityEditor({ label, activities, onChange }: Props) {
  function update(idx: number, patch: Partial<TimedActivity>) {
    onChange(activities.map((a, i) => {
      if (i !== idx) return a
      const next = { ...a, ...patch }
      // 不變式：沒有長度就畫不出甘特長條 → 一律隱藏。
      // 由寫入端補上而不是要求維護者記得勾 —— 忘了勾的後果是前台出現半成品。
      if (next.weeks === undefined) next.hidden = true
      return next
    }))
  }

  function remove(idx: number) {
    onChange(activities.filter((_, i) => i !== idx))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-text-secondary tracking-[2px] uppercase">
          {label}
        </span>
        <button
          type="button"
          onClick={() => onChange([...activities, emptyActivity()])}
          className="px-2 py-0.5 text-[11px] bg-accent-purple/15 text-accent-purple border border-accent-purple/30 rounded hover:bg-accent-purple/25 transition-colors"
        >
          + 新增
        </button>
      </div>

      {activities.length === 0 && (
        <div className="text-[11px] text-text-dim text-center py-3 border border-dashed border-border rounded-lg">
          尚無活動資料
        </div>
      )}

      <div className="space-y-2">
        {activities.map((act, idx) => {
          const wd = weekdayInfo(act.startDate)
          const end = computeEndDate(act.startDate, act.weeks)

          return (
            <div key={idx} className="bg-bg-dark border border-border rounded-lg p-3">
              {/* 行1：序號 + 名稱 + 刪除 */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] text-text-dim w-4 text-center flex-shrink-0">{idx + 1}</span>
                <input
                  type="text"
                  value={act.name}
                  onChange={e => update(idx, { name: e.target.value })}
                  placeholder="活動名稱（如：白夜凍鋒（復刻））"
                  className="flex-1 bg-bg-card border border-border rounded px-2 py-1 text-xs text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50 min-w-0"
                />
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  title="刪除此活動"
                  className="flex-shrink-0 text-text-dim hover:text-accent-red transition-colors text-sm w-6 text-center"
                >
                  ✕
                </button>
              </div>

              {/* 行2：類型 + 起始日 + 週數 */}
              <div className="flex flex-wrap items-center gap-2 ml-6">
                <select
                  value={isKnownActivityType(act.type) ? act.type : CUSTOM}
                  onChange={e => {
                    const raw = e.target.value
                    const patch: Partial<TimedActivity> = {}
                    if (raw === CUSTOM) {
                      // 保留原值當作自訂型別的起點；實際字串由下方輸入框改
                      patch.type = isKnownActivityType(act.type) ? '' : act.type
                    } else {
                      const t = raw as ActivityTypeId
                      patch.type = t
                      patch.typeLabel = undefined   // 登錄型別的顯示名以 registry 為準
                      if (t !== 'pilotMission') patch.pilots = undefined
                      if (t !== 'crossShipping') patch.mechs = undefined
                    }
                    update(idx, patch)
                  }}
                  className="bg-bg-card border border-border rounded px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent-purple/50"
                >
                  {ACTIVITY_TYPE_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                  <option value={CUSTOM}>＋ 其他（新玩法）</option>
                </select>

                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={act.startDate ? toInputDate(act.startDate) : ''}
                    onChange={e =>
                      update(idx, { startDate: e.target.value ? fromInputDate(e.target.value) : '' })
                    }
                    className="bg-bg-card border border-border rounded px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent-purple/50"
                  />
                  {wd && (
                    <span className={`text-[11px] font-bold ${wd.isThur ? 'text-accent-green' : 'text-accent-red'}`}>
                      {wd.label}{!wd.isThur && ' ⚠'}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={act.weeks ?? ''}
                    placeholder="—"
                    onChange={e => {
                      const v = e.target.value.trim()
                      update(idx, { weeks: v === '' ? undefined : Math.max(1, parseInt(v) || 1) })
                    }}
                    className="bg-bg-card border border-border rounded px-2 py-1 text-[11px] text-text-primary w-12 outline-none focus:border-accent-purple/50"
                  />
                  <span className="text-[11px] text-text-dim">週</span>
                  {end && (
                    <span className="text-[11px] text-text-dim">→ 結束：{end}</span>
                  )}
                  {act.weeks === undefined && (
                    <span className="text-[11px] text-accent-yellow">未填長度 → 前台不顯示</span>
                  )}
                </div>
              </div>

              {/* 行3（條件）：機師列表（pilotMission） */}
              {act.type === 'pilotMission' && (
                <div className="mt-2 ml-6">
                  <input
                    type="text"
                    value={(act.pilots ?? []).join('、')}
                    onChange={e =>
                      update(idx, {
                        pilots: e.target.value.split(/[、,，]+/).map(s => s.trim()).filter(Boolean),
                      })
                    }
                    placeholder="機師名稱，以「、」分隔（如：白夜凍鋒、十字線上的明光）"
                    className="w-full bg-bg-card border border-border rounded px-2 py-1 text-[11px] text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50"
                  />
                </div>
              )}

              {/* 行3（條件）：機甲列表（crossShipping） */}
              {act.type === 'crossShipping' && (
                <div className="mt-2 ml-6">
                  <input
                    type="text"
                    value={(act.mechs ?? []).join('、')}
                    onChange={e =>
                      update(idx, {
                        mechs: e.target.value.split(/[、,，]+/).map(s => s.trim()).filter(Boolean),
                      })
                    }
                    placeholder="機甲名稱，以「、」分隔"
                    className="w-full bg-bg-card border border-border rounded px-2 py-1 text-[11px] text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50"
                  />
                </div>
              )}

              {/* 行3（條件）：自選池的可選名單（角雕特遣／跨域海運） */}
              {(act.type === 'pilotMission' || act.type === 'crossShipping') && (
                <div className="mt-2 ml-6">
                  <input
                    type="text"
                    value={(act.selection ?? []).join('、')}
                    onChange={e => {
                      const arr = e.target.value.split(/[、,，]+/).map(s => s.trim()).filter(Boolean)
                      update(idx, { selection: arr.length ? arr : undefined })
                    }}
                    placeholder={act.type === 'pilotMission'
                      ? '這期可選的機師，以「、」分隔（如：佐伊、科林、維娜）'
                      : '這期可選的機甲，以「、」分隔（如：影武者、螣蛇、影子兔）'}
                    className="w-full bg-bg-card border border-border rounded px-2 py-1 text-[11px] text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50"
                  />
                  <p className="mt-0.5 text-[10px] text-text-dim">
                    名單寫在官方公告「活動內容」的括號裡。填在這裡而不是半版本層級的
                    「選配池」——同一半版本可能同時開兩個自選池（如復刻＋一般），
                    半版本層級只有一份會被迫共用。留空時前台仍會退回讀「選配池」的舊資料。
                  </p>
                </div>
              )}

              {/* 行3（條件）：未登錄型別的識別字與顯示名 */}
              {!isKnownActivityType(act.type) && (
                <div className="mt-2 ml-6 flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={act.type}
                    onChange={e => update(idx, { type: e.target.value.trim() })}
                    placeholder="型別識別字（英數，如 starVoyage）"
                    className="flex-1 min-w-[160px] bg-bg-card border border-border rounded px-2 py-1 text-[11px] text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50"
                  />
                  <input
                    type="text"
                    value={act.typeLabel ?? ''}
                    onChange={e => update(idx, { typeLabel: e.target.value || undefined })}
                    placeholder="顯示名（如：星海拓荒祭）"
                    className="flex-1 min-w-[160px] bg-bg-card border border-border rounded px-2 py-1 text-[11px] text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50"
                  />
                  <p className="w-full text-[10px] text-text-dim">
                    未登錄型別會以中性紫色虛線顯示。之後在 activityTypeRegistry 補一列給它配色即可，資料無需再動。
                  </p>
                </div>
              )}

              {/* 行4：獎勵 */}
              <div className="mt-2 ml-6">
                <input
                  type="text"
                  value={(act.rewards ?? []).join('、')}
                  onChange={e => {
                    const arr = e.target.value.split(/[、,，]+/).map(s => s.trim()).filter(Boolean)
                    update(idx, { rewards: arr.length ? arr : undefined })
                  }}
                  placeholder="獎勵，以「、」分隔（如：輕型通用改裝模組×1、仿生超導體×2）"
                  className="w-full bg-bg-card border border-border rounded px-2 py-1 text-[11px] text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50"
                />
                <p className="mt-0.5 text-[10px] text-text-dim">
                  留空時前台會自動從名稱的括號解析（如「瑞歲百角戲(改裝模組*1)」）——所以舊寫法照樣顯示得出來，不必回頭改。
                </p>
              </div>

              {/* 行5：說明 + 公告連結 + 成熟度 */}
              <div className="mt-2 ml-6 space-y-2">
                <textarea
                  value={act.description ?? ''}
                  onChange={e => update(idx, { description: e.target.value || undefined })}
                  rows={2}
                  placeholder="活動說明／規則（換行即分段）"
                  className="w-full bg-bg-card border border-border rounded px-2 py-1 text-[11px] text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50 resize-y"
                />

                {/* 站方備註：官方沒寫、但讀者想先知道的慣例。與上面的 description
                    分開存，是為了始終分得出「官方寫的」與「我們補的」 */}
                <div>
                  <input
                    type="text"
                    value={act.editorNote ?? ''}
                    onChange={e => update(idx, { editorNote: e.target.value || undefined })}
                    placeholder="站方備註（前台會顯示，如：固定是出外觀的活動）"
                    className="w-full bg-bg-card border border-accent-cyan/40 rounded px-2 py-1 text-[11px] text-text-primary placeholder-text-dim outline-none focus:border-accent-cyan"
                  />
                  <p className="mt-0.5 text-[10px] text-text-dim">
                    寫官方公告不會寫、但玩家需要知道的事。前台以「備註」標示，與上面抄自公告的說明分開呈現。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="url"
                    value={act.sourceUrl ?? ''}
                    onChange={e => update(idx, { sourceUrl: e.target.value || undefined })}
                    placeholder="官方公告連結"
                    className="flex-1 min-w-[200px] bg-bg-card border border-border rounded px-2 py-1 text-[11px] text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50"
                  />
                  <label className="flex items-center gap-1.5 text-[11px] text-text-dim whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={act.confidence === 'predicted'}
                      onChange={e => update(idx, { confidence: e.target.checked ? 'predicted' : undefined })}
                      className="accent-accent-purple"
                    />
                    推估（未經公告查證）
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-text-dim whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={act.hidden === true}
                      disabled={act.weeks === undefined}
                      onChange={e => update(idx, { hidden: e.target.checked ? true : undefined })}
                      className="accent-accent-yellow"
                    />
                    <span className={act.hidden ? 'text-accent-yellow' : undefined}>
                      隱藏（資料未齊，前台不顯示）
                    </span>
                  </label>
                </div>

                {/* 後台備註：缺什麼、要去哪查。前台永不顯示，與 description 分工明確 */}
                {(act.hidden || act.weeks === undefined || act.note) && (
                  <div>
                    <input
                      type="text"
                      value={act.note ?? ''}
                      onChange={e => update(idx, { note: e.target.value || undefined })}
                      placeholder="後台備註：缺什麼、要去哪裡查（前台不顯示）"
                      className="w-full bg-bg-card border border-accent-yellow/40 rounded px-2 py-1 text-[11px] text-text-primary placeholder-text-dim outline-none focus:border-accent-yellow"
                    />
                    <p className="mt-0.5 text-[10px] text-text-dim">
                      補齊資料後把「隱藏」取消勾選即上線，不需要重跑爬蟲或審核流程。
                    </p>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
