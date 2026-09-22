// Part 1: a chat, not an agent.
//
//   npm run part1                                    talk in the terminal, /exit to quit
//   npm run part1 -- --once "Do you deliver to Block L?"   one question, one answer
//
// This is the "chat" half of chat versus agent. It sends your words to a
// model and prints the reply. It has no tools, so it cannot look anything up
// and cannot check whether it was right. Ask it about Mama Dineo's Kitchen and
// watch it either admit it does not know or confidently make something up.
// Part 2 gives it hands.

import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { config } from '../../src/config.ts'
import { chat, type Message } from '../../src/llm.ts'

const SYSTEM = "You are the assistant for Mama Dineo's Kitchen, a home kitchen in Soshanguve. Be brief."

const model = config.provider === 'ollama' ? config.ollama.model : config.provider === 'gemini' ? config.gemini.model : 'mock'

// The context: everything the model sees on each turn. It grows every turn,
// because the model remembers nothing between calls. We send it all again.
const history: Message[] = [{ role: 'system', content: SYSTEM }]
let totalIn = 0
let totalOut = 0

async function turn(question: string): Promise<void> {
  history.push({ role: 'user', content: question })
  const result = await chat(history)
  history.push(result.message)
  totalIn += result.usage.inputTokens
  totalOut += result.usage.outputTokens
  console.log(`\nAssistant: ${result.text.trim()}`)
  console.log(
    `  (this turn: ${result.usage.inputTokens} tokens in, ${result.usage.outputTokens} out. ` +
      `So far: ${totalIn} in, ${totalOut} out. Messages in context: ${history.length})`,
  )
}

const onceIndex = process.argv.indexOf('--once')

try {
  console.log(`Chat with ${config.provider} (${model}). No tools, no notes: it only knows what you type.`)
  if (onceIndex !== -1) {
    const question = process.argv.slice(onceIndex + 1).join(' ').trim()
    if (!question) throw new Error('Usage: npm run part1 -- --once "your question"')
    console.log(`\nYou: ${question}`)
    await turn(question)
  } else {
    console.log('Type a message and press Enter. Type /exit to quit.')
    const rl = createInterface({ input: stdin, output: stdout, prompt: '\nYou: ' })
    rl.prompt()
    for await (const raw of rl) {
      const line = raw.trim()
      if (line === '/exit') break
      if (line) {
        try {
          await turn(line)
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`)
          history.pop() // forget the question that failed
        }
      }
      rl.prompt()
    }
    rl.close()
    console.log('\nBye.')
  }
} catch (err) {
  console.error(`Error: ${(err as Error).message}`)
  process.exitCode = 1
}
