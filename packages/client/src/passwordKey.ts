/**
 * Shared v2 (password-protected) link key composition, consumed identically
 * by apps/mcp and apps/cli (LKPW-04) — this is the single source of truth
 * so both agree exactly with each other and with the web UI's v2 format on
 * how a password composes into a decryption key.
 */
import { generateKey, deriveKeyFromPassword } from '@yafl/crypto'

/** Thrown by `resolveKey` when a v2 (password-protected) link is opened without a password. */
export class PasswordRequiredError extends Error {
  constructor(
    message = 'This link is password-protected. Pass the password to decrypt it — it is never sent to the API.',
  ) {
    super(message)
    this.name = 'PasswordRequiredError'
  }
}

export type ComposedKey = { key: Uint8Array; salt?: Uint8Array }

/**
 * Given an optional password, returns either a fresh random key (v1,
 * passwordless — `{ key }`) or a key derived from a fresh 256-bit salt +
 * the password (v2 — `{ key, salt }`). Callers pass `salt` (when present)
 * straight into `buildShareUrl(origin, id, { salt })`.
 */
export async function composeKey(password?: string): Promise<ComposedKey> {
  if (!password) {
    const key = await generateKey()
    return { key }
  }
  const salt = new Uint8Array(32)
  crypto.getRandomValues(salt)
  const key = await deriveKeyFromPassword(password, salt)
  return { key, salt }
}

/** The subset of `parseShareUrl`'s return shape `resolveKey` needs. */
export type ParsedShareUrl = { key?: Uint8Array; needsPassword: boolean; salt?: Uint8Array }

/**
 * Given a parsed share URL and an optional password, returns the decryption
 * key. For a v2 (password-protected) URL with no password supplied, throws
 * `PasswordRequiredError` synchronously — before any network call, since
 * `parseShareUrl`'s `needsPassword` is already a pure fragment-string parse
 * (LKPW-02). For a v2 URL with a password, derives the key. Otherwise
 * (v1), returns the key already carried in the fragment.
 */
export async function resolveKey(parsed: ParsedShareUrl, password?: string): Promise<Uint8Array> {
  if (parsed.needsPassword) {
    if (!password) {
      throw new PasswordRequiredError()
    }
    return deriveKeyFromPassword(password, parsed.salt as Uint8Array)
  }
  return parsed.key as Uint8Array
}
