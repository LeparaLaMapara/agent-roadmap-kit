// Step 1 of retrieval: cut each note into pieces. Part 3 of the roadmap.
//
// Not whole notes, because most of a note is irrelevant to any one question.
// Not sentences, because a sentence on its own loses its meaning. The rule the
// post describes: cut on paragraph boundaries at roughly CHUNK_CHARS
// characters, and carry about CHUNK_OVERLAP characters of the previous piece
// into the next one, so an idea that straddles a boundary is not sliced in half.
//
// Same input, same settings, same pieces, every time. No randomness here.

import type { Note } from '../types.ts'

export interface Chunk {
  /** "delivery.md#0": file name and piece number, the same shape keyword search uses. */
  source: string
  noteId: string
  text: string
  internal: boolean
}

export interface ChunkSettings {
  chunkChars: number
  overlapChars: number
}

/** Split text into paragraphs. A heading on its own is kept with the paragraph after it. */
function paragraphs(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const out: string[] = []
  let heading = ''
  for (const p of raw) {
    if (/^#+\s/.test(p) && !p.includes('\n')) {
      heading = heading ? `${heading}\n${p}` : p
      continue
    }
    out.push(heading ? `${heading}\n${p}` : p)
    heading = ''
  }
  if (heading) out.push(heading)
  return out
}

/** A paragraph longer than the limit is split at sentence ends, then at spaces, then hard. */
function splitLong(p: string, max: number): string[] {
  if (p.length <= max) return [p]
  const pieces: string[] = []
  let rest = p
  while (rest.length > max) {
    const window = rest.slice(0, max)
    let cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'))
    if (cut < max * 0.5) cut = window.lastIndexOf(' ')
    if (cut < max * 0.5) cut = max - 1
    pieces.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(cut + 1).trim()
  }
  if (rest) pieces.push(rest)
  return pieces
}

/** The last `n` characters of a piece, starting at a word so the overlap reads cleanly. */
function tail(text: string, n: number): string {
  if (n <= 0 || text.length <= n) return n <= 0 ? '' : text
  const slice = text.slice(text.length - n)
  const space = slice.indexOf(' ')
  return (space >= 0 ? slice.slice(space + 1) : slice).trim()
}

export function chunkText(text: string, settings: ChunkSettings): string[] {
  const max = Math.max(100, Math.floor(settings.chunkChars))
  // Overlap can never eat the whole piece.
  const overlap = Math.max(0, Math.min(Math.floor(settings.overlapChars), Math.floor(max / 2)))
  // Room left for new text once the overlap is carried in.
  const units = paragraphs(text).flatMap((p) => splitLong(p, max - overlap - 2))

  const chunks: string[] = []
  let current = ''
  let hasNew = false // does `current` hold anything beyond the carried overlap?
  for (const unit of units) {
    const joined = current ? `${current}\n\n${unit}` : unit
    if (joined.length <= max) {
      current = joined
      hasNew = true
      continue
    }
    if (hasNew) chunks.push(current)
    const carry = tail(current, overlap)
    current = carry ? `${carry}\n\n${unit}` : unit
    hasNew = true
  }
  if (current && hasNew) chunks.push(current)
  return chunks
}

export function chunkNotes(notes: Note[], settings: ChunkSettings): Chunk[] {
  return notes.flatMap((note) =>
    chunkText(note.text, settings).map((text, i) => ({
      source: `${note.id}#${i}`,
      noteId: note.id,
      text,
      internal: note.internal,
    })),
  )
}
