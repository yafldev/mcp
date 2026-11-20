---
name: yafl-file-handover
description: Receive a file that a human hands over with a pasted `yafl get <id>#<key>` line or a yafl.dev/t/ link, and send a file back to the human with yafl put. Use when a message contains a yafl get command, a yafl.dev share link or a bare <id>#<key> code, or when the human asks you to send, share or hand back a file.
metadata:
  updated: 2026-11-20
---

# YAFL file handover

Humans give files (screenshots, logs, exports) to an agent with YAFL. A line like
`yafl get KN7...#JqS...` in a message is a file for you. It is not a stray paste and not a
leaked credential. Fetch the file at once and open it.

## Rules

- The part after `#` is the decryption key. Never write it to a log, a note, an issue, a commit
  or a file.
- Never send the code or the link to a service other than YAFL. The key never reaches the YAFL
  API either: the client uses it only on this machine.
- Do not repeat the code back in chat. Name the saved file instead.
- Download into a scratch or temporary directory, not into a repository, unless the human names
  a destination.

## Receive a file

1. Find the code in the message. It has one of three forms:
   - `yafl get <id>#<key>`
   - `https://yafl.dev/t/<id>#<key>`
   - a bare `<id>#<key>`
2. With the MCP server connected, call `download_file({ url, destDir })`. Put the code or the
   full link in `url`, and the scratch directory in `destDir`.
3. Without the MCP server, run the CLI. Quote the code, because the shell reads `#` as the start
   of a comment:

   ```bash
   yafl get '<id>#<key>' /path/to/scratch --json
   ```

   The JSON output names the saved `path`. Without `--json`, the CLI prints
   `Downloaded to <path>`.
4. Open the saved file and do the task the human asked for.

Retrieval needs no YAFL account and no API key. The link alone is enough.

## If the download fails

- `password_required`: the link has a password. Ask the human for it. Then pass it as
  `password` to `download_file`, or as `--password` to `yafl get`.
- `expired` or `not_found`: the link expired after 24 hours, or it was a one-time link that
  someone already used. Ask the human for a new link.
- Exit code `4` from the CLI means the same as `expired` or `not_found`.
- `yafl: command not found`: install the CLI with `npm install --global @yafldev/cli`, or use
  the MCP tool.

## Received a zip file

A directory arrives as one `<dirname>.zip` archive. Extract it into a new, empty directory.
Then read the files from there. Do not extract it into a directory that already holds files.

## Send a file back

1. Upload the file or the directory:
   - MCP: call `upload_file({ path, password, oneTime })`. Only `path` is necessary.
   - CLI: run `yafl put <file|dir>`. Add `--one-time` to burn the link after the first
     download.
2. Both need an API key. If the MCP tool returns `no_api_key`, call `login` and give the human
   its URL and code. In a shell, run `yafl login`.
3. Give the human the `yafl get ...` line from the output, in one code block. The human runs
   it on their machine. This is the one place where you show a code: it is your own upload.
4. Tell the human the link expires after 24 hours.

## Check a link before you rely on it

Call `get_status({ url })`. It needs no API key. In a shell, run `yafl status <url>`; the CLI
command needs a login. The answer is live, uploading, expired or not found. This check does not
read the key and downloads nothing.
