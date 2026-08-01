import { resolve } from 'node:path'
import {
  load,
  resolveShareLink,
  downloadDecrypt,
  writeDecrypted,
  sanitizeFilename,
  MissingKeyError,
  PasswordRequiredError,
} from '@yafl/client'
import type { CommandContext } from '../index.js'
import { UsageError } from '../errors.js'

/**
 * `yafl get <url> [dest]` — thin glue over @yafl/client's transferPipeline
 * (resolveShareLink + downloadDecrypt + writeDecrypted, ARCH-02 part 2 of
 * 2), the exact download_file flow apps/mcp/src/tools/downloadFile.ts
 * shares. The decrypted name is untrusted input at write time, so
 * writeDecrypted sanitizes and collision-resolves it via the same
 * @yafl/client fsSafety logic before ever touching the filesystem.
 *
 * Retrieval never requires a YAFL account (anon-download follow-up): the
 * download-resolve route (GET /api/v1/transfers/:id,
 * apps/server/src/routes/transfers.ts) is deliberately public — the share
 * link itself is the credential. Credentials are loaded best-effort only;
 * when absent, callApi is called with no apiKey and simply omits the
 * Authorization header (packages/client/src/apiClient.ts). `put`/`login`/
 * `list`/`delete`/`status` are unaffected and stay auth'd.
 */
export async function runGet(ctx: CommandContext): Promise<number> {
  const [url, destDir] = ctx.positionals
  if (!url) {
    throw new UsageError(
      'yafl get <url|code> [dest]: missing required <url|code> argument (accepts a full share URL or the compact <id>#<key> code)',
    )
  }

  const password = typeof ctx.flags.password === 'string' ? ctx.flags.password : undefined

  // resolveShareLink accepts either a full share URL or the compact
  // `<id>#<key>` code emitted alongside it by `yafl put` (HAND-02) — no
  // per-command parsing branch needed, the id/key resolution is identical
  // either way. Both error paths below are raised before any network call
  // (load/callApi/fetch) — resolveShareLink's checks are pure fragment-string
  // parses (LKPW-02/LKPW-04).
  let id: string
  let key: Uint8Array
  try {
    ;({ id, key } = await resolveShareLink(url, password))
  } catch (err) {
    if (err instanceof MissingKeyError) {
      throw new Error(
        'yafl get requires a share URL or the compact <id>#<key> code with the decryption key (e.g. https://yafl.dev/t/{id}#{key} or {id}#{key})',
      )
    }
    if (err instanceof PasswordRequiredError) {
      throw new UsageError('yafl get: this link is password-protected — pass --password <pw> to decrypt it')
    }
    throw err
  }

  // Best-effort: retrieval works with zero stored credentials. When logged
  // out, creds is undefined and apiKey is omitted entirely (never sent as
  // "undefined") — the public resolve route accepts either.
  const creds = await load({ env: ctx.env })
  const apiOptions = { apiUrl: ctx.apiUrl, apiKey: creds?.apiKey }

  const { plaintext, meta } = await downloadDecrypt(apiOptions, id, key)

  const safeName = sanitizeFilename(meta.name)

  // HAND-03: prompt for a save-as name only at a real interactive terminal
  // with no explicit dest and no --json — never for an agent, a pipe, or a
  // machine-readable call, so nothing here ever blocks on stdin outside
  // that one narrow human-at-a-keyboard case (T-17-02). The prompted answer
  // is untrusted input, so it is re-sanitized below exactly like the
  // decrypted original filename before it ever reaches writeDecrypted
  // (T-17-01).
  let chosenName: string | undefined
  if (!destDir && ctx.isTTY && !ctx.json) {
    const answer = await ctx.prompt(`Save as? [${safeName}] `)
    const trimmed = answer.trim()
    if (trimmed) {
      chosenName = sanitizeFilename(trimmed)
    }
  }

  const targetDir = resolve(ctx.cwd, destDir ?? '.')
  const targetPath = chosenName
    ? await writeDecrypted(targetDir, chosenName, plaintext)
    : await writeDecrypted(targetDir, meta.name, plaintext)

  if (ctx.json) {
    ctx.print(JSON.stringify({ path: targetPath, size: plaintext.byteLength, contentType: meta.type }))
  } else {
    ctx.print(`Downloaded to ${targetPath}`)
  }
  return 0
}
