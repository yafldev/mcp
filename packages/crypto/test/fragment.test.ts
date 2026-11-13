import { describe, it, expect } from 'vitest'
import { generateKey, encryptBytes, decryptBytes } from '../src/aesGcm.js'
import { encryptMeta, decryptMeta } from '../src/metadata.js'
import { deriveKeyFromPassword } from '../src/deriveKey.js'
import {
  keyToFragment,
  keyFromFragment,
  buildShareUrl,
  buildRetrievalCode,
  buildRetrievalCommand,
  buildLinkArtifacts,
  parseShareUrl,
  isValidTransferId,
} from '../src/fragment.js'

describe('fragment round-trip', () => {
  it('encodes the key to a base64url fragment string and decodes back to identical bytes', async () => {
    const key = await generateKey()
    const fragment = keyToFragment(key)
    expect(typeof fragment).toBe('string')
    // base64url alphabet only — no '+', '/', or '=' padding.
    expect(fragment).not.toMatch(/[+/=]/)
    const decoded = keyFromFragment(fragment)
    expect(decoded).toEqual(key)
  })
})

describe('buildShareUrl / parseShareUrl round-trip', () => {
  it('builds a share URL and recovers both the id and key from it', async () => {
    const key = await generateKey()
    const url = buildShareUrl('https://yafl.dev', 'abc123', key)
    expect(url).toMatch(/^https:\/\/yafl\.dev\/t\/abc123#.+$/)

    const parsed = parseShareUrl(url)
    expect(parsed.id).toBe('abc123')
    expect(parsed.key).toEqual(key)
  })

  it('returns key undefined for a fragment-less URL', () => {
    const parsed = parseShareUrl('https://yafl.dev/t/abc123')
    expect(parsed.id).toBe('abc123')
    expect(parsed.key).toBeUndefined()
  })

  it('throws on a malformed URL with no /t/{id} segment', () => {
    expect(() => parseShareUrl('https://yafl.dev/not-a-share-link')).toThrow()
  })
})

describe('v1 backward compatibility (LKPW-03 — regression-critical)', () => {
  it('keyToFragment never emits a "2." version prefix and never starts with a digit-plus-dot', async () => {
    // base64url never contains "." at all, so this is inherent — asserted
    // explicitly so a future encoding change trips this test immediately.
    for (let i = 0; i < 20; i++) {
      const key = await generateKey()
      const fragment = keyToFragment(key)
      expect(fragment).not.toMatch(/^\d+\./)
      expect(fragment).not.toContain('.')
    }
  })

  it('3-argument buildShareUrl output is byte-identical to the pre-change v1 shape', async () => {
    const key = await generateKey()
    const url = buildShareUrl('https://yafl.dev', 'abc123', key)
    expect(url).toBe(`https://yafl.dev/t/abc123#${keyToFragment(key)}`)
  })

  it('parseShareUrl of a v1 URL returns needsPassword:false, the decoded key, and salt undefined', async () => {
    const key = await generateKey()
    const url = buildShareUrl('https://yafl.dev', 'abc123', key)
    const parsed = parseShareUrl(url)
    expect(parsed.id).toBe('abc123')
    expect(parsed.key).toEqual(key)
    expect(parsed.needsPassword).toBe(false)
    expect(parsed.salt).toBeUndefined()
  })

  it('a fragment-less URL returns needsPassword:false with key undefined', () => {
    const parsed = parseShareUrl('https://yafl.dev/t/abc123')
    expect(parsed.needsPassword).toBe(false)
    expect(parsed.key).toBeUndefined()
  })
})

describe('v2 password-protected fragment (LKPW-01/LKPW-02 — no network)', () => {
  it('parseShareUrl detects a v2 fragment purely by string parsing, with zero network/fetch calls', () => {
    const originalFetch = globalThis.fetch
    // If parseShareUrl ever touched the network, this would throw — proving
    // needsPassword detection is a pure string parse (LKPW-02 pivot).
    ;(globalThis as { fetch?: typeof fetch }).fetch = () => {
      throw new Error('parseShareUrl must never call fetch')
    }
    try {
      const salt = new Uint8Array(32).fill(9)
      const url = buildShareUrl('https://yafl.dev', 'abc123', { salt })
      const parsed = parseShareUrl(url)
      expect(parsed.id).toBe('abc123')
      expect(parsed.key).toBeUndefined()
      expect(parsed.needsPassword).toBe(true)
      expect(parsed.salt).toEqual(salt)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('v2 fragment starts with the "2." version prefix', () => {
    const salt = new Uint8Array(32).fill(5)
    const url = buildShareUrl('https://yafl.dev', 'abc123', { salt })
    const fragment = url.split('#')[1]
    expect(fragment.startsWith('2.')).toBe(true)
  })

  it('round-trips bytes and metadata through a v2 link with the correct password', async () => {
    const password = 'a strong second factor'
    const salt = new Uint8Array(32)
    crypto.getRandomValues(salt)
    const key = await deriveKeyFromPassword(password, salt)

    const plaintext = new TextEncoder().encode('hello, password-protected world')
    const ciphertext = await encryptBytes(key, plaintext)
    const metaBlob = await encryptMeta(key, { name: 'secret.txt', type: 'text/plain' })

    const url = buildShareUrl('https://yafl.dev', 'abc123', { salt })
    const parsed = parseShareUrl(url)
    expect(parsed.needsPassword).toBe(true)
    expect(parsed.salt).toBeDefined()

    const rederivedKey = await deriveKeyFromPassword(password, parsed.salt as Uint8Array)
    const decrypted = await decryptBytes(rederivedKey, ciphertext)
    const decryptedMeta = await decryptMeta(rederivedKey, metaBlob)

    expect(decrypted).toEqual(plaintext)
    expect(decryptedMeta).toEqual({ name: 'secret.txt', type: 'text/plain' })
  })

  it('wrong password fails as a client-side AES-GCM decrypt error, with zero network calls (LKPW-02)', async () => {
    const salt = new Uint8Array(32)
    crypto.getRandomValues(salt)
    const key = await deriveKeyFromPassword('the-real-password', salt)
    const ciphertext = await encryptBytes(key, new TextEncoder().encode('top secret'))

    const originalFetch = globalThis.fetch
    ;(globalThis as { fetch?: typeof fetch }).fetch = () => {
      throw new Error('wrong-password handling must never call fetch — no server oracle')
    }
    try {
      const wrongKey = await deriveKeyFromPassword('totally-wrong-password', salt)
      await expect(decryptBytes(wrongKey, ciphertext)).rejects.toThrow()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('unknown fragment version', () => {
  it('throws a clear, named error for an unrecognized "N." version prefix', () => {
    expect(() => parseShareUrl('https://yafl.dev/t/abc123#9.somepayload')).toThrow(/version/i)
  })
})

describe('buildRetrievalCode / buildRetrievalCommand (HAND-01 — the single builder)', () => {
  it('v1: buildRetrievalCode equals buildShareUrl with the origin/t/ prefix stripped', async () => {
    const key = await generateKey()
    const origin = 'https://yafl.dev'
    const url = buildShareUrl(origin, 'abc123', key)
    const code = buildRetrievalCode('abc123', key)
    expect(code).toBe(url.replace(`${origin}/t/`, ''))
    expect(code).toBe(`abc123#${keyToFragment(key)}`)
  })

  it('v2: buildRetrievalCode equals buildShareUrl with the origin/t/ prefix stripped', () => {
    const salt = new Uint8Array(32).fill(3)
    const origin = 'https://yafl.dev'
    const url = buildShareUrl(origin, 'abc123', { salt })
    const code = buildRetrievalCode('abc123', { salt })
    expect(code).toBe(url.replace(`${origin}/t/`, ''))
    expect(code.startsWith('abc123#2.')).toBe(true)
  })

  it('buildRetrievalCommand prefixes "yafl get " onto the exact buildRetrievalCode output (v1)', async () => {
    const key = await generateKey()
    const code = buildRetrievalCode('abc123', key)
    expect(buildRetrievalCommand('abc123', key)).toBe(`yafl get ${code}`)
  })

  it('buildRetrievalCommand prefixes "yafl get " onto the exact buildRetrievalCode output (v2)', () => {
    const salt = new Uint8Array(32).fill(7)
    const code = buildRetrievalCode('abc123', { salt })
    expect(buildRetrievalCommand('abc123', { salt })).toBe(`yafl get ${code}`)
  })
})

describe('buildLinkArtifacts (HAND-01 — the single { url, code, command } builder)', () => {
  it('v1: returns { url, code, command } byte-identical to the three individual builders', async () => {
    const key = await generateKey()
    const apiUrl = 'https://yafl.dev'
    const artifacts = buildLinkArtifacts(apiUrl, 'abc123', key)
    expect(artifacts).toEqual({
      url: buildShareUrl(apiUrl, 'abc123', key),
      code: buildRetrievalCode('abc123', key),
      command: buildRetrievalCommand('abc123', key),
    })
  })

  it('v2: returns the salt-fragment variants, byte-identical to the current salt branch', () => {
    const salt = new Uint8Array(32).fill(4)
    const apiUrl = 'https://yafl.dev'
    const artifacts = buildLinkArtifacts(apiUrl, 'abc123', { salt })
    expect(artifacts).toEqual({
      url: buildShareUrl(apiUrl, 'abc123', { salt }),
      code: buildRetrievalCode('abc123', { salt }),
      command: buildRetrievalCommand('abc123', { salt }),
    })
    expect(artifacts.code.startsWith('abc123#2.')).toBe(true)
  })

  it('code is always url minus its `${apiUrl}/t/` prefix; command is always `yafl get ${code}` (v1)', async () => {
    const key = await generateKey()
    const apiUrl = 'https://yafl.dev'
    const { url, code, command } = buildLinkArtifacts(apiUrl, 'abc123', key)
    expect(code).toBe(url.slice(`${apiUrl}/t/`.length))
    expect(command).toBe(`yafl get ${code}`)
  })

  it('code is always url minus its `${apiUrl}/t/` prefix; command is always `yafl get ${code}` (v2)', () => {
    const salt = new Uint8Array(32).fill(8)
    const apiUrl = 'https://yafl.dev'
    const { url, code, command } = buildLinkArtifacts(apiUrl, 'abc123', { salt })
    expect(code).toBe(url.slice(`${apiUrl}/t/`.length))
    expect(command).toBe(`yafl get ${code}`)
  })
})

describe('parseShareUrl — bare compact form (HAND-02 — T-16-02 regression-critical)', () => {
  it('parses <id>#<key> (v1, no scheme, no /t/) identically to the equivalent full URL', async () => {
    const key = await generateKey()
    const fullUrl = buildShareUrl('https://yafl.dev', 'abc123', key)
    const compact = buildRetrievalCode('abc123', key)
    expect(parseShareUrl(compact)).toEqual(parseShareUrl(fullUrl))
    const parsed = parseShareUrl(compact)
    expect(parsed.id).toBe('abc123')
    expect(parsed.key).toEqual(key)
    expect(parsed.needsPassword).toBe(false)
  })

  it('parses <id>#2.<salt> (v2, no scheme, no /t/) into needsPassword:true + the decoded salt', () => {
    const salt = new Uint8Array(32).fill(6)
    const compact = buildRetrievalCode('abc123', { salt })
    const parsed = parseShareUrl(compact)
    expect(parsed.id).toBe('abc123')
    expect(parsed.needsPassword).toBe(true)
    expect(parsed.salt).toEqual(salt)
    expect(parsed.key).toBeUndefined()
  })

  it('parses a bare <id> (no #) with key undefined and needsPassword:false', () => {
    const parsed = parseShareUrl('abc123')
    expect(parsed.id).toBe('abc123')
    expect(parsed.key).toBeUndefined()
    expect(parsed.needsPassword).toBe(false)
  })

  it('a scheme/slash-bearing malformed URL still throws exactly as before (not coerced into a bare id)', () => {
    expect(() => parseShareUrl('https://yafl.dev/not-a-share-link')).toThrow()
  })

  it('an unknown "N." version prefix still throws on the compact form too', () => {
    expect(() => parseShareUrl('abc123#9.somepayload')).toThrow(/version/i)
  })

  it('full-URL back-compat: v1, v2, fragment-less, and malformed URLs are all byte-identical to before', async () => {
    const key = await generateKey()
    const url = buildShareUrl('https://yafl.dev', 'abc123', key)
    const parsed = parseShareUrl(url)
    expect(parsed.id).toBe('abc123')
    expect(parsed.key).toEqual(key)
    expect(parsed.needsPassword).toBe(false)

    const fragmentLess = parseShareUrl('https://yafl.dev/t/abc123')
    expect(fragmentLess.id).toBe('abc123')
    expect(fragmentLess.key).toBeUndefined()

    expect(() => parseShareUrl('https://yafl.dev/not-a-share-link')).toThrow()
    expect(() => parseShareUrl('https://yafl.dev/t/abc123#9.somepayload')).toThrow(/version/i)
  })
})

/**
 * fleet-secaudit #115. The strict id charset existed only inside
 * `parseShareUrl`, so an id arriving FROM the server was never checked
 * against it. `isValidTransferId` is that charset promoted to a predicate so
 * the client can gate a server-supplied id before it reaches a shell command.
 */
describe('isValidTransferId (fleet-secaudit #115)', () => {
  it('accepts the nanoid alphabet YAFL actually mints ids from', () => {
    expect(isValidTransferId('AApl-A3AddMT')).toBe(true)
    expect(isValidTransferId('abc123')).toBe(true)
    expect(isValidTransferId('a_b-C9')).toBe(true)
  })

  it('rejects shell metacharacters — the #115 injection itself', () => {
    expect(isValidTransferId('x;curl -d k=')).toBe(false)
    expect(isValidTransferId('x$(id)')).toBe(false)
    expect(isValidTransferId('x`id`')).toBe(false)
    expect(isValidTransferId('x&&id')).toBe(false)
    expect(isValidTransferId('x|id')).toBe(false)
  })

  it('rejects whitespace, which would split the paste-ready command', () => {
    expect(isValidTransferId('abc 123')).toBe(false)
    expect(isValidTransferId('abc\n123')).toBe(false)
    expect(isValidTransferId('abc\t123')).toBe(false)
  })

  it('rejects an empty id, path separators and a fragment marker', () => {
    expect(isValidTransferId('')).toBe(false)
    expect(isValidTransferId('a/b')).toBe(false)
    expect(isValidTransferId('../etc')).toBe(false)
    expect(isValidTransferId('abc#def')).toBe(false)
  })
})
