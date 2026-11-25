import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import browserDefault, { Zharf, ResponseError } from '../src/browser'
import { completion, json, mockFetch } from './helpers'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('browser entry', () => {
  beforeEach(() => {
    vi.stubEnv('ZHARF_API_KEY', 'zk-from-env')
    vi.stubEnv('ZHARF_BASE_URL', 'https://elsewhere.example.com')
  })

  it('never reads the environment', async () => {
    const { fetch, calls } = mockFetch(() => json({ object: 'list', data: [] }))
    vi.stubGlobal('fetch', fetch)
    await browserDefault.list()
    await new Zharf().list()
    for (const call of calls) {
      expect(call.url).toBe('https://platform.zharf.ai/v1/models')
      expect(call.headers.authorization).toBeUndefined()
    }
  })

  it('works through a route on your own server, with no key in the page', async () => {
    vi.stubGlobal('window', { document: {} })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { fetch, calls } = mockFetch(() => json(completion({ content: 'درود' })))
    const zharf = new Zharf({ host: '/api/zharf', fetch })
    const res = await zharf.chat({ model: 'm', messages: [{ role: 'user', content: 'سلام' }] })
    expect(calls[0].url).toBe('/api/zharf/v1/chat/completions')
    expect(calls[0].headers.authorization).toBeUndefined()
    expect(calls[0].headers['user-agent']).toBeUndefined()
    expect(res.message.content).toBe('درود')
    expect(warn).not.toHaveBeenCalled()
  })

  it('stays quiet about a key when dangerouslyAllowBrowser is set', () => {
    vi.stubGlobal('window', { document: {} })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    new Zharf({ apiKey: 'zk-test', dangerouslyAllowBrowser: true })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns once when a key is used in a web page', () => {
    vi.stubGlobal('window', { document: {} })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    new Zharf({ apiKey: 'zk-test' })
    new Zharf({ headers: { Authorization: 'Bearer zk-test' } })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('API key')
  })

  it('does not warn outside a web page', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    new Zharf({ apiKey: 'zk-test' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('rejects file paths for audio', async () => {
    const { fetch } = mockFetch(() => json({ text: '' }))
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    await expect(zharf.audio.transcribe({ model: 'm', file: '/tmp/a.mp3' })).rejects.toThrow('File paths work only in Node.')
  })

  it('exports ResponseError', () => {
    expect(new ResponseError('x', 500)).toBeInstanceOf(Error)
  })
})
