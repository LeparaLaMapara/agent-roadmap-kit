# Stop 3: Giving an Agent Knowledge

Companion to [Part 3 of The Practical Roadmap to Building With AI Agents](https://www.tmashininisekgoto.com/blog/agent-knowledge-and-retrieval).

## What you will build in this stop

In Part 2 the assistant for Mama Dineo's Kitchen searched its notes by matching words. Ask "When do you shut?" and it finds nothing, because the notes say "open" and "closed", never "shut".

In this stop you give it search by meaning, the four steps from the post, all running free on your own machine:

1. **Chunking.** Cut every note into pieces on paragraph boundaries, about 1200 characters each, with about 150 characters carried over into the next piece. Code: `src/retrieval/chunk.ts`.
2. **Embeddings.** Turn each piece into a list of 384 numbers that stands for its meaning, using a small open source model that runs on your computer. Code: `src/retrieval/embed.ts`.
3. **Storing.** Save the pieces and their numbers in `.data/index.json`, together with a record of exactly what the index was built from. Code: `src/retrieval/store.ts`.
4. **Retrieval.** Turn the question into numbers the same way, compare it with every piece, and hand the closest ones to the model. Code: `src/retrieval/search-semantic.ts`.

The agent from Part 2 does not change at all. Its `search_notes` tool calls the same `search()` function, which now searches by meaning.

You will also reproduce the post's three bugs where the model was innocent, and see the fix for each.

## Before you start

* Read [the post](https://www.tmashininisekgoto.com/blog/agent-knowledge-and-retrieval) first. This stop makes more sense once you know the story.
* Node 22.18 or newer.
* In the kit folder, run `npm install`.
* Copy `.env.example` to `.env`. `AI_PROVIDER=mock` works with no key and no internet. `ollama` or `gemini` give you a real model.
* Run `npm run check` to make sure everything is set up.
* The first time you run anything in this stop, the kit downloads the embedding model (`Xenova/all-MiniLM-L6-v2`, about 25 MB) from Hugging Face into `.data/models`. That needs internet once. After that it works offline. `npm run part3:bugs` also downloads a second small model (about 18 MB) the first time, for bug 3.

## Run it

```bash
npm run part3:index                                  # build the search index
npm run part3                                        # ask the agent the default question
npm run part3 -- "Can I get food brought to my house in Block L?"
npm run part3 -- --compare                           # keyword search and semantic search side by side
npm run part3 -- --compare "Can I pay with SnapScan?"
npm run part3:bugs                                   # the three bugs from the post
npm test                                             # includes tests/part3.test.ts
```

You do not have to build the index first. Search builds it if it is missing. `part3:index` just lets you watch it happen.

## What you should see

**Building the index.** Every note here is shorter than 1200 characters, so each one becomes a single piece. On a machine that already has the model this takes under half a second. The very first run, including the download, took about 11 seconds on ours.

```
Notes folder:    ...\agent-roadmap-kit\data\notes
Embedding model: Xenova/all-MiniLM-L6-v2 (downloads about 25 MB the first time)
Chunk settings:  1200 characters, 150 overlap

Pieces:     8 from 8 notes (7 public, 1 internal)
Piece size: 198 to 635 characters
Dimensions: 384 numbers per piece
Embedded:   8 new, 0 reused from the last build
Time:       0.4 s
Saved to:   .data\index.json
Pinned to:  notes fingerprint b32f324f1de9db16, built 2026-09-22T22:49:10.680Z
```

**Asking the agent**, here with Ollama running `qwen2.5:1.5b`. Notice the model chose its own search words, and the kit shows you what retrieval handed it, with scores, separately from the answer. When an answer is wrong, look there first.

```
Provider: ollama (qwen2.5:1.5b), search: semantic (Xenova/all-MiniLM-L6-v2)
Settings: top 8 pieces, minimum score 0.25
Question: Do you deliver to Block L?

Step 1: model call (338 in, 23 out), asks for search_notes
  tool   search_notes {"query":"delivery to Block L"}
  result [source: delivery.md#0] # Delivery The kitchen delivers to Soshanguve blocks F, G, H, L and M, ...

Step 2: model call (653 in, 93 out), answers

Retrieved for "delivery to Block L":
  delivery.md#0              0.491
  customer-feedback.md#0     0.328

Answer: The kitchen does deliver to Block L, Soshanguve. Delivery costs R20 per order. ...

Usage: 2 model calls, 991 input tokens, 116 output tokens
```

With `AI_PROVIDER=mock` you see the same steps, and the mock answers with the first sentence of the top piece.

A small local model does not always search. When we asked `qwen2.5:1.5b` "Can I get food brought to my house in Block L?", it answered without calling the tool, and the kit printed `The model did not search, so it had no notes to go on.` That is a model problem, not a retrieval problem, and the printout lets you tell the two apart.

**Keyword against semantic.** "When do you shut?" shares no useful word with the notes. Meaning based search still finds the hours.

```
Question: When do you shut?

Keyword search (Part 2)             Semantic search (Part 3)
source                     score    source                     score
(nothing)                           hours.md#0                 0.428
```

Semantic search is not magic, though. Try `--compare "Can I pay with SnapScan?"`: keyword search finds the payment note because the word "SnapScan" is in it, while semantic search returns nothing, because the whole payment note only scores 0.24 and the minimum is 0.25. The first exercise below fixes it. (Keyword search cuts notes into single paragraphs, so its piece numbers differ from semantic search's.)

**The three bugs** (`npm run part3:bugs`, trimmed):

```
Bug 1: the index that returned nothing
8 clusters learned from 8 pieces, seed 42.
Pieces per cluster: [0, 2, 1, 1, 0, 2, 1, 1]. 2 clusters are empty.

Question                                          Cluster index                     Exact scan
Do you deliver to Block L?                        NOTHING (cluster 4: 0 pieces)     delivery.md#0
Can I get food brought to my house in Block L?    NOTHING (cluster 4: 0 pieces)     delivery.md#0
How much does delivery cost?                      NOTHING (cluster 4: 0 pieces)     delivery.md#0
What time do you close on Sunday?                 hours.md#0                        hours.md#0

Exact scan over all 8 pieces: 5.2 microseconds per question on this machine.

Bug 2: the database that was the wrong database
Naive search, no pins checked:
  index of data\notes               top: delivery.md#0 (0.459)  "The kitchen delivers to Soshanguve blocks F, G, H, L and M, ..."
  index of .data\bugs\old-notes     top: delivery.md#0 (0.498)  "The kitchen delivers to Soshanguve blocks F, G and H only. ..."
  index of .data\bugs\empty-notes   top: NOTHING
  Every one of these runs without an error. Only the first is the right data.

Pinned search (the kit's real code), handed the old index:
  REFUSED: The search index at ...\.data\bugs\old-index.json does not match the current config.
    notes folder: index was built from "...\.data\bugs\old-notes" but the config points at "...\data\notes"
  Rebuild it for the current config with: npm run part3:index

Bug 3: the right database with the wrong key (a local analogue)
Question                                  Same model              Other model       Other model, no threshold
Do you deliver to Block L?                delivery.md#0 0.46      NOTHING           customer-feedback.md#0 0.12
What time do you close on Sunday?         hours.md#0 0.68         NOTHING           hours.md#0 0.19

Pinned search (the kit's real code), with EMBED_MODEL changed to Xenova/paraphrase-MiniLM-L3-v2:
  REFUSED: ... embedding model: index was built with "Xenova/all-MiniLM-L6-v2" but the config names "Xenova/paraphrase-MiniLM-L3-v2"
```

Each bug also prints its symptom, cause and fix. Bug 3 is an analogue: in the post the real failure was an API key, and local retrieval has no API key. The lesson is the same. Name the configuration you depend on instead of inheriting it.

## The settings, the post's and the kit's

| Setting | The post's site | This kit | Why the kit differs |
| --- | --- | --- | --- |
| Chunk size | about 1200 characters, about 150 overlap | 1200 characters, 150 overlap | It does not. `CHUNK_CHARS` and `CHUNK_OVERLAP` change it. |
| Embeddings | 768 dimensions, Gemini embeddings | 384 dimensions, `all-MiniLM-L6-v2` | The kit runs free and offline on your machine with no key. A smaller model gives fewer numbers per piece. |
| Pieces retrieved | 8 | 8 (`TOP_K`) | It does not. |
| Similarity threshold | 0.4 | 0.25 (`MIN_SCORE`) | MiniLM scores run lower than the post's model. At 0.4 the kit finds nothing for "Can I get food brought to my house in Block L?", whose best match scores 0.367. |
| Where vectors live | Postgres with pgvector | a JSON file, `.data/index.json` | Eight pieces do not need a database. The idea is the same: store the numbers, compare them quickly. |
| How search compares | every vector (the index was removed, bug 1) | every vector | It does not. At this size checking everything takes microseconds and never misses. |
| Refreshing the index | a cheap reindex that hashes each piece and only embeds again what changed, run by hand | the same hashing, and search also notices changed notes and rebuilds by itself | The post says to decide how the index gets refreshed and to assume you will forget. The kit decided. |

## Try this

You change settings by adding lines to your `.env` file. Remove them again when you are done.

1. **Change the chunk size.** Add `CHUNK_CHARS=300` and `CHUNK_OVERLAP=50`, then run `npm run part3:index`. You get 21 smaller pieces instead of 8. Now run `npm run part3 -- --compare "Can I pay with SnapScan?"`. The payment paragraph on its own scores 0.379, so semantic search finds it. Smaller pieces are more focused, but each one carries less context. Try a few questions both ways.
2. **Move the threshold and the count.** Add `MIN_SCORE=0.4`, the post's value, and ask `npm run part3 -- "Can I get food brought to my house in Block L?"`. Retrieval now returns nothing, and the answer gets worse while the model has not changed at all. Then try `MIN_SCORE=0.2`, and `TOP_K=2`. This is precision and recall from the post: a lower threshold and more pieces find more, and hand the model more noise.
3. **Use your own notes.** Put some `.md` or `.txt` files in a folder and add `NOTES_DIR=path/to/your/folder`. Search will refuse with an error naming both folders, because the index was built from the kitchen notes. That is the fix for bug 2 doing its job. Run `npm run part3:index`, then ask your own questions. Any file with "internal" in its name is kept away from customers.
4. **Trigger the staleness trap.** Edit a note, for example add "From October the kitchen is also open on Mondays." to the end of `data/notes/hours.md`. Run `npm run part3 -- "Are you open on Mondays?"`. You will see `[retrieval] The notes changed since the index was built, so it was rebuilt first.` and the answer comes from the new text. Now undo your edit and run `npm run part3:index`. It reports `1 new, 7 reused`: only the piece that changed was embedded again.

## How this connects

Part 2 gave the agent hands: a loop, and a `search_notes` tool that matched keywords. This stop keeps that agent exactly as it was and gives the tool knowledge, by making the search behind it understand meaning. Set `SEARCH_MODE=keyword` in `.env` and `search()` goes back to Part 2's keyword search (`npm run part3` always uses semantic search).

Now the agent reads text and acts differently because of what it read. Open `data/notes/customer-feedback.md` and look at the message from the unknown sender. Part 4 makes the agent safe when the text it reads was written by someone else.
