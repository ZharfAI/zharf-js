import { Zharf as ZharfBrowser } from './browser.js'
import { defaultHost } from './constant.js'
import type { TranscribeRequest } from './interfaces.js'
import { formatHost, imageToURL, isBrowser } from './utils.js'
import { version } from './version.js'

/** Reads an environment variable at request time, so a key set after import is still seen. */
function readEnv(name: string): string | undefined {
  if (typeof process === 'undefined' || !process?.env) return undefined
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

/** A file's bytes, or undefined when the string is not a path to a file. */
async function readFileIfExists(path: string): Promise<Uint8Array | undefined> {
  if (path.length > 4096 || /^(data:|https?:\/\/)/i.test(path)) return undefined
  try {
    const { readFile, stat } = await import('node:fs/promises')
    if (!(await stat(path)).isFile()) return undefined
    return new Uint8Array(await readFile(path))
  } catch {
    return undefined
  }
}

/**
 * The Node client. Same API as the browser one, plus: the key defaults to `ZHARF_API_KEY`, the
 * address to `ZHARF_BASE_URL`, and images and audio can be given as file paths.
 */
export class Zharf extends ZharfBrowser {
  protected override resolveHost(): string {
    return formatHost(this.config.host ?? readEnv('ZHARF_BASE_URL') ?? defaultHost)
  }

  protected override envApiKey(): string | undefined {
    return readEnv('ZHARF_API_KEY')
  }

  protected override clientHeaders(): Record<string, string> {
    if (isBrowser()) return {}
    const node =
      typeof process !== 'undefined' && process.versions?.node
        ? ` (${process.arch} ${process.platform} Node.js/${process.version})`
        : ''
    return { 'user-agent': `zharf-js/${version}${node}` }
  }

  protected override async imageURL(image: Uint8Array | string): Promise<string> {
    if (typeof image === 'string') {
      const bytes = await readFileIfExists(image)
      if (bytes) return imageToURL(bytes)
    }
    return super.imageURL(image)
  }

  protected override async audioFile(
    file: TranscribeRequest['file'],
    filename?: string,
  ): Promise<{ blob: Blob; name: string }> {
    if (typeof file === 'string') {
      const { readFile } = await import('node:fs/promises')
      const { basename } = await import('node:path')
      const bytes = new Uint8Array(await readFile(file))
      return super.audioFile(bytes, filename ?? basename(file))
    }
    return super.audioFile(file, filename)
  }
}

export default new Zharf()

// Export the types from the entry point so code that imports them needs no deep paths.
export * from './interfaces.js'
export { ResponseError } from './utils.js'
export type { AbortableAsyncIterator } from './utils.js'
