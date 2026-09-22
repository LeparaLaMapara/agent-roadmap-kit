// Part 3 tests: chunking, semantic search, the pins, staleness and bug 1.
// Runs with no model provider at all. The first run downloads the small
// embedding model (about 25 MB) into .data/models.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { config } from '../src/config.ts'
import { chunkText } from '../src/retrieval/chunk.ts'
import { embed } from '../src/retrieval/embed.ts'
import { exactScan, searchWith, semanticSearch } from '../src/retrieval/search-semantic.ts'
import { buildIndex, currentSettings, ensureIndex, IndexMismatchError } from '../src/retrieval/store.ts'
import { buildClusterIndex, clusterSearch } from '../src/retrieval/toy-cluster.ts'

mkdirSync(config.dataDir, { recursive: true })
const tmp = mkdtempSync(path.join(config.dataDir, 'test-part3-'))
test.after(() => rmSync(tmp, { recursive: true, force: true }))

/** A throwaway notes folder with one note, and settings that point an index at it. */
function scratchNotes(name: string) {
  const notesDir = path.join(tmp, name)
  mkdirSync(notesDir, { recursive: true })
  cpSync(path.join(config.notesDir, 'hours.md'), path.join(notesDir, 'hours.md'))
  return { ...currentSettings(), notesDir, indexPath: path.join(tmp, `${name}-index.json`) }
}

const longText = Array.from(
  { length: 12 },
  (_, i) => `Paragraph ${i + 1}. ` + 'The kitchen cooks fresh food every day for the neighbours. '.repeat(3 + (i % 4)),
).join('\n\n')

test('chunking is deterministic and respects the size limit', () => {
  const settings = { chunkChars: 400, overlapChars: 60 }
  const a = chunkText(longText, settings)
  const b = chunkText(longText, settings)
  assert.deepEqual(a, b)
  assert.ok(a.length > 1, 'long text should become several pieces')
  for (const c of a) assert.ok(c.length <= 400, `piece of ${c.length} characters is over the limit`)
  // Overlap: each piece after the first starts with the end of the one before.
  for (let i = 1; i < a.length; i++) {
    const start = a[i].slice(0, 40)
    assert.ok(a[i - 1].slice(-60).includes(start), `piece ${i} should start with the tail of piece ${i - 1}`)
  }
  // Every paragraph ends up somewhere.
  for (let i = 1; i <= 12; i++) assert.ok(a.some((c) => c.includes(`Paragraph ${i}.`)))
})

test('a paragraph longer than the limit is still split to fit', () => {
  const huge = 'Sunday lunch must be ordered by Saturday. '.repeat(60)
  const pieces = chunkText(huge, { chunkChars: 300, overlapChars: 50 })
  assert.ok(pieces.length > 1)
  for (const p of pieces) assert.ok(p.length <= 300)
})

test('"Do you deliver to Block L?" finds delivery.md in the top 3', async () => {
  const hits = await semanticSearch('Do you deliver to Block L?', { k: 8, includeInternal: false })
  const top3 = hits.slice(0, 3).map((h) => h.source.split('#')[0])
  assert.ok(top3.includes('delivery.md'), `top 3 was ${top3.join(', ')}`)
})

test('internal notes are left out unless includeInternal is set', async () => {
  const q = 'Where do you buy your chicken and at what price per kilogram?'
  // minScore -1 lets every piece through, so only the internal rule can remove one.
  const customer = await searchWith(q, { k: 50, includeInternal: false, minScore: -1 })
  assert.ok(customer.length > 0)
  assert.ok(customer.every((h) => !h.internal), 'a customer search returned an internal note')
  const owner = await searchWith(q, { k: 50, includeInternal: true, minScore: -1 })
  assert.ok(owner.some((h) => h.source.startsWith('suppliers-internal.md')))
})

test('an index built from a different notes folder is refused, naming both folders', async () => {
  const other = scratchNotes('other-notes')
  await buildIndex(other)
  const pointedElsewhere = { ...other, notesDir: config.notesDir }
  await assert.rejects(
    searchWith('When are you open?', { k: 8, includeInternal: false }, pointedElsewhere),
    (err: Error) => {
      assert.ok(err instanceof IndexMismatchError)
      assert.ok(err.message.includes(other.notesDir), 'error should name the folder the index was built from')
      assert.ok(err.message.includes(config.notesDir), 'error should name the folder the config points at')
      return true
    },
  )
})

test('an index built with a different embedding model is refused, naming both models', async () => {
  const s = scratchNotes('model-notes')
  await buildIndex(s)
  const otherModel = { ...s, embedModel: 'Xenova/some-other-model' }
  await assert.rejects(
    searchWith('When are you open?', { k: 8, includeInternal: false }, otherModel),
    (err: Error) => {
      assert.ok(err instanceof IndexMismatchError)
      assert.ok(err.message.includes(config.search.embedModel))
      assert.ok(err.message.includes('Xenova/some-other-model'))
      return true
    },
  )
})

test('editing a note makes the index stale, and search rebuilds it', async () => {
  const s = scratchNotes('stale-notes')
  await buildIndex(s)
  assert.equal((await ensureIndex(s)).status, 'fresh')
  appendFileSync(path.join(s.notesDir, 'hours.md'), '\nFrom October the kitchen is also open on Mondays.\n')
  const { index, status } = await ensureIndex(s)
  assert.equal(status, 'rebuilt-stale')
  assert.ok(index.chunks.some((c) => c.text.includes('open on Mondays')))
  assert.equal((await ensureIndex(s)).status, 'fresh')
})

test('the toy cluster index can return nothing where the exact scan finds the answer (seeded)', async () => {
  const { index } = await ensureIndex()
  const questions = ['Do you deliver to Block L?', 'Can I get food brought to my house in Block L?', 'How much does delivery cost?']
  const vectors = await embed(questions)
  const opts = { k: 8, includeInternal: false }

  const first = buildClusterIndex(index, 8, 42)
  const again = buildClusterIndex(index, 8, 42)
  assert.deepEqual(first.members, again.members, 'same seed should give the same clusters')
  assert.ok(first.members.some((m) => m.length === 0), 'expected at least one empty cluster')

  let missed = 0
  questions.forEach((_, i) => {
    const exact = exactScan(index, vectors[i], opts)
    assert.equal(exact[0]?.source.split('#')[0], 'delivery.md')
    if (clusterSearch(index, first, vectors[i], opts).hits.length === 0) missed++
  })
  assert.ok(missed > 0, 'the cluster index should miss at least one question the exact scan answers')
})
