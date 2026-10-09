import type {
  Operation,
  Provider,
  SubmissionQueueItem,
} from './models/types.ts'

type QueueJob<T> = {
  item: SubmissionQueueItem
  run: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

export class QueueCancelledError extends Error {
  constructor() {
    super('Request cancelled before sending')
    this.name = 'QueueCancelledError'
  }
}

export type ApiErrorAction =
  | 'retry'
  | 'purchase'
  | 'fix-input'
  | 'refunded'
  | 'failed'

const INSUFFICIENT_CREDITS_PATTERN =
  /(?:insufficient|not enough|low)\s+(?:credit|balance)|(?:credit|balance).*?(?:insufficient|not enough|low)|クレジット.*(?:不足|足りない|切れ)|(?:不足|足りない).*(?:クレジット|credit)/i

export function classifyApiError(error: unknown): ApiErrorAction {
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown }
  const code = typeof candidate.code === 'number'
    ? candidate.code
    : typeof candidate.status === 'number'
      ? candidate.status
      : undefined
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  if (code === 429) return 'retry'
  if (code === 402 || INSUFFICIENT_CREDITS_PATTERN.test(message)) return 'purchase'
  if (code === 531) return 'refunded'
  if (code === 400 || code === 413 || /copyright|existing work/i.test(message)) {
    return 'fix-input'
  }
  return 'failed'
}

export class SubmissionQueue {
  private jobs: QueueJob<unknown>[] = []
  private visibleItems: SubmissionQueueItem[] = []
  private sentAt: number[] = []
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private readonly limit: number
  private readonly windowMs: number
  private readonly maxRateLimitRetries: number

  constructor(
    limit = 20,
    windowMs = 10_000,
    maxRateLimitRetries = 3,
  ) {
    this.limit = limit
    this.windowMs = windowMs
    this.maxRateLimitRetries = maxRateLimitRetries
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): SubmissionQueueItem[] => this.visibleItems

  enqueue<T>(params: {
    provider: Provider
    operation: Operation
    model: string
    run: () => Promise<T>
  }): Promise<T> {
    const item: SubmissionQueueItem = {
      id: crypto.randomUUID(),
      state: 'unsent',
      provider: params.provider,
      operation: params.operation,
      model: params.model,
      retryCount: 0,
      sendAfter: Date.now(),
      createdAt: Date.now(),
    }
    const promise = new Promise<T>((resolve, reject) => {
      this.jobs.push({ item, run: params.run, resolve, reject } as QueueJob<unknown>)
    })
    this.visibleItems = [...this.visibleItems, item]
    this.emit()
    this.schedule(0)
    return promise
  }

  cancelUnsent(id?: string): number {
    const cancelled = this.jobs.filter(
      (job) => job.item.state === 'unsent' && (!id || job.item.id === id),
    )
    if (cancelled.length === 0) return 0
    const ids = new Set(cancelled.map((job) => job.item.id))
    this.jobs = this.jobs.filter((job) => !ids.has(job.item.id))
    this.visibleItems = this.visibleItems.filter((item) => !ids.has(item.id))
    for (const job of cancelled) job.reject(new QueueCancelledError())
    this.emit()
    return cancelled.length
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.pump()
    }, Math.max(0, delay))
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.jobs.length > 0) {
        const now = Date.now()
        this.sentAt = this.sentAt.filter((sent) => now - sent < this.windowMs)
        if (this.sentAt.length >= this.limit) {
          const wait = this.windowMs - (now - this.sentAt[0]) + 10
          this.schedule(wait)
          return
        }
        const index = this.jobs.findIndex((job) => job.item.sendAfter <= now)
        if (index < 0) {
          const nextAt = Math.min(...this.jobs.map((job) => job.item.sendAfter))
          this.schedule(nextAt - now)
          return
        }
        const [job] = this.jobs.splice(index, 1)
        if (!job) continue
        this.sentAt.push(now)
        try {
          const value = await job.run()
          this.updateVisible(job.item.id, { state: 'accepted' })
          job.resolve(value)
          this.removeVisibleSoon(job.item.id)
        } catch (error) {
          if (
            classifyApiError(error) === 'retry' &&
            job.item.retryCount < this.maxRateLimitRetries
          ) {
            const retryCount = job.item.retryCount + 1
            job.item = {
              ...job.item,
              state: 'unsent',
              retryCount,
              sendAfter: Date.now() + Math.min(10_000, 1_000 * 2 ** retryCount),
            }
            this.jobs.push(job)
            this.replaceVisible(job.item)
            continue
          }
          this.updateVisible(job.item.id, { state: 'failed' })
          job.reject(error)
          this.removeVisibleSoon(job.item.id)
        }
      }
    } finally {
      this.running = false
      if (this.jobs.length > 0 && !this.timer) this.schedule(0)
    }
  }

  private updateVisible(
    id: string,
    patch: Partial<SubmissionQueueItem>,
  ): void {
    this.visibleItems = this.visibleItems.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    )
    this.emit()
  }

  private replaceVisible(next: SubmissionQueueItem): void {
    this.visibleItems = this.visibleItems.map((item) =>
      item.id === next.id ? next : item,
    )
    this.emit()
  }

  private removeVisibleSoon(id: string): void {
    setTimeout(() => {
      this.visibleItems = this.visibleItems.filter((item) => item.id !== id)
      this.emit()
    }, 1_500)
  }
}
