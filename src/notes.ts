// Loading the documents the assistant knows about.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { config } from './config.ts'
import type { Note } from './types.ts'

export function loadNotes(dir: string = config.notesDir): Note[] {
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    throw new Error(`Notes folder not found: ${dir}. Set NOTES_DIR in .env to a folder of .md or .txt files.`)
  }
  return files
    .filter((f) => /\.(md|txt)$/i.test(f))
    .sort()
    .map((id) => {
      const text = readFileSync(path.join(dir, id), 'utf8').replace(/\r\n/g, '\n')
      const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim()
      return {
        id,
        title: heading ?? id.replace(/\.(md|txt)$/i, ''),
        text,
        // A rule in code, not in a prompt: see Part 4.
        internal: /internal/i.test(id),
      }
    })
}
