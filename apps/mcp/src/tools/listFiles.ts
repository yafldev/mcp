import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { callApi, ApiError } from '@yafl/client'
import { config } from '../config.js'

type TransferListItem = {
  id: string
  size: number | null
  status: string
  createdAt: string
  expiresAt: string
  downloadPath: string
  encryptedMeta: string
}

/**
 * Registers `list_files` on `server`. Metadata-only — never reads or
 * decrypts file contents. The description is deliberately narrow (T-03-08
 * precedent, tool-poisoning mitigation): it names exactly what is returned
 * (the caller's own transfers, metadata only) and rules out anything
 * broader (another account's files, file contents, decrypted names).
 */
export function registerListFiles(server: McpServer): void {
  server.registerTool(
    'list_files',
    {
      title: 'List Files',
      description:
        "Lists the caller's OWN YAFL transfers only — metadata only (id, size, status, expiry, and a download path). Never returns file contents, never a decrypted name, and never another account's files. Optionally cap the number of results with `limit`.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Maximum number of transfers to return (most recent first). Omit for the full capped list.'),
      },
    },
    async ({ limit }) => {
      if (!config.YAFL_API_KEY) {
        const message =
          'No API key configured. Run `yafl login` (via @yafldev/cli) or set the YAFL_API_KEY environment variable.'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { code: 'no_api_key', message },
          isError: true,
        }
      }

      try {
        const transfers = (await callApi({ apiUrl: config.YAFL_API_URL, apiKey: config.YAFL_API_KEY }, '/api/v1/transfers')) as TransferListItem[]
        const items = typeof limit === 'number' ? transfers.slice(0, limit) : transfers
        return {
          content: [{ type: 'text' as const, text: `${items.length} transfer(s).` }],
          structuredContent: { transfers: items },
        }
      } catch (err) {
        if (err instanceof ApiError && err.code === 'email_unverified') {
          const message = 'Verify your email to list your transfers.'
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
