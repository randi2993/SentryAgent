# SHARED — SentryAgent

## !! MANDATORY WORKFLOW — READ BEFORE ACTING !!

**Step 1 — Before touching any file (.ts, .json, .md, or any other):**
Show the exact old block and the exact new block. No paraphrasing, no pseudocode. Wait for explicit approval before making any edit.

**Step 2 — After every code change:**
Identify which `.agent/*.md` files need updating. Show the exact old text and the exact new text for each. Wait for explicit approval before editing them.

These steps are non-negotiable. A user saying "fix it" or "show the plan" does not satisfy Step 1 — the before/after diff must be shown and approved first.

---

Common rules and context for all AI assistants working in this repository.
Read `ARCHITECTURE.md` for detailed responsibilities per file.

## Project summary

SentryAgent is a personal Telegram bot that controls a local Windows machine (IIS, Node-RED, files, email). Built with Node.js + TypeScript + Telegraf. Supports multiple LLM providers via native fetch (no SDKs).

## Stack

- Runtime: Node.js >= 20.6 (native --env-file, no dotenv)
- Language: TypeScript 5.x, ESM modules (NodeNext)
- Telegram: Telegraf 4.x
- LLM: multi-provider via native fetch only (no SDK of any kind)
  - Gemini → Google Generative Language API
  - Anthropic → Anthropic Messages API
  - Ollama → local endpoint (http://localhost:11434)
- No Docker, no ORM, no frameworks beyond Telegraf

## Project structure

```
src/
├── index.ts              → bootstrap only
├── telegram.ts           → bot + whitelist + commands + thread management
├── llm.ts                → multi-provider LLM client (native fetch)
├── executor.ts           → action orchestrator + HITL
└── actions/
    ├── files.ts          → read, write, delete
    ├── server.ts         → IIS, Node-RED restart
    ├── email.ts          → send, read
    └── system.ts         → unlock, exec

config/
├── llm-config.json       → available models (static, never modified at runtime)
└── chats/
    └── {chat_id}.json    → per-chat model preferences (dynamic, written by bot)

.agent/
├── agent.md              → runtime context loaded by the bot
├── SHARED.md             → this file
├── ARCHITECTURE.md       → file responsibilities (for devs/AI only, not loaded at runtime)
├── INDEX.md              → lazy loading map
└── memory/
    └── learned.md        → machine facts
```

## Model management rules

- Model names are NEVER hardcoded. Always read from `config/llm-config.json`.
- Active model per thread is stored in `config/chats/{chat_id}.json` (written by bot at runtime).
- `config/llm-config.json` is static — never modified by the bot, only by the owner manually.
- Before every LLM call, inject `ACTIVE_MODEL: {model.id} ({provider})` into the system prompt.
  This prevents the model from misidentifying itself based on conversation history.
- Supported modes: `manual` (default), `ask` on fallback.
- No auto mode for now.
- `/model` commands are handled in code by `telegram.ts` — they never invoke the LLM.

## Fallback behavior

- If selected model is unavailable (no API key, Ollama not running, timeout):
  - Log error to console
  - Apply `fallbackBehavior` from `llm-config.json`:
    - `ask` → send inline keyboard to owner (Telegram buttons, not LLM response)
    - `fail` → throw error, notify owner

## HITL rule (non-negotiable)

Any action classified as destructive (delete, restart, overwrite, arbitrary exec) must:

1. NOT execute immediately
2. Return a pending state to `telegram.ts`
3. Send Telegram inline keyboard (✅ Confirm / ❌ Cancel) to owner
4. Execute ONLY after owner taps Confirm

This is enforced in code (`executor.ts`), not just in the system prompt.

## Conventions

- Imports use `.js` extension even for `.ts` files (ESM NodeNext requirement)
- No `any` unless absolutely justified with a comment explaining why
- Environment variables read from `process.env` directly — no wrapper needed
- API keys (GEMINI_API_KEY, ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN) come from `.env` only
- Keep `.agent/agent.md` and `.agent/INDEX.md` under 200 tokens — do not add content without being asked
- `actions/*.ts` are pure functions — no LLM calls, no Telegram calls inside them
- Use `console.error` for logging — no logging libraries

## What NOT to do

- Do not hardcode model names, API URLs, or endpoint paths
- Do not install new npm packages without asking the owner first
- Do not use any LLM SDK (`@google/generative-ai`, `@anthropic-ai/sdk`, etc.)
- Do not modify `config/llm-config.json` in runtime code
- Do not modify `.agent/agent.md` or `.agent/INDEX.md` unless explicitly asked
- Do not add logic to `index.ts` beyond bootstrap
- Do not call Telegram API from `executor.ts` or `actions/*.ts`
- Do not call LLM from `actions/*.ts`
- Do not abstract prematurely — keep files simple until there is a real reason
- When fixing something, explain the change and verify it does not break existing functionality
- When modifying `.agent/*.md` files, do not invent facts — ask if unsure

## Configuration inheritance via providerDefaults

- `llm-config.json` has a top-level `providerDefaults` section mapping each provider to shared defaults (`baseUrl`, `temperature`, `maxOutputTokens`).
- Model entries in `providers` only specify `provider` and `model`, optionally overriding inherited values.
- At runtime, `llm.ts` merges `providerDefaults[provider]` with the model entry. Model entry wins on conflict.
- Example:
  ```json
  "providerDefaults": {
    "gemini": {
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "temperature": 0.1,
      "maxOutputTokens": 2048
    }
  },
  "providers": {
    "gemini-flash": {
      "provider": "gemini",
      "model": "gemini-2.5-flash"
    },
    "gemini-pro": {
      "provider": "gemini",
      "model": "gemini-2.5-pro",
      "maxOutputTokens": 4096
    }
  }
  ```
  - `gemini-flash` inherits all defaults: baseUrl, temperature 0.1, maxOutputTokens 2048
  - `gemini-pro` inherits baseUrl and temperature, but overrides maxOutputTokens to 4096

## Logging rules

- Use `console.log` for informational messages: startup progress, successful operations, status checks, configuration loads, fallback activations.
- Use `console.error` for actual errors only: exceptions, failures, API errors, bootstrap failures.
- Command stderr (from child_process.exec) is not an error — log it as `console.log`.
- Never log sensitive values: API keys, tokens, whitelist IDs, chat IDs.
- Whitelist enforcement must fail silently — do not log any update details for unauthorized attempts.
- No logging libraries — native console only.

## Comments in code

- Do not add explanatory comments about why something is not implemented yet.
- Do not add comments describing what a function does if the name is self-explanatory.
- Only add a comment when the WHY is non-obvious to another developer.

