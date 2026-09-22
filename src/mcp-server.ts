// The same tools, offered over MCP. Part 2 of the roadmap.
//
// MCP (Model Context Protocol) is an agreed way for a tool provider to say
// "here is what I can do", so any agent that speaks MCP can use it without
// custom glue. This file wraps the kit's tools in a small MCP server that
// talks over stdio, so Claude Desktop, Claude Code, the MCP Inspector, or any
// other MCP client can search Mama Dineo's notes.
//
// Read versus write: by default only the read tools are offered. save_note is
// added only when you start the server with MCP_ALLOW_WRITES=1. A client
// cannot misuse a tool it was never given.
//
// stdout carries the protocol itself, so every log line goes to stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { config } from './config.ts'
import { buildTools } from './tools.ts'
import type { ToolContext } from './types.ts'

const log = (...args: unknown[]) => console.error('[mcp]', ...args)

// Part 2 has no search index yet, so use keyword search unless you picked a
// mode yourself in .env (Part 3 adds the semantic one).
if (!process.env.SEARCH_MODE) config.search.mode = 'keyword'

const allowWrites = process.env.MCP_ALLOW_WRITES === '1'
// Whoever runs this server on their own machine is the owner.
const ctx: ToolContext = { actor: 'owner' }

const server = new McpServer({ name: 'mama-dineos-kitchen', version: '0.1.0' })

for (const tool of buildTools()) {
  if (tool.kind === 'write' && !allowWrites) {
    log(`not offering ${tool.spec.name} (a write tool). Start with MCP_ALLOW_WRITES=1 to offer it.`)
    continue
  }
  // Every argument in the kit's tools is a string, so the JSON schema turns
  // into a zod shape in one line per property.
  const shape: Record<string, z.ZodTypeAny> = {}
  const required = new Set(tool.spec.parameters.required ?? [])
  for (const [name, prop] of Object.entries(tool.spec.parameters.properties)) {
    const description = (prop as { description?: string }).description ?? name
    const field = z.string().describe(description)
    shape[name] = required.has(name) ? field : field.optional()
  }

  server.registerTool(
    tool.spec.name,
    {
      description: tool.spec.description,
      inputSchema: shape,
      annotations: { readOnlyHint: tool.kind === 'read', destructiveHint: false },
    },
    async (args: Record<string, unknown>) => {
      log(`${tool.spec.name} ${JSON.stringify(args)}`)
      const text = await tool.run(args ?? {}, ctx)
      return { content: [{ type: 'text' as const, text }] }
    },
  )
  log(`offering ${tool.spec.name} (${tool.kind})`)
}

await server.connect(new StdioServerTransport())
log(`ready: notes from ${config.notesDir}, search mode ${config.search.mode}, writes ${allowWrites ? 'ON' : 'off'}`)
