/**
 * base64url encode/decode for raw key bytes (CRYP-02).
 *
 * Uses the native `Uint8Array.prototype.toBase64`/`fromBase64` methods when
 * available (Baseline-track, Node 22.16+/24 and current evergreen browsers),
 * falling back to a manual Buffer-based implementation on older engines. Both
 * paths produce the URL-safe alphabet with no padding, so the result is safe
 * to place directly in a URL hash fragment without further escaping.
 */
export function toBase64Url(bytes: Uint8Array): string {
  const anyU8 = bytes as Uint8Array & {
    toBase64?: (opts?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }) => string
  }
  if (typeof anyU8.toBase64 === 'function') {
    return anyU8.toBase64({ alphabet: 'base64url', omitPadding: true })
  }
  // Fallback for engines predating the native method (older browsers / older Node).
  const base64 = Buffer.from(bytes).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Inverse of `toBase64Url`. Native-method-first with the same manual fallback
 * so both directions stay symmetric across engines.
 */
export function fromBase64Url(str: string): Uint8Array {
  const AnyU8 = Uint8Array as unknown as {
    fromBase64?: (s: string, opts?: { alphabet?: 'base64' | 'base64url' }) => Uint8Array
  }
  if (typeof AnyU8.fromBase64 === 'function') {
    return AnyU8.fromBase64(str, { alphabet: 'base64url' })
  }
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=')
  return new Uint8Array(Buffer.from(padded, 'base64'))
}
