---
name: terminal-use
description: Use a requested visible persistent terminal, interactive command or reusable SSH shell; recover PTY IDs and read incremental output safely.
---

# Side terminals

Ordinary finite commands/builds/tests use run_command. terminal_control is a user-visible persistent PTY, not a batch-command substitute. Reuse a returned terminalId; list only when the ID/context is unknown. User-created tabs are not automatically owned by this conversation.

| action | fields | result / next step |
| --- | --- | --- |
| create | optional name | terminalId and resolvedName; visible tab resizes the PTY |
| list | none | owned live IDs and local/SSH context |
| write | terminalId, command; optional expectedContext | command delivery and immediate output, NOT completion |
| read | terminalId, afterCursor=previous nextCursor; optional maxChars | only new output and nextCursor |
| close | terminalId | closes PTY and tab |

Omit unrelated fields; null is also accepted. write appends Enter. Its default 200ms sampling window, capped at 5000ms, never proves completion. Read when fresh output is needed; avoid empty polling loops. Never rerun a command for its output. Reuse the actual resolvedName and ID rather than guessing.

## SSH

Start an interactive `ssh [options] user@host` without a trailing remote command; complete authentication, then read until terminalContext.kind is ssh_connected. For every later remote command pass expectedContext=ssh. The tool refuses delivery after disconnection; do not remove the guard to retry locally. A one-shot `ssh host command` returns to local and is not a reusable remote session. Keep credentials out of saved commands and reports.
