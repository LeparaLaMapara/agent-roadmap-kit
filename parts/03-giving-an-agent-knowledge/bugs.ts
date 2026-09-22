// Part 3: three bugs where the model was innocent, reproduced on your machine.
//
//   npm run part3:bugs
//
// No model is called in this file at all. Every failure here happens before a
// model would ever see the question, which is the post's point: a bad answer
// often means bad information, not a bad model.
//
// Scratch files go under .data/bugs. The first run also downloads a second
// small embedding model (about 18 MB) for bug 3.

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { config } from '../../src/config.ts'
import { embedWith } from '../../src/retrieval/embed.ts'
import { exactScan, searchWith } from '../../src/retrieval/search-semantic.ts'
import { buildIndex, currentSettings, ensureIndex, loadIndex, type IndexSettings } from '../../src/retrieval/store.ts'
import { buildClusterIndex, clusterSearch } from '../../src/retrieval/toy-cluster.ts'
import type { SearchHit } from '../../src/types.ts'

const k = config.search.topK
const minScore = config.search.minScore
const opts = { k, includeInternal: false }
const scratch = path.join(config.dataDir, 'bugs')
const rel = (p: string) => path.relative(config.root, p) || '.'

const rule = (title: string) => console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`)
const label = (name: string, text: string) => console.log(`\n${name}\n  ${text.replace(/\n/g, '\n  ')}`)
const top = (hits: SearchHit[], n = 3) =>
  hits.length === 0 ? 'NOTHING' : hits.slice(0, n).map((h) => `${h.source} (${h.score.toFixed(3)})`).join(', ')
const firstLineAbout = (hits: SearchHit[], word: RegExp) => {
  const line = hits[0]?.text.split('\n').find((l) => word.test(l))
  return line ? `"${line.trim()}"` : '(no matching line)'
}

console.log('Three retrieval bugs from the post, where the model was working perfectly.')
console.log(`Settings: ${config.search.embedModel}, top ${k}, minimum score ${minScore}.`)

// The real index for the real notes. Built if missing.
const settings = currentSettings()
const { index } = await ensureIndex(settings)

// -------------------------------------------------------------------- Bug 1

rule('Bug 1: the index that returned nothing')

const LISTS = 8
const SEED = 42
const cluster = buildClusterIndex(index, LISTS, SEED)
const sizes = cluster.members.map((m) => m.length)
console.log(
  `A toy clustering index (it groups vectors into clusters and searches only the nearest one) with
${LISTS} clusters learned from ` +
    `${index.chunks.length} pieces, seed ${SEED}.\nPieces per cluster: [${sizes.join(', ')}]. ` +
    `${sizes.filter((s) => s === 0).length} clusters are empty.`,
)

const questions = [
  'Do you deliver to Block L?',
  'Can I get food brought to my house in Block L?',
  'How much does delivery cost?',
  'What time do you close on Sunday?',
  'Can I get a refund if my food is cold?',
]
const vectors = await embedWith(settings.embedModel, questions)
console.log(`\n${'Question'.padEnd(50)}${'Cluster index'.padEnd(34)}Exact scan`)
questions.forEach((q, i) => {
  const c = clusterSearch(index, cluster, vectors[i], opts)
  const e = exactScan(index, vectors[i], opts)
  const left = c.hits.length ? `${c.hits[0].source}` : `NOTHING (cluster ${c.cluster}: ${c.clusterSize} pieces)`
  console.log(`${q.padEnd(50)}${left.padEnd(34)}${e[0]?.source ?? 'NOTHING'}`)
})

// How long does "check every vector" actually take here?
const reps = 1000
const t0 = performance.now()
for (let r = 0; r < reps; r++) for (const v of vectors) exactScan(index, v, opts)
const perScan = (performance.now() - t0) / (reps * vectors.length)
console.log(`
Exact scan over all ${index.chunks.length} pieces: ${(perScan * 1000).toFixed(1)} microseconds per question on this machine.`)

label('Symptom', 'Some real questions get zero results, even though delivery.md answers them.')
label(
  'Cause',
  'A clustering index learns its clusters from the data. With only a handful of pieces some clusters\n' +
    'come out empty. A question that lands nearest an empty cluster searches only that cluster, and\n' +
    'finds nothing at all. Not a worse answer. Nothing.',
)
label(
  'Fix',
  'Delete the index and check every vector. The exact scan in src/retrieval/search-semantic.ts is what\n' +
    'the kit uses. At this size it takes well under a millisecond and never misses.',
)

// -------------------------------------------------------------------- Bug 2

rule('Bug 2: the database that was the wrong database')

// Set up two folders that are NOT the one the config names: an old copy of the
// notes from before the kitchen expanded, and an empty knowledge base.
rmSync(scratch, { recursive: true, force: true })
const oldNotes = path.join(scratch, 'old-notes')
const emptyNotes = path.join(scratch, 'empty-notes')
cpSync(settings.notesDir, oldNotes, { recursive: true })
writeFileSync(
  path.join(oldNotes, 'delivery.md'),
  '# Delivery\n\nThe kitchen delivers to Soshanguve blocks F, G and H only. Delivery costs R15 per order.\n\n' +
    'Everywhere else is collection only.\n',
)
mkdirSync(emptyNotes, { recursive: true })
writeFileSync(path.join(emptyNotes, 'README.txt'), 'Knowledge base not loaded yet.\n')

const oldIndexPath = path.join(scratch, 'old-index.json')
const emptyIndexPath = path.join(scratch, 'empty-index.json')
await buildIndex({ ...settings, notesDir: oldNotes, indexPath: oldIndexPath })
await buildIndex({ ...settings, notesDir: emptyNotes, indexPath: emptyIndexPath })

const q2 = 'Do you deliver to Block L?'
const [v2] = await embedWith(settings.embedModel, [q2])
console.log(`The config points at ${rel(settings.notesDir)}. Question: "${q2}"`)

// The naive way: open whatever index file you were handed and search it.
const right = exactScan(index, v2, opts)
const stale = exactScan(loadIndex(oldIndexPath)!, v2, opts)
const empty = exactScan(loadIndex(emptyIndexPath)!, v2, opts)
console.log(`\nNaive search, no pins checked:`)
console.log(`  index of ${rel(settings.notesDir).padEnd(24)} top: ${top(right, 1)}  ${firstLineAbout(right, /delivers to/i)}`)
console.log(`  index of ${rel(oldNotes).padEnd(24)} top: ${top(stale, 1)}  ${firstLineAbout(stale, /delivers to/i)}`)
console.log(`  index of ${rel(emptyNotes).padEnd(24)} top: ${top(empty, 1)}`)
console.log('  Every one of these runs without an error. Only the first is the right data.')

console.log(`\nPinned search (the kit's real code), handed the old index:`)
try {
  await searchWith(q2, opts, { ...settings, indexPath: oldIndexPath })
  console.log('  (no error: this should not happen)')
} catch (err) {
  console.log(`  REFUSED: ${(err as Error).message.replace(/\n/g, '\n  ')}`)
}

label(
  'Symptom',
  'Retrieval works on one machine and answers wrongly, or returns nothing, somewhere else. The model,\n' +
    'the code and the question are identical. A Block L customer is told you only deliver to F, G and H.',
)
label(
  'Cause',
  'Retrieval searched whichever index it was handed, built from a different notes folder than the one\n' +
    'the config names. In the post it was a different Supabase project from the one holding the data.',
)
label(
  'Fix',
  'Pin it. The index records the notes folder it was built from, and search refuses to run when that is\n' +
    'not the folder the config names, with an error that names both.',
)

// -------------------------------------------------------------------- Bug 3

rule('Bug 3: the right database with the wrong key (a local analogue)')

console.log(
  'In the post the real failure was an API key: retrieval borrowed the site\'s credentials instead of\n' +
    "the knowledge base project's own. Local retrieval has no API key, so here is the closest thing that\n" +
    'can go wrong on your machine: the index was built with one embedding model, and something else\n' +
    'changed the model used for the question. Right index, wrong key to read it with.',
)

const OTHER_MODEL = 'Xenova/paraphrase-MiniLM-L3-v2'
const q3s = ['Do you deliver to Block L?', 'What time do you close on Sunday?', 'Can I get a refund if my food is cold?']
const rightVecs = await embedWith(settings.embedModel, q3s)
const wrongVecs = await embedWith(OTHER_MODEL, q3s)
console.log(`\nIndex built with ${index.meta.embedModel} (${index.meta.dims} numbers per piece).`)
console.log(`Question embedded with ${OTHER_MODEL} (${wrongVecs[0].length} numbers). Same length, so nothing crashes.\n`)
console.log(`${'Question'.padEnd(42)}${'Same model'.padEnd(24)}${'Other model'.padEnd(18)}Other model, no threshold`)
q3s.forEach((q, i) => {
  const good = exactScan(index, rightVecs[i], opts)
  const bad = exactScan(index, wrongVecs[i], opts)
  const badAll = exactScan(index, wrongVecs[i], { ...opts, minScore: -1 })
  const g = good[0] ? `${good[0].source} ${good[0].score.toFixed(2)}` : 'NOTHING'
  const b = bad[0] ? `${bad[0].source} ${bad[0].score.toFixed(2)}` : 'NOTHING'
  console.log(`${q.padEnd(42)}${g.padEnd(24)}${b.padEnd(18)}${badAll[0].source} ${badAll[0].score.toFixed(2)}`)
})

console.log(`\nPinned search (the kit's real code), with EMBED_MODEL changed to ${OTHER_MODEL}:`)
const wrongKey: IndexSettings = { ...settings, embedModel: OTHER_MODEL }
try {
  await searchWith(q3s[0], opts, wrongKey)
  console.log('  (no error: this should not happen)')
} catch (err) {
  console.log(`  REFUSED: ${(err as Error).message.replace(/\n/g, '\n  ')}`)
}

label(
  'Symptom',
  'Nothing clears the threshold, so the assistant finds no notes. Lower the threshold and it returns\n' +
    'pieces, but the scores are low and the order can be wrong. No error either way.',
)
label(
  'Cause',
  'Numbers from two different models live in two different spaces. Comparing them is like reading a\n' +
    'map with the wrong key. In the post: the right database, opened with the wrong API key.',
)
label(
  'Fix',
  'The same as bug 2. The index records the model it was built with (and its dimensions), and search\n' +
    'refuses to compare a question embedded by anything else.',
)

rule('The lesson across bugs 2 and 3')
console.log(
  'When a component depends on configuration that something else owns, it will eventually get\n' +
    'configuration that something else changed. Name the configuration you depend on instead of\n' +
    'inheriting it, and fail loudly when it does not match.',
)
console.log(`\nScratch files are in ${rel(scratch)}. Delete them any time.`)
