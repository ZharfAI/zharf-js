import { defaultHost } from './constant.js'
import type { Fetch } from './interfaces.js'

export interface ResponseErrorDetails {
  message_fa?: string
  code?: string
  type?: string
  retry_after?: number
}

/**
 * An error answer from the platform. `status_code` is the HTTP status; `code` is the platform's
 * error code (`no_key`, `insufficient_balance`, `rate_limit`, …); `message_fa` is the same error
 * in Persian, ready to show to people; `retry_after` is the number of seconds to wait (on 429).
 */
export class ResponseError extends Error {
  error: string
  status_code: number
  message_fa?: string
  code?: string
  type?: string
  retry_after?: number

  constructor(error: string, status_code: number, details: ResponseErrorDetails = {}) {
    super(error)
    this.name = 'ResponseError'
    this.error = error
    this.status_code = status_code
    if (details.message_fa !== undefined) this.message_fa = details.message_fa
    if (details.code !== undefined) this.code = details.code
    if (details.type !== undefined) this.type = details.type
    if (details.retry_after !== undefined) this.retry_after = details.retry_after
    const capture = (Error as { captureStackTrace?: (target: object, ctor: Function) => void }).captureStackTrace
    if (capture) capture(this, ResponseError)
  }
}

/** An async iterator over a streamed answer that can be stopped with `abort()`. */
export class AbortableAsyncIterator<T extends object> implements AsyncIterable<T> {
  private readonly abortController: AbortController
  private readonly itr: AsyncGenerator<T>
  private readonly doneCallback: () => void

  constructor(abortController: AbortController, itr: AsyncGenerator<T>, doneCallback: () => void) {
    this.abortController = abortController
    this.itr = itr
    this.doneCallback = doneCallback
  }

  /** Stops the stream. A loop reading it throws an `AbortError`. */
  abort(): void {
    this.abortController.abort()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
    let finished = false
    try {
      for await (const part of this.itr) {
        yield part
        if ((part as { done?: boolean }).done) {
          finished = true
          return
        }
      }
      finished = true
    } finally {
      // Leaving the loop early (break, an error) closes the connection.
      if (!finished) this.abortController.abort()
      this.doneCallback()
    }
  }
}

/** Builds a ResponseError from an `{"error": …}` body (or anything else the server sent). */
export function errorFromBody(body: unknown, status: number, fallback: string, retryAfter?: number): ResponseError {
  let message = fallback
  const details: ResponseErrorDetails = {}
  if (body && typeof body === 'object') {
    const error = (body as { error?: unknown }).error
    if (error && typeof error === 'object') {
      const e = error as Record<string, unknown>
      if (typeof e.message === 'string' && e.message) message = e.message
      if (typeof e.message_fa === 'string') details.message_fa = e.message_fa
      if (typeof e.code === 'string' || typeof e.code === 'number') details.code = String(e.code)
      if (typeof e.type === 'string') details.type = e.type
    } else if (typeof error === 'string' && error) {
      message = error
    } else if (typeof (body as { message?: unknown }).message === 'string') {
      message = (body as { message: string }).message
    }
  }
  if (retryAfter !== undefined) details.retry_after = retryAfter
  return new ResponseError(message, status, details)
}

/** Seconds from a `Retry-After` header (a number of seconds or an HTTP date). */
export function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds)
  const date = Date.parse(value)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, Math.ceil((date - Date.now()) / 1000))
}

/** Throws a ResponseError unless the response is a success. */
export async function checkOk(response: Response): Promise<void> {
  if (response.ok) return
  const fallback = `Error ${response.status}${response.statusText ? `: ${response.statusText}` : ''}`
  let text = ''
  try {
    text = await response.text()
  } catch {
    // keep the status line
  }
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    // not JSON
  }
  const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
  if (body !== null) throw errorFromBody(body, response.status, fallback, retryAfter)
  const trimmed = text.trim()
  // An HTML error page says nothing useful; plain text might.
  const message = trimmed && !trimmed.startsWith('<') ? trimmed.slice(0, 500) : fallback
  throw new ResponseError(message, response.status, retryAfter === undefined ? {} : { retry_after: retryAfter })
}

/** Sends a request and throws a ResponseError on an error answer. */
export async function request(fetch: Fetch, url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init)
  await checkOk(response)
  return response
}

/**
 * Normalises the host: adds `https://` when no scheme is given (`http://` for localhost),
 * and drops a trailing slash and a trailing `/v1`. A path such as `/api/zharf` (a route on
 * your own server) is kept as it is.
 */
export function formatHost(host: string | undefined): string {
  let h = (host ?? '').trim()
  if (!h) return defaultHost
  if (!h.startsWith('/') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) {
    h = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(h) ? `http://${h}` : `https://${h}`
  }
  h = h.replace(/\/+$/, '')
  if (/\/v1$/i.test(h)) h = h.slice(0, -3)
  return h.replace(/\/+$/, '')
}

/** A number from a JSON value or header text; undefined when there is none. */
export function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** The request's cost: `usage.cost_zharf`, else the `x-zharf-cost` header. */
export function costOf(usage: { cost_zharf?: unknown } | undefined, response?: Response): number | undefined {
  const fromUsage = toNumber(usage?.cost_zharf)
  if (fromUsage !== undefined) return fromUsage
  return toNumber(response?.headers.get('x-zharf-cost'))
}

/**
 * Reads a server-sent event stream and yields each event's data. The bytes are decoded with a
 * streaming TextDecoder, so a character split across network chunks (Persian letters are two
 * bytes in UTF-8) is put back together before it is read.
 */
export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let data: string[] = []
  let finished = false

  /** Reads one line; returns the event's data when the line ends an event. */
  const handle = (raw: string): string | undefined => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line === '') {
      if (!data.length) return undefined
      const event = data.join('\n')
      data = []
      return event
    }
    if (line.startsWith(':')) return undefined // a comment, such as a keep-alive
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    if (field !== 'data') return undefined
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    data.push(value)
    return undefined
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // Complete lines are read now; the unfinished last line waits for more bytes.
      let start = 0
      let newline: number
      while ((newline = buffer.indexOf('\n', start)) !== -1) {
        const event = handle(buffer.slice(start, newline))
        start = newline + 1
        if (event !== undefined) yield event
      }
      buffer = buffer.slice(start)
    }
    finished = true
    buffer += decoder.decode()
    if (buffer) {
      const event = handle(buffer)
      if (event !== undefined) yield event
    }
    const last = handle('')
    if (last !== undefined) yield last
  } finally {
    if (finished) {
      reader.releaseLock()
    } else {
      reader.cancel().catch(() => {})
    }
  }
}

/** Base64 for bytes, in any runtime. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const size = 0x8000
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + size)))
  }
  return btoa(binary)
}

/** The image type from its first bytes. */
export function sniffImage(bytes: Uint8Array): string {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b)
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'
  }
  return 'image/jpeg'
}

/** Turns an image (bytes, base64, data URL or http URL) into something the API accepts. */
export function imageToURL(image: Uint8Array | string): string {
  if (typeof image !== 'string') return `data:${sniffImage(image)};base64,${toBase64(image)}`
  const s = image.trim()
  if (/^(data:|https?:\/\/)/i.test(s)) return s
  let head = new Uint8Array(0)
  try {
    const start = s.slice(0, 24)
    const decoded = atob(start.slice(0, start.length - (start.length % 4)))
    head = Uint8Array.from(decoded, (c) => c.charCodeAt(0))
  } catch {
    // not base64 after all; let the server say so
  }
  return `data:${sniffImage(head)};base64,${s}`
}

/** True in a web page (not in Node, Deno, Bun, workers or edge runtimes). */
export function isBrowser(): boolean {
  const g = globalThis as { window?: { document?: unknown } }
  return typeof g.window !== 'undefined' && typeof g.window.document !== 'undefined'
}
