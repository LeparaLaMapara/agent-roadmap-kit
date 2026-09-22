// Part 1: the chat script runs, answers once, and keeps a multi turn history.
// Runs offline with the mock model.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const CHAT = path.join(ROOT, 'parts', '01-from-chat-to-agent', 'chat.ts')
const env = { ...process.env, AI_PROVIDER: 'mock' }

test('chat --once answers a single question and exits', () => {
  const r = spawnSync(process.execPath, [CHAT, '--once', 'Do you deliver to Block L?'], { env, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /No tools, no notes/)
  assert.match(r.stdout, /\(mock model\) You said: "Do you deliver to Block L\?"/)
  assert.match(r.stdout, /tokens in/)
})

test('chat --once with no question explains how to use it', () => {
  const r = spawnSync(process.execPath, [CHAT, '--once'], { env, encoding: 'utf8' })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /Usage/)
})

test('interactive chat keeps history across turns and quits on /exit', () => {
  const r = spawnSync(process.execPath, [CHAT], { env, encoding: 'utf8', input: 'hello\nwhat about Block L?\n/exit\n' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /You said: "hello"/)
  assert.match(r.stdout, /You said: "what about Block L\?"/)
  // system + 2 user + 2 assistant: the whole conversation is sent every turn.
  assert.match(r.stdout, /Messages in context: 5/)
  assert.match(r.stdout, /Bye\./)
})
