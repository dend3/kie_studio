import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bot, MessageSquarePlus, PanelLeft, Settings, Trash2 } from 'lucide-react'
import {
  createAgentConversation,
  deleteAgentConversation,
  fetchAgentConversations,
  fetchAgentHealth,
  newConversationId,
  type AgentConversation,
} from '../../lib/agentApi.ts'
import { AGENT_UNAVAILABLE_DEV_HINT, AGENT_UNAVAILABLE_MESSAGE } from '../../lib/agentUnavailable.ts'
import { AgentChat } from './AgentChat.tsx'
import { AgentModelPicker, type ModelSelection } from './AgentModelPicker.tsx'

function NewConversationPanel({
  onStart,
  onCancel,
  onOpenSettings,
}: {
  onStart: (selection: ModelSelection) => void
  onCancel: () => void
  onOpenSettings?: () => void
}) {
  const [selection, setSelection] = useState<ModelSelection | null>(null)

  const canStart = Boolean(selection?.provider && selection.model.trim())

  return (
    <div className="mx-auto grid max-w-lg gap-4 px-4 py-8">
      <div>
        <h2 className="studio-empty-title">New agent conversation</h2>
        <p className="studio-empty-body mt-1">
          Choose an LLM for each conversation. You can register API keys and models in Settings.
        </p>
      </div>
      <AgentModelPicker
        value={selection}
        onChange={setSelection}
        onOpenSettings={onOpenSettings}
      />
      <div className="flex gap-2">
        <button
          type="button"
          className="studio-btn-primary flex-1 py-2"
          disabled={!canStart}
          onClick={() => {
            if (!selection?.model.trim()) return
            onStart({ provider: selection.provider, model: selection.model.trim() })
          }}
        >
          Start conversation
        </button>
        <button type="button" className="studio-btn w-auto px-4 py-2" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function AgentView({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const queryClient = useQueryClient()
  const conversationsQuery = useQuery({
    queryKey: ['agent-conversations'],
    queryFn: fetchAgentConversations,
  })
  const agentHealthQuery = useQuery({
    queryKey: ['agent-health'],
    queryFn: fetchAgentHealth,
    retry: false,
    refetchInterval: 10_000,
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isNewFlow, setIsNewFlow] = useState(false)
  // Local-only conversation draft: created by "会話を開始", persisted on first send.
  const [draft, setDraft] = useState<AgentConversation | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data])
  const selected = conversations.find((c) => c.id === selectedId) ?? null
  const active = selected ?? draft
  // Mirror of the live draft id for async callbacks: after the user navigates
  // away mid-persist, a late resolution must not yank the selection back.
  const draftIdRef = useRef<string | null>(null)
  draftIdRef.current = draft?.id ?? null

  // Select the most recent conversation on first load. Skipped while a draft
  // is open — auto-selecting would unmount it and resurrect the old chat.
  useEffect(() => {
    if (selectedId || isNewFlow || draft || conversations.length === 0) return
    setSelectedId(conversations[0]!.id)
  }, [conversations, selectedId, isNewFlow, draft])

  const startNewFlow = useCallback(() => {
    setIsNewFlow(true)
    setSelectedId(null)
    setDraft(null)
    setSidebarOpen(false)
  }, [])

  const handleStartDraft = useCallback((selection: ModelSelection) => {
    const now = Date.now()
    setDraft({
      id: newConversationId(),
      title: 'New conversation',
      provider: selection.provider,
      model: selection.model,
      createdAt: now,
      updatedAt: now,
    })
    setIsNewFlow(false)
    setSelectedId(null)
  }, [])

  const handleFirstSent = useCallback(
    (text: string) => {
      if (!draft) return
      const title = text.length > 32 ? `${text.slice(0, 32)}…` : text
      const { id, provider, model } = draft
      void createAgentConversation({ id, title, provider, model })
        .then(() => {
          if (draftIdRef.current === id) setSelectedId(id)
          return queryClient.invalidateQueries({ queryKey: ['agent-conversations'] })
        })
        .catch(() => {})
    },
    [draft, queryClient],
  )

  const handleDelete = useCallback(
    (conversation: AgentConversation) => {
      if (!window.confirm(`Delete conversation \u201c${conversation.title}\u201d?`)) return
      if (draft?.id === conversation.id) setDraft(null)
      if (selectedId === conversation.id) setSelectedId(null)
      void deleteAgentConversation(conversation.id)
        .then(() => queryClient.invalidateQueries({ queryKey: ['agent-conversations'] }))
        .catch(() => {})
    },
    [draft, selectedId, queryClient],
  )

  const selectConversation = useCallback((id: string) => {
    setIsNewFlow(false)
    setSelectedId(id)
    setDraft(null)
    setSidebarOpen(false)
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col text-[var(--text)]">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border)] px-3 py-2 sm:gap-2">
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="studio-btn w-auto shrink-0 px-2 py-1.5"
          aria-label="Toggle conversation list"
          aria-expanded={sidebarOpen}
        >
          <PanelLeft size={15} aria-hidden />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <Bot size={16} className="shrink-0 text-[var(--accent)]" aria-hidden />
          <h2 className="min-w-0 truncate text-sm font-semibold">
            {active && !isNewFlow ? active.title : 'Agent'}
          </h2>
          {active && !isNewFlow && (
            <span className="studio-meta hidden max-w-[9rem] shrink truncate text-[10px] sm:inline">
              {active.provider}/{active.model}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {active && !isNewFlow && (
            <button
              type="button"
              onClick={() => handleDelete(active)}
              className="studio-btn w-auto px-2 py-1.5 text-[var(--danger)]"
              aria-label="Delete this conversation"
            >
              <Trash2 size={15} aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={startNewFlow}
            className="studio-btn-primary studio-btn-compact"
            aria-label="New conversation"
          >
            <MessageSquarePlus size={14} aria-hidden />
            New
          </button>
        </div>
      </div>

      {agentHealthQuery.isError && (
        <p
          className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--danger)]"
          role="alert"
        >
          <AlertTriangle size={13} aria-hidden />
          {AGENT_UNAVAILABLE_MESSAGE}
          {typeof location !== 'undefined' && location.protocol.startsWith('http')
            ? ` ${AGENT_UNAVAILABLE_DEV_HINT}`
            : null}
        </p>
      )}

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <button
            type="button"
            className="absolute inset-0 z-[1] bg-[oklch(0.2_0.02_250_/_0.35)] sm:hidden"
            aria-label="Close conversation list"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {sidebarOpen && (
          <aside
            className="absolute inset-y-0 left-0 z-[2] flex w-64 flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-context)] sm:static sm:z-auto sm:w-56 sm:shadow-none"
            aria-label="Conversations"
          >
            {conversationsQuery.isLoading ? (
              <p className="p-3 text-xs text-[var(--text-muted)]">Loading…</p>
            ) : conversations.length === 0 ? (
              <p className="p-3 text-xs text-[var(--text-muted)]">
                No conversations yet. Start with “New”.
              </p>
            ) : (
              <ul className="grid gap-0.5 p-2">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => selectConversation(conversation.id)}
                      className={`w-full rounded-[var(--radius-md)] px-2.5 py-2 text-left text-xs ${
                        conversation.id === selectedId && !isNewFlow
                          ? 'bg-[var(--surface-raised)] font-medium text-[var(--text)]'
                          : 'text-[var(--text-muted)] hover:bg-[var(--surface-raised)]'
                      }`}
                    >
                      <span className="block truncate">{conversation.title}</span>
                      <span className="mt-0.5 block truncate text-[10px] opacity-70">
                        {conversation.provider}/{conversation.model}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}

        <main
          className={`flex min-h-0 min-w-0 flex-1 flex-col ${
            isNewFlow ? 'overflow-y-auto' : 'overflow-hidden'
          }`}
        >
          {isNewFlow ? (
            <NewConversationPanel
              onStart={handleStartDraft}
              onCancel={() => setIsNewFlow(false)}
              onOpenSettings={onOpenSettings}
            />
          ) : active ? (
            <AgentChat
              key={active.id}
              conversationId={active.id}
              provider={active.provider}
              model={active.model}
              isDraft={active.id === draft?.id}
              onFirstSent={handleFirstSent}
            />
          ) : (
            <div className="grid flex-1 place-items-center px-4">
              <div className="text-center">
                <Bot size={32} className="mx-auto text-[var(--accent)]" aria-hidden />
                <p className="studio-empty-title mt-3">Agent mode</p>
                <p className="studio-empty-body mt-2">
                  Generate images, videos, and audio while chatting with an LLM.
                  <br />
                  Start a conversation from “New”.
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={startNewFlow}
                    className="studio-btn-primary studio-btn-compact px-4"
                  >
                    New conversation
                  </button>
                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="studio-btn w-auto gap-1.5 px-3 py-2 text-sm"
                    >
                      <Settings size={14} aria-hidden />
                      LLM settings
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
