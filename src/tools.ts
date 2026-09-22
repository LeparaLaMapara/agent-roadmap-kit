// The agent's hands. Part 2 of the roadmap.
//
// A tool is a function you let the model call, and whose result it gets to
// see. Each one has a spec (name, what it does, what it needs) that the model
// reads, a kind (read or write), and the code that actually runs.

import type { ToolSpec } from './llm.ts'
import type { Tool } from './types.ts'
import { search, formatHits } from './search.ts'
import { loadNotes } from './notes.ts'

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export function buildTools(): Tool[] {
  const searchNotes: Tool = {
    kind: 'read',
    spec: {
      name: 'search_notes',
      description:
        'Search the kitchen business notes (menu, prices, delivery, hours, payment, policies). Use it for every question about the kitchen.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'What to look for' } },
        required: ['query'],
      },
    },
    async run(args) {
      const query = str(args.query)
      if (!query) return 'Error: search_notes needs a non empty "query".'
      // Customer facing: never includeInternal. Private notes stay private.
      return formatHits(await search(query))
    },
  }

  const listNotes: Tool = {
    kind: 'read',
    spec: {
      name: 'list_notes',
      description: 'List the titles of the business notes the assistant can search.',
      parameters: { type: 'object', properties: {} },
    },
    async run() {
      const notes = loadNotes().filter((n) => !n.internal)
      if (notes.length === 0) return 'There are no notes.'
      return notes.map((n) => `- ${n.title} (${n.id})`).join('\n')
    },
  }

  const saveNoteTool: Tool = {
    kind: 'write',
    spec: {
      name: 'save_note',
      description: 'Save a short note for the kitchen, for example a customer request to follow up on. This changes stored data.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A short title.' },
          body: { type: 'string', description: 'The note itself.' },
        },
        required: ['title', 'body'],
      },
    },
    async run(args, ctx) {
      const title = str(args.title)
      const body = str(args.body)
      if (!title || !body) return 'Error: save_note needs both "title" and "body".'
      // Loaded only when something is actually written, so read only runs
      // never open the database.
      const { saveNote } = await import('./db.ts')
      const result = await saveNote({ title, body }, ctx)
      return result.ok ? `Saved note #${result.id}: "${title}".` : `Not saved: ${result.reason}`
    },
  }

  return [searchNotes, listNotes, saveNoteTool]
}

/** The part of each tool the model is shown. */
export function toolSpecs(tools: Tool[]): ToolSpec[] {
  return tools.map((t) => t.spec)
}
