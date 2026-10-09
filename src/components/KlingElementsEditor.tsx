import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Plus, X } from 'lucide-react'
import { uploadFile } from '../lib/api.ts'
import type { KlingElement } from '../lib/models/types.ts'

function emptyElement(index: number): KlingElement {
  return {
    name: `element_${index + 1}`,
    description: '',
    element_input_urls: [],
  }
}

export function KlingElementsEditor({
  value,
  onChange,
  maxItems = 3,
  disabled,
  onInsertMention,
}: {
  value: KlingElement[]
  onChange: (next: KlingElement[]) => void
  maxItems?: number
  disabled?: boolean
  onInsertMention?: (token: string) => void
}) {
  const [elementIds, setElementIds] = useState(() =>
    value.map(() => crypto.randomUUID()),
  )
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    if (elementIds.length === value.length) return
    if (elementIds.length > value.length) {
      setElementIds((previous) => previous.slice(0, value.length))
      return
    }
    const additions = Array.from(
      { length: value.length - elementIds.length },
      () => crypto.randomUUID(),
    )
    setElementIds((previous) => [...previous, ...additions])
  }, [elementIds.length, value.length])

  function update(index: number, patch: Partial<KlingElement>) {
    onChange(value.map((el, i) => (i === index ? { ...el, ...patch } : el)))
  }

  async function addImages(index: number, files: FileList | null) {
    if (!files?.length) return
    const el = value[index]
    if (!el) return
    setError(null)
    setUploadingKey(`${index}:img`)
    try {
      const remaining = Math.max(0, 4 - el.element_input_urls.length)
      const list = [...files].slice(0, remaining)
      const urls = await Promise.all(list.map((file) => uploadFile(file)))
      update(index, {
        element_input_urls: [...el.element_input_urls, ...urls],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploadingKey(null)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-[var(--text-muted)]">
        Up to {maxItems}. In prompts, reference with {' '}
        <code className="rounded bg-[var(--bg)] px-1">@name</code>. Images: 
        2–4 recommended.
      </p>

      {value.map((el, index) => {
        const token = `@${el.name || `element_${index + 1}`}`
        const elementId =
          elementIds[index] ??
          `pending-${el.name}-${el.element_input_urls[0] ?? 'empty'}`
        const inputKey = `${elementId}:img`
        const nameId = `kling-name-${index}`
        const descId = `kling-desc-${index}`
        const fileId = `kling-file-${index}`
        return (
          <div
            key={elementId}
            className="space-y-2 border-t border-[var(--border)] pt-3 first:border-t-0 first:pt-0"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="studio-label text-[var(--text)]">
                Element {index + 1}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={disabled || !el.name}
                  onClick={() => onInsertMention?.(token)}
                  className="rounded-[var(--radius-md)] border border-[var(--border)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-40"
                >
                  {token}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setElementIds((ids) => ids.filter((_, i) => i !== index))
                    onChange(value.filter((_, i) => i !== index))
                  }}
                  className="rounded-[var(--radius-md)] px-2 py-0.5 text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
                >
                  Delete
                </button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-xs" htmlFor={nameId}>
                <span className="text-[var(--text-muted)]">name (@reference name)</span>
                <input
                  id={nameId}
                  className="studio-input w-full px-2 py-1.5 font-mono text-sm"
                  value={el.name}
                  disabled={disabled}
                  placeholder="element_dog"
                  onChange={(e) =>
                    update(index, {
                      name: e.target.value.replace(/\s+/g, '_'),
                    })
                  }
                />
              </label>
              <label className="space-y-1 text-xs" htmlFor={descId}>
                <span className="text-[var(--text-muted)]">description</span>
                <input
                  id={descId}
                  className="studio-input w-full px-2 py-1.5 text-sm"
                  value={el.description}
                  disabled={disabled}
                  placeholder="dog"
                  onChange={(e) => update(index, { description: e.target.value })}
                />
              </label>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] text-[var(--text-muted)]">
                Images ({el.element_input_urls.length}/4 · 2–4 recommended)
              </div>
              <div className="flex flex-wrap gap-2">
                {el.element_input_urls.map((url, ui) => (
                  <div
                    key={url}
                    className="studio-tile relative h-16 w-16"
                  >
                    <img
                      src={url}
                      alt={`Element ${index + 1} image ${ui + 1}`}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        update(index, {
                          element_input_urls: el.element_input_urls.filter(
                            (_, j) => j !== ui,
                          ),
                        })
                      }
                      className="absolute right-0.5 top-0.5 inline-flex size-5 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] p-0.5 text-[var(--text)] hover:text-[var(--danger)] disabled:opacity-50"
                      aria-label={`Delete element ${index + 1} image ${ui + 1}`}
                    >
                      <X size={10} strokeWidth={2.5} aria-hidden />
                    </button>
                  </div>
                ))}
                {el.element_input_urls.length < 4 && (
                  <button
                    type="button"
                    disabled={disabled || uploadingKey === inputKey}
                    onClick={() => fileRefs.current[inputKey]?.click()}
                    aria-controls={fileId}
                    aria-busy={uploadingKey === inputKey || undefined}
                    aria-label={
                      uploadingKey === inputKey
                        ? 'Uploading'
                        : `Add image to element ${index + 1}`
                    }
                    className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]"
                  >
                    {uploadingKey === inputKey ? (
                      <LoaderCircle
                        size={16}
                        strokeWidth={2}
                        className="studio-spinner"
                        aria-hidden
                      />
                    ) : (
                      <Plus size={16} strokeWidth={2} aria-hidden />
                    )}
                  </button>
                )}
              </div>
              <input
                id={fileId}
                ref={(node) => {
                  fileRefs.current[inputKey] = node
                }}
                type="file"
                aria-label={`Select image for element ${index + 1}`}
                accept="image/jpeg,image/png,image/webp,image/*"
                multiple
                className="hidden"
                tabIndex={-1}
                onChange={(e) => {
                  void addImages(index, e.target.files)
                  e.target.value = ''
                }}
              />
            </div>
          </div>
        )
      })}

      {value.length < maxItems && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const elementId = crypto.randomUUID()
            setElementIds((ids) => [
              ...ids,
              elementId,
            ])
            onChange([...value, emptyElement(value.length)])
          }}
          className="inline-flex w-full items-center justify-center gap-1.5 border-t border-dashed border-[var(--border)] px-3 py-2.5 text-sm text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <Plus size={16} strokeWidth={2} aria-hidden />
          Add element
        </button>
      )}

      {error && (
        <p className="studio-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
