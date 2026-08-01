/**
 * Shared client-side folder-zip primitive (XFER-11) — one pre-encryption
 * step consumed unmodified by apps/web (browser), apps/cli, and apps/mcp
 * (Node). The output is opaque plaintext bytes fed into the existing
 * `encryptBytes` pipeline; no second pipeline, no server involvement.
 *
 * Memory note: `zipSync` builds the entire archive in memory and the
 * result is then held alongside the raw entry bytes (and, once handed to
 * the encrypt step, the ciphertext) concurrently. This is fine at the
 * fixed 100MB transfer cap. Do NOT raise the cap without first moving to
 * fflate's streaming `Zip`/`AsyncZipDeflate` API — see research §1 and
 * 20-CONTEXT.md "Deferred".
 *
 * Zip-slip is out of scope: v1 never extracts a zip (the recipient
 * downloads the `.zip` as opaque ciphertext-derived bytes), so there is no
 * extraction attack surface today. Any future extract feature MUST run
 * entry names through the path-traversal guard in
 * apps/{cli,mcp}/src/lib/fsSafety.ts before writing to disk.
 */
import { zipSync } from 'fflate'

export interface ZipEntry {
  /** Relative path within the archive, e.g. `a.txt` or `sub/b.txt`. */
  name: string
  data: Uint8Array
}

/**
 * Zips a flat list of named byte entries into a single deterministic
 * Uint8Array (a valid .zip file). Isomorphic — no Node-only APIs, no `fs`
 * access — so it runs identically in a browser worker and in Node.
 *
 * Uses store/light compression (`level: 1`): code and already-encrypted or
 * already-compressed binaries gain little from higher DEFLATE levels, and
 * higher levels cost wall-clock time against the "no friction" goal.
 */
export function zipEntries(entries: ZipEntry[]): Uint8Array {
  if (entries.length === 0) {
    throw new Error('zipEntries: cannot zip an empty entry list')
  }

  const record: Record<string, Uint8Array> = {}
  for (const { name, data } of entries) {
    record[name] = data
  }

  return zipSync(record, { level: 1 })
}
