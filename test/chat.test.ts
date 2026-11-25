import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Zharf } from '../src/index'
import { completion, json, mockFetch } from './helpers'

beforeEach(() => {
  vi.stubEnv('ZHARF_API_KEY', '')
  vi.stubEnv('ZHARF_BASE_URL', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])

describe('chat', () => {
  it('sends an OpenAI-shaped request with nothing extra', async () => {
    const { fetch, calls } = mockFetch(() => json(completion({ content: 'درود' })))
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    await zharf.chat({ model: 'deepseek-v3.2', messages: [{ role: 'user', content: 'سلام' }] })

    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call.url).toBe('https://platform.zharf.ai/v1/chat/completions')
    expect(call.init.method).toBe('POST')
    expect(call.body).toStrictEqual({ model: 'deepseek-v3.2', messages: [{ role: 'user', content: 'سلام' }] })
    expect(call.headers.authorization).toBe('Bearer zk-test')
    expect(call.headers['content-type']).toBe('application/json')
    expect(call.headers.accept).toBe('application/json')
    expect(call.headers['user-agent']).toMatch(/^zharf-js\/0\.1\.0 \(.+Node\.js\/v\d+/)
  })

  it('returns an Ollama-shaped answer with the cost', async () => {
    const { fetch } = mockFetch(() =>
      json(completion({ content: 'درود بر شما', reasoning_content: 'کاربر سلام کرد.' })),
    )
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const res = await zharf.chat({ model: 'deepseek-v3.2', messages: [{ role: 'user', content: 'سلام' }] })

    expect(res.message).toStrictEqual({ role: 'assistant', content: 'درود بر شما', thinking: 'کاربر سلام کرد.' })
    expect(res.done).toBe(true)
    expect(res.done_reason).toBe('stop')
    expect(res.model).toBe('deepseek-v3.2')
    expect(res.created_at).toEqual(new Date(1764000000 * 1000))
    expect(res.cost_zharf).toBe(0.0042)
    expect(res.usage).toMatchObject({ prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 })
    expect(res.prompt_eval_count).toBe(12)
    expect(res.eval_count).toBe(5)
  })

  it('reads the cost from x-zharf-cost when usage has none, and leaves it out when neither has it', async () => {
    const noCost = completion({ content: 'ok' }, { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
    const { fetch } = mockFetch(
      () => json(noCost, { headers: { 'x-zharf-cost': '0.0137' } }),
      () => json(noCost),
    )
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const request = { model: 'm', messages: [{ role: 'user', content: 'hi' }] }

    expect((await zharf.chat(request)).cost_zharf).toBe(0.0137)
    const second = await zharf.chat(request)
    expect('cost_zharf' in second).toBe(false)
  })

  it('maps Ollama options onto the request', async () => {
    const { fetch, calls } = mockFetch(() => json(completion({ content: 'ok' })))
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    await zharf.chat({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      options: {
        temperature: 0.2,
        top_p: 0.9,
        top_k: 40,
        num_predict: 256,
        stop: '###',
        seed: 7,
        presence_penalty: 0.1,
        frequency_penalty: 0.3,
        // Ollama runner settings have no meaning here and are not sent.
        num_ctx: 8192,
        repeat_penalty: 1.1,
      } as any,
    })
    const { model, messages, ...rest } = calls[0].body
    expect(rest).toStrictEqual({
      temperature: 0.2,
      top_p: 0.9,
      top_k: 40,
      max_tokens: 256,
      stop: ['###'],
      seed: 7,
      presence_penalty: 0.1,
      frequency_penalty: 0.3,
    })
  })

  it('treats num_predict -1 and -2 as no limit and keeps a list of stops', async () => {
    const { fetch, calls } = mockFetch(() => json(completion({ content: 'ok' })))
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const base = { model: 'm', messages: [{ role: 'user', content: 'hi' }] }
    await zharf.chat({ ...base, options: { num_predict: -1, stop: ['a', '', 'b'] } })
    await zharf.chat({ ...base, options: { num_predict: -2 } })
    expect(calls[0].body.max_tokens).toBeUndefined()
    expect(calls[0].body.stop).toStrictEqual(['a', 'b'])
    expect(calls[1].body.max_tokens).toBeUndefined()
  })

  it('maps format to JSON mode or a JSON schema', async () => {
    const { fetch, calls } = mockFetch(() => json(completion({ content: '{}' })))
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const base = { model: 'm', messages: [{ role: 'user', content: 'hi' }] }
    const schema = { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }
    await zharf.chat({ ...base, format: 'json' })
    await zharf.chat({ ...base, format: schema })
    await zharf.chat({ ...base, format: '' })
    expect(calls[0].body.response_format).toStrictEqual({ type: 'json_object' })
    expect(calls[1].body.response_format).toStrictEqual({
      type: 'json_schema',
      json_schema: { name: 'response', schema },
    })
    expect(calls[2].body.response_format).toBeUndefined()
  })

  it('maps think to the reasoning effort and hides reasoning when think is false', async () => {
    const answer = completion({ content: 'ok', reasoning: 'thinking…' })
    const { fetch, calls } = mockFetch(() => json(answer))
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const base = { model: 'm', messages: [{ role: 'user', content: 'hi' }] }

    const high = await zharf.chat({ ...base, think: 'high' })
    const on = await zharf.chat({ ...base, think: true })
    const off = await zharf.chat({ ...base, think: false })

    expect(calls[0].body.reasoning_effort).toBe('high')
    expect(calls[1].body.reasoning_effort).toBeUndefined()
    expect(calls[2].body.reasoning_effort).toBeUndefined()
    expect(high.message.thinking).toBe('thinking…')
    expect(on.message.thinking).toBe('thinking…')
    expect(off.message.thinking).toBeUndefined()
  })

  it('sends images as content parts', async () => {
    const { fetch, calls } = mockFetch(() => json(completion({ content: 'a cat' })))
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const jpegBase64 = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))
    await zharf.chat({
      model: 'm',
      messages: [
        {
          role: 'user',
          content: 'What is in these?',
          images: [PNG, jpegBase64, 'https://example.com/cat.webp'],
        },
      ],
    })
    expect(calls[0].body.messages[0].content).toStrictEqual([
      { type: 'text', text: 'What is in these?' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}` } },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegBase64}` } },
      { type: 'image_url', image_url: { url: 'https://example.com/cat.webp' } },
    ])
  })

  it('does not change the request object it is given', async () => {
    const { fetch } = mockFetch(() => json(completion({ content: 'ok' })))
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const request = {
      model: 'm',
      messages: [
        { role: 'user', content: 'hi', images: [PNG] },
        { role: 'assistant', content: '', tool_calls: [{ function: { name: 'f', arguments: { a: 1 } } }] },
        { role: 'tool', content: '1', tool_name: 'f' },
      ],
      options: { num_predict: 10, stop: 'x' },
      format: { type: 'object' },
    }
    const before = structuredClone(request)
    await zharf.chat(request)
    expect(request).toStrictEqual(before)
  })
})

describe('client config', () => {
  it.each([
    ['https://platform.zharf.ai', 'https://platform.zharf.ai/v1/models'],
    ['https://platform.zharf.ai/', 'https://platform.zharf.ai/v1/models'],
    ['https://platform.zharf.ai/v1', 'https://platform.zharf.ai/v1/models'],
    ['https://platform.zharf.ai/v1/', 'https://platform.zharf.ai/v1/models'],
    ['platform.zharf.ai', 'https://platform.zharf.ai/v1/models'],
    ['localhost:8080', 'http://localhost:8080/v1/models'],
    ['/api/zharf', '/api/zharf/v1/models'],
    ['https://example.com/proxy/zharf/', 'https://example.com/proxy/zharf/v1/models'],
  ])('host %s → %s', async (host, url) => {
    const { fetch, calls } = mockFetch(() => json({ object: 'list', data: [] }))
    await new Zharf({ host, fetch }).list()
    expect(calls[0].url).toBe(url)
  })

  it('sends no Authorization header when there is no key', async () => {
    const { fetch, calls } = mockFetch(() => json({ object: 'list', data: [] }))
    await new Zharf({ fetch }).list()
    expect(calls[0].headers.authorization).toBeUndefined()
  })

  it('uses the apiKey option first, then an Authorization header, then ZHARF_API_KEY', async () => {
    vi.stubEnv('ZHARF_API_KEY', 'zk-env')
    const { fetch, calls } = mockFetch(() => json({ object: 'list', data: [] }))
    await new Zharf({ fetch, apiKey: 'zk-option', headers: { Authorization: 'Bearer zk-header' } }).list()
    await new Zharf({ fetch, headers: { Authorization: 'Bearer zk-header' } }).list()
    await new Zharf({ fetch }).list()
    expect(calls.map((c) => c.headers.authorization)).toStrictEqual([
      'Bearer zk-option',
      'Bearer zk-header',
      'Bearer zk-env',
    ])
  })

  it('sends custom headers, which may replace the User-Agent', async () => {
    const { fetch, calls } = mockFetch(() => json({ object: 'list', data: [] }))
    await new Zharf({ fetch, headers: { 'X-Custom-Header': 'custom-value', 'User-Agent': 'MyApp/1.0' } }).list()
    expect(calls[0].headers['x-custom-header']).toBe('custom-value')
    expect(calls[0].headers['user-agent']).toBe('MyApp/1.0')
  })
})
