import type { LoreDossierField, LoreDossierInfo } from '../../../types'
import { Field, GRID_AUTO_FIELDS } from '../../../pages/user/admin/shared'
import { duplicateLabels, unlabeledRows } from '../../../utils/loreDossier'
import { moveItem } from './loreEditText'

/**
 * 故事館編輯台「人物檔案」分頁（PLAN-042-E D-2，取代 PilotAdmin 的 AdditionalInfoEditor）。
 *
 * 自訂欄位改成**有序陣列**（原本的 additionalInfo 是 map，Firestore 不保證鍵序）：
 * 上下排序就是前台卷宗的顯示順序。同名標籤、有內容沒標籤的列，存檔前由 LoreEditPanel 擋下；
 * 這裡先在列上標紅，讓編輯者知道是哪一列。
 */
export function LoreDossierEditor({
  value, faction, onChange,
}: {
  value: LoreDossierInfo | undefined
  /** pilots.faction：卷宗的「陣營」列取自這裡（不在 pilotLore），只顯示 */
  faction?: string
  onChange: (next: LoreDossierInfo) => void
}) {
  const d = value ?? {}
  const setFixed = (k: 'gender' | 'height' | 'bloodType', v: string) => onChange({ ...d, [k]: v || undefined })

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-dim leading-relaxed">
        卷宗「個人資料」卡的顯示順序：性別 → 身高 → 血型 → 陣營（取自機師管理{faction ? `：${faction}` : ''}）→ 下方自訂欄位。
        留空的欄位不顯示。身高同時是卡片右上角的紅色標籤（沒填就改印駕駛執照）。
      </p>

      <div className={`${GRID_AUTO_FIELDS} gap-3`}>
        <Field label="性別 gender"><input value={d.gender ?? ''} onChange={(e) => setFixed('gender', e.target.value)} className="input-field text-sm" /></Field>
        <Field label="身高 height"><input value={d.height ?? ''} onChange={(e) => setFixed('height', e.target.value)} className="input-field text-sm" placeholder="168cm" /></Field>
        <Field label="血型 bloodType"><input value={d.bloodType ?? ''} onChange={(e) => setFixed('bloodType', e.target.value)} className="input-field text-sm" /></Field>
      </div>

      <div className="pt-3 border-t border-border/60">
        <LoreFieldRowsEditor
          value={d.extra}
          onChange={(extra) => onChange({ ...d, extra })}
          title="自訂欄位（標籤即前台顯示文字，順序＝顯示順序）"
          emptyHint="尚無自訂欄位。例如：生日、出身、喜好。"
          labelPlaceholder="標籤，如：生日"
        />
      </div>
    </div>
  )
}

/**
 * 「標籤：內容」的有序列（人物檔案的自訂欄位、機甲的技術檔案共用，PLAN-042-B G-1）。
 * 同名標籤、有內容沒標籤的列在這裡標紅；真正擋存檔的是各自的編輯面板（duplicateLabels／unlabeledRows）。
 * 清空時回 undefined：writeDoc 是整份覆寫，欄位會真的從文件上消失。
 */
export function LoreFieldRowsEditor({
  value, onChange, title, emptyHint, labelPlaceholder,
}: {
  value: LoreDossierField[] | undefined
  onChange: (next: LoreDossierField[] | undefined) => void
  title: string
  emptyHint: string
  labelPlaceholder: string
}) {
  const extra = value ?? []
  const dup = new Set(duplicateLabels(extra))
  const unlabeled = new Set(unlabeledRows(extra))
  const setExtra = (next: LoreDossierField[]) => onChange(next.length ? next : undefined)
  const patchRow = (i: number, patch: Partial<LoreDossierField>) => setExtra(extra.map((f, n) => (n === i ? { ...f, ...patch } : f)))

  return (
    <>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[13px] text-text-dim font-medium">{title}</span>
          <button type="button" onClick={() => setExtra([...extra, { label: '', value: '' }])} className="text-[13px] text-accent-cyan hover:text-accent-cyan/80 transition-colors">
            ＋ 新增欄位
          </button>
        </div>
        {extra.length === 0 ? (
          <p className="text-xs text-text-dim py-1">{emptyHint}</p>
        ) : (
          <div className="space-y-1.5">
            {extra.map((f, i) => {
              const bad = dup.has(f.label.trim()) || unlabeled.has(i + 1)
              return (
                // 以索引當 key：標籤可以暫時重複或空白（打字中），沒有其他穩定識別子
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-2">
                  <input
                    value={f.label}
                    onChange={(e) => patchRow(i, { label: e.target.value })}
                    className={`input-field text-xs ${bad ? '!border-accent-red/60' : ''}`}
                    placeholder={labelPlaceholder}
                    title={dup.has(f.label.trim()) ? '與其他列同名' : unlabeled.has(i + 1) ? '有內容卻沒有標籤' : undefined}
                  />
                  <input value={f.value} onChange={(e) => patchRow(i, { value: e.target.value })} className="input-field text-xs" placeholder="內容" />
                  <div className="flex gap-1 shrink-0">
                    <button type="button" onClick={() => setExtra(moveItem(extra, i, -1))} disabled={i === 0} className={ICON_BTN} title="上移">▲</button>
                    <button type="button" onClick={() => setExtra(moveItem(extra, i, 1))} disabled={i === extra.length - 1} className={ICON_BTN} title="下移">▼</button>
                    <button type="button" onClick={() => setExtra(extra.filter((_, n) => n !== i))} className={`${ICON_BTN} hover:!text-accent-red hover:!border-accent-red/40`} title="移除這一列">✕</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {(dup.size > 0 || unlabeled.size > 0) && (
          <p className="text-xs text-accent-red mt-2">
            {dup.size > 0 && <>同名標籤：{[...dup].join('、')}。</>}
            {unlabeled.size > 0 && <>第 {[...unlabeled].join('、')} 列有內容但沒有標籤。</>}
            存檔前要先改好。
          </p>
        )}
    </>
  )
}

export const ICON_BTN =
  'px-2 py-1 rounded-lg border border-border text-text-secondary text-xs hover:border-border-accent hover:text-text-primary transition-colors disabled:opacity-30'
