#!/usr/bin/env node
// StoneFish <-> Lichess Bot API bridge.
// Requires Node.js 18+ and a Lichess BOT account token with bot:play.

'use strict';

const StonefishAPI = require('./stonefish-node.cjs');

const BASE = 'https://lichess.org';
const TOKEN = process.env.LICHESS_TOKEN;
const MODEL = (process.env.STONEFISH_MODEL || 'v55').toLowerCase();
const RATED_ONLY = /^(1|true|yes)$/i.test(process.env.RATED_ONLY || 'false');
const MIN_INITIAL_SECONDS = Number(process.env.MIN_INITIAL_SECONDS || 15);
const MIN_INCREMENT_SECONDS = Number(process.env.MIN_INCREMENT_SECONDS || 0);

if (!TOKEN) {
  console.error('Missing LICHESS_TOKEN. Set it in your environment before starting the bot.');
  process.exit(1);
}

if (!StonefishAPI.listModels().some(model => model.id === MODEL)) {
  console.error(`Unknown STONEFISH_MODEL "${MODEL}". Available: ${StonefishAPI.listModels().map(m => m.id).join(', ')}`);
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let postChain = Promise.resolve();
const runningGames = new Set();

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

async function queuedPost(path, body) {
  const task = async () => {
    let response = await fetch(BASE + path, {
      method: 'POST',
      headers: authHeaders(
        body instanceof URLSearchParams
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}
      ),
      body
    });

    if (response.status === 429) {
      console.warn('Lichess rate limit reached; waiting 60 seconds before retrying.');
      await sleep(60_000);
      response = await fetch(BASE + path, {
        method: 'POST',
        headers: authHeaders(
          body instanceof URLSearchParams
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}
        ),
        body
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${response.status} ${response.statusText}: ${text}`);
    }
    return response;
  };

  const result = postChain.then(task, task);
  postChain = result.catch(() => {});
  return result;
}

async function openStream(path) {
  const response = await fetch(BASE + path, {
    headers: authHeaders({ Accept: 'application/x-ndjson' })
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to open stream ${path}: ${response.status} ${text}`);
  }
  return response.body;
}

async function* ndjson(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        yield JSON.parse(line);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) yield JSON.parse(buffer);
  } finally {
    reader.releaseLock();
  }
}

function challengeAllowed(challenge) {
  if (!challenge || challenge.variant?.key !== 'standard') return { ok: false, reason: 'variant' };
  if (RATED_ONLY && !challenge.rated) return { ok: false, reason: 'casual' };

  if (challenge.timeControl?.type === 'clock') {
    const initial = Number(challenge.timeControl.limit || 0);
    const increment = Number(challenge.timeControl.increment || 0);
    if (initial < MIN_INITIAL_SECONDS && increment < MIN_INCREMENT_SECONDS) {
      return { ok: false, reason: 'tooFast' };
    }
  }

  return { ok: true };
}

async function acceptChallenge(challenge) {
  const allowed = challengeAllowed(challenge);
  if (!allowed.ok) {
    console.log(`Declining challenge ${challenge.id}: ${allowed.reason}`);
    await queuedPost(
      `/api/challenge/${challenge.id}/decline`,
      new URLSearchParams({ reason: allowed.reason })
    );
    return;
  }

  if (runningGames.size > 0) {
    console.log(`Declining challenge ${challenge.id}: already playing`);
    await queuedPost(
      `/api/challenge/${challenge.id}/decline`,
      new URLSearchParams({ reason: 'later' })
    );
    return;
  }

  console.log(`Accepting challenge ${challenge.id}`);
  await queuedPost(`/api/challenge/${challenge.id}/accept`);
}

function splitMoves(moves) {
  const value = String(moves || '').trim();
  return value ? value.split(/\s+/) : [];
}

function isOurTurn(moveCount, ourColor) {
  return ourColor === 'white' ? moveCount % 2 === 0 : moveCount % 2 === 1;
}

async function submitMove(gameId, uci) {
  await queuedPost(`/api/bot/game/${gameId}/move/${uci}`);
}

async function playGame(gameId, username) {
  if (runningGames.has(gameId)) return;
  runningGames.add(gameId);

  let game = null;
  let syncedMoves = [];
  let ourColor = null;
  let thinkingForPly = -1;

  try {
    console.log(`Starting Lichess game ${gameId} with StoneFish ${MODEL}`);
    const stream = await openStream(`/api/bot/game/stream/${gameId}`);

    for await (const event of ndjson(stream)) {
      if (event.type === 'gameFull') {
        const whiteId = String(event.white?.id || event.white?.name || '').toLowerCase();
        const blackId = String(event.black?.id || event.black?.name || '').toLowerCase();
        const me = username.toLowerCase();
        ourColor = whiteId === me ? 'white' : blackId === me ? 'black' : null;
        if (!ourColor) throw new Error('Could not determine StoneFish color from gameFull.');

        syncedMoves = splitMoves(event.state?.moves);
        game = StonefishAPI.createGame(syncedMoves);
        console.log(`Game ${gameId}: playing ${ourColor}`);
        await maybeMove(event.state);
        continue;
      }

      if (event.type === 'gameState') {
        if (!game) continue;
        const officialMoves = splitMoves(event.moves);

        // Preserve the same game object for the entire game so ARMX's WeakMap
        // profile and per-game history remain intact.
        if (officialMoves.length < syncedMoves.length) {
          throw new Error('Lichess move history moved backwards unexpectedly.');
        }
        for (let i = syncedMoves.length; i < officialMoves.length; i++) {
          StonefishAPI.playMove(game, officialMoves[i]);
        }
        syncedMoves = officialMoves;

        await maybeMove(event);
      }
    }

    async function maybeMove(state) {
      if (!game || !ourColor || state?.status !== 'started') return;
      const ply = syncedMoves.length;
      if (!isOurTurn(ply, ourColor) || thinkingForPly === ply) return;

      thinkingForPly = ply;
      try {
        const started = performance.now();
        const choice = StonefishAPI.getMove(MODEL, game);
        if (!choice.move?.uci) return;

        const elapsed = Math.round(performance.now() - started);
        console.log(`Game ${gameId} ply ${ply + 1}: ${choice.move.uci} (${elapsed} ms)`);
        await submitMove(gameId, choice.move.uci);
      } catch (error) {
        console.error(`Move failed in game ${gameId}:`, error);
        thinkingForPly = -1;
      }
    }
  } catch (error) {
    console.error(`Game ${gameId} ended with bridge error:`, error);
  } finally {
    runningGames.delete(gameId);
    console.log(`Game ${gameId} stream closed.`);
  }
}

async function getAccount() {
  const response = await fetch(BASE + '/api/account', { headers: authHeaders() });
  if (!response.ok) throw new Error(`Could not read Lichess account: ${response.status}`);
  return response.json();
}

async function run() {
  const account = await getAccount();
  console.log(`StoneFish bridge connected as ${account.username} using ${MODEL}.`);
  console.log('Waiting for Lichess challenges...');

  while (true) {
    try {
      const stream = await openStream('/api/stream/event');
      for await (const event of ndjson(stream)) {
        if (event.type === 'challenge') {
          acceptChallenge(event.challenge).catch(error => console.error('Challenge handling failed:', error));
        } else if (event.type === 'gameStart' && event.game?.id) {
          playGame(event.game.id, account.username).catch(error => console.error('Game runner failed:', error));
        }
      }
    } catch (error) {
      console.error('Account event stream disconnected:', error.message);
      await sleep(5_000);
    }
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
