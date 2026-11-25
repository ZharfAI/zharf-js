// Embed a few sentences and compare them. The embedding model is picked from list().
//   node examples/embed.mjs
import zharf from 'zharf'

const { models } = await zharf.list()
const embedder = models.find((m) => m.modality === 'embedding' || m.operations?.includes('embedding'))
if (!embedder) throw new Error('No embedding model is listed right now.')

const sentences = ['امروز هوا آفتابی است.', 'آسمان امروز صاف و روشن است.', 'قیمت دلار بالا رفت.']
const { embeddings, cost_zharf } = await zharf.embed({ model: embedder.id, input: sentences })

/** @param {number[]} a @param {number[]} b */
const cosine = (a, b) => {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / Math.sqrt(na * nb)
}

console.log(`${embedder.id}: ${embeddings[0].length} dimensions, cost ${cost_zharf} ZHARF`)
console.log(`1 ↔ 2: ${cosine(embeddings[0], embeddings[1]).toFixed(3)}`)
console.log(`1 ↔ 3: ${cosine(embeddings[0], embeddings[2]).toFixed(3)}`)
