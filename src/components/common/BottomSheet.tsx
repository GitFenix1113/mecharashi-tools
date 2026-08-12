import { createPortal } from 'react-dom'

interface Props {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}

export function BottomSheet({ open, onClose, children }: Props) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative bg-bg-card border-t border-border-accent rounded-t-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 flex items-center justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>
        <button
          className="absolute top-2 right-3 w-8 h-8 flex items-center justify-center rounded-full text-text-dim hover:text-text-primary hover:bg-bg-dark transition-colors text-lg leading-none"
          onClick={onClose}
          aria-label="關閉"
        >
          ✕
        </button>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-1 pb-8">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
