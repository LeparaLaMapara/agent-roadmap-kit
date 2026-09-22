// `npm run check`: is everything set up? Run this first.

import { config } from './config.ts'
import { chat } from './llm.ts'
import { loadNotes } from './notes.ts'

const [major, minor] = process.versions.node.split('.').map(Number)
const nodeOk = major > 22 || (major === 22 && minor >= 18)
console.log(`Node ${process.versions.node} ${nodeOk ? 'OK' : 'TOO OLD: install Node 22.18 or newer from https://nodejs.org'}`)

const notes = loadNotes()
console.log(`Notes: ${notes.length} files in ${config.notesDir}`)

const model =
  config.provider === 'gemini' ? config.gemini.model : config.provider === 'ollama' ? config.ollama.model : 'mock'
console.log(`Provider: ${config.provider} (${model})`)

try {
  const r = await chat([{ role: 'user', content: 'Reply with the single word: ready' }])
  console.log(`Model says: ${r.text.trim()}`)
  console.log('All set. Start with: npm run part1')
} catch (err) {
  console.error(`Model check failed: ${(err as Error).message}`)
  process.exitCode = 1
}
