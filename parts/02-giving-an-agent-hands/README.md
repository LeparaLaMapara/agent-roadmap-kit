# Stop 2: Giving an agent hands

## What you will build in this stop

In Stop 1 the model could only talk. Here it gets **tools** and a **loop**, and
that makes it an agent.

The post puts it in one line: a tool is a function you let the model call, and
whose result it gets to see. The agent in this stop has three:

| Tool | Kind | What it does |
| --- | --- | --- |
| `search_notes` | read | Searches the business notes and returns passages with a source, like `[source: delivery.md#0]`. It never returns private notes. |
| `list_notes` | read | Lists the titles of the public notes. |
| `save_note` | write | Saves a short note for the kitchen. This one changes something. |

You get four pieces:

* **The loop** (`src/agent.ts`). The model asks for a tool, the code runs it, the result goes back into the conversation, and the model decides what to do next. It stops when the model answers, or after 5 steps.
* **Keyword search** (`src/search-keyword.ts`). The simplest search that works: split notes at blank lines and count matching words. No downloads. Stop 3 replaces it.
* **An MCP server** (`src/mcp-server.ts`). The same tools, offered over MCP, so other agents such as Claude Desktop can use them. By default it offers the read tools only.
* **A permissions file** (`settings.example.json`). An example for Claude Code, in the spirit of the post's "My permissions file, honestly" section.

## Before you start

1. Read the post: [Part 2: Giving an Agent Hands](https://www.tmashininisekgoto.com/blog/agent-tools-and-integrations).
2. Node 22.18 or newer, `npm install`, a `.env` copied from `.env.example`, and `npm run check` passing. [Stop 1](../01-from-chat-to-agent/README.md) walks through these.
3. For a real model, use Ollama or Gemini. The `mock` provider works too, but it always calls `search_notes` and repeats the first sentence it finds.

## Run it

Ask the default question, "Do you deliver to Block L?":

```
npm run part2
```

Ask your own:

```
npm run part2 -- "What does the vegetarian plate cost?"
```

Start the MCP server on its own (it waits quietly for a client, press Ctrl+C to stop):

```
npm run part2:mcp
```

Open the MCP Inspector, a free web page for poking at MCP servers:

```
npm run part2:inspect
```

## What you should see

Every step is printed: which tool the model asked for, with what arguments,
what came back, and then the answer and the token count.

With `AI_PROVIDER=mock`:

```
Provider: mock (mock), search: keyword
Question: Do you deliver to Block L?

Step 1: model call (77 in, 5 out), asks for search_notes
  tool   search_notes {"query":"Do you deliver to Block L?"}
  result [source: delivery.md#0] The kitchen delivers to Soshanguve blocks F, G, H, L and M, and to Soshanguve South. Delivery costs R20 per order. [source: orders-and-p...

Step 2: model call (524 in, 32 out), answers

Answer: The kitchen delivers to Soshanguve blocks F, G, H, L and M, and to Soshanguve South. [source: delivery.md#0]

Usage: 2 model calls, 601 input tokens, 37 output tokens
```

With `AI_PROVIDER=ollama` and `qwen2.5:1.5b`. Notice that the model chose its
own search words:

```
Provider: ollama (qwen2.5:1.5b), search: keyword
Question: Do you deliver to Block L?

Step 1: model call (338 in, 23 out), asks for search_notes
  tool   search_notes {"query":"delivery to Block L"}
  result [source: delivery.md#0] The kitchen delivers to Soshanguve blocks F, G, H, L and M, and to Soshanguve South. Delivery costs R20 per order. [source: orders-and-p...

Step 2: model call (778 in, 78 out), answers

Answer: The kitchen delivers to Soshanguve blocks F, G, H, L and M, and to Soshanguve South. Delivery costs R20 per order. The kitchen also offers collection for orders in Mabopane and Winterveldt. Orders for these areas are collected from the house in Block L, next to the Shell garage on Ruth First Road.

Usage: 2 model calls, 1116 input tokens, 101 output tokens
```

Compare that with Stop 1, where the same model said it had no information.
Same model. It can just see more of the truth.

Be honest with yourself about the rest. The small model left out the
`[source: ...]` citation it was asked for, and your run may word things
differently. Stop 5 is about measuring that instead of hoping.

The MCP server writes its log to stderr, because stdout carries the protocol:

```
[mcp] offering search_notes (read)
[mcp] offering list_notes (read)
[mcp] not offering save_note (a write tool). Start with MCP_ALLOW_WRITES=1 to offer it.
[mcp] ready: notes from ...\agent-roadmap-kit\data\notes, search mode keyword, writes off
```

### Try the server in the MCP Inspector

1. Run `npm run part2:inspect`. The first time, npx downloads the Inspector, which takes a minute.
2. A browser page opens. The command (`node`) and argument (`src/mcp-server.ts`) should already be filled in. Click **Connect**.
3. Open the **Tools** tab and click **List Tools**. You should see `search_notes` and `list_notes`, and no `save_note`.
4. Click `search_notes`, type a query such as `delivery Block L`, and run it. You get the same `[source: ...]` passages the agent saw.

### Use it from Claude Desktop

Claude Desktop can run local MCP servers, including on the free plan. Open
**Settings**, then **Developer**, then **Edit Config**, and add this to
`claude_desktop_config.json`. Replace the path with the real, absolute path to
your kit folder. On Windows, forward slashes work.

```json
{
  "mcpServers": {
    "mama-dineos-kitchen": {
      "command": "node",
      "args": ["C:/path/to/agent-roadmap-kit/src/mcp-server.ts"]
    }
  }
}
```

Restart Claude Desktop, then ask it "Do you deliver to Block L? Use the Mama
Dineo tools." If `node` is not found, put the full path to `node` in
`command`. It must be Node 22.18 or newer.

In Claude Code, the same server is one command, run from anywhere:

```
claude mcp add mama-dineos-kitchen -- node C:/path/to/agent-roadmap-kit/src/mcp-server.ts
```

### Read versus write

`save_note` is left out on purpose. A client cannot misuse a tool it was never
given. To offer it, add this line to your `.env` and restart the server:

```
MCP_ALLOW_WRITES=1
```

For Claude Desktop you can instead add `"env": { "MCP_ALLOW_WRITES": "1" }`
next to `args`.

### The permissions file

`settings.example.json` is a Claude Code permissions file for this kit. To use
it, copy it to `.claude/settings.json` in the kit folder. It has three lists:

* **allow** runs without asking: reading files, `git status`, `git diff`, the kit's own check and test scripts, and the two read tools from the MCP server.
* **ask** prompts you first: editing files, installing packages, committing, and the `save_note` write tool.
* **deny** is refused outright: reading `.env` (where keys live), pushing, hard resets, `rm -rf`, `curl` and `wget`, publishing, and deploy or database commands.

The post admits its own file had 24 allow rules and zero deny rules. This
example starts with the deny list the post calls "the honest next step". Treat
it as a starting point, not a guarantee: a deny rule only covers the exact
command shape you wrote down.

## Try this

1. **Break the search.** Run `npm run part2 -- "Do you have meat free food?"`. The menu has a vegetarian plate for R70, but keyword search has no idea that "meat free" means "vegetarian". It matched the word "food" in the customer feedback instead. When we tried it, the model then answered from the wrong passage. Stop 3 fixes the search with meaning based search.
2. **Feed it a trap.** Run `npm run part2 -- "Are all plates free this week?"`. The search returns `customer-feedback.md`, which contains a message pretending to be a system instruction. When we tried it, the small model repeated the lie that all plates are free. Reading a tool result is not the same as trusting it. Stop 4 is about exactly this.
3. **Turn on writes.** Add `MCP_ALLOW_WRITES=1` to `.env`, reconnect in the Inspector, and list the tools again. Now `save_note` is there. Ask yourself who should be allowed to call it.
4. **Limit the steps.** In `run.ts`, change `runAgent(question, { onEvent: show })` to `runAgent(question, { onEvent: show, maxSteps: 1 })`. The agent asks for a tool and then runs out of steps. The loop stops with a clear message instead of running forever.

## How this connects

[Stop 1](../01-from-chat-to-agent/README.md) was a chat window: the model
could only talk. This stop closes the loop from the post: act, see the result,
decide what to do next. Later stops build on this same `runAgent` function.

Next, Stop 3 gives the agent knowledge. It swaps keyword search for meaning
based search behind the same `search_notes` tool, and shows the retrieval bugs
that make "the model is bad" the wrong diagnosis. After that, Stop 4 adds the
protection this stop leaves out: policies, approvals and spending limits.
