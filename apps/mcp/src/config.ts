import { z } from 'zod'

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
  YAFL_API_URL: z.string().default('https://yafl.dev'),
})

export type Config = z.infer<typeof envSchema>

export const config: Config = envSchema.parse(process.env)
