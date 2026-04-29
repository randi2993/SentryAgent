# ARCHITECTURE

Source file responsibilities. Read this when generating or modifying any file in `src/` or `config/`.
This file is for developers and AI assistants only — it is NOT loaded by the bot at runtime.

---

## config/llm-config.json

- Static file. Edited manually by the owner only. Never modified by the bot at runtime.
- Source of truth for available models and their parameters.
- Fields: `default` (model key), `fallbackModel` (model key), `fallbackBehavior` ("ask" | "fail"), `providers` (map of model configs).
- Each provider entry has: `provider` ("gemini" | "anthropic" | "ollama"), `model`, `temperature`, `maxOutputTokens`.
- Ollama entries also have `endpoint` (default: `http://localhost:11434`).
- API keys are NOT stored here. They come from `process.env`.

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
- Reads API keys from `process.env`: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`.
- Exposes a single `generateContent(prompt, context, modelKey?)` function.
- Internally routes to the correct client based on `provider` field:
  - `gemini` → native fetch to Google Generative Language API
  - `anthropic` → native fetch to Anthropic Messages API
  - `ollama` → native fetch to local Ollama endpoint
- Before every LLM call, injects `ACTIVE_MODEL` into the system prompt:
  ```
  ACTIVE_MODEL: gemini-2.0-flash (gemini)
  ```
  This prevents the model from misidentifying itself based on conversation history.
- If selected model is unavailable:
  - Logs error to console
  - Applies `fallbackBehavior` from config:
    - `ask` → returns a special `{ needsFallbackConfirmation: true }` result (telegram.ts handles the UI)
    - `fail` → throws an error
- Never hardcodes model names or API URLs.

## src/telegram.ts

- Reads `TELEGRAM_BOT_TOKEN` and `ALLOWED_CHAT_ID` from `process.env`.
- Initializes Telegraf bot instance.
- Middleware: silently ignores any update where `ctx.from.id` is not in the whitelist.
- Handles system commands directly in code — these never invoke the LLM:
  - `/start` → welcome message + current model info
  - `/model` → show active model for this chat/thread + list available models
  - `/model <key>` → set model for current thread, persist to `config/chats/{chat_id}.json`
  - `/model default` → reset thread to chat default model
  - `/status` → show active model, fallback config, available providers
- On first message in a new thread: reads `config/chats/{chat_id}.json` to check if thread is known.
  If not known, uses chat `defaultModel` (no automatic question to the user).
- Handles inline keyboard callbacks for fallback confirmation (yes/no buttons).
- Passes user messages to `executor.ts` with resolved `modelKey` for the current thread.
- Reads/writes `config/chats/` for model persistence per thread.

## src/executor.ts

- Receives user message + modelKey from `telegram.ts`.
- Calls `llm.ts` to get the LLM response.
- Parses LLM response to identify intended action (if any).
- Classifies each action as `safe` or `destructive`:
  - Destructive: delete, overwrite, restart service, run arbitrary command
  - Safe: read file, list directory, check service status
- Safe actions → execute immediately via `actions/*.ts`, return result.
- Destructive actions → do NOT execute. Return pending state to `telegram.ts`.
  `telegram.ts` sends inline keyboard (✅ Confirm / ❌ Cancel) to owner.
  Only executes after owner taps Confirm.
- Never calls Telegram API directly — returns results to `telegram.ts`.

## src/actions/files.ts

- Pure async functions. No LLM calls, no Telegram calls.
- Exports: `readFile(path)`, `writeFile(path, content)`, `deleteFile(path)`, `listDirectory(path)`.
- `deleteFile` is always classified as destructive by `executor.ts`.
- `writeFile` is destructive if the file already exists.
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
