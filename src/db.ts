// The one door that writes. Part 4 of the roadmap.
//
// Everything the assistant can change goes through saveNote() below, into one
// SQLite table. The post's point is that the real protection should live as
// low as it can go, so the important rules are written into the database
// itself, not into this file's JavaScript:
//
//   CHECK constraints  a title of 1 to 120 characters, a body of 1 to 2000,
//                      an actor that is either 'customer' or 'owner'.
//   Triggers           UPDATE and DELETE raise an error. The table is append
//                      only, so even a buggy or tricked caller cannot rewrite
//                      or erase what was saved. It doubles as a simple audit
//                      trail: who saved what, and when.
//
// The JavaScript checks on top (zod validation, the phone number and "AI
// instruction" speed bumps, the rate limit) give friendlier errors and catch
// more, but if every one of them had a bug the database would still refuse a
// bad row or a rewrite.
//
// Storage is Node's built in `node:sqlite`, so there is nothing to install.
// On Node 22 it prints an ExperimentalWarning the first time it loads. That
// is expected and harmless.

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { config } from './config.ts'
import type { ToolContext } from './types.ts'

export type SaveResult = { ok: true; id: number } | { ok: false; reason: string }

export interface SavedNote {
  id: number
  title: string
  body: string
  actor: 'customer' | 'owner'
  created_at: string
}

/** Customers share this allowance. Owners are not limited. */
export const RATE_LIMIT = { saves: 5, windowMinutes: 60 }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS saved_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  body       TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  actor      TEXT NOT NULL CHECK (actor IN ('customer', 'owner')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TRIGGER IF NOT EXISTS saved_notes_no_update
BEFORE UPDATE ON saved_notes
BEGIN
  SELECT RAISE(ABORT, 'saved_notes is append only: UPDATE is not allowed');
END;

CREATE TRIGGER IF NOT EXISTS saved_notes_no_delete
BEFORE DELETE ON saved_notes
BEGIN
  SELECT RAISE(ABORT, 'saved_notes is append only: DELETE is not allowed');
END;
`

// One open connection per file. Keyed by path so tests can point
// config.dataDir at a fresh temporary folder and get a fresh database.
const open = new Map<string, DatabaseSync>()

/** Where the database file lives: <DATA_DIR>/kitchen.db */
export function dbPath(): string {
  return path.join(config.dataDir, 'kitchen.db')
}

/** Open (and on first use, create) the database. Exported for tests and the attack demo. */
export function openDb(): DatabaseSync {
  const file = dbPath()
  let db = open.get(file)
  if (!db) {
    mkdirSync(path.dirname(file), { recursive: true })
    db = new DatabaseSync(file)
    db.exec(SCHEMA)
    open.set(file, db)
  }
  return db
}

/** Close every open connection (tests use this before deleting their temp folder). */
export function closeDb(): void {
  for (const db of open.values()) db.close()
  open.clear()
}

// ---------------------------------------------------------------- checks

const NoteInput = z.object({
  title: z.string().trim().min(1, 'title is empty').max(120, 'title is longer than 120 characters'),
  body: z.string().trim().min(1, 'body is empty').max(2000, 'body is longer than 2000 characters'),
})

// A speed bump, not a wall. These patterns catch the obvious cases: a South
// African style phone number, or text that reads like orders for an AI. Anyone
// determined can write around them ("zero seven one...", or a polite
// rephrasing). They exist so the easy mistakes and the lazy attacks do not
// land in the table. The walls are the database rules above and the approval
// step in the policy.
const PHONE = /(?:\+?\d[\s().-]*){9,}/
const AI_INSTRUCTION =
  /\b(ignore|disregard|forget)\b.{0,40}\b(instructions?|rules|prompt)\b|\bsystem (note|prompt|message)\b|\byou are now\b|\bnote for the ai\b|\b(ai|assistant)\s*:/i

/** Why this text should not be saved, or null if it looks fine. Exported for tests. */
export function speedBump(text: string): string | null {
  if (PHONE.test(text)) return 'it looks like it contains a phone number; please leave contact details with the owner directly'
  if (AI_INSTRUCTION.test(text)) return 'it looks like an instruction to the AI rather than a note for the kitchen'
  return null
}

// ---------------------------------------------------------------- the door

export async function saveNote(
  input: { title: string; body: string },
  ctx: ToolContext = { actor: 'customer' },
): Promise<SaveResult> {
  const parsed = NoteInput.safeParse(input)
  if (!parsed.success) {
    return { ok: false, reason: `invalid note: ${parsed.error.issues.map((i) => i.message).join('; ')}` }
  }
  const { title, body } = parsed.data

  const bump = speedBump(`${title}\n${body}`)
  if (bump) return { ok: false, reason: `refused: ${bump}` }

  const db = openDb()

  // Rate limit. This kit only knows two actors, so every customer shares one
  // allowance. A real app would key this on a signed in user or a session.
  if (ctx.actor === 'customer') {
    const since = new Date(Date.now() - RATE_LIMIT.windowMinutes * 60_000).toISOString()
    const row = db
      .prepare('SELECT count(*) AS n FROM saved_notes WHERE actor = ? AND created_at >= ?')
      .get(ctx.actor, since) as { n: number }
    if (row.n >= RATE_LIMIT.saves) {
      return {
        ok: false,
        reason: `rate limited: customers may save ${RATE_LIMIT.saves} notes per ${RATE_LIMIT.windowMinutes} minutes`,
      }
    }
  }

  try {
    const result = db
      .prepare('INSERT INTO saved_notes (title, body, actor, created_at) VALUES (?, ?, ?, ?)')
      .run(title, body, ctx.actor, new Date().toISOString())
    return { ok: true, id: Number(result.lastInsertRowid) }
  } catch (err) {
    // The database said no (a CHECK constraint, for example). Report it, do not crash the agent.
    return { ok: false, reason: `the database refused the note: ${(err as Error).message}` }
  }
}

// ---------------------------------------------------------------- reading

/** Saved notes, newest first. For the owner and for tests; no tool exposes this to customers. */
export function listSaved(limit = 50): SavedNote[] {
  return openDb()
    .prepare('SELECT id, title, body, actor, created_at FROM saved_notes ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as SavedNote[]
}

export function countSaved(): number {
  return (openDb().prepare('SELECT count(*) AS n FROM saved_notes').get() as { n: number }).n
}
