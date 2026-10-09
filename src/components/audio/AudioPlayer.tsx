import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { Pressable } from '../motion/Pressable.tsx'
import { apiUrl } from '../../lib/api.ts'
import {
  AudioPlayerContext,
  type AudioPlayerValue,
  type AudioTrack,
} from './audioPlayerContext.ts'

function sourceOf(track: AudioTrack): string | undefined {
  if (track.localPath) return apiUrl(`/${track.localPath}`)
  return track.streamUrl ?? track.url
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const minutes = Math.floor(value / 60)
  const seconds = Math.floor(value % 60)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function setMediaSessionAction(
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): void {
  try {
    navigator.mediaSession.setActionHandler(action, handler)
  } catch {
    // Some browsers expose Media Session but not every action.
  }
}

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [active, setActive] = useState<AudioTrack | null>(null)
  const [tracks, setTracks] = useState<AudioTrack[]>([])
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)

  const play = useCallback((track: AudioTrack, group: AudioTrack[] = [track]) => {
    const audio = audioRef.current
    const source = sourceOf(track)
    if (!audio || !source) return
    const currentSource = active ? sourceOf(active) : undefined
    setTracks(group.filter((item) => Boolean(sourceOf(item))))
    setActive(track)
    if (currentSource !== source) {
      audio.src = source
      audio.currentTime = 0
      setCurrentTime(0)
    }
    void audio.play().catch(() => setPlaying(false))
  }, [active])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !active) return
    if (audio.paused) void audio.play().catch(() => setPlaying(false))
    else audio.pause()
  }, [active])

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds))
    setCurrentTime(audio.currentTime)
  }, [])

  const move = useCallback((direction: -1 | 1) => {
    if (!active || tracks.length < 2) return
    const current = tracks.findIndex((track) => sourceOf(track) === sourceOf(active))
    const next = tracks[(current + direction + tracks.length) % tracks.length]
    if (next) play(next, tracks)
  }, [active, play, tracks])

  useEffect(() => {
    if (!('mediaSession' in navigator) || !active) return
    if ('MediaMetadata' in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: active.title ?? 'KIE STUDIO Audio',
        artist: 'KIE STUDIO',
        artwork: active.previewUrl ? [{ src: active.previewUrl }] : [],
      })
    }
    setMediaSessionAction('play', toggle)
    setMediaSessionAction('pause', toggle)
    setMediaSessionAction('seekto', (details) => {
      if (typeof details.seekTime === 'number') seek(details.seekTime)
    })
    setMediaSessionAction('previoustrack', () => move(-1))
    setMediaSessionAction('nexttrack', () => move(1))
    return () => {
      navigator.mediaSession.metadata = null
      for (const action of ['play', 'pause', 'seekto', 'previoustrack', 'nexttrack'] as MediaSessionAction[]) {
        setMediaSessionAction(action, null)
      }
    }
  }, [active, move, seek, toggle])

  const value = useMemo<AudioPlayerValue>(() => ({
    active,
    currentTime,
    duration,
    playing,
    play,
    toggle,
    seek,
  }), [active, currentTime, duration, play, playing, seek, toggle])

  return (
    <AudioPlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        muted={muted}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onEnded={() => move(1)}
      />
      {active && (
        <aside className="fixed right-3 bottom-3 left-3 z-[var(--z-modal)] mx-auto max-w-3xl rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-3 shadow-[var(--shadow-lg)]" aria-label="Audio player">
          <div className="flex items-center gap-3">
            {active.previewUrl ? (
              <img src={active.previewUrl} alt="" className="size-11 rounded-[var(--radius-sm)] object-cover" />
            ) : (
              <div className="grid size-11 place-items-center rounded-[var(--radius-sm)] bg-[var(--surface)] text-xs font-bold">AUDIO</div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{active.title ?? 'Generated audio'}</p>
                <Pressable className="studio-btn grid size-8 place-items-center p-0" aria-label="Close player" onClick={() => {
                  audioRef.current?.pause()
                  setActive(null)
                }}>
                  <X size={14} />
                </Pressable>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="w-9 text-right font-mono text-[10px] text-[var(--text-muted)]">{formatTime(currentTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={duration || active.duration || 0}
                  step={0.01}
                  value={Math.min(currentTime, duration || active.duration || 0)}
                  onChange={(event) => seek(Number(event.target.value))}
                  className="min-w-0 flex-1 accent-[var(--accent)]"
                  aria-label="Playback position"
                />
                <span className="w-9 font-mono text-[10px] text-[var(--text-muted)]">{formatTime(duration || active.duration || 0)}</span>
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-center gap-2">
            <Pressable className="studio-btn grid size-9 place-items-center p-0" onClick={() => move(-1)} disabled={tracks.length < 2} aria-label="Previous track"><SkipBack size={16} /></Pressable>
            <Pressable className="studio-btn-primary grid size-10 place-items-center p-0" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18} /> : <Play size={18} />}</Pressable>
            <Pressable className="studio-btn grid size-9 place-items-center p-0" onClick={() => move(1)} disabled={tracks.length < 2} aria-label="Next track"><SkipForward size={16} /></Pressable>
            <Pressable className="studio-btn grid size-9 place-items-center p-0" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</Pressable>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(event) => {
                const next = Number(event.target.value)
                setVolume(next)
                if (audioRef.current) audioRef.current.volume = next
              }}
              className="w-20 accent-[var(--accent)]"
              aria-label="Volume"
            />
          </div>
        </aside>
      )}
    </AudioPlayerContext.Provider>
  )
}
