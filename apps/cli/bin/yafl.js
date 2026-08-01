#!/usr/bin/env node
// Deterministic spawn entry for yafl. A stranger's agent runs this via
// `npx @yafldev/cli` or a globally-installed `yafl` shim — never `tsx`/`npm
// run` — so it must never depend on those being resolvable at spawn time
// (mirrors apps/mcp/bin/yafl-mcp.js). Imports the *built* dist/index.js
// (produced by `npm run build`), never the TS source directly.
import { run } from '../dist/index.js'

run(process.argv.slice(2), { cwd: process.cwd(), env: process.env }).then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
    process.exitCode = 1
  },
)
