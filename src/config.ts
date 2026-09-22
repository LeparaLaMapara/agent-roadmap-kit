// One place for every setting in the kit.
//
// Values come from environment variables, which you can put in a `.env` file
// next to package.json (copy `.env.example`). Nothing here costs money: the
// defaults use Google's free Gemini tier, a local Ollama model, or `mock`,
// which needs no key and no internet at all.

import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const envFile = path.join(ROOT, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const env = (name: string, fallback: string) => process.env[name]?.trim() || fallback
const num = (name: string, fallback: number) => {
  const raw = process.env[name]
  const n = raw === undefined || raw === '' ? NaN : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export type Provider = 'gemini' | 'ollama' | 'mock'

function pickProvider(): Provider {
  const chosen = env('AI_PROVIDER', '').toLowerCase()
  if (chosen === 'gemini' || chosen === 'ollama' || chosen === 'mock') return chosen
  // No choice made: use Gemini if a key is present, otherwise the mock, so the
  // kit always runs on a fresh clone.
  return process.env.GEMINI_API_KEY ? 'gemini' : 'mock'
}

export const config = {
  root: ROOT,
  provider: pickProvider(),

  gemini: {
    apiKey: env('GEMINI_API_KEY', ''),
    // An alias Google keeps pointed at its current free Flash model.
    model: env('GEMINI_MODEL', 'gemini-flash-latest'),
  },
  ollama: {
    host: env('OLLAMA_HOST', 'http://localhost:11434'),
    model: env('OLLAMA_MODEL', 'qwen2.5:1.5b'),
  },

  // Your documents. Point this at your own folder of .md or .txt files.
  notesDir: path.resolve(ROOT, env('NOTES_DIR', 'data/notes')),
  // Where the kit writes things it builds: the search index, the database.
  dataDir: path.resolve(ROOT, env('DATA_DIR', '.data')),

  // Part 3: retrieval settings, the same shape as the blog post describes.
  search: {
    mode: env('SEARCH_MODE', 'semantic') as 'keyword' | 'semantic',
    chunkChars: num('CHUNK_CHARS', 1200),
    overlapChars: num('CHUNK_OVERLAP', 150),
    topK: num('TOP_K', 8),
    minScore: num('MIN_SCORE', 0.25),
    embedModel: env('EMBED_MODEL', 'Xenova/all-MiniLM-L6-v2'),
  },

  // Part 4: spending limits are a safety control too.
  budget: {
    maxModelCalls: num('MAX_MODEL_CALLS', 8),
    maxTokens: num('MAX_TOKENS', 20000),
  },
}

export type Config = typeof config
