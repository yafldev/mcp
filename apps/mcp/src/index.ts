#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
// Side-effect import only — triggers config.ts's fail-fast zod parse of
// YAFL_API_KEY/YAFL_API_URL at process startup, before anything else runs.
import './config.js'
import { registerUploadFile } from './tools/uploadFile.js'
import { registerGetStatus } from './tools/getStatus.js'
import { registerDownloadFile } from './tools/downloadFile.js'
import { registerListFiles } from './tools/listFiles.js'
import { registerDeleteFile } from './tools/deleteFile.js'
import { registerEmailLink } from './tools/emailLink.js'
import { registerLogin } from './tools/login.js'

/**
 * Builds and registers the yafl-mcp server without connecting a transport,
 * so tests can attach an InMemoryTransport instead of stdio
 * (03-RESEARCH.md Pattern 3).
 */
export function createServer(): McpServer {
  const server = new McpServer({ name: 'yafl-mcp', version: '0.1.0' })
  registerUploadFile(server)
  registerGetStatus(server)
  registerDownloadFile(server)
  registerListFiles(server)
  registerDeleteFile(server)
  registerEmailLink(server)
  registerLogin(server)
  return server
}

/**
 * Builds the server and connects stdio. Exported (not just called
 * conditionally below) so `bin/yafl-mcp.js` — the built entry Claude
 * Desktop actually spawns via `command: node` — can invoke it explicitly.
 * A bin wrapper importing this module has `process.argv[1]` pointing at
 * the *wrapper's own* path, not this file's, so the historical
 * `import.meta.url === file://process.argv[1]` guard below would never
 * fire for that spawn shape; exporting `main` makes the built artifact
 * actually start the stdio server regardless of which script invoked it
 * (03-02-PLAN.md Task 3 — the deterministic `node`-spawned entry).
 */
export async function main(): Promise<void> {
  const server = createServer()
  // stdio IS the transport — never write to stdout except via the MCP
  // protocol itself. Any diagnostic logging must go to stderr only.
  //
  // One-line stderr hint so a human who runs `npx @yafldev/mcp` directly in a
  // terminal understands the "silence" is the server working, not a hang: an
  // MCP stdio server sits reading JSON-RPC from stdin, waiting for its host.
  // stderr is never part of the protocol stream, so this cannot corrupt it.
  process.stderr.write(
    'YAFL MCP server running on stdio. This is not a hang - it waits for an MCP host ' +
      '(Claude Desktop, Codex, etc.) to connect over stdin. Configure it in your host; ' +
      'see https://yafl.dev/agents. Set YAFL_API_KEY, or run `yafl login`.\n',
  )
  await server.connect(new StdioServerTransport())
}

// Only auto-run main() when this module is the process entry point (e.g.
// `node dist/index.js` directly, or `tsx src/index.ts` in dev) — not when
// imported by tests (which import `createServer` directly instead) and not
// when imported by `bin/yafl-mcp.js` (which calls the exported `main`
// above itself).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
    process.exit(1)
  })
}
