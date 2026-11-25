import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import zharf, { Zharf } from '../src/index'
import { completion, json, mockFetch } from './helpers'

let dir = ''
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zharf-js-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('node entry', () => {
  it('reads ZHARF_API_KEY and ZHARF_BASE_URL when the request is made, not at import', async () => {
    const { fetch, calls } = mockFetch(() => json({ object: 'list', data: [] }))
    vi.stubGlobal('fetch', fetch)
    vi.stubEnv('ZHARF_API_KEY', 'zk-late')
    vi.stubEnv('ZHARF_BASE_URL', 'https://staging.example.com/v1/')
    // `zharf` is the default instance, created when the module was imported.
    await zharf.list()
    expect(calls[0].url).toBe('https://staging.example.com/v1/models')
    expect(calls[0].headers.authorization).toBe('Bearer zk-late')
  })

  it('prefers the host option over ZHARF_BASE_URL', async () => {
    vi.stubEnv('ZHARF_BASE_URL', 'https://staging.example.com')
    const { fetch, calls } = mockFetch(() => json({ object: 'list', data: [] }))
    await new Zharf({ host: 'https://platform.zharf.ai', fetch }).list()
    expect(calls[0].url).toBe('https://platform.zharf.ai/v1/models')
  })

  it('reads images from file paths', async () => {
    vi.stubEnv('ZHARF_API_KEY', 'zk-test')
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const path = join(dir, 'cat.png')
    await writeFile(path, png)
    const { fetch, calls } = mockFetch(() => json(completion({ content: 'a cat' })))
    await new Zharf({ fetch }).chat({ model: 'm', messages: [{ role: 'user', content: 'what is this?', images: [path] }] })
    expect(calls[0].body.messages[0].content[1]).toStrictEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${Buffer.from(png).toString('base64')}` },
    })
  })

  it('reads audio from a file path and names it after the file', async () => {
    vi.stubEnv('ZHARF_API_KEY', 'zk-test')
    const path = join(dir, 'voice-note.ogg')
    await writeFile(path, new Uint8Array([0x4f, 0x67, 0x67, 0x53, 9, 9]))
    const { fetch, calls } = mockFetch(() => json({ text: 'سلام' }))
    const res = await new Zharf({ fetch }).audio.transcribe({ model: 'stt-model', file: path })
    const file = (calls[0].init.body as FormData).get('file') as Blob & { name?: string }
    expect(file.name).toBe('voice-note.ogg')
    expect(file.size).toBe(6)
    expect(res.text).toBe('سلام')
  })
})
