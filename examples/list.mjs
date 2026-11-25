// List the models and their prices. This needs no key.
//   node examples/list.mjs
import zharf from 'zharf'

const { models, prices_valid_until } = await zharf.list()
console.log(`${models.length} models; prices fixed until ${prices_valid_until}\n`)

const chat = models
  .filter((m) => m.output_modalities.includes('text') && m.features.includes('streaming'))
  .filter((m) => m.pricing.prompt_per_1m_tokens > 0)
  .sort((a, b) => a.pricing.prompt_per_1m_tokens - b.pricing.prompt_per_1m_tokens)

console.log('Five cheapest chat models (ZHARF per million tokens, in / out):')
for (const m of chat.slice(0, 5)) {
  console.log(`  ${m.id.padEnd(40)} ${m.pricing.prompt_per_1m_tokens} / ${m.pricing.completion_per_1m_tokens}`)
}

const model = await zharf.show({ model: chat[0].id })
console.log(`\n${model.id}: context ${model.context_length} tokens, features: ${model.features.join(', ')}`)
