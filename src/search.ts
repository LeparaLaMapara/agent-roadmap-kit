// The one search function every part calls.
//
// Part 2 starts with plain keyword matching (src/search-keyword.ts). Part 3
// swaps in meaning based search (src/retrieval/). SEARCH_MODE in .env picks.
// The semantic code is imported only when used, so Part 2 never downloads a
// model.

import { config } from './config.ts'
import type { SearchHit, SearchOptions } from './types.ts'

export async function search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
  const k = opts.k ?? config.search.topK
  const includeInternal = opts.includeInternal ?? false
  const hits =
    config.search.mode === 'keyword'
      ? (await import('./search-keyword.ts')).keywordSearch(query, { k, includeInternal })
      : await (await import('./retrieval/search-semantic.ts')).semanticSearch(query, { k, includeInternal })
  // Belt and braces: whatever the search did, private notes stay out unless asked for.
  return includeInternal ? hits : hits.filter((h) => !h.internal)
}

/** How search results are shown to a model: one block per hit, with its source. */
export function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return 'No matching notes found.'
  return hits.map((h) => `[source: ${h.source}] ${h.text.trim()}`).join('\n\n')
}
