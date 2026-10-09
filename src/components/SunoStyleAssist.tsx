import { useMutation } from '@tanstack/react-query'
import { Sparkles, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { boostMusicStyle } from '../lib/api.ts'
import { Pressable } from './motion/Pressable.tsx'

export function SunoStyleAssist({
  value,
  disabled,
  onApply,
}: {
  value: string
  disabled?: boolean
  onApply: (value: string) => void
}) {
  const [original, setOriginal] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const improve = useMutation({
    mutationFn: async () => (await boostMusicStyle(value)).data.result,
    onSuccess: (result) => {
      setOriginal(value)
      setSuggestion(result)
    },
  })

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="studio-label">Suno Style Assistant</p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">Compare Suno-friendly phrasing while keeping the original</p>
        </div>
        <Pressable
          className="studio-btn inline-flex items-center gap-1"
          disabled={disabled || improve.isPending || !value.trim()}
          onClick={() => improve.mutate()}
        >
          <Sparkles size={13} /> {improve.isPending ? 'Refining…' : 'Polish style'}
        </Pressable>
      </div>
      {suggestion && original !== null && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-[var(--radius-sm)] bg-[var(--bg)] p-3">
            <span className="studio-label">Original</span>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed">{original}</p>
          </div>
          <div className="rounded-[var(--radius-sm)] border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-3">
            <span className="studio-label">Suggestion</span>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed">{suggestion}</p>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Pressable className="studio-btn-primary flex-1" onClick={() => onApply(suggestion)}>Apply suggestion</Pressable>
            <Pressable className="studio-btn inline-flex items-center gap-1" onClick={() => onApply(original)}><Undo2 size={13} />Revert</Pressable>
          </div>
        </div>
      )}
      {improve.isError && <p className="studio-field-error mt-2">{(improve.error as Error).message}</p>}
    </div>
  )
}
