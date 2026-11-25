// A tiny server for the browser example. It serves the page and the library, and forwards two
// API routes to the platform with the key added here, so the key never reaches the browser.
//   npm run build
//   export ZHARF_API_KEY="zk-..."
//   node examples/browser/server.mjs     → open http://localhost:3000 (PORT=… for another port)
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const dist = join(here, '..', '..', 'dist')
const platform = process.env.ZHARF_BASE_URL?.replace(/\/+$/, '').replace(/\/v1$/, '') || 'https://platform.zharf.ai'
const key = process.env.ZHARF_API_KEY
if (!key) throw new Error('Set ZHARF_API_KEY first.')
const port = Number(process.env.PORT) || 3000

// Only what the page needs. An open forwarder would let anyone spend the balance.
const allowed = new Set(['POST /v1/chat/completions', 'GET /v1/models'])
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }

/** @param {import('node:http').IncomingMessage} req */
async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname.startsWith('/api/zharf/')) {
      const path = url.pathname.slice('/api/zharf'.length)
      if (!allowed.has(`${req.method} ${path}`)) {
        res.writeHead(404).end()
        return
      }
      const platformAnswer = await fetch(platform + path, {
        method: req.method,
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          accept: String(req.headers.accept ?? 'application/json'),
        },
        body: req.method === 'POST' ? await readBody(req) : undefined,
      })
      res.writeHead(platformAnswer.status, {
        'content-type': platformAnswer.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-cache',
      })
      if (!platformAnswer.body) {
        res.end()
        return
      }
      const reader = platformAnswer.body.getReader()
      req.on('close', () => reader.cancel().catch(() => {}))
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
      res.end()
      return
    }

    if (url.pathname.startsWith('/dist/')) {
      const file = normalize(join(dist, url.pathname.slice('/dist/'.length)))
      if (!file.startsWith(dist)) {
        res.writeHead(403).end()
        return
      }
      res.writeHead(200, { 'content-type': types[/** @type {'.js'} */ (extname(file))] ?? 'application/octet-stream' })
      res.end(await readFile(file))
      return
    }

    res.writeHead(200, { 'content-type': types['.html'] })
    res.end(await readFile(join(here, 'index.html')))
  } catch (error) {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(String(error))
  }
}).listen(port, () => console.log(`http://localhost:${port}`))
