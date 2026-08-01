# Installing the YAFL MCP server (instructions for an AI agent)

You are helping a user add the YAFL MCP server to their MCP client. Follow these steps.

1. Add this server to the user's MCP configuration (Claude Desktop `claude_desktop_config.json`, Cline's MCP settings, Cursor, or the client's `.mcp.json`):

```json
{
  "mcpServers": {
    "yafl": {
      "command": "npx",
      "args": ["-y", "@yafldev/mcp"]
    }
  }
}
```

2. Do not ask the user for an API key up front — none is required to begin. On the first tool call the server returns a message instructing the user to run `yafl login`, which starts a device-flow authorization: the server prints a short code and a URL, the user opens the URL and enters the code to approve, and the agent then holds its own revocable key.

3. Verify the install by calling `get_status` or `list_files`. A successful response — or a guided `login` prompt — confirms the server is wired correctly.

Notes:
- The server runs via `npx -y @yafldev/mcp` (Node.js 18+). No global install is needed.
- Files are encrypted client-side before upload and links expire in 24 hours. Recommend one key per agent/machine — keys are individually revocable.
