/**
 * Thrown for any non-2xx Transfer API response. `code` is always the exact
 * machine-parseable identifier the server returned (e.g. `expired`,
 * `not_found`, `size_exceeded`, `unauthorized`, `storage_unconfigured`,
 * `validation_failed`) — never a client-invented code, mirroring
 * apps/mcp/src/lib/apiClient.ts's ApiError shape exactly.
 */
export class ApiError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/** Everything callApi needs to reach the Transfer API — no config singleton import. */
export type ApiClientOptions = {
  apiUrl: string
  /**
   * Optional so callers can hit anonymous-safe routes (e.g. the public
   * download-resolve GET /api/v1/transfers/:id,
   * apps/server/src/routes/transfers.ts) with no stored credential at all —
   * retrieval never requires a YAFL account. When omitted or empty, no
   * Authorization header is sent at all.
   */
  apiKey?: string
}

/**
 * Fetch wrapper for the YAFL Transfer API. Sends
 * `Authorization: Bearer <apiKey>` (matches
 * apps/server/src/middleware/identity.ts's exact expected header shape —
 * case-sensitive, `Bearer ` with a trailing space) ONLY when `apiKey` is a
 * non-empty string; when it is undefined/empty the header is omitted
 * entirely rather than sending a malformed `Bearer undefined` — the
 * anonymous-download path (`yafl get` with no stored credential) relies on
 * this to send a plain unauthenticated request to the public resolve route.
 * Byte-identical to the prior always-send behavior whenever a key IS given.
 * Never logs the key or any URL — callers must not pass a full share URL
 * (with fragment) into any logger either. Lifted from
 * apps/mcp/src/lib/apiClient.ts's callApi, but parameterized on
 * apiUrl/apiKey instead of importing an MCP config singleton, so both the
 * CLI and (later) the MCP server can share this exact request/error
 * contract.
 */
export async function callApi(options: ApiClientOptions, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${options.apiUrl}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    },
  })

  if (!res.ok) {
    // The house envelope is what the Transfer API itself returns. The edge in
    // front of it does not use it: nginx answers 413/429/502 with HTML and
    // Cloudflare with its own page, so res.json() throws there and used to
    // bury the real status under a SyntaxError. Fall back to the status.
    let code = 'http_error'
    let message = `Request failed (HTTP ${res.status})`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      if (body?.error?.code) {
        code = body.error.code
        message = body.error.message ?? message
      }
    } catch {
      // Not JSON at all — keep the status-derived code and message.
    }
    throw new ApiError(code, message, res.status)
  }

  // A 204 (e.g. POST /:id/email's success response, HAND-04) has no body —
  // calling res.json() on it throws "Unexpected end of JSON input". Every
  // other success response in this API returns a JSON body, so this is the
  // one safe, general place to short-circuit on an empty response.
  if (res.status === 204) return undefined

  return res.json()
}

/**
 * One item in a `listTransfers` response — mirrors
 * apps/server/src/routes/transfers.ts's GET / contract exactly: no
 * `key`/`r2ObjectKey`/filename field, `downloadPath` is a path only (no
 * scheme/host/`#`/key).
 */
export type TransferListItem = {
  id: string
  size: number | null
  status: string
  createdAt: string
  expiresAt: string
  downloadPath: string
  encryptedMeta: string
}

/** GET /api/v1/transfers — the caller's own non-expired transfers, newest-first, capped. */
export async function listTransfers(options: ApiClientOptions): Promise<TransferListItem[]> {
  return (await callApi(options, '/api/v1/transfers')) as TransferListItem[]
}

/** DELETE /api/v1/transfers/:id — deletes the caller's own transfer only. */
export async function deleteTransfer(options: ApiClientOptions, id: string): Promise<{ ok: true }> {
  return (await callApi(options, `/api/v1/transfers/${id}`, { method: 'DELETE' })) as { ok: true }
}
