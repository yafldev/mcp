import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * The AI skills of YAFL: `skills/<name>/SKILL.md` at the repo root, in the
 * Agent Skills format (YAML frontmatter with name, description and
 * metadata.updated, then the instructions). This module serves them as the
 * read-only MCP tools `list_skills` and `get_skill`, so every agent that
 * connects the MCP gets the skills of the installed release.
 *
 * One source: `skills/` is the only hand-edited copy. The build copies it
 * next to each bundle (apps/mcp/dist/skills for npm, server/skills inside
 * the .mcpb), and scripts/gen-tool-list.mjs writes the public copy at
 * apps/web/public/skill/SKILL.md (https://yafl.dev/skill/SKILL.md).
 *
 * Rule: a change to an MCP tool, a CLI command or a flow updates the skill
 * that describes it in the same commit. apps/mcp/test/skills.test.ts fails
 * when a skill names a tool the server does not have. A skill never holds a
 * secret.
 */

/** A skill name: lowercase letters, digits and single dashes (the Agent Skills rule). */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface SkillSummary {
  name: string
  description: string
  updated: string | null
}

export interface Skill extends SkillSummary {
  content: string
}

/**
 * Where the skills live for the running code. From source (`.ts`, through
 * vitest or tsx) that is the repo-root `skills/`. From a bundle (`dist/index.js`
 * of the npm package, `server/index.mjs` of the .mcpb) it is the `skills/`
 * folder the build copied next to the bundle. The bundle never looks outside
 * its own folder, so an installed package cannot pick up an unrelated
 * `skills/` folder of the host project.
 */
export function defaultSkillsDir(): string {
  const file = fileURLToPath(import.meta.url)
  const here = dirname(file)
  return file.endsWith('.ts') ? join(here, '..', '..', '..', 'skills') : join(here, 'skills')
}

/** name, description and metadata.updated from the frontmatter (single-line values). */
export function parseFrontmatter(text: string): { name?: string; description?: string; updated?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  if (!match) return {}
  const out: { name?: string; description?: string; updated?: string } = {}
  for (const line of match[1].split(/\r?\n/)) {
    const top = /^(name|description):\s*(.+)$/.exec(line)
    if (top) {
      out[top[1] as 'name' | 'description'] = unquote(top[2])
      continue
    }
    const updated = /^\s+updated:\s*(.+)$/.exec(line)
    if (updated) out.updated = unquote(updated[1])
  }
  return out
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '')
}

export class SkillCatalog {
  constructor(private readonly dir: string = defaultSkillsDir()) {}

  /** The folder names that hold a SKILL.md, sorted. A missing skills/ folder gives an empty list. */
  names(): string[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter((name) => SKILL_NAME_PATTERN.test(name) && this.get(name) !== null)
      .sort()
  }

  /** Every skill without its body. */
  list(): SkillSummary[] {
    return this.names().map((name) => {
      const { content: _content, ...summary } = this.get(name)!
      return summary
    })
  }

  /**
   * One skill with its full SKILL.md text, or null. The name check stops
   * `..`, slashes and dots; realpath containment stops a symlink that points
   * out of skills/.
   */
  get(name: unknown): Skill | null {
    if (typeof name !== 'string' || !SKILL_NAME_PATTERN.test(name)) return null
    let root: string
    let file: string
    try {
      root = realpathSync(this.dir)
      file = realpathSync(join(this.dir, name, 'SKILL.md'))
    } catch {
      return null
    }
    if (!file.startsWith(root + sep) || !statSync(file).isFile()) return null
    const content = readFileSync(file, 'utf-8')
    const meta = parseFrontmatter(content)
    return {
      name,
      description: meta.description ?? '',
      updated: meta.updated ?? null,
      content,
    }
  }
}

/** The sentence every agent reads at initialize (the `instructions` field). */
export const SKILLS_INSTRUCTION =
  'Call list_skills at the start of a session; before a task that a skill describes, load it with get_skill and follow it.'

/**
 * Registers `list_skills` and `get_skill`. Both are read-only, need no API
 * key and make no network call, so every client gets them, with or without a
 * key. The catalog reads the disk at call time, so the tool list itself never
 * depends on skills/ (tools.json and the docs stay stable).
 */
export function registerSkillTools(server: McpServer, catalog: SkillCatalog = new SkillCatalog()): void {
  server.registerTool(
    'list_skills',
    {
      title: 'List Skills',
      description:
        'Lists the YAFL skills (step-by-step instructions for agents) that ship with this server: name, description and last update date, no body. Call it at the start of a session, then load a matching skill with `get_skill`. Read-only; needs no API key.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const skills = catalog.list()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ skills }, null, 2) }],
        structuredContent: { skills },
      }
    },
  )

  server.registerTool(
    'get_skill',
    {
      title: 'Get Skill',
      description:
        'Returns the full SKILL.md text of one YAFL skill by `name` (from `list_skills`). Follow the skill before you do the task it describes. Read-only; needs no API key.',
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(64)
          .describe('The skill name from list_skills: lowercase letters, digits and single dashes, e.g. yafl-file-transfer.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ name }) => {
      const skill = catalog.get(name)
      if (!skill) {
        const message = `No skill named "${name}". Call list_skills for the available names.`
        return {
          isError: true,
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { code: 'not_found', message },
        }
      }
      return {
        content: [{ type: 'text' as const, text: skill.content }],
        structuredContent: { ...skill },
      }
    },
  )
}
