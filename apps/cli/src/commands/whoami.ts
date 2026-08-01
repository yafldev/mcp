import { keyPrefix, load } from '@yafl/client'
import type { CommandContext } from '../index.js'
import { AuthError } from '../errors.js'

/**
 * `yafl whoami` — prints only the stored key's prefix + name (T-08-02); the
 * full key never appears here or in any other command's output.
 */
export async function runWhoami(ctx: CommandContext): Promise<number> {
  const creds = await load({ env: ctx.env })
  if (!creds) {
    throw new AuthError('Not logged in. Run `yafl login` or set YAFL_API_KEY.')
  }

  const prefix = keyPrefix(creds.apiKey)

  if (ctx.json) {
    ctx.print(JSON.stringify({ prefix, name: creds.keyName }))
  } else {
    ctx.print(`${prefix} (${creds.keyName})`)
  }
  return 0
}
