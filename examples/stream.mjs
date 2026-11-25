// Print the answer as it is written. The last part has done: true and the cost.
//   node examples/stream.mjs
import zharf from 'zharf'

const stream = await zharf.chat({
  model: 'qwen3.5-plus',
  messages: [{ role: 'user', content: 'در دو جمله توضیح بده چرا آسمان آبی است.' }],
  stream: true,
})

for await (const part of stream) {
  if (part.message.thinking) process.stdout.write(`\x1b[2m${part.message.thinking}\x1b[0m`)
  process.stdout.write(part.message.content)
  if (part.done) console.log(`\n\ncost: ${part.cost_zharf} ZHARF`)
}
