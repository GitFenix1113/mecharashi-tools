import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'
import { FallbackImage } from '../common/FallbackImage'
import { ClassIcon } from '../icons/ClassIcon'
import { pilotClassMeta } from '../../data/pilotClasses'
import { matchesLoreQuery, type LoreGroup, type LorePilot, type LoreSort } from './loreRoster'
import { pilotHeadCandidates } from './loreStageArt'

/**
 * 機師切換列＋機師名冊（PLAN-042-D A-3／A-4／F-5）。
 *
 * 收合時是底部一條膠囊：可橫捲的圓形頭像列（目前這位置中、兩端漸隱、滾輪直接橫捲、滑過顯示名字）、‹ ›、序號、「名冊」。
 * 膠囊平常半沉在視窗底緣、只露出上半截（站長 2026-10-13）：滑鼠移上去／鍵盤焦點由 CSS 升起，
 * 觸控沒有 hover，點一下半露的列先升起（這一下不觸發按鈕），捲動館內或點列外再收回。
 * 點「名冊」（或按 /、手機在列上往上滑）整條膠囊長成名冊面板：
 *   ① 面板從膠囊的形狀長出來（clip-path 補間），
 *   ② 列上看得到的那幾顆頭像 FLIP 飛進名冊裡各自的格子，
 *   ③ 其他頭像以目前這位為圓心一圈圈浮現。
 * 選了人：那顆頭像飛回列上「目前」的位置、面板縮回膠囊，頁面同時開始換人（霧面後面）。
 *
 * 兩個東西放在同一個元件，是因為飛行動畫要同時量兩邊的位置。
 * 動畫全用 Web Animations API（element.animate），收尾一律 cancel()，不在 DOM 上留 inline 樣式。
 *
 * ⚠ 名冊是 fixed 浮層、自己有捲動容器：不違反「館內唯一 scrollport」（M-08 講的是館內正文的垂直捲動），
 *   並以 `overscroll-behavior: contain` 防止捲到底時帶動後面的頁面。
 * ⚠ 飛行中的頭像是複製一顆放在 fixed 圖層（.lore-fly）：放在面板裡會被 clip-path 與捲動容器裁掉。
 */
export interface LoreSwitcherHandle {
  open: (focusSearch?: boolean) => void
  close: () => void
}

export interface LoreSwitcherProps {
  ref?: Ref<LoreSwitcherHandle>
  /** 名冊分組（＝館首頁的排序）。成員帶 pilotLore 的英文名（withLoreNames），搜尋與 title 要用 */
  groups: readonly LoreGroup<LorePilot>[]
  /** 攤平的名冊順序：切換列、‹ › 照它走 */
  order: readonly LorePilot[]
  currentId: string
  sort: LoreSort
  onSortChange: (sort: LoreSort) => void
  /** 各機師的章節數、外觀數（名冊的紅標與 +N、篩選用） */
  chapterCount: (id: string) => number
  skinCount: (p: LorePilot) => number
  /** 換人；dir＝在名冊順序上往後（1）或往前（-1） */
  onSelect: (id: string, dir: 1 | -1) => void
  onOpenChange?: (open: boolean) => void
  onHover?: (p: LorePilot) => void
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const isMobile = () => typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches
const visibleIn = (r: DOMRect, c: DOMRect) => r.bottom > c.top + 6 && r.top < c.bottom - 6 && r.right > c.left && r.left < c.right
const insetOf = (r: DOMRect, box: DOMRect, radius: number) =>
  `inset(${r.top - box.top}px ${box.right - r.right}px ${box.bottom - r.bottom}px ${r.left - box.left}px round ${radius}px)`
const endClip = () => (isMobile() ? 'inset(0px 0px 0px 0px round 20px 20px 0px 0px)' : 'inset(0px 0px 0px 0px round 22px)')

/** 共享元素式的飛行：複製一顆頭像放在 fixed 圖層，從 from 的位置／大小飛到 to。回傳飛完的那顆（呼叫端負責移除）。 */
function flyClone(src: string, from: DOMRect | DOMRectReadOnly, to: { left: number; top: number; width: number; height: number }, opts: KeyframeAnimationOptions) {
  const el = document.createElement('span')
  el.className = 'lore-fly'
  const img = document.createElement('img')
  img.src = src
  img.alt = ''
  el.appendChild(img)
  Object.assign(el.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` })
  document.body.appendChild(el)
  const anim = el.animate([
    { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})` },
    { transform: 'translate(0px, 0px) scale(1)' },
  ], opts)
  return anim.finished.then(() => el, () => el)
}

function highlight(name: string, q: string) {
  const i = q ? name.toLowerCase().indexOf(q) : -1
  if (i < 0) return name
  return <>{name.slice(0, i)}<mark>{name.slice(i, i + q.length)}</mark>{name.slice(i + q.length)}</>
}

export default function LoreSwitcher({
  ref, groups, order, currentId, sort, onSortChange, chapterCount, skinCount, onSelect, onOpenChange, onHover,
}: LoreSwitcherProps) {
  const dockRef = useRef<HTMLElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const rosterRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const openBtnRef = useRef<HTMLButtonElement>(null)
  /** 開啟前量好的「列上看得到的頭像」位置（id → rect）與膠囊外框 */
  const flightFrom = useRef<{ thumbs: Map<string, { rect: DOMRect; src: string }>; pill: DOMRect } | null>(null)
  const focusSearch = useRef(false)
  const busy = useRef(false)

  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [onlyCh, setOnlyCh] = useState(false)
  const [onlySkin, setOnlySkin] = useState(false)
  /** 觸控把半沉的列點起來了（滑鼠與鍵盤走 CSS，不經過這裡） */
  const [raised, setRaised] = useState(false)
  /** 這一下點擊只是把列升起來，不交給底下的按鈕（想看清楚是誰，不該先換了人） */
  const swallowTap = useRef(false)

  const idx = Math.max(0, order.findIndex((p) => p.id === currentId))
  const totalCh = useMemo(() => order.filter((p) => chapterCount(p.id) > 0).length, [order, chapterCount])
  const totalSkin = useMemo(() => order.filter((p) => skinCount(p) > 0).length, [order, skinCount])

  // ── 收合列：目前這位捲到列中央 ───────────────────────────────────────────
  const centerStrip = useCallback((id: string, smooth: boolean) => {
    const strip = stripRef.current
    const t = strip?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
    if (!strip || !t) return
    const sr = strip.getBoundingClientRect(), tr = t.getBoundingClientRect()
    // 目前這位會從 38px 長到 44px，用終值算中心
    const grow = t.getAttribute('aria-current') ? (44 - tr.width) / 2 : 0
    strip.scrollTo({ left: strip.scrollLeft + (tr.left - sr.left) + tr.width / 2 + grow - sr.width / 2, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' })
  }, [])
  const firstCenter = useRef(true)
  useLayoutEffect(() => {
    centerStrip(currentId, !firstCenter.current)
    firstCenter.current = false
  }, [currentId, sort, centerStrip])

  // 滾輪直接橫捲（不用按 Shift）。React 的 onWheel 是 passive，preventDefault 無效，所以自己掛
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      strip.scrollLeft += e.deltaY
      e.preventDefault()
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => strip.removeEventListener('wheel', onWheel)
  }, [])

  const showTip = (el: HTMLElement, p: LorePilot) => {
    const tip = tipRef.current
    if (!tip) return
    const r = el.getBoundingClientRect()
    // 列可能正從半沉的位置升起來（游標一進來就開始升）：扣掉列目前還沉著的距離，提示才會對準升起後的頭像
    const dock = dockRef.current
    const sunk = dock ? new DOMMatrixReadOnly(getComputedStyle(dock).transform).m42 : 0
    tip.replaceChildren(document.createTextNode(p.name))
    const small = document.createElement('small')
    small.textContent = `${p.class}${p.debutVersion ? ` · v${p.debutVersion}` : ''}`
    tip.appendChild(small)
    tip.style.left = `${r.left + r.width / 2}px`
    tip.style.top = `${r.top - sunk - 36}px`
    tip.classList.add('is-on')
    onHover?.(p)
  }
  const hideTip = () => tipRef.current?.classList.remove('is-on')

  // ── 名冊：開 ──────────────────────────────────────────────────────────────
  const openRoster = useCallback((withSearch = false) => {
    if (open || busy.current) return
    hideTip()
    const strip = stripRef.current, dock = dockRef.current
    if (!strip || !dock) return
    const sr = strip.getBoundingClientRect()
    const thumbs = new Map<string, { rect: DOMRect; src: string }>()
    strip.querySelectorAll<HTMLElement>('.lore-dock__t').forEach((t) => {
      const r = t.getBoundingClientRect()
      const img = t.querySelector('img')
      if (img?.currentSrc && r.right > sr.left + 12 && r.left < sr.right - 12) thumbs.set(t.dataset.id!, { rect: r, src: img.currentSrc })
    })
    flightFrom.current = { thumbs, pill: dock.getBoundingClientRect() }
    focusSearch.current = withSearch
    busy.current = true
    setOpen(true)
    onOpenChange?.(true)
  }, [open, onOpenChange])

  // 名冊掛上 DOM 之後才量得到終點：在 layout effect 裡跑開啟動畫（畫面還沒畫出來，不會先閃一幀完整面板）
  useLayoutEffect(() => {
    if (!open) return
    const roster = rosterRef.current, body = bodyRef.current, scrim = scrimRef.current
    const from = flightFrom.current
    if (!roster || !body || !scrim || !from) return
    const cur = body.querySelector<HTMLElement>('.lore-ra[aria-current="true"]')
    if (cur) {
      const br0 = body.getBoundingClientRect(), cr0 = cur.getBoundingClientRect()
      body.scrollTop += cr0.top - br0.top - br0.height / 2 + cr0.height / 2
    }
    const finish = () => {
      roster.classList.add('is-settled')
      busy.current = false
      if (focusSearch.current || !isMobile()) searchRef.current?.focus({ preventScroll: true })
    }
    if (reducedMotion()) { finish(); return }
    const box = roster.getBoundingClientRect()
    const grow = roster.animate([{ clipPath: insetOf(from.pill, box, isMobile() ? 16 : from.pill.height / 2) }, { clipPath: endClip() }],
      { duration: 540, easing: 'cubic-bezier(.2,.8,.2,1)' })
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' })
    roster.querySelector('.lore-roster__head')?.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 170, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' })
    roster.querySelector('.lore-roster__foot')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 320, fill: 'backwards' })
    body.querySelectorAll('.lore-rg__h').forEach((h, i) => h.animate([{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 200 + i * 45, easing: 'ease-out', fill: 'backwards' }))
    // 頭像：列上看得到的飛過來，其他的以目前這位為圓心一圈圈浮現
    const br = body.getBoundingClientRect()
    const c = cur?.querySelector('.lore-ra__img')?.getBoundingClientRect()
    const cx = c ? c.left + c.width / 2 : br.left + br.width / 2
    const cy = c ? c.top + c.height / 2 : br.top + br.height / 2
    body.querySelectorAll<HTMLElement>('.lore-ra').forEach((el) => {
      const img = el.querySelector<HTMLElement>('.lore-ra__img')
      if (!img) return
      const r = img.getBoundingClientRect()
      if (!visibleIn(r, br)) return
      const f = from.thumbs.get(el.dataset.id!)
      if (f) {
        img.style.opacity = '0'
        void flyClone(f.src, f.rect, r, { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)' }).then((clone) => { img.style.opacity = ''; clone.remove() })
        el.querySelectorAll('.lore-ra__name, .lore-ra__badge, .lore-ra__skins').forEach((x) => x.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 440, fill: 'backwards' }))
      } else {
        const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy)
        el.animate([{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'none' }],
          { duration: 440, delay: 160 + Math.min(d / 2.2, 480), easing: 'cubic-bezier(.34,1.45,.64,1)', fill: 'backwards' })
      }
    })
    grow.finished.then(finish, finish)
  }, [open])

  // ── 名冊：收（選了人就帶著那位飛回列上）────────────────────────────────────
  const closeRoster = useCallback((selectId?: string) => {
    if (!open || busy.current) return
    const roster = rosterRef.current, body = bodyRef.current, scrim = scrimRef.current, dock = dockRef.current, strip = stripRef.current
    if (!roster || !body || !scrim || !dock || !strip) { setOpen(false); onOpenChange?.(false); return }
    busy.current = true
    const target = selectId ? order.findIndex((p) => p.id === selectId) : -1
    const changing = target >= 0 && order[target].id !== currentId
    const targetId = changing ? order[target].id : currentId
    // ① 收合列先把目標捲到中央（此時還隱藏著），量出頭像要飛回去的位置
    const t = strip.querySelector<HTMLElement>(`[data-id="${CSS.escape(targetId)}"]`)
    if (t) {
      const sr = strip.getBoundingClientRect(), tr = t.getBoundingClientRect()
      strip.scrollLeft += (tr.left - sr.left) + tr.width / 2 - sr.width / 2
    }
    const pill = dock.getBoundingClientRect(), box = roster.getBoundingClientRect()
    const src = body.querySelector<HTMLElement>(`.lore-ra[data-id="${CSS.escape(targetId)}"] .lore-ra__img`)
    roster.classList.remove('is-settled')
    if (changing) onSelect(targetId, target > idx ? 1 : -1)   // 舞台同時開始換人（在霧面後面）
    const done = (clone: HTMLElement | null) => {
      if (src) src.style.opacity = ''
      setOpen(false)
      onOpenChange?.(false)
      busy.current = false
      if (clone) void clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140 }).finished.then(() => clone.remove(), () => clone.remove())
      openBtnRef.current?.focus({ preventScroll: true })
    }
    if (reducedMotion()) { done(null); return }
    // ② 選中的頭像飛回列上「目前」的位置（終值 44px）
    let flight: Promise<HTMLElement | null> = Promise.resolve(null)
    const tr2 = t?.getBoundingClientRect()
    const srcImg = src?.querySelector('img')
    if (src && tr2 && srcImg?.currentSrc && visibleIn(src.getBoundingClientRect(), body.getBoundingClientRect())) {
      const cx = tr2.left + tr2.width / 2, cy = tr2.top + tr2.height / 2
      flight = flyClone(srcImg.currentSrc, src.getBoundingClientRect(), { left: cx - 22, top: cy - 22, width: 44, height: 44 }, { duration: 560, easing: 'cubic-bezier(.5,0,.15,1)' })
      src.style.opacity = '0'
    }
    // ③ 內容先淡出，面板再縮回膠囊
    body.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' })
    roster.querySelector('.lore-roster__head')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' })
    roster.querySelector('.lore-roster__foot')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' })
    const shrink = roster.animate([{ clipPath: endClip() }, { clipPath: insetOf(pill, box, isMobile() ? 16 : pill.height / 2) }],
      { duration: 460, delay: 70, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' })
    scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, fill: 'forwards' })
    shrink.finished.then(() => flight, () => flight).then(done)
  }, [open, order, currentId, idx, onSelect, onOpenChange])

  useImperativeHandle(ref, () => ({ open: openRoster, close: () => closeRoster() }), [openRoster, closeRoster])

  // 名冊開著時：Esc 收合（也攔下來，不讓頁面拿去關別的）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      closeRoster()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, closeRoster])

  // 手機：在切換列上往上滑 → 展開
  const touchY = useRef<number | null>(null)

  // 觸控升起的列：捲動館內、或點到列以外的地方就收回去。名冊開著時不收——
  // 收合名冊時頭像要飛回列上，列若同時在往下沉，飛行的終點會對不上。
  useEffect(() => {
    if (!raised || open) return
    const dock = dockRef.current
    const scroller = dock?.closest<HTMLElement>('.lore-scroll')
    const lower = () => setRaised(false)
    const onPointerDown = (e: PointerEvent) => { if (!dock?.contains(e.target as Node)) lower() }
    document.addEventListener('pointerdown', onPointerDown, true)
    scroller?.addEventListener('scroll', lower, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      scroller?.removeEventListener('scroll', lower)
    }
  }, [raised, open])

  const query = q.trim().toLowerCase()
  const compact = sort === 'debut' || !!query || onlyCh || onlySkin
  const shownGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((p) => matchesLoreQuery(p, q) && (!onlyCh || chapterCount(p.id) > 0) && (!onlySkin || skinCount(p) > 0)) }))
    .filter((g) => g.items.length)
  const shownCount = shownGroups.reduce((n, g) => n + g.items.length, 0)

  return (
    <>
      <nav
        ref={dockRef}
        className={`lore-dock${open ? ' is-hidden' : ''}${raised ? ' is-raised' : ''}`}
        aria-label="切換機師"
        onPointerDown={(e) => {
          swallowTap.current = e.pointerType !== 'mouse' && !raised
          if (swallowTap.current) setRaised(true)
        }}
        // 手勢被瀏覽器接去捲動（橫捲頭像、上滑開名冊）就不會有 click：旗標不能留到下一次
        onPointerCancel={() => { swallowTap.current = false }}
        onClickCapture={(e) => {
          // detail 0＝鍵盤觸發的 click（Enter／空白鍵），一律放行
          const swallow = swallowTap.current && e.detail > 0
          swallowTap.current = false
          if (!swallow) return
          e.preventDefault()
          e.stopPropagation()
        }}
        onTouchStart={(e) => { touchY.current = e.touches[0]?.clientY ?? null }}
        onTouchEnd={(e) => {
          const t = e.changedTouches[0]
          if (touchY.current !== null && t && t.clientY - touchY.current < -36) openRoster()
          touchY.current = null
        }}
      >
        <button type="button" className="lore-dock__arrow" aria-label="上一位" title="上一位（←）"
          onClick={() => onSelect(order[(idx - 1 + order.length) % order.length].id, -1)}>‹</button>
        <div ref={stripRef} className="lore-dock__strip" onPointerLeave={hideTip} onScroll={hideTip}>
          {order.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="lore-dock__t"
              data-id={p.id}
              aria-label={p.name}
              aria-current={p.id === currentId ? 'true' : undefined}
              onPointerEnter={(e) => showTip(e.currentTarget, p)}
              onClick={() => { if (p.id !== currentId) onSelect(p.id, i > idx ? 1 : -1) }}
            >
              <FallbackImage candidates={pilotHeadCandidates(p)} alt="" loading="lazy" decoding="async" fallback={null} />
            </button>
          ))}
        </div>
        <button type="button" className="lore-dock__arrow" aria-label="下一位" title="下一位（→）"
          onClick={() => onSelect(order[(idx + 1) % order.length].id, 1)}>›</button>
        <span className="lore-dock__count">{String(idx + 1).padStart(2, '0')} / {order.length}</span>
        <button ref={openBtnRef} type="button" className="lore-dock__open" aria-expanded={open} aria-controls="lore-roster"
          title="展開機師名冊（/）" onClick={() => openRoster()}>
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            {[3.2, 8, 12.8].flatMap((y) => [3.2, 8, 12.8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.9" />))}
          </svg>
          <span>名冊</span><kbd>/</kbd>
        </button>
      </nav>
      <div ref={tipRef} className="lore-tip" aria-hidden="true" />

      {open && (
        <>
          <div ref={scrimRef} className="lore-scrim" onClick={() => closeRoster()} />
          <div ref={rosterRef} id="lore-roster" className="lore-roster" role="dialog" aria-modal="true" aria-label="機師名冊">
            <div className="lore-roster__head">
              <div className="lore-roster__title">
                機師名冊 <small>{shownCount === order.length ? `${order.length} 位` : `${shownCount} / ${order.length} 位`}</small>
              </div>
              <label className="lore-roster__search">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.6" /><path d="M10.4 10.4 14 14" /></svg>
                <input
                  ref={searchRef}
                  type="search"
                  value={q}
                  placeholder="搜尋名字、英文名、陣營、版本…"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="搜尋機師"
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    const first = shownGroups[0]?.items[0]
                    if (first) closeRoster(first.id)
                  }}
                />
              </label>
              <span className="lore-seg">
                <span className="lore-seg__lbl">分組</span>
                <button type="button" aria-pressed={sort === 'class'} onClick={() => onSortChange('class')}>職業</button>
                <button type="button" aria-pressed={sort === 'debut'} onClick={() => onSortChange('debut')}>登場版本</button>
              </span>
              <button type="button" className="lore-chipbtn" aria-pressed={onlyCh} onClick={() => setOnlyCh((v) => !v)}>有逸聞 {totalCh}</button>
              <button type="button" className="lore-chipbtn" aria-pressed={onlySkin} onClick={() => setOnlySkin((v) => !v)}>有外觀 {totalSkin}</button>
              <button type="button" className="lore-roster__close" onClick={() => closeRoster()}>收合 ⌄</button>
            </div>
            <div ref={bodyRef} className={`lore-roster__body${compact ? ' is-compact' : ''}`}>
              {shownGroups.length === 0 && <p className="lore-rg__empty">找不到符合「{q.trim()}」的機師</p>}
              {shownGroups.map((g) => {
                const tone = sort === 'class' ? (pilotClassMeta(g.key)?.paper ?? 'var(--lore-ink-2)') : 'var(--lore-ink-2)'
                return (
                  <section key={g.key} className="lore-rg" style={{ '--tone': tone } as React.CSSProperties}>
                    <h3 className="lore-rg__h">
                      {sort === 'class' && <ClassIcon pilotClass={g.key} size={18} decorative />}
                      {g.label}<small>{g.items.length}</small>
                    </h3>
                    <div className="lore-rg__grid">
                      {g.items.map((p) => {
                        const ch = chapterCount(p.id), sk = skinCount(p)
                        return (
                          <button
                            key={p.id}
                            type="button"
                            className="lore-ra"
                            data-id={p.id}
                            aria-current={p.id === currentId ? 'true' : undefined}
                            title={[p.fullName || p.name, p.nameEn, p.class, p.debutVersion && `v${p.debutVersion}`].filter(Boolean).join(' · ')}
                            style={{ '--tone': pilotClassMeta(p.class)?.paper ?? 'var(--lore-ink-2)' } as React.CSSProperties}
                            onPointerEnter={() => onHover?.(p)}
                            onClick={() => closeRoster(p.id)}
                          >
                            <span className="lore-ra__img">
                              <FallbackImage candidates={pilotHeadCandidates(p)} alt="" loading="lazy" decoding="async" fallback={null} />
                            </span>
                            <span className="lore-ra__name">{highlight(p.name, query)}</span>
                            {ch > 0 && <span className="lore-ra__badge" title={`${ch} 章逸聞`}>{ch}</span>}
                            {sk > 0 && <span className="lore-ra__skins" title={`另有 ${sk} 套外觀`}>+{sk}</span>}
                          </button>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
            <div className="lore-roster__foot">
              <span><kbd>/</kbd>開名冊並搜尋</span><span><kbd>Enter</kbd>選第一位</span><span><kbd>Esc</kbd>收合</span><span><kbd>←</kbd><kbd>→</kbd>收合時換上／下一位</span>
            </div>
          </div>
        </>
      )}
    </>
  )
}
