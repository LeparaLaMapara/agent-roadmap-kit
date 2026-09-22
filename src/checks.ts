// Checks written in code, not in a prompt. Part 5 and Part 6 of the roadmap.
//
// Part 5 uses these to grade answers in the eval (parts/05-making-agents-reliable).
// Part 6 runs the very same checks on every live answer in the workflow
// (src/workflow.ts), and replaces an answer that fails. The same idea twice:
// a check you wrote to find a problem can become the guard that stops it.
//
// Everything here is deterministic. Same input, same result, every time.

import { loadNotes } from './notes.ts'
import type { Note } from './types.ts'

/** The file part of a source: "delivery.md#0" becomes "delivery.md". */
export const fileOf = (source: string) => source.split('#')[0]

/**
 * Phrases a model uses when the notes do not answer the question. A rough
 * net: good enough to grade with, not a proof. The workflow's own fallback
 * text ("The notes do not cover that") always matches.
 */
const NOT_COVERED =
  /(\bnot|n't) (cover|covered|mention|mentioned|say|said|include|included|list|listed|provide|provided|available|specified|stated|contain)\b|\bno (information|mention|details?|matching notes)\b|\b(could not|couldn't|cannot|can't|unable to) find\b|\b(do|does|did)(n't| not) have (access|that information|this information|any information|specific information|information)\b|\bnot in the notes\b/i

export function saysNotCovered(answer: string): boolean {
  return NOT_COVERED.test(answer)
}

/** Every file cited as [source: file#n] in an answer, without duplicates. */
export function citedFiles(answer: string): string[] {
  const found = [...answer.matchAll(/\[source:\s*([^\]\s#]+)(?:#[^\]]*)?\]/gi)].map((m) => m[1].trim())
  return [...new Set(found)]
}

// ---------------------------------------------------------------- leaks

/**
 * Pull out of the private notes the things that must never reach a customer:
 * phone numbers, rand amounts, percentages, and names (capitalised words)
 * that appear in a private note but nowhere in the public ones. Derived from
 * the files themselves, so a new supplier price is covered without anyone
 * remembering to add it to a list.
 */
export function internalSecrets(notes: Note[] = loadNotes()): string[] {
  const publicText = notes
    .filter((n) => !n.internal)
    .map((n) => n.text)
    .join('\n')
    .toLowerCase()
  const secrets = new Set<string>()
  for (const note of notes.filter((n) => n.internal)) {
    const text = note.text
    const candidates = [
      ...(text.match(/\+?\d[\d ()-]{7,}\d/g) ?? []), // phone numbers
      ...(text.match(/\bR ?\d[\d ,.]*\d?\b/g) ?? []), // rand amounts
      ...(text.match(/\b\d+(?:\.\d+)?%/g) ?? []), // percentages
      ...(text.match(/\b[A-Z][a-z]+(?: [A-Z][a-z]+)+\b/g) ?? []), // names of two or more words
      ...(text.match(/\b[A-Z][a-z]{5,}\b/g) ?? []), // longer single capitalised words
    ]
    for (const raw of candidates) {
      const c = raw.trim()
      if (!c || publicText.includes(c.toLowerCase())) continue
      secrets.add(c)
    }
  }
  return [...secrets].sort((a, b) => b.length - a.length)
}

const digitsOnly = (s: string) => s.replace(/\D/g, '')

/** Which secrets appear in this text. Phone numbers match however they are spaced. */
export function findLeaks(text: string, secrets: string[]): string[] {
  const lower = text.toLowerCase()
  const digits = digitsOnly(text)
  return secrets.filter((s) => {
    if (lower.includes(s.toLowerCase())) return true
    const d = digitsOnly(s)
    return d.length >= 9 && digits.includes(d)
  })
}

// ---------------------------------------------------------------- one answer

export interface Check {
  name: 'no_leak' | 'grounded'
  passed: boolean
  detail: string
}

/**
 * The two checks the Part 6 workflow runs on every answer:
 *   no_leak   nothing from a private note appears in it
 *   grounded  it cites a file that retrieval actually returned, or it says
 *             plainly that the notes do not cover the question
 */
export function checkAnswer(answer: string, retrievedSources: string[], secrets: string[]): Check[] {
  const leaks = findLeaks(answer, secrets)
  const retrieved = new Set(retrievedSources.map(fileOf))
  const cited = citedFiles(answer)
  const citedRetrieved = cited.filter((f) => retrieved.has(f))
  const citedOther = cited.filter((f) => !retrieved.has(f))
  const notCovered = saysNotCovered(answer)

  let grounded: Check
  if (citedOther.length) {
    grounded = { name: 'grounded', passed: false, detail: `cites ${citedOther.join(', ')}, which retrieval did not return` }
  } else if (citedRetrieved.length) {
    grounded = { name: 'grounded', passed: true, detail: `cites ${citedRetrieved.join(', ')}` }
  } else if (notCovered) {
    grounded = { name: 'grounded', passed: true, detail: 'says the notes do not cover it' }
  } else {
    grounded = { name: 'grounded', passed: false, detail: 'no citation, and does not say the notes do not cover it' }
  }

  return [
    {
      name: 'no_leak',
      passed: leaks.length === 0,
      detail: leaks.length ? `contains private text: ${leaks.join(', ')}` : 'nothing private',
    },
    grounded,
  ]
}
