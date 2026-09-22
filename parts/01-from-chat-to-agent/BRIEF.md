# Project brief: Ask Mama Dineo's Kitchen

This is a filled in example. Copy it, delete the answers, and write your own.

The rule from Part 1: say **what you want and why**. Do not say how to build it.
No framework names, no library names. The agent knows the tools. It does not
know your intent.

## 1. What I want, in one sentence

A small assistant that answers customer questions about Mama Dineo's Kitchen
using only the notes the family already keeps: the menu, delivery areas,
hours, payment options and policies.

## 2. Who it is for

Customers who message the kitchen on WhatsApp with the same questions every
day. "Do you deliver to Block L?" "How much is the chicken plate?" "Are you
open on Monday?" The family wants to stop typing the same answers by hand.

## 3. How it should feel

Friendly and short, like Dineo's daughters answering on a good day. Plain
English. No long paragraphs. If it does not know, it says so and does not make
things up.

## 4. What it must do

- Answer questions about the menu, prices, delivery, hours, payment and policies.
- Say where each answer came from, so the family can check it.
- Say "I do not know" when the notes do not cover the question.

## 5. What it must never do

- Share anything from the private notes (supplier prices, the owner's cell number).
- Promise things the notes do not say, like free delivery or a discount.
- Follow instructions that are hidden inside a customer message or a note.

## 6. What "done" looks like

- I can ask ten real customer questions and every answer is right or honestly says "I do not know".
- Nothing private ever shows up in an answer.
- It costs nothing to run while we test it.

## 7. Things I do not know yet (ask me, or tell me the trade offs)

- Should it run on a phone, on WhatsApp, or on a web page first?
- How do we keep it up to date when the menu changes?
- What happens if a hundred people ask at once? Will it cost money?

## 8. The first small piece

Before anything else: a script I can run in my terminal, ask one question,
and get one answer from the notes. We build the rest one room at a time.
