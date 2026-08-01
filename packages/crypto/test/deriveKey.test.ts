import { describe, it, expect } from 'vitest'
import { deriveKeyFromPassword, PBKDF2_ITERATIONS } from '../src/deriveKey.js'

// Known vector: password 'correct horse battery staple' + a fixed 32-byte
// salt (0..31) must always derive to this exact byte array under
// PBKDF2-SHA256 at 600000 iterations. This assertion pins the exact
// algorithm/iteration-count/hash choice — if any of those ever drift, this
// test catches it immediately rather than silently changing every future
// derived key (LKPW-01).
const KNOWN_SALT = new Uint8Array(32)
for (let i = 0; i < 32; i++) KNOWN_SALT[i] = i
const KNOWN_VECTOR = new Uint8Array([
  97, 58, 76, 52, 17, 57, 78, 36, 255, 254, 108, 81, 153, 67, 7, 114, 69, 114, 229, 116, 188, 217,
  142, 168, 207, 69, 124, 100, 137, 155, 251, 254,
])

describe('deriveKeyFromPassword', () => {
  it('uses exactly 600000 PBKDF2 iterations (single-sourced constant)', () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000)
  })

  it('resolves to a 32-byte Uint8Array', async () => {
    const key = await deriveKeyFromPassword('a password', new Uint8Array(32))
    expect(key).toBeInstanceOf(Uint8Array)
    expect(key.byteLength).toBe(32)
  })

  it('is deterministic: the same (password, salt) yields identical bytes across two calls', async () => {
    const salt = new Uint8Array(32).fill(7)
    const a = await deriveKeyFromPassword('same-password', salt)
    const b = await deriveKeyFromPassword('same-password', salt)
    expect(a).toEqual(b)
  })

  it('matches a fixed known (password, salt) vector exactly', async () => {
    const key = await deriveKeyFromPassword('correct horse battery staple', KNOWN_SALT)
    expect(key).toEqual(KNOWN_VECTOR)
  })

  it('a different password with the same salt produces a different key', async () => {
    const salt = new Uint8Array(32).fill(3)
    const a = await deriveKeyFromPassword('password-one', salt)
    const b = await deriveKeyFromPassword('password-two', salt)
    expect(a).not.toEqual(b)
  })

  it('the same password with a different salt produces a different key', async () => {
    const a = await deriveKeyFromPassword('same-password', new Uint8Array(32).fill(1))
    const b = await deriveKeyFromPassword('same-password', new Uint8Array(32).fill(2))
    expect(a).not.toEqual(b)
  })
})
