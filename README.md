# YAFL — Yet Another File Layer (MCP server + CLI)

**Your AI agent moves files between machines with one MCP call — encrypted client-side, links gone in 24 hours.**

This repository is the open-source **MCP server and CLI client** for [YAFL](https://yafl.dev). Your agents (Claude Desktop, Claude Code, Cursor, any MCP client — including agents on remote VPSes) hand files across environments — laptop ↔ VPS, agent ↔ agent — with a single tool call, instead of a human dragging files into WeTransfer and copying links around. Files are encrypted on your machine before they leave it; the service only ever sees ciphertext.

> The client is open source so you can audit exactly what touches your files. The YAFL service lives at [yafl.dev](https://yafl.dev).

## Install

Add YAFL to your MCP client config:

```json
{
  "mcpServers": {
    "yafl": {
      "command": "npx",
      "args": ["-y", "@yafldev/mcp"],
      "env": { "YAFL_API_KEY": "<your key — or leave unset and run yafl login>" }
    }
  }
}
```

Works in Claude Desktop, Claude Code, Cursor, and any MCP client. Claude Desktop users can install the one-click [`.mcpb` bundle](https://yafl.dev/downloads/yafl.mcpb). Prefer the CLI:

```
curl -fsSL https://yafl.dev/install.sh | sh
```

No API key is required to start. On the first tool call the server returns a guided error pointing to `yafl login` — an RFC 8628 device flow: the agent shows a short code, you approve it in a browser, and the agent holds its own revocable key. Built for headless boxes. Runs via `npx` (Node.js 18+); no global install needed.

## Tools

| Tool | Call | What it does |
|---|---|---|
| `upload_file` | `{ path, password?, oneTime? }` | Encrypts client-side, uploads ciphertext, returns the share link. Zips a directory first. Optional password layer; optional one-time link that burns after the first download. |
| `download_file` | `{ url, destDir?, password? }` | Fetches, decrypts, writes the file to local disk. |
| `get_status` | `{ url }` | Checks liveness and remaining TTL — no bytes downloaded. |
| `list_files` | `{ limit? }` | The caller's own transfers, metadata only. |
| `delete_file` | `{ id \| url }` | Revoke one of your transfers before expiry. |
| `email_link` | `{ link, recipient }` | Email a share link straight to a recipient — the agent-to-human handoff without leaving the session. |
| `login` | device flow | Authorize this agent (RFC 8628); it holds its own revocable key. |
| `list_skills` | `{}` | Lists the YAFL skills (step-by-step instructions for agents) that ship with this server. Read-only, no API key. |
| `get_skill` | `{ name }` | Returns the full SKILL.md text of one skill. Read-only, no API key. |

Errors are stable and machine-readable — your agent gets `expired` or `not_found`, not a mystery 404.

## How encryption works

The file is encrypted with a fresh AES-256-GCM key before upload. The key travels only in the share URL's `#fragment` — browsers never send fragments to servers, so it is never transmitted to, logged by, or stored on any server. An optional link password adds a second derived layer the server never sees either, and a one-time link self-destructs after the first successful download. File bytes go directly to storage via pre-signed URLs; the app server never handles them, and storage only ever receives ciphertext. Access stops at 24 hours. Free tier: 100 MB per file.

## What happens if an agent's key leaks

The API key is not the decryption key. If a machine is compromised and its YAFL key is stolen, the attacker can at most see ciphertext metadata for that key's own transfers — file contents stay unreadable, because decryption keys exist only in the links you exchanged. Revoke the key and move on. This is why the recommended setup is one key per agent, per machine — keys are named and individually revocable.

## Links

- Website: https://yafl.dev
- MCP guide: https://yafl.dev/mcp
- Security / threat model: https://yafl.dev/security
- npm: [`@yafldev/mcp`](https://www.npmjs.com/package/@yafldev/mcp) · [`@yafldev/cli`](https://www.npmjs.com/package/@yafldev/cli)

## License

MIT — see [LICENSE](LICENSE).
