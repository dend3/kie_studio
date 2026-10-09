import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Clock,
  Ellipsis,
  Pin,
  Plus,
  Play,
  RotateCcw,
  Video,
  X,
} from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { isAudioUrl, isVideoUrl } from '../lib/media.ts'
import { localMediaUrl } from '../lib/api.ts'
import type { HistoryItem, MediaAsset, QuickAction, TaskState } from '../lib/models/types.ts'
import { Pressable, PressableDiv } from './motion/Pressable.tsx'
import { SharedMedia } from './motion/SharedMedia.tsx'
import { useAudioPlayer } from './audio/audioPlayerContext.ts'

const HistorySheets = lazy(() =>
  import('./HistorySheets.tsx').then((module) => ({
    default: module.HistorySheets,
  })),
)

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'Just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}h ago`
  const day = Math.floor(hour / 24)
  if (day < 7) return `${day}d ago`
  return new Date(ts).toLocaleDateString()
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

function canReuse(item: HistoryItem): boolean {
  return Boolean(item.input && item.modelId)
}

type StateFilter = 'all' | 'success' | 'fail' | 'busy'
type CategoryFilter = 'context' | 'all' | 'image' | 'video' | 'audio'

const MAX_COMPARE = 4

const smallBtnClass = 'studio-btn'
const filterSelectClass = 'studio-select w-auto max-w-none px-2 py-1.5 text-xs'

/** img の onError でフォールバック表示に切り替えるラッパー。 */
function GalleryImage({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className: string
}) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[var(--bg-elevated)] p-3 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-[var(--border)] text-[var(--text-muted)]">
          <Clock size={18} aria-hidden />
        </span>
        <span className="text-[10px] leading-relaxed text-[var(--text-muted)]">
          Unable to load media
        </span>
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setFailed(true)}
    />
  )
}

function DeferredVideo({
  src,
  poster,
  fallbackLabel,
  className,
}: {
  src: string
  poster?: string
  fallbackLabel: string
  className: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [nearViewport, setNearViewport] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video || nearViewport) return
    if (!('IntersectionObserver' in window)) {
      setNearViewport(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setNearViewport(true)
        observer.disconnect()
      },
      { rootMargin: '300px' },
    )
    observer.observe(video)
    return () => observer.disconnect()
  }, [nearViewport])

  const mediaVisible = Boolean(poster) || loaded

  return (
    <div className={`${className} relative`}>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--accent-soft)] p-3 text-center text-[var(--text-muted)]">
        <Video size={20} aria-hidden />
        <span className="line-clamp-2 text-[10px] font-medium">
          {failed ? 'Preview unavailable' : fallbackLabel}
        </span>
      </div>
      <video
        ref={videoRef}
        src={nearViewport ? src : undefined}
        poster={poster}
        muted
        playsInline
        preload={nearViewport ? 'metadata' : 'none'}
        aria-label={fallbackLabel}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ${mediaVisible && !failed ? 'opacity-100' : 'opacity-0'}`}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget
          if (Number.isFinite(video.duration) && video.duration > 0.1) {
            video.currentTime = 0.1
          }
        }}
        onLoadedData={() => setLoaded(true)}
        onSeeked={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  )
}

/** 1 秒ごとにティックし、`createdAt` からの経過時間を表示するライブタイマー。 */
function ElapsedTimer({ createdAt }: { createdAt: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const sec = Math.max(0, Math.floor((now - createdAt) / 1000))
  const label =
    sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`
  return <span className="tabular-nums">{label} elapsed</span>
}

export function HistoryGallery({
  items,
  loading = false,
  activeCategory,
  activeTaskId,
  pendingCount = 0,
  retryDisabled,
  onGoCreate,
  onSelect,
  onClose,
  onRemove,
  onClear,
  onReuse,
  onRetry,
  onSendToInput,
  onTogglePin,
  onExport,
  onImport,
  onUpdateItem,
  onQuickAction,
}: {
  items: HistoryItem[]
  /** 初回 hydrate 中。空履歴と区別してスケルトンを表示する */
  loading?: boolean
  activeCategory: 'image' | 'video' | 'audio'
  activeTaskId?: string | null
  pendingCount?: number
  retryDisabled?: boolean
  /** モバイル空状態の「Open Create tab」導線 */
  onGoCreate?: () => void
  onSelect: (item: HistoryItem) => void
  onClose: () => void
  onRemove: (taskId: string) => void
  onClear: () => void
  onReuse: (item: HistoryItem) => void
  onRetry: (item: HistoryItem) => void
  onSendToInput: (url: string) => void
  onTogglePin: (taskId: string) => void
  onExport: () => void
  onImport: (raw: string) => void
  onUpdateItem: (item: HistoryItem) => void
  onQuickAction: (
    item: HistoryItem,
    media: MediaAsset,
    action: QuickAction,
    options?: Record<string, unknown>,
  ) => void
}) {
  const audioPlayer = useAudioPlayer()
  const importInputRef = useRef<HTMLInputElement>(null)
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('context')
  const [modelFilter, setModelFilter] = useState<string>('all')
  const [compareMode, setCompareMode] = useState(false)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [showCompare, setShowCompare] = useState(false)
  const [sheetsRequested, setSheetsRequested] = useState(false)
  const scrollParentRef = useRef<HTMLDivElement>(null)
  // Tailwind の sm / xl ブレークポイントと同じ列数を追跡する
  const [columns, setColumns] = useState(2)

  useEffect(() => {
    const sm = window.matchMedia('(min-width: 640px)')
    const xl = window.matchMedia('(min-width: 1280px)')
    const update = () => setColumns(xl.matches ? 4 : sm.matches ? 3 : 2)
    update()
    sm.addEventListener('change', update)
    xl.addEventListener('change', update)
    return () => {
      sm.removeEventListener('change', update)
      xl.removeEventListener('change', update)
    }
  }, [])

  const effectiveCategory = categoryFilter === 'context'
    ? activeCategory
    : categoryFilter

  const modelOptions = useMemo(
    () => [...new Set(items
      .filter((item) => effectiveCategory === 'all' || item.category === effectiveCategory)
      .map((item) => item.model))],
    [effectiveCategory, items],
  )
  const effectiveModelFilter = modelOptions.includes(modelFilter)
    ? modelFilter
    : 'all'

  const itemById = useMemo(
    () => new Map(items.map((item) => [item.taskId, item])),
    [items],
  )
  const active = (activeTaskId ? itemById.get(activeTaskId) : null) ?? null
  const showViewer = Boolean(
    active &&
      (isBusyState(active.state) ||
        active.state === 'fail' ||
        active.state === 'unknown' ||
        (active.media?.length ?? 0) > 0 ||
        (active.resultUrls?.length ?? 0) > 0),
  )

  const filtered = useMemo(() => {
    const list = items.filter((h) => {
      if (effectiveCategory !== 'all' && h.category !== effectiveCategory) {
        return false
      }
      if (effectiveModelFilter !== 'all' && h.model !== effectiveModelFilter) return false
      switch (stateFilter) {
        case 'success':
          return h.state === 'success' || h.state === 'partial'
        case 'fail':
          return h.state === 'fail' || h.state === 'expired'
        case 'busy':
          return isBusyState(h.state)
        case 'all':
          return true
        default: {
          const exhaustive: never = stateFilter
          return exhaustive
        }
      }
    })
    // ピン留めを先頭に表示（同グループ内は createdAt 降順）
    return list.toSorted((a, b) => {
      const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
      if (pinDiff !== 0) return pinDiff
      return (b.createdAt ?? 0) - (a.createdAt ?? 0)
    })
  }, [effectiveCategory, effectiveModelFilter, items, stateFilter])

  const validCompareIds = useMemo(
    () => compareIds.filter((id) => itemById.has(id)),
    [compareIds, itemById],
  )
  const compareItems = useMemo(
    () =>
      validCompareIds
        .map((id) => itemById.get(id))
        .filter((h): h is HistoryItem => Boolean(h)),
    [itemById, validCompareIds],
  )
  const compareIdSet = useMemo(
    () => new Set(validCompareIds),
    [validCompareIds],
  )
  // 行単位の仮想化（列数で区切った行を measureElement で実測）
  const rowCount = Math.ceil(filtered.length / columns)
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 280,
    overscan: 3,
    // 初回測定前（SSR / jsdom 含む）でも先頭行を描画するための初期矩形
    initialRect: { width: 800, height: 600 },
  })

  useEffect(() => {
    if (!showCompare) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowCompare(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showCompare])

  useEffect(() => {
    if (showViewer || showCompare) setSheetsRequested(true)
  }, [showCompare, showViewer])

  function toggleCompare(taskId: string) {
    setCompareIds((prev) => {
      const current = prev.filter((id) => itemById.has(id))
      if (current.includes(taskId)) {
        return current.filter((id) => id !== taskId)
      }
      if (current.length >= MAX_COMPARE) return current
      return [...current, taskId]
    })
  }

  function exitCompareMode() {
    setCompareMode(false)
    setCompareIds([])
    setShowCompare(false)
  }

  function resetFilters() {
    setStateFilter('all')
    setCategoryFilter('context')
    setModelFilter('all')
  }

  async function handleImportFile(file: File) {
    onImport(await file.text())
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <div className="gallery-toolbar flex flex-wrap items-start justify-between gap-3 px-0 py-2">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-[0.9375rem] font-bold text-[var(--text)]">
            Gallery
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            {loading
              ? 'Loading…'
              : items.length === 0
                ? 'No generations yet'
                : pendingCount > 0
                  ? `${items.length} items · ${pendingCount} generating`
                  : `${items.length} items (pins kept up to the limit)`}
          </p>
        </div>
        <div className="relative flex flex-wrap items-center gap-1.5">
          {(items.length > 1 || compareMode) && (
            <Pressable
              onClick={() =>
                compareMode ? exitCompareMode() : setCompareMode(true)
              }
              aria-pressed={compareMode}
              className={`${smallBtnClass} ${
                compareMode ? 'border-[var(--accent)] text-[var(--accent)]' : ''
              }`}
              scaleTo={0.96}
            >
              {compareMode ? 'Exit compare' : 'Compare'}
            </Pressable>
          )}
          <details className="relative">
            <summary
              className={`${smallBtnClass} list-none [&::-webkit-details-marker]:hidden`}
              aria-label="More actions"
            >
              <Ellipsis size={14} strokeWidth={2} aria-hidden />
            </summary>
            <div className="absolute right-0 z-[var(--z-dropdown)] mt-1 min-w-36 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] py-1 shadow-[var(--shadow-context)]">
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={onExport}
                  className="block w-full px-3 py-2 text-left text-xs hover:bg-[var(--accent-soft)]"
                >
                  Export
                </button>
              )}
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-[var(--accent-soft)]"
              >
                Import
              </button>
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={onClear}
                  className="block w-full px-3 py-2 text-left text-xs text-[var(--danger)] hover:bg-[var(--accent-soft)]"
                >
                  Delete all
                </button>
              )}
            </div>
          </details>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Import history JSON"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleImportFile(file)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value as CategoryFilter)
              scrollParentRef.current?.scrollTo({ top: 0 })
            }}
            aria-label="Filter by category"
            className={filterSelectClass}
          >
            <option value="context">
              Working: {activeCategory === 'image' ? 'Image' : activeCategory === 'video' ? 'Video' : 'Audio'}
            </option>
            <option value="all">All categories</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
          </select>
          <select
            value={stateFilter}
            onChange={(e) => {
              setStateFilter(e.target.value as StateFilter)
              scrollParentRef.current?.scrollTo({ top: 0 })
            }}
            aria-label="Filter by status"
            className={filterSelectClass}
          >
            <option value="all">All statuses</option>
            <option value="success">Succeeded</option>
            <option value="fail">Failed</option>
            <option value="busy">Generating</option>
          </select>
          <select
            value={effectiveModelFilter}
            onChange={(e) => {
              setModelFilter(e.target.value)
              scrollParentRef.current?.scrollTo({ top: 0 })
            }}
            aria-label="Filter by model"
            className={`${filterSelectClass} max-w-44`}
          >
            <option value="all">All models</option>
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {shortModel(m)}
              </option>
            ))}
          </select>
          {filtered.length !== items.length && (
            <span className="text-[var(--text-muted)]">
              Showing {filtered.length} / {items.length}
            </span>
          )}
        </div>
      )}

      {compareMode && (
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-3 py-2">
          <span className="text-xs text-[var(--text)]">
            Select items to compare (up to {MAX_COMPARE}):{' '}
            <span className="font-semibold tabular-nums">
              {compareItems.length} selected
            </span>
          </span>
          <button
            type="button"
            disabled={compareItems.length < 2}
            onClick={() => setShowCompare(true)}
            className="studio-btn-primary w-auto cursor-pointer px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Compare side by side
          </button>
        </div>
      )}

      {loading ? (
        <div
          className="grid flex-1 content-start grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4"
          role="status"
          aria-label="Loading history"
        >
          {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
            <div key={n} className="studio-tile" aria-hidden>
              <div className="studio-skeleton aspect-square rounded-none" />
              <div className="border-t border-[var(--border)] bg-[var(--surface-raised)] px-2 py-2.5">
                <div className="studio-skeleton h-2.5 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
          <div className="max-w-sm">
            <p className="studio-empty-title">Nothing here yet</p>
            <p className="studio-empty-body">
              <span className="hidden lg:inline">
                Generations you create from the form on the left will appear here
              </span>
              <span className="lg:hidden">
                Generations you create from the form in the Create tab will appear here
              </span>
            </p>
            {onGoCreate && (
              <button
                type="button"
                onClick={onGoCreate}
                className="studio-btn mx-auto mt-4 lg:hidden"
              >
                Open Create tab
              </button>
            )}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
          <div className="max-w-sm">
            <p className="studio-empty-title">No matches</p>
            <p className="studio-empty-body">
              No history matches your filters
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="studio-btn mx-auto mt-4"
            >
              Reset filters
            </button>
          </div>
        </div>
      ) : (
        <div ref={scrollParentRef} className="min-h-0 flex-1 overflow-y-auto">
          <div
            className="relative w-full"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => (
            <div
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute left-0 top-0 grid w-full grid-cols-2 gap-2.5 pb-2.5 sm:grid-cols-3 xl:grid-cols-4"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
            {filtered
              .slice(
                virtualRow.index * columns,
                (virtualRow.index + 1) * columns,
              )
              .map((h) => {
              const selected = h.taskId === activeTaskId
              const comparing = compareIdSet.has(h.taskId)
              const primaryMedia = h.media?.[0]
              const mediaUrl = primaryMedia?.localPath
                ? localMediaUrl(primaryMedia.localPath)
                : primaryMedia?.url ?? primaryMedia?.streamUrl ?? h.resultUrls?.[0]
              const thumb = primaryMedia?.localPath
                ? localMediaUrl(primaryMedia.localPath)
                : primaryMedia?.previewUrl ?? mediaUrl
              const audioTracks = (h.media ?? []).filter((asset) => asset.kind === 'audio')
              const isAudio = primaryMedia?.kind === 'audio'
                || h.category === 'audio'
                || Boolean(mediaUrl && isAudioUrl(mediaUrl))
              const busy = isBusyState(h.state)

              return (
                <div
                  key={h.taskId}
                  className={`studio-tile group flex flex-col ${
                    compareMode && comparing
                      ? 'is-selected'
                      : selected && !compareMode
                        ? 'is-selected'
                        : ''
                  }`}
                >
                  <PressableDiv
                    className="relative"
                    scaleTo={0.96}
                  >
                    <button
                      type="button"
                      className="block w-full text-left"
                      aria-current={selected ? 'true' : undefined}
                      aria-pressed={compareMode ? comparing : undefined}
                      onClick={() =>
                        compareMode ? toggleCompare(h.taskId) : onSelect(h)
                      }
                    >
                      <SharedMedia
                        layoutId={`media-${h.taskId}`}
                        className="relative aspect-square overflow-hidden bg-[var(--bg-elevated)]"
                      >
                        {thumb && !isAudio ? (
                          primaryMedia?.kind === 'video' ||
                          h.category === 'video' ||
                          isVideoUrl(mediaUrl ?? thumb) ? (
                            <DeferredVideo
                              src={mediaUrl ?? thumb}
                              poster={primaryMedia?.previewUrl && !isVideoUrl(primaryMedia.previewUrl) ? primaryMedia.previewUrl : undefined}
                              fallbackLabel={h.prompt || shortModel(h.model)}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <GalleryImage
                              src={thumb}
                              alt={h.prompt || shortModel(h.model)}
                              className="h-full w-full object-cover"
                            />
                          )
                        ) : isAudio && !busy ? (
                          <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--accent-soft)] p-4 text-center">
                            {primaryMedia?.previewUrl ? (
                              <img src={primaryMedia.previewUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-55" />
                            ) : null}
                            <span className="relative grid size-12 place-items-center rounded-full bg-[var(--accent)] text-[var(--on-accent)] shadow-[var(--shadow-md)]">
                              <Play size={20} fill="currentColor" />
                            </span>
                            <span className="relative line-clamp-2 text-xs font-semibold">
                              {primaryMedia?.title ?? h.prompt ?? 'Generated audio'}
                            </span>
                            {audioTracks.length > 1 && (
                              <span className="relative text-[10px] text-[var(--text-muted)]">{audioTracks.length} options</span>
                            )}
                          </div>
                        ) : busy ? (
                          <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--accent-soft)] p-3">
                            <div className="relative">
                              <div className="studio-spinner size-9 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
                            </div>
                            <div className="text-center">
                              <div className="text-xs font-semibold text-[var(--accent)]">
                                Generating
                              </div>
                              <div className="mt-0.5 text-[11px] font-medium text-[var(--text)]">
                                <ElapsedTimer createdAt={h.createdAt} />
                              </div>
                              <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                                {stateLabel(h.state)}
                              </div>
                            </div>
                          </div>
                        ) : h.state === 'fail' ? (
                          <div className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center">
                            <span className="text-xs font-semibold text-[var(--danger)]">
                              Failed
                            </span>
                            {h.failMsg && (
                              <span className="line-clamp-3 text-[10px] text-[var(--text-muted)]">
                                {h.failMsg}
                              </span>
                            )}
                          </div>
                        ) : h.state === 'unknown' ? (
                          <div className="flex h-full items-center justify-center p-3 text-center text-xs text-[var(--warning)]">
                            Unknown status
                          </div>
                        ) : (
                          <div className="flex h-full items-center justify-center text-[11px] uppercase text-[var(--text-muted)]">
                            {h.category}
                          </div>
                        )}

                        <div className="pointer-events-none absolute inset-x-0 bottom-0 studio-tile-scrim p-2">
                          <div className="truncate text-[11px] font-medium text-[var(--on-scrim)]">
                            {shortModel(h.model)}
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-1 text-[10px] text-[var(--on-scrim-muted)] tabular-nums">
                            <span>{relativeTime(h.createdAt)}</span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              {typeof h.creditsConsumed === 'number' && (
                                <span>−{h.creditsConsumed}</span>
                              )}
                            </span>
                          </div>
                        </div>

                        <span className="absolute left-2 top-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text)]">
                          {h.category === 'image' ? 'Image' : h.category === 'video' ? 'Video' : 'Audio'}
                        </span>

                        {compareMode && (
                          <span
                            className={`absolute right-2 top-2 flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-xs font-bold tabular-nums ${
                              comparing
                                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                                : 'border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)]'
                            }`}
                          >
                            {comparing ? (
                              validCompareIds.indexOf(h.taskId) + 1
                            ) : (
                              <Plus size={12} strokeWidth={2.5} aria-hidden />
                            )}
                          </span>
                        )}
                      </SharedMedia>
                    </button>
                  </PressableDiv>

                  {!compareMode && (
                    <div className="flex items-center gap-0.5 border-t border-[var(--border)] bg-[var(--surface-raised)] px-1 py-1">
                      <Pressable
                        title={h.pinned ? 'Unpin' : 'Pin'}
                        aria-label={h.pinned ? 'Unpin' : 'Pin'}
                        aria-pressed={Boolean(h.pinned)}
                        onClick={() => onTogglePin(h.taskId)}
                        scaleTo={0.96}
                        className={`rounded-[var(--radius-sm)] p-1.5 ${
                          h.pinned
                            ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                            : 'text-[var(--text-muted)] hover:text-[var(--accent)]'
                        }`}
                      >
                        <Pin
                          size={14}
                          strokeWidth={2}
                          aria-hidden
                          fill={h.pinned ? 'currentColor' : 'none'}
                        />
                      </Pressable>
                      {canReuse(h) && (
                        <Pressable
                          title="Restore this input to the form"
                          aria-label="Restore this input to the form"
                          onClick={() => onReuse(h)}
                          scaleTo={0.96}
                          className="rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] hover:text-[var(--accent)]"
                        >
                          <RotateCcw size={14} strokeWidth={2} aria-hidden />
                        </Pressable>
                      )}
                      {h.state === 'fail' && canReuse(h) && (
                        <Pressable
                          disabled={retryDisabled}
                          onClick={() => onRetry(h)}
                          scaleTo={0.96}
                          className="rounded-[var(--radius-sm)] px-2 py-1 text-[10px] font-semibold text-[var(--danger)] disabled:opacity-50"
                        >
                          Retry
                        </Pressable>
                      )}
                      {isAudio && audioTracks.length > 0 && (
                        <Pressable
                          title="Play"
                          aria-label="Play"
                          onClick={() => audioPlayer.play(
                            audioTracks[0] as typeof audioTracks[number] & { taskId?: string },
                            audioTracks,
                          )}
                          scaleTo={0.96}
                          className="rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] hover:text-[var(--accent)]"
                        >
                          <Play size={14} fill="currentColor" aria-hidden />
                        </Pressable>
                      )}
                      <Pressable
                        title="Delete"
                        aria-label="Delete"
                        onClick={() => onRemove(h.taskId)}
                        scaleTo={0.96}
                        className="ml-auto rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] hover:text-[var(--danger)]"
                      >
                        <X size={14} strokeWidth={2} aria-hidden />
                      </Pressable>
                    </div>
                  )}
                </div>
              )
            })}
            </div>
            ))}
          </div>
        </div>
      )}

      {sheetsRequested && (
        <Suspense fallback={null}>
          <HistorySheets
            active={active}
            showViewer={showViewer}
            compareItems={compareItems}
            showCompare={showCompare}
            retryDisabled={retryDisabled}
            onCloseViewer={onClose}
            onCloseCompare={() => setShowCompare(false)}
            onReuse={onReuse}
            onRetry={onRetry}
            onSendToInput={onSendToInput}
            items={items}
            onUpdateItem={onUpdateItem}
            onQuickAction={onQuickAction}
          />
        </Suspense>
      )}
    </section>
  )
}
