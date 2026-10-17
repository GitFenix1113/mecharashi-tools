import { useMemo } from 'react'
import type { LoreDoc, Pilot } from '../../../types'
import { Field } from '../../../pages/user/admin/shared'
import { usePatchVersions } from '../../../hooks/usePatchVersions'
import { gachaTitleSuggestions } from '../../lore/mechGachaTitle'
import { pilotCardArt } from '../../../utils/gameArt'
import { FactionLogoPicker } from '../FactionLogoPicker'
import { normalizeFactionLogos, type LogoSuggestion } from '../../../utils/factionLogos'
import { cleanOcr, mergeSoftWraps } from './loreEditText'

/**
 * 故事館編輯台「扉頁」分頁（PLAN-042-E D-2）：英文名、扉頁簡介、扉頁署名、陣營徽章；卡池名稱（PLAN-042-A Phase J）。
 *
 * 名字、全名、職業、陣營是兩館共用的身分欄位，仍在「機師管理」編（站長 Q1），這裡只顯示。
 * 清空一律存 undefined：writeDoc 是整份覆寫，欄位會真的從文件上消失，而不是留一個空字串。
 */
export function LoreFrontEditor({
  form, pilot, onChange, logoSuggestions,
}: {
  form: LoreDoc
  pilot: Pilot | undefined
  onChange: (patch: Partial<LoreDoc>) => void
  logoSuggestions: LogoSuggestion[]
}) {
  const intro = form.intro ?? ''
  // 卡池名稱的建議：公告管線解析到的機師卡池（版本活動 specificPilotBanner）。讀不到版本資料就只是沒有建議
  const { data: versions } = usePatchVersions()
  const gachaHints = useMemo(() => gachaTitleSuggestions(pilot?.name, versions, 'pilot'), [pilot?.name, versions])
  const hasCard = !!pilotCardArt(pilot)
  return (
    <div className="space-y-4">
      <p className="text-xs text-text-dim leading-relaxed">
        名字、全名、職業、陣營是圖鑑與故事館共用的身分欄位，在「機師管理」編輯：
        <span className="text-text-secondary"> {pilot?.fullName || pilot?.name || form.id}</span>
        {pilot?.faction && <span className="text-text-secondary"> · {pilot.faction}</span>}
        {pilot?.class && <span className="text-text-secondary"> · {pilot.class}</span>}
      </p>

      <Field label="英文名 nameEn（扉頁立繪旁的毛筆草書、卷宗副標、名冊搜尋；留空就不畫草書）">
        <input
          value={form.nameEn ?? ''}
          onChange={(e) => onChange({ nameEn: e.target.value || undefined })}
          className="input-field text-sm"
          placeholder="Rosa Diaz"
        />
      </Field>

      <div>
        <Field label="扉頁簡介 intro（純文字，換行即分段；署名不要寫在這裡，填在下方的扉頁署名）">
          <textarea
            value={intro}
            onChange={(e) => onChange({ intro: e.target.value || undefined })}
            className="input-field min-h-[180px] resize-y text-sm leading-relaxed"
            placeholder="貼上或輸入簡介。"
          />
        </Field>
        <div className="flex gap-2 flex-wrap mt-1.5">
          <button type="button" onClick={() => onChange({ intro: cleanOcr(intro) || undefined })} disabled={!intro} className={SMALL_BTN}>
            清理（OCR）
          </button>
          <button type="button" onClick={() => onChange({ intro: mergeSoftWraps(intro) || undefined })} disabled={!intro} className={SMALL_BTN}>
            合併軟換行
          </button>
          <span className="text-[11px] text-text-dim self-center">與逸聞章節的 OCR 區是同一套規則；只在按下時套用。</span>
        </div>
      </div>

      <Field label="扉頁署名 frontSource（選填，例：——《週刊米赫瑪·文娛版》）">
        <input
          value={form.frontSource ?? ''}
          onChange={(e) => onChange({ frontSource: e.target.value || undefined })}
          className="input-field text-sm"
          placeholder="——《週刊米赫瑪·文娛版》"
        />
      </Field>

      <Field label="卡池名稱 gachaTitle（卷宗最後招募插畫卡的標題；空＝顯示「卡池」）">
        <input
          value={form.gachaTitle ?? ''}
          onChange={(e) => onChange({ gachaTitle: e.target.value || undefined })}
          className="input-field text-sm"
        />
        {gachaHints.filter((h) => h.title !== form.gachaTitle?.trim()).map((h) => (
          <button
            key={`${h.server}|${h.title}`}
            type="button"
            onClick={() => onChange({ gachaTitle: h.title })}
            className="mt-1 mr-3 text-[11px] text-accent-cyan hover:underline"
          >
            {h.server === 'tw' ? '台服' : '陸服'}公告 {h.date}「{h.title}」——用這個
          </button>
        ))}
        {!hasCard && <p className="mt-1 text-[11px] text-text-dim">這位站上沒有招募插畫，卷宗不會出現卡池卡（填了也看不到）。</p>}
      </Field>

      {/* 陣營徽章：只在故事館顯示（扉頁徽記、館首頁卡片角標） */}
      <Field label="陣營徽章 factionLogos（選填，最多 2 個；只在故事館顯示）">
        <FactionLogoPicker
          value={normalizeFactionLogos(form.factionLogos)}
          faction={pilot?.faction}
          suggestions={logoSuggestions}
          onChange={(next) => onChange({ factionLogos: next.length ? next : undefined })}
        />
      </Field>
    </div>
  )
}

export const SMALL_BTN =
  'text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:border-border-accent hover:text-text-primary transition-colors disabled:opacity-40'
