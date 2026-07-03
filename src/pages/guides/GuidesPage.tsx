import { Link } from 'react-router-dom'

// 攻略入口列表：資料工具型攻略（自動生成）與未來的手寫攻略皆可掛在此
const GUIDES = [
  {
    to:    '/guides/component-drops',
    label: '元件掉落總表',
    desc:  '各關 BOSS 掉落的元件一覽，可切換觸/應元件分頁、匯出成圖片分享',
    tag:   'Data',
    tagColor: 'text-accent-orange border-accent-orange/40 bg-accent-orange/10',
    gradient: 'linear-gradient(135deg, rgba(249,115,22,0.10), rgba(234,179,8,0.06))',
    border: 'linear-gradient(135deg, #f97316, #eab308)',
  },
]

export default function GuidesPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="mb-8">
        <span className="text-[10px] font-bold tracking-[3px] text-accent-orange uppercase font-[Orbitron,sans-serif]">Guides</span>
        <h1 className="text-3xl font-bold mt-2">攻略</h1>
        <p className="text-text-secondary mt-2">資料整理、配裝推薦與關卡攻略。</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {GUIDES.map((g) => (
          <Link
            key={g.to}
            to={g.to}
            className="group rounded-xl border overflow-hidden p-5 flex flex-col gap-3 no-underline transition-opacity hover:opacity-90"
            style={{
              background: g.gradient,
              borderImage: `${g.border} 1`,
              borderWidth: '1px',
              borderStyle: 'solid',
            }}
          >
            <span className={`self-start text-[10px] font-bold px-2 py-0.5 rounded border ${g.tagColor}`}>
              {g.tag}
            </span>
            <div>
              <div className="text-[15px] font-bold text-text-primary group-hover:text-white transition-colors">
                {g.label}
              </div>
              <div className="text-[12px] text-text-dim mt-1 leading-relaxed">{g.desc}</div>
            </div>
            <span className="text-[11px] text-text-dim mt-auto">前往 →</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
