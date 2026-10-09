import {
  AnimatePresence,
  m,
  useReducedMotion,
  type PanInfo,
} from 'motion/react'
import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react'
import { project, springMomentum, springUi, fadeQuick } from '../../lib/motion.ts'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

type SpringSheetProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  /** Accessible name when no labelledby */
  label?: string
  labelledBy?: string
  className?: string
  /** Max width class, default max-w-3xl */
  maxWidthClass?: string
}

/**
 * Gesture-dismissible sheet: 1:1 drag down, velocity projection on release,
 * scrim opacity tracks drag. Interruptible — drag anytime while open.
 * Focus is trapped while open and restored to the previously focused element.
 */
export function SpringSheet({
  open,
  onClose,
  children,
  label,
  labelledBy,
  className = '',
  maxWidthClass = 'max-w-3xl',
}: SpringSheetProps) {
  const reduce = useReducedMotion()
  const closeRef = useRef(onClose)
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    const panel = panelRef.current
    if (!panel) return

    const focusables = () =>
      [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
      )

    // Defer so children (e.g. close button) are mounted
    const focusTimer = window.setTimeout(() => {
      const nodes = focusables()
      const preferred =
        nodes.find((el) => el.dataset.sheetInitialFocus === 'true') ?? nodes[0]
      preferred?.focus()
    }, 0)

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return

      const nodes = focusables()
      if (nodes.length === 0) {
        e.preventDefault()
        panel?.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || !panel?.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !panel?.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKey)
      const restore = restoreFocusRef.current
      if (restore && document.contains(restore)) {
        restore.focus()
      }
    }
  }, [open])

  function handleDragEnd(_: unknown, info: PanInfo) {
    const h = panelRef.current?.offsetHeight ?? 480
    const projected = info.offset.y + project(info.velocity.y)
    const shouldClose =
      projected > h * 0.22 || info.velocity.y > 700 || info.offset.y > h * 0.28
    if (shouldClose) {
      closeRef.current()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[var(--z-sheet)] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <m.button
            type="button"
            className="absolute inset-0 z-[var(--z-sheet-backdrop)] cursor-default border-0 bg-[var(--overlay)] p-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduce ? fadeQuick : springUi}
            onClick={onClose}
            aria-label="Close"
            tabIndex={-1}
          />
          <m.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={labelledBy ? undefined : label}
            aria-labelledby={labelledBy ?? (label ? titleId : undefined)}
            tabIndex={-1}
            className={`material material-sheet relative z-[var(--z-sheet)] flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[var(--radius-xl)] sm:rounded-[var(--radius-xl)] ${maxWidthClass} ${className}`}
            initial={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, y: 40, scale: 0.98 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, y: 48, scale: 0.99 }
            }
            transition={reduce ? fadeQuick : springMomentum}
            drag={reduce ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.04, bottom: 0.12 }}
            dragMomentum={false}
            onDragEnd={handleDragEnd}
            style={{ touchAction: 'none' }}
          >
            {label && !labelledBy && (
              <span id={titleId} className="sr-only">
                {label}
              </span>
            )}
            <div
              className="mx-auto mt-2.5 mb-1 h-1 w-10 shrink-0 rounded-full bg-[var(--border-strong)]"
              aria-hidden
            />
            {children}
          </m.div>
        </div>
      )}
    </AnimatePresence>
  )
}
