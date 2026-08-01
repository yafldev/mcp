import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from './index.js'

/**
 * One input parameter of a tool, sourced from its Zod `.describe()` text and
 * `.optional()` flag via the live JSON schema — the single source for per-param
 * semantics. Promoting this into the manifest (rather than leaving it stranded
 * in each tool's schema) is what lets every exhaustive discovery surface
 * document what `oneTime`/`password`/etc. actually do, not just their names.
 */
export interface ToolParam {
  name: string
  description: string
  optional: boolean
}

/** One entry in the canonical tool manifest — the single source every discovery surface renders from (HAND-05). */
export interface ToolInfo {
  name: string
  description: string
  /** Param names in registration order — the `name({ a, b })` call shape. Kept 1:1 with `paramDetails`. */
  params: string[]
  /** Per-param semantics (description + optionality), the single source the exhaustive surfaces render. */
  paramDetails: ToolParam[]
}

/**
 * Introspects the LIVE tool registry via the SDK's `listTools()` over an
 * in-memory transport (mirroring apps/mcp/test/getStatus.test.ts's
 * InMemoryTransport + Client pattern) — never by text-parsing source. This
 * is the single source of truth every generated discovery surface (tools.json,
 * llms-full.txt, and the three templated docs in Task 2) renders from, so a
 * renamed/added tool in createServer() flows through with no other edit
 * (17-02-PLAN.md Task 1). createServer() never connects a transport itself
 * and YAFL_API_KEY is optional (config.ts `.catch(undefined)`), so this
 * introspection needs no network access and no API key.
 */
export async function getToolManifest(): Promise<ToolInfo[]> {
  const server = createServer()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'yafl-tool-manifest-introspector', version: '0.1.0' })

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  try {
    const { tools } = await client.listTools()
    return tools.map((tool) => {
      const properties = tool.inputSchema.properties ?? {}
      const required = new Set<string>(
        Array.isArray(tool.inputSchema.required) ? (tool.inputSchema.required as string[]) : [],
      )
      // Per-param details come straight from the Zod schema the tool declared:
      // `.describe()` → the JSON-schema `description`, `.optional()` → absence
      // from `required`. Same em→en normalization as the tool description below.
      const paramDetails: ToolParam[] = Object.entries(properties).map(([name, schema]) => ({
        name,
        description: ((schema as { description?: string }).description ?? '').replace(/—/g, '–'),
        optional: !required.has(name),
      }))
      return {
        name: tool.name,
        // Normalize any em dash in a source tool description to an en dash —
        // a character-only substitution, meaning-preserving — so every
        // surface this manifest feeds (tools.json, llms-full.txt, and the
        // Task 2 templated docs) honors the project's en-dash-only copy
        // style without editing the individually-authored tool files.
        description: (tool.description ?? '').replace(/—/g, '–'),
        params: paramDetails.map((p) => p.name),
        paramDetails,
      }
    })
  } finally {
    await Promise.all([client.close(), server.close()])
  }
}

/**
 * Pure renderer: the canonical tools.json body. Stable order (registration
 * order, as returned by listTools()) and a trailing newline so re-running
 * the generator against an unchanged registry is byte-identical (Task 1
 * acceptance criteria). Interpolates no secrets — the manifest itself never
 * carries env/key values.
 */
export function renderToolsJson(manifest: ToolInfo[]): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/**
 * Renders a tool's params as indented markdown sub-bullets (plain-text
 * surfaces: llms-full.txt and SKILL.md). Empty string when the tool takes no
 * params, so a paramless tool renders as a single clean line. This is where
 * the promoted Zod `.describe()` text finally surfaces to agents.
 */
function renderParamLines(paramDetails: ToolParam[], indent: string): string {
  return paramDetails
    .map((p) => `${indent}- \`${p.name}\`${p.optional ? ' (optional)' : ''} – ${p.description}`)
    .join('\n')
}

/**
 * Pure renderer: the full llms-full.txt body — everything an agent needs
 * from one fetch (what YAFL is, install commands, the FULL generated tool
 * list, the REST endpoints, and the `yafl get <id>#<key>` retrieval form).
 * En dashes only, scoped package names only, never a secret.
 */
export function renderLlmsFull(manifest: ToolInfo[]): string {
  // AGNT-02: surface the one sanctioned E2EE caveat (email_link) where a
  // discovering agent reads first – the "Sharing safely" section below,
  // placed above ## Install so it is read before any tool call.
  const toolLines = manifest
    .map((tool) => {
      const paramsPart = tool.params.length > 0 ? `({ ${tool.params.join(', ')} })` : '()'
      const head = `- \`${tool.name}${paramsPart}\` – ${tool.description}`
      const paramLines = renderParamLines(tool.paramDetails, '  ')
      return paramLines ? `${head}\n${paramLines}` : head
    })
    .join('\n')

  return `# YAFL – llms-full.txt

YAFL (Yet Another File Layer) is an agent-first, end-to-end-encrypted file-transfer layer. An
agent hands a file to another agent or environment with one MCP tool call or one CLI command –
encrypted client-side before it leaves the machine, auto-expiring in 24 hours, with the app
server and storage only ever seeing ciphertext.

## Sharing safely

YAFL is end-to-end encrypted: the decryption key lives only in a share link's URL \`#fragment\`
(e.g. \`https://yafl.dev/t/{id}#{key}\`) and is never sent to any server. The one sanctioned
exception is \`email_link\`: it emails the share link including that fragment key, so the mail
provider and anyone with access to the recipient's inbox can decrypt the file – the key transits
the mail path for this one opt-in send. Prefer a password-protected link (compose a password on
upload) before emailing, so the emailed link alone is not sufficient to decrypt.

## Install

- MCP server: \`npx @yafldev/mcp\` (no clone, no build step; configure your MCP host's server
  list with \`command: npx\`, \`args: ["-y", "@yafldev/mcp"]\`, and a \`YAFL_API_KEY\` env var).
- CLI: \`npm i -g @yafldev/cli\` (bin \`yafl\`), or the one-liner
  \`curl -fsSL https://yafl.dev/install.sh | sh\` (checks for Node 20+, installs globally, no sudo).
- Full walkthrough with copy-paste config blocks: https://yafl.dev/agents

## MCP tools

${toolLines}

A missing API key never blocks startup – each tool call returns a guided \`no_api_key\` error
naming \`yafl login\` (via \`@yafldev/cli\`) and the \`YAFL_API_KEY\` environment variable.

## REST API

- \`POST /api/v1/transfers\` – returns a pre-signed upload URL.
- \`POST /api/v1/transfers/:id/complete\` – marks an upload complete.
- \`GET /api/v1/transfers/:id\` – resolves a download (or reports expired/not found).
- \`GET /api/v1/transfers\` – lists the caller's own transfers, metadata only.
- \`DELETE /api/v1/transfers/:id\` – permanently deletes one of the caller's own transfers.

Encrypt client-side before calling any endpoint – the server only ever stores ciphertext, and
the decryption key is never sent to it.

## Retrieval

Every upload returns a share link (\`https://yafl.dev/t/{id}#{key}\`) and a compact retrieval
command: \`yafl get <id>#<key>\`. The \`{key}\` (or \`#{salt}\` for a password-protected link)
lives only in the URL fragment and is never transmitted to any server – only the CLI or MCP
client reads it, locally, to decrypt.

## Links

- MCP config + CLI quickstart: https://yafl.dev/agents
- Skill file for agents that load skills instead of reading a web page: https://yafl.dev/skill/SKILL.md
- Concise version of this document: https://yafl.dev/llms.txt
- Privacy policy: https://yafl.dev/privacy/
`
}

/** The three discovery surfaces Task 2 templates off the canonical manifest. */
export type ToolSectionFormat = 'html' | 'llms' | 'skill'

/** Converts markdown-style `` `code` `` spans to HTML `<code class="inline">` spans (the 'html' format only). */
function mdInlineCodeToHtml(text: string): string {
  return text.replace(/`([^`]+)`/g, '<code class="inline">$1</code>')
}

/** The `name({ param, param })` call-shape shared by all three formats. */
function formatCall(tool: ToolInfo): string {
  const paramsPart = tool.params.length > 0 ? `({ ${tool.params.join(', ')} })` : '()'
  return `${tool.name}${paramsPart}`
}

/**
 * Pure renderer: the tool-enumeration fragment for one of the three
 * templated discovery surfaces (Task 2, 17-02-PLAN.md) — an HTML list for
 * /agents, a terse comma-separated inline list for llms.txt, and full
 * per-tool bullets (name + description) for SKILL.md. None of the three
 * embed a hand-written numeric tool-count phrase — the list length speaks
 * for itself. Secret-free, like the other renderers.
 */
export function renderToolSection(manifest: ToolInfo[], format: ToolSectionFormat): string {
  if (format === 'html') {
    const items = manifest
      .map(
        (tool) =>
          `  <li><code class="inline">${formatCall(tool)}</code> – ${mdInlineCodeToHtml(tool.description)}</li>`,
      )
      .join('\n')
    return `<ul class="plain-list">\n${items}\n</ul>`
  }

  if (format === 'llms') {
    return manifest.map((tool) => `\`${formatCall(tool)}\``).join(', ')
  }

  // 'skill' — one bullet per tool followed by its indented param sub-bullets,
  // so an agent loading the skill sees exactly what each param does (the
  // promoted `.describe()` text), not just the call shape.
  return manifest
    .map((tool) => {
      const head = `- \`${formatCall(tool)}\` – ${tool.description}`
      const paramLines = renderParamLines(tool.paramDetails, '  ')
      return paramLines ? `${head}\n${paramLines}` : head
    })
    .join('\n')
}

/** Exported so scripts/gen-seo-pages.mjs can guard the splice on marker presence without duplicating the literal (27-03-PLAN.md D-01a). */
export const TOOLS_MARKER_START = '<!-- yafl:tools:start -->'
export const TOOLS_MARKER_END = '<!-- yafl:tools:end -->'

/**
 * Pure text transform: rewrites ONLY the content between the paired
 * `yafl:tools:start` / `yafl:tools:end` HTML-comment markers in `doc` with
 * the freshly rendered tool section for `format`, preserving everything
 * outside the markers verbatim (quickstart copy, host-compat sections,
 * etc. — Task 2 acceptance criteria). Throws when the marker pair is
 * missing or malformed rather than silently leaving a doc unrewritten — a
 * build-time generator must fail loud on drift in its own scaffolding.
 */
export function replaceToolSection(doc: string, manifest: ToolInfo[], format: ToolSectionFormat): string {
  const startIndex = doc.indexOf(TOOLS_MARKER_START)
  const endIndex = doc.indexOf(TOOLS_MARKER_END)
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(
      `replaceToolSection: could not find a valid ${TOOLS_MARKER_START} / ${TOOLS_MARKER_END} marker pair`,
    )
  }

  const before = doc.slice(0, startIndex + TOOLS_MARKER_START.length)
  const after = doc.slice(endIndex)
  const section = renderToolSection(manifest, format)
  return `${before}\n${section}\n${after}`
}
