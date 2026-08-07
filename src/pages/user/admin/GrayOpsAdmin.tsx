import { useMemo, useState } from 'react'
import type { GrayOpsRoster, GrayOpsMechEntry, Mech } from '../../../types'
import { GRAY_OPS_BASE } from '../../../data/patchVersions'
import { resolveIconSrc, mechIconUrl } from '../../../utils/assets'
import { GRAY_OPS_COMPANIES, GRAY_OPS_COMPANY_COLOR } from './constants'

/** 名稱 → 機甲文件 ID 與縮圖。同步、手動新增、靜態初始化三處共用。 */
type MechIndex = Map<string, { id: string; icon?: string }>

/**
 * 把查到的值併回一筆名單條目。
 *
 * 與版本濃縮表同一套取捨（見 AdminVersionEditorPage 的 mergeNameMap）：
 *  · mechId 一律覆寫——它是機器從名稱推導的，沒有「維護者手改的值」需要保護；資料庫重建
 *    使流水號變動時反而必須跟上，否則連結會靜靜指向不存在的舊文件。
 *  · icon 預設只補空缺，force 才覆寫——手動貼的官方 CDN 路徑不該被按一次同步就洗掉。
 *  · 查無此名稱（未建檔的未來機甲，或用字與資料庫不一致）一律原封不動，不清空既有值。
 */
function mergeEntry(entry: GrayOpsMechEntry, hit: { id: string; icon?: string } | undefined, force: boolean): GrayOpsMechEntry {
  if (!hit) return entry
  const icon = hit.icon && (force || !entry.icon) ? hit.icon : entry.icon
  return { ...entry, mechId: hit.id, icon }
}

/**
 * 查無此名時，找出資料庫裡「只差一個字」的候選。
 *
 * 不是錦上添花：名單有一批名稱與資料庫差在異體字（芬里厄／芬裡厄、塔納托斯／塔納託斯、
 * 游騎兵／遊騎兵、騰蛇／螣蛇），同步後只會得到一排灰燈，維護者無從得知是「還沒建檔」
 * 還是「用字不一致」——而這兩者的處理方式完全相反。
 *
 * 只比對等長且恰好差一字，寧可漏報也不亂配對：長度不同的名稱（別名、簡稱）猜錯的代價是
 * 一鍵改名把正確的名字改壞。
 */
function findNearMatch(name: string, index: MechIndex): string | undefined {
  for (const key of index.keys()) {
    if (key.length !== name.length || key === name) continue
    let diff = 0
    for (let i = 0; i < name.length; i++) {
      if (key[i] !== name[i] && ++diff > 1) break
    }
    if (diff === 1) return key
  }
  return undefined
}

function buildSeedRoster(index: MechIndex): GrayOpsRoster {
  return {
    companies: Object.fromEntries(
      GRAY_OPS_COMPANIES.map((c) => [
        c,
        GRAY_OPS_BASE[c].map((name) => mergeEntry({ name }, index.get(name), true)),
      ])
    ),
  }
}

export default function GrayOpsAdmin({
  roster,
  mechs: allMechs,
  onSave,
}: {
  roster: GrayOpsRoster | null
  /** GameDataContext 已快取的 mechs（AdminPage 的 grayops 分頁一併載入）——同步不必自己 getDocs */
  mechs: Mech[]
  onSave: (updated: GrayOpsRoster) => Promise<void>
}) {
  const [form, setForm] = useState<GrayOpsRoster>(
    roster ?? { companies: Object.fromEntries(GRAY_OPS_COMPANIES.map((c) => [c, []])) }
  )
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [newName, setNewName]       = useState<Record<string, string>>({})
  const [newVersion, setNewVersion] = useState<Record<string, string>>({})
  const [forceOverwrite, setForceOverwrite] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  // 展開手動編輯圖片路徑的那一列（一次只開一列，避免 4 欄卡片被輸入框撐爛）
  const [editingIcon, setEditingIcon] = useState<{ company: string; idx: number } | null>(null)

  const mechIndex = useMemo<MechIndex>(() => {
    const map: MechIndex = new Map()
    // m.id 即文件 ID：fetchCollection 是 `{ ...d.data(), id: d.id }`，與路由 / EntityRefView 認的一致
    for (const m of allMechs) map.set(m.name, { id: m.id, icon: mechIconUrl(m) })
    return map
  }, [allMechs])

  function getMechs(company: string): GrayOpsMechEntry[] {
    return form.companies[company] ?? []
  }

  function updateMechs(company: string, mechs: GrayOpsMechEntry[]) {
    setForm((f) => ({ companies: { ...f.companies, [company]: mechs } }))
  }

  function addMech(company: string) {
    const name = (newName[company] ?? '').trim()
    if (!name) return
    const version = (newVersion[company] ?? '').trim() || undefined
    // 新增當下就查一次：已建檔的機甲不必再按同步，未建檔的維持純文字
    updateMechs(company, [...getMechs(company), mergeEntry({ name, version }, mechIndex.get(name), true)])
    setNewName((n) => ({ ...n, [company]: '' }))
    setNewVersion((n) => ({ ...n, [company]: '' }))
  }

  function removeMech(company: string, idx: number) {
    updateMechs(company, getMechs(company).filter((_, i) => i !== idx))
    setEditingIcon(null)
  }

  /** 一鍵套用近似名稱：改名後順手把該筆連上（改完立刻可用，不必再按一次同步） */
  function applyNearMatch(company: string, idx: number, suggestion: string) {
    updateMechs(
      company,
      getMechs(company).map((m, i) =>
        i === idx ? mergeEntry({ ...m, name: suggestion }, mechIndex.get(suggestion), true) : m
      )
    )
  }

  function updateIcon(company: string, idx: number, url: string) {
    const trimmed = url.trim()
    updateMechs(
      company,
      getMechs(company).map((m, i) => (i === idx ? { ...m, icon: trimmed || undefined } : m))
    )
  }

  function handleSeed() {
    if (!confirm('這將以靜態資料覆蓋目前表單（尚未儲存至 Firestore），確定嗎？')) return
    setForm(buildSeedRoster(mechIndex))
    setEditingIcon(null)
  }

  /**
   * 從已載入的 mechs 補上連結 ID 與縮圖。
   *
   * 統計依「按下按鈕當下」的快照計算，實際合併走 functional updater：StrictMode 下 updater
   * 會被呼叫兩次，統計若寫在裡面會直接翻倍。
   */
  function handleSync() {
    let linked = 0, iconAdded = 0, iconKept = 0, missing = 0, nearMiss = 0
    for (const company of GRAY_OPS_COMPANIES) {
      for (const m of getMechs(company)) {
        const hit = mechIndex.get(m.name)
        if (!hit) {
          missing++
          if (findNearMatch(m.name, mechIndex)) nearMiss++
          continue
        }
        linked++
        if (!hit.icon) continue
        if (!m.icon) iconAdded++
        else if (m.icon !== hit.icon && !forceOverwrite) iconKept++
      }
    }

    setForm((f) => ({
      companies: Object.fromEntries(
        Object.entries(f.companies).map(([company, list]) => [
          company,
          list.map((m) => mergeEntry(m, mechIndex.get(m.name), forceOverwrite)),
        ])
      ),
    }))

    setSyncMsg(
      `同步完成：連結 ${linked} 筆，圖示新增 ${iconAdded}`
      + (forceOverwrite ? '（已覆寫既有）' : `，保留既有 ${iconKept}`)
      + (missing ? `；${missing} 筆在資料庫查無同名機甲（未建檔的未來機甲屬正常）` : '')
      + (nearMiss ? `，其中 ${nearMiss} 筆疑似用字不一致，點該列的橘燈可一鍵改成資料庫用字` : '')
    )
  }

  async function handleSave() {
    setSaving(true); setError(null); setSuccess(false)
    try {
      await onSave(form)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  const totalCount  = GRAY_OPS_COMPANIES.reduce((acc, c) => acc + getMechs(c).length, 0)
  const linkedCount = GRAY_OPS_COMPANIES.reduce((acc, c) => acc + getMechs(c).filter((m) => m.mechId).length, 0)
  const iconCount   = GRAY_OPS_COMPANIES.reduce((acc, c) => acc + getMechs(c).filter((m) => m.icon).length, 0)

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <p className="text-text-dim text-xs">
          共 {totalCount} 筆機甲 · 已連結 <span className="text-accent-green">{linkedCount}</span>
          {' '}· 有圖 <span className="text-accent-cyan">{iconCount}</span>
        </p>
        <div className="flex gap-2 items-center flex-wrap">
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-text-dim" title="勾選後，資料庫查得到的名稱會以資料庫路徑覆寫既有圖片路徑（官方換圖時整批刷新用）">
            <input
              type="checkbox"
              checked={forceOverwrite}
              onChange={(e) => setForceOverwrite(e.target.checked)}
              className="accent-accent-orange"
            />
            強制覆寫圖片
          </label>
          <button
            onClick={handleSync}
            disabled={allMechs.length === 0}
            title={allMechs.length === 0 ? '機甲資料尚未載入' : '從已載入的機甲資料補上連結 ID 與縮圖'}
            className="text-xs px-3 py-1.5 bg-bg-dark border border-border text-accent-cyan rounded-lg hover:border-accent-cyan/50 transition-colors disabled:opacity-40"
          >
            同步 Icon / 連結
          </button>
          <button
            onClick={handleSeed}
            className="text-xs px-3 py-1.5 bg-bg-dark border border-border text-text-secondary rounded-lg hover:border-border-accent hover:text-text-primary transition-colors"
          >
            從靜態資料初始化
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-4 py-1.5 bg-accent-orange text-black font-bold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? '儲存中...' : '儲存至 Firestore'}
          </button>
        </div>
      </div>

      {syncMsg && <p className="text-xs text-accent-cyan mb-3">{syncMsg}</p>}
      {error   && <p className="text-xs text-accent-red mb-3">⚠ {error}</p>}
      {success && <p className="text-xs text-green-400 mb-3">✓ 已儲存</p>}

      <p className="text-xs text-text-dim mb-4 leading-relaxed">
        點縮圖可手動編輯圖片路徑；同步<span className="text-text-secondary">只補空缺</span>，已填的路徑一律保留。
        狀態燈：<span className="text-accent-green">●</span> 已連結有圖 ·
        <span className="text-accent-yellow"> ●</span> 已連結無圖 ·
        <span className="text-accent-orange"> ●</span> 用字疑似不一致（可點，一鍵改成資料庫用字）·
        <span className="text-text-dim"> ●</span> 資料庫查無此名（尚未建檔）
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {GRAY_OPS_COMPANIES.map((company) => {
          const mechs = getMechs(company)
          const colorClass = GRAY_OPS_COMPANY_COLOR[company]
          return (
            <div key={company} className="bg-bg-dark border border-border rounded-xl p-4">
              <div className={`text-sm font-bold mb-3 ${colorClass}`}>{company}</div>

              <div className="space-y-1.5 mb-3 max-h-96 overflow-y-auto pr-1">
                {mechs.map((m, idx) => {
                  const near = m.mechId ? undefined : findNearMatch(m.name, mechIndex)
                  const status = m.mechId
                    ? (m.icon ? { cls: 'text-accent-green',  text: '已連結，有圖' }
                              : { cls: 'text-accent-yellow', text: '已連結，尚無圖片' })
                    : near
                      ? { cls: 'text-accent-orange', text: `資料庫裡有「${near}」，只差一個字。點此改成資料庫用字並連結` }
                      : { cls: 'text-text-dim/50',   text: '資料庫查無同名機甲（尚未建檔的未來機甲屬正常）' }
                  const isEditing = editingIcon?.company === company && editingIcon.idx === idx
                  return (
                    <div key={idx}>
                      <div className="flex items-center gap-1.5 group">
                        <button
                          onClick={() => setEditingIcon(isEditing ? null : { company, idx })}
                          title="編輯圖片路徑"
                          className="shrink-0 w-6 h-6 rounded overflow-hidden border border-border hover:border-accent-orange transition-colors bg-bg-card"
                        >
                          {m.icon
                            ? <img src={resolveIconSrc(m.icon)} alt="" className="w-full h-full object-cover object-top" />
                            : <span className="block w-full h-full" />}
                        </button>
                        <span className="flex-1 min-w-0 text-sm text-text-secondary truncate">{m.name}</span>
                        {m.version && (
                          <span className="text-[11px] text-accent-cyan border border-accent-cyan/30 px-1 rounded shrink-0">
                            {m.version}
                          </span>
                        )}
                        {near ? (
                          <button
                            onClick={() => applyNearMatch(company, idx, near)}
                            title={status.text}
                            className={`text-[11px] shrink-0 ${status.cls} hover:brightness-125 cursor-pointer`}
                          >
                            ●
                          </button>
                        ) : (
                          <span className={`text-[11px] shrink-0 ${status.cls}`} title={status.text}>●</span>
                        )}
                        <button
                          onClick={() => removeMech(company, idx)}
                          className="text-[12px] text-text-dim hover:text-accent-red opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        >
                          ✕
                        </button>
                      </div>
                      {isEditing && (
                        <input
                          type="text"
                          autoFocus
                          value={m.icon ?? ''}
                          onChange={(e) => updateIcon(company, idx, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingIcon(null) }}
                          placeholder="/images/mechs/… 或官方 CDN 網址（留空＝無圖）"
                          className="mt-1 w-full px-2 py-1 text-[11px] rounded bg-bg-card border border-accent-orange/50 text-text-primary focus:outline-none"
                        />
                      )}
                    </div>
                  )
                })}
                {mechs.length === 0 && (
                  <p className="text-xs text-text-dim">（尚無資料）</p>
                )}
              </div>

              <div className="space-y-1.5 pt-3 border-t border-border/60">
                <input
                  type="text"
                  value={newName[company] ?? ''}
                  onChange={(e) => setNewName((n) => ({ ...n, [company]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') addMech(company) }}
                  placeholder="機甲名稱"
                  className="w-full px-2 py-1 text-sm rounded bg-bg-card border border-border text-text-primary focus:outline-none focus:border-accent-orange"
                />
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={newVersion[company] ?? ''}
                    onChange={(e) => setNewVersion((n) => ({ ...n, [company]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') addMech(company) }}
                    placeholder="版本（選填，如 v3.3）"
                    className="flex-1 px-2 py-1 text-sm rounded bg-bg-card border border-border text-text-primary focus:outline-none focus:border-accent-orange"
                  />
                  <button
                    onClick={() => addMech(company)}
                    className="px-2 py-1 text-xs bg-accent-orange text-black font-bold rounded hover:opacity-90"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
