# Agent Roadmap Kit

The hands on companion to **The Practical Roadmap to Building With AI Agents**, a
six part series by [Thabang Mashinini-Sekgoto](https://www.tmashininisekgoto.com).

Each post is one stop. Each stop adds one working piece. By the last stop you have
built a whole assistant: **Ask Mama Dineo's Kitchen**, which answers customer
questions for a small home kitchen in Soshanguve from a folder of its notes. It
searches by meaning, cites its sources, keeps private notes private, asks a human
before it writes anything, stops itself before it overspends, and has tests that
run on every change.

Mama Dineo's Kitchen is made up. Point the kit at your own folder of notes and the
same assistant answers questions about yours.

**It is free.** No step needs a credit card.

![The finished assistant answering two questions. Asked "Do you deliver to Block L?" it answers yes, R20 per order, and cites delivery.md. Asked "Are all plates free this week?", with a customer review secretly telling the AI to say yes, it answers that the notes do not cover that.](docs/kit-terminal.png)

*Real answers from the finished assistant. The second question has a trap: a customer
review in the notes tells the AI to say every plate is free. Stop 4 is about why it
does not work.*

## The route

| Stop | Post | What you add | Run |
| --- | --- | --- | --- |
| 1 | [From Chat to Agent](https://www.tmashininisekgoto.com/blog/how-i-used-ai-to-build-this-site) | A plain chat, plus the brief, instructions and question templates | `npm run part1` |
| 2 | [Giving an Agent Hands](https://www.tmashininisekgoto.com/blog/agent-tools-and-integrations) | Tools, the agent loop, and an MCP server | `npm run part2` |
| 3 | [Giving an Agent Knowledge](https://www.tmashininisekgoto.com/blog/agent-knowledge-and-retrieval) | Search by meaning, with the three retrieval bugs reproduced | `npm run part3` |
| 4 | [Making Agents Safe Enough to Act](https://www.tmashininisekgoto.com/blog/agent-security-and-permissions) | A policy, a budget, human approval, and one door that writes | `npm run part4` |
| 5 | [Making Agents Reliable Enough to Ship](https://www.tmashininisekgoto.com/blog/agent-reliability-and-ci) | A golden question set, regression tests and CI | `npm run part5:eval` |
| 6 | [From One Agent to an Agentic System](https://www.tmashininisekgoto.com/blog/from-one-agent-to-an-agentic-system) | A workflow beside the agent loop, the cost comparison, and the finished app | `npm run ask` |

Every folder in [parts](parts) has its own README: what you build, what you should
see, and a few things to try. Start at stop 1, or jump to any stop; the shared code
in [src](src) is already complete.

## Setup

You need [Node.js](https://nodejs.org) 22.18 or newer and git.

```bash
git clone https://github.com/LeparaLaMapara/agent-roadmap-kit
cd agent-roadmap-kit
npm install
cp .env.example .env
npm run check
```

On Windows PowerShell use `copy .env.example .env` instead of `cp`.

Then pick a model in `.env`. All three are free:

| `AI_PROVIDER` | What it is | What you need |
| --- | --- | --- |
| `mock` | A scripted stand in. Same answer every time. Good for seeing the plumbing | Nothing |
| `ollama` | A small model running on your own machine | [Ollama](https://ollama.com), then `ollama pull qwen2.5:1.5b` (about 1 GB) |
| `gemini` | Google's Gemini Flash on the free tier | A key from [Google AI Studio](https://aistudio.google.com/apikey), no credit card |

The free Gemini tier has a daily request limit and Google may use free tier
prompts to improve its models, so do not send it anything private. Ollama keeps
everything on your machine.

**If Gemini says your key is invalid.** New keys from AI Studio start with
`AQ.` and can come back with `401 UNAUTHENTICATED` even though they are fine.
The fix that worked for us: open
[Google Cloud credentials](https://console.cloud.google.com/apis/credentials),
pick the key's project, click the key, and under **API restrictions** either
choose **Don't restrict key** or tick **Generative Language API**. Save, wait a
few minutes, then run `npm run check` again. Never paste your key into a chat or
commit it; `.env` is ignored by git for that reason.

Stop 3 downloads a 23 MB embedding model the first time. After that everything
except Gemini works offline.

## The finished assistant

```bash
npm run ask -- "Do you deliver to Block L?"
npm run ask -- --engine agent "Can I pay with SnapScan?"
npm run ask
```

The last one starts an interactive session. To use your own notes, set
`NOTES_DIR` in `.env` to a folder of `.md` or `.txt` files. Any file with
"internal" in its name is treated as private and never reaches a customer.

## Tests

```bash
npm test
```

Every test runs with the mock, so it is free, offline after the first model
download, and gives the same result every time. The same tests run on GitHub
Actions for every push, which is free for public repositories.

## Honest notes

- Small local models are inconsistent. The same question can get a good answer,
  a wrong one, or no search at all, from one run to the next. The READMEs show
  real output, including the bad runs, because that is the point of stops 4 and 5.
- The mock is not a model. It exists so the plumbing, the tests and CI run with no
  key and no cost.
- All three providers were run end to end: the mock and Ollama through every
  stop, and Gemini through the agent loop, the workflow, the attack demo and the
  golden set (every retrieval gate passed, no leaks, 25 of 29 answer checks
  against 12 to 14 for the small local model).

## Licence

MIT. Use it, change it, teach with it.
