export type Fetch = typeof fetch

export interface Config {
  /** Address of the platform. Default: `https://platform.zharf.ai` (in Node, `ZHARF_BASE_URL` if set). A trailing `/v1` is accepted. */
  host?: string
  /** A `zk-…` key. In Node the default is the `ZHARF_API_KEY` environment variable. */
  apiKey?: string
  /** The fetch function to use. Default: the global `fetch`. */
  fetch?: Fetch
  /** Extra headers sent with every request. */
  headers?: Headers | Record<string, string> | [string, string][]
  /** Browser entry only: hides the warning printed when a key is used in a web page. */
  dangerouslyAllowBrowser?: boolean
}

// ── Requests ────────────────────────────────────────────────────────────────────────────────

/** Ollama-style generation options. Each one maps onto the platform's OpenAI-compatible request. */
export interface Options {
  temperature: number
  top_p: number
  top_k: number
  /** Maximum number of tokens to generate (sent as `max_tokens`). `-1` or `-2` mean no limit. */
  num_predict: number
  stop: string | string[]
  seed: number
  presence_penalty: number
  frequency_penalty: number
}

export type ThinkLevel = 'low' | 'medium' | 'high'

export interface ToolCall {
  /** The call's id. Kept so the tool's answer can be matched to it on the next turn. */
  id?: string
  function: {
    name: string
    arguments: { [key: string]: any }
    /** Present only when the model sent arguments that are not valid JSON; `arguments` is then `{}`. */
    raw_arguments?: string
  }
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool' | (string & {})
  content: string
  thinking?: string
  /** Images as `Uint8Array`s, base64 strings, data URLs or http(s) URLs. In Node, also file paths. */
  images?: (Uint8Array | string)[]
  tool_calls?: ToolCall[]
  /** For `role: 'tool'`: the name of the tool whose result this is. */
  tool_name?: string
  /** For `role: 'tool'`: the id of the call this answers. Found from `tool_name` when left out. */
  tool_call_id?: string
}

export interface Tool {
  type: 'function' | (string & {})
  function: {
    name: string
    description?: string
    parameters?: { [key: string]: any }
    strict?: boolean
  }
}

export interface ChatRequest {
  model: string
  messages: Message[]
  stream?: boolean
  /** `'json'` for JSON mode, or a JSON schema for structured output. */
  format?: 'json' | '' | { [key: string]: any }
  tools?: Tool[]
  /** `true`/`false` shows or hides the model's reasoning; `'low' | 'medium' | 'high'` also sets its effort. */
  think?: boolean | ThinkLevel
  options?: Partial<Options>
}

export interface GenerateRequest {
  model: string
  prompt: string
  system?: string
  images?: (Uint8Array | string)[]
  stream?: boolean
  format?: ChatRequest['format']
  think?: ChatRequest['think']
  options?: Partial<Options>
}

export interface ShowRequest {
  model: string
}

export interface EmbedRequest {
  model: string
  input: string | string[]
  dimensions?: number
}

export interface ImageRequest {
  model: string
  prompt: string
  n?: number
  size?: string
  quality?: string
  style?: string
  response_format?: 'url' | 'b64_json'
  /** Other parameters a model accepts (see `params` in its `show()` entry). */
  [key: string]: unknown
}

export interface SpeechRequest {
  model: string
  input: string
  voice?: string
  response_format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm' | (string & {})
  speed?: number
}

export interface TranscribeRequest {
  model: string
  /** The audio: a `Blob`/`File`, `Uint8Array` or `ArrayBuffer`. In Node, also a file path. */
  file: Blob | Uint8Array | ArrayBuffer | string
  /** File name sent with the audio; its extension tells the server the format. */
  filename?: string
  language?: string
  prompt?: string
  response_format?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt' | (string & {})
  temperature?: number
}

// ── Responses ───────────────────────────────────────────────────────────────────────────────

export interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  /** What the request cost, in ZHARF. */
  cost_zharf?: number
  [key: string]: unknown
}

interface Final {
  done: boolean
  /** Why generation stopped (`stop`, `length`, …). Set on the last part. */
  done_reason?: string
  /** What the request cost, in ZHARF. Set on the last part when the platform reports it. */
  cost_zharf?: number
  usage?: Usage
  /** Input tokens (Ollama's name). */
  prompt_eval_count?: number
  /** Output tokens (Ollama's name). */
  eval_count?: number
}

export interface ChatResponse extends Final {
  model: string
  created_at: Date
  message: Message
}

export interface GenerateResponse extends Final {
  model: string
  created_at: Date
  response: string
  thinking?: string
}

export interface ModelPricing {
  /** Always `ZHARF`. */
  currency: string
  prompt_per_1m_tokens: number
  completion_per_1m_tokens: number
  input_cache_read_per_1m_tokens?: number
  input_cache_write_per_1m_tokens?: number
  /** Price of one `media_unit` (an image, a minute of audio, a job, …). */
  per_unit?: number
  media_unit?: string
  /** The price is known only after the request runs. */
  priced_on_use?: boolean
  [key: string]: unknown
}

export interface ModelResponse {
  id: string
  object?: string
  name: string
  description?: string
  owned_by: string
  /** Unix seconds. */
  created: number
  /** Unix seconds: when the model was added to the platform. */
  added_at?: number
  context_length: number
  max_completion_tokens?: number
  /** For example `text->text`, `text+image->text`, `embedding`. */
  modality: string
  input_modalities: string[]
  output_modalities: string[]
  features: string[]
  supported_parameters: string[]
  operations?: string[]
  pricing: ModelPricing
  [key: string]: unknown
}

export interface ListResponse {
  models: ModelResponse[]
  /** Prices are fixed until this time (ISO 8601). */
  prices_valid_until?: string
}

export type ShowResponse = ModelResponse

export interface EmbedResponse {
  model: string
  embeddings: number[][]
  usage?: Usage
  cost_zharf?: number
  prompt_eval_count?: number
}

export interface ImageResponse {
  created?: number
  data: { url?: string; b64_json?: string; revised_prompt?: string }[]
  usage?: Usage
  cost_zharf?: number
  [key: string]: unknown
}

export interface SpeechResponse {
  audio: Uint8Array
  content_type: string
  cost_zharf?: number
}

export interface TranscribeResponse {
  text: string
  language?: string
  duration?: number
  usage?: Usage
  cost_zharf?: number
  [key: string]: unknown
}

export interface ErrorResponse {
  error: {
    message: string
    /** The same error in Persian, ready to show to people. */
    message_fa?: string
    type?: string
    code?: string
  }
}
