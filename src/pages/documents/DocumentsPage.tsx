import { assetUrl } from '../../utils/assets'

// 文件路徑相對 public/docs/（由 scripts/copy-docs.mjs 複製）。含中文，open 時以 encodeURI 處理。
const docUrl = (p: string) => encodeURI(assetUrl(`docs/${p}`))

interface DocItem {
  label: string
  desc: string
  path: string
}

interface DocCategory {
  label: string   // section 標籤（英文，呼應站內風格）
  title: string   // 中文分類名
  items: DocItem[]
}

const CATEGORIES: DocCategory[] = [
  {
    label: 'Overview',
    title: '網站概要',
    items: [
      {
        label: '網站概要總覽',
        desc: '這站是什麼、有哪些功能、資料哪裡來、目前做到哪了。第一次來的話從這份開始',
        path: '01_規劃書/鋼嵐工具站_規劃書.html',
      },
    ],
  },
  {
    label: 'Roadmap',
    title: '開發紀錄',
    items: [
      { label: '頁面規劃', desc: '各頁面的內容與版面規劃', path: '03_頁面規劃/index.html' },
      {
        label: '階段性開發計畫',
        desc: '各階段功能計畫的計畫書與進度表（執行中／觀察維護中／歷史記錄）',
        path: '05_階段性開發計畫/index.html',
      },
    ],
  },
  {
    label: 'Mechanics',
    title: '遊戲機制',
    items: [
      { label: '傷害公式', desc: '傷害計算的公式與規則整理', path: '02_技術文件/03_遊戲機制/傷害公式.html' },
      { label: '配裝模擬器流程', desc: '配裝模擬器的計算流程說明', path: '02_技術文件/03_遊戲機制/配裝模擬器流程.html' },
    ],
  },
]

export default function DocumentsPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="mb-6">
        <span className="text-[10px] font-bold tracking-[3px] text-accent-cyan uppercase font-[Orbitron,sans-serif]">Documents</span>
        <h1 className="text-3xl font-bold mt-2">文件</h1>
        <p className="text-text-secondary mt-2">本站的公開文件：網站概要、開發紀錄與遊戲機制整理。</p>
      </div>

      {/* 醒目免責橫幅 */}
      <div className="mb-8 rounded-xl border border-accent-orange/40 bg-accent-orange/10 px-5 py-4 flex items-start gap-3">
        <span className="text-xl leading-none mt-0.5">📌</span>
        <p className="text-sm text-text-secondary leading-relaxed">
          想快速了解本站，看<strong className="text-text-primary">網站概要總覽</strong>就夠了。
          其餘是<strong className="text-accent-orange">開發過程的紀錄</strong>，寫的是當下的想法與取捨，
          可能與最終實作或目前進度不同步，請勿當作正式說明。
        </p>
      </div>

      {CATEGORIES.map((cat) => (
        <section key={cat.title} className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[10px] font-bold tracking-[3px] text-accent-cyan uppercase font-[Orbitron,sans-serif]">{cat.label}</span>
            <span className="text-sm text-text-secondary">{cat.title}</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cat.items.map((item) => (
              <a
                key={item.path}
                href={docUrl(item.path)}
                target="_blank"
                rel="noopener noreferrer"
                className="group rounded-xl border border-border bg-bg-card overflow-hidden p-5 flex flex-col gap-3 no-underline transition-colors hover:border-accent-cyan/50"
              >
                <span className="self-start text-[10px] font-bold px-2 py-0.5 rounded border text-accent-cyan border-accent-cyan/40 bg-accent-cyan/10">
                  Doc
                </span>
                <div>
                  <div className="text-[15px] font-bold text-text-primary group-hover:text-white transition-colors">
                    {item.label}
                  </div>
                  <div className="text-[12px] text-text-dim mt-1 leading-relaxed">{item.desc}</div>
                </div>
                <span className="text-[11px] text-text-dim mt-auto">開啟文件 ↗</span>
              </a>
            ))}
          </div>
        </section>
      ))}

      {/* 技術文件不對外的說明。放在最後、樣式低調：它不是內容，是回答「為什麼點某些連結會 404」。
          實際的邊界由 scripts/copy-docs.mjs 的白名單保證（不複製 → 站上根本沒這些檔案），這裡只是說明。 */}
      <div className="mt-10 rounded-xl border border-border bg-bg-card px-5 py-4 flex items-start gap-3">
        <span className="text-base leading-none mt-0.5">🔒</span>
        <p className="text-[12px] text-text-dim leading-relaxed">
          系統架構、資料模型、資料庫設計與後台操作手冊等<strong className="text-text-secondary">技術文件不對外公開</strong>，
          僅保留在原始碼庫中供維護者查閱——這些檔案不會被打包進網站，而不是隱藏連結而已。
          因此上列文件中若有連結指向技術文件或已下架的舊文件（如早期的開發進度表），點了會找不到頁面，這是正常的。
        </p>
      </div>
    </div>
  )
}
