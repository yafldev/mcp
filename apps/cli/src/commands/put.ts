import { resolve } from 'node:path'
import { buildLinkArtifacts } from '@yafl/crypto'
import { load, readDirOrFile, uploadEncrypted, MAX_TRANSFER_SIZE } from '@yafl/client'
import type { CommandContext } from '../index.js'
import { AuthError, UsageError } from '../errors.js'

/**
 * `yafl put <file|dir>` — thin glue over @yafl/client's transferPipeline
 * (readDirOrFile + uploadEncrypted, ARCH-02 part 2 of 2) and
 * @yafl/crypto's buildLinkArtifacts. A directory path is zipped
 * client-side (XFER-11) inside readDirOrFile as ONE pre-processing step
 * before the shared encrypt+upload pipeline runs; a single file path is
 * unchanged. This is byte-for-byte the same flow apps/mcp's upload_file
 * tool uses, sharing the pipeline instead of duplicating it.
 */
export async function runPut(ctx: CommandContext): Promise<number> {
  const [filePath] = ctx.positionals
  if (!filePath) {
    throw new UsageError('yafl put <file>: missing required <file> argument')
  }

  const creds = await load({ env: ctx.env })
  if (!creds) {
    throw new AuthError('Not logged in. Run `yafl login` or set YAFL_API_KEY.')
  }

  const absPath = resolve(ctx.cwd, filePath)
  const { bytes, metaName, metaType } = await readDirOrFile(absPath)

  if (bytes.byteLength > MAX_TRANSFER_SIZE) {
    throw new Error('File exceeds the 100MB limit')
  }

  const oneTime = ctx.flags['one-time'] === true
  // Encrypt locally — plaintext, the key, and the password (if any) never
  // leave this process (uploadEncrypted composes the key via composeKey,
  // the exact same composition apps/mcp's upload_file and the web UI use).
  const password = typeof ctx.flags.password === 'string' ? ctx.flags.password : undefined

  const apiOptions = { apiUrl: ctx.apiUrl, apiKey: creds.apiKey }

  const { id, key, salt, expiresAt, size } = await uploadEncrypted(apiOptions, {
    bytes,
    metaName,
    metaType,
    password,
    oneTime,
  })

  // A password composed a v2 link (salt in the fragment); otherwise the
  // exact v1 link shape (LKPW-01/LKPW-03/LKPW-04). buildLinkArtifacts
  // collapses the url/code/command builders into one call (HAND-01).
  const { url, code, command } = buildLinkArtifacts(ctx.apiUrl, id, salt ? { salt } : key)

  // The link, code, and command all carry the decryption key — never
  // logged, only ever emitted via ctx.print (the intended output channel).
  if (ctx.json) {
    ctx.print(JSON.stringify({ url, command, code, expiresAt, size }))
  } else {
    ctx.print(url)
    ctx.print(`Retrieval code – ${code}`)
    ctx.print(command)
  }
  return 0
}
