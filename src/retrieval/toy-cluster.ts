// A toy clustering index, kept only to reproduce bug 1 from the post.
// Do not use this for real search. src/retrieval/search-semantic.ts does an
// exact scan instead, which is the fix.
//
// How this kind of index works (pgvector's IVFFlat index type is built on the same idea):
//   1. Learn a number of cluster centres ("lists") from the vectors.
//   2. File every vector under its nearest centre.
//   3. At question time, find the centre nearest the question and search
//      only the vectors filed under it ("probes = 1").
// On a big corpus that skips most of the work. On a small one, some centres
// end up with nothing filed under them. A question that lands nearest an
// empty centre gets zero results, even though the answer is sitting right
// there under another centre.

import { config } from '../config.ts'
import type { SearchHit } from '../types.ts'
import type { Index } from './store.ts'

export interface ClusterIndex {
  lists: number
  seed: number
  centres: number[][]
  /** members[c] = positions in index.chunks filed under centre c. */
  members: number[][]
}

/** A small seeded random number generator (mulberry32), so every run is identical. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const dot = (a: number[], b: number[]) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}
const normalise = (v: number[]) => {
  const n = Math.sqrt(dot(v, v)) || 1
  return v.map((x) => x / n)
}
const nearest = (centres: number[][], v: number[]) => {
  let best = 0
  let bestScore = -Infinity
  centres.forEach((c, i) => {
    const s = dot(c, v)
    if (s > bestScore) {
      bestScore = s
      best = i
    }
  })
  return best
}

/**
 * Learn `lists` centres with k means (cosine flavour). Each centre starts as a
 * random blend of two of the vectors, picked with a seeded generator. A centre
 * that ends a round with no vectors keeps its position, which is exactly how
 * empty clusters survive into the finished index.
 */
export function buildClusterIndex(index: Index, lists: number, seed: number, rounds = 10): ClusterIndex {
  const vectors = index.chunks.map((c) => c.vector)
  const rand = seededRandom(seed)
  const pick = () => vectors[Math.floor(rand() * vectors.length)]
  let centres = Array.from({ length: lists }, () => {
    const a = pick()
    const b = pick()
    const w = rand()
    return normalise(a.map((x, i) => w * x + (1 - w) * b[i]))
  })
  let members: number[][] = []
  for (let r = 0; r < rounds; r++) {
    members = centres.map(() => [])
    vectors.forEach((v, i) => members[nearest(centres, v)].push(i))
    centres = centres.map((c, j) => {
      if (members[j].length === 0) return c // empty: stays where it was
      const sum = new Array(c.length).fill(0)
      for (const i of members[j]) vectors[i].forEach((x, d) => (sum[d] += x))
      return normalise(sum)
    })
  }
  members = centres.map(() => [])
  vectors.forEach((v, i) => members[nearest(centres, v)].push(i))
  return { lists, seed, centres, members }
}

/** Search only the nearest cluster, like an IVF index with probes = 1. */
export function clusterSearch(
  index: Index,
  cluster: ClusterIndex,
  queryVector: number[],
  opts: { k: number; includeInternal: boolean; minScore?: number },
): { hits: SearchHit[]; cluster: number; clusterSize: number } {
  const minScore = opts.minScore ?? config.search.minScore
  const c = nearest(cluster.centres, queryVector)
  const hits: SearchHit[] = []
  for (const i of cluster.members[c]) {
    const chunk = index.chunks[i]
    if (chunk.internal && !opts.includeInternal) continue
    const score = dot(queryVector, chunk.vector)
    if (score < minScore) continue
    hits.push({ source: chunk.source, text: chunk.text, score: Number(score.toFixed(3)), internal: chunk.internal })
  }
  hits.sort((a, b) => b.score - a.score)
  return { hits: hits.slice(0, opts.k), cluster: c, clusterSize: cluster.members[c].length }
}
