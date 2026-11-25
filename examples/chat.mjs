// A single question and answer.
//   export ZHARF_API_KEY="zk-..."
//   node examples/chat.mjs
import zharf from 'zharf'

const response = await zharf.chat({
  model: 'deepseek-v3.2',
  messages: [{ role: 'user', content: 'سه ایده برای نام یک کافه بده' }],
})

console.log(response.message.content)
console.log(`\ncost: ${response.cost_zharf} ZHARF (${response.prompt_eval_count} in, ${response.eval_count} out)`)
