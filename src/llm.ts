// Talking to a model. Part 1 of the roadmap.
//
// One function, `chat`, sends a conversation to a model and gets back text
// and, when tools are offered, the tool calls the model wants to make. Three
// providers sit behind it, all free:
//
//   gemini  Google AI Studio free tier (a key, no credit card)
//   ollama  a model running on your own machine (no key, no internet)
//   mock    a scripted stand in (no key, no internet, same answer every time)
//
// Plain fetch, no SDKs, so you can read exactly what goes over the wire.

import { config, type Provider } from './config.ts'

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface Message {
  role: Role
  content: string
  /** On assistant messages: the tools the model asked to call. */
  toolCalls?: ToolCall[]
  /** On tool messages: which call this is the result of. */
  toolCallId?: string
  toolName?: string
  /** Provider specific data that must be sent back unchanged (Gemini's thought signatures). */
  raw?: unknown
}

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema for the arguments. */
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

export interface Usage {
  inputTokens: number
  outputTokens: number
}

export interface ChatResult {
  text: string
  toolCalls: ToolCall[]
  usage: Usage
  provider: Provider
  model: string
  /** The assistant message to append to the conversation. */
  message: Message
}

export interface ChatOptions {
  tools?: ToolSpec[]
  temperature?: number
  provider?: Provider
}

export async function chat(messages: Message[], opts: ChatOptions = {}): Promise<ChatResult> {
  const provider = opts.provider ?? config.provider
  if (provider === 'gemini') return geminiChat(messages, opts)
  if (provider === 'ollama') return ollamaChat(messages, opts)
  return mockChat(messages, opts)
}

let callCounter = 0
const newId = () => `call_${Date.now().toString(36)}_${(callCounter++).toString(36)}`

// ---------------------------------------------------------------- Gemini

async function geminiChat(messages: Message[], opts: ChatOptions): Promise<ChatResult> {
  const { apiKey, model } = config.gemini
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey ' +
        'and put it in .env, or set AI_PROVIDER=ollama or AI_PROVIDER=mock.',
    )
  }

  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const contents: unknown[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: m.content }] })
    if (m.role === 'assistant') {
      // Replay Gemini's own parts when we have them: newer models attach a
      // signature to tool calls and reject the next turn without it.
      if (Array.isArray(m.raw)) contents.push({ role: 'model', parts: m.raw })
      else {
        const parts: unknown[] = []
        if (m.content) parts.push({ text: m.content })
        for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.args } })
        contents.push({ role: 'model', parts })
      }
    }
    if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: m.toolName, response: { content: m.content } } }],
      })
    }
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature: opts.temperature ?? 0.2 },
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }
  if (opts.tools?.length) {
    body.tools = [
      {
        functionDeclarations: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ]
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    },
  )
  const json = (await res.json()) as any
  if (!res.ok) {
    const why = json?.error?.message ?? res.statusText
    if (res.status === 429) {
      throw new Error(`Gemini free tier limit reached (${why}). Wait a minute and try again.`)
    }
    throw new Error(`Gemini error ${res.status}: ${why}`)
  }

  const parts: any[] = json?.candidates?.[0]?.content?.parts ?? []
  const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('')
  const toolCalls: ToolCall[] = parts
    .filter((p) => p.functionCall)
    .map((p) => ({ id: newId(), name: p.functionCall.name, args: p.functionCall.args ?? {} }))
  const usage = {
    inputTokens: json?.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: json?.usageMetadata?.candidatesTokenCount ?? 0,
  }
  return {
    text,
    toolCalls,
    usage,
    provider: 'gemini',
    model,
    message: { role: 'assistant', content: text, toolCalls, raw: parts },
  }
}

// ---------------------------------------------------------------- Ollama

async function ollamaChat(messages: Message[], opts: ChatOptions): Promise<ChatResult> {
  const { host, model } = config.ollama
  const wire = messages.map((m) => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } })),
      }
    }
    if (m.role === 'tool') return { role: 'tool', content: m.content, tool_name: m.toolName }
    return { role: m.role, content: m.content }
  })

  const body: Record<string, unknown> = {
    model,
    messages: wire,
    stream: false,
    options: { temperature: opts.temperature ?? 0.2 },
  }
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
  }

  let res: Response
  try {
    res = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error(
      `Could not reach Ollama at ${host}. Install it from https://ollama.com, then run: ollama pull ${model}`,
    )
  }
  const json = (await res.json()) as any
  if (!res.ok) {
    const why = json?.error ?? res.statusText
    if (String(why).includes('not found')) {
      throw new Error(`Ollama does not have ${model} yet. Run: ollama pull ${model}`)
    }
    throw new Error(`Ollama error ${res.status}: ${why}`)
  }

  const text: string = json?.message?.content ?? ''
  const toolCalls: ToolCall[] = (json?.message?.tool_calls ?? []).map((c: any) => ({
    id: newId(),
    name: c.function?.name,
    args: typeof c.function?.arguments === 'string' ? safeJson(c.function.arguments) : c.function?.arguments ?? {},
  }))
  const usage = { inputTokens: json?.prompt_eval_count ?? 0, outputTokens: json?.eval_count ?? 0 }
  return {
    text,
    toolCalls,
    usage,
    provider: 'ollama',
    model,
    message: { role: 'assistant', content: text, toolCalls },
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------- Mock
//
// A scripted stand in for a model. It is not clever and is not meant to be:
// it exists so every example and every test runs with no key, no internet and
// no cost, and gives the same answer every time (which is exactly what a CI
// pipeline needs, see Part 5).
//
// The script:
//   1. Tools offered and none called yet this turn: call the search tool
//      (or the first tool) with the user's question.
//   2. Tool results present: answer with the first sentence of the first
//      result and cite its source.
//   3. No tools offered, but the message itself carries search results
//      (`[source: ...]` blocks, as the Part 6 workflow sends them): answer
//      from those the same way.
//   4. Otherwise: say plainly that this is the mock.

async function mockChat(messages: Message[], opts: ChatOptions): Promise<ChatResult> {
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user')
  const question = lastUserIndex >= 0 ? messages[lastUserIndex].content : ''
  const since = messages.slice(lastUserIndex + 1)
  const toolResults = since.filter((m) => m.role === 'tool')

  let text = ''
  let toolCalls: ToolCall[] = []

  if (opts.tools?.length && toolResults.length === 0) {
    const tool = opts.tools.find((t) => t.name === 'search_notes') ?? opts.tools[0]
    const argName = Object.keys(tool.parameters.properties)[0] ?? 'query'
    toolCalls = [{ id: newId(), name: tool.name, args: { [argName]: question } }]
  } else if (toolResults.length) {
    text = mockAnswerFrom(toolResults.map((m) => m.content).join('\n'))
  } else if (!opts.tools?.length && question.includes('[source: ')) {
    text = mockAnswerFrom(question)
  } else {
    text = question
      ? `(mock model) You said: "${question}". Set AI_PROVIDER=gemini or ollama for a real model.`
      : '(mock model) Hello.'
  }

  const inputChars = messages.reduce((n, m) => n + m.content.length, 0)
  const usage = { inputTokens: Math.ceil(inputChars / 4), outputTokens: Math.ceil(text.length / 4) + 5 }
  return {
    text,
    toolCalls,
    usage,
    provider: 'mock',
    model: 'mock',
    message: { role: 'assistant', content: text, toolCalls },
  }
}

/** First sentence of the first `[source: ...]` block, with its citation. */
export function mockAnswerFrom(results: string): string {
  const match = results.match(/\[source: ([^\]]+)\]\s*([\s\S]*?)(?=\n\[source: |$)/)
  if (!match) {
    const plain = results.trim()
    return plain ? firstSentence(plain) : "I could not find that in the notes."
  }
  const [, source, body] = match
  return `${firstSentence(body.trim())} [source: ${source}]`
}

function firstSentence(s: string): string {
  // Markdown heading lines are titles, not answers.
  const flat = s.replace(/^#{1,6}\s.*$/gm, '').replace(/\s+/g, ' ').trim()
  const m = flat.match(/^(.+?[.!?])(\s|$)/)
  return (m ? m[1] : flat).slice(0, 400)
}
