import { describe, it, expect } from 'vitest'
import { generateKey, encryptBytes, decryptBytes } from '../src/aesGcm.js'
import { encryptMeta, decryptMeta } from '../src/metadata.js'

describe('round-trip', () => {
  it('encrypts then decrypts arbitrary bytes back to the original', async () => {
    const key = await generateKey()
    const plaintext = new TextEncoder().encode('the quick brown fox jumps over the lazy dog')
    const blob = await encryptBytes(key, plaintext)
    const decrypted = await decryptBytes(key, blob)
    expect(decrypted).toEqual(plaintext)
  })
})

describe('nonce uniqueness', () => {
  it('produces different IVs and ciphertexts for identical plaintext', async () => {
    const key = await generateKey()
    const plaintext = new TextEncoder().encode('same input, twice')
    const a = await encryptBytes(key, plaintext)
    const b = await encryptBytes(key, plaintext)
    expect(a.slice(0, 12)).not.toEqual(b.slice(0, 12)) // IVs differ
    expect(a).not.toEqual(b) // full ciphertexts differ
  })
})

describe('tamper detection', () => {
  it('rejects a ciphertext with a flipped bit', async () => {
    const key = await generateKey()
    const blob = await encryptBytes(key, new TextEncoder().encode('integrity matters'))
    blob[blob.length - 1] ^= 0xff // flip the last ciphertext byte
    await expect(decryptBytes(key, blob)).rejects.toThrow()
  })
})

describe('metadata round-trip', () => {
  it('encrypts then decrypts filename + content-type back to the identical object', async () => {
    const key = await generateKey()
    const meta = { name: 'invoice.pdf', type: 'application/pdf' }
    const blob = await encryptMeta(key, meta)
    const decrypted = await decryptMeta(key, blob)
    expect(decrypted).toEqual(meta)
  })
})
