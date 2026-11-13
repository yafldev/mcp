import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { parseShareUrl } from '@yafl/crypto'
import { callApi, ApiError } from '@yafl/client'
import { config } from '../config.js'

/**
 * Registers `get_status` on `server`. Metadata-only liveness check — never
 * downloads or decrypts anything (MCP-03). The description is deliberately
 * narrow (T-03-08, tool-poisoning mitigation): it names exactly the one link
 * acted on and rules out any broader access.
 *
 * No API key required (anon-download follow-up): this tool only ever reads
 * the same public download-resolve route (GET /api/v1/transfers/:id,
 * apps/server/src/routes/transfers.ts) that download_file does — callApi
 * omits the Authorization header entirely when apiKey is unset
 * (@yafl/client's packages/client/src/apiClient.ts), so liveness checks
 * work with no key configured at all.
 */
export function registerGetStatus(server: McpServer): void {
  server.registerTool(
    'get_status',
    {
      title: 'Get Transfer Status',
      description:
        'Checks whether the YAFL share link at the given `url` is still live — live, uploading, expired, or not found — without downloading or decrypting anything. Returns liveness, size, and expiry only. Does not read the decryption key even if present in the URL fragment, and never fetches any file bytes.',
      inputSchema: {
        url: z
          .string()
          .min(1)
          .describe('A YAFL share URL, e.g. https://yafl.dev/t/{id}#{key} (the fragment/key is ignored by this tool)'),
      },
    },
    async ({ url }) => {
      // Only the id (path segment) is used — the fragment/key is never read
      // for this tool, even when present in the URL (T-03-07).
      const { id } = parseShareUrl(url)
      try {
        const meta = (await callApi({ apiUrl: config.YAFL_API_URL, apiKey: config.YAFL_API_KEY }, `/api/v1/transfers/${id}`)) as {
          size: number | null
          expiresAt: string
          status?: 'pending' | 'uploaded'
        }
        // A resolvable link whose bytes are still streaming must NOT be
        // reported as live: an agent polling an async handoff would try to
        // download and fail. `size` is null until the upload completes (the
        // server writes R2's own report at /complete), so it is omitted rather
        // than guessed. `status` absent => an older server that only ever
        // resolved completed uploads, so the old 'live' answer still holds.
        if (meta.status === 'pending') {
          return {
            content: [{ type: 'text' as const, text: 'Uploading — the sender has not finished sending this file yet' }],
            structuredContent: { status: 'uploading' as const, expiresAt: meta.expiresAt },
          }
        }
        return {
          content: [{ type: 'text' as const, text: 'Live' }],
          structuredContent: { status: 'live' as const, size: meta.size, expiresAt: meta.expiresAt },
        }
      } catch (err) {
        if (err instanceof ApiError && (err.code === 'expired' || err.code === 'not_found')) {
          // Expired/not_found are expected polling states for async
          // agent-to-agent handoff (MCP-03) — not tool failures, so no
          // isError here (03-PLAN.md Task 1 acceptance criteria).
          return {
            content: [{ type: 'text' as const, text: err.message }],
            structuredContent: { status: err.code, message: err.message },
          }
        }
        throw err // truly unexpected — let the SDK's default wrapping handle it
      }
    },
  )
}
