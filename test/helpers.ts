export interface Call {
  url: string
  init: RequestInit
  headers: Record<string, string>
  /** The parsed JSON body (or the raw body when it is not a string). */
  body: any
}

type Reply = (call: Call) => Response | Promise<Response>

/** A fetch that records each call and answers with the given replies, in order (the last repeats). */
export function mockFetch(...replies: Reply[]) {
  const calls: Call[] = []
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value
    })
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
    const call: Call = { url: String(input), init, headers, body }
    calls.push(call)
    const reply = replies.length > 1 ? replies.shift()! : replies[0]
    return reply(call)
  }
  return { fetch: fetch as typeof globalThis.fetch, calls }
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers },
  })
}

/**
 * A text/event-stream answer made of the given chunks. With `signal`, aborting errors the stream
 * the way a real fetch does; with `hold`, the stream stays open after the chunks until aborted.
 */
export function sse(
  chunks: (string | Uint8Array)[],
  options: { signal?: AbortSignal | null; hold?: boolean; onCancel?: () => void; headers?: Record<string, string> } = {},
): Response {
  const encoder = new TextEncoder()
  const queue = chunks.map((c) => (typeof c === 'string' ? encoder.encode(c) : c))
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      options.signal?.addEventListener('abort', () => {
        try {
          controller.error(new DOMException('This operation was aborted', 'AbortError'))
        } catch {
          // already closed
        }
      })
    },
    pull(controller) {
      if (queue.length) {
        controller.enqueue(queue.shift()!)
        return
      }
      if (options.hold) return new Promise<void>(() => {})
      controller.close()
    },
    cancel() {
      options.onCancel?.()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream', ...options.headers } })
}

/** One SSE event carrying a JSON chunk. */
export const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`

export const DONE = 'data: [DONE]\n\n'

/** A streamed chat completion chunk with a delta. */
export const delta = (d: Record<string, unknown>, finish: string | null = null, model = 'deepseek-v3.2') => ({
  id: 'chatcmpl-1',
  object: 'chat.completion.chunk',
  created: 1764000000,
  model,
  choices: [{ index: 0, delta: d, finish_reason: finish }],
})

/** The usage-only chunk sent last when stream_options.include_usage is on. */
export const usageChunk = (usage: Record<string, unknown>) => ({
  id: 'chatcmpl-1',
  object: 'chat.completion.chunk',
  created: 1764000000,
  model: 'deepseek-v3.2',
  choices: [],
  usage,
})

/** A finished chat completion. */
export const completion = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1764000000,
  model: 'deepseek-v3.2',
  choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17, cost_zharf: 0.0042 },
  ...extra,
})

/** Collects every part of an async iterable. */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const part of iterable) out.push(part)
  return out
}
