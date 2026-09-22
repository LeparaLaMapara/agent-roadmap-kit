# Project instructions (starter template)

Copy this file to the top folder of your own project and fill it in. Coding
agents such as Claude Code read a file like this at the start of every
session, so the standing rules live here instead of in your typing.

Part 1 of the roadmap: "When I started, I would explain the same things every
session." This file is the fix. Keep it short. Every line costs desk space
(context) on every turn, so only write what the agent would otherwise get
wrong.

The lines in angle brackets are for you to replace. The example answers are
for the Mama Dineo assistant in this kit.

## What this project is

<One or two sentences. What it does and who it is for.>

Example: An assistant that answers customer questions for Mama Dineo's
Kitchen, a home kitchen in Soshanguve, using only the notes in `data/notes`.

## How to run and check it

<The exact commands. The agent should run these after every change, so it can
find out when it is wrong.>

Example:

```
npm install
npm run check
npm test
```

## Where things live

<The few folders that matter, one line each.>

Example:

- `data/notes/` the business notes. Plain Markdown files.
- `src/` the shared code every part uses.
- `tests/` one test file per part.

## Rules that always apply

<Decisions you already made, so the agent does not reopen them every session.>

Example:

- Answers come only from the notes. If the notes do not say, the answer is "I do not know".
- Any file with "internal" in its name is private. Never show it to a customer.
- It must stay free to run. Do not add paid services or new dependencies without asking me.

## How I like to work

- Build one small piece at a time. Stop when it works and show me.
- Explain trade offs in plain English before a big change. I make the decision.
- Run the checks before you tell me something is done. Tell me what you ran and what it printed.
- Never commit, push or deploy unless I ask.

## Things to ask me about, not guess

<Anything where a wrong guess is expensive: money, customer data, anything live.>

Example: prices, delivery areas, anything that changes what a customer is told.
