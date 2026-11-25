import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Zharf } from '../src/index'
import type { Message, Tool } from '../src/index'
import { completion, json, mockFetch } from './helpers'

beforeEach(() => {
  vi.stubEnv('ZHARF_API_KEY', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const weather: Tool = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Current weather in a city',
    parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  },
}

describe('tools', () => {
  it('sends tools as they are and parses the calls in the answer', async () => {
    const { fetch, calls } = mockFetch(() =>
      json(
        completion({
          content: null,
          tool_calls: [
            { id: 'call_9', type: 'function', function: { name: 'get_weather', arguments: '{"city":"شیراز"}' } },
            { id: 'call_10', type: 'function', function: { name: 'get_weather', arguments: '{not json' } },
          ],
        }),
      ),
    )
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const res = await zharf.chat({ model: 'm', messages: [{ role: 'user', content: 'هوای شیراز؟' }], tools: [weather] })

    expect(calls[0].body.tools).toStrictEqual([weather])
    expect(res.message.content).toBe('')
    expect(res.message.tool_calls).toStrictEqual([
      { id: 'call_9', function: { name: 'get_weather', arguments: { city: 'شیراز' } } },
      { id: 'call_10', function: { name: 'get_weather', arguments: {}, raw_arguments: '{not json' } },
    ])
  })

  it('round-trips the call ids on the next turn', async () => {
    const { fetch, calls } = mockFetch(
      () =>
        json(
          completion({
            content: '',
            tool_calls: [
              { id: 'call_x', type: 'function', function: { name: 'get_weather', arguments: '{"city":"تبریز"}' } },
            ],
          }),
        ),
      () => json(completion({ content: 'تبریز آفتابی است.' })),
    )
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    const messages: Message[] = [{ role: 'user', content: 'هوای تبریز؟' }]
    const first = await zharf.chat({ model: 'm', messages, tools: [weather] })
    messages.push(first.message)
    messages.push({ role: 'tool', content: '{"sky":"sunny"}', tool_name: 'get_weather' })
    await zharf.chat({ model: 'm', messages, tools: [weather] })

    expect(calls[1].body.messages).toStrictEqual([
      { role: 'user', content: 'هوای تبریز؟' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_x', type: 'function', function: { name: 'get_weather', arguments: '{"city":"تبریز"}' } }],
      },
      { role: 'tool', content: '{"sky":"sunny"}', tool_call_id: 'call_x' },
    ])
  })

  it('gives ids to Ollama-style calls and matches the answers by tool name', async () => {
    const { fetch, calls } = mockFetch(() => json(completion({ content: 'ok' })))
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    await zharf.chat({
      model: 'm',
      messages: [
        { role: 'user', content: 'weather and time in Tehran?' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { function: { name: 'get_weather', arguments: { city: 'Tehran' } } },
            { function: { name: 'get_time', arguments: { zone: 'Asia/Tehran' } } },
          ],
        },
        // Answered in the other order.
        { role: 'tool', content: '12:00', tool_name: 'get_time' },
        { role: 'tool', content: 'sunny', tool_name: 'get_weather' },
      ],
    })
    const [, assistant, time, weatherAnswer] = calls[0].body.messages
    expect(assistant.tool_calls).toStrictEqual([
      { id: 'call_0', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Tehran"}' } },
      { id: 'call_1', type: 'function', function: { name: 'get_time', arguments: '{"zone":"Asia/Tehran"}' } },
    ])
    expect(time).toStrictEqual({ role: 'tool', content: '12:00', tool_call_id: 'call_1' })
    expect(weatherAnswer).toStrictEqual({ role: 'tool', content: 'sunny', tool_call_id: 'call_0' })
  })

  it('keeps an explicit tool_call_id and drops thinking from earlier turns', async () => {
    const { fetch, calls } = mockFetch(() => json(completion({ content: 'ok' })))
    const zharf = new Zharf({ apiKey: 'zk-test', fetch })
    await zharf.chat({
      model: 'm',
      messages: [
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: 'checking',
          thinking: 'hmm',
          tool_calls: [{ id: 'abc', function: { name: 'f', arguments: {} } }],
        },
        { role: 'tool', content: 'r', tool_call_id: 'abc' },
      ],
    })
    expect(calls[0].body.messages[1]).toStrictEqual({
      role: 'assistant',
      content: 'checking',
      tool_calls: [{ id: 'abc', type: 'function', function: { name: 'f', arguments: '{}' } }],
    })
    expect(calls[0].body.messages[2]).toStrictEqual({ role: 'tool', content: 'r', tool_call_id: 'abc' })
  })
})
