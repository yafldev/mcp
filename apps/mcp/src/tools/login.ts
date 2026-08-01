import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  requestAndPoll,
  save,
  DeviceFlowExpiredError,
  DeviceFlowDeniedError,
  type DevicePrompt,
} from '@yafl/client'
import { config } from '../config.js'

/**
 * Registers `login` on `server` — the RFC 8628 device flow for a shell-less
 * MCP agent (Claude Desktop, a coding agent with no terminal). This is the
 * deliberate difference from apps/cli/src/commands/login.ts: it NEVER
 * imports `open` and never auto-opens a browser, since an MCP host has no
 * browser of its own. The tool returns {verificationUri, userCode} the
 * moment `requestAndPoll`'s onPrompt fires — before the poll loop even
 * starts — so the agent can relay a one-click link to the human without
 * blocking on approval.
 *
 * On approval, a detached background handler persists the minted key
 * through the shared credentialStore.save() (mode 0600) AND mutates the
 * in-process config.YAFL_API_KEY, so the same session's other tools
 * (upload_file, email_link, etc.) authenticate on their very next call with
 * no shell round-trip (T-24-02 in the threat register — the tool makes no
 * local trust decision; the key is only stored once the server's
 * magic-session-gated approve route has already marked the device
 * approved).
 */
export function registerLogin(server: McpServer): void {
  server.registerTool(
    'login',
    {
      title: 'Log In',
      description:
        'Starts a device-code login for an MCP agent that has no shell. Returns a verification URL and a short user code for the human to open and approve in a browser; approving is a one-time email-link sign-in that proves the human controls the account. This tool does NOT open a browser itself - relay the returned URL and code to the human. Once approved, the minted API key is stored locally and subsequent tool calls in this session authenticate automatically, with no further action needed.',
      inputSchema: {},
    },
    async () => {
      let promptResolve!: (prompt: DevicePrompt) => void
      const promptPromise = new Promise<DevicePrompt>((resolve) => {
        promptResolve = resolve
      })

      const flowPromise = requestAndPoll(config.YAFL_API_URL, {
        onPrompt: (prompt) => promptResolve(prompt),
      })

      // Detached background handler — NOT awaited by the tool call, so the
      // handler returns to the caller the moment the prompt is available.
      // On approval, stores the key and flips the in-process config so the
      // very next tool call in this session is authenticated. Every
      // terminal error (expired/denied/network) is swallowed here so the
      // stdio server never crashes and never leaks an unhandledRejection —
      // the human simply retries `login`. The error's message/stack is
      // NEVER logged (T-24-01 — it must never echo the api key, user code,
      // or device code).
      flowPromise
        .then(async (result) => {
          await save({ apiKey: result.apiKey, keyName: result.keyName }, { env: process.env })
          config.YAFL_API_KEY = result.apiKey
        })
        .catch((err) => {
          if (err instanceof DeviceFlowExpiredError || err instanceof DeviceFlowDeniedError) {
            // Expected terminal outcomes — the human simply retries `login`.
            return
          }
          // Any other failure (network error, unexpected server response)
          // during polling — swallowed for the same reason, never logged.
        })

      let prompt: DevicePrompt
      try {
        prompt = await Promise.race([
          promptPromise,
          // A failure BEFORE onPrompt fires (the device/code request
          // itself returned non-2xx) must surface here as an isError
          // result instead of hanging forever. A successful flow never
          // "wins" this branch: onPrompt always fires before
          // requestAndPoll's own resolution, so promptPromise always
          // settles first when the code request succeeds.
          flowPromise.then(
            (): Promise<never> => new Promise<never>(() => {}),
            (err): never => {
              throw err
            },
          ),
        ])
      } catch {
        const message = 'Could not start the device-code login (the code request failed). Try again.'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { code: 'device_code_failed', message },
          isError: true,
        }
      }

      const { verificationUri, userCode, verificationUriComplete } = prompt
      return {
        content: [
          {
            type: 'text' as const,
            text: `To finish logging in, open ${verificationUriComplete} (or visit ${verificationUri} and enter code ${userCode}), then sign in with a one-time email link.`,
          },
        ],
        structuredContent: { verificationUri, userCode },
      }
    },
  )
}
