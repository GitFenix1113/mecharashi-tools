import { useState } from 'react'
import type { TimedActivity, ActivityTypeId } from '../../data/patchVersions/types'
import {
  ACTIVITY_TYPE_OPTIONS,
  isKnownActivityType,
  activityTone,
  shapeClass,
} from '../timeline/activityTypeRegistry'

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
  /**
   * 展開中的活動。**預設全部摺起** —— 一個半版本動輒 8 筆活動、每筆展開有五行輸入，
   * 攤開來光是捲到目標就要滾很久，而多數時候只是來改其中一筆。
   *
   * 存「展開的」而不是「摺起的」：這樣新載入或新解析進來的活動天然是摺起狀態，
   * 不必在 activities 變動時同步維護這個集合。
   */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  /**
   * 摺疊狀態的錨點。優先用 `act.id`（PLAN-048 Phase 1 加的穩定識別子）——
   * 純 index 在陣列增刪後會讓「展開的是哪一筆」跳到別的活動身上，
   * 與 makeActivityId 註解裡記的是同一個坑。舊資料沒有 id，只好退回 index。
   */
  const keyOf = (act: TimedActivity, idx: number) => act.id ?? `idx_${idx}`

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const allKeys = activities.map(keyOf)
  const allOpen = activities.length > 0 && allKeys.every(k => expanded.has(k))

  function add() {
    const act = emptyActivity()
    // 剛新增的一定要填，直接展開；不然使用者得先找到它再點一次
    const key = act.id ?? `idx_${activities.length}`
    setExpanded(prev => new Set(prev).add(key))
    onChange([...activities, act])
  }

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
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-[11px] font-bold text-text-secondary tracking-[2px] uppercase">
          {label}
        </span>
        <div className="flex items-center gap-2">
          {activities.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(allOpen ? new Set() : new Set(allKeys))}
              className="px-2 py-0.5 text-[11px] text-text-dim border border-border rounded hover:text-text-secondary hover:border-border-accent transition-colors"
            >
              {allOpen ? '全部收合' : '全部展開'}
            </button>
          )}
          <button
            type="button"
            onClick={add}
            className="px-2 py-0.5 text-[11px] bg-accent-purple/15 text-accent-purple border border-accent-purple/30 rounded hover:bg-accent-purple/25 transition-colors"
          >
            + 新增
          </button>
        </div>
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
          const key = keyOf(act, idx)
          const isOpen = expanded.has(key)
          const tone = activityTone(act.type, act.typeLabel)

          return (
            <div
              key={key}
              className={`bg-bg-dark border border-border rounded-lg ${isOpen ? 'p-3' : 'px-3 py-2'}`}
            >
              {/* 標題列：永遠可見，點一下摺疊。摺起時把「不展開就會漏掉」的資訊全帶在這一行 ——
                  檔期，以及三個會左右前台顯示的旗標（未填長度／隱藏／推估）。
                  摺疊若讓問題資料看起來跟正常的一樣，那就是把坑藏起來而不是收納。 */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  title={isOpen ? '收合' : '展開編輯'}
                  className="flex-1 flex items-center gap-2 min-w-0 text-left"
                >
                  <span className="w-3 text-center shrink-0 text-[10px] text-text-dim">
                    {isOpen ? '▾' : '▸'}
                  </span>
                  <span className="w-4 text-center shrink-0 text-[10px] text-text-dim">{idx + 1}</span>
                  {/* 與前台甘特同一套「顏色＋端點形狀」編碼，後台掃清單時對得上畫面 */}
                  <span className={`shrink-0 ${tone.dot} ${shapeClass(tone.shape)}`} />
                  <span className="shrink-0 text-[10px] text-text-dim">{tone.label}</span>
                  <span className={`truncate text-xs ${act.name ? 'text-text-primary' : 'text-text-dim italic'}`}>
                    {act.name || '（未命名）'}
                  </span>
                  {!isOpen && (
                    <span className="ml-auto shrink-0 flex items-center gap-1.5 text-[10px] text-text-dim">
                      {act.startDate && <span>{act.startDate}</span>}
                      {act.weeks !== undefined
                        ? <span>{act.weeks} 週</span>
                        : <span className="text-accent-yellow">未填長度</span>}
                      {act.hidden && <span className="text-accent-yellow">隱藏</span>}
                      {act.confidence === 'predicted' && <span className="text-accent-purple">推估</span>}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  title="刪除此活動"
                  className="flex-shrink-0 text-text-dim hover:text-accent-red transition-colors text-sm w-6 text-center"
                >
                  ✕
                </button>
              </div>

              {isOpen && (
              <>
              {/* 行1：名稱 */}
              <div className="mt-2 mb-2 ml-6">
                <input
                  type="text"
                  value={act.name}
                  onChange={e => update(idx, { name: e.target.value })}
                  placeholder="活動名稱（如：白夜凍鋒（復刻））"
                  className="w-full bg-bg-card border border-border rounded px-2 py-1 text-xs text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50 min-w-0"
                />
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

              {/*
                行3（條件）：這個活動關聯的實體 —— 卡池的 UP 機師／機甲、戰令的獎勵機體。
                `bannerIsRerun` 拿 pilots/mechs 比對半版本新增名單來判定復刻，所以卡池非填不可。

                **特遣／海運（自選池）不在此列**：它們的名單是下面的「這期可選的…」。
                這兩格原本反而只對 pilotMission / crossShipping 顯示 —— 那是 selection
                還不存在時的舊語意，placeholder 甚至拿卡池名當機師名的範例。
                照著填下去的後果是前台把 pilots 與 selection 各印一行，同一批名字顯示兩次。

                改判準為「有值才顯示」，一石二鳥：特遣／海運空著就不出現，
                而 specificPilotBanner 的 UP 機師（解析器本來就會填）原本在這個編輯器裡
                **看不到也改不了** —— 因為舊條件只認 pilotMission。現在有值就看得到。

                代價是「卡池漏填 pilots」時沒有空格可以補。那要靠審核面板填（它一律有格），
                或日後在這裡按型別開格；先不做，因為空格會邀請人往錯的欄位填。
              */}
              {(act.pilots?.length ?? 0) > 0 && (
                <div className="mt-2 ml-6">
                  <input
                    type="text"
                    value={(act.pilots ?? []).join('、')}
                    onChange={e =>
                      update(idx, {
                        pilots: e.target.value.split(/[、,，]+/).map(s => s.trim()).filter(Boolean),
                      })
                    }
                    placeholder="UP／關聯機師，以「、」分隔（如：哈達威、科林）"
                    className="w-full bg-bg-card border border-border rounded px-2 py-1 text-[11px] text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50"
                  />
                </div>
              )}

              {(act.mechs?.length ?? 0) > 0 && (
                <div className="mt-2 ml-6">
                  <input
                    type="text"
                    value={(act.mechs ?? []).join('、')}
                    onChange={e =>
                      update(idx, {
                        mechs: e.target.value.split(/[、,，]+/).map(s => s.trim()).filter(Boolean),
                      })
                    }
                    placeholder="UP／關聯機甲，以「、」分隔（如：螢石、赫克托爾）"
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
              </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
