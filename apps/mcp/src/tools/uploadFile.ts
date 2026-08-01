import { z } from 'zod'
import { resolve } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildLinkArtifacts } from '@yafl/crypto'
import { ApiError, readDirOrFile, uploadEncrypted, MAX_TRANSFER_SIZE } from '@yafl/client'
import { config } from '../config.js'

/**
 * Registers `upload_file` on `server`. The description is deliberately
 * narrow (T-03-01, tool-poisoning mitigation, 03-RESEARCH.md Pitfall 5): it
 * names exactly the one local path this tool reads and rules out any
 * broader filesystem access. This is thin glue over @yafl/client's
 * transferPipeline (readDirOrFile + uploadEncrypted, ARCH-02 part 2 of 2)
 * and @yafl/crypto's buildLinkArtifacts — the same shared pipeline
 * apps/cli's put command consumes, so the encrypt+upload flow lives once.
 */
export function registerUploadFile(server: McpServer): void {
  server.registerTool(
    'upload_file',
    {
      title: 'Upload File',
      description:
        'Encrypts and uploads exactly the file or directory at the given local `path` (absolute, or relative to the current working directory). A directory is zipped client-side into a single archive before upload. Reads only that one path – never scans unrelated files or directories. Returns a shareable link (24h expiry, 100MB cap) with the decryption key embedded in the URL fragment; the key is never sent to the API. Optionally make the link one-time (burned after the first download) or password-protected.',
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('Absolute or cwd-relative path to the local file or directory to upload'),
        password: z
          .string()
          .optional()
          .describe(
            'Optional password to protect the link. Composed into the decryption key on the client via a fresh salt – never transmitted to the API. When set, the returned link requires this same password to decrypt.',
          ),
        oneTime: z
          .boolean()
          .optional()
          .describe(
            'When true, the link is destroyed after the first successful download – a second download attempt returns a not_found-style error. Defaults to false (the link stays live until its normal 24h expiry).',
          ),
      },
    },
    async ({ path, password, oneTime }) => {
      if (!config.YAFL_API_KEY) {
        const message =
          'No API key configured. Run `yafl login` (via @yafldev/cli) or set the YAFL_API_KEY environment variable.'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { code: 'no_api_key', message },
          isError: true,
        }
      }

      const absPath = resolve(process.cwd(), path)
      // A missing/unreadable path throws naturally here (e.g. ENOENT, via
      // readDirOrFile's internal stat) — let it propagate to the SDK's
      // default isError wrapping rather than inventing a client-side code
      // for a plain filesystem error.
      const { bytes, metaName, metaType } = await readDirOrFile(absPath)

      if (bytes.byteLength > MAX_TRANSFER_SIZE) {
        const message = 'File exceeds the 100MB limit'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { code: 'size_exceeded', message },
          isError: true,
        }
      }

      try {
        const apiOptions = { apiUrl: config.YAFL_API_URL, apiKey: config.YAFL_API_KEY }
        const { id, key, salt, expiresAt, size } = await uploadEncrypted(apiOptions, {
          bytes,
          metaName,
          metaType,
          password,
          oneTime: oneTime === true,
        })

        // A password composed a v2 link (salt in the fragment); otherwise
        // the exact v1 link shape (LKPW-01/LKPW-03/LKPW-04).
        // buildLinkArtifacts collapses the url/code/command builders into
        // one call (HAND-01) — so an agent can write the exact `yafl get`
        // command back to a human or another agent, no URL surgery
        // required.
        const { url, code, command } = buildLinkArtifacts(config.YAFL_API_URL, id, salt ? { salt } : key)
        const text = [
          `Uploaded. Share link: ${url}`,
          `Retrieval code: ${code}`,
          `Retrieval command: ${command}`,
          'The link/code carries the decryption key – anyone holding it can decrypt this file; it is never sent to the API.',
        ].join('\n')
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: { url, command, code, expiresAt, size },
        }
      } catch (err) {
        if (err instanceof ApiError) {
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
