import { useRef, type KeyboardEvent } from 'react'
import { LayoutGroup, m, useReducedMotion } from 'motion/react'
import type { ModelCategory } from '../lib/models/types.ts'
import { fadeQuick, springSnappy } from '../lib/motion.ts'
import { Pressable } from './motion/Pressable.tsx'

const TABS: { id: ModelCategory; label: string; panelId: string }[] = [
  { id: 'image', label: 'Image', panelId: 'panel-image' },
  { id: 'video', label: 'Video', panelId: 'panel-video' },
  { id: 'audio', label: 'Audio', panelId: 'panel-audio' },
]

export function CategoryTabs({
  value,
  onChange,
  disabled,
}: {
  value: ModelCategory
  /** Return false to abort the change (e.g. dirty confirm cancelled). */
  onChange: (v: ModelCategory) => boolean | void
  disabled?: boolean
}) {
  const reduce = useReducedMotion()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  function focusActiveTab() {
    const activeIdx = TABS.findIndex((t) => t.id === value)
    if (activeIdx >= 0) tabRefs.current[activeIdx]?.focus()
  }

  function focusTab(index: number) {
    const tab = TABS[index]
    if (!tab) return
    const ok = onChange(tab.id)
    if (ok === false) return
    tabRefs.current[index]?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return
    const current = TABS.findIndex((t) => t.id === value)
    if (current < 0) return

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowUp': {
        e.preventDefault()
        focusTab((current - 1 + TABS.length) % TABS.length)
        break
      }
      case 'ArrowRight':
      case 'ArrowDown': {
        e.preventDefault()
        focusTab((current + 1) % TABS.length)
        break
      }
      case 'Home': {
        e.preventDefault()
        focusTab(0)
        break
      }
      case 'End': {
        e.preventDefault()
        focusTab(TABS.length - 1)
        break
      }
      default:
        break
    }
  }

  return (
    <LayoutGroup id="category-tabs">
      <div
        role="tablist"
        aria-label="Model category"
        onKeyDown={onKeyDown}
        className="relative flex w-full shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--bg)]"
      >
        {TABS.map((tab, index) => {
          const active = tab.id === value
          return (
            <Pressable
              key={tab.id}
              ref={(node) => {
                tabRefs.current[index] = node
              }}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={active}
              aria-controls={tab.panelId}
              tabIndex={active ? 0 : -1}
              disabled={disabled}
              onClick={() => {
                const ok = onChange(tab.id)
                if (ok === false) focusActiveTab()
              }}
              scaleTo={0.98}
              className={`relative flex min-h-10 flex-1 cursor-pointer items-center justify-center px-3 py-2.5 text-[0.8125rem] font-semibold transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? 'text-[var(--on-accent)]'
                  : 'text-[var(--text)] hover:bg-[var(--surface-raised)]'
              }`}
            >
              {active && (
                <m.span
                  layoutId="category-tab-indicator"
                  className="absolute inset-0 z-0 bg-[var(--accent)]"
                  transition={reduce ? fadeQuick : springSnappy}
                  aria-hidden
                />
              )}
              <span className="relative z-10">{tab.label}</span>
            </Pressable>
          )
        })}
      </div>
    </LayoutGroup>
  )
}
