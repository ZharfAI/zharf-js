import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseError, Zharf } from '../src/index'
import { DONE, collect, delta, event, json, mockFetch, sse, usageChunk } from './helpers'

beforeEach(() => {
  vi.stubEnv('ZHARF_API_KEY', '')
  vi.stubEnv('ZHARF_BASE_URL', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const request = { model: 'deepseek-v3.2', messages: [{ role: 'user', content: 'سلام' }] }
const usage = { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13, cost_zharf: 0.0021 }

describe('chat with stream: true', () => {
  it('yields text as it arrives, then one done part with usage and cost', async () => {
    const { fetch, calls } = mockFetch(() =>
      sse([
        event(delta({ role: 'assistant', content: '' })),
        event(delta({ content: 'درود' })),
        event(delta({ content: ' بر شما' })),
        event(delta({}, 'stop')),
        event(usageChunk(usage)),
        DONE,
      ]),
    )
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const parts = await collect(await zharf.chat({ ...request, stream: true }))

    expect(calls[0].body).toStrictEqual({ ...request, stream: true, stream_options: { include_usage: true } })
    expect(calls[0].headers.accept).toBe('text/event-stream')
    expect(parts.map((p) => p.message.content)).toStrictEqual(['درود', ' بر شما', ''])
    expect(parts.map((p) => p.done)).toStrictEqual([false, false, true])
    const last = parts[parts.length - 1]
    expect(last.done_reason).toBe('stop')
    expect(last.cost_zharf).toBe(0.0021)
    expect(last.usage).toStrictEqual(usage)
    expect(last.prompt_eval_count).toBe(9)
    expect(last.eval_count).toBe(4)
    expect(last.model).toBe('deepseek-v3.2')
  })

  describe('Persian text split across network chunks', () => {
    const text = 'سلام! می‌خواهم «ژرف» را امتحان کنم؛ ۱۲۳ تومان.'
    const words = ['سلام! ', 'می‌خواهم «ژرف» ', 'را امتحان کنم؛ ', '۱۲۳ تومان.']
    const body = new TextEncoder().encode(
      words.map((w) => event(delta({ content: w }))).join('') + event(delta({}, 'stop')) + event(usageChunk(usage)) + DONE,
    )

    it('is put back together at every byte offset', async () => {
      expect(text).toContain('‌') // the ZWNJ in «می‌خواهم»
      for (let i = 1; i < body.length; i++) {
        const { fetch } = mockFetch(() => sse([body.slice(0, i), body.slice(i)]))
        const zharf = new Zharf({ apiKey: 'zk-test', fetch })
        const parts = await collect(await zharf.chat({ ...request, stream: true }))
        const joined = parts.map((p) => p.message.content).join('')
        if (joined !== text) throw new Error(`split at byte ${i}: got ${JSON.stringify(joined)}`)
        expect(parts[parts.length - 1].cost_zharf).toBe(0.0021)
      }
    })

    it('is put back together when every byte arrives on its own', async () => {
      const chunks = Array.from(body, (b) => new Uint8Array([b]))
      const { fetch } = mockFetch(() => sse(chunks))
      const zharf = new Zharf({ apiKey: 'zk-test', fetch })
      const parts = await collect(await zharf.chat({ ...request, stream: true }))
      expect(parts.map((p) => p.message.content).join('')).toBe(text)
      expect(parts.filter((p) => p.message.content).length).toBe(words.length)
    })
  })

  it('reads CRLF line endings, comments, other fields and data without a space', async () => {
    const raw =
      ': keep-alive\r\n\r\n' +
      'event: message\r\nid: 1\r\n' +
      `data:${JSON.stringify(delta({ content: 'یک' }))}\r\n\r\n` +
      `data: ${JSON.stringify(delta({ content: ' دو' }, 'stop'))}\r\n\r\n` +
      ': another comment\r\n\r\n' +
      'data: [DONE]\r\n\r\n'
    const { fetch } = mockFetch(() => sse([raw.slice(0, 30), raw.slice(30, 31), raw.slice(31)]))
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const parts = await collect(await zharf.chat({ ...request, stream: true }))
    expect(parts.map((p) => p.message.content)).toStrictEqual(['یک', ' دو', ''])
    expect(parts[2].done).toBe(true)
  })

  it('yields reasoning as thinking, and hides it when think is false', async () => {
    const chunks = () => [
      event(delta({ reasoning_content: 'بگذار ' })),
      // An empty reasoning_content must not hide the text in reasoning.
      event(delta({ reasoning_content: '', reasoning: 'فکر کنم.' })),
      event(delta({ content: 'جواب' }, 'stop')),
      DONE,
    ]
    const { fetch } = mockFetch(() => sse(chunks()))
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })

    const shown = await collect(await zharf.chat({ ...request, stream: true }))
    expect(shown.map((p) => p.message.thinking ?? '')).toStrictEqual(['بگذار ', 'فکر کنم.', '', ''])
    expect(shown.map((p) => p.message.content)).toStrictEqual(['', '', 'جواب', ''])

    const hidden = await collect(await zharf.chat({ ...request, stream: true, think: false }))
    expect(hidden.map((p) => p.message.content)).toStrictEqual(['جواب', ''])
    expect(hidden.every((p) => p.message.thinking === undefined)).toBe(true)
  })

  it('puts tool call pieces together and returns them on the done part', async () => {
    const { fetch } = mockFetch(() =>
      sse([
        event(delta({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'get_weather', arguments: '' } }] })),
        event(delta({ tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] })),
        event(delta({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'get_time', arguments: '{"zone":"Asia/Tehran"}' } }] })),
        event(delta({ tool_calls: [{ index: 0, function: { arguments: '"تهران"}' } }] })),
        event(delta({}, 'tool_calls')),
        event(usageChunk(usage)),
        DONE,
      ]),
    )
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const parts = await collect(await zharf.chat({ ...request, stream: true }))
    expect(parts).toHaveLength(1)
    expect(parts[0].done).toBe(true)
    expect(parts[0].message.tool_calls).toStrictEqual([
      { id: 'call_a', function: { name: 'get_weather', arguments: { city: 'تهران' } } },
      { id: 'call_b', function: { name: 'get_time', arguments: { zone: 'Asia/Tehran' } } },
    ])
  })

  it('throws a ResponseError when the stream carries an error', async () => {
    const { fetch } = mockFetch(() =>
      sse([
        event(delta({ content: 'نیمه' })),
        event({ error: { message: 'Model is overloaded.', message_fa: 'مدل شلوغ است.', type: 'server_error', code: 'overloaded' } }),
      ]),
    )
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const stream = await zharf.chat({ ...request, stream: true })
    const seen: string[] = []
    const error = await (async () => {
      try {
        for await (const part of stream) seen.push(part.message.content)
      } catch (e) {
        return e
      }
    })()
    expect(seen).toStrictEqual(['نیمه'])
    expect(error).toBeInstanceOf(ResponseError)
    expect(error).toMatchObject({ error: 'Model is overloaded.', message_fa: 'مدل شلوغ است.', code: 'overloaded' })
  })

  it('throws when the stream ends before the answer is complete', async () => {
    const { fetch } = mockFetch(() => sse([event(delta({ content: 'نیمه' }))]))
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const stream = await zharf.chat({ ...request, stream: true })
    await expect(collect(stream)).rejects.toThrow('The stream ended before the answer was complete.')
  })

  it('finishes when the answer is complete even without [DONE]', async () => {
    const { fetch } = mockFetch(() => sse([event(delta({ content: 'تمام' }, 'stop'))]))
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const parts = await collect(await zharf.chat({ ...request, stream: true }))
    expect(parts.map((p) => p.done)).toStrictEqual([false, true])
    expect('cost_zharf' in parts[1]).toBe(false)
  })

  it('rejects chat() itself on an error answer', async () => {
    const { fetch } = mockFetch(() =>
      json(
        { error: { message: 'Invalid or revoked API key.', message_fa: 'این کلید API پیدا نشد.', type: 'authentication_error', code: 'bad_key' } },
        { status: 401 },
      ),
    )
    const zharf = new Zharf({ apiKey: 'zk-wrong', fetch })
    await expect(zharf.chat({ ...request, stream: true })).rejects.toMatchObject({
      name: 'ResponseError',
      status_code: 401,
      code: 'bad_key',
    })
  })
})

describe('abort', () => {
  it('stream.abort() stops the loop with an AbortError', async () => {
    const { fetch, calls } = mockFetch((call) =>
      sse([event(delta({ content: 'یک' })), event(delta({ content: 'دو' }))], { signal: call.init.signal, hold: true }),
    )
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const stream = await zharf.chat({ ...request, stream: true })
    const seen: string[] = []
    const error = await (async () => {
      try {
        for await (const part of stream) {
          seen.push(part.message.content)
          if (seen.length === 2) stream.abort()
        }
      } catch (e) {
        return e as Error
      }
    })()
    expect(seen).toStrictEqual(['یک', 'دو'])
    expect(error?.name).toBe('AbortError')
    expect(calls[0].init.signal?.aborted).toBe(true)
  })

  it('client.abort() stops every open stream', async () => {
    const { fetch } = mockFetch((call) => sse([event(delta({ content: 'x' }))], { signal: call.init.signal, hold: true }))
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const a = await zharf.chat({ ...request, stream: true })
    const b = await zharf.generate({ model: 'm', prompt: 'p', stream: true })
    const read = async (stream: AsyncIterable<object>) => {
      try {
        for await (const _ of stream) zharf.abort()
        return 'finished'
      } catch (e) {
        return (e as Error).name
      }
    }
    const [ra, rb] = await Promise.all([read(a), read(b)])
    expect(ra).toBe('AbortError')
    expect(rb).toBe('AbortError')
  })

  it('leaving the loop early closes the connection', async () => {
    let cancelled = false
    const { fetch, calls } = mockFetch((call) =>
      sse([event(delta({ content: 'یک' })), event(delta({ content: 'دو' }))], {
        signal: call.init.signal,
        hold: true,
        onCancel: () => {
          cancelled = true
        },
      }),
    )
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const stream = await zharf.chat({ ...request, stream: true })
    for await (const part of stream) {
      expect(part.message.content).toBe('یک')
      break
    }
    expect(calls[0].init.signal?.aborted || cancelled).toBe(true)
  })
})

describe('generate', () => {
  it('sends the system text and prompt as a chat and yields `response` parts', async () => {
    const { fetch, calls } = mockFetch(() =>
      sse([event(delta({ content: 'ژرف' })), event(delta({ content: ' یعنی عمیق' }, 'stop')), event(usageChunk(usage)), DONE]),
    )
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const parts = await collect(
      await zharf.generate({ model: 'm', system: 'کوتاه جواب بده.', prompt: 'ژرف یعنی چه؟', stream: true, options: { temperature: 0 } }),
    )
    expect(calls[0].body).toStrictEqual({
      model: 'm',
      messages: [
        { role: 'system', content: 'کوتاه جواب بده.' },
        { role: 'user', content: 'ژرف یعنی چه؟' },
      ],
      temperature: 0,
      stream: true,
      stream_options: { include_usage: true },
    })
    expect(parts.map((p) => p.response)).toStrictEqual(['ژرف', ' یعنی عمیق', ''])
    expect(parts[2]).toMatchObject({ done: true, done_reason: 'stop', cost_zharf: 0.0021 })
    expect('message' in parts[0]).toBe(false)
  })

  it('returns one answer without streaming', async () => {
    const { fetch } = mockFetch(() =>
      json({
        model: 'm',
        created: 1764000000,
        choices: [{ index: 0, message: { role: 'assistant', content: 'عمیق' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4, cost_zharf: 0.0001 },
      }),
    )
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const res = await zharf.generate({ model: 'm', prompt: 'ژرف یعنی چه؟' })
    expect(res).toMatchObject({ response: 'عمیق', done: true, done_reason: 'length', cost_zharf: 0.0001, eval_count: 1 })
  })
})
