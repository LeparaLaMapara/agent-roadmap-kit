// Shared shapes. Every part of the kit agrees on these, which is what lets the
// pieces from different posts snap together into one assistant at the end.

import type { ToolSpec, ToolCall, Usage } from './llm.ts'

/** One document from the notes folder. */
export interface Note {
  /** File name, e.g. "delivery.md". Used in citations. */
  id: string
  title: string
  text: string
  /** Private notes (file name contains "internal") must never reach a customer. */
  internal: boolean
}

/** One search result. `source` looks like "delivery.md#2" (file, chunk number). */
export interface SearchHit {
  source: string
  text: string
  score: number
  internal: boolean
}

export interface SearchOptions {
  k?: number
  /** Default false. Only an owner facing tool may ever set this. */
  includeInternal?: boolean
}

/** Context handed to every tool run. */
export interface ToolContext {
  /** Who is asking: a customer on the public side, or the owner. */
  actor: 'customer' | 'owner'
}

/** A tool the agent can call. Part 2. */
export interface Tool {
  spec: ToolSpec
  /** Read tools look; write tools change something. The difference matters (Part 2, Part 4). */
  kind: 'read' | 'write'
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>
}

/** Decides whether a tool call may run. Part 4 implements this; Part 2 runs without one. */
export interface Policy {
  check(call: ToolCall, tool: Tool, ctx: ToolContext): 'allow' | 'deny' | 'ask'
}

/** Counts spending and stops the agent past a limit. Part 4 implements this. */
export interface Budget {
  /** Record one model call. Throws BudgetExceededError when over the limit. */
  charge(usage: Usage): void
  readonly spent: { modelCalls: number; tokens: number }
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BudgetExceededError'
  }
}

/** Asked when a policy says "ask". Return true to let the call run. */
export type Approver = (call: ToolCall, tool: Tool) => Promise<boolean>
