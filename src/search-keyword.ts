// Keyword search. Part 2 of the roadmap.
//
// The simplest search that works: split every note into chunks at blank
// lines, then score each chunk by how many of the question's words it
// contains. No model, no download, no index file. Part 3 explains why this
// breaks (it cannot tell that "drop off" means "deliver") and replaces it with
// meaning based search behind the same search() function.

import { loadNotes } from './notes.ts'
import type { Note, SearchHit } from './types.ts'

// Small words that appear everywhere and say nothing about the topic.
const STOP_WORDS = new Set(
  (
    'a an and are as at be but by can do does for from how i if in is it its me my ' +
    'no not of on or our so than that the their them then there these they this ' +
    'to was we what when where which who why will with you your'
  ).split(' '),
)

/** Lowercase words, stop words and one letter words removed. */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOP_WORDS.has(w))
}

/**
 * A query word matches a note word when one starts with the other and they
 * share at least four letters. That is a crude stand in for stemming, so
 * "deliver" finds "delivers" and "delivery". Short words must match exactly.
 */
function matches(queryTerm: string, word: string): boolean {
  if (queryTerm === word) return true
  if (queryTerm.length < 4 || word.length < 4) return false
  return word.startsWith(queryTerm) || queryTerm.startsWith(word)
}

interface Chunk {
  source: string
  text: string
  internal: boolean
  title: string
}

/**
 * Split a note on blank lines. The note's own title line ("# Delivery") is
 * dropped, because the title is scored separately. A section heading on its
 * own ("## Plates") is joined to the paragraph after it.
 */
export function chunkNote(note: Note): Chunk[] {
  const paragraphs = note.text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^#\s[^\n]*$/.test(p))
  const merged: string[] = []
  let pendingHeading = ''
  for (const p of paragraphs) {
    const isHeadingOnly = /^#+\s/.test(p) && !p.includes('\n')
    if (isHeadingOnly) {
      pendingHeading = pendingHeading ? `${pendingHeading}\n${p}` : p
      continue
    }
    merged.push(pendingHeading ? `${pendingHeading}\n${p}` : p)
    pendingHeading = ''
  }
  if (pendingHeading) merged.push(pendingHeading)
  return merged.map((text, i) => ({ source: `${note.id}#${i}`, text, internal: note.internal, title: note.title }))
}

export function keywordSearch(query: string, opts: { k: number; includeInternal: boolean }): SearchHit[] {
  const queryTerms = [...new Set(terms(query))]
  if (queryTerms.length === 0) return []

  const hits: SearchHit[] = []
  for (const note of loadNotes()) {
    if (note.internal && !opts.includeInternal) continue
    const titleWords = terms(note.title)
    for (const chunk of chunkNote(note)) {
      const words = terms(chunk.text)
      if (words.length === 0) continue
      let distinct = 0
      let occurrences = 0
      let titleBonus = 0
      for (const q of queryTerms) {
        const count = words.filter((w) => matches(q, w)).length
        if (count > 0) distinct += 1
        occurrences += count
        if (titleWords.some((w) => matches(q, w))) titleBonus += 0.5
      }
      if (distinct === 0) continue
      // Mostly: how many different question words appear. Then a nudge for
      // chunks from a note whose title matches, and for short, focused chunks.
      const score = distinct + titleBonus + occurrences / words.length
      hits.push({ source: chunk.source, text: chunk.text, score: Number(score.toFixed(3)), internal: chunk.internal })
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, opts.k)
}
