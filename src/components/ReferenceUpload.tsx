import { useRef, useState } from 'react'
import { FileAudio, LoaderCircle, Plus, X } from 'lucide-react'
import { uploadFileWithMetadata } from '../lib/api.ts'
import { formatMention } from '../lib/models/mentions.ts'
import type { MentionStyle } from '../lib/models/types.ts'
import { Pressable } from './motion/Pressable.tsx'

export function ReferenceUpload({
  value,
  onChange,
  maxItems = 8,
  accept = 'image/*',
  disabled,
  mentionStyle = 'at-image',
  onInsertMention,
  inputId,
  maxFileSizeMb,
  maxDurationSec,
}: {
  value: string[]
  onChange: (urls: string[]) => void
  maxItems?: number
  accept?: string
  disabled?: boolean
  mentionStyle?: MentionStyle
  onInsertMention?: (token: string) => void
  inputId?: string
  maxFileSizeMb?: number
  maxDurationSec?: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({})

  async function mediaDuration(file: File): Promise<number | undefined> {
    if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) return undefined
    const url = URL.createObjectURL(file)
    try {
      const element = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video')
      element.preload = 'metadata'
      return await new Promise<number | undefined>((resolve) => {
        const timeout = window.setTimeout(() => resolve(undefined), 5000)
        element.onloadedmetadata = () => {
          window.clearTimeout(timeout)
          resolve(Number.isFinite(element.duration) ? element.duration : undefined)
        }
        element.onerror = () => {
          window.clearTimeout(timeout)
          resolve(undefined)
        }
        element.src = url
      })
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    setUploading(true)
    try {
      const remaining = Math.max(0, maxItems - value.length)
      const list = [...files].slice(0, remaining)
      for (const file of list) {
        if (maxFileSizeMb && file.size > maxFileSizeMb * 1024 * 1024) {
          throw new Error(`${file.name} must be ${maxFileSizeMb}MB or smaller`)
        }
        if (maxDurationSec) {
          const duration = await mediaDuration(file)
          if (duration !== undefined && duration > maxDurationSec) {
            throw new Error(`${file.name} must be ${maxDurationSec}s or shorter`)
          }
        }
      }
      const uploaded = await Promise.all(list.map((file) => uploadFileWithMetadata(file)))
      const urls = uploaded.map((result) => result.fileUrl)
      setDisplayNames((current) => ({
        ...current,
        ...Object.fromEntries(uploaded.map((result) => [result.fileUrl, result.originalFileName])),
      }))
      onChange([...value, ...urls])
      if (/audio/i.test(accept)) {
        window.dispatchEvent(new Event('kie:audio-assets-changed'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const canMention = mentionStyle !== 'none' && Boolean(onInsertMention)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((url, i) => {
          const token = formatMention(mentionStyle, i + 1)
          return (
            <div key={url} className="studio-tile relative w-[88px]">
              <div className="relative h-20 w-full">
                {/\.(mp4|webm|mov)(\?|$)/i.test(url) ? (
                  <video
                    src={url}
                    className="h-full w-full object-cover"
                    muted
                    preload="metadata"
                  />
                ) : /\.(mp3|wav|m4a|aac|ogg|flac|opus)(\?|$)/i.test(url) || /audio/i.test(accept) ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[var(--accent-soft)] px-2 text-center">
                    <FileAudio size={20} />
                    <span className="line-clamp-2 text-[9px]">{displayNames[url] ?? `Audio ${i + 1}`}</span>
                  </div>
                ) : (
                  <img
                    src={url}
                    alt={`Reference ${i + 1}`}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                )}
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Delete reference ${i + 1}`}
                  onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                  className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] p-0.5 text-[var(--text)] disabled:opacity-50"
                >
                  <X size={12} strokeWidth={2.5} aria-hidden />
                </button>
              </div>
              {canMention && token && (
                <button
                  type="button"
                  disabled={disabled}
                  title={`Insert ${token} into prompt`}
                  onClick={() => onInsertMention?.(token)}
                  className="w-full border-t border-[var(--border)] bg-[var(--bg-elevated)] px-1 py-1 text-center font-mono text-[10px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
                >
                  {token}
                </button>
              )}
            </div>
          )
        })}
        {value.length < maxItems && (
          <Pressable
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
            scaleTo={0.96}
            aria-controls={inputId}
            aria-busy={uploading || undefined}
            aria-label={uploading ? 'Uploading' : 'Add reference file'}
            className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] text-xs font-medium text-[var(--text-muted)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] disabled:opacity-50"
          >
            {uploading ? (
              <LoaderCircle
                size={16}
                strokeWidth={2}
                className="studio-spinner"
                aria-hidden
              />
            ) : (
              <>
                <Plus size={16} strokeWidth={2} aria-hidden />
                Add
              </>
            )}
          </Pressable>
        )}
      </div>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        aria-label="Choose reference file"
        accept={accept}
        multiple={maxItems > 1}
        className="hidden"
        tabIndex={-1}
        disabled={disabled || uploading}
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <p className="text-[11px] text-[var(--text-muted)]">
        {value.length}/{maxItems} · File Upload API (expiring)
        {maxFileSizeMb ? ` · max ${maxFileSizeMb}MB` : ''}
        {maxDurationSec ? ` · max ${maxDurationSec}s` : ''}
        {canMention && ' · tap chip to insert into prompt'}
      </p>
      {error && (
        <p className="studio-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
