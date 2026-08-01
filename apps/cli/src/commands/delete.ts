import { createInterface } from 'node:readline/promises'
import { deleteTransfer, load } from '@yafl/client'
import { parseShareUrl } from '@yafl/crypto'
import type { CommandContext } from '../index.js'
import { AuthError, UsageError } from '../errors.js'

/** True when `input` looks like a YAFL share URL rather than a bare transfer id. */
function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test(input) || input.includes('/t/')
}

/** Extracts a transfer id from either a bare id or a full share URL — the fragment/key, if any, is never read. */
function resolveId(input: string): string {
  return looksLikeUrl(input) ? parseShareUrl(input).id : input
}

/**
 * `yafl delete <id|url> [--yes|-y] [--json]` — the delete_file MCP tool's
 * exact flow (MCPX-03 parity): resolve id -> DELETE /transfers/:id via
 * @yafl/client. Confirms by default on stderr; `--yes`/`-y` or `--json`
 * (agents always pass one of these) skips the prompt. A not_found ApiError
 * is intentionally left to propagate — run()'s central error mapping
 * (apps/cli/src/index.ts) already maps ApiError code 'not_found' to exit 4,
 * the same contract `status`/`get` already rely on.
 */
export async function runDelete(ctx: CommandContext): Promise<number> {
  const [idOrUrl] = ctx.positionals
  if (!idOrUrl) {
    throw new UsageError('yafl delete <id|url>: missing required <id|url> argument')
  }

  const creds = await load({ env: ctx.env })
  if (!creds) {
    throw new AuthError('Not logged in. Run `yafl login` or set YAFL_API_KEY.')
  }

  const id = resolveId(idOrUrl)
  const skipPrompt = Boolean(ctx.flags.yes) || ctx.json

  if (!skipPrompt) {
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    let answer: string
    try {
      answer = await rl.question(`Delete transfer ${id}? This cannot be undone. [y/N] `)
    } finally {
      rl.close()
    }
    if (!/^y(es)?$/i.test(answer.trim())) {
      ctx.print('Cancelled.')
      return 0
    }
  }

  const apiOptions = { apiUrl: ctx.apiUrl, apiKey: creds.apiKey }
  await deleteTransfer(apiOptions, id)

  if (ctx.json) {
    ctx.print(JSON.stringify({ ok: true, id }))
  } else {
    ctx.print(`Deleted ${id}.`)
  }
  return 0
}
