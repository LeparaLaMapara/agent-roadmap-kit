// Part 6: the same questions through a workflow and through an agent loop.
//
//   npm run part6              compare, then the bounded autonomy demo
//   npm run part6 -- --yes     approve the demo write (saves to .data/kitchen.db)
//   npm run part6 -- --no      refuse the demo write without asking
//
// (a) the workflow, src/workflow.ts: code routes, code searches, ONE model
//     call answers, code checks the answer.
// (b) the agent loop, src/agent.ts with the Part 4 guards: the model decides
//     whether to search, what to search for, and when it is done.
//
// Everything printed under "What the numbers say" is computed from this run.
// Nothing in the conclusion is written in advance, so a different model can
// give a different conclusion.

import { createInterface } from 'node:readline/promises'
import { config } from '../../src/config.ts'
import { ask, modelName, prepareSearch, type AppAnswer } from '../../src/app.ts'
import { answerWithWorkflow } from '../../src/workflow.ts'
import { runAgent } from '../../src/agent.ts'
import { RulePolicy, SimpleBudget } from '../../src/guard.ts'
import { buildTools } from '../../src/tools.ts'
import { BudgetExceededError, type Approver } from '../../src/types.ts'
import type { Message } from '../../src/llm.ts'

const flags = new Set(process.argv.slice(2))

const QUESTIONS = [
  'Do you deliver to Block L?',
  'When do you shut?',
  'How much is a full plate?',
  'Can I pay with SnapScan?',
  "What is the owner's private cell number?",
  'Hello!',
  'Please leave a note for the owner: can you add a vegan chakalaka on Sundays? From Palesa, Block L.',
]

const short = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n - 3)}...` : flat
}
const line = (s = '') => console.log(s)
const heading = (title: string) => {
  line()
  line('='.repeat(96))
  line(title)
  line('='.repeat(96))
}

interface Row {
  question: string
  engine: 'workflow' | 'agent'
  a: AppAnswer
  ms: number
}

const cited = (a: AppAnswer) => /\[source: [^\]]+\]/.test(a.answer)
const fired = (a: AppAnswer) => a.checks.some((c) => !c.passed)

async function timed(question: string, engine: 'workflow' | 'agent'): Promise<Row> {
  const started = performance.now()
  // No approver in the comparison: a customer's write waits for a human in
  // both engines, and nothing is saved.
  const a = await ask(question, { engine, ctx: { actor: 'customer' } })
  return { question, engine, a, ms: performance.now() - started }
}

// ---------------------------------------------------------------- setup

const mode = await prepareSearch()
line(`Provider: ${config.provider} (${modelName()}). Search: ${mode}. Acting as: customer.`)
line(`The same ${QUESTIONS.length} questions through (a) the workflow and (b) the agent loop.`)

// ---------------------------------------------------------------- the comparison

heading('1. Workflow versus agent loop, question by question')
const rows: Row[] = []
for (const q of QUESTIONS) {
  rows.push(await timed(q, 'workflow'))
  rows.push(await timed(q, 'agent'))
}

const cell = (r: Row) =>
  `${String(r.a.usage.modelCalls).padStart(2)} ${String(r.a.usage.tokens).padStart(6)} ${String(Math.round(r.ms)).padStart(6)}  ${(cited(r.a) ? 'yes' : 'no').padEnd(4)}${(fired(r.a) ? 'YES' : 'no').padEnd(4)}`
line(`${''.padEnd(44)}${'(a) workflow'.padEnd(32)}(b) agent loop`)
line(`${'question'.padEnd(44)}${'calls tokens     ms  cite chk'.padEnd(32)}calls tokens     ms  cite chk`)
line('-'.repeat(102))
for (const q of QUESTIONS) {
  const w = rows.find((r) => r.question === q && r.engine === 'workflow')!
  const a = rows.find((r) => r.question === q && r.engine === 'agent')!
  line(`${short(q, 42).padEnd(44)}${cell(w).padEnd(32)}${cell(a)}`)
}
line('\ncite: the answer cites a source. chk: a deterministic check fired (a leak, or no citation')
line('and no "the notes do not cover it"). The workflow replaces such an answer; the agent sends it.')

line('\nThe answers:')
for (const q of QUESTIONS) {
  const w = rows.find((r) => r.question === q && r.engine === 'workflow')!
  const a = rows.find((r) => r.question === q && r.engine === 'agent')!
  line(`  ${short(q, 70)}`)
  line(`    workflow (${w.a.route}): ${short(w.a.answer, 150)}`)
  line(`    agent:            ${short(a.a.answer, 150)}`)
}

// ---------------------------------------------------------------- what the numbers say

heading('2. What the numbers say (computed from this run)')
const of = (engine: 'workflow' | 'agent') => rows.filter((r) => r.engine === engine)
const sum = (rs: Row[], f: (r: Row) => number) => rs.reduce((n, r) => n + f(r), 0)
const W = of('workflow')
const A = of('agent')
const wCalls = sum(W, (r) => r.a.usage.modelCalls)
const aCalls = sum(A, (r) => r.a.usage.modelCalls)
const wTokens = sum(W, (r) => r.a.usage.tokens)
const aTokens = sum(A, (r) => r.a.usage.tokens)
const wMs = sum(W, (r) => r.ms)
const aMs = sum(A, (r) => r.ms)
const zeroCall = W.filter((r) => r.a.usage.modelCalls === 0)
const wMaxCalls = Math.max(...W.map((r) => r.a.usage.modelCalls))
const aMaxCalls = Math.max(...A.map((r) => r.a.usage.modelCalls))

function compare(label: string, w: number, a: number, unit: string): string {
  if (w === a) return `Both engines used the same ${label}: ${w}${unit}.`
  if (w === 0) return `The workflow used no ${label} at all; the agent used ${a}${unit}.`
  if (a === 0) return `The agent used no ${label} at all; the workflow used ${w}${unit}.`
  const [fewer, more, ratio] = w < a ? ['workflow', 'agent', a / w] : ['agent', 'workflow', w / a]
  return `The ${fewer} used ${ratio.toFixed(1)} times fewer ${label} than the ${more} (${Math.min(w, a)}${unit} against ${Math.max(w, a)}${unit}).`
}

line(`Totals for ${QUESTIONS.length} questions: workflow ${wCalls} model calls, ${wTokens} tokens, ${Math.round(wMs)} ms;`)
line(`                          agent    ${aCalls} model calls, ${aTokens} tokens, ${Math.round(aMs)} ms.`)
line()
line(compare('model calls', wCalls, aCalls, ''))
line(compare('tokens', wTokens, aTokens, ''))
line(
  `Most model calls for one question: workflow ${wMaxCalls}, agent ${aMaxCalls}. ` +
    'The workflow cannot go above 1: there is one model step in its code. The agent is limited only by its budget.',
)
if (zeroCall.length) {
  line(
    `${zeroCall.length} of ${W.length} questions needed no model at all in the workflow ` +
      `(${[...new Set(zeroCall.map((r) => (r.a.route === 'question' ? 'nothing retrieved' : r.a.route)))].join(', ')}). ` +
      'Code answered them.',
  )
}
line(`Answers citing a source: workflow ${W.filter((r) => cited(r.a)).length} of ${W.length}, agent ${A.filter((r) => cited(r.a)).length} of ${A.length}.`)
const wFired = W.filter((r) => fired(r.a))
const aFired = A.filter((r) => fired(r.a))
line(
  `Checks fired: workflow ${wFired.length}` +
    (wFired.length ? ' (each of those answers was replaced before a customer saw it)' : '') +
    `, agent ${aFired.length}` +
    (aFired.length ? ' (sent to the customer anyway: the loop has no step where code looks at the answer)' : '') +
    '.',
)
line(
  wMs < aMs
    ? `Wall clock: the workflow took ${Math.round(wMs)} ms against the agent's ${Math.round(aMs)} ms.`
    : `Wall clock: the agent took ${Math.round(aMs)} ms against the workflow's ${Math.round(wMs)} ms.`,
)
line('\nWhat this does not show: which answers are right. A cited answer can still be wrong, and')
line('only a person, or a golden set like Part 5, can say what "correct" means.')

// ---------------------------------------------------------------- bounded autonomy

heading('3. Bounded autonomy: a spending limit the loop cannot talk its way past')
const LIMIT = 3
line(`The agent loop with MAX_MODEL_CALLS=${LIMIT}, over one short conversation (one budget for the whole chat).`)
const budget = new SimpleBudget({ maxModelCalls: LIMIT, maxTokens: config.budget.maxTokens })
const chatTurns = ['Do you deliver to Block L?', 'And what are your hours?', 'How much is a full plate?', 'Can I pay by EFT?', 'Do you have a vegetarian plate?']
let history: Message[] = []
let stopped = false
for (const [i, q] of chatTurns.entries()) {
  try {
    const r = await runAgent(q, { policy: new RulePolicy(), budget, history, ctx: { actor: 'customer' } })
    history = r.messages
    line(`  turn ${i + 1}: "${q}" answered. Spent so far: ${budget.spent.modelCalls} model calls, ${budget.spent.tokens} tokens`)
  } catch (err) {
    if (!(err instanceof BudgetExceededError)) throw err
    line(`  turn ${i + 1}: "${q}"`)
    line(`  STOPPED: ${err.message}`)
    stopped = true
    break
  }
}
if (!stopped) line(`  The conversation finished inside the limit (${budget.spent.modelCalls} calls). Try a longer one or a lower limit.`)
line('The budget is checked after each model call, so the loop can go one call over before it stops.')
line('It stops with a clear error, not a half written answer. The workflow needs no such guard for')
line('its own calls: it makes at most one per question by construction.')

heading('4. A write that waits for a human')
const writeQ = QUESTIONS.at(-1)!
const rules = new RulePolicy()
const saveTool = buildTools().find((t) => t.spec.name === 'save_note')!
for (const actor of ['customer', 'owner'] as const) {
  const { decision, rule } = rules.explain({ id: 'x', name: 'save_note', args: {} }, saveTool, { actor })
  line(`  policy: save_note for ${actor.padEnd(8)} ${decision.toUpperCase().padEnd(5)} (${rule})`)
}
const approver: Approver = async (call, tool) => {
  line(`\n  APPROVAL NEEDED: ${tool.spec.name} (a ${tool.kind} tool) for a customer`)
  for (const [k, v] of Object.entries(call.args)) line(`    ${k}: ${short(String(v), 200)}`)
  if (flags.has('--yes')) return say(true, '--yes')
  if (flags.has('--no')) return say(false, '--no')
  if (!process.stdin.isTTY) return say(false, 'no terminal to ask, so no')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question('  Allow this? (y/n) ')).trim().toLowerCase()
  rl.close()
  return say(answer === 'y' || answer === 'yes', 'you')
}
function say(ok: boolean, who: string) {
  line(`  ${ok ? 'Approved' : 'Refused'} (${who})`)
  return ok
}
line(`\nA customer writes: "${short(writeQ, 110)}"`)
const w = await answerWithWorkflow(writeQ, { ctx: { actor: 'customer' }, approver })
for (const s of w.steps) line(`  ${s}`)
line(`  reply: ${w.answer}`)
line(`  model calls: ${w.usage.modelCalls}. Code drafted the note; the model was never asked.`)
line('\nNothing is written unless the policy allows it or a person says yes. Run with --yes to')
line('approve (it saves to .data/kitchen.db through the one door from Part 4), or --no to refuse.')
