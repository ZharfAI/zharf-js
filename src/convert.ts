// Turns Ollama-style requests into the platform's OpenAI-compatible ones, and its answers back.

import type { ChatRequest, ChatResponse, GenerateResponse, Message, Options, ToolCall, Usage } from './interfaces.js'
import { costOf, errorFromBody, toNumber } from './utils.js'

type Json = Record<string, any>

/** Maps Ollama's options: num_predict → max_tokens (-1 and -2 mean no limit), stop as a list. */
export function applyOptions(body: Json, options: Partial<Options> | undefined): void {
  if (!options) return
  for (const key of ['temperature', 'top_p', 'top_k', 'seed', 'presence_penalty', 'frequency_penalty'] as const) {
    const value = options[key]
    if (typeof value === 'number' && Number.isFinite(value)) body[key] = value
  }
  if (typeof options.num_predict === 'number' && options.num_predict > 0) {
    body.max_tokens = Math.floor(options.num_predict)
  }
  const stop = typeof options.stop === 'string' ? [options.stop] : options.stop
  if (Array.isArray(stop)) {
    const list = stop.filter((s): s is string => typeof s === 'string' && s !== '')
    if (list.length) body.stop = list
  }
}

/** Ollama's `format`: 'json' → JSON mode; a schema → structured output. */
export function responseFormat(format: ChatRequest['format']): Json | undefined {
  if (!format) return undefined
  if (format === 'json') return { type: 'json_object' }
  if (typeof format === 'object') return { type: 'json_schema', json_schema: { name: 'response', schema: format } }
  return undefined
}

/** Ollama's `think`: a level becomes the reasoning effort; `false` hides the reasoning. */
export function thinkSetting(think: ChatRequest['think']): { effort?: string; show: boolean } {
  if (think === false) return { show: false }
  if (think === 'low' || think === 'medium' || think === 'high') return { effort: think, show: true }
  return { show: true }
}

/**
 * Ollama-style messages → OpenAI messages. Images become content parts; tool calls get ids and
 * string arguments; a tool's answer without `tool_call_id` is matched to the earlier call by
 * `tool_name` (or, failing that, to the oldest call still waiting for an answer).
 */
export async function toOpenAIMessages(
  messages: Message[],
  imageURL: (image: Uint8Array | string) => Promise<string>,
): Promise<Json[]> {
  const out: Json[] = []
  const waiting: { id: string; name: string }[] = []
  let generated = 0

  for (const m of messages) {
    const msg: Json = { role: m.role }
    const text = m.content ?? ''

    if (m.images?.length) {
      const parts: Json[] = []
      if (text) parts.push({ type: 'text', text })
      for (const image of m.images) parts.push({ type: 'image_url', image_url: { url: await imageURL(image) } })
      msg.content = parts
    } else {
      msg.content = text
    }

    if (m.role === 'assistant' && m.tool_calls?.length) {
      msg.tool_calls = m.tool_calls.map((call) => {
        const id = call.id ?? `call_${generated++}`
        waiting.push({ id, name: call.function.name })
        const args = call.function.arguments as unknown
        return {
          id,
          type: 'function',
          function: { name: call.function.name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) },
        }
      })
      if (!text && !m.images?.length) msg.content = null
    }

    if (m.role === 'tool') {
      let index = -1
      if (m.tool_call_id) index = waiting.findIndex((w) => w.id === m.tool_call_id)
      else if (m.tool_name) index = waiting.findIndex((w) => w.name === m.tool_name)
      if (index === -1 && !m.tool_call_id && waiting.length) index = 0
      const id = m.tool_call_id ?? (index >= 0 ? waiting[index].id : undefined)
      if (index >= 0) waiting.splice(index, 1)
      if (id) msg.tool_call_id = id
    }

    out.push(msg)
  }
  return out
}

/** The request body for /v1/chat/completions. */
export async function chatBody(
  request: ChatRequest,
  imageURL: (image: Uint8Array | string) => Promise<string>,
): Promise<{ body: Json; show: boolean }> {
  const body: Json = {
    model: request.model,
    messages: await toOpenAIMessages(request.messages ?? [], imageURL),
  }
  if (request.tools?.length) body.tools = request.tools
  const format = responseFormat(request.format)
  if (format) body.response_format = format
  const think = thinkSetting(request.think)
  if (think.effort) body.reasoning_effort = think.effort
  applyOptions(body, request.options)
  if (request.stream) {
    body.stream = true
    body.stream_options = { include_usage: true }
  }
  return { body, show: think.show }
}

/** OpenAI's finish_reason → Ollama's done_reason. */
export function doneReason(finish: string | null | undefined): string {
  if (!finish || finish === 'stop' || finish === 'tool_calls' || finish === 'function_call' || finish === 'end_turn') {
    return 'stop'
  }
  return finish
}

function parseArguments(raw: unknown): { arguments: Json; raw_arguments?: string } {
  if (raw && typeof raw === 'object') return { arguments: raw as Json }
  if (typeof raw !== 'string' || raw.trim() === '') return { arguments: {} }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { arguments: parsed }
  } catch {
    // fall through
  }
  return { arguments: {}, raw_arguments: raw }
}

function toToolCalls(calls: Json[] | undefined): ToolCall[] | undefined {
  if (!Array.isArray(calls) || !calls.length) return undefined
  return calls
    .filter((c) => c?.function?.name)
    .map((c) => {
      const call: ToolCall = { function: { name: c.function.name, ...parseArguments(c.function.arguments) } }
      if (c.id) call.id = c.id
      return call
    })
}

function thinkingOf(source: Json | undefined): string {
  // Either field may be present and empty while the other carries the text.
  for (const value of [source?.reasoning_content, source?.reasoning]) {
    if (typeof value === 'string' && value) return value
  }
  return ''
}

function counts(usage: Usage | undefined): { prompt_eval_count?: number; eval_count?: number } {
  const out: { prompt_eval_count?: number; eval_count?: number } = {}
  const prompt = toNumber(usage?.prompt_tokens)
  const completion = toNumber(usage?.completion_tokens)
  if (prompt !== undefined) out.prompt_eval_count = prompt
  if (completion !== undefined) out.eval_count = completion
  return out
}

/** A finished (non-streamed) chat completion → ChatResponse. */
export function toChatResponse(json: Json, model: string, show: boolean, response: Response): ChatResponse {
  const choice = json.choices?.[0] ?? {}
  const m = choice.message ?? {}
  const message: Message = { role: 'assistant', content: typeof m.content === 'string' ? m.content : '' }
  const thinking = show ? thinkingOf(m) : ''
  if (thinking) message.thinking = thinking
  const toolCalls = toToolCalls(m.tool_calls)
  if (toolCalls?.length) message.tool_calls = toolCalls
  const usage: Usage | undefined = json.usage ?? undefined
  const out: ChatResponse = {
    model: json.model ?? model,
    created_at: typeof json.created === 'number' ? new Date(json.created * 1000) : new Date(),
    message,
    done: true,
    done_reason: doneReason(choice.finish_reason),
    ...counts(usage),
  }
  const cost = costOf(usage, response)
  if (cost !== undefined) out.cost_zharf = cost
  if (usage) out.usage = usage
  return out
}

/** A chat part → the `generate()` shape (`response` instead of `message`). */
export function toGenerateResponse(part: ChatResponse): GenerateResponse {
  const out: GenerateResponse = {
    model: part.model,
    created_at: part.created_at,
    response: part.message.content,
    done: part.done,
  }
  if (part.message.thinking) out.thinking = part.message.thinking
  if (part.done_reason !== undefined) out.done_reason = part.done_reason
  if (part.cost_zharf !== undefined) out.cost_zharf = part.cost_zharf
  if (part.usage !== undefined) out.usage = part.usage
  if (part.prompt_eval_count !== undefined) out.prompt_eval_count = part.prompt_eval_count
  if (part.eval_count !== undefined) out.eval_count = part.eval_count
  return out
}

/**
 * Streamed chat completion events → ChatResponse parts. Text and reasoning arrive as they are
 * written; tool calls (which come in pieces) and the usage and cost come in one last part with
 * `done: true`.
 */
export async function* chatParts(
  events: AsyncGenerator<string>,
  model: string,
  show: boolean,
  response: Response,
): AsyncGenerator<ChatResponse> {
  let finish: string | undefined
  let usage: Usage | undefined
  let sawDone = false
  const calls: { id?: string; name: string; args: string }[] = []

  for await (const data of events) {
    if (data.trim() === '[DONE]') {
      sawDone = true
      break
    }
    let chunk: Json
    try {
      chunk = JSON.parse(data)
    } catch {
      continue
    }
    if (!chunk || typeof chunk !== 'object') continue
    if (chunk.error) throw errorFromBody(chunk, response.status, 'The stream reported an error.')
    if (typeof chunk.model === 'string' && chunk.model) model = chunk.model
    if (chunk.usage) usage = chunk.usage

    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined
    if (!choice) continue
    const delta: Json = choice.delta ?? choice.message ?? {}

    for (const piece of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      let index: number
      if (typeof piece.index === 'number') index = piece.index
      else if (piece.id && !calls.some((c) => c?.id === piece.id)) index = calls.length
      else index = Math.max(0, calls.length - 1)
      const slot = (calls[index] ??= { name: '', args: '' })
      if (piece.id) slot.id = piece.id
      if (piece.function?.name) slot.name += piece.function.name
      const args = piece.function?.arguments
      if (typeof args === 'string') slot.args += args
      else if (args && typeof args === 'object') slot.args += JSON.stringify(args)
    }

    if (choice.finish_reason) finish = choice.finish_reason

    const content = typeof delta.content === 'string' ? delta.content : ''
    const thinking = show ? thinkingOf(delta) : ''
    if (content || thinking) {
      const message: Message = { role: 'assistant', content }
      if (thinking) message.thinking = thinking
      yield { model, created_at: new Date(), message, done: false }
    }
  }

  if (!sawDone && !finish) throw new Error('The stream ended before the answer was complete.')

  const message: Message = { role: 'assistant', content: '' }
  const toolCalls = toToolCalls(
    calls.filter(Boolean).map((c) => ({ id: c.id, function: { name: c.name, arguments: c.args } })),
  )
  if (toolCalls?.length) message.tool_calls = toolCalls
  const final: ChatResponse = {
    model,
    created_at: new Date(),
    message,
    done: true,
    done_reason: doneReason(finish),
    ...counts(usage),
  }
  const cost = costOf(usage, response)
  if (cost !== undefined) final.cost_zharf = cost
  if (usage) final.usage = usage
  yield final
}
