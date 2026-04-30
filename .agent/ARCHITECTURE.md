# ARCHITECTURE

Source file responsibilities. Read this when generating or modifying any file in `src/` or `config/`.
This file is for developers and AI assistants only — it is NOT loaded by the bot at runtime.

---

## config/llm-config.json

- Static file. Edited manually by the owner only. Never modified by the bot at runtime.
- Source of truth for available models and their parameters.
- Fields: `default` (model key), `fallbackModel` (model key), `fallbackBehavior` ("ask" | "fail"), `providerDefaults` (defaults per provider), `providers` (map of model configs).
- `providerDefaults` maps each provider ("gemini" | "anthropic" | "ollama") to shared defaults: `baseUrl`, `temperature`, `maxOutputTokens`.
- Each provider entry in `providers` specifies only `provider` and `model`, optionally overriding inherited defaults.
- At runtime, `llm.ts` merges each model's entry with its provider's defaults (model entry wins on conflict).
- API keys are NOT stored here. They come from `process.env`.

## config/mcp-config.json

- For Antigravity IDE only. Not loaded or used at runtime by the bot.
- Empty by default.

## config/chats/{chat_id}.json

- Dynamic files. Created and updated by the bot at runtime.
- One file per Telegram chat_id. Filename is the chat_id (e.g. `-1001234567890.json`).
- Stores per-thread model preferences and chat-level default model.
- Structure:
  ```json
  {
    "chatId": "-1001234567890",
    "defaultModel": "gemini-flash",
    "threads": {
      "2": { "name": "Code", "model": "qwen3", "createdAt": "ISO date" },
      "5": {
        "name": "Cinema",
        "model": "gemini-flash",
        "createdAt": "ISO date"
      }
    }
  }
  ```
- If a thread has no entry, falls back to `defaultModel` of the chat.
- If chat has no file, falls back to `default` in `llm-config.json`.

---

## src/index.ts

- Bootstrap only. No business logic.
- Loads environment variables (via `--env-file` flag, not dotenv).
- Reads `config/llm-config.json` once at startup and passes it to `llm.ts`.
- Initializes `telegram.ts` and starts the bot.

## src/llm.ts

- Reads model config from `config/llm-config.json` (loaded at startup, passed in — not re-read per request).
- Merges each model's config with its provider's defaults from `providerDefaults` at runtime (model entry wins on conflict).
- Reads API keys from `process.env`: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`.
- Exposes a single `generateContent(prompt, context, modelKey?)` function.
- **Model key resolution**: If the requested `modelKey` is not found in config, falls back to the default model specified in `llm-config.json`.
- Internally routes to the correct client based on `provider` field:
  - `gemini` → native fetch to Google Generative Language API
  - `anthropic` → native fetch to Anthropic Messages API
  - `ollama` → native fetch to local Ollama endpoint
- Before every LLM call, injects `ACTIVE_MODEL` into the system prompt:
  ```
  ACTIVE_MODEL: gemini-2.5-flash (gemini)
  ```
  This prevents the model from misidentifying itself based on conversation history.
- Captures token usage from each provider's response:
  - Gemini: reads `usageMetadata.promptTokenCount` and `usageMetadata.candidatesTokenCount`
  - Anthropic: reads `usage.input_tokens` and `usage.output_tokens`
  - Ollama: reads `prompt_eval_count` and `eval_count` (if available)
  - Returns `LLMResult` with optional `usage` field containing `promptTokens`, `completionTokens`, `totalTokens`
- If selected model is unavailable:
  - Logs error to console
  - Applies `fallbackBehavior` from config:
    - `ask` → returns a special `{ needsFallbackConfirmation: true }` result (telegram.ts handles the UI)
    - `fail` → throws an error
- Never hardcodes model names or API URLs.

## src/telegram.ts

- Reads `TELEGRAM_BOT_TOKEN` and `ALLOWED_CHAT_ID` from `process.env`.
- Initializes Telegraf bot instance.
- Middleware: silently ignores any update where `ctx.from.id` is not in the whitelist (no logging per SHARED rule).
- Handles system commands directly in code — these never invoke the LLM:
  - `/start` → welcome message + current model info
  - `/model` → show active model for this chat/thread + list available models
  - `/model <key>` → set model for current thread, persist to `config/chats/{chat_id}.json`
  - `/model default` → reset thread to chat default model
  - `/status` → show active model, fallback config, available providers
- Thread management:
  - Thread IDs come from Telegram's `message_thread_id` (topics), or "root" for main thread
  - On first message in a new thread: reads `config/chats/{chat_id}.json` to check if thread is known
  - Unknown threads are auto-registered and inherit the chat's `defaultModel`
  - All threads register to `config/chats/{chat_id}.json` on first message
- **Conversation history** (`conversationHistory` Map):
  - Keyed by `${chatId}_${threadId}` (separate history per thread)
  - Stores up to 10 most recent messages (older messages discarded)
  - Messages added via `history.push({ role: 'user'|'model', content: string })`
  - Token footer NOT saved to history—only appended to Telegram message
  - On fallback retry, original message is NOT re-added to history (avoid duplicates)
  - History purged per-thread (if a thread ID is reused after months, history resets)
- **Pending actions** (`pendingActions` Map):
  - Stores destructive actions awaiting HITL confirmation
  - Keyed by actionId: `${chatId}_${Date.now()}` (fallback suffix for retries)
  - Cleared after confirmation or cancellation
- **Fallback retry logic**:
  - When a model is unavailable, `result.type === 'fallback_required'` triggers inline keyboard
  - User taps "Yes, use fallback" → `processUserMessage` called recursively with `fallbackModel` parameter
  - Fallback does NOT re-push the user message to history (line 123)
  - After fallback completes, normal response flow continues
- Token usage display:
  - Appends formatted footer to bot's reply: `(↑{in} ↓{out} tk)`
  - Numbers formatted: under 1000 shown as-is, 1000+ as `1k`/`1.5k`, 1000000+ as `1M`/`1.5M`
  - **Critically**, the footer is appended ONLY to the Telegram message—the plain text is saved to `conversationHistory` without the footer so the LLM never sees token usage
- `.agent/agent.md` is loaded at startup and injected into every LLM call (optional—continues silently if missing)
- Reads/writes `config/chats/` for model persistence per thread.

## src/executor.ts

- Receives user message + modelKey from `telegram.ts`.
- Calls `llm.ts` to get the LLM response.
- **Action parsing**: Extracts JSON action schemas from LLM response. Looks for JSON in markdown code blocks (````json...````) first; if not found, attempts to parse the entire response as JSON. If parsing fails or no `action` field is present, treats the response as normal text.
- Classifies each action as `safe` or `destructive`:
  - Destructive: delete, overwrite, restart service, run arbitrary command, send email, unlock
  - Safe: read file, list directory, check service status
- Safe actions → execute immediately via `actions/*.ts`, return result.
- Destructive actions → do NOT execute. Return pending state to `telegram.ts`.
  `telegram.ts` sends inline keyboard (✅ Confirm / ❌ Cancel) to owner.
  Only executes after owner taps Confirm.
- **Token usage visibility**: Token usage is only returned in the executor result for text responses (type: 'text'). Action execution results (type: 'action_pending' or 'action_executed') do not include token usage, as the usage metrics belong to the decision-making LLM call, not the subsequent action execution.
- Never calls Telegram API directly — returns results to `telegram.ts`.

## src/actions/files.ts

- Pure async functions. No LLM calls, no Telegram calls.
- Exports: `readFile(path)`, `writeFile(path, content)`, `deleteFile(path)`, `listDirectory(path)`.
- `deleteFile` is always classified as destructive by `executor.ts`.
- `writeFile` is always classified as destructive by `executor.ts` (requires HITL confirmation for all write operations, not just overwrites).
- Throws on error with descriptive message. Never returns silent failures.

## src/actions/server.ts

- Pure async functions. No LLM calls, no Telegram calls.
- Exports: `restartIIS()`, `restartNodeRed()`, `getServiceStatus(name)`.
- All restart functions are always classified as destructive by `executor.ts`.
- Uses Node.js `child_process.exec` to run system commands.
- Commands are hardcoded per service (not user-supplied) to prevent injection.

## src/actions/email.ts

- Pure async functions. No LLM calls, no Telegram calls.
- Exports: `sendEmail(to, subject, body)`, `readEmails(folder, limit)`.
- Reads SMTP/IMAP config from `process.env`.
- `sendEmail` is classified as destructive by `executor.ts`.

## src/actions/system.ts

- Pure async functions. No LLM calls, no Telegram calls.
- Exports: `unlockLaptop()`, `execCommand(cmd)`.
- `execCommand` is always destructive — executor must confirm before calling.
- `unlockLaptop` is destructive.
- Commands in `execCommand` come from the LLM response parsed by executor — never directly from raw user input.

---

## Notes on intentional design decisions

### executor.ts — SYSTEM_PROMPT_INJECTION stays in code

The action schema injected into the LLM system prompt is defined in `executor.ts`, not in `.agent/agent.md`. This is intentional: the schema is tightly coupled to the functions in `actions/*.ts`. If a new action is added, the schema must be updated in the same file. Moving it to a `.md` would create two sources of truth that can drift apart.

### llm.ts — API URLs come from config, not hardcoded

API base URLs (`baseUrl`) must be read from the provider config in `llm-config.json`. The URL is constructed at runtime:

- Gemini: `${baseUrl}/models/${model}:generateContent?key=${apiKey}`
- Anthropic: `${baseUrl}/messages`
- Ollama: `${baseUrl}/api/chat`

### telegram.ts — Whitelist middleware

- Single middleware only — do not duplicate.
- Silently ignores unauthorized updates — no logging, no response.
- Checks `ctx.from?.id` against `ALLOWED_CHAT_ID` (comma-separated in `.env` for multiple users).
