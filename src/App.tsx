import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Settings } from 'lucide-react'
import { CategoryTabs } from './components/CategoryTabs.tsx'
import { ModelSelect } from './components/ModelSelect.tsx'
import {
  buildDefaultValues,
  focusFirstFieldError,
  isFormDirty,
  validateFields,
} from './lib/form.ts'
import { DynamicForm } from './components/DynamicForm.tsx'
import { CreditBadge } from './components/CreditBadge.tsx'
import { HistoryGallery } from './components/HistoryGallery.tsx'
import {
  StudioShell,
  type MobileStudioView,
  type StudioWorkspaceMode,
} from './components/shell/StudioShell.tsx'
import { Pressable } from './components/motion/Pressable.tsx'
import { AudioPlayerProvider } from './components/audio/AudioPlayer.tsx'
import { SunoStyleAssist } from './components/SunoStyleAssist.tsx'
import {
  fetchAudioAssets,
  fetchHealth,
  fetchModels,
  fetchPersonas,
} from './lib/api.ts'
import { useSubmissionQueue } from './lib/useSubmissionQueue.ts'
import { validateWorkflowInput } from './lib/workflowValidation.ts'
import { isVideoUrl } from './lib/media.ts'
import { presentField } from './lib/studioPresentation.ts'
import { useGenerateFlow } from './lib/useGenerateFlow.ts'
import { useHistoryState } from './lib/useHistoryState.ts'
import { useQuickAction } from './lib/useQuickAction.ts'
import { useTaskPolling } from './lib/useTaskPolling.ts'
import type {
  FieldSchema,
  HistoryItem,
  ModelCategory,
  ModelDefinition,
} from './lib/models/types.ts'

const CreditPurchaseSheet = lazy(() =>
  import('./components/CreditPurchaseSheet.tsx').then((module) => ({
    default: module.CreditPurchaseSheet,
  })),
)

const SettingsSheet = lazy(() =>
  import('./components/SettingsSheet.tsx').then((module) => ({
    default: module.SettingsSheet,
  })),
)
const AgentView = lazy(() =>
  import('./components/agent/AgentView.tsx').then((module) => ({
    default: module.AgentView,
  })),
)


/** Restore saved input over defaults; unknown keys are dropped. */
function mergeInputWithDefaults(
  fields: FieldSchema[],
  input: Record<string, unknown>,
): Record<string, unknown> {
  const values = buildDefaultValues(fields)
  for (const field of fields) {
    const raw = input[field.name]
    if (raw === undefined) continue
    // History may store scalar reference as a bare string URL.
    if (
      field.type === 'reference' &&
      field.scalar &&
      typeof raw === 'string'
    ) {
      values[field.name] = raw ? [raw] : []
      continue
    }
    values[field.name] = raw
  }
  return values
}

const EMPTY_MODELS: ModelDefinition[] = []

export default function App() {
  const queryClient = useQueryClient()
  const [category, setCategory] = useState<ModelCategory>('image')
  const [modelId, setModelId] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [viewerTaskId, setViewerTaskId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [formNotice, setFormNotice] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [lastUsedCredits, setLastUsedCredits] = useState<number | null>(null)
  const [batchCount, setBatchCount] = useState(1)
  const [mobileView, setMobileView] = useState<MobileStudioView>('create')
  const [view, setView] = useState<StudioWorkspaceMode>('studio')
  const [creditPurchaseSheetOpen, setCreditPurchaseSheetOpen] =
    useState(false)
  const [creditSheetRequested, setCreditSheetRequested] = useState(false)
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false)
  const [settingsSheetRequested, setSettingsSheetRequested] = useState(false)
  const pendingRestoreRef = useRef<{
    modelId: string
    input: Record<string, unknown>
  } | null>(null)
  const { queue: submissionQueue, items: submissionQueueItems } =
    useSubmissionQueue()

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })

  const {
    history,
    historyReady,
    setHistory,
    requestHistoryPersist,
    togglePin,
    exportHistory,
    importHistory,
    updateHistoryItem,
    removeHistoryItem,
    clearUnpinned,
  } = useHistoryState({ setFormError, setFormNotice })

  useEffect(() => {
    if (creditPurchaseSheetOpen) setCreditSheetRequested(true)
  }, [creditPurchaseSheetOpen])

  useEffect(() => {
    if (settingsSheetOpen) setSettingsSheetRequested(true)
  }, [settingsSheetOpen])

  const modelsMountedAtRef = useRef(Date.now())
  const modelsQuery = useQuery({
    queryKey: ['models', category],
    queryFn: () => fetchModels(category),
    staleTime: 15_000,
    refetchInterval: () =>
      Date.now() - modelsMountedAtRef.current < 90_000 ? 10_000 : false,
  })

  const catalogSyncedAtSeenRef = useRef<string | null>(null)
  useEffect(() => {
    const synced = healthQuery.data?.catalogSyncedAt
    if (!synced) return
    if (catalogSyncedAtSeenRef.current === null) {
      catalogSyncedAtSeenRef.current = synced
      return
    }
    if (catalogSyncedAtSeenRef.current === synced) return
    catalogSyncedAtSeenRef.current = synced
    void queryClient.invalidateQueries({ queryKey: ['models'] })
  }, [healthQuery.data?.catalogSyncedAt, queryClient])

  const models = modelsQuery.data?.data.models ?? EMPTY_MODELS
  const syncedAt = modelsQuery.data?.data.syncedAt
  const hasApiKey = healthQuery.data?.hasKey === true

  const selected: ModelDefinition | undefined = useMemo(
    () => models.find((m) => m.id === modelId) ?? models[0],
    [models, modelId],
  )

  useEffect(() => {
    if (!selected) return
    setModelId(selected.id)
    const pending = pendingRestoreRef.current
    if (pending && pending.modelId === selected.id) {
      // 履歴からの復元: デフォルト値の上に保存済み入力を重ねる
      pendingRestoreRef.current = null
      setValues(mergeInputWithDefaults(selected.fields, pending.input))
      setFormError(null)
      setFormNotice('History inputs restored to the form')
    } else if (pending && models.length > 0) {
      // 復元先モデルがカタログから消えている
      pendingRestoreRef.current = null
      setValues(buildDefaultValues(selected.fields))
      setFormNotice(null)
      setFormError(
        'The model to restore was not found in the current catalog',
      )
    } else {
      setValues(buildDefaultValues(selected.fields))
      setFormError(null)
      setFormNotice(null)
    }
    setFieldErrors({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  const handleCreditsUsed = useCallback(
    (credits: number) => {
      setLastUsedCredits(credits)
      void queryClient.invalidateQueries({ queryKey: ['credits'] })
    },
    [queryClient],
  )

  const { pendingCount, pendingTasks } = useTaskPolling({
    history,
    setHistory,
    requestHistoryPersist,
    onCreditsUsed: handleCreditsUsed,
  })

  const generate = useGenerateFlow({
    hasApiKey,
    selected,
    values,
    batchCount,
    submissionQueue,
    setFormError,
    setFieldErrors,
    setHistory,
    requestHistoryPersist,
    setViewerTaskId,
    setMobileView,
    setCreditPurchaseSheetOpen,
  })
  const personasQuery = useQuery({
    queryKey: ['personas'],
    queryFn: async () => (await fetchPersonas()).data.items,
    staleTime: 30_000,
  })
  const audioAssetsQuery = useQuery({
    queryKey: ['audio-assets'],
    queryFn: async () => (await fetchAudioAssets()).data.items,
    staleTime: 30_000,
  })

  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['audio-assets'] })
    }
    window.addEventListener('kie:audio-assets-changed', refresh)
    return () => window.removeEventListener('kie:audio-assets-changed', refresh)
  }, [queryClient])

  const submitting = generate.isPending
  const generateDisabled = submitting || !hasApiKey || healthQuery.isLoading

  // 同モデルの直近成功実績からクレジット消費を推定
  const creditEstimate = useMemo(() => {
    if (!selected) return null
    const samples = history
      .filter(
        (h) =>
          h.state === 'success' &&
          h.model === selected.model &&
          typeof h.creditsConsumed === 'number',
      )
      .slice(0, 5)
      .map((h) => h.creditsConsumed as number)
    if (samples.length === 0) return null
    return Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
  }, [history, selected])

  const currentFormErrors = useMemo(() => {
    if (!selected) return {}
    return {
      ...validateFields(selected.fields, values),
      ...validateWorkflowInput(selected, values),
    }
  }, [selected, values])

  const formIssues = useMemo(() => {
    if (!selected) return []
    return Object.keys(currentFormErrors).map((name) => {
      const field = selected.fields.find((candidate) => candidate.name === name)
      return field ? presentField(field).label : name
    })
  }, [currentFormErrors, selected])

  function selectHistory(h: HistoryItem) {
    setViewerTaskId(h.taskId)
  }

  function reuseHistory(h: HistoryItem) {
    if (!h.input || !h.modelId) return
    setMobileView('create')
    setViewerTaskId(null)
    if (selected && selected.id === h.modelId && category === h.category) {
      setValues(mergeInputWithDefaults(selected.fields, h.input))
      setFormError(null)
      setFieldErrors({})
      setFormNotice('History inputs restored to the form')
      window.requestAnimationFrame(() => {
        document
          .getElementById('model-select')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      return
    }
    // 同カテゴリならカタログの有無を即時判定できる。存在しないモデルへの
    // 復元は selected.id が変化せず effect が発火しないケースがあるため、
    // ここで弾いて pendingRestoreRef を残留させない。
    if (category === h.category && !models.some((m) => m.id === h.modelId)) {
      setFormError(
        "This history item's model was not found in the current catalog",
      )
      return
    }
    pendingRestoreRef.current = { modelId: h.modelId, input: h.input }
    setFormNotice('Restoring history inputs to the form…')
    if (category !== h.category) setCategory(h.category)
    setModelId(h.modelId)
  }

  function retryHistory(h: HistoryItem) {
    setViewerTaskId(null)
    generate.mutate({ source: 'retry', item: h })
  }

  const quickAction = useQuickAction({
    category,
    setCategory,
    setModelId,
    setMobileView,
    setViewerTaskId,
    setFormError,
    setFormNotice,
    pendingRestoreRef,
  })

  function sendToInput(url: string) {
    if (!selected) return
    setViewerTaskId(null)
    const refFields = selected.fields.filter((f) => f.type === 'reference')
    if (refFields.length === 0) {
      setFormError(
        'The current model has no image/video input fields. Switch to an Image to Image model first',
      )
      return
    }
    const isVideo = isVideoUrl(url)
    const target = refFields.find((f) =>
      f.accept
        ? isVideo
          ? /video/i.test(f.accept)
          : /image/i.test(f.accept)
        : true,
    )
    if (!target) {
      setFormError(
        isVideo
          ? 'The current model does not support video input. Switch to a supported model first'
          : 'The current model does not support image input. Switch to a supported model first',
      )
      return
    }
    const current = Array.isArray(values[target.name])
      ? (values[target.name] as string[])
      : []
    if (current.includes(url)) return
    const max = target.maxItems ?? 8
    if (current.length >= max) {
      setFormError(`${target.label} allows up to ${max} items`)
      return
    }
    handleFieldChange(target.name, [...current, url])
    setFormError(null)
    setMobileView('create')
  }

  function closeViewer() {
    setViewerTaskId(null)
  }

  function confirmDiscardForm(): boolean {
    if (!selected) return true
    if (!isFormDirty(selected.fields, values)) return true
    return window.confirm(
      'Your inputs will be lost. Switch model or category anyway?',
    )
  }

  function handleFieldChange(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }))
    setFormNotice(null)
    setFieldErrors((prev) => {
      if (!prev[name]) return prev
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  return (
    <AudioPlayerProvider>
      <StudioShell
      workspaceMode={view}
      onWorkspaceModeChange={setView}
      mobileView={mobileView}
      historyCount={history.length}
      pendingCount={pendingCount}
      onMobileViewChange={setMobileView}
      chromeTitle={
        <>
          KIE <span className="text-[var(--accent)]">STUDIO</span>
        </>
      }
      chromeSubtitle={
        view === 'agent'
          ? 'Agent'
          : 'kie.ai · IMAGE / VIDEO / AUDIO'
      }
      chromeMeta={
        view === 'agent'
          ? undefined
          : syncedAt
            ? (
                <p className="studio-meta">
                  catalog {new Date(syncedAt).toLocaleString()}
                </p>
              )
            : modelsQuery.data?.data.source === 'seed'
              ? (
                  <p className="studio-meta text-[var(--warning)]">
                    seed catalog · run npm run sync:models
                  </p>
                )
              : undefined
      }
      chromeTrailing={
        <div className="flex items-stretch gap-1.5 sm:gap-2">
          <CreditBadge lastUsed={lastUsedCredits} />
          <Pressable
            onClick={() => setSettingsSheetOpen(true)}
            className="studio-btn shrink-0 self-stretch px-2.5"
            aria-label="Open settings"
            scaleTo={0.96}
          >
            <Settings size={16} strokeWidth={2} aria-hidden />
          </Pressable>
        </div>
      }
      agent={
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-sm text-[var(--text-muted)]">
              Loading agent…
            </div>
          }
        >
          <AgentView onOpenSettings={() => setSettingsSheetOpen(true)} />
        </Suspense>
      }
      form={
        <>
          <div className="sticky top-0 z-[var(--z-sticky)] -mx-5 -mt-5 mb-2 shrink-0 border-b border-[var(--border)] bg-[var(--surface-raised)] px-5 pt-5 pb-4">
            <CategoryTabs
              value={category}
              disabled={submitting}
              onChange={(c) => {
                if (c === category) return true
                if (!confirmDiscardForm()) return false
                pendingRestoreRef.current = null
                setFormNotice(null)
                setCategory(c)
                setModelId(null)
                return true
              }}
            />
          </div>

          {modelsQuery.isLoading ? (
            <div
              className="studio-skeleton h-12 w-full rounded-[var(--radius-md)]"
              role="status"
              aria-label="Loading models"
            />
          ) : modelsQuery.isError ? (
            <p className="text-sm text-[var(--danger)]" role="alert">
              {(modelsQuery.error as Error).message}
            </p>
          ) : (
            <ModelSelect
              models={models}
              value={selected?.id ?? null}
              onChange={(id) => {
                if (id === selected?.id) return
                if (!confirmDiscardForm()) return
                pendingRestoreRef.current = null
                setFormNotice(null)
                setModelId(id)
              }}
              disabled={submitting}
            />
          )}

          {selected ? (
            <>
              <div id="panel-image" hidden={category !== 'image'} />
              <div id="panel-video" hidden={category !== 'video'} />
              <div id="panel-audio" hidden={category !== 'audio'} />
              {selected.docsUrl && (
                <a
                  href={selected.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-8 items-center gap-1 self-start py-1 text-xs font-medium text-[var(--accent)]"
                >
                  Docs
                  <ExternalLink size={12} strokeWidth={2} aria-hidden />
                </a>
              )}

              <DynamicForm
                key={selected.id}
                fields={selected.fields}
                values={values}
                onChange={handleFieldChange}
                disabled={submitting}
                fieldErrors={fieldErrors}
                modelId={selected.id}
              />

              {selected.provider === 'suno' && values.customMode !== false && selected.fields.some((field) => field.name === 'style') && (
                <SunoStyleAssist
                  value={typeof values.style === 'string' ? values.style : ''}
                  disabled={submitting}
                  onApply={(next) => handleFieldChange('style', next)}
                />
              )}

              {selected.provider === 'suno' && values.customMode !== false && selected.fields.some((field) => field.name === 'personaId') && (personasQuery.data?.length ?? 0) > 0 && (
                <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                  <label htmlFor="saved-persona" className="studio-label">Assets · Persona</label>
                  <select
                    id="saved-persona"
                    className="studio-select mt-2 w-full"
                    value={typeof values.personaId === 'string' ? values.personaId : ''}
                    onChange={(event) => handleFieldChange('personaId', event.target.value)}
                    disabled={submitting}
                  >
                    <option value="">No persona</option>
                    {personasQuery.data?.map((saved) => (
                      <option key={saved.id} value={saved.personaId}>{saved.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {selected.provider === 'suno' && selected.fields.some((field) => field.name === 'uploadUrl') && (audioAssetsQuery.data?.length ?? 0) > 0 && (
                <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                  <span className="studio-label">Assets · External audio</span>
                  <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                    {audioAssetsQuery.data?.map((asset) => {
                      const expired = typeof asset.expiresAt === 'number' && asset.expiresAt <= Date.now()
                      const selectedAsset = Array.isArray(values.uploadUrl) && values.uploadUrl.includes(asset.url)
                      return (
                        <Pressable
                          key={asset.id}
                          disabled={submitting || expired}
                          aria-pressed={selectedAsset}
                          className={`studio-chip min-w-36 justify-start ${selectedAsset ? 'is-active' : ''}`}
                          onClick={() => handleFieldChange('uploadUrl', [asset.url])}
                          scaleTo={0.97}
                        >
                          <span className="line-clamp-1">{asset.name}</span>
                          <span className="ml-1 text-[9px] opacity-70">{expired ? 'Expired' : 'Select'}</span>
                        </Pressable>
                      )
                    })}
                  </div>
                </div>
              )}

              {formError && (
                <div className="text-sm text-[var(--danger)]" role="alert">
                  <p>{formError}</p>
                </div>
              )}

              {formNotice && !formError && (
                <p
                  className="text-sm text-[var(--accent)]"
                  role="status"
                  aria-live="polite"
                >
                  {formNotice}
                </p>
              )}

              {!hasApiKey && !healthQuery.isLoading && (
                <div
                  className="flex flex-wrap items-center gap-2 text-sm text-[var(--warning)]"
                  role="status"
                >
                  <span>API key not set — cannot generate.</span>
                  <Pressable
                    onClick={() => setSettingsSheetOpen(true)}
                    className="studio-btn w-auto gap-1 px-3 text-xs"
                    scaleTo={0.96}
                  >
                    <Settings size={13} strokeWidth={2} aria-hidden />
                    Open settings
                  </Pressable>
                </div>
              )}

              {pendingCount > 0 && (
                <p className="text-xs text-[var(--warning)]" role="status">
                  Accepted {pendingTasks.filter((item) => item.state === 'waiting' || item.state === 'queuing').length}
                  {' · '}Generating {pendingTasks.filter((item) => item.state === 'generating' || item.state === 'unknown').length}
                </p>
              )}

              {submissionQueueItems.length > 0 && (
                <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
                  <span role="status">
                    Unsent {submissionQueueItems.filter((item) => item.state === 'unsent').length}
                    {' · '}Accepted {submissionQueueItems.filter((item) => item.state === 'accepted').length}
                  </span>
                  {submissionQueueItems.some((item) => item.state === 'unsent') && (
                    <Pressable
                      className="studio-btn"
                      onClick={() => submissionQueue.cancelUnsent()}
                      scaleTo={0.97}
                    >
                      Cancel unsent
                    </Pressable>
                  )}
                </div>
              )}

              <div className="studio-sticky-cta space-y-2">
                <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                  <span className="min-w-0 truncate font-medium text-[var(--text)]">
                    {selected.title}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {creditEstimate === null
                      ? 'No credit estimate'
                      : `≈${creditEstimate} cr/run`}
                  </span>
                </div>
                {formIssues.length > 0 && (
                  <button
                    type="button"
                    className="block w-full cursor-pointer text-left text-[11px] leading-snug text-[var(--warning)] underline decoration-transparent underline-offset-2 hover:decoration-current"
                    onClick={() => {
                      setFieldErrors(currentFormErrors)
                      requestAnimationFrame(() => focusFirstFieldError(currentFormErrors))
                    }}
                  >
                    Review: {formIssues.slice(0, 3).join(', ')}
                    {formIssues.length > 3 ? ` +${formIssues.length - 3} more` : ''}
                    <span className="ml-1">Go to first issue</span>
                  </button>
                )}
                <div className="flex items-center justify-between gap-2">
                  <div
                    className="flex items-center gap-1"
                    role="group"
                    aria-label="Batch size"
                  >
                    <span className="mr-1 text-[11px] text-[var(--text-muted)]">
                      Batch
                    </span>
                    {[1, 2, 3, 4].map((n) => (
                      <Pressable
                        key={n}
                        disabled={submitting}
                        aria-pressed={batchCount === n}
                        onClick={() => setBatchCount(n)}
                        className={`studio-chip ${
                          batchCount === n ? 'is-active' : ''
                        }`}
                        scaleTo={0.96}
                      >
                        ×{n}
                      </Pressable>
                    ))}
                  </div>
                </div>
                <Pressable
                  disabled={generateDisabled}
                  onClick={() => {
                    setFormNotice(null)
                    generate.mutate({ source: 'form' })
                  }}
                  className="studio-btn-primary cursor-pointer gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                  scaleTo={0.96}
                  aria-busy={submitting || undefined}
                >
                  {submitting && (
                    <span
                      className="studio-spinner size-4 shrink-0 rounded-full border-2 border-[var(--on-accent)]/40 border-t-[var(--on-accent)]"
                      aria-hidden
                    />
                  )}
                  {submitting
                    ? 'Sending…'
                    : creditEstimate !== null
                      ? batchCount > 1
                        ? `Generate ×${batchCount} (≈${creditEstimate * batchCount} cr)`
                        : `Generate (≈${creditEstimate} cr)`
                      : batchCount > 1
                        ? `Generate ×${batchCount}`
                        : 'Generate'}
                </Pressable>
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              Select a model
            </p>
          )}
        </>
      }
      canvas={
        <HistoryGallery
          items={history}
          loading={!historyReady}
          activeCategory={category}
          activeTaskId={viewerTaskId}
          pendingCount={pendingCount}
          onGoCreate={() => setMobileView('create')}
          onSelect={selectHistory}
          onClose={closeViewer}
          onReuse={reuseHistory}
          onRetry={retryHistory}
          onSendToInput={sendToInput}
          onTogglePin={togglePin}
          onExport={exportHistory}
          onImport={importHistory}
          onUpdateItem={updateHistoryItem}
          onQuickAction={quickAction}
          retryDisabled={generateDisabled}
          onRemove={(taskId) => {
            removeHistoryItem(taskId)
            if (viewerTaskId === taskId) setViewerTaskId(null)
          }}
          onClear={() => {
            if (
              !window.confirm(
                'Delete all history except pinned items? This cannot be undone.',
              )
            ) {
              return
            }
            clearUnpinned()
            setViewerTaskId(null)
          }}
        />
      }
      />

      {creditSheetRequested && (
        <Suspense fallback={null}>
          <CreditPurchaseSheet
            open={creditPurchaseSheetOpen}
            onClose={() => setCreditPurchaseSheetOpen(false)}
          />
        </Suspense>
      )}
      {settingsSheetRequested && (
        <Suspense fallback={null}>
          <SettingsSheet
            open={settingsSheetOpen}
            onClose={() => setSettingsSheetOpen(false)}
          />
        </Suspense>
      )}
    </AudioPlayerProvider>
  )
}
