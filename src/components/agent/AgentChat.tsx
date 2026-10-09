import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import {
  AlertTriangle,
  Brain,
  ChevronRight,
  Loader2,
  SendHorizontal,
  Square,
  Wrench,
} from 'lucide-react'
import { agentChatUrl, fetchAgentMessages } from '../../lib/agentApi.ts'
import { AGENT_UNAVAILABLE_MESSAGE, formatAgentSendError } from '../../lib/agentUnavailable.ts'
import { AgentMediaTaskCard } from './AgentMediaTaskCard.tsx'
import { readMediaTaskData, type MediaTaskData } from './mediaTaskData.ts'

type ToolLikePart = {
  type: string
  toolName?: string
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
}

function isToolPart(part: { type: string }): part is ToolLikePart {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-')
}

function toolNameOf(part: ToolLikePart): string {
  if (typeof part.toolName === 'string' && part.toolName) return part.toolName
  if (part.type.startsWith('tool-')) return part.type.slice('tool-'.length)
  return part.type
}

function toolSummary(part: ToolLikePart): string {
  const name = toolNameOf(part)
  const input = part.input
  const field = (key: string): string | undefined => {
    if (input && typeof input === 'object' && key in input) {
      const v = (input as Record<string, unknown>)[key]
      if (typeof v === 'string') return v
      if (typeof v === 'number') return String(v)
    }
    return undefined
  }
  switch (name) {
    case 'list-workflows':
      return `Workflow search ${field('capability') ?? field('q') ?? field('category') ?? ''}`.trim()
    case 'get-workflow-schema':
      return `Schema check ${field('id') ?? ''}`.trim()
    case 'generate-media':
      return `Generation ${field('title') ?? field('workflowId') ?? ''}`.trim()
    case 'get-task-status':
      return `Status check ${(field('taskId') ?? '').slice(0, 12)}…`
    case 'search-history':
      return `History search ${field('q') ?? ''}`.trim()
    case 'get-task-input':
      return 'Restore input'
    case 'get-credit-balance':
      return 'Check balance'
    case 'optimize-prompt':
      return 'Prompt optimization'
    default:
      return name
  }
}

function ToolCard({ part }: { part: ToolLikePart }) {
  const [open, setOpen] = useState(false)
  const running = part.state === 'input-available' || part.state === 'input-streaming'
  const errored = part.state === 'output-error'
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--text-muted)]"
      >
        {running ? (
          <Loader2 size={13} className="animate-spin text-[var(--accent)]" aria-hidden />
        ) : (
          <Wrench size={13} aria-hidden />
        )}
        <span className="flex-1 truncate font-mono">{toolSummary(part)}</span>
        {errored && <span className="text-[var(--danger)]">error</span>}
        {part.state === 'output-available' && (
          <ChevronRight
            size={13}
            aria-hidden
            className={open ? 'rotate-90 transition-transform' : 'transition-transform'}
          />
        )}
      </button>
      {open && part.state === 'output-available' && (
        <pre className="max-h-56 overflow-auto border-t border-[var(--border)] px-3 py-2 whitespace-pre-wrap break-words text-[var(--text-muted)]">
          {JSON.stringify(part.output, null, 2)}
        </pre>
      )}
      {errored && (
        <p className="border-t border-[var(--border)] px-3 py-2 text-[var(--danger)]">
          {part.errorText}
        </p>
      )}
    </div>
  )
}

function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming)
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-muted)]"
      >
        <Brain size={13} aria-hidden />
        <span>{streaming ? 'Thinking…' : 'Thinking'}</span>
        <ChevronRight
          size={13}
          aria-hidden
          className={open ? 'rotate-90 transition-transform' : 'transition-transform'}
        />
      </button>
      {open && (
        <p className="border-t border-[var(--border)] px-3 py-2 whitespace-pre-wrap text-[var(--text-muted)]">
          {text}
        </p>
      )}
    </div>
  )
}

type StudioChatMessage = UIMessage<unknown, { 'media-task': MediaTaskData }>
type ChatPart = StudioChatMessage['parts'][number]

function MessagePart({ part }: { part: ChatPart }) {
  if (part.type === 'text') {
    return <p className="whitespace-pre-wrap break-words">{part.text}</p>
  }
  if (part.type === 'reasoning') {
    return <ReasoningBlock text={part.text} streaming={part.state === 'streaming'} />
  }
  if (part.type === 'file' && part.url && part.mediaType.startsWith('image/')) {
    return (
      <img
        src={part.url}
        alt={part.filename ?? 'Attach'}
        className="max-h-48 rounded-[var(--radius-md)]"
      />
    )
  }
  if (part.type === 'file') {
    return <span className="text-xs text-[var(--text-muted)]">{part.filename ?? part.mediaType}</span>
  }
  if (isToolPart(part)) {
    return <ToolCard part={part} />
  }
  if (part.type === 'data-media-task') {
    const data = readMediaTaskData(part.data)
    if (data) return <AgentMediaTaskCard data={data} />
  }
  return null
}

function MessageBubble({ message }: { message: StudioChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isUser
            ? 'max-w-[85%] rounded-[var(--radius-lg)] rounded-br-md bg-[var(--accent)] px-4 py-2.5 text-sm text-[var(--on-accent)]'
            : 'grid w-full max-w-full gap-2 px-1 text-sm text-[var(--text)]'
        }
      >
        {message.parts.map((part, i) => (
          <MessagePart key={i} part={part} />
        ))}
      </div>
    </div>
  )
}

export interface AgentChatProps {
  conversationId: string
  provider: string
  model: string
  /** True while the conversation is a local draft: nothing persisted. */
  isDraft: boolean
  /** Called once the draft's first message was accepted, so the caller can persist it. */
  onFirstSent?: (text: string) => void
}

function asUiMessages(value: unknown): StudioChatMessage[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is StudioChatMessage => {
    if (!item || typeof item !== 'object') return false
    const message = item as { id?: unknown; role?: unknown; parts?: unknown }
    return typeof message.id === 'string' && typeof message.role === 'string' && Array.isArray(message.parts)
  })
}

function AgentChatSession({
  conversationId,
  provider,
  model,
  isDraft,
  onFirstSent,
  initialMessages,
}: AgentChatProps & { initialMessages: StudioChatMessage[] }) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const freshRef = useRef(isDraft)
  const seenTaskIdsRef = useRef(new Set<string>())
  const scrollRef = useRef<HTMLDivElement>(null)
  const snapshotRef = useRef<StudioChatMessage[]>(initialMessages)

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: agentChatUrl(),
        body: { conversationId, provider, model },
      }),
    [conversationId, provider, model],
  )

  const { messages, sendMessage, status, stop, error, setMessages } = useChat<StudioChatMessage>({
    id: conversationId,
    messages: initialMessages,
    transport,
  })

  snapshotRef.current = messages

  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (!isToolPart(part) || part.state !== 'output-available') continue
        if (toolNameOf(part) !== 'generate-media') continue
        const output = part.output as { taskId?: unknown } | undefined
        const taskId = output && typeof output.taskId === 'string' ? output.taskId : null
        if (taskId && !seenTaskIdsRef.current.has(taskId)) {
          seenTaskIdsRef.current.add(taskId)
          void queryClient.invalidateQueries({ queryKey: ['history'] })
        }
      }
    }
  }, [messages, queryClient])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const responding = status === 'submitted' || status === 'streaming'
  const migratedEmpty = !isDraft && initialMessages.length === 0 && messages.length === 0

  async function submit() {
    const text = input.trim()
    if (!text || responding) return
    const previous = snapshotRef.current
    setInput('')
    setSendError(null)
    try {
      await sendMessage({ text })
      if (freshRef.current) {
        freshRef.current = false
        onFirstSent?.(text)
      }
    } catch (err) {
      freshRef.current = isDraft
      setMessages(previous)
      setInput(text)
      setSendError(formatAgentSendError(err))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto grid max-w-3xl gap-4">
          {messages.length === 0 && (
            <div className="py-16 text-center">
              <p className="studio-empty-title">Talk to your agent</p>
              <p className="studio-empty-body mt-2">
                {migratedEmpty
                  ? 'This conversation\u2019s messages were stored in the old agent. New messages will be recorded here.'
                  : 'e.g. \u201cMake an image of a beach at sunset\u201d / \u201cTurn this photo into a video\u201d / \u201cContinue this song\u201d'}
              </p>
            </div>
          )}
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {responding && (
            <p className="flex items-center gap-2 px-1 text-xs text-[var(--text-muted)]">
              <Loader2 size={13} className="animate-spin" aria-hidden />
              {status === 'streaming' ? 'Generating response…' : 'Sending…'}
            </p>
          )}
          {status === 'error' && (
            <p className="flex items-center gap-2 px-1 text-xs text-[var(--danger)]" role="alert">
              <AlertTriangle size={13} aria-hidden />
              {error ? formatAgentSendError(error) : AGENT_UNAVAILABLE_MESSAGE}
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
        <div className="mx-auto max-w-3xl">
          {sendError && (
            <p className="mb-2 text-xs text-[var(--danger)]" role="alert">
              Send failed: {sendError}
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void submit()
                }
              }}
              rows={Math.min(6, Math.max(2, input.split('\n').length))}
              placeholder="Type a message… (Enter to send / Shift+Enter for newline)"
              className="studio-input min-w-0 flex-1 resize-none"
              aria-label="Message to agent"
            />
            {responding ? (
              <button
                type="button"
                onClick={() => void stop()}
                className="studio-btn w-auto shrink-0 px-3 py-2"
                aria-label="Stop response"
              >
                <Square size={16} aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!input.trim()}
                className="studio-btn-primary studio-btn-compact"
                aria-label="Send"
              >
                <SendHorizontal size={16} aria-hidden />
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
            {provider}/{model} · Generation consumes kie.ai credits
          </p>
        </div>
      </div>
    </div>
  )
}

export function AgentChat(props: AgentChatProps) {
  const messagesQuery = useQuery({
    queryKey: ['agent-messages', props.conversationId],
    queryFn: () => fetchAgentMessages(props.conversationId),
    enabled: !props.isDraft,
  })

  if (!props.isDraft && messagesQuery.isLoading) {
    return (
      <div className="grid flex-1 place-items-center text-xs text-[var(--text-muted)]">
        <p className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          Loading conversation…
        </p>
      </div>
    )
  }

  if (!props.isDraft && messagesQuery.isError) {
    return (
      <div className="grid flex-1 place-items-center px-4 text-xs text-[var(--danger)]">
        <div className="grid gap-3 text-center">
          <p className="flex items-center justify-center gap-2" role="alert">
            <AlertTriangle size={14} aria-hidden />
            Could not load conversation: {formatAgentSendError(messagesQuery.error)}
          </p>
          <button
            type="button"
            className="studio-btn mx-auto w-auto px-3 py-1.5"
            onClick={() => void messagesQuery.refetch()}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <AgentChatSession
      {...props}
      initialMessages={props.isDraft ? [] : asUiMessages(messagesQuery.data)}
    />
  )
}
