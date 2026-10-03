// 後台的「遊戲 ID／立繪主鍵／官配／塗裝本體」欄位 —— PLAN-054 A-3
//
// 機師與機甲兩個編輯器共用的一塊表單：填 ID → 旁邊立刻看到官方原檔有沒有、長什麼樣。
// 「有沒有圖」看的是 build 產生的 gameArtIndex（與前台同一份），不是去打網址試——
// 所以剛匯入、還沒重跑 build 的圖這裡會顯示「尚未匯入」，那是對的：前台也還看不到它。
//
// ⚠ 官配只存機師側（Pilot.pairedMechId）。機甲這邊的官配欄是**唯讀**的推導結果，
//   要改請到機師的編輯器——兩邊都能改就會兩邊不一致。

import { Link } from 'react-router-dom'
import type { Mech, Pilot } from '../../types'
import { GAME_MECH_ART, GAME_PILOT_ART } from '../../data/gameArtIndex'
import { mechGameArt, pilotGameArt } from '../../utils/gameArt'
import type { PilotGameArtKind } from '../../utils/gameArt'
import { assetUrl } from '../../utils/assets'
import { duplicatePairs, pairedPilotOf } from '../../utils/officialPairs'
import { Field } from '../../pages/user/admin/shared'

const blank = (v: string) => v.trim() || undefined

function Thumb({ src, label, wide }: { src: string | undefined; label: string; wide?: boolean }) {
  return (
    <figure className="flex flex-col items-center gap-1 m-0">
      {src ? (
        <img
          src={assetUrl(src)}
          alt={label}
          className={`${wide ? 'w-24 h-14' : 'w-14 h-14'} rounded-lg object-contain bg-bg-dark border border-border`}
        />
      ) : (
        <span className={`${wide ? 'w-24 h-14' : 'w-14 h-14'} rounded-lg bg-bg-dark border border-dashed border-border flex items-center justify-center text-[10px] text-text-dim`}>
          無
        </span>
      )}
      <figcaption className="text-[10px] text-text-dim">{label}</figcaption>
    </figure>
  )
}

/** 官方原檔的狀態文字：有／尚未匯入／主鍵對不上（最常見的打錯） */
function pilotArtStatus(form: Pick<Pilot, 'gameId' | 'artKey'>): { ok: boolean; text: string } {
  if (!form.gameId) return { ok: false, text: '未填 gameId：讀取端照舊走 portrait／portraitUrl' }
  const entry = GAME_PILOT_ART.get(form.gameId)
  if (!entry) {
    return { ok: false, text: `尚未匯入：node scripts/import-game-assets.mjs --id=${form.gameId} --art-key=${form.artKey || '<artKey>'} --apply` }
  }
  if (!form.artKey) return { ok: false, text: `資料夾裡的立繪主鍵是 ${entry.key}——artKey 還沒填` }
  if (form.artKey !== entry.key) return { ok: false, text: `artKey 與資料夾裡的檔名不符（資料夾是 ${entry.key}）——前台會退回舊圖` }
  return { ok: true, text: '官方原檔已就緒' }
}

export function PilotGameArtFields({ form, update, pilots, mechs }: {
  form: Pilot
  update: <K extends keyof Pilot>(key: K, value: Pilot[K]) => void
  pilots: readonly Pilot[]
  mechs: readonly Mech[]
}) {
  const status = pilotArtStatus(form)
  // 已被**其他**機師配走的機甲：下拉照樣可選（資料修正時需要），但標出來
  const takenBy = new Map<string, string>()
  for (const p of pilots) if (p.id !== form.id && p.pairedMechId) takenBy.set(p.pairedMechId, p.name)
  const conflicts = duplicatePairs(pilots.map((p) => (p.id === form.id ? { ...p, pairedMechId: form.pairedMechId } : p)))
  const kinds: [PilotGameArtKind, string][] = [['half', '頭像 half'], ['head', '頭部 head'], ['card', '機師卡 card']]

  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="text-xs text-text-dim font-medium tracking-wider uppercase mb-2">遊戲 ID 與官配（PLAN-054）</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="遊戲 ID gameId（機師卡 Icon_item_<ID>A 的編號）">
          <input value={form.gameId ?? ''} onChange={(e) => update('gameId', blank(e.target.value))} className="input-field" placeholder="10103174" />
        </Field>
        <Field label="立繪主鍵 artKey（與 gameId 不互推）">
          <input value={form.artKey ?? ''} onChange={(e) => update('artKey', blank(e.target.value))} className="input-field" placeholder="Pilot_10103174A" />
        </Field>
        <Field label="官配機甲 pairedMechId">
          <select value={form.pairedMechId ?? ''} onChange={(e) => update('pairedMechId', e.target.value || undefined)} className="input-field">
            <option value="">（沒有官配）</option>
            {mechs.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{takenBy.has(m.id) ? `（已配給 ${takenBy.get(m.id)}）` : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex items-start gap-3 mt-2 flex-wrap">
        {kinds.map(([k, label]) => <Thumb key={k} src={pilotGameArt(form, k)} label={label} />)}
        <p className={`text-[12px] self-center ${status.ok ? 'text-accent-green' : 'text-accent-yellow'}`}>{status.text}</p>
      </div>
      {form.pairedMechId && conflicts.has(form.pairedMechId) && (
        <p className="text-[12px] text-accent-red mt-1">
          ⚠ 官配是一對一：這台機甲同時被 {conflicts.get(form.pairedMechId)!.length} 位機師配到。存檔前請先把另一位改掉。
        </p>
      )}
    </div>
  )
}

export function MechGameArtFields({ form, set, mechs, pilots }: {
  form: Mech
  set: <K extends keyof Mech>(key: K, value: Mech[K]) => void
  mechs: readonly Mech[]
  pilots: readonly Pilot[]
}) {
  const entry = form.gameId ? GAME_MECH_ART.get(form.gameId) : undefined
  const paired = pairedPilotOf(form.id, pilots)
  const status = !form.gameId
    ? '未填 gameId：讀取端照舊走 portrait 與部件 icon'
    : !entry
      ? `尚未匯入：node scripts/import-game-assets.mjs --wap=${form.gameId} --apply`
      : `官方原檔已就緒（部件 ${entry.parts.length}／4${entry.sn ? '' : '；沒有全身大圖，匯出圖走小尺寸版面'}）`

  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="text-xs text-text-dim font-medium tracking-wider uppercase mb-2">遊戲 ID、塗裝與官配（PLAN-054）</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="遊戲 ID gameId（wap 四碼）">
          <input value={form.gameId ?? ''} onChange={(e) => set('gameId', blank(e.target.value))} className="input-field" placeholder="1011" />
        </Field>
        <Field label="塗裝本體 skinOfId（付費塗裝才填）">
          <select value={form.skinOfId ?? ''} onChange={(e) => set('skinOfId', e.target.value || undefined)} className="input-field">
            <option value="">（不是塗裝）</option>
            {mechs.filter((m) => m.id !== form.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="官配機師（唯讀，由機師側推導）">
          <p className="text-[13px] py-1.5">
            {paired
              ? <><Link to={`/pilots/${paired.id}`} target="_blank" className="text-accent-cyan">{paired.name}</Link><span className="text-text-dim ml-2">要改請到「機師管理」</span></>
              : <span className="text-text-dim">沒有（要設定請到「機師管理」）</span>}
          </p>
        </Field>
      </div>
      <div className="flex items-start gap-3 mt-2 flex-wrap">
        <Thumb src={mechGameArt(form, 'icon')} label="立繪 icon" wide />
        <Thumb src={mechGameArt(form, 'sn')} label="全身 SN" wide />
        <Thumb src={mechGameArt(form, 'torso')} label="軀幹" />
        <Thumb src={mechGameArt(form, 'legs')} label="腿部" />
        <p className={`text-[12px] self-center ${entry ? 'text-accent-green' : 'text-accent-yellow'}`}>{status}</p>
      </div>
    </div>
  )
}
