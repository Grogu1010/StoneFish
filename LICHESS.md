# StoneFish on Lichess

StoneFish can run as a real Lichess BOT account without changing the released move-selection code.

## What was added

- `stonefish-node.cjs` — Node.js adapter for the same StoneFish scripts used by the website.
- `lichess-bot.cjs` — Lichess Bot API bridge.
- `npm run lichess` — starts the bridge.

The bridge keeps one StoneFish `Chess` object alive for the whole game. This matters for v5.5 because ARMX stores its opponent-adaptation profile per game.

## 1. Create a Lichess BOT account

Use a fresh Lichess account that has not played normal games. Create an API token with the **Play games with the bot API** (`bot:play`) permission, then upgrade that account using Lichess's **Upgrade to Bot account** API endpoint.

Do not put the token in browser JavaScript, `index.html`, or any committed file.

## 2. Start StoneFish

Requires Node.js 18 or newer.

macOS / Linux:

```bash
export LICHESS_TOKEN="lip_your_token_here"
export STONEFISH_MODEL="v55"
npm run lichess
```

PowerShell:

```powershell
$env:LICHESS_TOKEN="lip_your_token_here"
$env:STONEFISH_MODEL="v55"
npm run lichess
```

The process connects to Lichess, waits for challenges, accepts supported standard-chess games, and submits StoneFish moves through the official Bot API.

## Configuration

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `LICHESS_TOKEN` | required | Secret Lichess bot token |
| `STONEFISH_MODEL` | `v55` | `v1`, `v2`, `v3`, `v4`, `v45`, `v5`, `v5pro`, or `v55` |
| `RATED_ONLY` | `false` | Set to `true` to decline casual challenges |
| `MIN_INITIAL_SECONDS` | `15` | Helps avoid clocks too short for heavier models |
| `MIN_INCREMENT_SECONDS` | `0` | Used together with the minimum initial clock |

Only standard chess is accepted. The bridge runs one game at a time so a CPU-heavy StoneFish search cannot accidentally starve multiple clocks.

## Notes

Lichess permits engine assistance only through its official bot/board APIs; do not run StoneFish as assistance on a normal human Lichess account.

For rating measurement, leave rated games enabled and keep the model/time-control setup consistent.
