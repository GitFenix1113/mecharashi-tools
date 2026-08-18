import { useState } from 'react'
import { usePatchVersions } from '../../hooks/usePatchVersions'
import HomeTabPanel from '../../components/home/HomeTabPanel'
import SiteTeamSection from '../../components/home/SiteTeamSection'
import SiteChangelog from '../../components/home/SiteChangelog'

export default function HomePage() {
  const { data: versions, loading, error } = usePatchVersions()
  const [tabExpanded, setTabExpanded] = useState(false)

  return (
    <div className="homepage-snap">

      {/* ── Page 1: Hero ── */}
      <section className="snap-page relative flex items-center overflow-hidden">
        {/* Left-to-right overlay: opaque on left for readability, fades to transparent on right */}
        <div className="absolute inset-0 bg-gradient-to-r from-bg-dark/85 via-bg-dark/50 lg:via-bg-dark/30 to-transparent pointer-events-none" />

        <div className="relative z-10 w-full max-w-[90vw] lg:max-w-[45vw] px-8 lg:px-16 flex flex-col gap-5">
          {/* Site name */}
          <div>
            <h1 className="font-[Orbitron,sans-serif] text-3xl sm:text-4xl lg:text-5xl font-black tracking-wider leading-tight bg-gradient-to-br from-white to-accent-orange bg-clip-text text-transparent">
              MECHARASHI<br />
              <span className="text-xl sm:text-2xl lg:text-3xl">
                Milkhama PawInfo Station
              </span>
            </h1>
            <p className="mt-3 text-text-secondary text-base font-semibold tracking-[0.2em]">
              獾迎你的到來！
            </p>
          </div>

          {/* Site changelog */}
          <SiteChangelog />

          {/* Site team */}
          <SiteTeamSection />

          {/* Scroll hint */}
          <div className="flex items-center gap-2 text-text-dim text-xs animate-bounce w-fit">
            <span>▼</span>
            <span className="tracking-widest">向下捲動看版本摘要</span>
          </div>
        </div>
      </section>

      {/* ── Page 2: Data Tab ── */}
      <section className="snap-page relative flex flex-col overflow-hidden">
        {/* Gradient overlay — darkens when expanded to keep readability over background image */}
        <div className={`absolute inset-0 pointer-events-none transition-all duration-500 ${
          tabExpanded
            ? 'bg-bg-dark/88'
            : 'bg-gradient-to-r from-bg-dark/90 via-bg-dark/60 lg:via-bg-dark/35 to-transparent'
        }`} />

        {/* Panel + copyright — expands width on toggle */}
        {/*
          收合寬度為什麼是 `min(96vw, max(48vw, 760px))` 而不是原本的
          `md:max-w-[70vw] lg:max-w-[48vw]`：

          原寫法的面板寬度**不是視窗寬度的單調函數**。1023px 時套 md（70vw＝716px），
          1024px 時 lg 生效（48vw＝492px）—— 把視窗拉寬 1px，面板反而縮水 224px。
          1024–1300px 這段（外接螢幕視窗化、iPad 橫向、小筆電）拿到的寬度比手機直立還窄，
          而甘特 6 週的最低需求是 110 + 6×80 ＝ 590px，於是**每一版都保證出現橫向捲軸**。

          斷崖無法靠移動斷點解決：兩個不同的 vw 比例在任何斷點都不可能連續
          （0.70·B 恆大於 0.48·B），移到 xl 只會讓落差從 224px 變成 281px。
          唯一的解法是引入 px 下限把曲線壓平。780px 這個值是實測湊出來的，四項相加：

            VersionQuickTable 的 minWidth   720px
            捲動容器的 border 左右各 1px       2px
            外層 p-4 內距（root 19px）        38px   ← 不是 32px
            tab 內容區的垂直捲軸              15px   ← 最容易漏算的一項
            ────────────────────────────────────
                                           775px → 取 780px 留餘裕

          取捨：1024–1620px 之間背景立繪會被蓋掉更多（1024px 最明顯，可見寬
          532→244px）。這是不可迴避的 —— 48vw ≥ 780px 需要視窗 ≥ 1625px，
          在那之下「露出立繪」與「內容不橫捲」數學上無法同時成立。
          1625px 以上與改動前完全相同。
        */}
        <div className={`relative z-10 flex flex-col flex-1 min-h-0 w-full transition-all duration-500 ease-in-out ${
          tabExpanded ? 'max-w-[96vw]' : 'max-w-[min(96vw,max(48vw,780px))]'
        }`}>
          <HomeTabPanel
            versions={versions}
            loading={loading}
            error={error}
            expanded={tabExpanded}
            onToggleExpand={() => setTabExpanded(v => !v)}
          />
          <div className="shrink-0 px-5 py-2 text-[11px] text-text-dim border-t border-border/50">
            米赫瑪超吉情豹站 — 非官方社群工具，與官方無關，無營利。99%圖片資源都來源於官方網站或WIKI
          </div>
        </div>
      </section>

    </div>
  )
}
