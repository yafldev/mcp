import { toBase64Url, fromBase64Url } from './base64url.js'

/**
 * Encodes the raw 256-bit key into a base64url string for carriage in the
 * URL hash fragment (`https://yafl.dev/t/{transferId}#{fragment}`). The
 * fragment is never sent in an HTTP request — browsers do not transmit the
 * URL fragment to the server — so this is the only place the key is ever
 * serialized for transport (CRYP-02, T-02-03).
 *
 * This is the v1 (passwordless) fragment shape — a bare base64url raw key,
 * with no version prefix. It is UNCHANGED by the v2 (password-protected)
 * addition below and stays the default for passwordless links (LKPW-03).
 */
export function keyToFragment(key: Uint8Array): string {
  return toBase64Url(key)
}

/** Inverse of `keyToFragment` — recovers the raw key bytes from the fragment string. */
export function keyFromFragment(fragment: string): Uint8Array {
  return fromBase64Url(fragment)
}

/** The v2 (password-protected) fragment's version namespace prefix. */
const V2_VERSION_PREFIX = '2.'

/**
 * Encodes a v2 fragment: `"2." + base64url(salt)`. The salt is a fresh
 * 256-bit secret (`crypto.getRandomValues`); the raw AES key never appears
 * in a v2 fragment — only the salt does, so the link alone cannot decrypt
 * without the password (LKPW-01). base64url never emits a literal `.`, so a
 * v2 fragment can never be confused with a v1 fragment (which never
 * contains one either).
 */
export function saltToFragment(salt: Uint8Array): string {
  return `${V2_VERSION_PREFIX}${toBase64Url(salt)}`
}

/** Options for the v2 (password-protected) `buildShareUrl` overload. */
export type V2ShareUrlOptions = { salt: Uint8Array }

/**
 * Builds the single shared share-URL shape used by both the MCP server
 * (Phase 3) and the web UI (Phase 4): `${origin}/t/{id}#{fragment}`. The key
 * (v1) or salt (v2) lives only in the fragment — this function is the one
 * place a share link is ever assembled, so every consumer agrees on the
 * exact format (CRYP-04).
 *
 * v1 (passwordless, 3-argument call with a raw `Uint8Array` key) is
 * UNCHANGED and stays byte-identical to before (LKPW-03). v2
 * (password-protected) is a new overload taking `{ salt }` in the same
 * position, emitting the `"2."`-prefixed salt fragment instead.
 */
export function buildShareUrl(origin: string, id: string, key: Uint8Array): string
export function buildShareUrl(origin: string, id: string, options: V2ShareUrlOptions): string
export function buildShareUrl(
  origin: string,
  id: string,
  keyOrOptions: Uint8Array | V2ShareUrlOptions,
): string {
  const fragment =
    keyOrOptions instanceof Uint8Array ? keyToFragment(keyOrOptions) : saltToFragment(keyOrOptions.salt)
  return `${origin}/t/${id}#${fragment}`
}

/**
 * Builds the compact retrieval code — the transfer id plus the SAME
 * fragment `buildShareUrl` produces, with the `${origin}/t/` prefix
 * removed: `<id>#<fragment>`. This is the one place the code is ever
 * assembled (mirroring `buildShareUrl`'s single-source-of-truth role for
 * the full URL) — `buildRetrievalCode(id, k)` is always byte-identical to
 * `buildShareUrl(origin, id, k)` minus its `${origin}/t/` prefix, because
 * both branch through the identical `keyToFragment`/`saltToFragment` calls.
 */
export function buildRetrievalCode(id: string, key: Uint8Array): string
export function buildRetrievalCode(id: string, options: V2ShareUrlOptions): string
export function buildRetrievalCode(id: string, keyOrOptions: Uint8Array | V2ShareUrlOptions): string {
  const fragment =
    keyOrOptions instanceof Uint8Array ? keyToFragment(keyOrOptions) : saltToFragment(keyOrOptions.salt)
  return `${id}#${fragment}`
}

/**
 * Builds the ready-to-paste retrieval command a recipient runs:
 * `yafl get <id>#<fragment>`. Delegates to `buildRetrievalCode` rather than
 * re-deriving the fragment, so the command and the code are always
 * identical beyond the `yafl get ` prefix.
 */
export function buildRetrievalCommand(id: string, key: Uint8Array): string
export function buildRetrievalCommand(id: string, options: V2ShareUrlOptions): string
export function buildRetrievalCommand(id: string, keyOrOptions: Uint8Array | V2ShareUrlOptions): string {
  // The cast is compile-time only: buildRetrievalCode's overloads don't
  // accept a union parameter directly, but its implementation branches on
  // `instanceof Uint8Array` at runtime regardless of the asserted type, so
  // this stays correct for both the v1 (key) and v2 ({ salt }) shapes.
  return `yafl get ${buildRetrievalCode(id, keyOrOptions as Uint8Array)}`
}

/**
 * Builds the `{ url, code, command }` triple in one call, collapsing the
 * `salt ? … : …` ternary previously duplicated in `apps/cli/src/commands/put.ts`
 * and `apps/mcp/src/tools/uploadFile.ts`. Delegates straight through to
 * `buildShareUrl` / `buildRetrievalCode` / `buildRetrievalCommand` — the
 * fragment itself is never re-derived here, so this stays byte-identical to
 * calling all three separately for both the v1 (raw key) and v2 (`{ salt }`)
 * shapes (HAND-01).
 */
export function buildLinkArtifacts(
  apiUrl: string,
  id: string,
  keyOrSalt: Uint8Array | V2ShareUrlOptions,
): { url: string; code: string; command: string } {
  // The cast is compile-time only, mirroring buildRetrievalCommand's own
  // pattern above: none of the three delegates' overloads accept a union
  // parameter directly, but each implementation branches on
  // `instanceof Uint8Array` at runtime regardless of the asserted type.
  return {
    url: buildShareUrl(apiUrl, id, keyOrSalt as Uint8Array),
    code: buildRetrievalCode(id, keyOrSalt as Uint8Array),
    command: buildRetrievalCommand(id, keyOrSalt as Uint8Array),
  }
}

/** Strict transfer-id charset (the nanoid alphabet YAFL mints ids from) — used to detect the bare compact form. */
const BARE_ID_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * Inverse of `buildShareUrl` — extracts the transfer `id` from the `/t/{id}`
 * path segment and, when a hash fragment is present, decodes it. A
 * fragment-less URL, or a v1 (bare base64url) fragment, resolves
 * synchronously with `needsPassword: false` — v1 behavior is byte-identical
 * to before this phase (LKPW-03). A fragment beginning with the `"2."`
 * version namespace is v2: this returns `needsPassword: true` and the
 * decoded `salt`, `key` left `undefined` — determined PURELY by parsing the
 * fragment string, with zero network/server calls (LKPW-01/LKPW-02). Any
 * other `"N."` version namespace throws a clear, named error so the version
 * namespace stays open for future formats without silently misparsing.
 *
 * Also accepts the bare compact form produced by `buildRetrievalCode` — no
 * scheme, no `/t/` path, just `<id>#<fragment>` or a bare `<id>` — detected
 * ONLY when the pre-fragment portion matches the strict id charset above
 * (T-16-02); anything with a scheme, slash, or other character still falls
 * through to the "missing /t/{id} segment" throw exactly as before, so a
 * malformed or scheme-bearing string is never silently coerced into a
 * spurious id.
 *
 * Throws a clear `Error` when the URL has no `/t/{id}` segment AND does not
 * match the bare compact form.
 */
export function parseShareUrl(url: string): {
  id: string
  key?: Uint8Array
  needsPassword: boolean
  salt?: Uint8Array
} {
  const [withoutFragment, fragment] = url.split('#')
  const match = withoutFragment.match(/\/t\/([^/?]+)/)
  let id: string
  if (match) {
    id = match[1]
  } else if (BARE_ID_PATTERN.test(withoutFragment)) {
    id = withoutFragment
  } else {
    throw new Error(`Not a valid YAFL share URL (missing /t/{id} segment): ${url}`)
  }

  if (!fragment) {
    return { id, needsPassword: false }
  }

  // base64url never emits a literal '.', so any fragment matching
  // `<digits>.<rest>` is unambiguously a versioned (non-v1) fragment.
  const versionMatch = fragment.match(/^(\d+)\.(.*)$/)
  if (versionMatch) {
    const [, version, rest] = versionMatch
    if (version === '2') {
      return { id, needsPassword: true, salt: fromBase64Url(rest) }
    }
    throw new Error(`Unsupported share-link fragment version "${version}." in URL: ${url}`)
  }

  return { id, key: keyFromFragment(fragment), needsPassword: false }
}
