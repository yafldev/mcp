import { describe, it, expect } from 'vitest'
import { unzipSync } from 'fflate'
import { zipEntries } from '../src/zip.js'

describe('zipEntries', () => {
  it('round-trips names and bytes, including a nested path', () => {
    const bytesA = new TextEncoder().encode('hello from a.txt')
    const bytesB = new TextEncoder().encode('hello from sub/b.txt')
    const zipped = zipEntries([
      { name: 'a.txt', data: bytesA },
      { name: 'sub/b.txt', data: bytesB },
    ])

    expect(zipped).toBeInstanceOf(Uint8Array)

    const unzipped = unzipSync(zipped)
    expect(Object.keys(unzipped).sort()).toEqual(['a.txt', 'sub/b.txt'])
    expect(unzipped['a.txt']).toEqual(bytesA)
    expect(unzipped['sub/b.txt']).toEqual(bytesB)
  })

  it('rejects an empty entry list with a clear error', () => {
    expect(() => zipEntries([])).toThrow(/empty/i)
  })

  it('produces deterministic byte content for identical input across two calls', () => {
    const entries = [
      { name: 'a.txt', data: new TextEncoder().encode('same content') },
      { name: 'sub/b.txt', data: new TextEncoder().encode('more content') },
    ]
    const first = zipEntries(entries)
    const second = zipEntries(entries)
    expect(first).toEqual(second)
  })
})
