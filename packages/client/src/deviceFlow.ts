/**
 * RFC 8628 device-flow client, driving apps/server/src/routes/device.ts's
 * exact wire contract: `POST /api/v1/device/code` -> RFC-exact snake_case
 * response, then `POST /api/v1/device/token` polled per `interval`/
 * `slow_down`/`expires_in`. Token errors are read as the bare-string
 * `{ error }` body the RFC mandates (authorization_pending, slow_down,
 * expired_token, access_denied) — never the house `{ error: { code } }`
 * envelope, which is scoped to every other endpoint.
 */

/** Shown to the human immediately after requesting a code — always printed, browser or not. */
export type DevicePrompt = {
  verificationUri: string
  userCode: string
  verificationUriComplete: string
}

export type DeviceFlowResult = {
  apiKey: string
  keyName: string
}

export type DeviceFlowOptions = {
  onPrompt: (prompt: DevicePrompt) => void
  /** Injectable seams for hermetic unit tests (slow_down growth, expiry) — default to real fetch/timers. */
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Per-request hard timeout (ms). Bounds each individual fetch so a hung
      connection can neither stall the initial prompt nor leave a poll pending
      forever — the `expires_in` deadline only bounds the gaps BETWEEN
      completed requests, not a single request that never resolves. */
  requestTimeoutMs?: number
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

/** Thrown when a single device-flow request exceeds `requestTimeoutMs`. */
export class DeviceFlowRequestTimeoutError extends Error {
  constructor(message = 'Device-flow request timed out') {
    super(message)
    this.name = 'DeviceFlowRequestTimeoutError'
  }
}

/** fetch with an AbortController-backed per-request deadline. */
async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (controller.signal.aborted) throw new DeviceFlowRequestTimeoutError()
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Thrown when the device code expires (server-reported `expired_token`, or the client's own expires_in deadline). */
export class DeviceFlowExpiredError extends Error {
  constructor(message = 'Device code expired, run yafl login again') {
    super(message)
    this.name = 'DeviceFlowExpiredError'
  }
}

/** Thrown when the human explicitly denies the request via the approval page. */
export class DeviceFlowDeniedError extends Error {
  constructor(message = 'Login request was denied') {
    super(message)
    this.name = 'DeviceFlowDeniedError'
  }
}

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

type DeviceTokenErrorBody = { error: string }
type DeviceTokenSuccessBody = { api_key: string; key_name: string; token_type: string }

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Requests a device code, invokes `onPrompt` once with the human-facing
 * verification URL + code, then polls the token endpoint. The wait before
 * each poll (including the first) is measured from the previous response's
 * receipt, not from when the previous request was sent, so slow_down's
 * cumulative `interval += 5` growth composes correctly across polls. Polling
 * hard-stops once `expires_in` elapses on the client's own clock, even if
 * the server never sees another request (T-08-03: bounds the poll loop
 * independent of server behavior).
 */
export async function requestAndPoll(apiUrl: string, options: DeviceFlowOptions): Promise<DeviceFlowResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

  const codeRes = await fetchWithTimeout(
    fetchImpl,
    `${apiUrl}/api/v1/device/code`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
    requestTimeoutMs,
  )
  if (!codeRes.ok) {
    throw new Error(`Failed to request a device code (HTTP ${codeRes.status})`)
  }
  const codeBody = (await codeRes.json()) as DeviceCodeResponse

  options.onPrompt({
    verificationUri: codeBody.verification_uri,
    userCode: codeBody.user_code,
    verificationUriComplete: codeBody.verification_uri_complete,
  })

  let intervalMs = codeBody.interval * 1000
  const deadline = now() + codeBody.expires_in * 1000

  for (;;) {
    if (now() >= deadline) {
      throw new DeviceFlowExpiredError()
    }

    // Wait is measured from here — right after the previous response was
    // fully handled (or, on the first iteration, right after the code
    // response) — never from when the next request is sent.
    await sleep(intervalMs)

    let tokenRes: Response
    try {
      tokenRes = await fetchWithTimeout(
        fetchImpl,
        `${apiUrl}/api/v1/device/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code: codeBody.device_code }),
        },
        requestTimeoutMs,
      )
    } catch (err) {
      // A single timed-out or dropped poll is transient — the deadline check
      // at the top of the loop bounds the total wait, so retry rather than
      // aborting the whole login on one blip. A non-timeout error still
      // propagates (real fetch failures, e.g. DNS, are not silently retried
      // forever — they recur and the expires_in deadline eventually fires).
      if (err instanceof DeviceFlowRequestTimeoutError) continue
      throw err
    }

    if (tokenRes.ok) {
      const body = (await tokenRes.json()) as DeviceTokenSuccessBody
      return { apiKey: body.api_key, keyName: body.key_name }
    }

    const errBody = (await tokenRes.json()) as DeviceTokenErrorBody
    if (errBody.error === 'slow_down') {
      intervalMs += 5000
      continue
    }
    if (errBody.error === 'authorization_pending') {
      continue
    }
    if (errBody.error === 'expired_token') {
      throw new DeviceFlowExpiredError()
    }
    if (errBody.error === 'access_denied') {
      throw new DeviceFlowDeniedError()
    }
    throw new Error(`Unexpected device-flow token error: ${errBody.error}`)
  }
}
