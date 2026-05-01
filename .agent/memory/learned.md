# Learned

Persistent facts about the owner's machine that **cannot be derived at runtime**.
The bot already obtains hostname, username, OS info, env vars, and special folders
dynamically via its own actions — do NOT duplicate those here.

Fill in manually. The bot may suggest additions when it learns something new,
but never edits this file without owner confirmation.

## Logical service map

### IIS
- Sites by logical name → physical path:
- Application pools and their owners:
- Restart command: `iisreset` (default; override only if non-standard)

### Node-RED
- Port:
- Install path:
- Restart command:
- Critical flows that must NOT be disturbed:

## Owner conventions

- Backups location:
- Project root:
- Aliases the owner uses (e.g. "the server" = X):

## Email

- Main account:
- SMTP / IMAP servers (only if non-default):

## Notes

(Anything not derivable that is not a secret)