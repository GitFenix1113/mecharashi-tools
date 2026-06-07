import { Link } from 'react-router-dom'

const TOOLS = [
  {
    to:    '/tools/rainbow-planner',
    label: '彩甲升級規劃器',
    desc:  '輸入持有零件與模組，自動規劃最優彩甲升級路線',
    tag:   'Tool',
    tagColor: 'text-accent-purple border-accent-purple/40 bg-accent-purple/10',
    gradient: 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(234,179,8,0.08), rgba(34,197,94,0.08), rgba(6,182,212,0.08), rgba(168,85,247,0.08))',
    border: 'linear-gradient(135deg, #ef4444, #eab308, #22c55e, #06b6d4, #a855f7)',
  },
]

export default function ToolsPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="mb-8">
        <span className="text-[10px] font-bold tracking-[3px] text-accent-purple uppercase font-[Orbitron,sans-serif]">Tools</span>
        <h1 className="text-3xl font-bold mt-2">工具</h1>
        <p className="text-text-secondary mt-2">配裝、規劃與計算輔助工具。</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TOOLS.map((tool) => (
          <Link
            key={tool.to}
            to={tool.to}
            className="group rounded-xl border overflow-hidden p-5 flex flex-col gap-3 no-underline transition-opacity hover:opacity-90"
            style={{
              background: tool.gradient,
              borderImage: `${tool.border} 1`,
              borderWidth: '1px',
              borderStyle: 'solid',
            }}
          >
            <span className={`self-start text-[10px] font-bold px-2 py-0.5 rounded border ${tool.tagColor}`}>
              {tool.tag}
            </span>
            <div>
              <div className="text-[15px] font-bold text-text-primary group-hover:text-white transition-colors">
                {tool.label}
              </div>
              <div className="text-[12px] text-text-dim mt-1 leading-relaxed">{tool.desc}</div>
            </div>
            <span className="text-[11px] text-text-dim mt-auto">前往 →</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
