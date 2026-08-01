import { z } from 'zod'
import { resolve } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  ApiError,
  MissingKeyError,
  PasswordRequiredError,
  resolveShareLink,
  downloadDecrypt,
  writeDecrypted,
} from '@yafl/client'
import { config } from '../config.js'

/**
 * Registers `download_file` on `server`. Resolves the link, downloads the
 * ciphertext directly from R2, decrypts locally using only the fragment
 * key, and writes the result safely into `destDir` (MCP-02). The
 * description is deliberately narrow (T-03-08, tool-poisoning mitigation):
 * it names exactly the one url acted on and the one destDir written to.
 * This is thin glue over @yafl/client's transferPipeline (resolveShareLink
 * + downloadDecrypt + writeDecrypted, ARCH-02 part 2 of 2) — the same
 * shared pipeline apps/cli's get command consumes, so the resolve/download/
 * decrypt flow lives once.
 *
 * No API key required (anon-download follow-up): the download-resolve route
 * this tool reads (GET /api/v1/transfers/:id,
 * apps/server/src/routes/transfers.ts) is deliberately public — the share
 * link itself is the credential. The pipeline's callApi omits the
 * Authorization header entirely when YAFL_API_KEY is unset
 * (packages/client/src/apiClient.ts), so this works unmodified with no key
 * configured at all. Only upload_file/list_files/delete_file (auth'd
 * routes) still require a key.
 */
export function registerDownloadFile(server: McpServer): void {
  server.registerTool(
    'download_file',
    {
      title: 'Download File',
      description:
        'Downloads and decrypts exactly the one file referenced by the given YAFL share `url`, writing it only into `destDir` (default: the current working directory) — never anywhere else. Requires the decryption key embedded in the URL fragment; the key is used only locally to decrypt and is never sent to the API. No YAFL API key is required for retrieval — anyone holding the link can download it; only uploading or managing files requires a key. Optionally pass a `password` for password-protected links.',
      inputSchema: {
        url: z
          .string()
          .min(1)
          .describe(
            'A YAFL share URL including the fragment key (e.g. https://yafl.dev/t/{id}#{key}), OR the compact {id}#{key} retrieval code printed alongside it — both resolve identically.',
          ),
        destDir: z
          .string()
          .optional()
          .describe(
            'Directory to write the downloaded file into (absolute or cwd-relative); defaults to the current working directory. The file is written only inside this directory.',
          ),
        password: z
          .string()
          .optional()
          .describe(
            'Password for a password-protected (v2) link. Used only locally to derive the decryption key — never sent to the API. Required when the link is password-protected; omitting it on such a link returns a password_required error without contacting the server.',
          ),
      },
    },
    async ({ url, destDir, password }) => {
      // Resolved BEFORE any callApi/transfer-fetch call — a v2 link with no
      // password yields password_required as a pure client-side signal, the
      // server is never consulted to reach this verdict (LKPW-02/LKPW-04).
      let id: string
      let key: Uint8Array
      try {
        ;({ id, key } = await resolveShareLink(url, password))
      } catch (err) {
        if (err instanceof MissingKeyError) {
          const message =
            'download_file requires a share URL or the compact {id}#{key} code with the decryption key in the fragment (e.g. https://yafl.dev/t/{id}#{key} or {id}#{key}); the key is never sent to the API'
          return {
            content: [{ type: 'text' as const, text: message }],
            structuredContent: { code: 'missing_key', message },
            isError: true,
          }
        }
        if (err instanceof PasswordRequiredError) {
          return {
            content: [{ type: 'text' as const, text: err.message }],
            structuredContent: { code: 'password_required', message: err.message },
            isError: true,
          }
        }
        throw err
      }

      try {
        const apiOptions = { apiUrl: config.YAFL_API_URL, apiKey: config.YAFL_API_KEY }
        const { plaintext, meta } = await downloadDecrypt(apiOptions, id, key)

        // The decrypted name is untrusted input at write time (T-03-06) —
        // writeDecrypted sanitizes to a basename and resolves any collision
        // before writing.
        const targetDir = resolve(process.cwd(), destDir ?? '.')
        const targetPath = await writeDecrypted(targetDir, meta.name, plaintext)

        return {
          content: [{ type: 'text' as const, text: `Downloaded to ${targetPath}` }],
          structuredContent: {
            path: targetPath,
            size: plaintext.byteLength,
            contentType: meta.type,
          },
        }
      } catch (err) {
        if (err instanceof ApiError && (err.code === 'expired' || err.code === 'not_found')) {
          // Machine-parseable code mirroring the API's own error contract —
          // never invent a new code here (03-RESEARCH.md Pattern 2).
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
