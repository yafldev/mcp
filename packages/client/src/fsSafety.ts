import { existsSync } from 'node:fs'
import { join, extname, basename } from 'node:path'

/**
 * Filesystem-write safety helpers for `download_file`. Decrypted filenames
 * come from server-stored-but-server-unreadable metadata — untrusted input
 * at write time (T-03-06). No analog exists elsewhere in the repo; kept as
 * its own small, independently unit-tested module per 03-RESEARCH.md's
 * Don't Hand-Roll guidance.
 *
 * Canonical home for this logic (ARCH-02) — previously forked byte-identical
 * between apps/mcp/src/lib/fsSafety.ts and apps/cli/src/lib/fsSafety.ts.
 * Those app-side copies are deleted in 25-02 once both apps switch to this
 * package export; this plan is purely additive.
 */

const DEFAULT_FILENAME = 'download'

/**
 * Reduces `name` to a safe basename: strips everything up to and including
 * the last path separator (both POSIX `/` and Windows `\`, regardless of
 * host OS — the input is untrusted and must not be trusted to match the
 * host's own separator convention), then falls back to a safe default if
 * what remains is empty or made up entirely of `.` characters (which would
 * otherwise resolve to the current or parent directory rather than a file).
 */
export function sanitizeFilename(name: string): string {
  const withoutPath = name.split(/[\\/]/).pop() ?? ''
  const isAllDots = /^\.*$/.test(withoutPath)
  if (!withoutPath || isAllDots) {
    return DEFAULT_FILENAME
  }
  return withoutPath
}

/**
 * The n-th candidate name for `filename`: n=0 is the name itself, n>=1 is
 * `"<stem> (n)<ext>"` with the extension preserved and the suffix inserted
 * before it. Pure — it touches no filesystem, so a caller can hand each
 * candidate to an exclusive create and let the kernel decide whether the
 * name is free (see writeDecrypted).
 */
export function collisionCandidate(filename: string, n: number): string {
  if (n === 0) return filename
  const ext = extname(filename)
  const stem = basename(filename, ext)
  return `${stem} (${n})${ext}`
}

/**
 * Given an already-sanitized `filename`, returns a name guaranteed not to
 * collide with an existing entry in `destDir`: the name unchanged if free,
 * otherwise `"<stem> (n)<ext>"` with `n` incrementing from 1 until a free
 * name is found. The extension is preserved and the suffix is inserted
 * before it.
 *
 * NOTE: this answers "is the name free right now", which is a question whose
 * answer expires the moment it is given, and `existsSync` follows symlinks.
 * It is fine for previewing or reporting a name; it is NOT a safe gate for a
 * write. Writers use `collisionCandidate` plus an exclusive create instead —
 * see writeDecrypted in transferPipeline.ts.
 */
export function resolveCollision(destDir: string, filename: string): string {
  if (!existsSync(join(destDir, filename))) {
    return filename
  }

  const ext = extname(filename)
  const stem = basename(filename, ext)
  let n = 1
  let candidate: string
  do {
    candidate = `${stem} (${n})${ext}`
    n += 1
  } while (existsSync(join(destDir, candidate)))
  return candidate
}
