// Ask Mama Dineo's Kitchen: the whole assistant, end to end. Part 6.
//
//   npm run ask -- "Do you deliver to Block L?"     one question
//   npm run ask                                      a conversation; type exit to quit
//   npm run ask -- --engine agent "..."              the Part 4 agent loop instead
//   npm run ask -- --owner "Save a note: ..."        act as the owner
//   npm run ask -- --yes / --no "..."                answer approval questions for you
//
// The default engine is the workflow (src/workflow.ts): cheapest and most
// predictable. The agent engine is the Part 4 loop with RulePolicy,
// SimpleBudget and a person approving writes in the terminal.
//
// Search is by meaning (Part 3) unless SEARCH_MODE=keyword. If the embedding
// model cannot be downloaded, the app says so and falls back to keyword
// search rather than failing.
//
// Each question is answered on its own: neither engine carries memory from
// one question to the next here.

import { createInterface } from 'node:readline'
import path from 'node:path'
import { config } from './config.ts'
import { search } from './search.ts'
import { runAgent } from './agent.ts'
import { answerWithWorkflow } from './workflow.ts'
import { RulePolicy, SimpleBudget } from './guard.ts'
import { checkAnswer, citedFiles, internalSecrets, type Check } from './checks.ts'
import { BudgetExceededError, type Approver, type ToolContext } from './types.ts'

export type Engine = 'workflow' | 'agent'

export interface AppAnswer {
  answer: string
  engine: Engine
  /** Where the answer came from: files the answer cites, or what retrieval returned. */
  sources: string[]
  route?: string
  usage: { modelCalls: number; tokens: number }
  provider: string
  model: string
  checks: Check[]
  /** Workflow only: true when a check replaced the model's answer. */
  replaced: boolean
  /** Workflow only: what the model said before a check replaced it. */
  modelAnswer?: string
}

export const modelName = () =>
  config.provider === 'ollama' ? config.ollama.model : config.provider === 'gemini' ? config.gemini.model : 'mock'

/** Answer one question with either engine. Used by the CLI below, by part6/run.ts and by the tests. */
export async function ask(
  question: string,
  opts: { engine?: Engine; ctx?: ToolContext; approver?: Approver; budget?: SimpleBudget } = {},
): Promise<AppAnswer> {
  const engine = opts.engine ?? 'workflow'
  const ctx = opts.ctx ?? { actor: 'customer' }
  const provider = config.provider
  const model = modelName()

  if (engine === 'workflow') {
    const r = await answerWithWorkflow(question, { ctx, approver: opts.approver, budget: opts.budget })
    return {
      answer: r.answer,
      engine,
      sources: r.cited.length ? r.cited : r.sources,
      route: r.route,
      usage: { modelCalls: r.usage.modelCalls, tokens: r.usage.tokens },
      provider,
      model,
      checks: r.checks,
      replaced: r.replaced,
      modelAnswer: r.modelAnswer,
    }
  }

  // The Part 4 agent: the model decides the steps; code decides what may run.
  const budget = opts.budget ?? new SimpleBudget()
  const retrieved: string[] = []
  let answer: string
  try {
    const r = await runAgent(question, {
      ctx,
      policy: new RulePolicy(),
      budget,
      approver: opts.approver,
      onEvent: (e) => {
        if (e.type === 'tool_result' && e.name === 'search_notes') {
          for (const m of e.result.matchAll(/\[source: ([^\]]+)\]/g)) retrieved.push(m[1])
        }
      },
    })
    answer = r.answer
  } catch (err) {
    if (!(err instanceof BudgetExceededError)) throw err
    answer = `Stopped by the budget before finishing: ${err.message}`
  }
  // The agent's answer goes out as the model wrote it. The same checks the
  // workflow enforces are run here only to report them.
  const checks = checkAnswer(answer, retrieved, internalSecrets())
  const cited = citedFiles(answer)
  return {
    answer,
    engine,
    sources: cited.length ? cited : [...new Set(retrieved)],
    usage: { modelCalls: budget.spent.modelCalls, tokens: budget.spent.tokens },
    provider,
    model,
    checks,
    replaced: false,
  }
}

/** Make sure search works before the first question. Falls back to keyword search if the model cannot load. */
export async function prepareSearch(log: (s: string) => void = console.error): Promise<'keyword' | 'semantic'> {
  if (config.search.mode !== 'semantic') return config.search.mode
  try {
    await search('opening hours')
    return 'semantic'
  } catch (err) {
    const message = (err as Error).message
    if (!/Could not load the embedding model/.test(message)) throw err
    log(`[search] ${message}`)
    log('[search] Falling back to keyword search (Part 2) for this run. Answers may miss questions phrased differently from the notes.')
    config.search.mode = 'keyword'
    return 'keyword'
  }
}

export function receipt(a: AppAnswer): string {
  const calls = `${a.usage.modelCalls} model ${a.usage.modelCalls === 1 ? 'call' : 'calls'}`
  return `Cost: ${calls}, ${a.usage.tokens} tokens | engine: ${a.engine}${a.route ? ` (${a.route})` : ''} | provider: ${a.provider} (${a.model}) | search: ${config.search.mode}`
}

function printAnswer(a: AppAnswer) {
  console.log(`\nAnswer: ${a.answer}`)
  console.log(`Sources: ${a.sources.length ? a.sources.join(', ') : '(none)'}`)
  const failed = a.checks.filter((c) => !c.passed)
  if (failed.length) {
    const what = failed.map((c) => `${c.name} FAILED (${c.detail})`).join('; ')
    console.log(`Checks: ${what}${a.replaced ? '. The model answer was replaced with a safe fallback.' : '. Reported only: the agent engine does not replace answers.'}`)
    if (a.replaced && a.modelAnswer) console.log(`The model had said: ${a.modelAnswer.replace(/\s+/g, ' ').slice(0, 300)}`)
  }
  console.log(receipt(a))
}

// ---------------------------------------------------------------- the command line

async function main() {
  const argv = process.argv.slice(2)
  const flags = new Set(argv.filter((a) => a.startsWith('--')))
  const engineAt = argv.indexOf('--engine')
  const engine = (engineAt >= 0 ? argv[engineAt + 1] : 'workflow') as Engine
  if (engine !== 'workflow' && engine !== 'agent') {
    console.error('Usage: npm run ask -- [--engine workflow|agent] [--owner] [--yes|--no] ["your question"]')
    process.exit(2)
  }
  const words = argv.filter((a, i) => !a.startsWith('--') && !(engineAt >= 0 && i === engineAt + 1))
  const question = words.join(' ').trim()
  const ctx: ToolContext = { actor: flags.has('--owner') ? 'owner' : 'customer' }

  // One reader for the whole run, so an approval question and the next
  // message never fight over the keyboard (or over piped input).
  const rl = createInterface({ input: process.stdin, terminal: false })
  const lines = rl[Symbol.asyncIterator]()
  const readLine = async (prompt: string) => {
    process.stdout.write(prompt)
    const next = await lines.next()
    if (next.done) return null
    // Piped input is not echoed by a terminal, so show it, which keeps logs readable.
    if (!process.stdin.isTTY) process.stdout.write(`${next.value}\n`)
    return String(next.value)
  }

  const approver: Approver = async (call, tool) => {
    console.log(`\n  APPROVAL NEEDED: ${tool.spec.name} (a ${tool.kind} tool) for a ${ctx.actor}`)
    for (const [k, v] of Object.entries(call.args ?? {})) console.log(`    ${k}: ${String(v).slice(0, 300)}`)
    if (flags.has('--yes')) return decided(true, '--yes')
    if (flags.has('--no')) return decided(false, '--no')
    if (question && !process.stdin.isTTY) return decided(false, 'no terminal to ask, so no')
    const answer = await readLine('  Allow this? (y/n) ')
    return decided(answer !== null && /^y(es)?$/i.test(answer.trim()), 'you')
  }
  const decided = (ok: boolean, who: string) => {
    console.log(`  ${ok ? 'Approved' : 'Refused'} (${who})`)
    return ok
  }

  const mode = await prepareSearch()
  console.log(`Ask Mama Dineo's Kitchen. Engine: ${engine}. Provider: ${config.provider} (${modelName()}). Search: ${mode}. Acting as: ${ctx.actor}.`)

  try {
    if (question) {
      printAnswer(await ask(question, { engine, ctx, approver }))
      return
    }
    console.log('Type a question and press Enter. Type exit to quit.')
    for (;;) {
      const line = await readLine('\nYou: ')
      if (line === null || /^\/?(exit|quit)$/i.test(line.trim())) break
      if (!line.trim()) continue
      try {
        printAnswer(await ask(line.trim(), { engine, ctx, approver }))
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`)
      }
    }
    console.log('\nBye.')
  } finally {
    rl.close()
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
if (isMain) {
  main().catch((err) => {
    console.error(`Error: ${(err as Error).message}`)
    process.exitCode = 1
  })
}
