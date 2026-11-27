# StoneFish x Chessbot Arena (10 local bots)

This integration runs each released StoneFish model as a separate local process and Arena bot identity. It does not change the existing Lichess bridge.

## Included models

| Model ID | Arena bot name |
| --- | --- |
| v1 | Stonefish_v1 |
| v2 | Stonefish_v2 |
| v3 | Stonefish_v3 |
| v4 | Stonefish_v4 |
| v45 | Stonefish_v4.5 |
| v5 | Stonefish_v5 |
| v5pro | Stonefish_v5 Pro |
| v55 | Stonefish_v5.5 |
| v55artemis | Stonefish_v5.5 Artemis |
| v6 | Stonefish_v6 |

The experimental v6_argon model is not included in the released ten-model API.

## Requirements

- Node.js 18 or newer
- One separately created Chessbot Arena bot identity and token per model
- Sandbox credentials first; each identity must complete the Arena's required sandbox evaluation before live use

## Local setup (Windows PowerShell)

1. Download or clone this branch of the StoneFish repository.
2. Open PowerShell in the repository folder.
3. Install dependencies: npm install
4. Copy the template: Copy-Item .env.arena.example .env
5. Open .env in a text editor. Keep CBA_ENV=sandbox and paste each model's own sandbox token into its matching CBA_BOT_TOKEN_MODEL_SANDBOX line. Never paste tokens into chat, commit .env, or share it.
6. Start configured bots: npm run arena

The launcher starts every model that has a token configured and reports which ones are missing credentials. Each model runs in its own Node process, with its own WebSocket connection and search worker. Press Ctrl+C to stop all local bots.

## Live mode

Only after all ten bot identities have independently completed the Arena's required sandbox evaluation and have their own live credentials:

1. Fill in the matching CBA_BOT_TOKEN_MODEL_LIVE entries in .env.
2. Change CBA_ENV=sandbox to CBA_ENV=live.
3. Run npm run arena again.

Do not run two local processes with the same Arena identity at once. The Arena protocol allows one socket per identity/environment.

## Run one model

For a single bot, set STONEFISH_MODEL, CBA_BOT_TOKEN, and optionally CBA_BOT_URL, then run npm run arena:single.

## Design notes

- chessbot-arena-all.cjs: local launcher for all ten processes.
- chessbot-arena.cjs: one model's WebSocket connection and protocol handler.
- chessbot-arena-worker.cjs: isolated worker that reconstructs the game from the supplied move list, checks the resulting FEN against the Arena FEN, calculates a move, and validates it locally.
- The existing stonefish-node.cjs model API is reused unchanged.
- Search runs off the socket event loop so a long model calculation does not block ping/pong handling.
- Move replies retain the request's gameId and ply; stale searches are discarded and repeated completed requests are answered from a small in-memory cache.

## Important limitations before live use

This is an initial integration, not a claim that the bots have already passed Arena conformance. The code has not been run against the live Arena service from this environment. Verify the current protocol version and run all sandbox conformance/evaluation suites before using live credentials. The launcher does not create Arena identities, request tokens, or submit evaluation on your behalf.