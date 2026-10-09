import { Check, ChevronDown, Clock3, Search, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelDefinition, Provider } from '../lib/models/types.ts'
import { modelInputSummary } from '../lib/studioPresentation.ts'
import { usePersistedState } from '../lib/usePersistedState.ts'
import { Pressable } from './motion/Pressable.tsx'

const FAVORITES_KEY = 'kie-studio-model-favorites:v1'
const RECENTS_KEY = 'kie-studio-model-recents:v1'
const LEGACY_FAVORITES_KEY = 'kie-studio-model-favorites'
const LEGACY_RECENTS_KEY = 'kie-studio-model-recents'

function validateIds(parsed: unknown): string[] | undefined {
  return Array.isArray(parsed)
    ? parsed.filter((value): value is string => typeof value === 'string')
    : undefined
}

export function ModelSelect({
  models,
  value,
  onChange,
  disabled,
}: {
  models: ModelDefinition[]
  value: string | null
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<'all' | Provider>('all')
  const [useCase, setUseCase] = useState('all')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [favorites, setFavorites] = usePersistedState<string[]>(FAVORITES_KEY, [], {
    legacyKey: LEGACY_FAVORITES_KEY,
    validate: validateIds,
  })
  const [recents, setRecents] = usePersistedState<string[]>(RECENTS_KEY, [], {
    legacyKey: LEGACY_RECENTS_KEY,
    validate: validateIds,
  })
  const detailsRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!detailsRef.current?.open) return
      if (event.target instanceof Node && detailsRef.current.contains(event.target)) return
      detailsRef.current.open = false
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress)
  }, [])

  const providers = useMemo(
    () => [...new Set(models.map((model) => model.provider))],
    [models],
  )
  const useCases = useMemo(
    () => [...new Set(models.flatMap((model) => model.useCase ? [model.useCase] : []))],
    [models],
  )
  const favoriteIds = useMemo(() => new Set(favorites), [favorites])
  const recentPositions = useMemo(
    () => new Map(recents.map((id, index) => [id, index])),
    [recents],
  )
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return models
      .filter((model) => provider === 'all' || model.provider === provider)
      .filter((model) => useCase === 'all' || model.useCase === useCase)
      .filter((model) => !favoritesOnly || favoriteIds.has(model.id))
      .filter((model) => {
        if (!needle) return true
        return [model.title, model.model, model.provider, model.useCase, ...(model.tags ?? [])]
          .filter(Boolean)
          .some((part) => String(part).toLowerCase().includes(needle))
      })
      .toSorted((a, b) => {
        const favorite = Number(favoriteIds.has(b.id)) - Number(favoriteIds.has(a.id))
        if (favorite !== 0) return favorite
        const aRecent = recentPositions.get(a.id) ?? -1
        const bRecent = recentPositions.get(b.id) ?? -1
        if (aRecent >= 0 || bRecent >= 0) {
          if (aRecent < 0) return 1
          if (bRecent < 0) return -1
          return aRecent - bRecent
        }
        return a.title.localeCompare(b.title, 'ja')
      })
  }, [favoriteIds, favoritesOnly, models, provider, query, recentPositions, useCase])

  const selected = models.find((model) => model.id === value)
  const selectedIsFavorite = selected ? favoriteIds.has(selected.id) : false
  const options = selected && !visible.some((model) => model.id === selected.id)
    ? [selected, ...visible]
    : visible

  function toggleFavorite(id: string) {
    setFavorites((previous) => previous.includes(id)
      ? previous.filter((entry) => entry !== id)
      : [id, ...previous])
  }

  function selectModel(id: string) {
    setRecents((previous) => [id, ...previous.filter((entry) => entry !== id)].slice(0, 8))
    onChange(id)
    if (detailsRef.current) {
      detailsRef.current.open = false
      requestAnimationFrame(() => detailsRef.current?.querySelector('summary')?.focus())
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="studio-label">What you want / model</span>
        <span className="text-[11px] text-[var(--text-muted)]">
          {models.length} models
        </span>
      </div>

      {useCases.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by use case">
          {['all', ...useCases].map((entry) => (
            <button
              key={entry}
              type="button"
              className={`studio-chip ${useCase === entry ? 'is-active' : ''}`}
              onClick={() => setUseCase(entry)}
              disabled={disabled}
            >
              {entry === 'all' ? 'All' : entry}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <details
          ref={detailsRef}
          className="model-picker relative min-w-0"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && detailsRef.current) {
              detailsRef.current.open = false
              detailsRef.current.querySelector('summary')?.focus()
              return
            }
            if (
              event.key === 'ArrowDown' ||
              event.key === 'ArrowUp' ||
              event.key === 'Home' ||
              event.key === 'End'
            ) {
              const options = Array.from(
                detailsRef.current?.querySelectorAll<HTMLElement>('[data-model-option]') ?? [],
              )
              if (options.length === 0) return
              event.preventDefault()
              const current = options.indexOf(document.activeElement as HTMLElement)
              const next = event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : event.key === 'ArrowUp'
                    ? current <= 0 ? options.length - 1 : current - 1
                    : current < 0 || current === options.length - 1 ? 0 : current + 1
              options[next]?.focus()
            }
          }}
        >
          <summary
            id="model-select"
            role="button"
            aria-haspopup="true"
            aria-disabled={disabled || undefined}
            className="studio-input flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-2.5 [&::-webkit-details-marker]:hidden"
            aria-label="Select model"
            onClick={(event) => {
              if (disabled) event.preventDefault()
            }}
          >
            {selected ? (
              <span className="min-w-0 text-left">
                <span className="block truncate text-sm font-semibold text-[var(--text)]">
                  {selected.title}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">
                  {selected.useCase ?? selected.category} · {modelInputSummary(selected)} · {selected.provider}
                </span>
              </span>
            ) : (
              <span className="text-sm text-[var(--text-muted)]">Select model</span>
            )}
            <ChevronDown size={16} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
          </summary>

          <div
            className="absolute left-0 z-[var(--z-dropdown)] mt-1 w-[min(32rem,calc(100vw-3rem))] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-[var(--shadow-context)]"
          >
            <div className="space-y-2 border-b border-[var(--border)] p-3">
              <label className="relative block">
                <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
                <span className="sr-only">Search models</span>
                <input
                  className="studio-input w-full py-2 pl-9"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name, use case, provider"
                  disabled={disabled}
                />
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className={`studio-chip ${favoritesOnly ? 'is-active' : ''}`}
                  onClick={() => setFavoritesOnly((current) => !current)}
                  disabled={disabled}
                >
                  <Star size={12} fill={favoritesOnly ? 'currentColor' : 'none'} aria-hidden />
                  Favorites
                </button>
                {providers.length > 1 && ['all', ...providers].map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    className={`studio-chip ${provider === entry ? 'is-active' : ''}`}
                    onClick={() => setProvider(entry as 'all' | Provider)}
                    disabled={disabled}
                  >
                    {entry === 'all' ? 'All providers' : entry}
                  </button>
                ))}
              </div>
            </div>

            <ul className="max-h-[min(55vh,28rem)] overflow-y-auto p-1.5" aria-label="Models">
              {options.length === 0 && (
                <li className="px-3 py-8 text-center text-xs text-[var(--text-muted)]">
                  No matching models
                </li>
              )}
              {options.map((model) => {
                const recent = recentPositions.has(model.id)
                const favorite = favoriteIds.has(model.id)
                const active = model.id === value
                return (
                  <li
                    key={model.id}
                    className={`grid grid-cols-[minmax(0,1fr)_2.5rem] items-stretch rounded-[var(--radius-md)] ${active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--bg)]'}`}
                  >
                    <button
                      type="button"
                      data-model-option
                      aria-current={active ? 'true' : undefined}
                      className="min-w-0 px-3 py-2.5 text-left"
                      onClick={() => selectModel(model.id)}
                      disabled={disabled}
                    >
                      <span className="flex items-center gap-1.5">
                        {active && <Check size={13} className="shrink-0 text-[var(--accent)]" aria-hidden />}
                        <span className="truncate text-xs font-semibold text-[var(--text)]">{model.title}</span>
                        {recent && <Clock3 size={11} className="shrink-0 text-[var(--text-muted)]" aria-label="Recently used" />}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-[var(--text-muted)]">
                        <span>{model.useCase ?? model.category}</span>
                        <span>{modelInputSummary(model)}</span>
                        <span>{model.provider}</span>
                        <span className="font-mono">{model.model}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`grid place-items-center rounded-[var(--radius-md)] ${favorite ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}
                      onClick={() => toggleFavorite(model.id)}
                      aria-label={favorite ? `Remove ${model.title} from favorites` : `Add ${model.title} to favorites`}
                      aria-pressed={favorite}
                      disabled={disabled}
                    >
                      <Star size={15} fill={favorite ? 'currentColor' : 'none'} aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </details>

        {selected && (
          <Pressable
            type="button"
            className={`model-favorite-button size-12 px-0 ${selectedIsFavorite ? 'is-active' : ''}`}
            onClick={() => toggleFavorite(selected.id)}
            aria-label={selectedIsFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={selectedIsFavorite}
            disabled={disabled}
          >
            <Star size={16} fill={selectedIsFavorite ? 'currentColor' : 'none'} aria-hidden />
          </Pressable>
        )}
      </div>
    </div>
  )
}
