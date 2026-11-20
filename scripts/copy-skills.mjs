#!/usr/bin/env node
// Copies the repo-root skills/ folder (the one source of YAFL's AI skills)
// into the folder given as the only argument, so a bundled MCP server finds
// it next to its own file (apps/mcp/src/skills.ts defaultSkillsDir()):
//   - apps/mcp/dist/skills      for the npm package (apps/mcp "build" script)
//   - dist-mcpb/server/skills   for the .mcpb bundle (scripts/build-mcpb.mjs)
// Wipes the target first so a removed skill never lingers in a bundle.
// Fails loud when skills/ or a SKILL.md is missing: a bundle without its
// skills is the silent failure this script exists to prevent.

import { cpSync, existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(__dirname, '..', 'skills')
const target = process.argv[2]

if (!target) {
  throw new Error('[copy-skills] usage: node scripts/copy-skills.mjs <target-dir>')
}
if (!existsSync(SOURCE)) {
  throw new Error(`[copy-skills] skills/ not found at ${SOURCE}`)
}
const names = readdirSync(SOURCE).filter((name) => existsSync(join(SOURCE, name, 'SKILL.md')))
if (names.length === 0) {
  throw new Error(`[copy-skills] no skills/<name>/SKILL.md found in ${SOURCE}`)
}

// Refuse symlinks: a copy would follow one and ship the file it points to,
// which skips the realpath containment check that the server applies at
// runtime (apps/mcp/src/skills.ts SkillCatalog.get).
function assertNoSymlinks(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      throw new Error(`[copy-skills] refusing symlink in skills/: ${path}`)
    }
    if (stat.isDirectory()) assertNoSymlinks(path)
  }
}
assertNoSymlinks(SOURCE)

const dest = resolve(target)
rmSync(dest, { recursive: true, force: true })
cpSync(SOURCE, dest, { recursive: true })
// stderr, not stdout: `npm pack --json` (scripts/publish-smoke.mjs) runs this
// through prepack and parses stdout as JSON.
console.error(`[copy-skills] copied ${names.length} skills (${names.join(', ')}) -> ${dest}`)
