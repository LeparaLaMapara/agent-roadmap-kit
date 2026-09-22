# Stop 1: From chat to agent

## What you will build in this stop

A tiny chat program that runs in your terminal. You type, a model answers.

That is the **chat** half of "chat versus agent". It can only talk. It has no
tools, so it cannot look anything up and cannot check if it was right. Ask it
about Mama Dineo's Kitchen and it has nothing to go on. Stop 2 gives it hands.

You also get three small documents to use on your own project:

| File | What it is for |
| --- | --- |
| `BRIEF.md` | A project brief. Say what you want, not how to build it. Filled in for the Mama Dineo assistant as an example. |
| `CLAUDE.md` | A starter instructions file. Put your standing rules here so you stop repeating them every session. |
| `QUESTIONS.md` | The post's framework for knowing what to ask, as a checklist. |

## Before you start

1. Read the post: [Part 1: From Chat to Agent](https://www.tmashininisekgoto.com/blog/how-i-used-ai-to-build-this-site).
2. Install Node 22.18 or newer from [nodejs.org](https://nodejs.org).
3. In the kit folder, run `npm install`.
4. Copy `.env.example` to a new file called `.env`. Pick a provider inside it. All three are free:
   * `mock` needs no key and no internet. It gives scripted answers.
   * `ollama` runs a model on your own computer. Install [Ollama](https://ollama.com), then run `ollama pull qwen2.5:1.5b`.
   * `gemini` uses a free key from [Google AI Studio](https://aistudio.google.com/apikey).
5. Run `npm run check`. It should end with `All set`.

## Run it

Talk to it. Type `/exit` to quit.

```
npm run part1
```

Ask one question and exit:

```
npm run part1 -- --once "Do you deliver to Block L?"
```

## What you should see

With `AI_PROVIDER=mock`, the scripted stand in just repeats you:

```
Chat with mock (mock). No tools, no notes: it only knows what you type.

You: Do you deliver to Block L?

Assistant: (mock model) You said: "Do you deliver to Block L?". Set AI_PROVIDER=gemini or ollama for a real model.
  (this turn: 29 tokens in, 31 out. So far: 29 in, 31 out. Messages in context: 3)
```

With `AI_PROVIDER=ollama` and `qwen2.5:1.5b`, a real model answers. It does not
know the kitchen, because nobody gave it the notes:

```
Chat with ollama (qwen2.5:1.5b). No tools, no notes: it only knows what you type.

You: Do you deliver to Block L?

Assistant: I'm sorry, but I don't have information on specific delivery areas. You might want to check with Mama Dineo's Kitchen directly or look up their delivery policy on their website or social media pages.
  (this turn: 44 tokens in, 43 out. So far: 44 in, 43 out. Messages in context: 3)
```

The true answer is yes. It is in `data/notes/delivery.md`. The model simply
cannot see that file. Your answer may be worded differently, and a model may
also guess instead of admitting it does not know.

A short conversation shows the context growing. The model remembers nothing
between calls, so the program sends the whole conversation again every turn:

```
You: My name is Thabo.

Assistant: Hello Thabo! Welcome to Mama Dineo's Kitchen. How can I assist you today?
  (this turn: 43 tokens in, 21 out. So far: 43 in, 21 out. Messages in context: 3)

You: What is my name?

Assistant: Your name is Thabo.
  (this turn: 78 tokens in, 7 out. So far: 121 in, 28 out. Messages in context: 5)
```

## Try this

1. **Watch the desk fill up.** Have a conversation of ten turns. Watch "tokens in" grow each turn. That number is the context the post talks about: everything the model sees when it answers.
2. **Catch it guessing.** With Ollama or Gemini, ask "How much is the chicken plate?" The real price is in `data/notes/menu.md`. Does the model say it does not know, or does it invent a price? Either way, it had no way to check.
3. **Write your own brief.** Copy `BRIEF.md`, delete the answers, and fill it in for something you want to build. No framework names allowed.
4. **Start your instructions file.** Copy `CLAUDE.md` into your own project and fill in the "How to run and check it" section first. That one line is what lets an agent find out when it is wrong.

## How this connects

This is the first stop, so there is no earlier one. The chat program here is
the "vending machine" from the post: a request goes in, an answer comes out,
and nothing checks it.

Next, [Stop 2: Giving an agent hands](../02-giving-an-agent-hands/README.md)
wraps the same model in a loop with tools. It searches the notes, reads what
comes back, and answers with a source you can check.
