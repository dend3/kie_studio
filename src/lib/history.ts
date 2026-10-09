import type {
  HistoryItem,
  MediaAsset,
  Operation,
  Provider,
  TaskState,
} from './models/types.ts'
import { mediaKindFromUrl } from './media.ts'

/** Non-pinned budget (SQLite; was 30 under localStorage quota pressure). */
export const MAX_ITEMS = 200
/** Pin budget — UI rejects when at limit. */
export const MAX_PINNED = 30

/** Matches App polling: unknown items older than this are not refetched. */
export const UNKNOWN_STALE_MS = 10 * 60 * 1000

/** Cap for waiting/queuing/generating — stops eternal polling. */
export const PENDING_STALE_MS = 60 * 60 * 1000

/** Terminal gallery states that must not be overwritten by in-flight polls. */
export function isTerminalState(state: TaskState): boolean {
  switch (state) {
    case 'success':
    case 'fail':
    case 'partial':
    case 'expired':
      return true
    case 'waiting':
    case 'queuing':
    case 'generating':
    case 'unknown':
      return false
    default: {
      const _exhaustive: never = state
      return _exhaustive
    }
  }
}

function shouldPreferServerItem(local: HistoryItem, remote: HistoryItem): boolean {
  if (isTerminalState(remote.state) && !isTerminalState(local.state)) return true
  if (isTerminalState(local.state) && !isTerminalState(remote.state)) return false
  if (remote.state !== local.state) return true
  const remoteMedia = remote.media?.length ?? remote.resultUrls?.length ?? 0
  const localMedia = local.media?.length ?? local.resultUrls?.length ?? 0
  return remoteMedia > localMedia
}

/**
 * Fold a server history snapshot into the in-memory gallery list.
 * Unknown taskIds are added; terminal remote state wins over local pending;
 * local pin flags are kept.
 */
export function mergeServerHistory(
  local: HistoryItem[],
  server: HistoryItem[],
): HistoryItem[] {
  const byId = new Map<string, HistoryItem>()
  for (const item of local) byId.set(item.taskId, item)
  for (const remote of server) {
    const current = byId.get(remote.taskId)
    if (!current) {
      byId.set(remote.taskId, remote)
      continue
    }
    const next = shouldPreferServerItem(current, remote)
      ? { ...remote, pinned: current.pinned ?? remote.pinned }
      : current
    byId.set(remote.taskId, next)
  }
  return capItems(
    [...byId.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
  )
}

/**
 * Normalize API/local timestamps to milliseconds.
 * Values below 1e12 are treated as Unix seconds.
 */
export function normalizeTimestamp(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return value < 1e12 ? value * 1000 : value
}

/**
 * Keep up to MAX_PINNED pinned items (newest first) plus the newest
 * MAX_ITEMS non-pinned items. Excess pins are unpinned before the
 * non-pinned budget is applied. Pinned items don't consume the
 * non-pinned budget, so a just-submitted task is never evicted by pins.
 */
export function capItems(items: HistoryItem[]): HistoryItem[] {
  let pinnedBudget = MAX_PINNED
  const withPinCap = items.map((item) => {
    if (!item.pinned) return item
    if (pinnedBudget > 0) {
      pinnedBudget--
      return item
    }
    return { ...item, pinned: false }
  })

  let nonPinnedBudget = MAX_ITEMS
  return withPinCap.filter((item) => {
    if (item.pinned) return true
    if (nonPinnedBudget > 0) {
      nonPinnedBudget--
      return true
    }
    return false
  })
}

/** Merge into an in-memory list (avoids races on rapid updates). */
export function upsertInList(
  prev: HistoryItem[],
  item: HistoryItem,
): HistoryItem[] {
  return capItems([item, ...prev.filter((h) => h.taskId !== item.taskId)])
}

export function removeFromList(
  prev: HistoryItem[],
  taskId: string,
): HistoryItem[] {
  return prev.filter((h) => h.taskId !== taskId)
}

export type TogglePinResult = {
  next: HistoryItem[]
  rejected?: 'pin-limit'
}

export function togglePinInList(
  prev: HistoryItem[],
  taskId: string,
): TogglePinResult {
  const target = prev.find((h) => h.taskId === taskId)
  if (!target) return { next: prev }

  const willPin = !target.pinned
  if (willPin) {
    const pinnedCount = prev.filter((h) => h.pinned).length
    if (pinnedCount >= MAX_PINNED) {
      return { next: prev, rejected: 'pin-limit' }
    }
  }

  return {
    next: prev
      .map((h) =>
        h.taskId === taskId ? { ...h, pinned: !h.pinned } : h,
      )
      // ピン留めを先頭に（同グループ内は相対順を維持）
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))),
  }
}

export function exportHistoryJson(items: HistoryItem[]): string {
  return JSON.stringify(
    {
      app: 'kie-studio',
      version: 1,
      exportedAt: new Date().toISOString(),
      items,
    },
    null,
    2,
  )
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const urls = value.filter((u): u is string => typeof u === 'string')
  return urls.length > 0 ? urls : undefined
}

function asInput(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

const PROVIDERS = new Set<Provider>(['market', 'suno', 'veo', 'runway'])
const OPERATIONS = new Set<Operation>([
  'generate',
  'extend',
  'upload-cover',
  'upload-extend',
  'replace-section',
  'cover-art',
  'lyrics',
  'upscale-1080p',
  'upscale-4k',
  'aleph',
])

function asProvider(value: unknown): Provider | undefined {
  return typeof value === 'string' && PROVIDERS.has(value as Provider)
    ? (value as Provider)
    : undefined
}

function asOperation(value: unknown): Operation | undefined {
  return typeof value === 'string' && OPERATIONS.has(value as Operation)
    ? (value as Operation)
    : undefined
}

function asMedia(value: unknown): MediaAsset[] | undefined {
  if (!Array.isArray(value)) return undefined
  const media = value.flatMap((entry): MediaAsset[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const raw = entry as Record<string, unknown>
    if (
      raw.kind !== 'image' &&
      raw.kind !== 'video' &&
      raw.kind !== 'audio' &&
      raw.kind !== 'text'
    ) {
      return []
    }
    const asset: MediaAsset = { kind: raw.kind }
    for (const key of ['id', 'url', 'streamUrl', 'previewUrl', 'title', 'mimeType', 'providerAssetId', 'localPath'] as const) {
      const parsed = asString(raw[key])
      if (parsed !== undefined) asset[key] = parsed
    }
    for (const key of ['duration', 'expiresAt'] as const) {
      const parsed = asFiniteNumber(raw[key])
      if (parsed !== undefined) asset[key] = parsed
    }
    if (Array.isArray(raw.waveform)) {
      asset.waveform = raw.waveform.filter(
        (sample): sample is number => typeof sample === 'number' && Number.isFinite(sample),
      )
    }
    if (Array.isArray(raw.alignedWords)) {
      asset.alignedWords = raw.alignedWords.flatMap((word): NonNullable<MediaAsset['alignedWords']> => {
        if (!word || typeof word !== 'object' || Array.isArray(word)) return []
        const w = word as Record<string, unknown>
        if (typeof w.word !== 'string') return []
        const startS = asFiniteNumber(w.startS)
        const endS = asFiniteNumber(w.endS)
        if (startS === undefined || endS === undefined) return []
        return [{
          word: w.word,
          startS,
          endS,
          success: typeof w.success === 'boolean' ? w.success : undefined,
          palign: asFiniteNumber(w.palign),
        }]
      })
    }
    const metadata = asInput(raw.metadata)
    if (metadata) asset.metadata = metadata
    return [asset]
  })
  return media.length ? media : undefined
}

type NormalizeMode = 'local' | 'import'

/**
 * Validate and normalize history items.
 * - import: non-terminal → unknown + stale createdAt (avoid polling foreign tasks)
 * - local: keep recent pending; demote stale pending to unknown
 */
export function normalizeHistoryItems(
  items: unknown[],
  mode: NormalizeMode,
): HistoryItem[] {
  const now = Date.now()
  const unknownStaleAt = now - UNKNOWN_STALE_MS
  const pendingStaleAt = now - PENDING_STALE_MS

  const valid = items.flatMap((h): HistoryItem[] => {
    if (!h || typeof h !== 'object' || Array.isArray(h)) return []
    const item = h as Record<string, unknown>
    if (typeof item.taskId !== 'string' || typeof item.model !== 'string') {
      return []
    }
    if (
      item.category !== 'image' &&
      item.category !== 'video' &&
      item.category !== 'audio'
    ) return []

    const isTerminal =
      item.state === 'success' ||
      item.state === 'fail' ||
      item.state === 'partial' ||
      item.state === 'expired'
    const rawCreatedAt = asFiniteNumber(item.createdAt) ?? now
    const parsedCreatedAt = normalizeTimestamp(rawCreatedAt, now)

    let state: TaskState
    let createdAt: number

    if (isTerminal) {
      state = item.state as 'success' | 'fail' | 'partial' | 'expired'
      createdAt = parsedCreatedAt
    } else if (mode === 'import') {
      // 別環境のタスクをポーリングしない
      state = 'unknown'
      createdAt = Math.min(parsedCreatedAt, unknownStaleAt)
    } else if (
      item.state === 'waiting' ||
      item.state === 'queuing' ||
      item.state === 'generating'
    ) {
      if (parsedCreatedAt < pendingStaleAt) {
        state = 'unknown'
        createdAt = Math.min(parsedCreatedAt, unknownStaleAt)
      } else {
        state = item.state
        createdAt = parsedCreatedAt
      }
    } else {
      state = 'unknown'
      createdAt = parsedCreatedAt
    }

    const normalized: HistoryItem = {
      taskId: item.taskId,
      model: item.model,
      category: item.category,
      state,
      createdAt,
    }

    const resultUrls = asStringArray(item.resultUrls)
    if (resultUrls) normalized.resultUrls = resultUrls

    const media = asMedia(item.media)
    if (media) {
      normalized.media = media
    } else if (resultUrls) {
      normalized.media = resultUrls.map((url) => ({
        kind: mediaKindFromUrl(url, normalized.category),
        url,
      }))
    }

    const provider = asProvider(item.provider)
    normalized.provider = provider ?? 'market'
    normalized.operation = asOperation(item.operation) ?? 'generate'

    const parentTaskId = asString(item.parentTaskId)
    if (parentTaskId) normalized.parentTaskId = parentTaskId

    const providerStatus = asString(item.providerStatus)
    if (providerStatus) normalized.providerStatus = providerStatus

    if (item.partial === true) normalized.partial = true

    const expiresAt = asFiniteNumber(item.expiresAt)
    if (expiresAt !== undefined) {
      normalized.expiresAt = normalizeTimestamp(expiresAt, expiresAt)
    }

    if ('rawParam' in item) normalized.rawParam = item.rawParam
    if ('rawResult' in item) normalized.rawResult = item.rawResult

    const prompt = asString(item.prompt)
    if (prompt !== undefined) normalized.prompt = prompt

    const creditsConsumed = asFiniteNumber(item.creditsConsumed)
    if (creditsConsumed !== undefined) normalized.creditsConsumed = creditsConsumed

    const failMsg = asString(item.failMsg)
    if (failMsg !== undefined) normalized.failMsg = failMsg

    const modelId = asString(item.modelId)
    if (modelId !== undefined) normalized.modelId = modelId

    const input = asInput(item.input)
    if (input) normalized.input = input

    if (item.pinned === true) normalized.pinned = true

    return [normalized]
  })

  return capItems(valid.sort((a, b) => b.createdAt - a.createdAt))
}

/** Parse an exported JSON payload; throws with a user-facing message on bad input. */
export function parseHistoryJson(raw: string): HistoryItem[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('Could not parse as JSON')
  }
  const items = Array.isArray(data)
    ? data
    : (data as { items?: unknown })?.items
  if (!Array.isArray(items)) {
    throw new Error('Invalid history data format')
  }
  const valid = normalizeHistoryItems(items, 'import')
  if (valid.length === 0) {
    throw new Error('No importable history items found')
  }
  return valid
}

/** Merge imported items into current list (existing taskIds win), newest first. */
export function mergeHistory(
  current: HistoryItem[],
  imported: HistoryItem[],
): HistoryItem[] {
  const known = new Set(current.map((h) => h.taskId))
  const added = imported.filter((h) => !known.has(h.taskId))
  return capItems(
    [...current, ...added].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
  )
}
