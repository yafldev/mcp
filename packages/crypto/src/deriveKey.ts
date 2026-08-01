/**
 * Password -> AES key derivation for v2 (password-protected) share links
 * (LKPW-01). PBKDF2-SHA256 is used because it is natively available via
 * `crypto.subtle` in both Node and every evergreen browser — no new
 * dependency (Argon2 has no native WebCrypto implementation) and the exact
 * same code runs unmodified on the MCP/CLI (Node) and web (browser) paths.
 *
 * The v2 salt is a fresh, high-entropy 256-bit secret carried in the URL
 * fragment (never sent to the server), so the derived key's entropy never
 * depends on password quality — the password is a REQUIRED SECOND FACTOR
 * layered on top of that salt, not the sole source of key strength.
 */

/**
 * PBKDF2 iteration count — the OWASP 2023 floor for PBKDF2-SHA256. Single-
 * sourced here so the value is never duplicated or allowed to drift between
 * callers.
 */
export const PBKDF2_ITERATIONS = 600_000

/**
 * Derives a 32-byte AES-256 key from `password` + `salt` via
 * PBKDF2-SHA256 at `PBKDF2_ITERATIONS` iterations. Deterministic: the same
 * (password, salt) pair always yields identical bytes, in Node and in the
 * browser, since both implement `crypto.subtle` identically for PBKDF2.
 */
export async function deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    256,
  )
  return new Uint8Array(bits)
}
