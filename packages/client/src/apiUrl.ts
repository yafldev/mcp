/**
 * One shared check for the API base URL, used by both the CLI (`--api-url` /
 * `YAFL_API_URL`) and the MCP server (`YAFL_API_URL`).
 *
 * The point is the scheme. Everything that travels to this origin is a
 * credential: `Authorization: Bearer yafl_…` on every authenticated call, the
 * device_code and the minted API key during login. Over `http://` all of that
 * crosses the network in the clear, and nothing in the client would have
 * complained — `YAFL_API_URL` was a bare string, so a typo, a copied blog
 * snippet or a tampered MCP client config silently downgraded the transport.
 *
 * Plain http is allowed for loopback only, because the test harness and local
 * development run the real server on 127.0.0.1 and there is no network to
 * eavesdrop on.
 */

/** Hosts for which plain http is accepted — loopback only, never a LAN address. */
function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

export class InsecureApiUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InsecureApiUrlError'
  }
}

/**
 * Returns `apiUrl` unchanged when it is a usable base URL, throwing
 * `InsecureApiUrlError` otherwise. A trailing slash is trimmed so callers can
 * keep concatenating paths (`${apiUrl}/api/v1/...`) without producing `//`.
 */
export function assertSecureApiUrl(apiUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(apiUrl)
  } catch {
    throw new InsecureApiUrlError(`Invalid API URL: ${JSON.stringify(apiUrl)} is not a URL`)
  }

  if (parsed.protocol === 'https:') return apiUrl.replace(/\/+$/, '')

  if (parsed.protocol === 'http:' && isLoopback(parsed.hostname)) {
    return apiUrl.replace(/\/+$/, '')
  }

  if (parsed.protocol === 'http:') {
    throw new InsecureApiUrlError(
      `Refusing to use the API over plain http (${parsed.origin}): your API key and login ` +
        'codes would cross the network in the clear. Use https, or point at localhost for local development.',
    )
  }

  throw new InsecureApiUrlError(
    `Unsupported API URL scheme "${parsed.protocol}" — the API is reached over https.`,
  )
}
