import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Clock, Download, Music, Pin, Play, RotateCcw, WandSparkles } from 'lucide-react'
import {
  createPersona,
  downloadArchive,
  fetchDownloadUrl,
  fetchPersonas,
  fetchTimestampedLyrics,
  localMediaUrl,
} from '../lib/api.ts'
import { isAudioUrl, isVideoUrl, mediaKindFromUrl } from '../lib/media.ts'
import type {
  HistoryItem,
  MediaAsset,
  QuickAction,
  TaskState,
} from '../lib/models/types.ts'
import { Pressable } from './motion/Pressable.tsx'
import { SharedMedia } from './motion/SharedMedia.tsx'
import { SpringSheet } from './motion/SpringSheet.tsx'
import { useAudioPlayer } from './audio/audioPlayerContext.ts'

const smallBtnClass = 'studio-btn'

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

function stateLabel(state: TaskState): string {
  switch (state) {
    case 'success':
      return 'Succeeded'
    case 'fail':
      return 'Failed'
    case 'partial':
      return 'Partially succeeded'
    case 'expired':
      return 'Expired'
    case 'generating':
      return 'Generating'
    case 'queuing':
      return 'Queue'
    case 'waiting':
      return 'Accepted by API'
    case 'unknown':
      return 'Unknown status'
    default: {
      const _exhaustive: never = state
      return _exhaustive
    }
  }
}

function shortModel(model: string): string {
  const parts = model.split('/')
  return parts[parts.length - 1] || model
}

function isBusyState(state: TaskState): boolean {
  return state === 'waiting' || state === 'queuing' || state === 'generating'
}

function fullPrompt(item: HistoryItem): string | undefined {
  const prompt = item.input?.prompt ?? item.input?.text
  return typeof prompt === 'string' && prompt ? prompt : item.prompt
}

function canReuse(item: HistoryItem): boolean {
  return Boolean(item.input && item.modelId)
}

/** 詳細ビューアー用の画像。Import失敗時にフォールバックを表示する。 */
function ViewerImage({
  src,
  alt,
}: {
  src: string
  alt: string
}) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 bg-[var(--bg-elevated)] p-8 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-[var(--border)] text-[var(--text-muted)]">
          <Clock size={22} aria-hidden />
        </span>
        <p className="text-sm font-semibold text-[var(--text-muted)]">Unable to load media</p>
        <p className="max-w-xs text-xs leading-relaxed text-[var(--text-muted)]">
          Failed to load media. You can regenerate with the same input.
        </p>
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      decoding="async"
      referrerPolicy="no-referrer"
      className="mx-auto max-h-[55vh] w-full object-contain"
      onError={() => setFailed(true)}
    />
  )
}

function mediaFor(item: HistoryItem): MediaAsset[] {
  if (item.media?.length) return item.media
  return (item.resultUrls ?? []).map((url) => ({
    kind: mediaKindFromUrl(url, item.category),
    url,
  }))
}

function lyricsText(asset: MediaAsset): string | undefined {
  if (!asset.alignedWords?.length) return undefined
  return asset.alignedWords.map((word) => word.word).join(' ')
}

export function HistorySheets({
  active,
  showViewer,
  compareItems,
  showCompare,
  retryDisabled,
  onCloseViewer,
  onCloseCompare,
  onReuse,
  onRetry,
  onSendToInput,
  items,
  onUpdateItem,
  onQuickAction,
}: {
  active: HistoryItem | null
  showViewer: boolean
  compareItems: HistoryItem[]
  showCompare: boolean
  retryDisabled?: boolean
  onCloseViewer: () => void
  onCloseCompare: () => void
  onReuse: (item: HistoryItem) => void
  onRetry: (item: HistoryItem) => void
  onSendToInput: (url: string) => void
  items: HistoryItem[]
  onUpdateItem: (item: HistoryItem) => void
  onQuickAction: (
    item: HistoryItem,
    media: MediaAsset,
    action: QuickAction,
    options?: Record<string, unknown>,
  ) => void
}) {
  const audioPlayer = useAudioPlayer()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [copied, setCopied] = useState(false)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [rangeStart, setRangeStart] = useState(0)
  const [rangeEnd, setRangeEnd] = useState(12)
  const [selectedAudioUrl, setSelectedAudioUrl] = useState('')
  const activeMedia = useMemo(() => active ? mediaFor(active) : [], [active])
  const parent = active?.parentTaskId
    ? items.find((item) => item.taskId === active.parentTaskId)
    : undefined
  const availableAudio = useMemo(
    () => items.flatMap((item) => mediaFor(item)
      .filter((asset) => asset.kind === 'audio' && Boolean(asset.url ?? asset.streamUrl))
      .map((asset) => ({
        url: (asset.url ?? asset.streamUrl) as string,
        label: asset.title ?? shortModel(item.model),
      }))),
    [items],
  )
  const download = useMutation({
    mutationFn: async (url: string) => {
      const response = await fetchDownloadUrl(url)
      window.open(response.data.downloadUrl, '_blank', 'noopener,noreferrer')
    },
  })
  const archive = useMutation({
    mutationFn: async () => downloadArchive(
      activeMedia.flatMap((asset, index) => {
        const url = asset.url ?? asset.streamUrl
        const entries: Array<{ url: string; name?: string; lyrics?: string }> = url ? [{
          url,
          name: asset.title
            ? `${asset.title}-${index + 1}`
            : `${active?.taskId ?? 'media'}-${index + 1}`,
          lyrics: lyricsText(asset),
        }] : []
        if (asset.previewUrl && asset.previewUrl !== url) {
          entries.push({
            url: asset.previewUrl,
            name: `${asset.title ?? active?.taskId ?? 'media'}-${index + 1}-cover`,
          })
        }
        return entries
      }),
    ),
  })
  const lyrics = useMutation({
    mutationFn: async (asset: MediaAsset) => {
      if (!active || !asset.providerAssetId) throw new Error('Missing audio ID')
      return {
        asset,
        response: await fetchTimestampedLyrics(active.taskId, asset.providerAssetId),
      }
    },
    onSuccess: ({ asset, response }) => {
      if (!active) return
      onUpdateItem({
        ...active,
        media: activeMedia.map((entry) =>
          entry === asset || entry.providerAssetId === asset.providerAssetId
            ? {
                ...entry,
                alignedWords: response.data.alignedWords,
                waveform: response.data.waveformData,
              }
            : entry,
        ),
      })
    },
  })
  const personas = useQuery({
    queryKey: ['personas'],
    queryFn: async () => (await fetchPersonas()).data.items,
    staleTime: 30_000,
  })
  const persona = useMutation({
    mutationFn: async (asset: MediaAsset) => {
      if (!active || !asset.providerAssetId) throw new Error('Missing audio ID')
      const name = window.prompt('Name this vibe')?.trim()
      if (!name) throw new Error('Enter a persona name')
      const description = window.prompt('Description (optional)')?.trim() || undefined
      return createPersona({
        taskId: active.taskId,
        audioId: asset.providerAssetId,
        name,
        description,
      })
    },
    onSuccess: () => void personas.refetch(),
  })

  useEffect(() => {
    if (showViewer) closeButtonRef.current?.focus()
  }, [showViewer])

  useEffect(() => {
    setLyricsOpen(false)
    setSelectedAudioUrl('')
    setRangeStart(0)
    const duration = activeMedia.find((asset) => asset.kind === 'audio')?.duration
    setRangeEnd(Math.min(12, duration ?? 12))
    // Reset only when navigating to another task; lyrics updates should not close the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.taskId])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function copyPrompt(text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(true)
  }

  return (
    <>
      <SpringSheet
        open={Boolean(showViewer && active)}
        onClose={onCloseViewer}
        labelledBy="viewer-title"
      >
        {active && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <div className="min-w-0">
                <div id="viewer-title" className="truncate text-lg font-bold">
                  {shortModel(active.model)}
                  {active.pinned && (
                    <Pin
                      className="ml-2 inline text-[var(--accent)]"
                      size={14}
                      strokeWidth={2}
                      aria-label="Pinned"
                      fill="currentColor"
                    />
                  )}
                </div>
                <div className="mt-1 truncate text-xs text-[var(--text-muted)]">
                  {fullPrompt(active) || active.taskId}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {canReuse(active) && (
                  <Pressable
                    onClick={() => onReuse(active)}
                    className={`${smallBtnClass} inline-flex items-center gap-1`}
                    scaleTo={0.96}
                  >
                    <RotateCcw size={14} strokeWidth={2} aria-hidden />
                    Reuse with settings
                  </Pressable>
                )}
                <Pressable
                  ref={closeButtonRef}
                  className={smallBtnClass}
                  onClick={onCloseViewer}
                  scaleTo={0.96}
                  data-sheet-initial-focus="true"
                >
                  Close
                </Pressable>
              </div>
            </div>

            <div className="max-h-[70vh] overflow-y-auto bg-[var(--bg)] p-5">
              {isBusyState(active.state) && (
                <div className="flex flex-col items-center justify-center gap-3 py-16">
                  <div className="studio-spinner size-8 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
                  <p className="text-sm text-[var(--text-muted)]">
                    {stateLabel(active.state)}…
                  </p>
                </div>
              )}
              {active.state === 'fail' && (
                <div className="space-y-3 py-10 text-center">
                  <p className="text-sm font-medium text-[var(--danger)]">
                    Generation failed
                  </p>
                  {active.failMsg && (
                    <p className="mx-auto max-w-md text-xs text-[var(--text-muted)]">
                      {active.failMsg}
                    </p>
                  )}
                  {canReuse(active) && (
                    <Pressable
                      disabled={retryDisabled}
                      onClick={() => onRetry(active)}
                      className="studio-btn-primary mx-auto w-auto px-4 py-2 text-xs disabled:opacity-50"
                      scaleTo={0.97}
                    >
                      Retry with the same input
                    </Pressable>
                  )}
                </div>
              )}
              {active.state === 'unknown' && (
                <p className="py-10 text-center text-sm text-[var(--warning)]">
                  Could not retrieve the status
                </p>
              )}
              {(active.state === 'success' || active.state === 'partial') && activeMedia.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-[var(--text-muted)]">
                    {activeMedia.length > 1 ? `${activeMedia.length} candidates` : 'Generated result'}
                  </span>
                  <Pressable
                    disabled={archive.isPending}
                    onClick={() => archive.mutate()}
                    className={`${smallBtnClass} inline-flex items-center gap-1`}
                    scaleTo={0.96}
                  >
                    <Download size={13} aria-hidden />
                    {archive.isPending ? 'Preparing…' : 'Download all'}
                  </Pressable>
                </div>
              )}

              {active.operation === 'aleph' && parent && (
                <div className="mb-4 grid grid-cols-2 gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                  {[{ label: 'Before', item: parent }, { label: 'After', item: active }].map(({ label, item }) => {
                    const asset = mediaFor(item).find((entry) => entry.kind === 'video')
                    const url = asset?.localPath ? localMediaUrl(asset.localPath) : asset?.url ?? asset?.streamUrl
                    return (
                      <div key={label} className="min-w-0">
                        <span className="studio-label">{label}</span>
                        {url ? <video src={url} controls preload="metadata" className="mt-2 aspect-video w-full rounded-[var(--radius-sm)] bg-black object-contain" /> : null}
                      </div>
                    )
                  })}
                </div>
              )}

              {(active.state === 'success' || active.state === 'partial') &&
                activeMedia.map((asset, index) => {
                  const text = asset.kind === 'text' && typeof asset.metadata?.text === 'string'
                    ? asset.metadata.text
                    : null
                  if (text) {
                    return (
                      <div key={asset.id ?? `text-${index}`} className="mb-5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="studio-label">{asset.title ?? 'Text'}</span>
                          <button type="button" className="studio-btn px-2 py-1 text-[10px]" onClick={() => void navigator.clipboard.writeText(text)}>Copy</button>
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-7">{text}</p>
                      </div>
                    )
                  }
                  const remoteUrl = asset.url ?? asset.streamUrl
                  const url = asset.localPath
                    ? localMediaUrl(asset.localPath)
                    : remoteUrl
                  if (!url) return null
                  const audio = asset.kind === 'audio' || isAudioUrl(url)
                  const video = asset.kind === 'video' || isVideoUrl(url)
                  const alreadyPersona = personas.data?.some(
                    (saved) => saved.sourceAudioId === asset.providerAssetId,
                  )
                  const modelName = typeof asset.metadata?.modelName === 'string'
                    ? asset.metadata.modelName.toUpperCase()
                    : ''
                  const personaEligible =
                    active.provider === 'suno' &&
                    active.state === 'success' &&
                    Boolean(asset.providerAssetId) &&
                    /^V(?:4|5)/.test(modelName) &&
                    !alreadyPersona &&
                    modelName !== 'V3_5' &&
                    modelName !== 'V3.5'
                  const duration = asset.duration ?? 0
                  const rangeLength = rangeEnd - rangeStart
                  const validRange =
                    rangeLength >= 6 &&
                    rangeLength <= 60 &&
                    (!duration || rangeLength <= duration / 2)
                  return (
                  <div key={asset.id ?? url} className="mb-5 space-y-3">
                    <SharedMedia
                      layoutId={
                        index === 0
                          ? `media-${active.taskId}`
                          : `media-${active.taskId}-${index}`
                      }
                      className="studio-tile overflow-hidden"
                    >
                      {video ? (
                        <video
                          src={url}
                          controls
                          preload="metadata"
                          className="mx-auto max-h-[55vh] w-full bg-black object-contain"
                        />
                      ) : audio ? (
                        <div className="flex min-h-48 flex-col items-center justify-center gap-4 bg-[var(--accent-soft)] p-6 text-center">
                          {asset.previewUrl && <img src={asset.previewUrl} alt="" className="size-28 rounded-[var(--radius-md)] object-cover shadow-[var(--shadow-md)]" />}
                          <div>
                            <p className="font-semibold">{asset.title ?? `Candidate ${index + 1}`}</p>
                            {asset.duration && <p className="mt-1 text-xs text-[var(--text-muted)]">{Math.round(asset.duration)}s</p>}
                          </div>
                          <Pressable
                            className="studio-btn-primary inline-flex w-auto items-center gap-2 px-5"
                            onClick={() => audioPlayer.play(asset, activeMedia.filter((entry) => entry.kind === 'audio'))}
                          >
                            <Play size={16} fill="currentColor" /> Play
                          </Pressable>
                        </div>
                      ) : (
                        <ViewerImage
                          src={url}
                          alt={active.prompt || 'Generated result'}
                        />
                      )}
                    </SharedMedia>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className={smallBtnClass}
                      >
                        Open in new tab
                      </a>
                      <Pressable
                        disabled={download.isPending || !remoteUrl}
                        onClick={() => remoteUrl && download.mutate(remoteUrl)}
                        className={smallBtnClass}
                        scaleTo={0.96}
                      >
                        {download.isPending ? 'Preparing…' : 'Save'}
                      </Pressable>
                      <Pressable
                        onClick={() => onSendToInput(remoteUrl ?? url)}
                        className={`${smallBtnClass} inline-flex items-center gap-1`}
                        scaleTo={0.96}
                      >
                        <ArrowRight size={14} strokeWidth={2} aria-hidden />
                        {video
                          ? 'Use this video as input'
                          : audio
                            ? 'Use this audio as input'
                            : 'Use this image as input'}
                      </Pressable>
                      {typeof active.creditsConsumed === 'number' && (
                        <span className="ml-auto self-center text-xs text-[var(--text-muted)]">
                          Used{' '}
                          <span className="font-semibold text-[var(--danger)]">
                            −{active.creditsConsumed}
                          </span>
                        </span>
                      )}
                    </div>
                    {audio && asset.waveform?.length ? (
                      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                        <button
                          type="button"
                          className="flex h-20 w-full items-end gap-px overflow-hidden"
                          aria-label="Waveform. Click to seek"
                          onClick={(event) => {
                            if (!duration) return
                            const rect = event.currentTarget.getBoundingClientRect()
                            audioPlayer.seek(((event.clientX - rect.left) / rect.width) * duration)
                          }}
                        >
                          {asset.waveform.slice(0, 220).map((sample, sampleIndex) => (
                            <span key={sampleIndex} className="min-w-px flex-1 bg-[var(--accent)]" style={{ height: `${Math.max(3, Math.abs(sample) * 100)}%`, opacity: 0.35 + Math.abs(sample) * 0.65 }} />
                          ))}
                        </button>
                      </div>
                    ) : null}

                    {audio && active.provider === 'suno' && asset.providerAssetId && (
                      <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="flex flex-wrap gap-2">
                          <Pressable
                            className={smallBtnClass}
                            disabled={lyrics.isPending}
                            onClick={() => {
                              setLyricsOpen(true)
                              if (!asset.alignedWords?.length) lyrics.mutate(asset)
                            }}
                          >
                            <Music size={13} /> {lyrics.isPending ? 'Fetching lyrics…' : 'Synced lyrics'}
                          </Pressable>
                          <Pressable className={smallBtnClass} onClick={() => onQuickAction(active, asset, 'suno-extend')}>
                            Continue
                          </Pressable>
                          {personaEligible && (
                            <Pressable className={smallBtnClass} disabled={persona.isPending} onClick={() => persona.mutate(asset)}>
                              Save this vibe
                            </Pressable>
                          )}
                        </div>

                        {lyricsOpen && asset.alignedWords?.length ? (
                          <div className="max-h-48 overflow-y-auto rounded-[var(--radius-sm)] bg-[var(--bg)] p-3 text-sm leading-7">
                            {asset.alignedWords.map((word, wordIndex) => {
                              const activeWord =
                                audioPlayer.active?.providerAssetId === asset.providerAssetId &&
                                audioPlayer.currentTime >= word.startS &&
                                audioPlayer.currentTime < word.endS
                              return (
                                <button
                                  key={`${word.startS}-${wordIndex}`}
                                  type="button"
                                  onClick={() => {
                                    audioPlayer.play(asset, activeMedia.filter((entry) => entry.kind === 'audio'))
                                    audioPlayer.seek(word.startS)
                                  }}
                                  className={`mr-1 rounded px-0.5 ${activeWord ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'hover:bg-[var(--accent-soft)]'}`}
                                >
                                  {word.word}
                                </button>
                              )
                            })}
                          </div>
                        ) : lyricsOpen && lyrics.isError ? (
                          <p className="studio-field-error">{(lyrics.error as Error).message}</p>
                        ) : null}

                        {duration > 0 && (
                          <div className="space-y-2 border-t border-[var(--border)] pt-3">
                            <div className="flex items-center justify-between text-xs">
                              <span className="studio-label">Redo a section</span>
                              <span className={validRange ? 'text-[var(--text-muted)]' : 'text-[var(--danger)]'}>
                                {rangeStart.toFixed(1)}–{rangeEnd.toFixed(1)}s · {rangeLength.toFixed(1)}s
                              </span>
                            </div>
                            <input type="range" min={0} max={duration} step={0.1} value={Math.min(rangeStart, duration)} onChange={(event) => setRangeStart(Math.min(Number(event.target.value), rangeEnd - 0.1))} className="w-full accent-[var(--accent)]" aria-label="Section start" />
                            <input type="range" min={0} max={duration} step={0.1} value={Math.min(rangeEnd, duration)} onChange={(event) => setRangeEnd(Math.max(Number(event.target.value), rangeStart + 0.1))} className="w-full accent-[var(--accent)]" aria-label="Section end" />
                            <Pressable
                              className="studio-btn-primary w-full"
                              disabled={!validRange}
                              onClick={() => onQuickAction(active, asset, 'suno-replace-section', { infillStartS: rangeStart, infillEndS: rangeEnd })}
                            >
                              <WandSparkles size={14} /> Edit section
                            </Pressable>
                            {!validRange && <p className="studio-field-error">Select 6–60s, and at most 50% of the full song</p>}
                          </div>
                        )}
                      </div>
                    )}

                    {audio && active.provider !== 'suno' && (
                      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                        <Pressable className={smallBtnClass} onClick={() => onQuickAction(active, asset, 'suno-upload-extend')}>
                          Continue in Suno
                        </Pressable>
                      </div>
                    )}

                    {video && (
                      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="flex flex-wrap gap-2">
                          {active.provider === 'runway' && (
                            <>
                              <Pressable className={smallBtnClass} onClick={() => onQuickAction(active, asset, 'runway-aleph')}>Change visuals with a prompt</Pressable>
                              <Pressable className={smallBtnClass} onClick={() => onQuickAction(active, asset, 'runway-extend')}>Extend</Pressable>
                            </>
                          )}
                          {active.provider === 'veo' && (
                            <Pressable className={smallBtnClass} onClick={() => onQuickAction(active, asset, 'veo-extend')}>Extend</Pressable>
                          )}
                          <Pressable className={smallBtnClass} onClick={() => onQuickAction(active, asset, 'market-upscale')}>Upscale</Pressable>
                        </div>
                        <details className="mt-2 text-[11px] text-[var(--text-muted)]">
                          <summary className="min-h-6 cursor-pointer py-1 font-medium text-[var(--accent)]">
                            More actions
                          </summary>
                          <div className="flex flex-wrap gap-2 pb-1">
                            {active.provider === 'veo' && (
                              <>
                                <Pressable className={smallBtnClass} onClick={() => onQuickAction(active, asset, 'veo-1080p')}>1080p</Pressable>
                                <Pressable className={smallBtnClass} onClick={() => onQuickAction(active, asset, 'veo-4k')}>4K</Pressable>
                              </>
                            )}
                            <Pressable className={smallBtnClass} onClick={() => onQuickAction(active, asset, 'market-edit')}>Edit in Market</Pressable>
                            {availableAudio.length > 0 && (
                              <select className="studio-select py-1.5 text-xs" value={selectedAudioUrl} onChange={(event) => setSelectedAudioUrl(event.target.value)} aria-label="Audio for lip sync">
                                <option value="">Select audio…</option>
                                {availableAudio.map((entry, audioIndex) => <option key={`${entry.url}-${audioIndex}`} value={entry.url}>{entry.label}</option>)}
                              </select>
                            )}
                            {selectedAudioUrl && (
                              <Pressable className={smallBtnClass} onClick={() => onQuickAction(active, asset, 'lip-sync', { audioUrl: selectedAudioUrl })}>Lip sync with audio</Pressable>
                            )}
                            {availableAudio.length > 0 && <p className="w-full text-[10px] text-[var(--text-muted)]">If the video and audio lengths differ, the model may trim or loop them. Sent after you confirm in the form.</p>}
                          </div>
                        </details>
                      </div>
                    )}

                    {!audio && !video && (
                      <div className="flex flex-wrap gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                        <Pressable className={smallBtnClass} onClick={() => onQuickAction(active, asset, 'market-upscale')}>Upscale</Pressable>
                        <Pressable className={smallBtnClass} onClick={() => onQuickAction(active, asset, 'market-edit')}>Edit in Market</Pressable>
                      </div>
                    )}

                    {download.isError && (
                      <p className="studio-field-error">
                        {(download.error as Error).message ||
                          'Failed to get the download URL'}
                      </p>
                    )}
                  </div>
                )})}

              {archive.isError && <p className="studio-field-error">{(archive.error as Error).message}</p>}
              {persona.isError && <p className="studio-field-error">{(persona.error as Error).message}</p>}

              {fullPrompt(active) && (
                <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="studio-label">Prompt</span>
                    <Pressable
                      onClick={() => void copyPrompt(fullPrompt(active)!)}
                      className={`${smallBtnClass} text-[11px]`}
                      scaleTo={0.96}
                    >
                      {copied ? (
                        <>
                          <span role="status" aria-live="polite">
                            Copied
                          </span>
                          <Check size={12} strokeWidth={2.5} aria-hidden />
                        </>
                      ) : (
                        'Copy'
                      )}
                    </Pressable>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--text)]">
                    {fullPrompt(active)}
                  </p>
                </div>
              )}

              <details className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
                <summary className="cursor-pointer text-xs font-semibold">API details</summary>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                  <dt className="text-[var(--text-muted)]">Task ID</dt>
                  <dd className="break-all font-mono">{active.taskId}</dd>
                  <dt className="text-[var(--text-muted)]">Provider</dt>
                  <dd>{active.provider ?? 'market'} · {active.operation ?? 'generate'}</dd>
                  {active.providerStatus && <><dt className="text-[var(--text-muted)]">Provider status</dt><dd>{active.providerStatus}</dd></>}
                  {active.parentTaskId && <><dt className="text-[var(--text-muted)]">Parent task</dt><dd className="break-all font-mono">{active.parentTaskId}</dd></>}
                </dl>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 flex items-center justify-between"><span className="studio-label">Sent parameters</span><button type="button" className="studio-btn px-2 py-1 text-[10px]" onClick={() => void navigator.clipboard.writeText(JSON.stringify(active.rawParam ?? active.input ?? {}, null, 2))}>Copy</button></div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--bg)] p-2 text-[10px]">{JSON.stringify(active.rawParam ?? active.input ?? {}, null, 2)}</pre>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between"><span className="studio-label">Raw response</span><button type="button" className="studio-btn px-2 py-1 text-[10px]" onClick={() => void navigator.clipboard.writeText(JSON.stringify(active.rawResult ?? {}, null, 2))}>Copy</button></div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--bg)] p-2 text-[10px]">{JSON.stringify(active.rawResult ?? {}, null, 2)}</pre>
                  </div>
                </div>
              </details>
            </div>
          </>
        )}
      </SpringSheet>

      <SpringSheet
        open={showCompare && compareItems.length >= 2}
        onClose={onCloseCompare}
        label="Compare generations"
        maxWidthClass="max-w-6xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="text-lg font-bold tabular-nums">
            Compare ({compareItems.length})
          </div>
          <Pressable className={smallBtnClass} onClick={onCloseCompare}>
            Close
          </Pressable>
        </div>
        <div className="max-h-[82vh] overflow-y-auto p-4">
          <div
            className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 sm:grid sm:overflow-visible sm:pb-0 sm:[grid-template-columns:repeat(var(--compare-cols),minmax(0,1fr))]"
            style={
              { '--compare-cols': String(compareItems.length) } as CSSProperties
            }
          >
            {compareItems.map((item) => {
              const asset = mediaFor(item)[0]
              const url = asset?.localPath ? localMediaUrl(asset.localPath) : asset?.url ?? asset?.streamUrl
              return (
                <div
                  key={item.taskId}
                  className="studio-tile flex w-[min(80vw,280px)] shrink-0 snap-center flex-col gap-2 p-2 sm:w-auto sm:min-w-0"
                >
                  <div className="overflow-hidden rounded-[var(--radius-sm)] bg-[var(--bg)]">
                    {url ? (
                      asset?.kind === 'video' || isVideoUrl(url) ? (
                        <video
                          src={url}
                          controls
                          muted
                          preload="metadata"
                          className="aspect-square w-full bg-black object-contain"
                        />
                      ) : asset?.kind === 'audio' || isAudioUrl(url) ? (
                        <div className="flex aspect-square flex-col items-center justify-center gap-3 bg-[var(--accent-soft)] p-4 text-center">
                          {asset?.previewUrl && <img src={asset.previewUrl} alt="" className="size-24 rounded-[var(--radius-md)] object-cover" />}
                          <Pressable className="studio-btn-primary grid size-10 place-items-center p-0" onClick={() => audioPlayer.play(asset, mediaFor(item).filter((entry) => entry.kind === 'audio'))} aria-label="Play"><Play size={16} fill="currentColor" /></Pressable>
                        </div>
                      ) : (
                        <img
                          src={url}
                          alt={item.prompt || shortModel(item.model)}
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          className="aspect-square w-full object-contain"
                        />
                      )
                    ) : (
                      <div className="flex aspect-square items-center justify-center text-xs text-[var(--text-muted)]">
                        {stateLabel(item.state)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="truncate text-xs font-semibold">
                      {shortModel(item.model)}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                      <span>{relativeTime(item.createdAt)}</span>
                      {typeof item.creditsConsumed === 'number' && (
                        <span>−{item.creditsConsumed}</span>
                      )}
                    </div>
                    {fullPrompt(item) && (
                      <p className="line-clamp-6 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--text-muted)]">
                        {fullPrompt(item)}
                      </p>
                    )}
                    {canReuse(item) && (
                      <Pressable
                        onClick={() => {
                          onCloseCompare()
                          onReuse(item)
                        }}
                        className={`${smallBtnClass} w-full`}
                        scaleTo={0.97}
                      >
                        <RotateCcw size={12} strokeWidth={2} aria-hidden />
                        Reuse this input
                      </Pressable>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </SpringSheet>
    </>
  )
}
