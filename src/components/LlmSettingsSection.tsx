import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import {
  deleteLlmApiKey,
  fetchLlmSettings,
  saveDefaultLlmModel,
  saveLlmApiKey,
  saveLlmCustomEndpoints,
  savePreferredLlmModel,
  type CustomEndpointInput,
  type LlmProviderSettings,
} from '../lib/agentApi.ts'
import { Pressable } from './motion/Pressable.tsx'

function LlmKeyForm({
  provider,
  onSaved,
}: {
  provider: LlmProviderSettings
  onSaved: () => void
}) {
  const [key, setKey] = useState('')
  const mutation = useMutation({
    mutationFn: () => saveLlmApiKey(provider.id, key.trim()),
    onSuccess: () => {
      setKey('')
      onSaved()
    },
  })

  return (
    <div className="mt-2 grid gap-1.5">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <KeyRound
            size={13}
            strokeWidth={2}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="studio-input w-full py-1.5 pr-3 pl-8 text-xs"
            placeholder={provider.hasKey ? 'Overwrite with new key…' : `${provider.label} API key`}
            value={key}
            disabled={mutation.isPending}
            onChange={(e) => setKey(e.target.value)}
            aria-label={`${provider.label} API key`}
          />
        </div>
        <Pressable
          type="button"
          disabled={!key.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="studio-btn-primary w-auto shrink-0 px-3 py-1.5 text-xs disabled:opacity-50"
          scaleTo={0.96}
        >
          {mutation.isPending ? 'Saving…' : 'Save'}
        </Pressable>
      </div>
      {mutation.isError && (
        <p className="studio-field-error" role="alert">
          {(mutation.error as Error).message}
        </p>
      )}
    </div>
  )
}

function ProviderPreferredModel({
  provider,
  preferredModel,
  onSaved,
}: {
  provider: LlmProviderSettings
  preferredModel: string | undefined
  onSaved: () => void
}) {
  const [custom, setCustom] = useState('')
  const mutation = useMutation({
    mutationFn: (model: string) =>
      savePreferredLlmModel({ provider: provider.id, model }),
    onSuccess: onSaved,
  })

  const suggestions = provider.suggestedModels
  const current = preferredModel?.trim() || suggestions[0] || ''
  const selectValue =
    current && suggestions.includes(current)
      ? current
      : custom || current
        ? '__custom__'
        : ''

  useEffect(() => {
    if (preferredModel && !suggestions.includes(preferredModel)) {
      setCustom(preferredModel)
    }
  }, [preferredModel, suggestions])

  return (
    <div className="mt-2 grid gap-1.5">
      <label
        className="text-[10px] font-medium text-[var(--text-muted)]"
        htmlFor={`llm-preferred-${provider.id}`}
      >
        Model for this key
      </label>
      <select
        id={`llm-preferred-${provider.id}`}
        className="studio-select w-full py-1.5 text-xs"
        disabled={!provider.hasKey || mutation.isPending}
        value={selectValue}
        onChange={(e) => {
          if (e.target.value === '__custom__') return
          setCustom('')
          mutation.mutate(e.target.value)
        }}
      >
        {!provider.hasKey && <option value="">Set a key first</option>}
        {suggestions.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
        {(custom || (current && !suggestions.includes(current))) && (
          <option value="__custom__">{custom || current} (manual)</option>
        )}
      </select>
          <input
            type="text"
            className="studio-input w-full py-1.5 text-xs"
            placeholder="or enter a model ID directly"
            disabled={!provider.hasKey || mutation.isPending}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onBlur={() => {
              const trimmed = custom.trim()
              if (trimmed && trimmed !== preferredModel) mutation.mutate(trimmed)
            }}
            aria-label={`${provider.label} model ID(s)`}
          />
      {mutation.isError && (
        <p className="studio-field-error" role="alert">
          {(mutation.error as Error).message}
        </p>
      )}
    </div>
  )
}

function CustomEndpointsEditor({
  endpoints,
  onChanged,
}: {
  endpoints: CustomEndpointInput[]
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<CustomEndpointInput['kind']>('openai-compatible')
  const [baseUrl, setBaseUrl] = useState('')
  const [models, setModels] = useState('')
  const [apiKey, setApiKey] = useState('')

  const mutation = useMutation({
    mutationFn: (next: CustomEndpointInput[]) => saveLlmCustomEndpoints(next),
    onSuccess: onChanged,
  })

  function slugify(value: string): string {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'endpoint'
    )
  }

  function handleAdd() {
    const entry: CustomEndpointInput = {
      id: slugify(label),
      label: label.trim(),
      kind,
      baseUrl: baseUrl.trim(),
      models: models
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    }
    if (!entry.label || !entry.baseUrl || entry.models.length === 0) return
    mutation.mutate([...endpoints, entry], {
      onSuccess: () => {
        setLabel('')
        setBaseUrl('')
        setModels('')
        setApiKey('')
        setOpen(false)
      },
    })
  }

  return (
    <div className="mt-3">
      {endpoints.length > 0 && (
        <ul className="grid gap-1.5">
          {endpoints.map((endpoint) => (
            <li
              key={endpoint.id}
              className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs"
            >
              <span className="flex-1 min-w-0">
                <span className="block font-medium text-[var(--text)]">{endpoint.label}</span>
                <span className="block truncate text-[var(--text-muted)]">
                  {endpoint.kind === 'openai-compatible' ? 'OpenAI-compatible' : 'Claude-compatible'}
                  {' · '}
                  {endpoint.baseUrl}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">
                  Models: {endpoint.models.join(', ')}
                </span>
              </span>
              <Pressable
                type="button"
                aria-label={`Delete ${endpoint.label}`}
                className="studio-btn w-auto px-2 py-1 text-[var(--danger)]"
                scaleTo={0.96}
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate(endpoints.filter((e) => e.id !== endpoint.id))
                }
              >
                <Trash2 size={12} strokeWidth={2} aria-hidden />
              </Pressable>
            </li>
          ))}
        </ul>
      )}

      {!open ? (
        <Pressable
          type="button"
          onClick={() => setOpen(true)}
          className="studio-btn mt-2 w-auto gap-1 px-3 text-xs"
          scaleTo={0.96}
        >
          <Plus size={13} strokeWidth={2} aria-hidden />
          Add compatible endpoint
        </Pressable>
      ) : (
        <div className="mt-2 grid gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
          <input
            className="studio-input w-full py-1.5 text-xs"
            placeholder="Display name (e.g. internal LLM gateway)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label="Endpoint display name"
          />
          <select
            className="studio-select w-full py-1.5 text-xs"
            value={kind}
            onChange={(e) => setKind(e.target.value as CustomEndpointInput['kind'])}
            aria-label="API compatibility"
          >
            <option value="openai-compatible">OpenAI-compatible API</option>
            <option value="anthropic-compatible">Claude-compatible API</option>
          </select>
          <input
            className="studio-input w-full py-1.5 text-xs"
            placeholder="Base URL (e.g. https://llm.example.com/v1)"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            aria-label="Base URL"
          />
          <input
            className="studio-input w-full py-1.5 text-xs"
            placeholder="Model IDs (comma-separated, e.g. llama-3.3-70b, mixtral-8x22b)"
            value={models}
            onChange={(e) => setModels(e.target.value)}
            aria-label="Model ID list"
          />
          <input
            type="password"
            autoComplete="off"
            className="studio-input w-full py-1.5 text-xs"
            placeholder="API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            aria-label="Endpoint API key"
          />
          {mutation.isError && (
            <p className="studio-field-error" role="alert">
              {(mutation.error as Error).message}
            </p>
          )}
          <div className="flex gap-2">
            <Pressable
              type="button"
              disabled={!label.trim() || !baseUrl.trim() || !models.trim() || mutation.isPending}
              onClick={handleAdd}
              className="studio-btn-primary w-auto flex-1 px-3 py-1.5 text-xs disabled:opacity-50"
              scaleTo={0.96}
            >
              {mutation.isPending ? 'Adding…' : 'Add'}
            </Pressable>
            <Pressable
              type="button"
              onClick={() => setOpen(false)}
              className="studio-btn w-auto px-3 py-1.5 text-xs"
              scaleTo={0.96}
            >
              Cancel
            </Pressable>
          </div>
        </div>
      )}
    </div>
  )
}

function DefaultModelSelect({ onSaved }: { onSaved: () => void }) {
  const settingsQuery = useQuery({ queryKey: ['llm-settings'], queryFn: fetchLlmSettings })
  const mutation = useMutation({
    mutationFn: saveDefaultLlmModel,
    onSuccess: onSaved,
  })
  const settings = settingsQuery.data
  if (!settings) return null

  const choices = [
    ...settings.providers
      .filter((p) => p.hasKey)
      .flatMap((p) => {
        const preferred = settings.preferredModels[p.id]
        const models = new Set(p.suggestedModels)
        if (preferred) models.add(preferred)
        return [...models].map((model) => ({
          provider: p.id,
          model,
          label: `${p.label} / ${model}`,
        }))
      }),
    ...settings.customEndpoints
      .filter((e) => e.hasKey)
      .flatMap((e) =>
        e.models.map((model) => ({
          provider: `custom-${e.id}`,
          model,
          label: `${e.label} / ${model}`,
        })),
      ),
  ]
  if (choices.length === 0) return null

  const current = settings.defaultModel
  return (
    <div className="mt-4">
      <label htmlFor="llm-default-model" className="studio-label">
        Default model
      </label>
      <div className="mt-2 flex items-center gap-2">
        <select
          id="llm-default-model"
          className="studio-select w-full py-1.5 text-xs"
          value={current ? `${current.provider}::${current.model}` : ''}
          onChange={(e) => {
            const [provider, model] = e.target.value.split('::')
            if (provider && model) mutation.mutate({ provider, model })
          }}
        >
          <option value="" disabled>
            Select one
          </option>
          {choices.map((choice) => (
            <option key={`${choice.provider}::${choice.model}`} value={`${choice.provider}::${choice.model}`}>
              {choice.label}
            </option>
          ))}
        </select>
        {mutation.isSuccess && (
          <Check size={14} className="shrink-0 text-[var(--success)]" aria-hidden />
        )}
      </div>
      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
        Initial model for new conversations. You can change it per conversation.
      </p>
    </div>
  )
}

export function LlmSettingsSection() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ['llm-settings'], queryFn: fetchLlmSettings })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['llm-settings'] })
  }

  const settings = settingsQuery.data

  return (
    <section className="mt-6 border-t border-[var(--border)] pt-4">
      <div className="studio-label">Agent (LLM provider)</div>
      <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
        Manage API keys and models for the LLM used in agent mode. Keys are stored encrypted on this device only and never exposed beyond the agent server.
      </p>

      {settingsQuery.isLoading ? (
        <p className="mt-2 text-sm text-[var(--text-muted)]">Loading…</p>
      ) : settingsQuery.isError ? (
        <p className="mt-2 text-sm text-[var(--danger)]" role="alert">
          {(settingsQuery.error as Error).message}
        </p>
      ) : (
        <div className="mt-3 grid gap-4">
          {settings?.providers.map((provider) => (
            <div key={provider.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-[var(--text)]">{provider.label}</span>
                {provider.hasKey ? (
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--accent)]">
                    <ShieldCheck size={12} strokeWidth={2} aria-hidden />
                    {provider.apiKeyMasked}
                    {!provider.apiKeyFromStore && '(from environment variables)'}
                  </span>
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">Not set</span>
                )}
                {provider.hasKey && provider.apiKeyFromStore && (
                  <DeleteKeyButton provider={provider.id} onDeleted={refresh} />
                )}
              </div>
              <LlmKeyForm provider={provider} onSaved={refresh} />
              <ProviderPreferredModel
                provider={provider}
                preferredModel={settings.preferredModels[provider.id]}
                onSaved={refresh}
              />
            </div>
          ))}

          <div>
            <div className="studio-label">Custom endpoints (OpenAI / Claude compatible)</div>
            <CustomEndpointsEditor
              endpoints={
                settings?.customEndpoints
                  .map((e) => ({
                    id: e.id,
                    label: e.label,
                    kind: e.kind,
                    baseUrl: e.baseUrl,
                    models: e.models,
                  })) ?? []
              }
              onChanged={refresh}
            />
          </div>

          <DefaultModelSelect onSaved={refresh} />
        </div>
      )}
    </section>
  )
}

function DeleteKeyButton({
  provider,
  onDeleted,
}: {
  provider: string
  onDeleted: () => void
}) {
  const mutation = useMutation({
    mutationFn: () => deleteLlmApiKey(provider),
    onSuccess: onDeleted,
  })
  return (
    <Pressable
      type="button"
      aria-label="Delete saved key"
      className="studio-btn w-auto px-2 py-0.5 text-[10px] text-[var(--danger)]"
      scaleTo={0.96}
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      <Trash2 size={11} strokeWidth={2} aria-hidden />
    </Pressable>
  )
}
