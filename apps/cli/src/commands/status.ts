import { parseShareUrl } from '@yafl/crypto'
import { ApiError, callApi, load } from '@yafl/client'
import type { CommandContext } from '../index.js'
import { AuthError, UsageError } from '../errors.js'

/**
 * `yafl status <url>` — the exact get_status flow
 * apps/mcp/src/tools/getStatus.ts uses: only the transfer id (path
 * segment) is used, the fragment/key is never read. expired/not_found are
 * expected polling states, not exceptions — this command reports them via
 * exit code 4 rather than crashing.
 */
export async function runStatus(ctx: CommandContext): Promise<number> {
  const [url] = ctx.positionals
  if (!url) {
    throw new UsageError('yafl status <url>: missing required <url> argument')
  }
  const { id } = parseShareUrl(url)

  const creds = await load({ env: ctx.env })
  if (!creds) {
    throw new AuthError('Not logged in. Run `yafl login` or set YAFL_API_KEY.')
  }

  const apiOptions = { apiUrl: ctx.apiUrl, apiKey: creds.apiKey }

  try {
    const meta = (await callApi(apiOptions, `/api/v1/transfers/${id}`)) as { size: number; expiresAt: string }
    if (ctx.json) {
      ctx.print(JSON.stringify({ status: 'live', size: meta.size, expiresAt: meta.expiresAt }))
    } else {
      ctx.print(`live (size: ${meta.size} bytes, expires: ${meta.expiresAt})`)
    }
    return 0
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'expired' || err.code === 'not_found')) {
      if (ctx.json) {
        ctx.print(JSON.stringify({ status: err.code }))
      } else {
        ctx.print(err.code === 'expired' ? 'expired' : 'not found')
      }
      return 4
    }
    throw err
  }
}
