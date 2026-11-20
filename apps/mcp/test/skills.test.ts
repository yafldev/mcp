// @vitest-environment node
/**
 * The AI skills in skills/<name>/SKILL.md (served as list_skills / get_skill,
 * apps/mcp/src/skills.ts). This file fails when:
 *   - a skill's frontmatter is invalid (name = folder, description 40-1024 chars, metadata.updated),
 *   - a skill names an MCP tool the server does not have,
 *   - a skill holds something that looks like a secret, or an em dash,
 *   - an unsafe name (path traversal, symlink out of skills/) finds a file,
 *   - the two tools are not available to a client without an API key.
 *
 * Adapted from the yafl monorepo's apps/mcp/test/skills.test.ts. The check
 * of the website copy (apps/web/public/skill/SKILL.md) stays there: this repo
 * holds no website.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { SkillCatalog, SKILL_NAME_PATTERN, defaultSkillsDir, parseFrontmatter } from '../src/skills.js'
import { getToolManifest } from '../src/toolManifest.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..')
const skillsDir = join(repoRoot, 'skills')
const catalog = new SkillCatalog(skillsDir)

/**
 * snake_case words in a skill that are NOT tool names: error codes the tools
 * return. Anything else in backticks that looks like `snake_case` or a call
 * `name(` must be a real tool.
 */
const NON_TOOL_WORDS = new Set(['no_api_key', 'password_required', 'not_found'])

/** Backticked spans outside fenced code blocks. */
function inlineCodeSpans(markdown: string): string[] {
  const withoutFences = markdown.replace(/^```[\s\S]*?^```/gm, '')
  return [...withoutFences.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])
}

/** Tool-like names in a skill: a bare `snake_case` span or a `name(` call shape. */
function namedTools(markdown: string): string[] {
  const names = new Set<string>()
  for (const span of inlineCodeSpans(markdown)) {
    const call = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\(/.exec(span)
    if (call) names.add(call[1])
    else if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(span)) names.add(span)
  }
  return [...names].filter((n) => !NON_TOOL_WORDS.has(n))
}

describe('skills/: frontmatter and content', () => {
  it('the catalog finds the skills, and each folder name is a valid skill name', () => {
    const names = catalog.names()
    expect(names).toContain('yafl-file-transfer')
    expect(names).toContain('yafl-file-handover')
    for (const name of names) expect(name).toMatch(SKILL_NAME_PATTERN)
  })

  it('every skill has name = folder, a 40-1024 char description and metadata.updated', () => {
    for (const name of catalog.names()) {
      const skill = catalog.get(name)!
      const meta = parseFrontmatter(skill.content)
      expect(meta.name, `${name}: frontmatter name`).toBe(name)
      expect(skill.description.length, `${name}: description length`).toBeGreaterThanOrEqual(40)
      expect(skill.description.length, `${name}: description length`).toBeLessThanOrEqual(1024)
      expect(skill.updated, `${name}: metadata.updated`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('every tool a skill names exists on the server', async () => {
    const tools = new Set((await getToolManifest()).map((t) => t.name))
    for (const name of catalog.names()) {
      const content = catalog.get(name)!.content
      const named = namedTools(content)
      expect(named.length, `${name} should name at least one tool`).toBeGreaterThan(0)
      for (const tool of named) {
        expect(tools.has(tool), `${name} names unknown tool ${tool}`).toBe(true)
      }
    }
  })

  it('no skill holds a secret or an em dash', () => {
    for (const name of catalog.names()) {
      const content = catalog.get(name)!.content
      // A real yafl_ API key is a 32-char nanoid; the placeholder yafl_your_key_here passes.
      expect(content, `${name}: API key`).not.toMatch(/yafl_[A-Za-z0-9-]{20,}/)
      // A real share key after # is a long base64url string; placeholders are <key> / {key} / ....
      expect(content, `${name}: share key`).not.toMatch(/#[A-Za-z0-9_-]{20,}/)
      expect(content, `${name}: private key`).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/)
      expect(content, `${name}: token`).not.toMatch(/\b(sk|ghp|gho|xox[abp])[-_][A-Za-z0-9]{16,}/)
      expect(content, `${name}: em dash`).not.toContain('—')
    }
  })

  it('from source, the default skills folder is the repo-root skills/', () => {
    expect(resolve(defaultSkillsDir())).toBe(resolve(skillsDir))
  })
})

describe('SkillCatalog: unsafe names find nothing', () => {
  let outside: string
  let fixture: SkillCatalog

  beforeAll(() => {
    // A skills/ folder with one real skill and one symlink that points out of it.
    outside = mkdtempSync(join(tmpdir(), 'yafl-skills-test-'))
    const dir = join(outside, 'skills')
    mkdirSync(join(dir, 'good-skill'), { recursive: true })
    writeFileSync(join(dir, 'good-skill', 'SKILL.md'), '---\nname: good-skill\ndescription: x\n---\nbody\n')
    mkdirSync(join(outside, 'secret'), { recursive: true })
    writeFileSync(join(outside, 'secret', 'SKILL.md'), 'outside skills/')
    symlinkSync(join(outside, 'secret'), join(dir, 'escape'))
    fixture = new SkillCatalog(dir)
  })

  afterAll(() => {
    rmSync(outside, { recursive: true, force: true })
  })

  it('a valid name inside skills/ is found', () => {
    expect(fixture.get('good-skill')?.content).toContain('body')
  })

  it('traversal, separators, dots, case and non-strings find nothing', () => {
    for (const name of ['../secret', '..', '.', '', 'good-skill/../good-skill', '/etc/passwd', 'Good-Skill', 'good--skill', 'good_skill', 'good-skill/', null, 42]) {
      expect(fixture.get(name), `name ${String(name)}`).toBeNull()
    }
  })

  it('a symlink that points out of skills/ finds nothing and is not listed', () => {
    expect(fixture.get('escape')).toBeNull()
    expect(fixture.names()).toEqual(['good-skill'])
  })

  it('a missing skills/ folder gives an empty list, not an error', () => {
    expect(new SkillCatalog(join(outside, 'does-not-exist')).list()).toEqual([])
  })
})

describe('list_skills / get_skill over MCP, with no API key', () => {
  let client: Client

  beforeAll(async () => {
    delete process.env.YAFL_API_KEY
    process.env.YAFL_API_URL = 'https://harness.invalid'
    const { createServer } = await import('../src/index.js')
    const server = createServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'skills-test-client', version: '0.1.0' })
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  })

  afterAll(async () => {
    await client.close()
  })

  it('the server instructions tell the agent to call list_skills and get_skill', () => {
    const instructions = client.getInstructions() ?? ''
    expect(instructions).toContain('list_skills')
    expect(instructions).toContain('get_skill')
  })

  it('both tools are listed and marked read-only', async () => {
    const { tools } = await client.listTools()
    for (const name of ['list_skills', 'get_skill']) {
      const tool = tools.find((t) => t.name === name)
      expect(tool, name).toBeDefined()
      expect(tool!.annotations?.readOnlyHint, name).toBe(true)
    }
  })

  it('list_skills answers name, description and updated, without the body', async () => {
    const result = await client.callTool({ name: 'list_skills', arguments: {} })
    expect(result.isError).toBeFalsy()
    const { skills } = result.structuredContent as { skills: Array<Record<string, unknown>> }
    expect(skills.map((s) => s.name)).toEqual(catalog.names())
    for (const skill of skills) {
      expect(Object.keys(skill).sort()).toEqual(['description', 'name', 'updated'])
    }
  })

  it('get_skill answers the full SKILL.md text', async () => {
    const result = await client.callTool({ name: 'get_skill', arguments: { name: 'yafl-file-transfer' } })
    expect(result.isError).toBeFalsy()
    const text = (result.content as Array<{ type: string; text: string }>)[0].text
    expect(text).toBe(readFileSync(join(skillsDir, 'yafl-file-transfer', 'SKILL.md'), 'utf-8'))
  })

  it('get_skill with an unsafe or unknown name answers an error, not a file', async () => {
    for (const name of ['../../package', 'no-such-skill']) {
      const result = await client.callTool({ name: 'get_skill', arguments: { name } })
      expect(result.isError, name).toBe(true)
      expect((result.structuredContent as { code: string }).code).toBe('not_found')
    }
  })
})
