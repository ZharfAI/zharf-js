# Zharf JavaScript Library

The Zharf JavaScript library is the easiest way to use the [Zharf API platform](https://platform.zharf.ai) from JavaScript or TypeScript: chat, streaming, tool calls, embeddings, images and speech, with the cost of every request in the answer. Its shape follows [ollama-js](https://github.com/ollama/ollama-js), so code written for Ollama moves over with few changes.

- No runtime dependencies. It uses the global `fetch` and runs on Node 18 or later, Deno and in browsers; other runtimes with a standard `fetch`, such as Bun, should work too.
- ESM and CommonJS builds, with TypeScript types.
- Every error has a Persian message (`message_fa`) you can show to people as it is.

[فارسی](#فارسی)

## Getting Started

```
npm i zharf
```

Create a key on the platform's [keys page](https://platform.zharf.ai/keys) and put it in an environment variable. The library reads it from there.

```
export ZHARF_API_KEY="zk-..."
```

## Usage

```javascript
import zharf from 'zharf'

const response = await zharf.chat({
  model: 'deepseek-v3.2',
  messages: [{ role: 'user', content: 'Why is the sky blue?' }],
})
console.log(response.message.content)
console.log(response.cost_zharf) // what the request cost, in ZHARF
```

Model ids come from [`list()`](#list) or the [models page](https://platform.zharf.ai/models).

With CommonJS, the client is the `default` export:

```javascript
const { default: zharf, Zharf, ResponseError } = require('zharf')
```

### Browser Usage

To use the library without Node, import the browser module. It never reads environment variables.

```javascript
import { Zharf } from 'zharf/browser'

// A route on your own server that adds the key and forwards the request.
const zharf = new Zharf({ host: '/api/zharf' })
```

Do not put an API key in a web page: anyone who opens the page can read it and spend your balance. Keep the key on your server and point `host` at a route there, as in [examples/browser](examples/browser). If a key is passed to the client in a web page, the library prints a warning once; pass `dangerouslyAllowBrowser: true` to hide it, for example in a tool where each person pastes their own key.

## Streaming responses

Set `stream: true` and the call returns an async iterator of parts. The last part has `done: true`, the token usage and `cost_zharf`.

```javascript
import zharf from 'zharf'

const stream = await zharf.chat({
  model: 'qwen3.5-plus',
  messages: [{ role: 'user', content: 'Why is the sky blue?' }],
  stream: true,
})
for await (const part of stream) {
  process.stdout.write(part.message.content)
  if (part.done) console.log(`\n${part.cost_zharf} ZHARF`)
}
```

Call `stream.abort()` to stop one stream, or `zharf.abort()` to stop every stream the client has open. The loop reading an aborted stream throws an `AbortError`. Persian text arrives intact even when a letter is split between two chunks of network data.

## Cost

Answers carry `cost_zharf`, the request's cost in ZHARF, taken from the platform's `usage.cost_zharf` or its `x-zharf-cost` header:

| Call | Where |
|---|---|
| `chat`, `generate` | the answer; when streaming, the last part (`done: true`) |
| `embed`, `images.generate`, `audio.speech`, `audio.transcribe` | the answer |

When the platform reports no cost, the field is left out rather than set to 0. Prices per model are in [`list()`](#list): `pricing.prompt_per_1m_tokens`, `pricing.completion_per_1m_tokens`, and `pricing.per_unit` with `pricing.media_unit` for images, audio and other media. They hold until `prices_valid_until`.

## API

The library's API follows ollama-js. Requests go to the platform's OpenAI-compatible endpoints under `/v1`.

### chat

```javascript
zharf.chat(request)
```

- `request` `<Object>`: The request object containing chat parameters.
  - `model` `<string>`: The model id.
  - `messages` `<Message[]>`: The conversation so far.
    - `role` `<string>`: `'system'`, `'user'`, `'assistant'` or `'tool'`.
    - `content` `<string>`: The content of the message.
    - `images` `<Uint8Array[] | string[]>`: (Optional) Images as `Uint8Array`s, base64 strings, data URLs or http(s) URLs. In Node, also file paths.
    - `tool_calls` `<ToolCall[]>`: (Optional) Tool calls the assistant made, as returned in an earlier answer.
    - `tool_name` `<string>`: (Optional) For `role: 'tool'`: the tool whose result this is.
    - `tool_call_id` `<string>`: (Optional) For `role: 'tool'`: the call this answers. When it is left out, the call is found by `tool_name`.
  - `format` `<string | object>`: (Optional) `'json'` for JSON output, or a JSON schema for structured output.
  - `stream` `<boolean>`: (Optional) When true an `AsyncGenerator` is returned.
  - `think` `<boolean | "high" | "medium" | "low">`: (Optional) `true` shows the model's reasoning in `message.thinking`, a level also sets its reasoning effort, `false` hides it. Requires model support.
  - `tools` `<Tool[]>`: (Optional) Functions the model may call.
  - `options` `<Options>`: (Optional) Generation options (see below).
- Returns: `<ChatResponse>`: `{ model, created_at, message: { role, content, thinking?, tool_calls? }, done, done_reason, cost_zharf, usage, prompt_eval_count, eval_count }`

Ollama options map onto the platform's request like this:

| Option | Sent as |
|---|---|
| `temperature`, `top_p`, `top_k`, `seed` | the same name |
| `num_predict` | `max_tokens` (`-1` and `-2` mean no limit) |
| `stop` | `stop` (a string becomes a list) |
| `presence_penalty`, `frequency_penalty` | the same name |

Options that set up a local runner (`num_ctx`, `num_gpu`, `repeat_penalty` and the like) mean nothing for a hosted model and are not sent.

### generate

```javascript
zharf.generate(request)
```

- `request` `<Object>`: The request object containing generate parameters.
  - `model` `<string>`: The model id.
  - `prompt` `<string>`: The prompt to send to the model.
  - `system` `<string>`: (Optional) A system message sent before the prompt.
  - `images` `<Uint8Array[] | string[]>`: (Optional) Images, as in `chat`.
  - `format`, `stream`, `think`, `options`: (Optional) As in `chat`.
- Returns: `<GenerateResponse>`: like `ChatResponse`, with the text in `response` (and `thinking`) instead of `message`.

### list

```javascript
zharf.list()
```

- Returns: `<ListResponse>`: `{ models, prices_valid_until }`. Each model has `id`, `name`, `owned_by`, `context_length`, `max_completion_tokens`, `modality`, `input_modalities`, `output_modalities`, `features`, `supported_parameters` and `pricing` (`currency: 'ZHARF'`). This call needs no key.

### show

```javascript
zharf.show(request)
```

- `request` `<Object>`: The request object containing show parameters.
  - `model` `<string>`: The model id.
- Returns: `<ShowResponse>`: the model's entry, as in `list()`.

### embed

```javascript
zharf.embed(request)
```

- `request` `<Object>`: The request object containing embedding parameters.
  - `model` `<string>`: An embedding model's id (one whose `modality` is `'embedding'` in `list()`).
  - `input` `<string> | <string[]>`: The text or texts to embed.
  - `dimensions` `<number>`: (Optional) The size of the vectors, for models that support it.
- Returns: `<EmbedResponse>`: `{ model, embeddings, usage, cost_zharf }`, with `embeddings` in the order of `input`.

### images.generate

```javascript
zharf.images.generate(request)
```

- `request` `<Object>`: `model`, `prompt`, and optionally `n`, `size`, `quality`, `style`, `response_format` (`'url'` or `'b64_json'`). Other parameters a model accepts are passed through as they are.
- Returns: `<ImageResponse>`: `{ created, data: [{ url?, b64_json? }], cost_zharf }`

### audio.speech

```javascript
zharf.audio.speech(request)
```

- `request` `<Object>`: `model`, `input` (the text), and optionally `voice`, `response_format` and `speed`.
- Returns: `<SpeechResponse>`: `{ audio: Uint8Array, content_type, cost_zharf }`

### audio.transcribe

```javascript
zharf.audio.transcribe(request)
```

- `request` `<Object>`: `model`, `file` (a `Blob`, `File`, `Uint8Array` or `ArrayBuffer`; in Node, also a file path), and optionally `filename`, `language`, `prompt`, `response_format` and `temperature`.
- Returns: `<TranscribeResponse>`: `{ text, cost_zharf, ... }`. For `response_format` `'text'`, `'srt'` or `'vtt'`, `text` holds the whole answer.

### abort

```javascript
zharf.abort()
```

This method stops **all** streams currently running with the client instance. Loops reading them throw an `AbortError`. To stop one stream, call `abort()` on that stream. See [examples/abort.mjs](examples/abort.mjs).

## Tools

```javascript
import zharf from 'zharf'

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Current weather in a city',
      parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
    },
  },
]
const messages = [{ role: 'user', content: 'What is the weather in Tehran?' }]

const first = await zharf.chat({ model: 'deepseek-v3.2', messages, tools })
messages.push(first.message)
for (const call of first.message.tool_calls ?? []) {
  // call.function.arguments is already an object; getWeather is your own function.
  messages.push({ role: 'tool', content: JSON.stringify(getWeather(call.function.arguments)), tool_name: call.function.name })
}
const final = await zharf.chat({ model: 'deepseek-v3.2', messages, tools })
```

Each tool call in an answer keeps the `id` the platform gave it, and a tool result is matched to its call by `tool_call_id` or, when that is left out, by `tool_name`. Ollama-style code that sends only `tool_name` works unchanged. The full example is [examples/tools.mjs](examples/tools.mjs).

## Errors

A failed request throws a `ResponseError`:

| Field | |
|---|---|
| `status_code` | the HTTP status |
| `error`, `message` | the message in English |
| `message_fa` | the same message in Persian, ready to show to people |
| `code` | the platform's error code |
| `retry_after` | seconds to wait before trying again (on 429) |

```javascript
import zharf, { ResponseError } from 'zharf'

try {
  await zharf.chat({ model: 'deepseek-v3.2', messages: [{ role: 'user', content: 'سلام' }] })
} catch (error) {
  if (error instanceof ResponseError && error.status_code === 402) {
    console.log(error.message_fa) // the balance has run out
  }
}
```

| Status | `code` | Meaning |
|---|---|---|
| 401 | `no_key`, `bad_key` | The key is missing, wrong or revoked. |
| 402 | `insufficient_balance` | The account's balance has run out. |
| 402 | `key_spend_limit` | The key has reached its spending limit. |
| 403 | `model_not_offered` | The model is not available on the platform; the message says why. |
| 404 | `model_not_found` | No model has this id. |
| 429 | `rate_limit`, `too_many_inflight` | Too many requests per minute, or too many at once. Wait `retry_after` seconds. |
| 503 | | The models are unavailable for the moment. Try again shortly. |

A stream that fails part-way throws from the loop reading it.

## Custom client

A custom client can be created with the following fields:

- `host` `<string>`: (Optional) The platform's address. Default: `"https://platform.zharf.ai"`. A trailing `/v1` is accepted, and a path such as `/api/zharf` points the client at a route on your own server.
- `apiKey` `<string>`: (Optional) A `zk-…` key. Default in Node: the `ZHARF_API_KEY` environment variable.
- `fetch` `<Object>`: (Optional) The fetch function used to make requests.
- `headers` `<Object>`: (Optional) Custom headers to include with every request.
- `dangerouslyAllowBrowser` `<boolean>`: (Optional) Hides the warning about a key used in a web page.

```javascript
import { Zharf } from 'zharf'

const zharf = new Zharf({ apiKey: process.env.MY_ZHARF_KEY })
const response = await zharf.chat({
  model: 'deepseek-v3.2',
  messages: [{ role: 'user', content: 'Why is the sky blue?' }],
})
```

In Node, `ZHARF_API_KEY` and `ZHARF_BASE_URL` are read when each request is made, so a key loaded after the import is still used. The `apiKey` option comes first, then an `Authorization` header passed in `headers`, then `ZHARF_API_KEY`.

## Custom Headers

You can set custom headers that will be included with every request:

```javascript
import { Zharf } from 'zharf'

const zharf = new Zharf({
  headers: {
    'X-Custom-Header': 'custom-value',
    'User-Agent': 'MyApp/1.0',
  },
})
```

Every answer from the platform has an `x-zharf-request-id` header. If you ask support about a request, send that id.

## Coming from ollama-js

The import and the calls stay the same; change the package name and the model ids.

```diff
- import ollama from 'ollama'
+ import zharf from 'zharf'
- const response = await ollama.chat({ model: 'llama3.1', messages })
+ const response = await zharf.chat({ model: 'deepseek-v3.2', messages })
```

- The same: `chat`, `generate`, `list`, `show`, `embed`, `abort`, `stream: true` with `abort()` on the stream, `options`, `think`, `format`, `tools`, `images`, `zharf/browser`.
- Added: `cost_zharf` and `usage` on answers, `id` on tool calls, `images.generate`, `audio.speech`, `audio.transcribe`, and `ResponseError` with `message_fa`, `code` and `retry_after`.
- Different: `list()` and `show()` return the platform's model entries with prices, not local model files. Answers carry token counts (`prompt_eval_count`, `eval_count`) but no durations.
- Not here, because there is nothing local to manage: `pull`, `push`, `create`, `delete`, `copy`, `ps`.

## Development

```sh
npm install
npm run build      # dist/: ESM, CommonJS and types
npm test           # vitest, with a mocked fetch
npm run typecheck  # sources, tests and examples
```

## License

[MIT](LICENSE). To report a security problem, see [SECURITY.md](SECURITY.md).

---

<div dir="rtl" lang="fa">

## فارسی

zharf کتابخانه متن‌باز JavaScript و TypeScript برای کار با [پلتفرم API ژرف](https://platform.zharf.ai) است. با این کتابخانه می‌توانید با مدل‌ها گفت‌وگو کنید، پاسخ را استریم کنید، از فراخوانی ابزار (tool calling) استفاده کنید، امبدینگ بگیرید، تصویر بسازید و متن را به صدا یا صدا را به متن تبدیل کنید. هزینه هر درخواست هم در خود پاسخ می‌آید.

API این کتابخانه شبیه ollama-js است، پس کدی که برای Ollama نوشته‌اید با کمی تغییر اینجا هم کار می‌کند. به هیچ بسته دیگری وابسته نیست و روی Node 18 به بالا، Deno و مرورگر اجرا می‌شود.

### نصب

```
npm i zharf
```

در [صفحه کلیدهای API](https://platform.zharf.ai/keys) یک کلید جدید بسازید و آن را در متغیر محیطی `ZHARF_API_KEY` بگذارید. کتابخانه کلید را خودش از همین متغیر برمی‌دارد و لازم نیست آن را در کد بنویسید.

```
export ZHARF_API_KEY="zk-..."
```

### اولین درخواست

```javascript
import zharf from 'zharf'

const response = await zharf.chat({
  model: 'deepseek-v3.2',
  messages: [{ role: 'user', content: 'سه ایده برای نام یک کافه بده' }],
})
console.log(response.message.content)
console.log(response.cost_zharf) // هزینه این درخواست، به ژرف (واحد اعتبار پلتفرم)
```

شناسه مدل‌ها را در `zharf.list()` یا [صفحه مدل‌ها](https://platform.zharf.ai/models) پیدا کنید. فهرست مدل‌ها و قیمتشان را بدون کلید هم می‌شود گرفت.

### استریم

اگر `stream: true` بفرستید، پاسخ همان‌طور که مدل می‌نویسد تکه‌تکه می‌رسد. آخرین تکه `done: true` دارد و تعداد توکن‌ها و هزینه درخواست در آن است.

```javascript
const stream = await zharf.chat({ model: 'qwen3.5-plus', messages, stream: true })
for await (const part of stream) {
  process.stdout.write(part.message.content)
  if (part.done) console.log(part.cost_zharf)
}
```

`stream.abort()` همان یک استریم را قطع می‌کند و `zharf.abort()` همه استریم‌های باز را. متن فارسی درست می‌رسد، حتی اگر بایت‌های یک حرف در دو تکه جدا از شبکه برسند.

### خطاها

خطاها از نوع `ResponseError` هستند. کد وضعیت HTTP در `status_code` است، کد خطای پلتفرم در `code` و متن فارسی خطا در `message_fa`. این متن را می‌توانید همان‌طور که هست به کاربرانتان نشان دهید. اگر از سقف درخواست‌های کلید رد شوید (خطای `429`)، `retry_after` می‌گوید چند ثانیه صبر کنید.

```javascript
import zharf, { ResponseError } from 'zharf'

try {
  await zharf.chat({ model: 'deepseek-v3.2', messages: [{ role: 'user', content: 'سلام' }] })
} catch (error) {
  if (error instanceof ResponseError) console.log(error.message_fa)
}
```

### در مرورگر

کلید API را در صفحه وب نگذارید؛ هر کسی صفحه را باز کند می‌تواند آن را بخواند و از اعتبار حسابتان خرج کند. کلید را روی سرور خودتان نگه دارید و آنجا اندپوینتی بسازید که کلید را به درخواست اضافه کند و درخواست را به پلتفرم بفرستد. بعد در صفحه از `zharf/browser` استفاده کنید و `host` را آدرس همان اندپوینت بگذارید:

```javascript
import { Zharf } from 'zharf/browser'

const zharf = new Zharf({ host: '/api/zharf' })
```

نمونه کامل در [examples/browser](examples/browser) است. اگر در صفحه وب کلیدی به کتابخانه بدهید، یک بار در کنسول هشدار می‌دهد.

### اگر با ollama-js کار کرده‌اید

نام بسته و شناسه مدل را عوض کنید؛ بقیه کد دست نمی‌خورد. متدهای `chat`، `generate`، `list`، `show`، `embed` و `abort` و گزینه‌هایی مثل `temperature`، `num_predict`، `think` و `format` مثل ollama-js کار می‌کنند. متدهایی که فقط به کار مدل‌های لوکال می‌آیند، مثل `pull` و `create`، اینجا نیستند.

### مشکل امنیتی

اگر به مشکل امنیتی برخوردید، آن را در issue عمومی ننویسید و به security@zharf.ai ایمیل بزنید. جزئیات در [SECURITY.md](SECURITY.md) آمده است.

### لایسنس

MIT. متن کامل در [LICENSE](LICENSE) است.

</div>
