// Step 4 of retrieval: turn the question into numbers the same way, find the
// closest pieces, hand those to the model.
//
// This is an exact scan: compare the question with every single vector. The
// post's first bug came from adding a clustering index to make this "faster"
// on a corpus far too small to need it; it returned zero results for real
// questions. At this size a full scan takes well under a millisecond and never
// misses (bugs.ts shows the difference). Add an index only when you have
// thousands of pieces and have measured a need.

import { config } from '../config.ts'
import type { SearchHit } from '../types.ts'
import { embedWith } from './embed.ts'
import { currentSettings, ensureIndex, IndexMismatchError, type Index, type IndexSettings } from './store.ts'

export interface ScanOptions {
  k: number
  includeInternal: boolean
  minScore?: number
}

/** Score every piece against a query vector. Pure maths, no I/O. */
export function exactScan(index: Index, queryVector: number[], opts: ScanOptions): SearchHit[] {
  const minScore = opts.minScore ?? config.search.minScore
  const hits: SearchHit[] = []
  for (const c of index.chunks) {
    if (c.internal && !opts.includeInternal) continue
    let score = 0
    for (let i = 0; i < queryVector.length; i++) score += queryVector[i] * c.vector[i]
    if (score < minScore) continue
    hits.push({ source: c.source, text: c.text, score: Number(score.toFixed(3)), internal: c.internal })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, opts.k)
}

/** Semantic search against an index described by `settings` (the config by default). */
export async function searchWith(
  query: string,
  opts: ScanOptions,
  settings: IndexSettings = currentSettings(),
): Promise<SearchHit[]> {
  const { index, status } = await ensureIndex(settings)
  if (status === 'rebuilt-stale') {
    console.error('[retrieval] The notes changed since the index was built, so it was rebuilt first.')
  }
  if (status === 'rebuilt-settings') {
    console.error('[retrieval] CHUNK_CHARS or CHUNK_OVERLAP changed since the index was built, so it was rebuilt first.')
  }
  const [q] = await embedWith(settings.embedModel, [query])
  if (index.chunks.length && q.length !== index.meta.dims) {
    throw new IndexMismatchError(
      `The index holds ${index.meta.dims} dimension vectors but "${settings.embedModel}" produced ${q.length}. ` +
        'Rebuild it with: npm run part3:index',
    )
  }
  return exactScan(index, q, opts)
}

/** The contract src/search.ts calls in semantic mode. */
export async function semanticSearch(query: string, opts: { k: number; includeInternal: boolean }): Promise<SearchHit[]> {
  return searchWith(query, opts)
}
