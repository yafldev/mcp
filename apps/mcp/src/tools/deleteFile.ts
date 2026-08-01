import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { parseShareUrl } from '@yafl/crypto'
import { callApi, ApiError } from '@yafl/client'
import { config } from '../config.js'

/** True when `input` looks like a YAFL share URL rather than a bare transfer id. */
function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test(input) || input.includes('/t/')
}

/** Extracts a transfer id from either a bare id or a full share URL — the fragment/key, if any, is never read. */
function resolveId(input: string): string {
  return looksLikeUrl(input) ? parseShareUrl(input).id : input
}

/**
 * Registers `delete_file` on `server`. Destructive and irreversible — the
 * description says so explicitly so an agent surfaces intent before
 * calling it (destructive-action note). The description is deliberately
 * narrow (T-03-08 precedent, tool-poisoning mitigation): it names exactly
 * the one transfer acted on and rules out any broader access.
 */
export function registerDeleteFile(server: McpServer): void {
  server.registerTool(
    'delete_file',
    {
      title: 'Delete File',
      description:
        "Permanently deletes ONE of the caller's own YAFL transfers, identified by `id` (a bare transfer id or a full share URL — the fragment/key, if present, is never read). This cannot be undone: the R2 object is purged and the transfer record is removed. Destructive action.",
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe('A YAFL transfer id, or a full share URL, e.g. https://yafl.dev/t/{id}#{key}'),
      },
    },
    async ({ id }) => {
      if (!config.YAFL_API_KEY) {
        const message =
          'No API key configured. Run `yafl login` (via @yafldev/cli) or set the YAFL_API_KEY environment variable.'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { code: 'no_api_key', message },
          isError: true,
        }
      }

      const transferId = resolveId(id)

      try {
        await callApi({ apiUrl: config.YAFL_API_URL, apiKey: config.YAFL_API_KEY }, `/api/v1/transfers/${transferId}`, { method: 'DELETE' })
        return {
          content: [{ type: 'text' as const, text: 'Deleted.' }],
          structuredContent: { ok: true as const },
        }
      } catch (err) {
        if (err instanceof ApiError && err.code === 'not_found') {
          // Expected state (not owned, already deleted, or never existed) —
          // mirrors getStatus's expired/not_found handling: not a tool
          // failure, so no isError here.
          return {
            content: [{ type: 'text' as const, text: err.message }],
            structuredContent: { status: 'not_found' as const, message: err.message },
          }
        }
        if (err instanceof ApiError && err.code === 'email_unverified') {
          const message = 'Verify your email to delete transfers.'
          return {
            content: [{ type: 'text' as const, text: message }],
            structuredContent: { code: 'email_unverified', message },
            isError: true,
          }
        }
        throw err // truly unexpected — let the SDK's default wrapping handle it
      }
    },
  )
}
