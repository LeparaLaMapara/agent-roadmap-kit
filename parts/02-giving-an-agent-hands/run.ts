// Part 2: the agent loop, with hands.
//
//   npm run part2
//   npm run part2 -- "What does the vegetarian plate cost?"
//
// Prints every step: which tool the model asked for, with what arguments,
// what came back, and then the answer and what it cost in tokens.

import { config } from '../../src/config.ts'
import { runAgent, type AgentEvent } from '../../src/agent.ts'

// Part 2 uses keyword search, so nothing is downloaded. Part 3 changes this.
config.search.mode = 'keyword'

const question = process.argv.slice(2).join(' ').trim() || 'Do you deliver to Block L?'
const model = config.provider === 'ollama' ? config.ollama.model : config.provider === 'gemini' ? config.gemini.model : 'mock'

const short = (s: string, n = 160) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n)}...` : flat
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

console.log(`Provider: ${config.provider} (${model}), search: ${config.search.mode}`)
console.log(`Question: ${question}`)

try {
  const result = await runAgent(question, { onEvent: show })
  console.log(`\nAnswer: ${result.answer}`)
  console.log(
    `\nUsage: ${result.usage.modelCalls} model calls, ${result.usage.inputTokens} input tokens, ${result.usage.outputTokens} output tokens`,
  )
} catch (err) {
  console.error(`\nError: ${(err as Error).message}`)
  process.exitCode = 1
}
