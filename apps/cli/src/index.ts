import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiError } from '@yafl/client'
import { runLogin } from './commands/login.js'
import { runPut } from './commands/put.js'
import { runGet } from './commands/get.js'
import { runStatus } from './commands/status.js'
import { runWhoami } from './commands/whoami.js'
import { runList } from './commands/list.js'
import { runDelete } from './commands/delete.js'
import { runEmail } from './commands/email.js'
import { AuthError, UsageError } from './errors.js'

/** Everything a command needs — no command reaches into process.env/process.cwd directly (testability). */
export type CommandContext = {
  cwd: string
  env: NodeJS.ProcessEnv
  json: boolean
  apiUrl: string
  /** Positional args after the subcommand name, e.g. `yafl put <file>` -> ['<file>']. */
  positionals: string[]
  flags: Record<string, string | boolean | undefined>
  print: (line: string) => void
  printErr: (line: string) => void
  /** True only when stdout is a real interactive terminal — gates the get.ts save-as prompt (HAND-03). */
  isTTY: boolean
  /**
   * Asks `query` on stderr and resolves with the raw answer. Only ever
   * invoked from an interactive, non-`--json` path — a command must gate on
   * `ctx.isTTY && !ctx.json` before calling this, since the default
   * implementation constructs a real readline interface over process.stdin
   * and will block waiting for input.
   */
  prompt: (query: string) => Promise<string>
}

export type CommandFn = (ctx: CommandContext) => Promise<number>

/**
 * Subcommand-keyed dispatch table — a new subcommand (Phase 10: list,
 * delete) registers here without touching run()'s parsing/exit-code logic
 * at all.
 */
export const commands: Record<string, CommandFn> = {
  login: runLogin,
  put: runPut,
  get: runGet,
  status: runStatus,
  whoami: runWhoami,
  list: runList,
  delete: runDelete,
  email: runEmail,
}

export type RunOptions = {
  cwd: string
  env: NodeJS.ProcessEnv
  /** Defaults to process.stdout/stderr — injectable so tests never depend on global stdio. */
  stdout?: (line: string) => void
  stderr?: (line: string) => void
  /** Defaults to process.stdout.isTTY (coerced to boolean) — injectable so the interactive get.ts prompt is hermetically testable without a real terminal. */
  isTTY?: boolean
  /** Defaults to a real readline/promises prompt over process.stdin — injectable so tests can answer the prompt deterministically without a real terminal. */
  prompt?: (query: string) => Promise<string>
}

const DEFAULT_API_URL = 'https://yafl.dev'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Real interactive prompt: readline/promises over process.stdin, echoed on stderr — mirrors delete.ts's confirm prompt (createInterface, question, close in finally). Only ever constructed lazily, on the first call, so no command that never prompts ever touches stdin. */
const defaultPrompt = async (query: string): Promise<string> => {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return await rl.question(query)
  } finally {
    rl.close()
  }
}

/** Reads the CLI's own version from package.json — never hardcoded, so a version bump can't drift. */
function readVersion(): string {
  const pkgPath = join(__dirname, '..', 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
  return pkg.version
}

const USAGE = `Usage: yafl <command> [options]

Commands:
  login              Log in via device-flow and store an API key
  put <file|dir>     Encrypt and upload a file, or zip and upload a directory
  get <url|code> [dest]  Download and decrypt a file into [dest] (default: cwd);
                     accepts a full share URL or the compact <id>#<key> code
  status <url>       Check whether a share link is still live
  list               List your own transfers as a table
  delete <id|url>    Permanently delete one of your own transfers
  email <url|code> <recipient>  Email a share link to a recipient
  whoami             Show the stored key prefix and name

Global flags:
  --json             Machine-readable output
  --api-url <url>    API base URL (default https://yafl.dev, YAFL_API_URL env)
  --no-browser       Do not try to open a browser (login only)
  --yes, -y          Skip the confirm prompt (delete only)
  --password <pw>    Protect (put) or unlock (get) a password-protected link;
                      composed into the key locally, never sent to the API
  --one-time         (put only) Burn the link after the first successful
                      download; a second download attempt fails
  --version          Print the CLI version
  --help             Print this message

--json implies non-interactive: delete never prompts when --json is set, and
--password must be passed as a flag value — the CLI never prompts for it.`

/**
 * Parses argv, dispatches to the matching command, and centralizes
 * exit-code mapping (0 success, 1 unexpected, 2 usage, 3 auth,
 * 4 not-found/expired) so no individual command has to know its own exit
 * code beyond throwing the right error type / returning 0. `--version` and
 * `--help` are handled here, before any credential/network access, so the
 * publishable bin answers both from a clean directory with no stored key
 * and no network (the exact scenario scripts/publish-smoke.mjs exercises).
 */
export async function run(argv: string[], options: RunOptions): Promise<number> {
  const print = options.stdout ?? ((line: string) => process.stdout.write(`${line}\n`))
  const printErr = options.stderr ?? ((line: string) => process.stderr.write(`${line}\n`))

  let values: Record<string, string | boolean | undefined>
  let positionals: string[]
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean', default: false },
        'api-url': { type: 'string' },
        'no-browser': { type: 'boolean', default: false },
        yes: { type: 'boolean', short: 'y', default: false },
        password: { type: 'string' },
        'one-time': { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    })
    values = parsed.values as Record<string, string | boolean | undefined>
    positionals = parsed.positionals
  } catch (err) {
    printErr(err instanceof Error ? err.message : String(err))
    return 2
  }

  if (values.version) {
    print(readVersion())
    return 0
  }

  if (values.help) {
    print(USAGE)
    return 0
  }

  const [commandName, ...rest] = positionals
  if (!commandName) {
    printErr(USAGE)
    return 2
  }

  const command = commands[commandName]
  if (!command) {
    printErr(`yafl: unknown command "${commandName}". Run \`yafl --help\` for usage.`)
    return 2
  }

  const apiUrl = (values['api-url'] as string | undefined) ?? options.env.YAFL_API_URL ?? DEFAULT_API_URL

  const ctx: CommandContext = {
    cwd: options.cwd,
    env: options.env,
    json: Boolean(values.json),
    apiUrl,
    positionals: rest,
    flags: values,
    print,
    printErr,
    isTTY: options.isTTY ?? Boolean(process.stdout.isTTY),
    prompt: options.prompt ?? defaultPrompt,
  }

  try {
    return await command(ctx)
  } catch (err) {
    if (err instanceof UsageError) {
      printErr(err.message)
      return 2
    }
    if (err instanceof AuthError) {
      printErr(err.message)
      return 3
    }
    if (err instanceof ApiError) {
      printErr(err.message)
      if (err.code === 'unauthorized') return 3
      if (err.code === 'expired' || err.code === 'not_found') return 4
      return 1
    }
    printErr(err instanceof Error ? (err.stack ?? err.message) : String(err))
    return 1
  }
}
