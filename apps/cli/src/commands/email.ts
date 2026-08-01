import { parseShareUrl } from '@yafl/crypto'
import { ApiError, callApi, load } from '@yafl/client'
import type { CommandContext } from '../index.js'
import { AuthError, UsageError } from '../errors.js'

/**
 * `yafl email <url|code> <recipient>` — the client-side half of HAND-04:
 * resolves the id (full share URL or the compact `<id>#<key>` code, same
 * `parseShareUrl` path as `get`), reconstructs the full link byte-for-byte
 * when given the compact form, and POSTs to the 18-01 server route, which
 * owns every abuse control (verified-sender-only, per-account +
 * per-recipient rate limits, fixed template). This command never gates
 * locally — the route's 403/429 verdicts are surfaced verbatim
 * (T-18-10, 18-CONTEXT.md). NEVER prompts (agent-safe) and NEVER prints
 * the link or key in --json mode (T-18-08).
 */
export async function runEmail(ctx: CommandContext): Promise<number> {
  const [urlOrCode, recipient] = ctx.positionals
  if (!urlOrCode || !recipient) {
    throw new UsageError('yafl email <url|code> <recipient>: missing required argument(s)')
  }

  // parseShareUrl accepts either a full share URL or the compact
  // `<id>#<key>` code (same resolution `get` uses) — no per-command parsing
  // branch needed.
  const parsed = parseShareUrl(urlOrCode)
  const { id } = parsed

  // A full `/t/` URL is passed through unchanged; the compact form is
  // reconstructed against ctx.apiUrl — never re-encoded via buildShareUrl,
  // so v1 keys and v2 salts survive byte-for-byte in the fragment the route
  // re-validates.
  const fragment = urlOrCode.includes('#') ? urlOrCode.slice(urlOrCode.indexOf('#') + 1) : undefined
  const link = urlOrCode.includes('/t/') ? urlOrCode : `${ctx.apiUrl}/t/${id}#${fragment ?? ''}`

  const creds = await load({ env: ctx.env })
  if (!creds) {
    throw new AuthError('Not logged in. Run `yafl login` or set YAFL_API_KEY.')
  }

  const apiOptions = { apiUrl: ctx.apiUrl, apiKey: creds.apiKey }

  try {
    await callApi(apiOptions, `/api/v1/transfers/${id}/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient, link }),
    })
  } catch (err) {
    if (err instanceof ApiError && err.code === 'email_unverified') {
      // Soften the route's generic message into the CLI-specific copy the
      // plan locks (18-CONTEXT.md) — rethrown so run()'s central handler
      // still maps/prints it the same way as any other ApiError.
      throw new ApiError(err.code, 'your account must be verified to email links', err.status)
    }
    throw err
  }

  // NEVER include the link or key in any output — --json emits exactly
  // {"emailed":true,"recipient":...} and nothing else (T-18-08).
  if (ctx.json) {
    ctx.print(JSON.stringify({ emailed: true, recipient }))
  } else {
    ctx.print(`Emailed the share link to ${recipient}.`)
    ctx.print(
      `This email contains the decryption key in the link – anyone with access to ${recipient}'s inbox can open the file.`,
    )
  }
  return 0
}
