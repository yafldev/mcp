/**
 * Shared AES-256-GCM WebCrypto module (CRYP-01, CRYP-04).
 *
 * This is the single place in the whole system where plaintext and the
 * encryption key ever coexist. It runs unmodified on Node (>=20,
 * `globalThis.crypto`) and in every evergreen browser via the same
 * `crypto.subtle` API — no server/R2 code is imported here, and none ever
 * should be (T-02-03).
 */

/**
 * Generates a fresh 256-bit AES key using the platform CSPRNG
 * (`crypto.getRandomValues`, never `Math.random` or any other non-crypto
 * source). A new key must be generated per file — keys are never reused
 * across transfers (CRYP-01).
 */
export async function generateKey(): Promise<Uint8Array> {
  const key = new Uint8Array(32) // 256 bits
  crypto.getRandomValues(key)
  return key
}

/**
 * Encrypts `plaintext` under `key` using AES-256-GCM with a freshly
 * generated 12-byte IV created *inside* this function via
 * `crypto.getRandomValues` — never accepted as a parameter. Threading an IV
 * in from a caller is exactly the nonce-reuse bug this module must never
 * allow (T-02-01 / RESEARCH.md Pitfall 2): every call to this function gets
 * its own nonce, so no caller can ever accidentally share one across two
 * encryptions. The IV is prepended to the ciphertext (`iv‖ciphertext`
 * framing, CONTEXT.md) so `decryptBytes` can recover it without a separate
 * side channel.
 */
export async function encryptBytes(key: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = new Uint8Array(12) // fresh IV every call — never threaded in from outside
  crypto.getRandomValues(iv)
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, [
    'encrypt',
  ])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plaintext as BufferSource),
  )
  const framed = new Uint8Array(iv.length + ciphertext.length)
  framed.set(iv, 0)
  framed.set(ciphertext, iv.length)
  return framed // iv‖ciphertext, per CONTEXT.md framing
}

/**
 * Decrypts a blob produced by `encryptBytes`. Slices the first 12 bytes off
 * as the IV and decrypts the remainder. `crypto.subtle.decrypt` verifies the
 * GCM authentication tag as part of the call and throws on any mismatch —
 * this function never silently returns garbage on a tampered or corrupted
 * blob (T-02-02); callers must handle the rejection.
 */
export async function decryptBytes(key: Uint8Array, blob: Uint8Array): Promise<Uint8Array> {
  const iv = blob.slice(0, 12)
  const ciphertext = blob.slice(12)
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, [
    'decrypt',
  ])
  // Throws on auth-tag mismatch — tamper/corruption is detected, not silently accepted.
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext as BufferSource),
  )
}
