// Part 3: the same agent, now searching by meaning.
//
//   npm run part3
//   npm run part3 -- "Can I get food brought to my house in Block L?"
//   npm run part3 -- --compare "When do you shut?"
//
// Prints each step of the agent, then exactly what retrieval handed the model
// (sources and scores), then the answer and what it cost. Looking at the
// retrieved pieces separately from the answer is the habit the post is about:
// most bad answers are a good model handed bad information.

import { config } from '../../src/config.ts'
import { runAgent, type AgentEvent } from '../../src/agent.ts'
import { keywordSearch } from '../../src/search-keyword.ts'
import { semanticSearch } from '../../src/retrieval/search-semantic.ts'
import type { SearchHit } from '../../src/types.ts'

// Part 3 always uses meaning based search, whatever SEARCH_MODE says.
config.search.mode = 'semantic'

const args = process.argv.slice(2)
const compare = args.includes('--compare')
const question =
  args.filter((a) => a !== '--compare').join(' ').trim() ||
  (compare ? 'When do you shut?' : 'Do you deliver to Block L?')

const k = config.search.topK
const short = (s: string, n = 160) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n)}...` : flat
}
const hitLine = (h: SearchHit | undefined) => (h ? `${h.source.padEnd(26)} ${h.score.toFixed(3)}` : '')

if (compare) {
  // Side by side: the Part 2 keyword search and the Part 3 semantic search.
  const started = performance.now()
  const semantic = await semanticSearch(question, { k, includeInternal: false })
  const semanticMs = performance.now() - started
  const keyword = keywordSearch(question, { k, includeInternal: false })

  console.log(`Question: ${question}\n`)
  console.log(`${'Keyword search (Part 2)'.padEnd(36)}Semantic search (Part 3)`)
  console.log(`${'source                     score'.padEnd(36)}source                     score`)
  const rows = Math.max(keyword.length, semantic.length, 1)
  for (let i = 0; i < rows; i++) {
    const left = i === 0 && keyword.length === 0 ? '(nothing)' : hitLine(keyword[i])
    const right = i === 0 && semantic.length === 0 ? '(nothing)' : hitLine(semantic[i])
    console.log(`${left.padEnd(36)}${right}`)
  }
  console.log(
    `\nKeyword scores count shared words; semantic scores are cosine similarity (0 to 1), ` +
      `kept only at ${config.search.minScore} or above.`,
  )
  console.log(`Semantic search took ${Math.round(semanticMs)} ms, including loading the model.`)
  process.exit(0)
}

const model = config.provider === 'ollama' ? config.ollama.model : config.provider === 'gemini' ? config.gemini.model : 'mock'
console.log(`Provider: ${config.provider} (${model}), search: semantic (${config.search.embedModel})`)
console.log(`Settings: top ${k} pieces, minimum score ${config.search.minScore}`)
console.log(`Question: ${question}`)

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

try {
  const result = await runAgent(question, { onEvent: show })

  // What retrieval actually returned for each search the model made, with scores.
  const searches = result.trace.filter(
    (e): e is Extract<AgentEvent, { type: 'tool_call' }> => e.type === 'tool_call' && e.name === 'search_notes',
  )
  for (const s of searches) {
    const query = String(s.args.query ?? '')
    const hits = await semanticSearch(query, { k, includeInternal: false })
    console.log(`\nRetrieved for "${query}":`)
    if (hits.length === 0) console.log(`  nothing scored ${config.search.minScore} or above`)
    for (const h of hits) console.log(`  ${hitLine(h)}`)
  }
  if (searches.length === 0) console.log('\nThe model did not search, so it had no notes to go on.')

  console.log(`\nAnswer: ${result.answer}`)
  console.log(
    `\nUsage: ${result.usage.modelCalls} model calls, ${result.usage.inputTokens} input tokens, ${result.usage.outputTokens} output tokens`,
  )
} catch (err) {
  console.error(`\nError: ${(err as Error).message}`)
  process.exitCode = 1
}
