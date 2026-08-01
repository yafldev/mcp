#!/usr/bin/env node
// Deterministic spawn entry for yafl-mcp. Claude Desktop (and any other MCP
// client) invokes this with "command": "node" — never "tsx"/"npx" — so it
// must never depend on those being resolvable in the host's spawn
// environment (03-RESEARCH.md Pitfall 3). Imports the *built* dist/index.js
// (produced by `npm run build`), never the TS source directly.
import { main } from '../dist/index.js'

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  process.exit(1)
})
