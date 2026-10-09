import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { isVideoUrl } from '../../lib/media.ts'
import { localMediaUrl } from '../../lib/api.ts'
import type { MediaTaskData } from './mediaTaskData.ts'

function looksAudio(url: string): boolean {
  return /\.(?:mp3|wav|m4a|aac|ogg|flac|opus)(?:$|\?)/i.test(url)
}

function MediaView({ url, kind }: { url: string; kind: string }) {
  if (kind === 'video' || isVideoUrl(url)) {
    return (
      <video
        src={url}
        controls
        className="max-h-72 w-full rounded-[var(--radius-md)] bg-black"
      />
    )
  }
  if (kind === 'audio' || looksAudio(url)) {
    return <audio src={url} controls className="w-full" />
  }
  return (
    <img
      src={url}
      alt="Result"
      referrerPolicy="no-referrer"
      className="max-h-72 w-full rounded-[var(--radius-md)] object-contain bg-black/20"
    />
  )
}

export function AgentMediaTaskCard({ data }: { data: MediaTaskData }) {
  if (data.status === 'failed') {
    return (
      <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--surface)] p-3 text-sm">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--danger)]" aria-hidden />
        <div>
          <p className="font-medium text-[var(--danger)]">Generation failed</p>
          <p className="mt-1 text-[var(--text-muted)]">{data.error ?? 'Unknown error'}</p>
        </div>
      </div>
    )
  }

  if (data.status === 'submitted') {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--text-muted)]">
        <Loader2 size={16} className="animate-spin text-[var(--accent)]" aria-hidden />
        <div>
          <p className="font-medium text-[var(--text)]">
            {data.title ?? 'Generation'} started
          </p>
          <p className="mt-0.5 text-xs">Progress also appears in the history gallery</p>
        </div>
      </div>
    )
  }

  const mediaItems =
    data.media?.length
      ? data.media.map((m) => ({
          url: m.localPath ? localMediaUrl(m.localPath) : (m.url ?? ''),
          kind: m.kind,
        }))
      : (data.resultUrls ?? []).map((url) => ({ url, kind: '' }))

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-[var(--success)]">
        <CheckCircle2 size={16} aria-hidden />
        {data.title ?? 'Generation'} completed
      </p>
      <div className="grid gap-2">
        {mediaItems
          .filter((m) => m.url)
          .map((m, i) => (
            <MediaView key={`${m.url}-${i}`} url={m.url} kind={m.kind} />
          ))}
      </div>
      {mediaItems.length === 0 && (data.resultUrls?.length ?? 0) > 0 && (
        <div className="grid gap-1">
          {data.resultUrls!.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[var(--accent)] underline break-all"
            >
              {url}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}