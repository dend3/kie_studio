/**
 * crypto.randomUUID() is only available in secure contexts (HTTPS or
 * localhost). When Studio is opened over LAN http://<ip>:5173, older or
 * stricter browsers expose `crypto` without `randomUUID`, which crashed
 * queue item creation. Fall back to getRandomValues-based UUIDv4.
 */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  // Last resort (non-cryptographic)
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
