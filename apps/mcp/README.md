# @yafldev/mcp — the file-transfer MCP server

Move a file to another environment or another agent with **one tool call** — encrypted
end-to-end so the server never sees the contents, and auto-expiring in 24 hours.

`@yafldev/mcp` is a local stdio [MCP](https://modelcontextprotocol.io) server for
[YAFL](https://yafl.dev) (Yet Another File Layer), an agent-first, end-to-end-encrypted
file-transfer layer. Your agents write code, run builds, and deploy services — but the moment a
file has to cross machines (laptop ↔ VPS, agent ↔ agent) a human becomes the courier. This
removes that step.

- **End-to-end encrypted.** Files are encrypted client-side with AES-256-GCM before they leave
  the machine. The decryption key travels only in the share URL's `#fragment` and is never sent
  to any server. The app server never handles the bytes; storage holds ciphertext only.
- **Auto-expiring.** Links die after 24 hours (optionally one-time — burned on first download).
- **Agent-native.** Built for MCP clients and headless boxes: no browser step required, keys are
  scoped and revocable per agent.

## Add it to your MCP client

The fast path — no clone, no build:

```json
{
  "mcpServers": {
    "yafl": {
      "command": "npx",
      "args": ["-y", "@yafldev/mcp"],
      "env": { "YAFL_API_KEY": "yafl_your_key_here" }
    }
  }
}
```

Works in Claude Desktop, Claude Code, Cursor, Codex, Gemini CLI, and any MCP client. Claude
Desktop users can skip the JSON with the one-click [`.mcpb` bundle](https://yafl.dev/downloads/yafl.mcpb).
Full per-host setup: **[yafl.dev/agents](https://yafl.dev/agents)** · product page: **[yafl.dev/mcp](https://yafl.dev/mcp/)**.

No API key yet? The server still starts — each tool call returns a guided error pointing to
`yafl login` (an RFC 8628 device flow: the agent shows a code, you approve it in a browser, the
agent holds its own revocable key — built for headless boxes). Get the CLI with
`npm i -g @yafldev/cli`, or `curl -fsSL https://yafl.dev/install.sh | sh`.

## The tools

| Tool | Signature | What it does |
|------|-----------|--------------|
| `upload_file` | `{ path, password?, oneTime? }` | Encrypts + uploads the file (or a directory, zipped) at `path`; returns a share link with the key in the URL fragment. Optional link password (server never sees it) and one-time (burn-on-first-download) link. |
| `download_file` | `{ url, destDir?, password? }` | Resolves a share link, downloads the ciphertext straight from storage, decrypts it locally, and writes the original file into `destDir` (default: cwd). |
| `get_status` | `{ url }` | Checks whether a link is live / expired / not found — size and expiry only, no bytes downloaded. |
| `list_files` | `{ limit? }` | Lists the caller's OWN transfers, metadata only — never contents, never decrypted names. |
| `delete_file` | `{ id }` | Permanently deletes one of the caller's own transfers (bare id or full share URL). Destructive. |
| `email_link` | `{ link, recipient }` | Emails a share link to a recipient inbox. Requires a verified account. Note: this is the one sanctioned exception where the full link (incl. the fragment key) transits the mail path — prefer a password-protected link for sensitive files. |
| `login` | `{}` | Starts the device-flow login and returns `{ verificationUri, userCode }` for the human to approve; on approval the key is stored for the session. Lets an MCP-only agent onboard with no shell. |
| `list_skills` | `{}` | Lists the YAFL skills (step-by-step instructions for agents) that ship with this server: name, description and last update date. Read-only, no API key. |
| `get_skill` | `{ name }` | Returns the full SKILL.md text of one skill. Read-only, no API key. The skills live in `skills/<name>/SKILL.md` in the repo and ship inside the package. |

All encryption and decryption happen **locally, inside this process** — the YAFL server and
storage backend never see plaintext file contents or the decryption key. Errors are stable and
machine-readable (`expired`, `not_found`, `no_api_key`), not mystery 404s.

## Configuration

| Env var | Required | Default | Notes |
|---------|----------|---------|-------|
| `YAFL_API_KEY` | No (recommended) | — | Your key (starts with `yafl_`). Missing/blank is fine — the server starts and each tool returns a guided `no_api_key` error naming `yafl login`. |
| `YAFL_API_URL` | No | `https://yafl.dev` | Override the API base URL (self-host / staging). |

Get a key the easy way with `yafl login` (via [`@yafldev/cli`](https://www.npmjs.com/package/@yafldev/cli)),
or generate one from a verified account in the dashboard at [yafl.dev](https://yafl.dev).

## Security

Tool descriptions are written narrowly and explicitly (each names exactly the one file or link
it acts on) as a mitigation against MCP tool poisoning — a compromised co-located tool could
otherwise try to steer `upload_file` toward exfiltrating an unrelated local file. This cannot
fully stop a *fully compromised* agent from calling `upload_file` on any file it can already
read; the real backstops are scoped, revocable API keys and the fixed 24-hour link expiry. Treat
`YAFL_API_KEY` as a secret: never commit it, and revoke it if a host running this server is
compromised.

## Links

- Product page: [yafl.dev/mcp](https://yafl.dev/mcp/)
- Agent setup + all hosts: [yafl.dev/agents](https://yafl.dev/agents)
- CLI: [`@yafldev/cli`](https://www.npmjs.com/package/@yafldev/cli)
- Everything an agent needs in one fetch: [yafl.dev/llms.txt](https://yafl.dev/llms.txt)

## License

MIT
