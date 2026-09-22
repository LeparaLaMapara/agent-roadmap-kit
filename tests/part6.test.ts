// Part 6: the workflow, its router and checks, the write door, and the app.
// Runs offline with the mock model. Semantic search uses the embedding model
// already downloaded into .data/models by the earlier parts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Settings are read when config.ts first loads, so set them before importing.
process.env.AI_PROVIDER = 'mock'

const { config } = await import('../src/config.ts')
const { answerWithWorkflow, routeMessage, draftNote, NOT_COVERED_REPLY } = await import('../src/workflow.ts')
const { checkAnswer, internalSecrets } = await import('../src/checks.ts')
const { ask, receipt } = await import('../src/app.ts')
const { closeDb, countSaved, listSaved } = await import('../src/db.ts')
const { loadGolden } = await import('../parts/05-making-agents-reliable/eval.ts')
import type { Budget } from '../src/types.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const WRITE = 'Please leave a note for the owner: can you add a vegan chakalaka on Sundays? From Palesa, Block L.'

/** A budget that only counts. Every model call the workflow makes is charged here. */
function counter(): Budget & { calls: number } {
  return {
    calls: 0,
    spent: { modelCalls: 0, tokens: 0 },
    charge() {
      this.calls++
    },
  }
}

/** Run fn with the database in a fresh temporary folder, so tests never touch .data/kitchen.db. */
async function withTempDb<T>(fn: () => Promise<T>): Promise<T> {
  const saved = config.dataDir
  const dir = mkdtempSync(path.join(tmpdir(), 'kit-part6-'))
  closeDb()
  config.dataDir = dir
  try {
    return await fn()
  } finally {
    closeDb()
    config.dataDir = saved
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------- the router

test('the router sorts messages with plain rules', () => {
  const cases: [string, string][] = [
    ['Hello!', 'smalltalk'],
    ['thanks', 'smalltalk'],
    ['Good morning', 'smalltalk'],
    ['Do you deliver to Block L?', 'question'],
    ['Hello, do you deliver to Block L?', 'question'],
    ['How do I order for a funeral?', 'question'],
    ['Can I pay with SnapScan?', 'question'],
    [WRITE, 'write'],
    ['Can you tell the owner the chicken was great?', 'write'],
    ['Please pass a message to the kitchen: I will be late', 'write'],
    ['I would like to order two full plates for Block L', 'write'],
  ]
  for (const [message, expected] of cases) {
    assert.equal(routeMessage(message).route, expected, `"${message}"`)
  }
})

test('the draft is built by code from the customer\'s own words', () => {
  assert.deepEqual(draftNote(WRITE), {
    title: 'Message for the owner',
    body: 'can you add a vegan chakalaka on Sundays? From Palesa, Block L.',
  })
})

// ---------------------------------------------------------------- one model call at most

test('the workflow never calls the model more than once per question', async () => {
  const questions = [...loadGolden().cases.map((c) => c.question), 'Hello!', WRITE]
  for (const q of questions) {
    const budget = counter()
    const r = await answerWithWorkflow(q, { budget })
    assert.ok(budget.calls <= 1, `"${q}" made ${budget.calls} model calls`)
    assert.equal(r.usage.modelCalls, budget.calls)
  }
})

test('smalltalk, writes and empty retrieval cost no model call at all', async () => {
  for (const q of ['Hello!', WRITE, 'Can I pay with SnapScan?']) {
    const budget = counter()
    const r = await answerWithWorkflow(q, { budget })
    assert.equal(budget.calls, 0, `"${q}"`)
    assert.ok(r.answer.length > 0)
  }
  const empty = await answerWithWorkflow('Can I pay with SnapScan?')
  assert.equal(empty.answer, NOT_COVERED_REPLY)
})

test('a normal question: retrieve, one call, checks pass, answer cites what was retrieved', async () => {
  const r = await answerWithWorkflow('Do you deliver to Block L?')
  assert.equal(r.route, 'question')
  assert.equal(r.usage.modelCalls, 1)
  assert.ok(r.sources.includes('delivery.md#0'))
  assert.deepEqual(r.cited, ['delivery.md'])
  assert.ok(r.checks.every((c) => c.passed))
  assert.equal(r.replaced, false)
})

// ---------------------------------------------------------------- the checks

test('a post check replaces an answer that leaks internal text', async () => {
  // Simulate the Part 4 misconfiguration: private text reaches the model.
  const leakySearch = async () => [
    { source: 'delivery.md#0', text: 'Chicken costs us R54 per kilogram from Tshwane Poultry. Owner: 071 000 0000.', score: 0.9, internal: false },
  ]
  const r = await answerWithWorkflow('What do you pay for chicken?', { search: leakySearch })
  assert.match(r.modelAnswer ?? '', /R54/, 'the mock should have repeated the leaked text')
  assert.equal(r.replaced, true)
  assert.equal(r.checks.find((c) => c.name === 'no_leak')?.passed, false)
  assert.doesNotMatch(r.answer, /R54|Tshwane|071/)
})

test('the grounded check: cite something retrieved, or say the notes do not cover it', () => {
  const secrets = internalSecrets()
  const grounded = (answer: string) => checkAnswer(answer, ['delivery.md#0'], secrets).find((c) => c.name === 'grounded')!.passed
  assert.equal(grounded('We deliver to Block L. [source: delivery.md#0]'), true)
  assert.equal(grounded('The notes do not cover that.'), true)
  assert.equal(grounded('A full plate costs R85.'), false, 'no citation')
  assert.equal(grounded('A full plate costs R85. [source: menu.md#0]'), false, 'cites a note retrieval did not return')
  assert.equal(checkAnswer('Call 071-000-0000', [], secrets)[0].passed, false, 'phone numbers match however they are spaced')
})

// ---------------------------------------------------------------- the write door

test('a customer write needs approval: no approver means nothing is saved', async () => {
  await withTempDb(async () => {
    const r = await answerWithWorkflow(WRITE)
    assert.equal(r.route, 'write')
    assert.equal(r.write?.decision, 'ask')
    assert.equal(r.write?.saved, null)
    assert.match(r.answer, /not saved/)
    assert.equal(countSaved(), 0)

    const refused = await answerWithWorkflow(WRITE, { approver: async () => false })
    assert.equal(refused.write?.saved, null)
    assert.equal(countSaved(), 0)

    let asked = 0
    const approved = await answerWithWorkflow(WRITE, {
      approver: async () => {
        asked++
        return true
      },
    })
    assert.equal(asked, 1)
    assert.equal(approved.write?.saved?.ok, true)
    assert.equal(countSaved(), 1)
    assert.equal(listSaved()[0].actor, 'customer')
  })
})

test('the owner may write without being asked, as the Part 4 policy says', async () => {
  await withTempDb(async () => {
    let asked = 0
    const r = await answerWithWorkflow('Save a note: order more maize meal on Friday.', {
      ctx: { actor: 'owner' },
      approver: async () => {
        asked++
        return false
      },
    })
    assert.equal(r.write?.decision, 'allow')
    assert.equal(asked, 0)
    assert.equal(countSaved(), 1)
  })
})

// ---------------------------------------------------------------- the app

test('both app engines answer with the mock, with sources and a cost receipt', async () => {
  for (const engine of ['workflow', 'agent'] as const) {
    const a = await ask('Do you deliver to Block L?', { engine })
    assert.match(a.answer, /\[source: delivery\.md#0\]/, engine)
    assert.deepEqual(a.sources, ['delivery.md'])
    assert.equal(a.usage.modelCalls, engine === 'workflow' ? 1 : 2)
    assert.match(receipt(a), new RegExp(`engine: ${engine}`))
  }
})

test('npm run ask prints an answer, its sources and a one line receipt', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'src', 'app.ts'), 'Do you deliver to Block L?'], {
    env: { ...process.env, AI_PROVIDER: 'mock' },
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Answer: .*\[source: delivery\.md#0\]/)
  assert.match(r.stdout, /Sources: delivery\.md/)
  assert.match(r.stdout, /Cost: 1 model call, \d+ tokens \| engine: workflow \(question\) \| provider: mock/)
})

test('the interactive app keeps going until exit, and a customer write waits for a yes', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'src', 'app.ts'), '--no'], {
    env: { ...process.env, AI_PROVIDER: 'mock' },
    encoding: 'utf8',
    input: `Hello\nWhen do you shut?\n${WRITE}\nexit\n`,
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /engine: workflow \(smalltalk\)/)
  assert.match(r.stdout, /\[source: hours\.md#0\]/)
  assert.match(r.stdout, /APPROVAL NEEDED: save_note/)
  assert.match(r.stdout, /Refused \(--no\)/)
  assert.match(r.stdout, /Bye\./)
})
