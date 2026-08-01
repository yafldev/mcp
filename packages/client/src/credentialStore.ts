import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Local credential storage for the `yafl` CLI (and, later, any other local
 * consumer of a device-flow-minted key). The minted API key is written to
 * disk on the user's machine (T-08-01) — mode 0600, resolved through an
 * env override so tests (and power users) never touch the real
 * ~/.config/yafl.
 */

export type Credentials = {
  apiKey: string
  keyName: string
}

export type CredentialStoreOptions = {
  /** Defaults to process.env — injectable so tests never read the real environment. */
  env?: NodeJS.ProcessEnv
}

const CONFIG_FILE_NAME = 'config.json'

/** YAFL_CONFIG_DIR wins outright; else XDG_CONFIG_HOME/yafl; else ~/.config/yafl. */
function resolveConfigDir(env: NodeJS.ProcessEnv): string {
  if (env.YAFL_CONFIG_DIR) return env.YAFL_CONFIG_DIR
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'yafl')
  return join(homedir(), '.config', 'yafl')
}

/** The exact path save()/load() read and write — exposed so callers (and tests) can inspect it directly. */
export function configPathFor(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveConfigDir(env), CONFIG_FILE_NAME)
}

/**
 * Writes the credential file with mode 0600 (T-08-01) — owner read/write
 * only. `{ mode: 0o600 }` on `writeFile` sets the mode at creation; an
 * already-existing file with looser permissions is intentionally not
 * hardened here (a fresh login always recreates the file).
 */
export async function save(creds: Credentials, options: CredentialStoreOptions = {}): Promise<void> {
  const env = options.env ?? process.env
  const path = configPathFor(env)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 })
}

/**
 * Loads stored credentials. A set `YAFL_API_KEY` env var always wins over
 * the file (documented CLI/MCP precedence) — useful for CI/VPS agents that
 * inject a key via environment rather than running an interactive login.
 * Returns `undefined` when neither source has a key (auth gate — callers
 * map this to exit code 3).
 */
export async function load(options: CredentialStoreOptions = {}): Promise<Credentials | undefined> {
  const env = options.env ?? process.env
  if (env.YAFL_API_KEY) {
    return { apiKey: env.YAFL_API_KEY, keyName: 'env override' }
  }
  const path = configPathFor(env)
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as Credentials
  } catch {
    return undefined
  }
}

/**
 * Derives the public display prefix from a full `yafl_`-prefixed key —
 * the same first-8-chars-of-secret convention as
 * apps/server/src/lib/apiKey.ts's `generateApiKey`, computed client-side
 * since the device-token response never carries a separate prefix field.
 * `whoami` uses this to show identity without ever printing the full key
 * (T-08-02).
 */
export function keyPrefix(apiKey: string): string {
  const secret = apiKey.startsWith('yafl_') ? apiKey.slice('yafl_'.length) : apiKey
  return secret.slice(0, 8)
}
