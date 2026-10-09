import { useId, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import {
  addSnippet,
  loadSnippets,
  removeSnippet,
  type PromptSnippet,
} from '../lib/snippets.ts'
import { Pressable } from './motion/Pressable.tsx'

/**
 * よく使うプロンプト断片の保存・挿入パネル。
 * プロンプト textarea の直下に置く想定。
 */
export function PromptSnippets({
  prompt,
  disabled,
  onInsert,
}: {
  prompt: string
  disabled?: boolean
  onInsert: (text: string) => void
}) {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [snippets, setSnippets] = useState<PromptSnippet[]>(() =>
    loadSnippets(),
  )
  const [title, setTitle] = useState('')

  function handleSave() {
    if (!prompt.trim()) return
    setSnippets(addSnippet(title, prompt))
    setTitle('')
  }

  return (
    <div className="mt-2">
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
        Frequently used prompts
        {snippets.length > 0 && ` (${snippets.length})`}
      </Pressable>

      {open && (
        <div
          id={panelId}
          className="mt-2 space-y-2 border-t border-[var(--border)] pt-2"
        >
          <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
            Save phrases you reuse, like style or quality terms. Selecting one appends it to the current prompt.
          </p>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Name (e.g. anime style)"
              aria-label="Saved prompt name"
              disabled={disabled}
              className="studio-input min-w-0 flex-1 px-2 py-1.5 text-xs"
            />
            <Pressable
              disabled={disabled || !prompt.trim()}
              onClick={handleSave}
              title="Save current prompt"
              className="studio-btn shrink-0"
              scaleTo={0.96}
            >
              Save current text
            </Pressable>
          </div>

          {snippets.length === 0 ? (
            <p className="text-[11px] text-[var(--text-muted)]">
              No saved snippets yet
            </p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {snippets.map((s) => (
                <li key={s.id} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onInsert(s.text)}
                    aria-label={`Append saved snippet “${s.title}” to the current prompt`}
                    title={s.text}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--bg)] px-2 py-1.5 text-left text-xs transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{s.title}</span>
                      <span className="ml-1.5 text-[var(--text-muted)]">
                        {s.text.slice(0, 40)}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-[var(--accent)]">
                      <Plus size={12} strokeWidth={2.25} aria-hidden />
                      Add
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete saved prompt “${s.title}”`}
                    onClick={() => setSnippets(removeSnippet(s.id))}
                    className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-[var(--text-muted)] transition hover:text-[var(--danger)]"
                  >
                    <X size={14} strokeWidth={2} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
