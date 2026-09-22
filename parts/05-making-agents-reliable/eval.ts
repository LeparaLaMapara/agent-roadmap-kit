// Part 5: the golden set eval.
//
//   npm run part5:eval                        uses SEARCH_MODE (semantic by default)
//   npm run part5:eval -- --mode keyword      Part 2's keyword search
//   npm run part5:eval -- --mode semantic     Part 3's search by meaning
//   npm run part5:eval -- --json              machine readable output
//
// Every question in golden.json goes through two things:
//
//   1. search(), exactly as a customer's search runs. Deterministic, so a miss
//      is a real regression. This is the CI gate.
//   2. The Part 4 agent (runAgent with RulePolicy and SimpleBudget). What it
//      writes is graded against the case's answer checks. With the mock the
//      grades are the same every run; with a real model they vary from run to
//      run, so they are reported and never fail the run.
//
// Leaks are the exception. If private text reaches an answer, or reaches the
// model through a tool result, or a private note comes back from a customer
// search, the run fails, whatever the model.
//
// Exit code: 0 when every retrieval gate passes and nothing leaked, 1 otherwise.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { config } from '../../src/config.ts'
import { search } from '../../src/search.ts'
import { runAgent } from '../../src/agent.ts'
import { RulePolicy, SimpleBudget } from '../../src/guard.ts'
import { citedFiles, fileOf, saysNotCovered } from '../../src/checks.ts'
import { BudgetExceededError } from '../../src/types.ts'

// ---------------------------------------------------------------- the golden set

export interface GoldenCase {
  id: string
  question: string
  retrieval: { sources: string[]; within: number; known_miss?: Partial<Record<'keyword' | 'semantic', string>> }
  answer: { must_include?: string[][]; must_not_include?: string[]; cite?: boolean; not_covered?: boolean }
  mock_can_answer: boolean
}

export interface Golden {
  leaks: { never_in_answer: string[]; never_retrieved: string[] }
  cases: GoldenCase[]
}

export const GOLDEN_FILE = path.join(import.meta.dirname, 'golden.json')

export function loadGolden(file = GOLDEN_FILE): Golden {
  return JSON.parse(readFileSync(file, 'utf8')) as Golden
}

// ---------------------------------------------------------------- retrieval (the gate)

export interface RetrievalResult {
  /** 'hit', 'miss', 'known_miss' (a documented gap), or 'none' (no source expected). */
  status: 'hit' | 'miss' | 'known_miss' | 'none'
  /** 1 based rank of the first expected file, 0 if absent. */
  rank: number
  top: string[]
  /** Private notes that came back from a customer search. Must be empty. */
  leaked: string[]
  /** A documented gap that is not a gap any more. Update golden.json. */
  knownMissNowHits: boolean
}

export async function checkRetrieval(c: GoldenCase, golden: Golden, mode: 'keyword' | 'semantic'): Promise<RetrievalResult> {
  const hits = await search(c.question)
  const files = hits.map((h) => fileOf(h.source))
  const leaked = hits
    .filter((h) => h.internal || golden.leaks.never_retrieved.includes(fileOf(h.source)))
    .map((h) => h.source)
  const rank = files.findIndex((f) => c.retrieval.sources.includes(f)) + 1
  const top = hits.slice(0, 3).map((h) => `${h.source} ${h.score}`)
  if (c.retrieval.sources.length === 0) return { status: 'none', rank: 0, top, leaked, knownMissNowHits: false }
  const hit = rank > 0 && rank <= c.retrieval.within
  const known = c.retrieval.known_miss?.[mode]
  if (hit) return { status: 'hit', rank, top, leaked, knownMissNowHits: Boolean(known) }
  return { status: known ? 'known_miss' : 'miss', rank, top, leaked, knownMissNowHits: false }
}

// ---------------------------------------------------------------- the answer (graded)

export interface Grade {
  check: string
  passed: boolean
}

/** Grade one answer against a case. Pure: no model, no search. */
export function gradeAnswer(answer: string, c: GoldenCase): Grade[] {
  const lower = answer.toLowerCase()
  const grades: Grade[] = []
  for (const group of c.answer.must_include ?? []) {
    grades.push({ check: `includes ${group.join(' or ')}`, passed: group.some((p) => lower.includes(p.toLowerCase())) })
  }
  for (const p of c.answer.must_not_include ?? []) {
    grades.push({ check: `does not say "${p}"`, passed: !lower.includes(p.toLowerCase()) })
  }
  if (c.answer.cite) {
    const cited = citedFiles(answer)
    grades.push({
      check: `cites ${c.retrieval.sources.join(' or ')}`,
      passed: cited.some((f) => c.retrieval.sources.includes(f)),
    })
  }
  if (c.answer.not_covered) grades.push({ check: 'says the notes do not cover it', passed: saysNotCovered(answer) })
  return grades
}

/** Private text in an answer. Any hit fails the run. */
export function answerLeaks(answer: string, golden: Golden): string[] {
  const lower = answer.toLowerCase()
  const digits = answer.replace(/\D/g, '')
  return golden.leaks.never_in_answer.filter((s) => {
    if (lower.includes(s.toLowerCase())) return true
    const d = s.replace(/\D/g, '')
    return d.length >= 9 && digits.includes(d)
  })
}

// ---------------------------------------------------------------- one full run

export interface CaseResult {
  id: string
  question: string
  retrieval: RetrievalResult
  answer: string
  /** Empty when the answer checks were skipped (the mock cannot answer this case). */
  grades: Grade[]
  graded: boolean
  /** Private text in the answer. */
  leaks: string[]
  /** Private text that reached the model through a tool result, even if the answer did not repeat it. */
  contextLeaks: string[]
  modelCalls: number
  tokens: number
}

export interface EvalReport {
  provider: string
  model: string
  mode: 'keyword' | 'semantic'
  cases: CaseResult[]
  totals: {
    gated: number
    hits: number
    knownMisses: number
    misses: number
    hitRate: number
    answerChecksPassed: number
    answerChecks: number
    leaks: number
    avgTokens: number
    avgModelCalls: number
  }
  passed: boolean
  failures: string[]
}

export async function runEval(opts: { mode: 'keyword' | 'semantic'; golden?: Golden; agent?: boolean }): Promise<EvalReport> {
  const golden = opts.golden ?? loadGolden()
  config.search.mode = opts.mode
  const provider = config.provider
  const model = provider === 'ollama' ? config.ollama.model : provider === 'gemini' ? config.gemini.model : 'mock'
  const policy = new RulePolicy()
  const cases: CaseResult[] = []

  for (const c of golden.cases) {
    const retrieval = await checkRetrieval(c, golden, opts.mode)
    let answer = ''
    let modelCalls = 0
    let tokens = 0
    let context = ''
    if (opts.agent !== false) {
      // The Part 4 agent, as a customer, with a fresh budget per question.
      const budget = new SimpleBudget()
      try {
        const r = await runAgent(c.question, { policy, budget, ctx: { actor: 'customer' } })
        answer = r.answer
        context = r.messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n')
      } catch (err) {
        if (!(err instanceof BudgetExceededError)) throw err
        answer = `(stopped by the budget: ${err.message})`
      }
      modelCalls = budget.spent.modelCalls
      tokens = budget.spent.tokens
    }
    const graded = opts.agent !== false && (provider !== 'mock' || c.mock_can_answer)
    cases.push({
      id: c.id,
      question: c.question,
      retrieval,
      answer,
      grades: graded ? gradeAnswer(answer, c) : [],
      graded,
      leaks: answerLeaks(answer, golden),
      contextLeaks: answerLeaks(context, golden),
      modelCalls,
      tokens,
    })
  }

  const gatedCases = cases.filter((r) => r.retrieval.status !== 'none')
  const hits = gatedCases.filter((r) => r.retrieval.status === 'hit').length
  const knownMisses = gatedCases.filter((r) => r.retrieval.status === 'known_miss').length
  const misses = gatedCases.filter((r) => r.retrieval.status === 'miss').length
  const allGrades = cases.flatMap((r) => r.grades)
  const leakCount = cases.reduce((n, r) => n + r.leaks.length + r.contextLeaks.length + r.retrieval.leaked.length, 0)

  const failures: string[] = []
  for (const r of cases) {
    if (r.retrieval.status === 'miss') failures.push(`retrieval miss: ${r.id} (top: ${r.retrieval.top.join(', ') || 'nothing'})`)
    for (const s of r.retrieval.leaked) failures.push(`leak: ${r.id} retrieved private note ${s}`)
    for (const s of r.leaks) failures.push(`leak: ${r.id} answer contains "${s}"`)
    for (const s of r.contextLeaks) failures.push(`leak: ${r.id} a tool handed the model "${s}"`)
  }

  return {
    provider,
    model,
    mode: opts.mode,
    cases,
    totals: {
      gated: gatedCases.length,
      hits,
      knownMisses,
      misses,
      hitRate: gatedCases.length ? hits / gatedCases.length : 1,
      answerChecksPassed: allGrades.filter((g) => g.passed).length,
      answerChecks: allGrades.length,
      leaks: leakCount,
      avgTokens: cases.length ? Math.round(cases.reduce((n, r) => n + r.tokens, 0) / cases.length) : 0,
      avgModelCalls: cases.length ? cases.reduce((n, r) => n + r.modelCalls, 0) / cases.length : 0,
    },
    passed: failures.length === 0,
    failures,
  }
}

// ---------------------------------------------------------------- printing

function printReport(report: EvalReport) {
  const t = report.totals
  const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3)}...` : s)
  console.log(`Golden set: ${report.cases.length} questions. Provider: ${report.provider} (${report.model}). Search: ${report.mode}.`)
  console.log('Retrieval is the gate. Answers are graded' + (report.provider === 'mock' ? ' (mock: the same every run).' : ' and informational (a real model varies run to run).'))
  console.log('')
  const head = `${'question'.padEnd(52)}${'retrieval'.padEnd(13)}${'answer'.padEnd(9)}${'leaks'.padEnd(7)}${'calls'.padEnd(7)}tokens`
  console.log(head)
  console.log('-'.repeat(head.length))
  for (const r of report.cases) {
    const ret =
      r.retrieval.status === 'hit'
        ? `yes #${r.retrieval.rank}`
        : r.retrieval.status === 'miss'
          ? 'MISS'
          : r.retrieval.status === 'known_miss'
            ? 'known miss'
            : 'n/a'
    const passed = r.grades.filter((g) => g.passed).length
    const ans = r.graded ? `${passed}/${r.grades.length}` : 'skip'
    const leaks = r.leaks.length + r.contextLeaks.length + r.retrieval.leaked.length
    console.log(
      `${short(r.question, 50).padEnd(52)}${ret.padEnd(13)}${ans.padEnd(9)}${String(leaks).padEnd(7)}${String(r.modelCalls).padEnd(7)}${r.tokens}`,
    )
  }
  console.log('')
  console.log(
    `Retrieval hit rate: ${t.hits}/${t.gated} (${Math.round(t.hitRate * 100)}%)` +
      (t.knownMisses ? `, plus ${t.knownMisses} known miss${t.knownMisses === 1 ? '' : 'es'} written down in golden.json` : ''),
  )
  console.log(`Answer checks:      ${t.answerChecksPassed}/${t.answerChecks} passed (graded, never fails the run)`)
  console.log(`Leaks:              ${t.leaks}`)
  console.log(`Average per question: ${t.avgModelCalls.toFixed(1)} model calls, ${t.avgTokens} tokens`)

  const failedGrades = report.cases.filter((r) => r.grades.some((g) => !g.passed))
  if (failedGrades.length) {
    console.log('\nAnswer checks that did not pass:')
    for (const r of failedGrades) {
      console.log(`  ${r.id}: ${r.grades.filter((g) => !g.passed).map((g) => g.check).join('; ')}`)
      console.log(`    answer: ${short(r.answer.replace(/\s+/g, ' '), 160)}`)
    }
  }
  const nowHits = report.cases.filter((r) => r.retrieval.knownMissNowHits)
  for (const r of nowHits) {
    console.log(`\nNote: ${r.id} is written down as a known miss in ${report.mode} mode, but it hits now. Update golden.json.`)
  }
  if (report.passed) {
    console.log('\nPASS: every retrieval gate passed and nothing leaked.')
  } else {
    console.log('\nFAIL:')
    for (const f of report.failures) console.log(`  ${f}`)
  }
}

// ---------------------------------------------------------------- main

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
if (isMain) {
  const argv = process.argv.slice(2)
  const modeAt = argv.indexOf('--mode')
  const mode = (modeAt >= 0 ? argv[modeAt + 1] : config.search.mode) as 'keyword' | 'semantic'
  if (mode !== 'keyword' && mode !== 'semantic') {
    console.error('Usage: npm run part5:eval -- [--mode keyword|semantic] [--json]')
    process.exit(2)
  }
  const report = await runEval({ mode })
  if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2))
  else printReport(report)
  process.exitCode = report.passed ? 0 : 1
}
