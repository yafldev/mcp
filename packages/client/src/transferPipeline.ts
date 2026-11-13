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
import { sanitizeFilename, collisionCandidate } from './fsSafety.js'

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
  //
  // Checked, because the server's own verification two calls later reports
  // the SYMPTOM (`upload_incomplete` from the HeadObject at /complete) and
  // not the cause. Naming the R2 status here is the difference between "the
  // storage layer returned 500" and a transfer that mysteriously will not
  // complete.
  const uploadRes = await fetch(created.uploadUrl, { method: 'PUT', body: ciphertext as BodyInit })
  if (!uploadRes.ok) {
    throw new R2TransferError(`Uploading the encrypted file to storage failed (HTTP ${uploadRes.status})`)
  }

  const completed = (await callApi(options, `/api/v1/transfers/${created.id}/complete`, {
    method: 'POST',
  })) as { id: string; status: string; size: number; expiresAt: string }

  return { id: created.id, key, salt, expiresAt: completed.expiresAt, size: bytes.byteLength }
}

/**
 * Thrown when the direct-to-R2 leg of a transfer fails (the presigned PUT or
 * GET). Distinct from `ApiError`, which covers the Transfer API itself —
 * these two legs fail for different reasons and a caller may well want to
 * retry one and not the other. Carries no URL: a presigned URL is a bearer
 * credential and must never reach a log or an error message.
 */
export class R2TransferError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'R2TransferError'
  }
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
  //
  // Checked for a reason worth stating: this runs AFTER the consuming
  // /download call above, so for a one-time link the link is already spent by
  // the time we get here. Unchecked, an R2 error page's bytes went straight
  // into decryptBytes and came back as an AES-GCM auth failure — telling the
  // recipient their key was wrong, about a link they can no longer retry.
  const ciphertextRes = await fetch(downloadUrl)
  if (!ciphertextRes.ok) {
    throw new R2TransferError(
      `Fetching the encrypted file from storage failed (HTTP ${ciphertextRes.status})`,
    )
  }
  const ciphertextBytes = new Uint8Array(await ciphertextRes.arrayBuffer())

  // Decrypt locally — the key never leaves this process and is never
  // included in any API request.
  const plaintext = await decryptBytes(key, ciphertextBytes)

  return { plaintext, meta: decryptedMeta }
}

/** Collision-suffix ceiling — far past any real directory, and bounds the loop below. */
const MAX_COLLISION_CANDIDATES = 10_000

/**
 * Sanitizes `name` (untrusted, server-stored metadata — T-03-06/T-25-02),
 * resolves any filename collision in `destDir`, writes the plaintext, and
 * returns the final path written.
 *
 * The write is EXCLUSIVE (`flag: 'wx'` = O_CREAT|O_EXCL|O_WRONLY), which is
 * what makes it safe rather than merely tidy (261113-sec finding 2):
 *
 *  - O_EXCL refuses to follow a symlink at the final path component. The
 *    filename here comes from metadata only the sender could write — the
 *    server stores it but cannot read it — so nothing upstream has vetted
 *    it. sanitizeFilename keeps the write NAMED inside destDir, but a
 *    symlink planted at that name would otherwise redirect the bytes
 *    anywhere the user can write. A DANGLING link is the dangerous one: a
 *    stat-based check follows it, finds nothing, calls the name free, and
 *    then creates the attacker's target.
 *  - It closes the check-then-write race: the kernel decides whether the
 *    name is free at the instant of the create, so there is no window
 *    between the question and the write.
 *
 * EEXIST therefore IS the collision signal, and the loop simply advances to
 * the next candidate name.
 */
export async function writeDecrypted(destDir: string, name: string, plaintext: Uint8Array): Promise<string> {
  const safeName = sanitizeFilename(name)
  await mkdir(destDir, { recursive: true })

  for (let n = 0; n < MAX_COLLISION_CANDIDATES; n += 1) {
    const targetPath = join(destDir, collisionCandidate(safeName, n))
    try {
      await writeFile(targetPath, plaintext as unknown as Uint8Array<ArrayBuffer>, { flag: 'wx' })
      return targetPath
    } catch (err) {
      // EEXIST: the name is taken (by a file, a directory, or a symlink —
      // O_EXCL does not care which, and does not follow it). Try the next.
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }

  throw new Error(`Could not find a free filename for "${safeName}" in ${destDir}`)
}
