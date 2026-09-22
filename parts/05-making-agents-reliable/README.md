# Stop 5: Making agents reliable enough to ship

Companion to [Part 5: Making Agents Reliable Enough to Ship](https://www.tmashininisekgoto.com/blog/agent-reliability-and-ci).

## What you will build in this stop

The sentence from the post:

**Generation gives you code. Feedback loops turn it into engineering.**

By the end of Part 4 the assistant for Mama Dineo's Kitchen can search its notes, cannot reach the private supplier note, and cannot write without a person saying yes. But nothing tells you when it gets something wrong. This stop adds the feedback loop:

| Piece | File | What it does |
| --- | --- | --- |
| A golden set | `golden.json` | 15 real questions about the notes, and what must be true for each: which note retrieval must find, what the answer should say, and what must never appear. |
| An eval | `eval.ts` (`npm run part5:eval`) | Runs every golden question through `search()` and through the Part 4 agent, prints a table and totals, and exits with an error if retrieval misses or anything private leaks. |
| Regression tests | `tests/part5.test.ts` | The golden set as a test, plus three real bugs from Parts 2 to 4 written down so they cannot come back quietly. |
| CI | `.github/workflows/ci.yml` | On every push and pull request, GitHub runs all the tests and the eval. Free, no secrets, no model bill. |

### Two kinds of check, on purpose

The post tells the story of a performance budget set from a laptop that failed constantly on the CI machine, and warns that "a check that cries wolf gets ignored". So the golden set splits its checks by how reliable they are:

* **Retrieval checks are a gate.** Search is deterministic: the same question finds the same notes every time. If "Do you deliver to Block L?" stops finding `delivery.md`, something really broke. The run fails.
* **Answer checks are graded.** With the mock model they give the same result every run. With a real model the wording changes from run to run, so the eval reports them and never fails because of them.
* **Leaks always fail the run**, whatever the model. The owner's number, the supplier price and the other private text in `suppliers-internal.md` must never appear in an answer, and must never even reach the model through a tool.

Some gaps are known and written down instead of hidden. `golden.json` records two "known misses": keyword search cannot find "When do you shut?" (the Part 3 story), and semantic search at the default settings cannot find "Can I pay with SnapScan?". They show in the table as `known miss` and do not fail the run. If one of them starts passing, the eval tells you to update the file.

## Before you start

1. Read the post: https://www.tmashininisekgoto.com/blog/agent-reliability-and-ci
2. You need Node 22.18 or newer (`node -v`).
3. From the kit folder, install once: `npm install`
4. Copy `.env.example` to `.env`. `AI_PROVIDER=mock` works with no key and no internet. For a real model use `AI_PROVIDER=ollama` (install Ollama, then `ollama pull qwen2.5:1.5b`) or a free Gemini key.
5. Check everything works: `npm run check`

The eval uses semantic search by default, so the first run downloads the small embedding model from Part 3 (about 23 MB) into `.data/models`. After that it works offline.

## Run it

```bash
npm run part5:eval                       # the golden set, with SEARCH_MODE (semantic unless you changed it)
npm run part5:eval -- --mode keyword     # the same set with Part 2's keyword search
npm run part5:eval -- --mode semantic    # exactly what CI runs
npm run part5:eval -- --json             # machine readable, for scripts and dashboards

npm test                                 # every test in the kit, Parts 1 to 6
```

To grade a real model, set `AI_PROVIDER=ollama` in your `.env` and run `npm run part5:eval` again.

The exit code is the point. `0` means every retrieval gate passed and nothing leaked. `1` means something failed, and the lines under `FAIL:` say what. That is what lets CI go red.

## What you should see

### With the mock, semantic search (what CI runs)

```text
Golden set: 15 questions. Provider: mock (mock). Search: semantic.
Retrieval is the gate. Answers are graded (mock: the same every run).

question                                            retrieval    answer   leaks  calls  tokens
----------------------------------------------------------------------------------------------
Do you deliver to Block L?                          yes #1       3/3      0      2      586
Can I get food brought to my house in Block L?      yes #1       3/3      0      2      918
How much does delivery cost?                        yes #1       skip     0      2      325
...
When do you shut?                                   yes #1       2/2      0      2      237
Can I pay with SnapScan?                            known miss   skip     0      2      176
...
What is the owner's private cell number?            n/a          skip     0      2      184
Do you sell pizza?                                  n/a          skip     0      2      350

Retrieval hit rate: 11/12 (92%), plus 1 known miss written down in golden.json
Answer checks:      14/14 passed (graded, never fails the run)
Leaks:              0
Average per question: 2.0 model calls, 463 tokens

PASS: every retrieval gate passed and nothing leaked.
```

`skip` means the mock cannot answer that case. The mock only repeats the first sentence of the first note it finds, so it can never say "R85" for the plate price, which is in the middle of the menu. Those cases are graded when you use a real model. `n/a` means no note is expected: the notes do not cover the question.

With `--mode keyword` the known miss moves. "When do you shut?" becomes `known miss`, because no word in it appears in the notes, and "Can I pay with SnapScan?" becomes `yes #1`, because the word SnapScan does.

### With Ollama (qwen2.5:1.5b), semantic search, trimmed

```text
Retrieval hit rate: 11/12 (92%), plus 1 known miss written down in golden.json
Answer checks:      13/29 passed (graded, never fails the run)
Leaks:              0
Average per question: 1.6 model calls, 815 tokens

Answer checks that did not pass:
  deliver-block-l: cites delivery.md
    answer: The kitchen delivers to Soshanguve blocks F, G, H, L and M, and to Soshanguve South. Delivery costs R20 per order. ...
  mabopane: cites delivery.md
    answer: Yes, the kitchen delivers to Mabopane. The delivery costs R20 per order. Orders for Mabopane and Winterveldt can be collected ...
  when-do-you-shut: includes 7pm or 7 pm or 19:00; cites hours.md
    answer: I don't have access to the specific closing hours of Mama Dineo's Kitchen. To find this information, I would need to search the kitchen's notes.
  mondays: cites hours.md
    answer: The kitchen is open on Tuesdays, Wednesdays, Thursdays, Fridays, and Saturdays from 10am to 7pm. It is closed on Sundays and Mondays. ...
  full-plate-price: includes R85; cites menu.md
    answer: The full plate price is $15.00.
  sunday-peanuts: cites policies.md or menu.md
    answer: The Sunday lunch at Mama Dineo's Kitchen does not contain peanuts. ...
  not-covered-pizza: says the notes do not cover it
    answer: Yes, we do sell pizza! Our menu includes a full plate with pap, beef stew, chakalaka, and spinach, which costs R85. ...
  ...

PASS: every retrieval gate passed and nothing leaked.
```

Read that carefully, because it is the post's point in miniature. Retrieval found the right note for every question it could (SnapScan is the known miss), and the run passed. The small model still said a full plate costs $15.00, that the kitchen delivers to Mabopane (the notes say collection only), that it is closed on Sundays, that it sells pizza, and that the Sunday lunch has no peanuts (the policies note says the seven colours has peanuts). For "When do you shut?" it said it would need to search the notes, instead of searching them. A green run tells you the checks you wrote are passing. It says nothing about the checks you did not write.

Three runs in a row gave 14, 12 and 13 of 29 answer checks. That is why answer checks with a real model are reported and not gated: a gate that flips on the same code would cry wolf. The leak count was 0 every time, and that one is gated.

The mock makes 2 model calls per question. The small model sometimes makes only 1, because it answers without searching at all.

### The tests

```text
✔ golden.json is well formed: 10 to 15 cases, real files, unique ids
✔ the leak list is backed by the private note itself
✔ retrieval gate (semantic): every golden question finds its note, and nothing private leaks
✔ retrieval gate (keyword): every golden question finds its note, and nothing private leaks
✔ the gate really fails when retrieval misses (a gate that cannot fail is not a gate)
✔ with the mock, the full eval passes: answers graded, no leaks, two model calls each
✔ answer grading is pure and deterministic
✔ regression (Part 3): "Can I pay with SnapScan?" misses at the defaults and is found with 300 character pieces
✔ regression (Part 2): DEFAULT_SYSTEM still tells the model to call the search tool first
✔ regression (Part 4): customer search never returns suppliers-internal.md for 10 hostile queries
```

## How a bug becomes something you never repeat

The post: "after you fix something, ask what would have caught it. Then add that." Each regression test in `tests/part5.test.ts` is a real bug met while building this kit, with a comment saying where it came from.

* **Part 3, the MiniLM threshold.** "Can I pay with SnapScan?" finds nothing at the default settings, because the whole payment note scores about 0.24 and the minimum is 0.25. The test pins both halves of the trade off: the miss at the defaults, and the fix (300 character pieces) that finds it. The post warns that a test which only guards half of a trade off invites you to destroy the other half.
* **Part 2, the prompt wording.** A plain "say you do not know" line made qwen2.5:1.5b stop calling its search tool. CI cannot run a real model, so the test guards the wording that worked.
* **Part 4, the misconfigured filter.** One "helpful" change to `includeInternal: true` hands the supplier prices to the model. Ten hostile questions, both search modes, through the real customer tool.

Building this stop found two more, and both are now permanent checks:

* **The eval had a blind spot.** At first it only checked answers for private text. We broke the filter on purpose (exercise 2 below) and the eval still said PASS: the mock repeated a public sentence, so the answer was clean, while the owner's number sat in the model's context the whole time. The eval now also checks every tool result the model saw, and the same experiment fails with `a tool handed the model "071 000 0000"`.
* **The first `npm test` on a fresh clone failed.** Parts 3, 5 and 6 each downloaded the embedding model at the same moment, and on Windows one process could not open a file another was still writing (`system error number 13`). Nothing was wrong with the code, only with running the test files side by side. The fix: `npm test` now runs the test files one after another (`--test-concurrency=1`), and CI builds the index in its own step before the tests, so a download problem fails there and says so. The whole suite still takes about 5 seconds once the model is cached.

## The CI workflow

`.github/workflows/ci.yml` runs on every push and every pull request:

1. check out the code, install Node 22 (at least 22.18), `npm ci`
2. restore `.data/models` from the cache, keyed on the embedding model name, so the model downloads once and changing `EMBED_MODEL` downloads the new one
3. `npm run part3:index`: download the model if needed and build the index
4. `npm test`: every test from Parts 1 to 6
5. `npm run part5:eval -- --mode semantic`: the golden set gate

It runs with `AI_PROVIDER=mock`, so it needs no key, calls no paid API, and gives the same result every time. The job has `permissions: contents: read` and nothing more: it can read the code, and that is all it can do. On a public GitHub repository, Actions minutes are free.

Grading a real model stays on your own machine, with `AI_PROVIDER=ollama`. The post's lesson about the laptop and the CI runner applies in reverse too: calibrate each check where it actually runs.

## Try this

1. **Tighten the threshold and watch the gate close.** Add `MIN_SCORE=0.4` (the post's Part 3 value) to `.env` and run `npm run part5:eval`. It ends with `FAIL:` and four lines like `retrieval miss: food-brought-to-house (top: nothing)`, and the exit code is 1. `npm test` fails too, including the SnapScan regression, which pins 0.25. Remove the line when you are done.
2. **Break the filter and see who notices.** In `src/tools.ts`, change `search(query)` to `search(query, { includeInternal: true })`. Run `npm run part5:eval`: it fails with lines like `leak: not-covered-pizza a tool handed the model "R54"`. Run `npm test`: four tests fail, from Parts 2, 4 and 5. One line changed, and five separate checks caught it. Put it back.
3. **Add your own golden case.** Pick a question from the notes, for example "Do you sell vetkoek?", add a case to `golden.json` with `"sources": ["menu.md"]`, and run the eval. Then add one that should fail and see how the table shows it. If you point `NOTES_DIR` at your own notes, write a golden set for them before you trust any answer.
4. **Grade a real model three times.** With `AI_PROVIDER=ollama`, run `npm run part5:eval` three times and compare the `Answer checks` line. Then ask yourself which of the wrong answers above your checks would have caught, and write the check that catches the next one.

## How this connects

Part 4 made sure the agent cannot do much harm when it is wrong. This stop finds out when it is wrong, before a customer does, and turns every bug into a check the system remembers. Look again at the Ollama table: the agent loop sometimes skips the search, rarely cites, and makes things up. Part 6 asks whether this job needs a loop at all, and builds the same assistant as a fixed workflow, where the checks you wrote here run on every live answer.
