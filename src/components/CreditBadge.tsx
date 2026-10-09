import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { fetchCredits, fetchHealth } from '../lib/api.ts'
import { KIE_CREDITS_URL } from '../lib/kie.ts'
import { Pressable } from './motion/Pressable.tsx'

export function CreditBadge({
  lastUsed,
  compact = false,
}: {
  lastUsed?: number | null
  /** Narrow chrome (e.g. agent mode): balance only, hide purchase on xs. */
  compact?: boolean
}) {
  const purchaseButton = (
    <a
      href={KIE_CREDITS_URL}
      target="_blank"
      rel="noreferrer"
      className={`studio-btn shrink-0 self-stretch px-2.5 text-xs text-[var(--accent)] sm:px-3 ${
        compact ? 'hidden sm:inline-flex' : ''
      }`}
      aria-label="Buy credits"
    >
      <span className="sm:hidden">Buy</span>
      <span className="hidden sm:inline">Buy credits</span>
      <ExternalLink size={12} strokeWidth={2} aria-hidden />
    </a>
  )

  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    staleTime: 60_000,
  })

  const credits = useQuery({
    queryKey: ['credits'],
    queryFn: fetchCredits,
    enabled: health.data?.hasKey === true,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: 1,
  })

  if (health.isLoading) {
    return (
      <div className="flex items-stretch gap-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-[var(--text-muted)]">
          Loading credits…
        </div>
        {purchaseButton}
      </div>
    )
  }

  if (health.data && !health.data.hasKey) {
    return (
      <div className="flex items-stretch gap-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-3 py-2 text-xs font-medium text-[var(--warning)]">
          API key not set
        </div>
        {purchaseButton}
      </div>
    )
  }

  if (credits.isError) {
    return (
      <div className="flex items-stretch gap-2">
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--danger)]/25 bg-[var(--danger)]/8 px-3 py-2 text-xs text-[var(--danger)]">
          <span>Credit fetch error</span>
          <Pressable
            onClick={() => void credits.refetch()}
            className="studio-btn border-[var(--danger)]/30 px-2.5 py-0.5 font-medium text-[var(--danger)]"
            scaleTo={0.96}
          >
            Retry
          </Pressable>
        </div>
        {purchaseButton}
      </div>
    )
  }

  const remaining = credits.isLoading
    ? null
    : (credits.data?.data.credits ?? null)

  return (
    <div className="flex items-stretch gap-1.5 sm:gap-2">
      <div
        className={`rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-2 sm:px-3 ${
          compact ? 'py-1.5' : ''
        }`}
      >
        <div className="flex items-stretch gap-3">
        <div className={compact ? 'min-w-[48px]' : 'min-w-[64px] sm:min-w-[72px]'}>
          <div className="studio-label">{compact ? 'Balance' : 'Credits left'}</div>
          <div
            className={`mt-0.5 font-bold leading-none tabular-nums text-[var(--accent)] ${
              compact ? 'text-base' : 'text-lg'
            }`}
          >
            {remaining === null ? '…' : remaining.toLocaleString()}
          </div>
        </div>
        {!compact && (
          <>
            <div className="hidden w-px self-stretch bg-[var(--border)] sm:block" />
            <div className="hidden min-w-[72px] sm:block">
              <div className="studio-label">Recent usage</div>
              <div className="mt-0.5 text-lg font-bold leading-none tabular-nums text-[var(--text)]">
                {typeof lastUsed === 'number' ? (
                  <>
                    <span className="text-[var(--danger)]">−</span>
                    {lastUsed.toLocaleString()}
                  </>
                ) : (
                  <span className="text-[var(--text-muted)]">—</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      </div>
      {purchaseButton}
    </div>
  )
}
