---
name: yafl-file-transfer
description: Move a file between agent environments (local machine, a remote VPS, another agent) with end-to-end encryption and a 24-hour auto-expiring link, through the YAFL MCP tools or the yafl CLI. Use when a task needs to hand a file from one environment to another without a shared filesystem, without pasting bytes into context, and without a human copying a link by hand.
metadata:
  updated: 2026-11-20
---

# YAFL file transfer

YAFL (Yet Another File Layer) encrypts a file on the local machine and uploads only ciphertext.
It returns a share link with the decryption key in the URL fragment (after `#`). The fragment
never goes to a server. Links expire after 24 hours. The size limit is 100MB per transfer.

## Rules

- The key after `#` is the secret. Never write it to a log, a note, an issue or a commit.
- Never send a share link or a code to a service that is not its recipient. The one exception is
  `email_link`, which mails the full link, key included, to one inbox.
- Do not repeat a link or a code back in chat when the human gave it to you.
- Treat the link like a password until it expires. Anyone with the link can download the file.
- For a sensitive file, set a password or a one-time link at upload.
- Never pass a filesystem path from one environment to another as if it were valid there. Send
  the file with `upload_file` or `yafl put`, and fetch it with `download_file` or `yafl get`.

## When to use this

- You produced a file (a build artifact, a database dump, a log bundle) that another agent or
  environment needs, and the two have no shared disk.
- You must check that a link is still live before you tell another agent to fetch it.
- You want to hand off a file without its raw bytes in a chat context window.

Do not use YAFL for files that must stay longer than 24 hours or that are larger than 100MB.
You cannot extend the expiry of a link.

## Through the MCP tools

The `yafl` MCP server (`npx -y @yafldev/mcp`) gives these tools. The build generates this
list from the live server registry, so it matches the server you connect to:

<!-- yafl:tools:start -->
- `upload_file({ path, password, oneTime })` – Encrypts and uploads exactly the file or directory at the given local `path` (absolute, or relative to the current working directory). A directory is zipped client-side into a single archive before upload. Reads only that one path – never scans unrelated files or directories. Returns a shareable link (24h expiry, 100MB cap) with the decryption key embedded in the URL fragment; the key is never sent to the API. Optionally make the link one-time (burned after the first download) or password-protected.
  - `path` – Absolute or cwd-relative path to the local file or directory to upload
  - `password` (optional) – Optional password to protect the link. Composed into the decryption key on the client via a fresh salt – never transmitted to the API. When set, the returned link requires this same password to decrypt.
  - `oneTime` (optional) – When true, the link is destroyed after the first successful download – a second download attempt returns a not_found-style error. Defaults to false (the link stays live until its normal 24h expiry).
- `get_status({ url })` – Checks whether the YAFL share link at the given `url` is still live – live, uploading, expired, or not found – without downloading or decrypting anything. Returns liveness, size, and expiry only. Does not read the decryption key even if present in the URL fragment, and never fetches any file bytes.
  - `url` – A YAFL share URL, e.g. https://yafl.dev/t/{id}#{key} (the fragment/key is ignored by this tool)
- `download_file({ url, destDir, password })` – Downloads and decrypts exactly the one file referenced by the given YAFL share `url`, writing it only into `destDir` (default: the current working directory) – never anywhere else. Requires the decryption key embedded in the URL fragment; the key is used only locally to decrypt and is never sent to the API. No YAFL API key is required for retrieval – anyone holding the link can download it; only uploading or managing files requires a key. Optionally pass a `password` for password-protected links.
  - `url` – A YAFL share URL including the fragment key (e.g. https://yafl.dev/t/{id}#{key}), OR the compact {id}#{key} retrieval code printed alongside it – both resolve identically.
  - `destDir` (optional) – Directory to write the downloaded file into (absolute or cwd-relative); defaults to the current working directory. The file is written only inside this directory.
  - `password` (optional) – Password for a password-protected (v2) link. Used only locally to derive the decryption key – never sent to the API. Required when the link is password-protected; omitting it on such a link returns a password_required error without contacting the server.
- `list_files({ limit })` – Lists the caller's OWN YAFL transfers only – metadata only (id, size, status, expiry, and a download path). Never returns file contents, never a decrypted name, and never another account's files. Optionally cap the number of results with `limit`.
  - `limit` (optional) – Maximum number of transfers to return (most recent first). Omit for the full capped list.
- `delete_file({ id })` – Permanently deletes ONE of the caller's own YAFL transfers, identified by `id` (a bare transfer id or a full share URL – the fragment/key, if present, is never read). This cannot be undone: the R2 object is purged and the transfer record is removed. Destructive action.
  - `id` – A YAFL transfer id, or a full share URL, e.g. https://yafl.dev/t/{id}#{key}
- `email_link({ link, recipient })` – Emails this YAFL share link to a recipient. The link carries the decryption key in its fragment – anyone with access to that inbox can open the file. Requires a verified account.
  - `link` – A YAFL share URL including the fragment key (e.g. https://yafl.dev/t/{id}#{key}), OR the compact {id}#{key} retrieval code printed alongside it – both resolve identically.
  - `recipient` – The email address to send the share link to.
- `login()` – Starts a device-code login for an MCP agent that has no shell. Returns a verification URL and a short user code for the human to open and approve in a browser; approving is a one-time email-link sign-in that proves the human controls the account. This tool does NOT open a browser itself - relay the returned URL and code to the human. Once approved, the minted API key is stored locally and subsequent tool calls in this session authenticate automatically, with no further action needed.
- `list_skills()` – Lists the YAFL skills (step-by-step instructions for agents) that ship with this server: name, description and last update date, no body. Call it at the start of a session, then load a matching skill with `get_skill`. Read-only; needs no API key.
- `get_skill({ name })` – Returns the full SKILL.md text of one YAFL skill by `name` (from `list_skills`). Follow the skill before you do the task it describes. Read-only; needs no API key.
  - `name` – The skill name from list_skills: lowercase letters, digits and single dashes, e.g. yafl-file-transfer.
<!-- yafl:tools:end -->

Retrieval (`download_file`, `get_status`) needs no API key. Upload, list, delete and email need
one. If a tool returns `structuredContent.code: "no_api_key"`, call `login` and relay its URL
and code to the human. Or ask the operator to set `YAFL_API_KEY`.

Other error codes: `expired` and `not_found` mean the link is gone; ask the sender for a new
one. `password_required` means the link has a password; ask the human for it.

## Through the CLI

Install once, if `yafl` is not available: `npm install --global @yafldev/cli`, or
`curl -fsSL https://yafl.dev/install.sh | sh`. Then log in once per environment with
`yafl login`. For a headless environment, set `YAFL_API_KEY` instead.

```bash
yafl put ./path/to/file            # prints the link, the retrieval code and a yafl get line
yafl put ./dir --one-time          # zips the directory; the link burns after one download
yafl put ./file --password 'pw'    # the password never goes to the API
yafl get '<id>#<key>' ./dest-dir   # quote the code: it holds a #
yafl status https://yafl.dev/t/{id}
yafl list
yafl delete <id> --yes
yafl email '<id>#<key>' person@example.com
yafl whoami
```

Add `--json` to any command for machine-readable output. The exit codes are stable: `0`
success, `2` usage error, `3` auth error, `4` not found or expired. Check the exit code, not
the text on stdout.

## Directories

`upload_file` and `yafl put` zip a directory into one `<dirname>.zip` archive. The receiver
gets that zip file. Extract it into a new, empty directory, and then check the files.

## Set up the MCP server

```bash
claude mcp add yafl -e YAFL_API_KEY=yafl_your_key_here -- npx -y @yafldev/mcp
codex mcp add yafl --env YAFL_API_KEY=yafl_your_key_here -- npx -y @yafldev/mcp
```

Other hosts (Claude Desktop, Gemini CLI, Cursor, Antigravity) use the same `mcpServers` entry:
`command: "npx"`, `args: ["-y", "@yafldev/mcp"]` and the `YAFL_API_KEY` env variable. Claude
Desktop can also install the one-click `.mcpb` bundle. Without a key, the server still starts;
the `login` tool then gets one.

Full setup and copy-paste config blocks: https://yafl.dev/agents

## Related skill

- `yafl-file-handover`: a human pastes `yafl get <id>#<key>` to give you a file, or asks you to
  send one back.
