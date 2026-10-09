import { useMemo, useRef, useState } from 'react'
import type { FieldSchema, KlingElement, MentionStyle } from '../lib/models/types.ts'
import { insertMentionToken } from '../lib/models/mentions.ts'
import {
  conciseFieldDescription,
  fieldConstraintHint,
  isAdvancedField,
  presentField,
  shouldShowTechnicalDescription,
} from '../lib/studioPresentation.ts'
import { ReferenceUpload } from './ReferenceUpload.tsx'
import { KlingElementsEditor } from './KlingElementsEditor.tsx'
import { PromptOptimizePanel } from './PromptOptimizePanel.tsx'
import { PromptSnippets } from './PromptSnippets.tsx'
import { Pressable } from './motion/Pressable.tsx'
import { DialogueEditor, NarrationEditor } from './audio/AudioEditors.tsx'

function fieldId(name: string): string {
  return `field-${name}`
}
function acceptHint(accept?: string): string | null {
  if (!accept) return null
  if (/video/i.test(accept) && /image/i.test(accept)) return 'Image / Video'
  if (/video/i.test(accept)) return 'Video'
  if (/audio/i.test(accept)) return 'Audio'
  if (/image/i.test(accept)) return 'Image'
  return null
}

function FieldDescription({ field }: { field: FieldSchema }) {
  const description = conciseFieldDescription(field)
  return (
    <>
      {description && (
        <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
          {description}
        </p>
      )}
      {shouldShowTechnicalDescription(field) && (
        <details className="mt-1 text-[11px] text-[var(--text-muted)]">
          <summary className="min-h-6 cursor-pointer py-1 font-medium text-[var(--accent)]">
            View spec
          </summary>
          <p className="pb-1 leading-snug">{field.description}</p>
        </details>
      )}
    </>
  )
}

function FieldLabel({
  field,
  htmlFor,
  hint,
}: {
  field: FieldSchema
  htmlFor?: string
  hint?: string | null
}) {
  const constraint = fieldConstraintHint(field)
  return (
    <div className="mb-2">
      <label htmlFor={htmlFor} className="studio-label text-[var(--text)]">
        {field.label}
        {field.required && <span className="ml-1 text-[var(--danger)]">*</span>}
        {(hint || constraint) && (
          <span className="ml-2 text-[11px] font-normal text-[var(--text-muted)]">
            {[hint, constraint].filter(Boolean).join(' · ')}
          </span>
        )}
      </label>
      <FieldDescription field={field} />
    </div>
  )
}

function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null
  return (
    <p id={id} className="studio-field-error" role="alert">
      {message}
    </p>
  )
}

const inputClass = 'studio-input'

function BooleanToggle({
  id,
  field,
  on,
  disabled,
  error,
  onChange,
}: {
  id: string
  field: FieldSchema
  on: boolean
  disabled?: boolean
  error?: string
  onChange: (next: boolean) => void
}) {
  const current = on ? 'true' : 'false'

  return (
    <div className="py-3">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div>
          <div className="studio-label text-[var(--text)]" id={id}>
            {field.label}
            {field.required && (
              <span className="ml-1 text-[var(--danger)]">*</span>
            )}
          </div>
          <FieldDescription field={field} />
        </div>
        <span
          className={`rounded-[var(--radius-md)] px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums ${
            on
              ? 'bg-[var(--accent)] text-[var(--on-accent)]'
              : 'bg-[var(--text)] text-[var(--on-accent)]'
          }`}
          aria-live="polite"
        >
          Current: {current}
        </span>
      </div>
      {/* フォーム内の高頻度操作のため layout spring は付けず即時切替（DESIGN.md motion matrix） */}
      <div
        role="group"
        aria-labelledby={id}
        aria-describedby={`${id}-value`}
        className="studio-segment"
      >
        <span id={`${id}-value`} className="sr-only">
          Current value is {current}
        </span>
        <Pressable
          disabled={disabled}
          aria-pressed={!on}
          aria-label="false"
          onClick={() => onChange(false)}
          scaleTo={0.96}
          className={`studio-segment-item ${
            !on ? '!text-[var(--on-accent)]' : ''
          }`}
        >
          {!on && (
            <span
              className="absolute inset-0 z-0 bg-[var(--text)]"
              aria-hidden
            />
          )}
          <span className="relative z-10 font-mono">false</span>
        </Pressable>
        <Pressable
          disabled={disabled}
          aria-pressed={on}
          aria-label="true"
          onClick={() => onChange(true)}
          scaleTo={0.96}
          className={`studio-segment-item ${
            on ? '!text-[var(--on-accent)]' : ''
          }`}
        >
          {on && (
            <span
              className="absolute inset-0 z-0 bg-[var(--accent)]"
              aria-hidden
            />
          )}
          <span className="relative z-10 font-mono">true</span>
        </Pressable>
      </div>
      <FieldError message={error} />
    </div>
  )
}

function resolveMentionStyle(field: FieldSchema): MentionStyle {
  if (field.mentionStyle) return field.mentionStyle
  const hay = `${field.name} ${field.description ?? ''}`.toLowerCase()
  if (/audio/i.test(field.name)) return 'at-audio'
  if (/video/i.test(field.name)) return 'at-video'
  if (hay.includes('[image')) return 'bracket-image'
  if (hay.includes('@image')) return 'at-image'
  if (/(image_?urls?|input_?urls?|reference_?urls?)/i.test(field.name)) {
    return 'at-image'
  }
  return 'none'
}

/** Display order: media refs → prompt → rest (payload keys unchanged). */
function sortFieldsForDisplay(fields: FieldSchema[]): FieldSchema[] {
  const modes: FieldSchema[] = []
  const media: FieldSchema[] = []
  const prompts: FieldSchema[] = []
  const rest: FieldSchema[] = []

  for (const field of fields) {
    if (field.name === 'customMode' || field.name === 'instrumental') {
      modes.push(field)
    } else if (field.type === 'reference' || field.type === 'kling_elements') {
      media.push(field)
    } else if (field.type === 'textarea') {
      prompts.push(field)
    } else {
      rest.push(field)
    }
  }

  prompts.sort((a, b) => {
    if (a.name === 'prompt') return -1
    if (b.name === 'prompt') return 1
    return 0
  })

  return [...modes, ...media, ...prompts, ...rest]
}

export function DynamicForm({
  fields,
  values,
  onChange,
  disabled,
  fieldErrors,
  modelId,
}: {
  fields: FieldSchema[]
  values: Record<string, unknown>
  onChange: (name: string, value: unknown) => void
  disabled?: boolean
  fieldErrors?: Record<string, string>
  modelId?: string | null
}) {
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const orderedFields = useMemo(
    () => sortFieldsForDisplay(fields).filter((field) => {
      if (field.name.startsWith('_')) return false
      if (
        modelId === 'market/elevenlabs-tts' &&
        (field.name === 'previous_text' || field.name === 'next_text')
      ) return false
      if (modelId?.startsWith('suno/')) {
        if (field.name === 'personaId') return false
        if (
          values.customMode === false &&
          ['style', 'title', 'negativeTags'].includes(field.name)
        ) {
          return false
        }
      }
      return true
    }),
    [fields, modelId, values.customMode],
  )
  const promptFieldName =
    fields.find((f) => f.name === 'prompt' && f.type === 'textarea')?.name ??
    fields.find((f) => f.type === 'textarea')?.name ??
    null

  function insertIntoPrompt(token: string) {
    if (!promptFieldName) return
    const current =
      typeof values[promptFieldName] === 'string'
        ? (values[promptFieldName] as string)
        : ''
    const cursor = promptRef.current?.selectionStart ?? current.length
    const { next, cursor: nextCursor } = insertMentionToken(
      current,
      token,
      cursor,
    )
    onChange(promptFieldName, next)
    requestAnimationFrame(() => {
      const el = promptRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(nextCursor, nextCursor)
    })
  }

  function clearErrorOnChange(name: string, value: unknown) {
    onChange(name, value)
  }

  const conditionalSuno = modelId?.startsWith('suno/') && fields.some(
    (candidate) => candidate.name === 'customMode',
  )
  const modelName = typeof values.model === 'string' ? values.model : 'V5'

  function prepareField(schemaField: FieldSchema): FieldSchema {
    return presentField(
      conditionalSuno
        ? {
              ...schemaField,
              required:
                schemaField.name === 'prompt'
                  ? values.customMode === false || values.instrumental !== true
                  : schemaField.name === 'style' || schemaField.name === 'title'
                    ? values.customMode !== false
                    : schemaField.required,
              maxLength:
                schemaField.name === 'prompt'
                  ? values.customMode === false
                    ? 500
                    : modelName === 'V4'
                      ? 3000
                      : 5000
                  : schemaField.name === 'style'
                    ? modelName === 'V4'
                      ? 200
                      : 1000
                    : schemaField.maxLength,
            }
        : schemaField,
    )
  }

  const displayedFields = orderedFields.map(prepareField)
  const basicFields = displayedFields.filter((field) => !isAdvancedField(field))
  const advancedFields = displayedFields.filter(isAdvancedField)
  const advancedHasError = advancedFields.some((field) => fieldErrors?.[field.name])
  const showAdvanced = advancedOpen || advancedHasError

  function renderField(field: FieldSchema) {
    const value = values[field.name]
    const error = fieldErrors?.[field.name]
    const id = fieldId(field.name)
    const wrap = 'py-4 first:pt-0'

    switch (field.type) {
          case 'textarea':
            if (modelId === 'market/elevenlabs-tts' && field.name === 'text') {
              return (
                <div key={field.name} className={wrap}>
                  <FieldLabel field={field} />
                  <NarrationEditor
                    value={typeof value === 'string' ? value : ''}
                    disabled={disabled}
                    onChange={(next) => clearErrorOnChange(field.name, next)}
                  />
                  <FieldError message={error} id={`${id}-error`} />
                </div>
              )
            }
            return (
              <div key={field.name} className={wrap}>
                <FieldLabel field={field} htmlFor={id} />
                <textarea
                  id={id}
                  ref={
                    field.name === promptFieldName ? promptRef : undefined
                  }
                  className={`${inputClass} min-h-28 resize-y`}
                  value={typeof value === 'string' ? value : ''}
                  maxLength={field.maxLength}
                  disabled={disabled}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${id}-error` : undefined}
                  onChange={(e) =>
                    clearErrorOnChange(field.name, e.target.value)
                  }
                  placeholder={
                    field.name === 'prompt'
                      ? 'e.g. using @image1… / @element_dog running'
                      : field.label
                  }
                />
                <FieldError message={error} id={`${id}-error`} />
                {field.name === 'prompt' && (
                  <>
                    <PromptOptimizePanel
                      prompt={typeof value === 'string' ? value : ''}
                      modelId={modelId}
                      disabled={disabled}
                      onApply={(optimized) =>
                        clearErrorOnChange(field.name, optimized)
                      }
                    />
                    <PromptSnippets
                      prompt={typeof value === 'string' ? value : ''}
                      disabled={disabled}
                      onInsert={insertIntoPrompt}
                    />
                  </>
                )}
              </div>
            )
          case 'string':
            return (
              <div key={field.name} className={wrap}>
                <FieldLabel field={field} htmlFor={id} />
                <input
                  id={id}
                  type="text"
                  aria-label={field.label}
                  className={inputClass}
                  value={typeof value === 'string' ? value : ''}
                  maxLength={field.maxLength}
                  disabled={disabled}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${id}-error` : undefined}
                  onChange={(e) =>
                    clearErrorOnChange(field.name, e.target.value)
                  }
                />
                <FieldError message={error} id={`${id}-error`} />
              </div>
            )
          case 'number':
            return (
              <div key={field.name} className={wrap}>
                <FieldLabel field={field} htmlFor={id} />
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    className="flex-1 accent-[var(--accent)]"
                    min={field.min ?? 0}
                    max={field.max ?? 100}
                    step={field.step ?? 1}
                    disabled={disabled}
                    aria-label={field.label}
                    value={
                      typeof value === 'number'
                        ? value
                        : Number(field.default ?? field.min ?? 0)
                    }
                    onChange={(e) =>
                      clearErrorOnChange(field.name, Number(e.target.value))
                    }
                  />
                  <input
                    id={id}
                    type="number"
                    aria-label={field.label}
                    className={`${inputClass} w-24`}
                    min={field.min}
                    max={field.max}
                    step={field.step ?? 1}
                    disabled={disabled}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `${id}-error` : undefined}
                    value={
                      typeof value === 'number'
                        ? value
                        : Number(field.default ?? 0)
                    }
                    onChange={(e) =>
                      clearErrorOnChange(field.name, Number(e.target.value))
                    }
                  />
                </div>
                <FieldError message={error} id={`${id}-error`} />
              </div>
            )
          case 'boolean': {
            const on = Boolean(value)
            return (
              <div key={field.name} className="first:pt-0">
                <BooleanToggle
                  id={id}
                  field={field}
                  on={on}
                  disabled={disabled}
                  error={error}
                  onChange={(next) => clearErrorOnChange(field.name, next)}
                />
              </div>
            )
          }
          case 'enum':
            return (
              <div key={field.name} className={wrap}>
                <FieldLabel field={field} htmlFor={id} />
                <select
                  id={id}
                  aria-label={field.label}
                  className="studio-select w-full"
                  value={
                    typeof value === 'string'
                      ? value
                      : String(field.default ?? field.enum?.[0] ?? '')
                  }
                  disabled={disabled}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${id}-error` : undefined}
                  onChange={(e) =>
                    clearErrorOnChange(field.name, e.target.value)
                  }
                >
                  {(field.enum ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <FieldError message={error} id={`${id}-error`} />
              </div>
            )
          case 'reference': {
            const max = field.maxItems ?? 8
            const media = acceptHint(field.accept)
            const hint = [`Up to ${max} images`, media].filter(Boolean).join(' · ')
            return (
              <div key={field.name} className={wrap}>
                <FieldLabel field={field} htmlFor={id} hint={hint} />
                <ReferenceUpload
                  inputId={id}
                  value={Array.isArray(value) ? (value as string[]) : []}
                  onChange={(urls) => clearErrorOnChange(field.name, urls)}
                  maxItems={max}
                  accept={field.accept}
                  maxFileSizeMb={field.maxFileSizeMb}
                  maxDurationSec={field.maxDurationSec}
                  disabled={disabled}
                  mentionStyle={resolveMentionStyle(field)}
                  onInsertMention={
                    promptFieldName ? insertIntoPrompt : undefined
                  }
                />
                <FieldError message={error} id={`${id}-error`} />
              </div>
            )
          }
          case 'kling_elements':
            return (
              <div
                key={field.name}
                className={wrap}
                id={id}
                tabIndex={-1}
              >
                <FieldLabel
                  field={field}
                  hint={`Up to ${field.maxItems ?? 3}`}
                />
                <KlingElementsEditor
                  value={Array.isArray(value) ? (value as KlingElement[]) : []}
                  onChange={(next) => clearErrorOnChange(field.name, next)}
                  maxItems={field.maxItems ?? 3}
                  disabled={disabled}
                  onInsertMention={
                    promptFieldName ? insertIntoPrompt : undefined
                  }
                />
                <FieldError message={error} id={`${id}-error`} />
              </div>
            )
          case 'json':
            if (modelId === 'market/elevenlabs-dialogue' && field.name === 'dialogue') {
              return (
                <div key={field.name} className={wrap} id={id} tabIndex={-1}>
                  <FieldLabel field={field} />
                  <DialogueEditor
                    value={value}
                    disabled={disabled}
                    onChange={(next) => clearErrorOnChange(field.name, next)}
                  />
                  <FieldError message={error} id={`${id}-error`} />
                </div>
              )
            }
            return (
              <div key={field.name} className={wrap}>
                <FieldLabel field={field} htmlFor={id} />
                <textarea
                  id={id}
                  className={`${inputClass} min-h-24 font-mono text-xs`}
                  disabled={disabled}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${id}-error` : undefined}
                  value={
                    typeof value === 'string'
                      ? value
                      : value !== undefined
                        ? JSON.stringify(value, null, 2)
                        : ''
                  }
                  onChange={(e) => {
                    const raw = e.target.value
                    try {
                      clearErrorOnChange(field.name, JSON.parse(raw))
                    } catch {
                      clearErrorOnChange(field.name, raw)
                    }
                  }}
                  placeholder="{ }"
                />
                <FieldError message={error} id={`${id}-error`} />
              </div>
            )
      default: {
        const _exhaustive: never = field.type
        return _exhaustive
      }
    }
  }

  return (
    <div>
      <div className="divide-y divide-[var(--border)]">
        {basicFields.map(renderField)}
      </div>
      {advancedFields.length > 0 && (
        <div className="border-t border-[var(--border)] pt-3">
          <button
            type="button"
            className="studio-btn w-full justify-between"
            aria-expanded={showAdvanced}
            onClick={() => setAdvancedOpen((current) => !current)}
          >
            <span>Advanced</span>
            <span className="text-[11px] font-normal text-[var(--text-muted)]">
              {advancedFields.length} items · {showAdvanced ? 'Close' : 'Show'}
            </span>
          </button>
          {showAdvanced && (
            <div className="mt-2 divide-y divide-[var(--border)]">
              {advancedFields.map(renderField)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
