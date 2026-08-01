import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { parseShareUrl } from '@yafl/crypto'
import { callApi, ApiError } from '@yafl/client'
import { config } from '../config.js'

/**
 * Registers `email_link` on `server`. Emails an existing YAFL share link to
 * a recipient via the 18-01 server route, which owns every abuse control
 * (verified-sender-only, per-account + per-recipient rate limits, fixed
 * template). This tool never gates locally — the route's 403/429 verdicts
 * are surfaced verbatim (T-18-10, 18-CONTEXT.md).
 *
 * LOCKED E2EE tradeoff (18-CONTEXT.md, approved by Marcus 2026-07-09): the
 * full link (including its #key) is handed to the server for this one
 * opt-in send; the server holds it in memory only, never logs or stores it.
 * The proper fix (keep the key off the server) is backlogged in
 * PROJECT.md ("Email-a-link E2EE hardening") — not attempted this phase.
 */
export function registerEmailLink(server: McpServer): void {
  server.registerTool(
    'email_link',
    {
      title: 'Email a Share Link',
      description:
        'Emails this YAFL share link to a recipient. The link carries the decryption key in its fragment – anyone with access to that inbox can open the file. Requires a verified account.',
      inputSchema: {
        link: z
          .string()
          .min(1)
          .describe(
            'A YAFL share URL including the fragment key (e.g. https://yafl.dev/t/{id}#{key}), OR the compact {id}#{key} retrieval code printed alongside it — both resolve identically.',
          ),
        recipient: z.string().min(1).describe('The email address to send the share link to.'),
      },
    },
    async ({ link, recipient }) => {
      if (!config.YAFL_API_KEY) {
        const message =
          'No API key configured. Run `yafl login` (via @yafldev/cli) or set the YAFL_API_KEY environment variable.'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { code: 'no_api_key', message },
          isError: true,
        }
      }

      const parsed = parseShareUrl(link)
      const { id } = parsed

      // A full `/t/` URL is passed through unchanged; the compact `<id>#<key>`
      // form is reconstructed against the configured API host — never
      // re-encoded via buildShareUrl, so v1 keys and v2 salts survive
      // byte-for-byte in the fragment the route re-validates.
      const fragment = link.includes('#') ? link.slice(link.indexOf('#') + 1) : undefined
      const fullLink = link.includes('/t/') ? link : `${config.YAFL_API_URL}/t/${id}#${fragment ?? ''}`

      try {
        await callApi({ apiUrl: config.YAFL_API_URL, apiKey: config.YAFL_API_KEY }, `/api/v1/transfers/${id}/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient, link: fullLink }),
        })

        // NEVER include the link or key in any returned field — success
        // output is exactly {emailed:true,recipient} (T-18-08).
        return {
          content: [{ type: 'text' as const, text: `Emailed the share link to ${recipient}.` }],
          structuredContent: { emailed: true as const, recipient },
        }
      } catch (err) {
        if (err instanceof ApiError) {
          // Machine-parseable code mirroring the route's own error contract —
          // never invent a new code here (email_unverified, rate_limited,
          // invalid_link, validation_failed all pass through verbatim).
          return {
            content: [{ type: 'text' as const, text: err.message }],
            structuredContent: { code: err.code, message: err.message },
            isError: true,
          }
        }
        throw err // truly unexpected — let the SDK's default wrapping handle it
      }
    },
  )
}
