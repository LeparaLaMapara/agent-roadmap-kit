// Step 3 of retrieval: keep the numbers somewhere you can search them.
//
// The post's site uses Postgres with pgvector. At the size of a small business
// notes folder a JSON file does the same job: .data/index.json holds every
// piece, its vector, and a record of exactly what it was built from.
//
// That record is the point. Two of the three bugs in the post came from
// retrieval quietly inheriting configuration that something else owned. So
// the index PINS what it depends on (which notes folder, which embedding
// model, how many dimensions, which chunk settings, a fingerprint of the
// notes) and search checks those pins before trusting a single result.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config.ts'
import { loadNotes } from '../notes.ts'
import type { Note } from '../types.ts'
import { chunkNotes, type Chunk } from './chunk.ts'
import { embedWith } from './embed.ts'

/** Everything an index depends on. Search compares these with the current config. */
export interface IndexSettings {
  notesDir: string
  embedModel: string
  chunkChars: number
  overlapChars: number
  indexPath: string
}

export interface IndexMeta {
  version: 1
  notesDir: string
  embedModel: string
  dims: number
  chunkChars: number
  overlapChars: number
  /** A hash of every note's name and text. If a note changes, this changes. */
  fingerprint: string
  noteCount: number
  builtAt: string
}

export interface IndexedChunk extends Chunk {
  /** Hash of model plus text, so a rebuild can skip pieces that did not change. */
  hash: string
  vector: number[]
}

export interface Index {
  meta: IndexMeta
  chunks: IndexedChunk[]
}

export function currentSettings(): IndexSettings {
  return {
    notesDir: config.notesDir,
    embedModel: config.search.embedModel,
    chunkChars: config.search.chunkChars,
    overlapChars: config.search.overlapChars,
    indexPath: path.join(config.dataDir, 'index.json'),
  }
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

export function fingerprintNotes(notes: Note[]): string {
  return sha(notes.map((n) => `${n.id}\n${sha(n.text)}`).join('\n')).slice(0, 16)
}

export function loadIndex(indexPath: string): Index | null {
  if (!existsSync(indexPath)) return null
  try {
    return JSON.parse(readFileSync(indexPath, 'utf8')) as Index
  } catch {
    return null // a half written or hand edited file: treat as missing and rebuild
  }
}

export interface BuildResult {
  index: Index
  embedded: number
  reused: number
  ms: number
}

/**
 * Build the index from scratch, or refresh it. Pieces whose text and model
 * have not changed keep their old vectors, the same trick the post's reindex
 * uses: hash each piece and only re-embed what actually differs.
 */
export async function buildIndex(settings: IndexSettings = currentSettings()): Promise<BuildResult> {
  const started = performance.now()
  const notes = loadNotes(settings.notesDir)
  const chunks = chunkNotes(notes, settings)

  const previous = loadIndex(settings.indexPath)
  const oldVectors = new Map<string, number[]>()
  for (const c of previous?.chunks ?? []) oldVectors.set(c.hash, c.vector)

  const hashes = chunks.map((c) => sha(`${settings.embedModel}\n${c.text}`))
  const todo = chunks.map((_, i) => i).filter((i) => !oldVectors.has(hashes[i]))
  const fresh = await embedWith(
    settings.embedModel,
    todo.map((i) => chunks[i].text),
  )
  const freshByIndex = new Map(todo.map((i, j) => [i, fresh[j]]))

  const indexed: IndexedChunk[] = chunks.map((c, i) => {
    const v = freshByIndex.get(i) ?? oldVectors.get(hashes[i])!
    // Six decimals is far more precision than search needs and keeps the file small.
    return { ...c, hash: hashes[i], vector: v.map((x) => Math.round(x * 1e6) / 1e6) }
  })

  const index: Index = {
    meta: {
      version: 1,
      notesDir: settings.notesDir,
      embedModel: settings.embedModel,
      dims: indexed[0]?.vector.length ?? 0,
      chunkChars: settings.chunkChars,
      overlapChars: settings.overlapChars,
      fingerprint: fingerprintNotes(notes),
      noteCount: notes.length,
      builtAt: new Date().toISOString(),
    },
    chunks: indexed,
  }
  mkdirSync(path.dirname(settings.indexPath), { recursive: true })
  // Write to a temporary file, then swap it in, so a reader never sees half a file.
  const temp = `${settings.indexPath}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(index))
  renameSync(temp, settings.indexPath)
  return { index, embedded: todo.length, reused: chunks.length - todo.length, ms: performance.now() - started }
}

/** Thrown when an index was built from something other than what the config now names. */
export class IndexMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IndexMismatchError'
  }
}

/**
 * The pinned check. A different notes folder or a different embedding model
 * is not something to quietly work around: results would come from the wrong
 * data (bug 2 in the post) or be compared in the wrong number space (the
 * local cousin of bug 3). Say so loudly, naming both values.
 */
export function checkPins(meta: IndexMeta, settings: IndexSettings): void {
  const problems: string[] = []
  if (path.resolve(meta.notesDir) !== path.resolve(settings.notesDir)) {
    problems.push(`notes folder: index was built from "${meta.notesDir}" but the config points at "${settings.notesDir}"`)
  }
  if (meta.embedModel !== settings.embedModel) {
    problems.push(`embedding model: index was built with "${meta.embedModel}" but the config names "${settings.embedModel}"`)
  }
  if (problems.length) {
    throw new IndexMismatchError(
      `The search index at ${settings.indexPath} does not match the current config.\n  ` +
        problems.join('\n  ') +
        `\nRebuild it for the current config with: npm run part3:index`,
    )
  }
}

export type Freshness = 'built' | 'fresh' | 'rebuilt-stale' | 'rebuilt-settings'

/**
 * Load the index, making sure it is safe to search:
 *   missing          build it
 *   wrong folder or model   throw (never answer from the wrong data)
 *   notes changed    rebuild (the staleness trap)
 *   chunk settings changed  rebuild
 */
export async function ensureIndex(
  settings: IndexSettings = currentSettings(),
): Promise<{ index: Index; status: Freshness }> {
  const existing = loadIndex(settings.indexPath)
  if (!existing) return { index: (await buildIndex(settings)).index, status: 'built' }

  checkPins(existing.meta, settings)

  const notes = loadNotes(settings.notesDir)
  if (fingerprintNotes(notes) !== existing.meta.fingerprint) {
    return { index: (await buildIndex(settings)).index, status: 'rebuilt-stale' }
  }
  if (existing.meta.chunkChars !== settings.chunkChars || existing.meta.overlapChars !== settings.overlapChars) {
    return { index: (await buildIndex(settings)).index, status: 'rebuilt-settings' }
  }
  return { index: existing, status: 'fresh' }
}
