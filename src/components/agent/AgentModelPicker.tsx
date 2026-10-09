import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Settings } from 'lucide-react'
import {
  fetchLlmSettings,
  type CustomEndpointSettings,
  type LlmProviderSettings,
  type LlmSettings,
} from '../../lib/agentApi.ts'
import { customEndpointProviderId } from '../../lib/models/llmProviders.ts'

export interface ModelSelection {
  provider: string
  model: string
}

interface ProviderOption {
  provider: string
  label: string
  detail: string
  models: string[]
  configured: boolean
}

function toOption(p: LlmProviderSettings, preferred?: string): ProviderOption {
  const models = [...p.suggestedModels]
  if (preferred && !models.includes(preferred)) models.unshift(preferred)
  return {
    provider: p.id,
    label: p.label,
    detail: p.hasKey ? (p.apiKeyMasked ?? '') : 'Key not set',
    models,
    configured: p.hasKey,
  }
}

function endpointToOption(e: CustomEndpointSettings): ProviderOption {
  const kindLabel = e.kind === 'openai-compatible' ? 'OpenAI-compatible' : 'Claude-compatible'
  return {
    provider: customEndpointProviderId(e.id),
    label: e.label,
    detail: `${kindLabel} · ${e.hasKey ? 'Configured' : 'Key not set'}`,
    models: e.models,
    configured: e.hasKey,
  }
}

function resolveInitialSelection(data: LlmSettings): ModelSelection | null {
  const configuredBuiltin = data.providers.filter((p) => p.hasKey)
  const configuredCustom = data.customEndpoints.filter((e) => e.hasKey)

  if (data.defaultModel?.provider && data.defaultModel.model.trim()) {
    const { provider, model } = data.defaultModel
    const builtinOk = configuredBuiltin.some((p) => p.id === provider)
    const customOk = configuredCustom.some(
      (e) => customEndpointProviderId(e.id) === provider,
    )
    if (builtinOk || customOk) {
      return { provider, model: model.trim() }
    }
  }

  for (const p of configuredBuiltin) {
    const preferred = data.preferredModels[p.id]?.trim()
    const model = preferred || p.suggestedModels[0]
    if (model) return { provider: p.id, model }
  }
  for (const e of configuredCustom) {
    if (e.models.length === 0) continue
    const id = customEndpointProviderId(e.id)
    const preferred = data.preferredModels[id]?.trim()
    return {
      provider: id,
      model: preferred && e.models.includes(preferred) ? preferred : e.models[0]!,
    }
  }
  return null
}

export function AgentModelPicker({
  value,
  onChange,
  onOpenSettings,
}: {
  value: ModelSelection | null
  onChange: (selection: ModelSelection) => void
  onOpenSettings?: () => void
}) {
  const settingsQuery = useQuery({ queryKey: ['llm-settings'], queryFn: fetchLlmSettings })
  const [customModel, setCustomModel] = useState('')
  const [initialized, setInitialized] = useState(false)

  const options = useMemo<ProviderOption[]>(() => {
    const data = settingsQuery.data
    if (!data) return []
    return [
      ...data.providers.map((p) => toOption(p, data.preferredModels[p.id])),
      ...data.customEndpoints.map(endpointToOption),
    ]
  }, [settingsQuery.data])

  useEffect(() => {
    if (initialized || !settingsQuery.data || value) return
    const initial = resolveInitialSelection(settingsQuery.data)
    if (initial) onChange(initial)
    setInitialized(true)
  }, [initialized, settingsQuery.data, value, onChange])

  const selected = options.find((o) => o.provider === value?.provider) ?? null

  if (settingsQuery.isLoading) {
    return <p className="text-sm text-[var(--text-muted)]">Loading LLM settings…</p>
  }
  if (settingsQuery.isError) {
    return (
      <p className="text-sm text-[var(--danger)]" role="alert">
        {(settingsQuery.error as Error).message}
      </p>
    )
  }

  const configured = options.filter((o) => o.configured)

  return (
    <div className="grid gap-3">
      {configured.length === 0 && (
        <div className="rounded-[var(--radius-md)] border border-[var(--warning)] bg-[var(--surface)] p-3 text-sm text-[var(--text-muted)]">
          <p>No LLM providers available. Register an API key and model in Settings.</p>
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="studio-btn mt-2 inline-flex w-auto items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <Settings size={13} aria-hidden />
              Open settings
            </button>
          )}
        </div>
      )}

      <div className="grid gap-1.5" role="radiogroup" aria-label="LLM provider">
        {options.map((option) => {
          const active = selected?.provider === option.provider
          return (
            <button
              key={option.provider}
              type="button"
              disabled={!option.configured}
              onClick={() => {
                const preferred =
                  settingsQuery.data?.preferredModels[option.provider]?.trim()
                const model =
                  (preferred && option.models.includes(preferred)
                    ? preferred
                    : option.models[0]) ?? ''
                onChange({ provider: option.provider, model })
                setCustomModel('')
              }}
              className={`flex items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 text-left text-sm transition-colors ${
                active
                  ? 'border-[var(--accent)] bg-[var(--surface-raised)]'
                  : 'border-[var(--border)] bg-[var(--surface)]'
              } disabled:opacity-45`}
              role="radio"
              aria-checked={active}
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border)]">
                {active && <Check size={12} className="text-[var(--accent)]" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-[var(--text)]">{option.label}</span>
                <span className="block truncate text-xs text-[var(--text-muted)]">
                  {option.detail}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {selected && (
        <div className="grid gap-2">
          <label className="studio-label" htmlFor="agent-model-select">
            Model
          </label>
          <select
            id="agent-model-select"
            className="studio-select w-full"
            value={(() => {
              if (value && selected.models.includes(value.model)) return value.model
              if (customModel || (value?.model && !selected.models.includes(value.model))) {
                return '__custom__'
              }
              return value?.model ?? ''
            })()}
            onChange={(e) => {
              if (e.target.value === '__custom__') return
              onChange({ provider: selected.provider, model: e.target.value })
              setCustomModel('')
            }}
          >
            {selected.models.length === 0 && (
              <option value="" disabled>
                Enter a model
              </option>
            )}
            {selected.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
            {(customModel ||
              (value?.model && !selected.models.includes(value.model))) && (
              <option value="__custom__">
                {customModel || value?.model} (manual)
              </option>
            )}
          </select>
          <input
            type="text"
            className="studio-input w-full"
            placeholder="or enter model ID directly"
            value={customModel}
            onChange={(e) => {
              setCustomModel(e.target.value)
              if (e.target.value.trim()) {
                onChange({
                  provider: selected.provider,
                  model: e.target.value.trim(),
                })
              }
            }}
            aria-label="Enter model ID directly"
          />
        </div>
      )}
    </div>
  )
}
