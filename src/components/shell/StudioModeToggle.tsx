export type StudioWorkspaceMode = 'studio' | 'agent'

export function StudioModeToggle({
  value,
  onChange,
}: {
  value: StudioWorkspaceMode
  onChange: (mode: StudioWorkspaceMode) => void
}) {
  return (
    <div
      className="studio-segment w-full shrink-0 sm:w-auto"
      role="tablist"
      aria-label="Workspace mode"
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === 'studio'}
        className="studio-segment-item min-h-9 flex-1 px-3 sm:flex-none sm:px-4"
        onClick={() => onChange('studio')}
      >
        Studio
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'agent'}
        className="studio-segment-item min-h-9 flex-1 px-3 sm:flex-none sm:px-4"
        onClick={() => onChange('agent')}
      >
        Agent
      </button>
    </div>
  )
}
