import type { ReactNode } from 'react'
import { LayoutGroup } from 'motion/react'
import { Material } from '../motion/Material.tsx'
import { FloatingChrome } from './FloatingChrome.tsx'
import {
  StudioModeToggle,
  type StudioWorkspaceMode,
} from './StudioModeToggle.tsx'

export type MobileStudioView = 'create' | 'history'
export type { StudioWorkspaceMode }

/**
 * IA locked: left create form · right gallery.
 * Precision Light — solid surfaces, h-dvh workspace.
 * Mobile: one full-height surface at a time, switched by tabs.
 * Workspace mode: Studio (form+gallery) or Agent (chat panel).
 */
export function StudioShell({
  chromeTitle,
  chromeSubtitle,
  chromeMeta,
  chromeTrailing,
  workspaceMode,
  onWorkspaceModeChange,
  form,
  canvas,
  agent,
  mobileView,
  historyCount,
  pendingCount,
  onMobileViewChange,
}: {
  chromeTitle: ReactNode
  chromeSubtitle?: ReactNode
  chromeMeta?: ReactNode
  chromeTrailing?: ReactNode
  workspaceMode: StudioWorkspaceMode
  onWorkspaceModeChange: (mode: StudioWorkspaceMode) => void
  form: ReactNode
  canvas: ReactNode
  agent?: ReactNode
  mobileView: MobileStudioView
  historyCount: number
  pendingCount?: number
  onMobileViewChange: (view: MobileStudioView) => void
}) {
  const isAgent = workspaceMode === 'agent'

  return (
    <LayoutGroup>
      <div className="mx-auto flex h-dvh max-w-[1600px] flex-col gap-2 overflow-hidden p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] md:gap-4 md:p-4">
        <FloatingChrome
          title={chromeTitle}
          subtitle={chromeSubtitle}
          meta={chromeMeta}
          center={
            <StudioModeToggle
              value={workspaceMode}
              onChange={onWorkspaceModeChange}
            />
          }
          trailing={chromeTrailing}
        />

        <div
          className={`shrink-0 lg:hidden ${isAgent ? 'invisible pointer-events-none' : ''}`}
          aria-hidden={isAgent}
        >
          <div className="studio-segment" role="tablist" aria-label="Display">
            <button
              type="button"
              role="tab"
              aria-selected={mobileView === 'create'}
              tabIndex={isAgent ? -1 : undefined}
              className={`studio-segment-item ${mobileView === 'create' ? 'bg-[var(--accent)] !text-[var(--on-accent)]' : ''}`}
              onClick={() => onMobileViewChange('create')}
            >
              Create
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobileView === 'history'}
              tabIndex={isAgent ? -1 : undefined}
              className={`studio-segment-item gap-1.5 ${mobileView === 'history' ? 'bg-[var(--accent)] !text-[var(--on-accent)]' : ''}`}
              onClick={() => onMobileViewChange('history')}
            >
              History <span className="tabular-nums">{historyCount}</span>
              {pendingCount ? (
                <span
                  className="size-1.5 rounded-full bg-[var(--warning)]"
                  aria-label={`${pendingCount} generating`}
                />
              ) : null}
            </button>
          </div>
        </div>

        {isAgent ? (
          <Material
            weight="panel"
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-xl)]"
            initial={false}
            role="main"
            aria-label="Agent mode"
          >
            {agent}
          </Material>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden lg:grid lg:grid-cols-[minmax(380px,440px)_1fr] lg:gap-3">
            <Material
              weight="panel"
              className={`material-panel-heavy min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-xl)] lg:flex ${mobileView === 'create' ? 'flex' : 'hidden'}`}
              initial={false}
              role="complementary"
              aria-label="Create form"
            >
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-5 pb-3">
                {form}
              </div>
            </Material>

            <Material
              weight="panel"
              className={`min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-xl)] lg:flex ${mobileView === 'history' ? 'flex' : 'hidden'}`}
              initial={false}
              role="main"
              aria-label="Generation history"
            >
              <div className="flex h-full min-h-0 flex-col overflow-hidden p-3 md:p-4">
                {canvas}
              </div>
            </Material>
          </div>
        )}
      </div>
    </LayoutGroup>
  )
}
