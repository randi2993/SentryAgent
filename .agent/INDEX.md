# INDEX

File map for lazy loading. The LLM reads this index and decides which additional file to load based on keywords in the current task.

## .agent/ (developer/AI context — NOT loaded at runtime by the bot)

- `SHARED.md` → always read first. Project rules, stack, conventions, HITL, what NOT to do.
- `ARCHITECTURE.md` → load when generating or modifying any file in `src/` or `config/`. Contains responsibilities, inputs, outputs, and constraints per file.

## memory/

- `learned.md` → machine paths, IPs, service names, IIS config, Node-RED config, non-sensitive credentials.
  Load when owner mentions: path, server, service, IIS, Node-RED, machine, laptop, IP, port.

## skills/ (empty for now)

Procedure files added here when repeated patterns emerge.

## domain/ (empty for now)

Environment-specific knowledge goes here if it grows beyond `learned.md`.

## Loading rules

- `agent.md` + `INDEX.md` → always loaded at runtime (~400 fixed tokens).
- `SHARED.md` + `ARCHITECTURE.md` → loaded by AI assistants during development, NOT by the bot.
- Everything else → only if the task requires it.
- If unsure, do not load. Ask the owner instead.
