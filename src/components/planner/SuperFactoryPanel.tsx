import { assetUrl } from '../../utils/assets'
import type { SuperFactoryResources } from '../../types/mechUpgrade'
import { Stepper } from './Stepper'

const SF_ITEMS = [
  {
    key:      's'   as const,
    countKey: 'sCount'   as const,
    imgFile:  'megafactory_s_model.png',
    name:     'S 零件',
    desc:     '萬能金一（無重量限制）',
    rainbow:  false,
  },
  {
    key:      'sp'  as const,
    countKey: 'spCount'  as const,
    imgFile:  'megafactory_sp_model.png',
    name:     'S+ 零件',
    desc:     '替代金二升金三所需兩個肥料',
    rainbow:  false,
  },
  {
    key:      'spp' as const,
    countKey: 'sppCount' as const,
    imgFile:  'megafactory_spp_model.png',
    name:     'S++ 零件',
    desc:     '萬能金三（無重量限制）',
    rainbow:  true,
  },
]

const FIXED_COUNT = 2

interface SuperFactoryPanelProps {
  value:    SuperFactoryResources
  onChange: (v: SuperFactoryResources) => void
}

export function SuperFactoryPanel({ value, onChange }: SuperFactoryPanelProps) {
  const toggle = () => {
    const enabled = !value.enabled
    onChange({
      enabled,
      sCount:   enabled ? FIXED_COUNT : 0,
      spCount:  enabled ? FIXED_COUNT : 0,
      sppCount: enabled ? FIXED_COUNT : 0,
    })
  }

  return (
    <div className={`rounded-xl border-2 p-4 flex flex-col gap-4 transition-colors ${
      value.enabled
        ? 'border-accent-yellow bg-accent-yellow/5'
        : 'border-border bg-bg-card'
    }`}>
      {/* 標頭列 */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-[3px] text-accent-yellow uppercase font-[Orbitron,sans-serif]">
              Super Factory
            </span>
            <span className="text-[10px] text-accent-yellow/70 border border-accent-yellow/40 rounded px-1.5 py-0.5">
              年度限定
            </span>
          </div>
          <div className="text-[11px] text-text-dim mt-0.5">超級工廠活動資源（每種上限 ×{FIXED_COUNT}，可填入目前剩餘量）</div>
        </div>

        {/* Toggle 開關 */}
        <button
          onClick={toggle}
          className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
            value.enabled ? 'bg-accent-yellow' : 'bg-bg-dark border border-border'
          }`}
          aria-label={value.enabled ? '停用超級工廠資源' : '啟用超級工廠資源'}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              value.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* 資源卡片 */}
      {value.enabled && (
        <div className="grid grid-cols-3 gap-3">
          {SF_ITEMS.map(({ key, countKey, imgFile, name, desc, rainbow }) => (
            <div
              key={key}
              className={`relative rounded-xl border overflow-hidden flex flex-col items-center gap-2 p-3 bg-bg-dark ${
                rainbow ? 'border-transparent' : 'border-border'
              }`}
              style={rainbow ? {
                // 深色底 + 彩色疊層：與其他兩張卡同樣不透明，避免只有它半透明顯得突兀
                backgroundImage: 'linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(234,179,8,0.12) 25%, rgba(34,197,94,0.12) 50%, rgba(6,182,212,0.12) 75%, rgba(168,85,247,0.15) 100%)',
                borderImage: 'linear-gradient(135deg, #ef4444, #eab308, #22c55e, #06b6d4, #a855f7) 1',
              } : undefined}
            >
              <img
                src={assetUrl(`images/mechs/mech_models/${imgFile}`)}
                alt={name}
                className="w-14 h-14 object-contain"
              />
              <div className="text-center">
                <div className={`text-[12px] font-bold ${rainbow ? 'text-transparent bg-clip-text bg-gradient-to-r from-red-400 via-yellow-400 to-purple-400' : 'text-text-primary'}`}>
                  {name}
                </div>
                <div className="text-[10px] text-text-dim mt-0.5 leading-tight">{desc}</div>
              </div>
              <Stepper
                value={value[countKey]}
                onChange={(n) => onChange({ ...value, [countKey]: n })}
                min={0}
                max={FIXED_COUNT}
              />
            </div>
          ))}
        </div>
      )}

      {!value.enabled && (
        <div className="text-[12px] text-text-dim text-center py-1">
          啟用後將優先使用超級工廠資源進行計算
        </div>
      )}
    </div>
  )
}
