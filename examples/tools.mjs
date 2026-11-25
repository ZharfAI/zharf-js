// Let the model call a function, run it, and send the result back.
//   node examples/tools.mjs
import zharf from 'zharf'

/**
 * A stand-in for a real weather service.
 * @param {{ city: string }} args
 */
function getWeather({ city }) {
  /** @type {Record<string, string>} */
  const weather = { تهران: 'آفتابی، ۱۸ درجه', تبریز: 'ابری، ۹ درجه' }
  return JSON.stringify({ city, weather: weather[city] ?? 'نامعلوم' })
}

/** @type {import('zharf').Tool[]} */
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Current weather in a city',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: 'City name in Persian' } },
        required: ['city'],
      },
    },
  },
]

/** @type {import('zharf').Message[]} */
const messages = [{ role: 'user', content: 'هوای تهران و تبریز الان چطور است؟' }]

const first = await zharf.chat({ model: 'deepseek-v3.2', messages, tools })
messages.push(first.message)

for (const call of first.message.tool_calls ?? []) {
  if (call.function.name !== 'get_weather') continue
  const output = getWeather(/** @type {{ city: string }} */ (call.function.arguments))
  console.log(`get_weather(${JSON.stringify(call.function.arguments)}) → ${output}`)
  // tool_name is enough: the library matches the answer to its call.
  messages.push({ role: 'tool', content: output, tool_name: 'get_weather' })
}

const final = await zharf.chat({ model: 'deepseek-v3.2', messages, tools })
console.log(`\n${final.message.content}`)
