// Step 2 of retrieval: turn text into numbers that stand for its meaning.
//
// Pieces about similar things end up with similar numbers even when they share
// no words, which is how "food brought to my house" can find a note about
// delivery. The model runs on your own machine through transformers.js: free,
// no key. The first run downloads it (about 25 MB) into .data/models, later
// runs work offline.

import path from 'node:path'
import { env, pipeline } from '@huggingface/transformers'
import { config } from '../config.ts'

// Keep the model inside the kit folder rather than a hidden global cache.
env.cacheDir = path.join(config.dataDir, 'models')

type Extractor = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{
  tolist(): number[][]
}>

// One pipeline per model, created the first time it is needed and then reused.
const extractors = new Map<string, Promise<Extractor>>()

function extractorFor(model: string): Promise<Extractor> {
  let p = extractors.get(model)
  if (!p) {
    // q8 is the small quantised file (about 25 MB for MiniLM) and plenty accurate for search.
    p = (pipeline('feature-extraction', model, { dtype: 'q8' }) as unknown as Promise<Extractor>).catch((err) => {
      extractors.delete(model) // let the next call try again
      throw new Error(
        `Could not load the embedding model ${model} (${(err as Error).message}). ` +
          'The first run downloads it from Hugging Face, so it needs internet; after that it works offline. ' +
          'Check your connection and run the command again.',
      )
    })
    extractors.set(model, p)
  }
  return p
}

/** Embed with a named model. Vectors come back normalised, so a dot product is the cosine similarity. */
export async function embedWith(model: string, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const extract = await extractorFor(model)
  const out: number[][] = []
  // Small batches keep memory flat on big folders.
  for (let i = 0; i < texts.length; i += 16) {
    const batch = texts.slice(i, i + 16)
    const tensor = await extract(batch, { pooling: 'mean', normalize: true })
    out.push(...tensor.tolist())
  }
  return out
}

/** Embed with the model the config names (EMBED_MODEL). */
export function embed(texts: string[]): Promise<number[][]> {
  return embedWith(config.search.embedModel, texts)
}

/** Cosine similarity. Our vectors are already normalised, but this stays correct if one is not. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}
