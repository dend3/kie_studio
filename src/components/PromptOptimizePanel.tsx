import { useId, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  fetchGrokStatus,
  fetchOptimizeProfile,
  optimizePrompt,
} from '../lib/api.ts'
import { Pressable } from './motion/Pressable.tsx'

const inputClass = 'studio-input'

export function PromptOptimizePanel({
  prompt,
  modelId,
  disabled,
  onApply,
}: {
  prompt: string
  modelId?: string | null
  disabled?: boolean
  onApply: (optimized: string) => void
}) {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [customInstructions, setCustomInstructions] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState<'generate' | 'optimize' | null>(
    null,
  )
  const [appliedProfileLabel, setAppliedProfileLabel] = useState<string | null>(
    null,
  )

  const statusQuery = useQuery({
    queryKey: ['grok-status'],
    queryFn: fetchGrokStatus,
    staleTime: 60_000,
    retry: false,
  })

  const profileQuery = useQuery({
    queryKey: ['optimize-profile', modelId ?? null],
    queryFn: () => fetchOptimizeProfile(modelId),
    enabled: statusQuery.data?.data.available === true,
    staleTime: 60_000,
  })

  const promptEmpty = !prompt.trim()
  const mode: 'generate' | 'optimize' = promptEmpty ? 'generate' : 'optimize'
  const customEmpty = !customInstructions.trim()

  const assist = useMutation({
    mutationFn: () =>
      optimizePrompt({
        prompt: promptEmpty ? undefined : prompt,
        customInstructions: customInstructions.trim() || undefined,
        modelId: modelId ?? undefined,
        mode,
      }),
    onSuccess: (res) => {
      setPreview(res.data.optimizedPrompt)
      setPreviewMode(res.data.mode ?? mode)
      setAppliedProfileLabel(res.data.profile?.label ?? null)
      setOpen(true)
    },
  })

  const available = statusQuery.data?.data.available === true
  if (statusQuery.isLoading || statusQuery.isError || !available) {
    return null
  }

  const busy = assist.isPending
  const canRun =
    !busy &&
    !disabled &&
    (mode === 'optimize' ? !promptEmpty : !customEmpty)
  const profile = profileQuery.data?.data

  const buttonLabel = busy
    ? mode === 'generate'
      ? 'Generating…'
      : 'Optimizing…'
    : mode === 'generate'
      ? 'Generate prompt'
      : 'Optimize prompt'

  const hint =
    mode === 'generate' && customEmpty
      ? 'Describe what you want in the custom instructions'
      : null

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      <Pressable
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--accent)]"
        aria-expanded={open}
        aria-controls={panelId}
        scaleTo={0.97}
      >
        {open ? (
          <ChevronDown size={14} strokeWidth={2} aria-hidden />
        ) : (
          <ChevronRight size={14} strokeWidth={2} aria-hidden />
        )}
        Optimize with Grok
      </Pressable>

      {open && (
        <div id={panelId} className="mt-2.5 space-y-2.5">
          {profile && (
            <p className="text-[11px] text-[var(--text-muted)]">
              {mode === 'generate' ? 'Generation rules' : 'Optimization rules'}:{' '}
              <span className="font-medium text-[var(--text)]">
                {profile.label}
              </span>
              {profile.hasGuide ? ' · dedicated guide available' : ''}
              <span className="mt-0.5 block truncate" title={profile.formula}>
                {profile.formula}
              </span>
            </p>
          )}

          <div>
            <label
              htmlFor="prompt-optimize-custom"
              className="studio-label mb-1.5"
            >
              {mode === 'generate'
                ? 'What you want / notes'
                : 'Custom instructions (optional)'}
              {mode === 'generate' && (
                <span className="ml-1 normal-case tracking-normal text-[var(--danger)]">
                  *
                </span>
              )}
            </label>
            <textarea
              id="prompt-optimize-custom"
              className={`${inputClass} min-h-16 resize-y text-xs`}
              value={customInstructions}
              disabled={busy || disabled}
              placeholder={
                mode === 'generate'
                  ? 'e.g. woman walking on a beach at dusk, cinematic, 6s'
                  : 'e.g. output in English / fixed camera / shorter'
              }
              onChange={(e) => setCustomInstructions(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Pressable
              className="studio-btn font-medium"
              disabled={!canRun}
              scaleTo={0.96}
              onClick={() => {
                setPreview(null)
                setPreviewMode(null)
                setAppliedProfileLabel(null)
                assist.reset()
                assist.mutate()
              }}
            >
              {buttonLabel}
            </Pressable>
            {hint && (
              <span className="text-[11px] text-[var(--text-muted)]">{hint}</span>
            )}
          </div>

          {assist.isError && (
            <p className="text-xs text-[var(--danger)]" role="alert">
              {assist.error instanceof Error
                ? assist.error.message
                : mode === 'generate'
                  ? 'Generation failed'
                  : 'Optimization failed'}
            </p>
          )}

          {preview !== null && (
            <div className="space-y-2 border-t border-[var(--border)] pt-3">
              <p className="text-xs font-medium text-[var(--text-muted)]">
                {previewMode === 'generate'
                  ? 'Generation preview'
                  : 'Optimization preview'}
                {appliedProfileLabel ? ` · ${appliedProfileLabel}` : ''}
              </p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                {preview}
              </pre>
              <div className="flex flex-wrap gap-2">
                <Pressable
                  className="studio-btn-primary w-auto px-3 py-1.5 text-xs disabled:opacity-50"
                  disabled={busy || disabled}
                  scaleTo={0.96}
                  onClick={() => {
                    onApply(preview)
                    setPreview(null)
                    setPreviewMode(null)
                    setAppliedProfileLabel(null)
                    assist.reset()
                  }}
                >
                  Apply
                </Pressable>
                <Pressable
                  className="studio-btn font-medium"
                  disabled={busy}
                  scaleTo={0.96}
                  onClick={() => {
                    setPreview(null)
                    setPreviewMode(null)
                    setAppliedProfileLabel(null)
                    assist.reset()
                  }}
                >
                  Discard
                </Pressable>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
