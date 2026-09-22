// Part 4: the Part 2 agent, now with guards.
//
//   npm run part4                      asks you y/n before any write
//   npm run part4 -- --yes             approve writes without asking
//   npm run part4 -- --no              refuse writes without asking
//   npm run part4 -- "your question"   ask something else
//   npm run part4 -- --owner "..."     act as the owner instead of a customer
//
// Same loop as Part 2. What is new: before every tool call, RulePolicy
// (rules in policy.json) says allow, ask or deny. "ask" comes to you in the
// terminal. SimpleBudget stops the run if it spends too much. The only tool
// that writes, save_note, goes through src/db.ts, the one door that writes.

import { createInterface } from 'node:readline/promises'
import { config } from '../../src/config.ts'
import { runAgent, type AgentEvent } from '../../src/agent.ts'
import { buildTools } from '../../src/tools.ts'
import { RulePolicy, SimpleBudget } from '../../src/guard.ts'
import { listSaved } from '../../src/db.ts'
import { BudgetExceededError, type Approver, type Policy, type Tool, type ToolContext } from '../../src/types.ts'
import type { ToolCall } from '../../src/llm.ts'

config.search.mode = 'keyword' // like Part 2: nothing to download

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const question =
  argv.filter((a) => !a.startsWith('--')).join(' ').trim() ||
  'Please leave a note for the owner: can you add a vegan chakalaka without the beef stock on Sundays? From Palesa, Block L.'
const ctx: ToolContext = { actor: flags.has('--owner') ? 'owner' : 'customer' }
const model = config.provider === 'ollama' ? config.ollama.model : config.provider === 'gemini' ? config.gemini.model : 'mock'

const short = (s: string, n = 160) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n)}...` : flat
}

// ---------------------------------------------------------------- the approver
//
// A human in the loop for writes. --yes and --no answer for you, which is
// handy for scripts. With no flag and no terminal to ask, the answer is no:
// when in doubt, the write does not happen.

const approver: Approver = async (call: ToolCall, tool: Tool) => {
  console.log(`\n  APPROVAL NEEDED: the assistant wants to run ${tool.spec.name} (a ${tool.kind} tool)`)
  for (const [k, v] of Object.entries(call.args ?? {})) console.log(`    ${k}: ${short(String(v), 300)}`)
  if (flags.has('--yes')) return say(true, '--yes')
  if (flags.has('--no')) return say(false, '--no')
  if (!process.stdin.isTTY) return say(false, 'no terminal to ask, so no')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question('  Allow this? (y/n) ')).trim().toLowerCase()
  rl.close()
  return say(answer === 'y' || answer === 'yes', 'you')
}

function say(ok: boolean, who: string) {
  console.log(`  ${ok ? 'Approved' : 'Refused'} (${who})`)
  return ok
}

// Print each policy decision as it is made, and which rule made it.
const rules = new RulePolicy()
const policy: Policy = {
  check(call, tool, c) {
    const { decision, rule } = rules.explain(call, tool, c)
    console.log(`  policy ${call.name} for ${c.actor}: ${decision.toUpperCase()} (${rule})`)
    return decision
  },
}

function show(e: AgentEvent) {
  if (e.type === 'model_call') {
    const asked = e.toolCalls.length ? `asks for ${e.toolCalls.map((c) => c.name).join(', ')}` : 'answers'
    console.log(`\nStep ${e.step}: model call (${e.usage.inputTokens} in, ${e.usage.outputTokens} out), ${asked}`)
  }
  if (e.type === 'tool_call') console.log(`  tool   ${e.name} ${JSON.stringify(e.args)}`)
  if (e.type === 'tool_result') console.log(`  result ${short(e.result)}`)
  if (e.type === 'denied') console.log(`  DENIED ${e.name}: ${e.reason}`)
  if (e.type === 'stopped' && e.reason === 'max_steps') console.log(`\nStopped: hit the step limit.`)
}

// ---------------------------------------------------------------- run

const tools = buildTools()
const budget = new SimpleBudget()

console.log(`Provider: ${config.provider} (${model}), search: ${config.search.mode}, acting as: ${ctx.actor}`)
console.log(`Budget: ${budget.limits.maxModelCalls} model calls, ${budget.limits.maxTokens} tokens`)
console.log(`Question: ${question}`)

try {
  const result = await runAgent(question, { tools, ctx, policy, budget, approver, onEvent: show })
  console.log(`\nAnswer: ${result.answer}`)
  console.log(`\nSpent: ${budget.spent.modelCalls} model calls, ${budget.spent.tokens} tokens`)

  // The mock model only ever searches, and small models do not always pick
  // save_note. So that you always see the door, send the call a model would
  // have made through exactly the same checks the agent uses.
  const triedToSave = result.trace.some((e) => e.type === 'tool_call' && e.name === 'save_note')
  if (!triedToSave) {
    console.log('\nThe model did not call save_note this time. Here is the same write, sent by hand')
    console.log('through the same policy, approver and tool the agent would use:')
    const call: ToolCall = {
      id: 'by_hand',
      name: 'save_note',
      args: { title: 'Note for the owner', body: question.replace(/^please leave a note for the owner:\s*/i, '') },
    }
    const tool = tools.find((t) => t.spec.name === 'save_note')!
    const decision = policy.check(call, tool, ctx)
    const allowed = decision === 'allow' || (decision === 'ask' && (await approver(call, tool)))
    console.log(`  result ${allowed ? await tool.run(call.args, ctx) : 'Denied by policy: save_note was not run.'}`)
  }
} catch (err) {
  if (err instanceof BudgetExceededError) console.error(`\nStopped by the budget: ${err.message}`)
  else console.error(`\nError: ${(err as Error).message}`)
  process.exitCode = 1
}

// What the one door holds now. Append only: nothing here can be edited or deleted.
const saved = listSaved(3)
console.log(`\nLatest saved notes (owner view, ${config.dataDir}):`)
if (saved.length === 0) console.log('  (none yet)')
for (const n of saved) console.log(`  #${n.id} ${n.created_at} ${n.actor}: ${n.title}: ${short(n.body, 80)}`)
