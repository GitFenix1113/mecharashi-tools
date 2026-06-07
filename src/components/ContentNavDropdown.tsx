import {
  useFloating,
  useHover,
  useInteractions,
  useDismiss,
  offset,
  flip,
  shift,
  autoUpdate,
  FloatingPortal,
  safePolygon,
} from '@floating-ui/react'
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

export interface ContentNavItem {
  to: string
  label: string
  icon: string
}

/**
 * 桌面版導覽列懸停下拉（資料圖鑑／攻略專區共用）。
 * hover 觸發鈕（label）展開子選項，沿用 header nav 的 active/hover 樣式。
 * 行動版由 Layout 的 More 面板處理，不使用本元件。
 */
export default function ContentNavDropdown({ label, items }: { label: string; items: ContentNavItem[] }) {
  const [isOpen, setIsOpen] = useState(false)
  const location = useLocation()
  const isActive = items.some((item) => location.pathname.startsWith(item.to))

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
  })

  const hover = useHover(context, {
    delay: { open: 80, close: 120 },
    handleClose: safePolygon(),
  })
  const dismiss = useDismiss(context)
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss])

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        className={`px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap cursor-pointer ${
          isActive || isOpen
            ? 'bg-accent-orange/10 text-accent-orange'
            : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
        }`}
      >
        {label} ▾
      </button>

      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 min-w-[10rem] bg-bg-dark border border-border-accent rounded-xl p-1.5 shadow-2xl flex flex-col gap-0.5"
          >
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setIsOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-lg text-sm no-underline transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-accent-orange/10 text-accent-orange'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
                  }`
                }
              >
                <span className="text-base leading-none">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
