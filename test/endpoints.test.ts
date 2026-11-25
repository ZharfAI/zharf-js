import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Zharf } from '../src/index'
import { json, mockFetch } from './helpers'

beforeEach(() => {
  vi.stubEnv('ZHARF_API_KEY', '')
  vi.stubEnv('ZHARF_BASE_URL', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const model = {
  id: 'deepseek-v3.2',
  object: 'model',
  created: 1735689600,
  added_at: 1764000000,
  owned_by: 'DeepSeek',
  name: 'DeepSeek V3.2',
  context_length: 163840,
  max_completion_tokens: 65536,
  modality: 'text->text',
  input_modalities: ['text'],
  output_modalities: ['text'],
  features: ['streaming', 'tools', 'reasoning'],
  supported_parameters: ['tools', 'tool_choice', 'reasoning'],
  operations: [],
  pricing: { currency: 'ZHARF', prompt_per_1m_tokens: 10.5, completion_per_1m_tokens: 15.75 },
}

describe('list and show', () => {
  it('list() returns the models and the price validity', async () => {
    const { fetch, calls } = mockFetch(() =>
      json({ object: 'list', data: [model], prices_valid_until: '2026-11-25T20:30:00.000Z' }),
    )
    const res = await new Zharf({ fetch }).list()
    expect(calls[0].url).toBe('https://platform.zharf.ai/v1/models')
    expect(calls[0].init.method).toBe('GET')
    expect(res).toStrictEqual({ models: [model], prices_valid_until: '2026-11-25T20:30:00.000Z' })
  })

  it('show() fetches one model by id', async () => {
    const { fetch, calls } = mockFetch(() => json(model))
    const res = await new Zharf({ fetch }).show({ model: 'deepseek-v3.2' })
    expect(calls[0].url).toBe('https://platform.zharf.ai/v1/models/deepseek-v3.2')
    expect(res.pricing.currency).toBe('ZHARF')
  })

  it('show() escapes the id', async () => {
    const { fetch, calls } = mockFetch(() => json(model))
    await new Zharf({ fetch }).show({ model: 'a b/c' })
    expect(calls[0].url).toBe('https://platform.zharf.ai/v1/models/a%20b%2Fc')
  })
})

describe('embed', () => {
  it('returns the vectors in input order with the cost', async () => {
    const { fetch, calls } = mockFetch(() =>
      json({
        object: 'list',
        model: 'embed-model',
        data: [
          { object: 'embedding', index: 1, embedding: [0.3, 0.4] },
          { object: 'embedding', index: 0, embedding: [0.1, 0.2] },
        ],
        usage: { prompt_tokens: 6, total_tokens: 6, cost_zharf: 0.00025 },
      }),
    )
    const res = await new Zharf({ apiKey: 'zk-test', fetch }).embed({ model: 'embed-model', input: ['ژرف', 'عمیق'], dimensions: 2 })
    expect(calls[0].url).toBe('https://platform.zharf.ai/v1/embeddings')
    expect(calls[0].body).toStrictEqual({ model: 'embed-model', input: ['ژرف', 'عمیق'], dimensions: 2 })
    expect(res.embeddings).toStrictEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ])
    expect(res.cost_zharf).toBe(0.00025)
    expect(res.prompt_eval_count).toBe(6)
    expect(res.model).toBe('embed-model')
  })
})

describe('images.generate', () => {
  it('posts the request and returns the images with the cost', async () => {
    const { fetch, calls } = mockFetch(() =>
      json({ created: 1764000000, data: [{ url: 'https://example.com/1.png' }], usage: { cost_zharf: 9.5 } }),
    )
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const res = await zharf.images.generate({ model: 'gpt-5-image-mini', prompt: 'یک فنجان چای', size: '1024x1024', n: undefined, aspect_ratio: '1:1' })
    expect(calls[0].url).toBe('https://platform.zharf.ai/v1/images/generations')
    expect(calls[0].body).toStrictEqual({ model: 'gpt-5-image-mini', prompt: 'یک فنجان چای', size: '1024x1024', aspect_ratio: '1:1' })
    expect(res.data).toStrictEqual([{ url: 'https://example.com/1.png' }])
    expect(res.cost_zharf).toBe(9.5)
  })
})

describe('audio', () => {
  it('speech() returns the audio bytes, their type and the cost', async () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3])
    const { fetch, calls } = mockFetch(
      () => new Response(bytes, { status: 200, headers: { 'content-type': 'audio/mpeg', 'x-zharf-cost': '0.31' } }),
    )
    const res = await new Zharf({ apiKey: 'zk-test', fetch }).audio.speech({ model: 'tts-model', input: 'سلام', voice: 'alloy' })
    expect(calls[0].url).toBe('https://platform.zharf.ai/v1/audio/speech')
    expect(calls[0].body).toStrictEqual({ model: 'tts-model', input: 'سلام', voice: 'alloy' })
    expect(calls[0].headers.accept).toBe('*/*')
    expect(res.audio).toStrictEqual(bytes)
    expect(res.content_type).toBe('audio/mpeg')
    expect(res.cost_zharf).toBe(0.31)
  })

  it('transcribe() sends multipart form data and returns the text', async () => {
    const { fetch, calls } = mockFetch(() =>
      json({ text: 'سلام، حال شما چطور است؟', usage: { cost_zharf: 0.04 } }, { headers: { 'x-zharf-cost': '0.04' } }),
    )
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2, 3, 4])
    const res = await new Zharf({ apiKey: 'zk-test', fetch }).audio.transcribe({
      model: 'stt-model',
      file: wav,
      language: 'fa',
      temperature: 0,
    })
    const [call] = calls
    expect(call.url).toBe('https://platform.zharf.ai/v1/audio/transcriptions')
    expect(call.headers['content-type']).toBeUndefined()
    expect(call.headers.authorization).toBe('Bearer zk-test')
    const form = call.init.body as FormData
    expect(form).toBeInstanceOf(FormData)
    const file = form.get('file') as Blob & { name?: string }
    expect(file.name).toBe('audio.wav')
    expect(new Uint8Array(await file.arrayBuffer())).toStrictEqual(wav)
    expect(form.get('model')).toBe('stt-model')
    expect(form.get('language')).toBe('fa')
    expect(form.get('temperature')).toBe('0')
    expect(form.has('prompt')).toBe(false)
    expect(res.text).toBe('سلام، حال شما چطور است؟')
    expect(res.cost_zharf).toBe(0.04)
  })

  it('transcribe() returns plain text for text formats', async () => {
    const { fetch } = mockFetch(
      () => new Response('1\n00:00:00,000 --> 00:00:01,000\nسلام\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
    )
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/ogg' })
    const res = await new Zharf({ apiKey: 'zk-test', fetch }).audio.transcribe({
      model: 'stt-model',
      file: blob,
      filename: 'voice.ogg',
      response_format: 'srt',
    })
    expect(res.text).toContain('سلام')
  })
})
