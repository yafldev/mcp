import { readFile, stat, readdir, mkdir, writeFile } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import {
  encryptBytes,
  encryptMeta,
  decryptBytes,
  decryptMeta,
  toBase64Url,
  fromBase64Url,
  parseShareUrl,
  zipEntries,
  type ZipEntry,
  type TransferMeta,
} from '@yafl/crypto'
import { callApi, type ApiClientOptions } from './apiClient.js'
import { composeKey, resolveKey } from './passwordKey.js'
import { sanitizeFilename, resolveCollision } from './fsSafety.js'

/**
 * The single shared read/encrypt/upload and resolve/download/decrypt
 * pipeline (ARCH-02, part 1 of 2) — extracted from the flows duplicated
 * across apps/cli/src/commands/put.ts, apps/cli/src/commands/get.ts,
 * apps/mcp/src/tools/uploadFile.ts, and apps/mcp/src/tools/downloadFile.ts.
 * Purely additive: no app file is rewired to consume this yet (that is
 * 25-02). Every function here takes an explicit `ApiClientOptions` — never a
 * config singleton — so both the CLI and the MCP server can share it.
 */

/** The 100MB free-tier cap, matching apps/server's MAX_SIZE. Callers keep their own over-cap error surfaces. */
export const MAX_TRANSFER_SIZE = 100_000_000

/**
 * Recursively reads `dirPath` into zipEntries' `{name, data}` shape, `name`
 * being the file's path relative to `dirPath` with POSIX separators
 * (XFER-11) — isomorphic with the same entry-name convention apps/web uses,
 * regardless of host OS path separators. Private — only readDirOrFile below
 * calls it.
 */
async function readDirEntries(dirPath: string): Promise<ZipEntry[]> {
  const dirents = await readdir(dirPath, { recursive: true, withFileTypes: true })
  const entries: ZipEntry[] = []
  for (const dirent of dirents) {
    if (!dirent.isFile()) continue
    const fullPath = join(dirent.parentPath, dirent.name)
    const name = relative(dirPath, fullPath).split(sep).join('/')
    const data = await readFile(fullPath)
    entries.push({ name, data })
  }
  return entries
}

/**
 * Reads `absPath` into the `{ bytes, metaName, metaType }` shape
 * uploadEncrypted expects. A directory is zipped client-side (XFER-11) into
 * a single `<dirname>.zip` archive; a single file is read as-is. Byte
 * cap enforcement is left to the caller (MAX_TRANSFER_SIZE above).
 */
export async function readDirOrFile(
  absPath: string,
): Promise<{ bytes: Uint8Array; metaName: string; metaType: string }> {
  const stats = await stat(absPath)
  if (stats.isDirectory()) {
    const entries = await readDirEntries(absPath)
    const bytes = zipEntries(entries)
    return { bytes, metaName: `${basename(absPath)}.zip`, metaType: 'application/zip' }
  }
  const bytes = await readFile(absPath)
  return { bytes, metaName: basename(absPath), metaType: 'application/octet-stream' }
}

/**
 * Encrypts `bytes` locally, creates the transfer, PUTs the ciphertext
 * straight to R2 (no Authorization header, no API key on that URL — only
 * ciphertext bytes cross that boundary), then completes it. Plaintext, the
 * key, and the password (if any) never leave this process (T-25-01).
 * composeKey generates a fresh random key (no password) or derives one from
 * a fresh salt + password (LKPW-01/LKPW-04) — the exact composition both
 * apps/cli's put command and apps/mcp's upload_file tool use.
 */
export async function uploadEncrypted(
  options: ApiClientOptions,
  input: { bytes: Uint8Array; metaName: string; metaType: string; password?: string; oneTime?: boolean },
): Promise<{ id: string; key: Uint8Array; salt?: Uint8Array; expiresAt: string; size: number }> {
  const { bytes, metaName, metaType, password, oneTime } = input
  const { key, salt } = await composeKey(password)
  const ciphertext = await encryptBytes(key, bytes)
  const metaBlob = await encryptMeta(key, { name: metaName, type: metaType })
  const encryptedMeta = toBase64Url(metaBlob)

  const created = (await callApi(options, '/api/v1/transfers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ size: ciphertext.byteLength, encryptedMeta, oneTime: oneTime === true }),
  })) as { id: string; uploadUrl: string }

  // Direct ciphertext PUT straight to R2 — no Authorization header, no API
  // key on this URL; only ciphertext bytes cross this boundary.
  await fetch(created.uploadUrl, { method: 'PUT', body: ciphertext as BodyInit })

  const completed = (await callApi(options, `/api/v1/transfers/${created.id}/complete`, {
    method: 'POST',
  })) as { id: string; status: string; size: number; expiresAt: string }

  return { id: created.id, key, salt, expiresAt: completed.expiresAt, size: bytes.byteLength }
}

/** Thrown by `resolveShareLink` for a fragment-less or keyless share URL/code — never sent to the API, never logged. */
export class MissingKeyError extends Error {
  constructor(
    message = 'A share URL or the compact <id>#<key> code with the decryption key is required (e.g. https://yafl.dev/t/{id}#{key} or {id}#{key})',
  ) {
    super(message)
    this.name = 'MissingKeyError'
  }
}

/**
 * Parses `url` (a full share URL or the compact `<id>#<key>` code, HAND-02)
 * and resolves the decryption key. Throws `MissingKeyError` for a
 * fragment-less/keyless url — before any network call, since
 * `parseShareUrl` is a pure fragment-string parse. Throws
 * `PasswordRequiredError` (from resolveKey) for a v2 link with no password —
 * also before any network call (LKPW-02/LKPW-04).
 */
export async function resolveShareLink(url: string, password?: string): Promise<{ id: string; key: Uint8Array }> {
  const parsed = parseShareUrl(url)
  if (!parsed.needsPassword && !parsed.key) {
    throw new MissingKeyError()
  }
  const key = await resolveKey(parsed, password)
  return { id: parsed.id, key }
}

/**
 * Resolves the transfer, decrypts its metadata FIRST, then authorizes the
 * download and decrypts the ciphertext. The verify-first ordering
 * (decryptMeta before POST /:id/download) is load-bearing: it throws on a
 * wrong key/password before the download-authorize call, so a bad key can
 * never burn a one-time link (XFER-10, T-25-03). Ciphertext GET always
 * bypasses the app server — straight to R2 (or its stub).
 */
export async function downloadDecrypt(
  options: ApiClientOptions,
  id: string,
  key: Uint8Array,
): Promise<{ plaintext: Uint8Array; meta: TransferMeta }> {
  const meta = (await callApi(options, `/api/v1/transfers/${id}`)) as {
    encryptedMeta: string
    size: number
  }

  // Verify the key by decrypting the metadata FIRST (throws on a wrong
  // key/password), so a bad key never reaches the consuming download call
  // below and can never burn a one-time link (XFER-10 fix, T-25-03).
  const decryptedMeta = await decryptMeta(key, fromBase64Url(meta.encryptedMeta))

  // Authorize the download — for a one-time transfer THIS is the step that
  // atomically consumes it (a 410 means it was already downloaded).
  const { downloadUrl } = (await callApi(options, `/api/v1/transfers/${id}/download`, {
    method: 'POST',
  })) as { downloadUrl: string }

  // Ciphertext GET always bypasses the app server — this fetch goes straight
  // to R2 (or its stub), never through the Transfer API.
  const ciphertextRes = await fetch(downloadUrl)
  const ciphertextBytes = new Uint8Array(await ciphertextRes.arrayBuffer())

  // Decrypt locally — the key never leaves this process and is never
  // included in any API request.
  const plaintext = await decryptBytes(key, ciphertextBytes)

  return { plaintext, meta: decryptedMeta }
}

/**
 * Sanitizes `name` (untrusted, server-stored metadata — T-03-06/T-25-02),
 * resolves any filename collision in `destDir`, writes the plaintext, and
 * returns the final path written.
 */
export async function writeDecrypted(destDir: string, name: string, plaintext: Uint8Array): Promise<string> {
  const safeName = sanitizeFilename(name)
  await mkdir(destDir, { recursive: true })
  const finalName = resolveCollision(destDir, safeName)
  const targetPath = join(destDir, finalName)
  await writeFile(targetPath, plaintext as unknown as Uint8Array<ArrayBuffer>)
  return targetPath
}
