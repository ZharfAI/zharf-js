import { describe, expect, it } from 'vitest'
import { ResponseError, Zharf } from '../src/index'
import { json, mockFetch } from './helpers'

const request = { model: 'm', messages: [{ role: 'user', content: 'hi' }] }

const cases: [number, string, string, string][] = [
  [401, 'no_key', 'authentication_error', 'کلید API همراه درخواست نیامده است.'],
  [402, 'insufficient_balance', 'billing_error', 'اعتبار حساب تمام شده است.'],
  [402, 'key_spend_limit', 'billing_error', 'این کلید به سقف هزینه‌اش رسیده است.'],
  [403, 'model_not_offered', 'permission_error', 'این مدل در دسترس نیست.'],
  [404, 'model_not_found', 'invalid_request_error', 'چنین مدلی نیست.'],
  [503, 'unavailable', 'server_error', 'مدل‌ها فعلاً در دسترس نیستند.'],
]

describe('errors', () => {
  it.each(cases)('%i %s becomes a ResponseError with the Persian message', async (status, code, type, fa) => {
    const { fetch } = mockFetch(() =>
      json({ error: { message: `English message for ${code}`, message_fa: fa, type, code } }, { status }),
    )
    const error = await new Zharf({ apiKey: 'zk-test', fetch }).chat(request).catch((e) => e)
    expect(error).toBeInstanceOf(ResponseError)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ResponseError')
    expect(error.status_code).toBe(status)
    expect(error.error).toBe(`English message for ${code}`)
    expect(error.message).toBe(`English message for ${code}`)
    expect(error.message_fa).toBe(fa)
    expect(error.code).toBe(code)
    expect(error.type).toBe(type)
    expect(error.retry_after).toBeUndefined()
  })

  it('429 carries Retry-After in seconds', async () => {
    const { fetch } = mockFetch(() =>
      json(
        { error: { message: 'Too many requests.', message_fa: 'درخواست‌ها زیاد است.', type: 'rate_limit_error', code: 'rate_limit' } },
        { status: 429, headers: { 'retry-after': '7' } },
      ),
    )
    const error = await new Zharf({ apiKey: 'zk-test', fetch }).chat(request).catch((e) => e)
    expect(error).toMatchObject({ status_code: 429, code: 'rate_limit', retry_after: 7 })
  })

  it('reads a Retry-After date', async () => {
    const when = new Date(Date.now() + 30_000).toUTCString()
    const { fetch } = mockFetch(() => json({ error: { message: 'slow down', code: 'too_many_inflight' } }, { status: 429, headers: { 'retry-after': when } }))
    const error = await new Zharf({ fetch }).list().catch((e) => e)
    expect(error.retry_after).toBeGreaterThan(25)
    expect(error.retry_after).toBeLessThanOrEqual(31)
  })

  it('falls back to the status line for an HTML error page', async () => {
    const { fetch } = mockFetch(
      () => new Response('<html><body>502 Bad Gateway</body></html>', { status: 502, statusText: 'Bad Gateway', headers: { 'content-type': 'text/html' } }),
    )
    const error = await new Zharf({ fetch }).list().catch((e) => e)
    expect(error).toBeInstanceOf(ResponseError)
    expect(error.message).toBe('Error 502: Bad Gateway')
    expect(error.status_code).toBe(502)
    expect(error.message_fa).toBeUndefined()
  })

  it('keeps a plain-text error body', async () => {
    const { fetch } = mockFetch(() => new Response('gateway timed out', { status: 504, headers: { 'content-type': 'text/plain' } }))
    const error = await new Zharf({ fetch }).list().catch((e) => e)
    expect(error.message).toBe('gateway timed out')
    expect(error.status_code).toBe(504)
  })

  it('reads an Ollama-style string error', async () => {
    const { fetch } = mockFetch(() => json({ error: 'model "x" not found' }, { status: 404 }))
    const error = await new Zharf({ fetch }).show({ model: 'x' }).catch((e) => e)
    expect(error.message).toBe('model "x" not found')
    expect(error.status_code).toBe(404)
  })
})
