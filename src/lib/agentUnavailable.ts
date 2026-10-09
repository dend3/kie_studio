/** Shown when the local API process is unreachable. */
export const AGENT_UNAVAILABLE_MESSAGE =
  'Could not connect to the Agent. Please restart Studio.'

export const AGENT_UNAVAILABLE_DEV_HINT =
  'In development, start with npm run dev (API + Web).'

function messageFromJsonBody(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || !('error' in parsed)) return null
    const err = (parsed as { error: unknown }).error
    return typeof err === 'string' && err.trim() ? err.trim() : null
  } catch {
    return null
  }
}

export function formatAgentSendError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return messageFromJsonBody(error.message) ?? error.message.trim()
  }
  if (typeof error === 'string' && error.trim()) {
    return messageFromJsonBody(error) ?? error.trim()
  }
  return AGENT_UNAVAILABLE_MESSAGE
}
