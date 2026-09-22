// Part 3: build the search index.
//
//   npm run part3:index
//
// Chunks every note, embeds each piece on your machine, and writes
// .data/index.json. Run it again after editing notes: unchanged pieces keep
// their vectors, so only what changed is embedded again. (Search also notices
// changed notes and rebuilds by itself, but it is good to know how.)

import path from 'node:path'
import { config } from '../../src/config.ts'
import { buildIndex, currentSettings } from '../../src/retrieval/store.ts'

const settings = currentSettings()
console.log(`Notes folder:    ${settings.notesDir}`)
console.log(`Embedding model: ${settings.embedModel} (downloads about 25 MB the first time)`)
console.log(`Chunk settings:  ${settings.chunkChars} characters, ${settings.overlapChars} overlap\n`)

try {
  const { index, embedded, reused, ms } = await buildIndex(settings)
  const { meta, chunks } = index
  const sizes = chunks.map((c) => c.text.length)
  const publicCount = chunks.filter((c) => !c.internal).length
  console.log(`Pieces:     ${chunks.length} from ${meta.noteCount} notes (${publicCount} public, ${chunks.length - publicCount} internal)`)
  if (sizes.length) console.log(`Piece size: ${Math.min(...sizes)} to ${Math.max(...sizes)} characters`)
  console.log(`Dimensions: ${meta.dims} numbers per piece`)
  console.log(`Embedded:   ${embedded} new, ${reused} reused from the last build`)
  console.log(`Time:       ${(ms / 1000).toFixed(1)} s`)
  console.log(`Saved to:   ${path.relative(config.root, settings.indexPath)}`)
  console.log(`Pinned to:  notes fingerprint ${meta.fingerprint}, built ${meta.builtAt}`)
} catch (err) {
  console.error(`Could not build the index: ${(err as Error).message}`)
  process.exitCode = 1
}
