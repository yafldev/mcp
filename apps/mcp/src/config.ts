import { z } from 'zod'
import { assertSecureApiUrl } from '@yafl/client'

/**
 * Env config, mirroring apps/server/src/config.ts's zod-parse-at-load
 * pattern for YAFL_API_URL. YAFL_API_KEY is intentionally NOT fail-fast
 * here (08-CONTEXT.md "MCP servers must not block interactively") — an MCP
 * client spawns this process and expects it to stay up even before the
 * user has run `yafl login`; a missing/blank key now parses to `undefined`
 * instead of throwing at import time, and each tool handler short-circuits
 * with a guided `no_api_key` structured error at call time instead
 * (apps/mcp/test/missingKey.test.ts).
 */
const envSchema = z.object({
  YAFL_API_KEY: z
    .string()
    .startsWith('yafl_', 'YAFL_API_KEY must be a yafl_-prefixed API key')
    .optional()
    .catch(undefined),
  // Scheme-checked, not just string-shaped (261113-sec finding 3): every
  // request to this origin carries either the bearer API key or a device-flow
  // secret, so a plain-http value would downgrade all of it to cleartext.
  // Loopback keeps plain http for local development. This one DOES fail fast
  // at import — unlike a missing API key, a misconfigured base URL has no
  // safe degraded mode, and failing at startup is how the MCP client's user
  // finds out before a key is sent anywhere.
  YAFL_API_URL: z
    .string()
    .default('https://yafl.dev')
    .transform((value, ctx) => {
      try {
        return assertSecureApiUrl(value)
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: (err as Error).message })
        return z.NEVER
      }
    }),
})

export type Config = z.infer<typeof envSchema>

export const config: Config = envSchema.parse(process.env)
