import { defaultHost } from './constant.js'
import { chatBody, chatParts, toChatResponse, toGenerateResponse } from './convert.js'
import type {
  ChatRequest,
  ChatResponse,
  Config,
  EmbedRequest,
  EmbedResponse,
  Fetch,
  GenerateRequest,
  GenerateResponse,
  ImageRequest,
  ImageResponse,
  ListResponse,
  Message,
  ShowRequest,
  ShowResponse,
  SpeechRequest,
  SpeechResponse,
  TranscribeRequest,
  TranscribeResponse,
} from './interfaces.js'
import {
  AbortableAsyncIterator,
  ResponseError,
  costOf,
  formatHost,
  imageToURL,
  isBrowser,
  parseSSE,
  request as send,
  toNumber,
} from './utils.js'
import { version } from './version.js'

type Json = Record<string, any>

let warnedAboutBrowserKey = false

function dropUndefined<T extends object>(value: T): Json {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined))
}

/** A file name with the right extension, read from the audio's first bytes. */
function audioName(head: Uint8Array): string {
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(head.subarray(from, to)))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio.wav'
  if (ascii(0, 4) === 'OggS') return 'audio.ogg'
  if (ascii(0, 4) === 'fLaC') return 'audio.flac'
  if (ascii(4, 8) === 'ftyp') return 'audio.m4a'
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'audio.webm'
  return 'audio.mp3'
}

export class Zharf {
  protected readonly config: Omit<Config, 'fetch'>
  protected readonly fetch: Fetch
  protected readonly ongoingStreamedRequests: AbortableAsyncIterator<object>[] = []

  /** Image generation: `images.generate({ model, prompt })`. */
  readonly images: {
    generate: (request: ImageRequest) => Promise<ImageResponse>
  }

  /** Text to speech (`audio.speech`) and speech to text (`audio.transcribe`). */
  readonly audio: {
    speech: (request: SpeechRequest) => Promise<SpeechResponse>
    transcribe: (request: TranscribeRequest) => Promise<TranscribeResponse>
  }

  constructor(config: Config = {}) {
    this.config = {
      host: config.host,
      apiKey: config.apiKey,
      headers: config.headers,
      dangerouslyAllowBrowser: config.dangerouslyAllowBrowser,
    }
    const custom = config.fetch
    // Calling the global fetch through a wrapper keeps `this` right in browsers.
    this.fetch = (custom ? (input, init) => custom(input, init) : (input, init) => fetch(input, init)) as Fetch
    this.images = { generate: (request) => this.imagesGenerate(request) }
    this.audio = {
      speech: (request) => this.audioSpeech(request),
      transcribe: (request) => this.audioTranscribe(request),
    }
    this.warnAboutBrowserKey(config)
  }

  private warnAboutBrowserKey(config: Config): void {
    if (warnedAboutBrowserKey || config.dangerouslyAllowBrowser || !isBrowser()) return
    if (!config.apiKey && !new Headers(config.headers ?? {}).has('authorization')) return
    warnedAboutBrowserKey = true
    console.warn(
      '[zharf] An API key is being used in a web page. Anyone who opens the page can read it and spend ' +
        "your account's balance. Keep the key on your server and point `host` at a route there that " +
        'adds it (see the README). Pass `dangerouslyAllowBrowser: true` to hide this warning.',
    )
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────────────────────

  /** The platform's address, without `/v1`. */
  protected resolveHost(): string {
    return formatHost(this.config.host ?? defaultHost)
  }

  /** The key to use when none is given in the config or headers. The browser build has none. */
  protected envApiKey(): string | undefined {
    return undefined
  }

  /** Headers that name this library. Browsers do not allow a User-Agent to be set. */
  protected clientHeaders(): Record<string, string> {
    return isBrowser() ? {} : { 'user-agent': `zharf-js/${version}` }
  }

  protected url(path: string): string {
    return `${this.resolveHost()}/v1/${path}`
  }

  protected headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json', ...this.clientHeaders() }
    new Headers(this.config.headers ?? {}).forEach((value, key) => {
      headers[key] = value
    })
    if (this.config.apiKey) {
      headers.authorization = `Bearer ${this.config.apiKey}`
    } else if (!headers.authorization) {
      const key = this.envApiKey()
      if (key) headers.authorization = `Bearer ${key}`
    }
    for (const [key, value] of Object.entries(extra)) headers[key.toLowerCase()] = value
    return headers
  }

  protected async get(path: string): Promise<Response> {
    return send(this.fetch, this.url(path), { method: 'GET', headers: this.headers() })
  }

  protected async post(
    path: string,
    body: unknown,
    options: { signal?: AbortSignal; accept?: string } = {},
  ): Promise<Response> {
    const extra: Record<string, string> = { 'content-type': 'application/json' }
    if (options.accept) extra.accept = options.accept
    return send(this.fetch, this.url(path), {
      method: 'POST',
      headers: this.headers(extra),
      body: JSON.stringify(body),
      signal: options.signal,
    })
  }

  /** Opens a streamed request and wraps its events in an AbortableAsyncIterator. */
  protected async openStream<T extends object>(
    path: string,
    body: unknown,
    read: (events: AsyncGenerator<string>, response: Response) => AsyncGenerator<T>,
  ): Promise<AbortableAsyncIterator<T>> {
    const controller = new AbortController()
    const response = await this.post(path, body, { signal: controller.signal, accept: 'text/event-stream' })
    if (!response.body) throw new Error('Missing body')
    const iterator: AbortableAsyncIterator<T> = new AbortableAsyncIterator(
      controller,
      read(parseSSE(response.body), response),
      () => {
        const i = this.ongoingStreamedRequests.indexOf(iterator)
        if (i > -1) this.ongoingStreamedRequests.splice(i, 1)
      },
    )
    this.ongoingStreamedRequests.push(iterator)
    return iterator
  }

  /** Turns an image into a URL the API accepts. The Node build also reads file paths. */
  protected async imageURL(image: Uint8Array | string): Promise<string> {
    return imageToURL(image)
  }

  /** Turns the audio into a Blob and a file name. The Node build also reads file paths. */
  protected async audioFile(file: TranscribeRequest['file'], filename?: string): Promise<{ blob: Blob; name: string }> {
    if (typeof file === 'string') {
      throw new TypeError('Pass the audio as a Blob, File, Uint8Array or ArrayBuffer. File paths work only in Node.')
    }
    const blob = file instanceof Blob ? file : new Blob([file])
    const ownName = (file as { name?: unknown }).name
    if (filename) return { blob, name: filename }
    if (typeof ownName === 'string' && ownName) return { blob, name: ownName }
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
    return { blob, name: audioName(head) }
  }

  // ── API ───────────────────────────────────────────────────────────────────────────────────

  /** Stops every stream this client has open. Their loops throw an `AbortError`. */
  abort(): void {
    for (const request of [...this.ongoingStreamedRequests]) request.abort()
    this.ongoingStreamedRequests.length = 0
  }

  chat(request: ChatRequest & { stream: true }): Promise<AbortableAsyncIterator<ChatResponse>>
  chat(request: ChatRequest & { stream?: false }): Promise<ChatResponse>
  chat(request: ChatRequest): Promise<ChatResponse | AbortableAsyncIterator<ChatResponse>>
  /**
   * Chats with a model. With `stream: true` it returns an AbortableAsyncIterator of parts; the last
   * part has `done: true`, the usage and `cost_zharf`.
   */
  async chat(request: ChatRequest): Promise<ChatResponse | AbortableAsyncIterator<ChatResponse>> {
    const { body, show } = await chatBody(request, (image) => this.imageURL(image))
    if (request.stream) {
      return this.openStream<ChatResponse>('chat/completions', body, (events, response) =>
        chatParts(events, request.model, show, response),
      )
    }
    const response = await this.post('chat/completions', body)
    return toChatResponse(await response.json(), request.model, show, response)
  }

  generate(request: GenerateRequest & { stream: true }): Promise<AbortableAsyncIterator<GenerateResponse>>
  generate(request: GenerateRequest & { stream?: false }): Promise<GenerateResponse>
  generate(request: GenerateRequest): Promise<GenerateResponse | AbortableAsyncIterator<GenerateResponse>>
  /** Answers a single prompt (sent as a chat with an optional system message). */
  async generate(request: GenerateRequest): Promise<GenerateResponse | AbortableAsyncIterator<GenerateResponse>> {
    const messages: Message[] = []
    if (request.system) messages.push({ role: 'system', content: request.system })
    const user: Message = { role: 'user', content: request.prompt }
    if (request.images?.length) user.images = request.images
    messages.push(user)
    const chatRequest: ChatRequest = {
      model: request.model,
      messages,
      stream: request.stream,
      format: request.format,
      think: request.think,
      options: request.options,
    }
    const { body, show } = await chatBody(chatRequest, (image) => this.imageURL(image))
    if (request.stream) {
      return this.openStream<GenerateResponse>('chat/completions', body, async function* (events, response) {
        for await (const part of chatParts(events, request.model, show, response)) yield toGenerateResponse(part)
      })
    }
    const response = await this.post('chat/completions', body)
    return toGenerateResponse(toChatResponse(await response.json(), request.model, show, response))
  }

  /** Lists the platform's models with their prices in ZHARF. Needs no key. */
  async list(): Promise<ListResponse> {
    const response = await this.get('models')
    const json = await response.json()
    const out: ListResponse = { models: Array.isArray(json?.data) ? json.data : [] }
    if (typeof json?.prices_valid_until === 'string') out.prices_valid_until = json.prices_valid_until
    return out
  }

  /** One model's entry: context length, modalities, features, parameters and prices. */
  async show(request: ShowRequest): Promise<ShowResponse> {
    const response = await this.get(`models/${encodeURIComponent(request.model)}`)
    return (await response.json()) as ShowResponse
  }

  /** Embeds one text or a list of texts. */
  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    const body: Json = { model: request.model, input: request.input }
    if (request.dimensions !== undefined) body.dimensions = request.dimensions
    const response = await this.post('embeddings', body)
    const json = await response.json()
    const data: Json[] = Array.isArray(json?.data) ? [...json.data] : []
    data.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const out: EmbedResponse = { model: json?.model ?? request.model, embeddings: data.map((d) => d.embedding) }
    if (json?.usage) out.usage = json.usage
    const cost = costOf(json?.usage, response)
    if (cost !== undefined) out.cost_zharf = cost
    const prompt = toNumber(json?.usage?.prompt_tokens)
    if (prompt !== undefined) out.prompt_eval_count = prompt
    return out
  }

  protected async imagesGenerate(request: ImageRequest): Promise<ImageResponse> {
    const response = await this.post('images/generations', dropUndefined(request))
    const json = await response.json()
    const out: ImageResponse = { ...json, data: Array.isArray(json?.data) ? json.data : [] }
    const cost = costOf(json?.usage, response)
    if (cost !== undefined) out.cost_zharf = cost
    return out
  }

  protected async audioSpeech(request: SpeechRequest): Promise<SpeechResponse> {
    const response = await this.post('audio/speech', dropUndefined(request), { accept: '*/*' })
    const out: SpeechResponse = {
      audio: new Uint8Array(await response.arrayBuffer()),
      content_type: response.headers.get('content-type') ?? 'application/octet-stream',
    }
    const cost = costOf(undefined, response)
    if (cost !== undefined) out.cost_zharf = cost
    return out
  }

  protected async audioTranscribe(request: TranscribeRequest): Promise<TranscribeResponse> {
    const { blob, name } = await this.audioFile(request.file, request.filename)
    const form = new FormData()
    form.append('file', blob, name)
    form.append('model', request.model)
    if (request.language !== undefined) form.append('language', request.language)
    if (request.prompt !== undefined) form.append('prompt', request.prompt)
    if (request.response_format !== undefined) form.append('response_format', request.response_format)
    if (request.temperature !== undefined) form.append('temperature', String(request.temperature))
    // No content-type here: fetch sets the multipart boundary itself.
    const response = await send(this.fetch, this.url('audio/transcriptions'), {
      method: 'POST',
      headers: this.headers(),
      body: form,
    })
    let out: TranscribeResponse
    if ((response.headers.get('content-type') ?? '').includes('json')) {
      const json = await response.json()
      out = { ...json, text: typeof json?.text === 'string' ? json.text : '' }
    } else {
      out = { text: await response.text() }
    }
    const cost = costOf(out.usage, response)
    if (cost !== undefined) out.cost_zharf = cost
    return out
  }
}

export default new Zharf()

// Export the types from the entry point so code that imports them needs no deep paths.
export * from './interfaces.js'
export { ResponseError }
export type { AbortableAsyncIterator }
