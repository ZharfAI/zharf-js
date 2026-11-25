// Stop a stream part-way: stream.abort() stops one, zharf.abort() stops every open stream.
//   node examples/abort.mjs
import zharf from 'zharf'

const stream = await zharf.chat({
  model: 'deepseek-v3.2',
  messages: [{ role: 'user', content: 'Write a long story about a lighthouse keeper.' }],
  stream: true,
})

setTimeout(() => {
  console.log('\n\n[stopping after one second]')
  stream.abort()
}, 1000)

try {
  for await (const part of stream) process.stdout.write(part.message.content)
} catch (error) {
  if (error instanceof Error && error.name === 'AbortError') console.log('The stream was stopped.')
  else throw error
}
