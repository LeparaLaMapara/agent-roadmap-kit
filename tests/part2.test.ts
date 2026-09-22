// Part 2: keyword search, the tools, the agent loop, and the MCP server.
// Runs offline with the mock model and keyword search (no downloads).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Settings are read when config.ts first loads, so set them before importing.
process.env.AI_PROVIDER = 'mock'
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'kit-part2-'))

const { config } = await import('../src/config.ts')
config.search.mode = 'keyword'
const { keywordSearch } = await import('../src/search-keyword.ts')
const { buildTools, toolSpecs } = await import('../src/tools.ts')
const { runAgent } = await import('../src/agent.ts')
const { BudgetExceededError } = await import('../src/types.ts')

const ROOT = path.resolve(import.meta.dirname, '..')

// ------------------------------------------------------------ keyword search

test('keyword search finds the delivery note for a delivery question', () => {
  const hits = keywordSearch('Do you deliver to Block L?', { k: 3, includeInternal: false })
  assert.ok(hits.length > 0)
  assert.equal(hits[0].source, 'delivery.md#0')
  assert.match(hits[0].text, /blocks F, G, H, L and M/)
  assert.ok(hits.every((h) => h.score > 0))
})

test('keyword search respects k and returns nothing for stop words only', () => {
  assert.ok(keywordSearch('plate', { k: 2, includeInternal: false }).length <= 2)
  assert.deepEqual(keywordSearch('what is the', { k: 5, includeInternal: false }), [])
  assert.deepEqual(keywordSearch('zebra helicopter', { k: 5, includeInternal: false }), [])
})

test('keyword search skips internal notes unless asked', () => {
  const pub = keywordSearch('supplier chicken price per kilogram', { k: 10, includeInternal: false })
  assert.ok(pub.every((h) => !h.internal && !h.source.startsWith('suppliers-internal')))
  const all = keywordSearch('supplier chicken price per kilogram', { k: 10, includeInternal: true })
  assert.ok(all.some((h) => h.source.startsWith('suppliers-internal.md#')))
})

// ------------------------------------------------------------ tools

test('buildTools gives two read tools and one write tool', () => {
  const tools = buildTools()
  const kinds = Object.fromEntries(tools.map((t) => [t.spec.name, t.kind]))
  assert.deepEqual(kinds, { search_notes: 'read', list_notes: 'read', save_note: 'write' })
  assert.deepEqual(
    toolSpecs(tools).map((s) => s.name),
    ['search_notes', 'list_notes', 'save_note'],
  )
})

test('search_notes cites sources and never returns private notes', async () => {
  const search = buildTools().find((t) => t.spec.name === 'search_notes')!
  const out = await search.run({ query: 'owner private cell number supplier' }, { actor: 'customer' })
  assert.doesNotMatch(out, /suppliers-internal/)
  assert.doesNotMatch(out, /071 000 0000/)
  const delivery = await search.run({ query: 'delivery' }, { actor: 'customer' })
  assert.match(delivery, /\[source: delivery\.md#\d+\]/)
})

test('list_notes lists public titles only', async () => {
  const list = buildTools().find((t) => t.spec.name === 'list_notes')!
  const out = await list.run({}, { actor: 'customer' })
  assert.match(out, /Delivery \(delivery\.md\)/)
  assert.doesNotMatch(out, /internal/i)
})

test('save_note writes through the database and reports back', async () => {
  const save = buildTools().find((t) => t.spec.name === 'save_note')!
  assert.match(await save.run({ title: '', body: 'x' }, { actor: 'owner' }), /needs both/)
  const out = await save.run({ title: 'Vegan request', body: 'Palesa asked for chakalaka without beef stock.' }, { actor: 'owner' })
  assert.match(out, /^Saved note #\d+/)
})

// ------------------------------------------------------------ agent loop

test('runAgent searches, then answers with a citation', async () => {
  const r = await runAgent('Do you deliver to Block L?')
  assert.match(r.answer, /\[source: delivery\.md#0\]/)
  assert.equal(r.steps, 2)
  assert.equal(r.usage.modelCalls, 2)
  assert.ok(r.usage.inputTokens > 0 && r.usage.outputTokens > 0)
  assert.deepEqual(
    r.trace.map((e) => e.type),
    ['model_call', 'tool_call', 'tool_result', 'model_call', 'stopped'],
  )
  const roles = r.messages.map((m) => m.role)
  assert.deepEqual(roles, ['system', 'user', 'assistant', 'tool', 'assistant'])
  const toolMsg = r.messages[3]
  assert.equal(toolMsg.toolName, 'search_notes')
  assert.equal(toolMsg.toolCallId, r.messages[2].toolCalls![0].id)
})

test('onEvent sees the same events as the trace', async () => {
  const seen: string[] = []
  const r = await runAgent('How much is delivery?', { onEvent: (e) => seen.push(e.type) })
  assert.deepEqual(seen, r.trace.map((e) => e.type))
})

test('history carries earlier turns into the next one', async () => {
  const first = await runAgent('Do you deliver to Block L?')
  const second = await runAgent('And what are your hours?', { history: first.messages })
  assert.equal(second.messages.filter((m) => m.role === 'system').length, 1)
  assert.equal(second.messages.filter((m) => m.role === 'user').length, 2)
})

test('maxSteps stops the loop with a clear answer', async () => {
  const r = await runAgent('Do you deliver to Block L?', { maxSteps: 1 })
  assert.match(r.answer, /stopped after 1 step without/)
  assert.equal(r.steps, 1)
  assert.deepEqual(r.trace.at(-1), { type: 'stopped', step: 1, reason: 'max_steps' })
})

test('policy deny blocks the tool and tells the model', async () => {
  const r = await runAgent('Do you deliver to Block L?', { policy: { check: () => 'deny' } })
  assert.ok(r.trace.some((e) => e.type === 'denied'))
  assert.ok(!r.trace.some((e) => e.type === 'tool_result' && e.result.includes('[source:')))
  assert.match(r.messages.find((m) => m.role === 'tool')!.content, /^Denied by policy/)
})

test('policy ask with no approver is a deny; with an approver it runs', async () => {
  const noApprover = await runAgent('Do you deliver to Block L?', { policy: { check: () => 'ask' } })
  assert.match(noApprover.messages.find((m) => m.role === 'tool')!.content, /^Denied by policy/)

  let asked = 0
  const approved = await runAgent('Do you deliver to Block L?', {
    policy: { check: () => 'ask' },
    approver: async () => {
      asked++
      return true
    },
  })
  assert.equal(asked, 1)
  assert.match(approved.answer, /\[source: delivery\.md#0\]/)
})

test('an unknown tool name becomes an error result, not a crash', async () => {
  // Simulate a model asking for a tool that does not exist: the spec shown to
  // the model says "search_notes", but by the time the agent looks the call
  // up, no tool has that name any more.
  const [search] = buildTools()
  let reads = 0
  const shifty = {
    kind: search.kind,
    run: search.run,
    get spec() {
      reads++
      return { ...search.spec, name: reads === 1 ? 'search_notes' : 'renamed' }
    },
  }
  const r = await runAgent('Do you deliver to Block L?', { tools: [shifty] })
  const toolMsg = r.messages.find((m) => m.role === 'tool')!
  assert.match(toolMsg.content, /^Error: there is no tool called "search_notes"/)
  assert.ok(r.answer.length > 0)
})

test('budget is charged after every model call and can stop the run', async () => {
  let calls = 0
  const budget = {
    spent: { modelCalls: 0, tokens: 0 },
    charge() {
      calls++
      if (calls > 1) throw new BudgetExceededError('over budget')
    },
  }
  await assert.rejects(runAgent('Do you deliver to Block L?', { budget }), BudgetExceededError)
  assert.equal(calls, 2)
})

// ------------------------------------------------------------ MCP server

async function listMcpTools(allowWrites: boolean) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  env.SEARCH_MODE = 'keyword'
  if (allowWrites) env.MCP_ALLOW_WRITES = '1'
  else delete env.MCP_ALLOW_WRITES
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'src', 'mcp-server.ts')],
    env,
    stderr: 'ignore',
  })
  const client = new Client({ name: 'part2-test', version: '0.0.0' })
  await client.connect(transport)
  try {
    const { tools } = await client.listTools()
    const result = await client.callTool({ name: 'search_notes', arguments: { query: 'Do you deliver to Block L?' } })
    const text = (result.content as { type: string; text: string }[])[0].text
    return { names: tools.map((t) => t.name).sort(), text }
  } finally {
    await client.close()
  }
}

test('MCP server offers read tools only by default', async () => {
  const { names, text } = await listMcpTools(false)
  assert.deepEqual(names, ['list_notes', 'search_notes'])
  assert.match(text, /\[source: delivery\.md#0\]/)
})

test('MCP server adds save_note only with MCP_ALLOW_WRITES=1', async () => {
  const { names } = await listMcpTools(true)
  assert.deepEqual(names, ['list_notes', 'save_note', 'search_notes'])
})
