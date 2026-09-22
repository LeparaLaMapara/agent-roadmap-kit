# Stop 6: From one agent to an agentic system

Companion to [Part 6: From One Agent to an Agentic System](https://www.tmashininisekgoto.com/blog/from-one-agent-to-an-agentic-system).

## What you will build in this stop

The last stop puts every piece together into one assistant, **Ask Mama Dineo's Kitchen**, and uses it to test the post's main ideas on real numbers instead of opinions.

The post's most important distinction is **loops versus workflows**:

* A **workflow** is a fixed sequence you decided in advance. Same path every time.
* A **loop** is an agent deciding what to do next based on what just happened.

Since Part 2 the kit has been a loop: the model decides whether to search, what to search for, and when it is done. In this stop you build the same assistant as a workflow, where code decides the steps and the model does exactly one thing, and then you compare the two.

| Piece | File | What it does |
| --- | --- | --- |
| The workflow | `src/workflow.ts` | Route with plain rules, search, ONE model call, check the answer in code, and never write without the policy and a person. |
| The checks | `src/checks.ts` | The same deterministic checks the Part 5 eval uses to grade answers, now run on every live answer. |
| The app | `src/app.ts` (`npm run ask`) | The finished assistant. The workflow by default, or the Part 4 agent loop with `--engine agent`. |
| The comparison | `run.ts` (`npm run part6`) | The same 7 questions through both engines: model calls, tokens, time, citations, checks. Then bounded autonomy: a budget stopping the loop, and a write waiting for a human. |
| Tests | `tests/part6.test.ts` | The router rules, one model call at most, a leaking answer replaced, no write without approval, both engines answering. |

## The final system

```text
                         customer message
                                |
                                v
                  +----------------------------+
                  |  1. ROUTER (plain rules)   |   code decides, same message, same route
                  +----------------------------+
                     |            |           |
            smalltalk|    question|           |write ("leave a note for the owner")
                     v            v           v
             fixed reply   +--------------+   +-----------------------------+
             no model      | 2. RETRIEVE  |   | draft the note in code      |
                           |   search()   |   | no model                    |
                           +--------------+   +-----------------------------+
                             |          |                   |
                     nothing |          | notes found       v
                     found   v          v     +-----------------------------+
                  "The notes do   +-----------------+  | RulePolicy (policy.json)    |
                   not cover      | 3. ANSWER       |  |  owner: allow               |
                   that."         |  ONE model call |  |  customer: ask a person     |
                   no model       |  fenced notes,  |  +-----------------------------+
                                  |  no tools       |        |  yes          | no, or
                                  +-----------------+        v               | nobody asked
                                          |           +---------------+     v
                                          v           | THE ONE DOOR  |   "drafted but
                                  +-----------------+ | db.ts, SQLite |    not saved"
                                  | 4. CHECKS       | | append only   |
                                  |  no private     | +---------------+
                                  |  text? cites a  |
                                  |  retrieved note,|
                                  |  or says "not   |
                                  |  covered"?      |
                                  +-----------------+
                                    | pass     | fail
                                    v          v
                                  reply     safe fallback reply
```

Only box 3 is probabilistic. Everything around it is code that gives the same result every time. That is the post's "putting the probabilistic part inside a deterministic box", and it is the idea the post says it would keep if it could keep only one.

One word of care. The router here sorts **messages** with rules. It is not the **model routing** from the post (choosing a cheap or an expensive model per request). Like the post's site, this kit uses one model, named in one place, with a thin provider interface (`src/llm.ts`) that lets you switch between Gemini, Ollama and the mock. That is portability, not a gateway.

## Before you start

1. Read the post: https://www.tmashininisekgoto.com/blog/from-one-agent-to-an-agentic-system
2. You need Node 22.18 or newer (`node -v`).
3. From the kit folder, install once: `npm install`
4. Copy `.env.example` to `.env`. `AI_PROVIDER=mock` works with no key and no internet. For a real model use `AI_PROVIDER=ollama` (install Ollama, then `ollama pull qwen2.5:1.5b`) or a free Gemini key.
5. Check everything works: `npm run check`

The app searches by meaning (Part 3), so the first run downloads the small embedding model (about 23 MB). If that download fails, the app says so and falls back to keyword search from Part 2 for that run.

## Run it

```bash
npm run ask -- "Do you deliver to Block L?"            # one question, the workflow
npm run ask                                            # a conversation; type exit to quit
npm run ask -- --engine agent "Do you deliver to Block L?"   # the Part 4 agent loop instead
npm run ask -- "Please leave a note for the owner: more chakalaka on Sundays"
npm run ask -- --owner "Save a note: order more maize meal on Friday."
npm run ask -- --yes "..."                             # approve writes without being asked
npm run ask -- --no "..."                              # refuse writes without being asked

npm run part6                                          # the comparison and the bounded autonomy demo
npm run part6 -- --yes                                 # also approve the demo write

npm test                                               # tests/part6.test.ts and all the others
```

Each question is answered on its own. Neither engine carries memory from one question to the next in the app.

Approved writes go to `.data/kitchen.db`, through the same one door as Part 4.

## What you should see

### `npm run ask`, with Ollama (qwen2.5:1.5b)

A normal question. One model call, a citation, and a one line cost receipt:

```text
Ask Mama Dineo's Kitchen. Engine: workflow. Provider: ollama (qwen2.5:1.5b). Search: semantic. Acting as: customer.

Answer: A full plate costs R85. [source: menu.md#0]
Sources: menu.md
Cost: 1 model call, 370 tokens | engine: workflow (question) | provider: ollama (qwen2.5:1.5b) | search: semantic
```

A check firing, for "Can I get food brought to my house in Block L?". The model gave no citation, so code replaced the answer before a customer saw it, and shows you what the model had said (it answered a question about delivery with the collection address):

```text
Answer: I could not give a safe answer to that from the notes. The closest notes are delivery.md, customer-feedback.md, menu.md, policies.md, about.md. You can also ask the kitchen directly on WhatsApp.
Sources: delivery.md#0, customer-feedback.md#0, menu.md#0, policies.md#0, about.md#0
Checks: grounded FAILED (no citation, and does not say the notes do not cover it). The model answer was replaced with a safe fallback.
The model had said: Yes, you can collect from the house in Block L, next to the Shell garage on Ruth First Road.
Cost: 1 model call, 907 tokens | engine: workflow (question) | provider: ollama (qwen2.5:1.5b) | search: semantic
```

The same question with `--engine agent`. The loop answered without searching, and invented a citation. The same check fires, but the loop has nowhere to act on it, so the answer goes out:

```text
Answer: To determine if you can get food brought to your house in Block L, I would need to check the kitchen's delivery policy. I can search the kitchen's notes to find this information. [source: search_notes#0]
Sources: search_notes
Checks: grounded FAILED (cites search_notes, which retrieval did not return). Reported only: the agent engine does not replace answers.
Cost: 1 model call, 390 tokens | engine: agent | provider: ollama (qwen2.5:1.5b) | search: semantic
```

A write. Code drafts the note, the policy says ASK for a customer, and nothing is saved unless a person says yes:

```text
  APPROVAL NEEDED: save_note (a write tool) for a customer
    title: Message for the owner
    body: can you add a vegan chakalaka on Sundays? From Palesa, Block L.
  Refused (--no)

Answer: Your note is drafted but not saved: it was not approved.
Sources: (none)
Cost: 0 model calls, 0 tokens | engine: workflow (write) | provider: ollama (qwen2.5:1.5b) | search: semantic
```

### `npm run part6`, with Ollama (qwen2.5:1.5b), trimmed

```text
                                            (a) workflow                    (b) agent loop
question                                    calls tokens     ms  cite chk   calls tokens     ms  cite chk
------------------------------------------------------------------------------------------------------
Do you deliver to Block L?                   1    582    588  yes no         2   1233    739  no  YES
When do you shut?                            1    235    106  yes no         1    383    244  no  no
How much is a full plate?                    1    370    119  yes no         1    359    143  no  YES
Can I pay with SnapScan?                     0      0      6  no  no         2    909    485  no  YES
What is the owner's private cell number?     0      0      6  no  no         1    372    171  no  no
Hello!                                       0      0      0  no  no         1    343     66  no  YES
Please leave a note for the owner: can ...   0      0      1  no  no         2    878    437  no  YES

Totals for 7 questions: workflow 3 model calls, 1187 tokens, 826 ms;
                          agent    10 model calls, 4477 tokens, 2286 ms.

The workflow used 3.3 times fewer model calls than the agent (3 against 10).
The workflow used 3.8 times fewer tokens than the agent (1187 against 4477).
Most model calls for one question: workflow 1, agent 2. The workflow cannot go above 1: there is one model step in its code. The agent is limited only by its budget.
4 of 7 questions needed no model at all in the workflow (nothing retrieved, smalltalk, write). Code answered them.
Answers citing a source: workflow 3 of 7, agent 0 of 7.
Checks fired: workflow 0, agent 5 (sent to the customer anyway: the loop has no step where code looks at the answer).
Wall clock: the workflow took 826 ms against the agent's 2286 ms.
```

The first question is slower because Ollama loads the model into memory on its first call.

Every sentence under "What the numbers say" is computed from the run, not written in advance. Two more runs on the same machine gave the same call counts (3 against 10), 3.9 times fewer tokens both times, the workflow citing 2 and 3 answers against the agent's 1, and checks firing on 1 and 0 workflow answers against 6 and 6 agent answers. With the mock the workflow used 4.7 times fewer model calls (3 against 14) and 2.2 times fewer tokens. The mock's token counts are estimates (characters divided by four); Ollama reports real ones.

Be honest about what the table does not say.

* **The loop won one.** For "Can I pay with SnapScan?" the workflow searched with the customer's exact words, found nothing above the threshold (the Part 3 known miss), and said the notes do not cover it. The agent chose its own search words, found the payment note, and answered correctly, only without a citation. That is the flexibility the post describes, and it is real. It is also the same property as being unpredictable.
* **A passing check is not a right answer.** In the same run the workflow answered "When do you shut?" with "The kitchen is closed on Mondays. [source: hours.md#0]". It cites a real note, so every check passes, and it does not answer the question. Only a person, or a golden set like Part 5, decides what "correct" means.
* **The checks are strict.** In another run the model answered the plate question with just "R85." That was right, but it had no citation, so the workflow replaced it with the fallback. A strict check costs you some good answers. The post's question applies: what does it cost if it is wrong, and how quickly will you find out?

### Bounded autonomy, from the same run

```text
The agent loop with MAX_MODEL_CALLS=3, over one short conversation (one budget for the whole chat).
  turn 1: "Do you deliver to Block L?" answered. Spent so far: 2 model calls, 1246 tokens
  turn 2: "And what are your hours?" answered. Spent so far: 3 model calls, 2165 tokens
  turn 3: "How much is a full plate?"
  STOPPED: Budget exceeded: 4 model calls, the limit is 3 (MAX_MODEL_CALLS). Stopping.

  policy: save_note for customer ASK   (actors.customer.byKind.write)
  policy: save_note for owner    ALLOW (actors.owner.byKind.write)

  APPROVAL NEEDED: save_note (a write tool) for a customer
    title: Message for the owner
    body: can you add a vegan chakalaka on Sundays? From Palesa, Block L.
  Refused (no terminal to ask, so no)
  ...
  write: not saved (it was not approved)
  model calls: 0. Code drafted the note; the model was never asked.
```

The budget is checked after each model call, so the loop can go one call over before it stops, as in Part 4. It stops with a clear error instead of a half finished answer. The workflow needs no such guard for its own calls: there is one model step in its code.

## Where the human sits

The post ends with a list of what the engineer still owns: the intent, the architecture, the constraints, the permissions, the risk, the evaluation, the trade offs, and the judgement about what "correct" means. In this kit you can point at the file where each of those lives:

* **Permissions and risk:** `parts/04-making-agents-safe/policy.json`. The post calls the permissions file the place "where the dial actually lives". Customers may read; a customer's write waits for a person; the owner may write; any tool nobody listed is denied.
* **Approving what matters:** the `APPROVAL NEEDED` prompt. A write is cheap to draft and slow to notice if it is wrong, so a person looks first. Approval is only as good as the person pressing y.
* **What "correct" means:** `parts/05-making-agents-reliable/golden.json`. No check can decide it for you. You write it down, and the checks hold the system to it.
* **Choosing the architecture:** the numbers from `npm run part6`. The workflow is the default here because this job's steps are known in advance: route, search, answer, check. Reach for the loop, or for more agents, only when you can say out loud what the extra complexity buys.

What the system owns is the execution: searching, drafting, answering, checking, counting.

## Try this

1. **Change what the router knows.** Add a rule to `WRITE_RULES` in `src/workflow.ts`, for example for "complain", and add a matching case to the router test in `tests/part6.test.ts`. Run `npm test`. Then send a greeting that the rules miss, such as "Hello there, how are you?", and see which route it takes and what it costs.
2. **Turn the dial.** In `policy.json`, change the customer's `"write": "ask"` to `"write": "deny"`, then to `"write": "allow"`, and run `npm run ask -- "Please leave a note for the owner: more chakalaka"` each time. Notice that the workflow code did not change, only the rules file. Put it back.
3. **Make the checks bite.** With `AI_PROVIDER=ollama`, run `npm run part6` three times and count how often each engine's answers fire a check. Then relax the `grounded` check in `src/checks.ts` so an uncited answer passes, and run `npm test` to see which tests hold you to the rule.
4. **Find the loop's case.** Run `npm run ask -- --engine agent "Can I pay with SnapScan?"` and the same without `--engine agent`, a few times each with Ollama. When does the flexibility of the loop win, and what did it cost?

## How this connects

This is the last stop. Here is the post's progression again, with where the kit touches each step:

```text
   chat                     Part 1: a chat window, no tools, no notes
     it can act
   agent                    Part 2: the loop in src/agent.ts
     it knows your work
   + context                Part 3: search by meaning over your notes
     it reaches systems
   + tools                  Part 2: search, list and save, also over MCP
     it cannot do damage
   + boundaries             Part 4: policy, private notes, the one door, the budget
     it learns it is wrong
   + feedback               Part 5: the golden set, regression tests, CI
     only if needed
   specialised agents       not in this kit
     with a clear reason
   orchestrated system      not in this kit
   bounded autonomy         Part 6: one model step, a budget, a person approving writes
```

The kit stops before "specialised agents" and "orchestrated system", and so does the post's own site. It uses no subagents: one assistant with one job does not need them, and the post is clear that five agents are five bills.

## You built the whole thing

Ask Mama Dineo's Kitchen answers customer questions from a folder of business notes, cites where each answer came from, keeps the private notes private, writes only through one guarded door with a person's approval, is tested on every change, and you have measured when a workflow beats a loop.

Which stop added which file:

| Stop | Files it added |
| --- | --- |
| 1. From chat to agent | `src/config.ts`, `src/llm.ts` (Gemini, Ollama and the mock), `src/check.ts`, `parts/01-from-chat-to-agent/` (the chat, BRIEF.md, CLAUDE.md, QUESTIONS.md) |
| 2. Giving an agent hands | `src/agent.ts` (the loop), `src/tools.ts`, `src/search.ts`, `src/search-keyword.ts`, `src/notes.ts`, `src/types.ts`, `src/mcp-server.ts`, `parts/02-giving-an-agent-hands/` (with the permissions file) |
| 3. Giving an agent knowledge | `src/retrieval/` (chunking, embeddings, the pinned index, semantic search), `parts/03-giving-an-agent-knowledge/` |
| 4. Making agents safe | `src/guard.ts` (policy, budget, fence), `src/db.ts` (the one door), `parts/04-making-agents-safe/` (policy.json, the attack) |
| 5. Making agents reliable | `src/checks.ts`, `parts/05-making-agents-reliable/` (golden.json, eval.ts), `.github/workflows/ci.yml`, the regression tests |
| 6. From agent to system | `src/workflow.ts`, `src/app.ts`, `parts/06-from-agent-to-system/run.ts`; and the mock in `src/llm.ts` learned to answer from search results placed in the message |

Every stop has its own tests in `tests/`, and `npm test` runs them all.

The post's advice for where to start applies to your own notes too: point `NOTES_DIR` at your own folder, write a golden set before you trust an answer, keep the permissions narrow and boring, and add a test the first time something breaks.
