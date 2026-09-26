// Calls to the Rubriqly backend. The site and the API share one address (`/api` is forwarded to
// the backend by Render in production and by Vite in development), so the sign-in cookie is an
// ordinary first-party cookie.

/** An error the screens can show as-is (`message`) and act on (`code`, `status`). */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

// A restarting or slow server answers through Render's forwarding without our usual details.
const BUSY = 'Rubriqly’s server is starting up or busy. Please try again in a minute.'
const FALLBACK_MESSAGES: Record<number, string> = {
  401: 'Please sign in to continue.',
  413: 'That’s too large to send. Try a smaller file or photo.',
  422: 'Some of the details aren’t valid. Check them and try again.',
  429: 'Too many requests. Please wait a minute and try again.',
  502: BUSY,
  503: BUSY,
  504: BUSY,
}
const GENERIC = 'Something went wrong on our side. Please try again in a minute.'
const OFFLINE = 'Can’t reach Rubriqly right now. Check your connection and try again.'

export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'network', OFFLINE)
  }

  if (response.status === 204) return undefined as T
  const isJson = response.headers.get('Content-Type')?.includes('application/json') ?? false
  const body: unknown = isJson ? await response.json().catch(() => undefined) : undefined
  // Anything but JSON means the request never reached the backend (e.g. a web page came back
  // because /api isn't forwarded yet), so treat it like being offline.
  if (response.ok && body === undefined) throw new ApiError(0, 'network', OFFLINE)
  if (response.ok) return body as T

  const detail = (body as { detail?: unknown } | undefined)?.detail
  if (detail && typeof detail === 'object' && 'code' in detail && 'message' in detail) {
    const { code, message } = detail as { code: string; message: string }
    throw new ApiError(response.status, code, message)
  }
  // Validation errors (422) and anything unexpected get a friendly, generic message.
  throw new ApiError(
    response.status,
    `http_${response.status}`,
    FALLBACK_MESSAGES[response.status] ?? GENERIC,
  )
}
