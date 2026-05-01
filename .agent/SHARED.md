# SHARED — SentryAgent

## !! MANDATORY WORKFLOW — READ BEFORE ACTING !!

**Step 1 — Before touching any file (.ts, .json, .md, or any other):**
Show the exact old block and the exact new block. No paraphrasing, no pseudocode. Wait for explicit approval before making any edit.

**Step 2 — After every code change:**
Identify which `.agent/*.md` files need updating. Show the exact old text and the exact new text for each. Wait for explicit approval before editing them.

These steps are non-negotiable. A user saying "fix it" or "show the plan" does not satisfy Step 1 — the before/after diff must be shown and approved first.

---

Common rules and context for all AI assistants working in this repository.
For per-file responsibilities, inputs, outputs, and constraints, read `ARCHITECTURE.md`.

## Project summary

Personal Telegram bot that controls a local Windows machine (IIS, Node-RED, files, email). Node.js + TypeScript + Telegraf. Multiple LLM providers via native fetch (no SDKs).

## Stack

- Runtime: Node.js >= 20.6 (native `--env-file`, no dotenv)
- Language: TypeScript 5.x, ESM modules (NodeNext)
- Telegram: Telegraf 4.x
- LLM providers: Gemini, Anthropic, Ollama (all via native fetch)
- No Docker, no ORM, no frameworks beyond Telegraf

## Model management

- Model names are NEVER hardcoded — always read from `config/llm-config.json`.
- Active model per thread is persisted in `config/chats/{chat_id}.json` (written by bot at runtime).
- `config/llm-config.json` is static; only the owner edits it manually.
- `/model` commands are handled in code by `telegram.ts` — they never invoke the LLM.
- Modes: `manual` (default), `ask` on fallback. No auto mode.

For provider-defaults merge, fallback flow, and ACTIVE_MODEL injection details, see `ARCHITECTURE.md → llm.ts`.

## HITL rule (non-negotiable)

Any action with a destructive verb (delete, write, restart, exec, send, unlock) must:

1. NOT execute immediately
2. Return a pending state to `telegram.ts`
3. Send Telegram inline keyboard (✅ Confirm / ❌ Cancel) to owner
4. Execute ONLY after owner taps Confirm

Enforced in code (`executor.ts:classifyAction`), not just in the system prompt. The action-name → category mapping lives there as the single source of truth.

## Conventions

- Imports use `.js` extension even for `.ts` files (ESM NodeNext requirement)
- No `any` unless justified with a comment explaining why
- Read env vars from `process.env` directly — no wrapper
- API keys (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`) come from `.env` only
- Keep `.agent/agent.md` under 200 tokens — do not add content unless asked
- `actions/*.ts` are pure functions — no LLM calls, no Telegram calls inside them

## What NOT to do

- Do not install new npm packages without asking the owner first
- Do not use any LLM SDK (`@google/generative-ai`, `@anthropic-ai/sdk`, etc.)
- Do not modify `config/llm-config.json` from runtime code
- Do not modify `.agent/agent.md` unless explicitly asked
- Do not add logic to `index.ts` beyond bootstrap
- Do not call Telegram API from `executor.ts` or `actions/*.ts`
- Do not call LLM from `actions/*.ts`
- Do not abstract prematurely — keep files simple until there is a real reason
- When modifying `.agent/*.md` files, do not invent facts — ask if unsure

## Logging rules

- `console.log` for informational messages: startup, successful operations, status checks, config loads, fallback activations.
- `console.error` for actual errors only: exceptions, failures, API errors, bootstrap failures.
- Command stderr (from `child_process.exec`) is not an error — log as `console.log`.
- Never log sensitive values: API keys, tokens, whitelist IDs, chat IDs.
- Whitelist enforcement fails silently — no logging of unauthorized attempts.
- No logging libraries — native console only.

## Comments in code

- Default to no comments. Only add one when the WHY is non-obvious.
- Do not describe what a function does if the name is self-explanatory.
- Do not write comments about why something is not implemented yet.