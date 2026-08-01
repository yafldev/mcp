# yafl

The command-line client for [YAFL](https://yafl.dev), an agent-first, end-to-end-encrypted
file-transfer layer. Log in once, then move an encrypted, auto-expiring file with a single
command, no clone and no build step.

## Install

```bash
npm i -g @yafldev/cli
```

## Quickstart

```bash
yafl login
```

This prints a verification URL and a short code, tries to open your browser automatically, and
polls until you approve it there. Approving needs a YAFL account with a verified email – signing
in with an email link verifies you by construction. The minted API key is stored locally (mode 0600).

```bash
yafl put ./report.pdf
```

Encrypts the file locally and prints a share link (24h expiry, 100MB cap). The decryption key
lives only in the URL fragment (after `#`) and is never sent to the server.

```bash
yafl get https://yafl.dev/t/{id}#{key} ./downloads
```

Resolves the link, downloads the ciphertext, decrypts it locally, and writes the original file
into the given directory (default: the current directory).

```bash
yafl status https://yafl.dev/t/{id}#{key}
yafl whoami
```

`status` checks whether a link is still live, expired, or not found. `whoami` prints your
stored key's prefix and name only; the full key is never printed by any command.

## Global flags

- `--json` – machine-readable output for every command
- `--api-url <url>` – override the API base (default `https://yafl.dev`, or `YAFL_API_URL`)
- `--no-browser` – skip the automatic browser open during `login`
- `--version`, `--help`

`yafl login --json` is NDJSON, not a single object: one JSON object per stdout line, in order.
An agent can `JSON.parse` each line and switch on `status`:

```
{"status":"pending","verificationUri":"...","userCode":"WXYZ-2345","verificationUriComplete":"..."}
{"status":"ok","keyName":"..."}
```

Every other command still prints a single JSON object under `--json`.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Unexpected error |
| 2 | Usage error (unknown command or missing argument) |
| 3 | Auth error (not logged in, or an invalid/revoked key) |
| 4 | Not found or expired transfer |

## Configuration

The stored credential lives at `~/.config/yafl/config.json` by default. Override the directory
with `YAFL_CONFIG_DIR` or `XDG_CONFIG_HOME`. Setting `YAFL_API_KEY` in the environment always
wins over the stored file – useful for CI or a headless agent that injects a key directly.

## Security note

All encryption and decryption happen locally, inside this process – YAFL's server and storage
never see plaintext file contents or the decryption key.
