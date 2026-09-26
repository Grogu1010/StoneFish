#!/usr/bin/env node
// StoneFish <-> Lichess Bot API bridge.
// Requires Node.js 18+ and a Lichess BOT account token with bot:play.

'use strict';

// On some Windows/Node setups, Node's automatic IPv4/IPv6 family selection can
// time out even when curl/browser networking works. Disable it when supported.
try {
  require('node:net').setDefaultAutoSelectFamily(false);
} catch (_) {
  // Older Node versions may not expose this API. The bot can still be launched
  // with: node --no-network-family-autoselection lichess-bot.cjs
}

const StonefishAPI = require('./stonefish-node.cjs');

const BASE = 'https://lichess.org';
const TOKEN = process.env.LICHESS_TOKEN;
const MODEL = (process.env.STONEFISH_MODEL || 'v55').toLowerCase();

const RATED_ONLY = /^(1|true|yes)$/i.test(process.env.RATED_ONLY || 'false');
const MIN_INITIAL_SECONDS = Number(process.env.MIN_INITIAL_SECONDS || 15);
const MIN_INCREMENT_SECONDS = Number(process.env.MIN_INCREMENT_SECONDS || 0);

// Auto-matchmaking is ON by default. StoneFish rotates through rated Standard
// Bullet, Blitz, and Rapid games so it can establish all three Lichess ratings.
// Set AUTO_MATCH=false if you only want to accept incoming challenges.
const AUTO_MATCH = !/^(0|false|no)$/i.test(process.env.AUTO_MATCH || 'true');
const AUTO_CHALLENGE_TIMEOUT_MS = Number(process.env.AUTO_CHALLENGE_TIMEOUT_MS || 45_000);
const AUTO_MATCH_RETRY_MS = Number(process.env.AUTO_MATCH_RETRY_MS || 12_000);

const AUTO_TIME_CONTROLS = [
  { name: 'Bullet', limit: 60, increment: 0 },
  { name: 'Blitz', limit: 180, increment: 2 },
  { name: 'Rapid', limit: 600, increment: 0 }
];

let autoTimeControlIndex = 0;

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
const recentOpponents = new Map();

let pendingOutgoingChallenge = null;
let pendingIncomingChallengeId = null;
let accountInfo = null;

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
  if (response.status === 429) {
    const text = await response.text().catch(() => '');
    const error = new Error(`Failed to open stream ${path}: 429 ${text}`);
    error.rateLimited = true;
    throw error;
  }

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

  if (runningGames.size > 0 || pendingOutgoingChallenge || pendingIncomingChallengeId) {
    console.log(`Declining challenge ${challenge.id}: already busy`);
    await queuedPost(
      `/api/challenge/${challenge.id}/decline`,
      new URLSearchParams({ reason: 'later' })
    );
    return;
  }

  pendingIncomingChallengeId = challenge.id;
  console.log(`Accepting challenge ${challenge.id}`);
  try {
    await queuedPost(`/api/challenge/${challenge.id}/accept`);
  } catch (error) {
    pendingIncomingChallengeId = null;
    throw error;
  }
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

  pendingOutgoingChallenge = null;
  pendingIncomingChallengeId = null;
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

async function getOnlineBots() {
  const response = await fetch(BASE + '/api/bot/online', {
    headers: authHeaders({ Accept: 'application/x-ndjson' })
  });

  if (response.status === 429) {
    console.warn('Lichess rate limit reached while listing bots; waiting 60 seconds.');
    await sleep(60_000);
    return [];
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Could not list online bots: ${response.status} ${text}`);
  }

  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Current endpoint is NDJSON, but this fallback also tolerates a JSON array.
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  }

  return trimmed
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function botUsername(bot) {
  return String(bot?.username || bot?.id || bot?.name || '').trim();
}

function blitzRating(user) {
  const value = Number(user?.perfs?.blitz?.rating);
  return Number.isFinite(value) ? value : null;
}

function chooseOpponent(bots, ownUsername) {
  const me = ownUsername.toLowerCase();
  const now = Date.now();

  // Normal entries are timestamps of when we challenged a bot and expire after
  // 30 minutes. Future timestamps are used as "do not retry before" times for
  // bots that have hit Lichess's daily bot-vs-bot game cap.
  for (const [name, when] of recentOpponents) {
    if (when > now) continue;
    if (now - when > 30 * 60_000) recentOpponents.delete(name);
  }

  let candidates = bots.filter(bot => {
    const name = botUsername(bot);
    if (!name || name.toLowerCase() === me) return false;
    if (bot.playing === true) return false;
    const blockedUntil = recentOpponents.get(name.toLowerCase());
    if (blockedUntil && (blockedUntil > now || now - blockedUntil <= 30 * 60_000)) return false;
    return true;
  });

  // If every online bot has been tried recently, allow repeats.
  if (!candidates.length) {
    candidates = bots.filter(bot => {
      const name = botUsername(bot);
      return name && name.toLowerCase() !== me && bot.playing !== true;
    });
  }

  if (!candidates.length) return null;

  const ourRating = blitzRating(accountInfo);
  if (ourRating !== null) {
    candidates.sort((a, b) => {
      const ar = blitzRating(a);
      const br = blitzRating(b);
      const ad = ar === null ? Number.MAX_SAFE_INTEGER : Math.abs(ar - ourRating);
      const bd = br === null ? Number.MAX_SAFE_INTEGER : Math.abs(br - ourRating);
      return ad - bd;
    });

    // Pick from a small group near our current rating instead of always
    // challenging the exact same closest-rated bot.
    const pool = candidates.slice(0, Math.min(12, candidates.length));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function cancelPendingOutgoing(reason = 'timeout') {
  if (!pendingOutgoingChallenge) return;
  const pending = pendingOutgoingChallenge;
  pendingOutgoingChallenge = null;

  try {
    console.log(`Cancelling challenge ${pending.id} to ${pending.username}: ${reason}`);
    await queuedPost(`/api/challenge/${pending.id}/cancel`);
  } catch (error) {
    // It may already have been declined/accepted/cancelled, which is harmless.
    console.log(`Challenge ${pending.id} was already resolved.`);
  }
}

async function sendRatedBotChallenge(opponent, timeControl) {
  const username = botUsername(opponent);
  if (!username) return false;

  const body = new URLSearchParams({
    rated: 'true',
    'clock.limit': String(timeControl.limit),
    'clock.increment': String(timeControl.increment),
    color: 'random',
    variant: 'standard',
    keepAliveStream: 'false'
  });

  console.log(
    `Auto-match: challenging ${username} to rated ${timeControl.name} (${timeControl.limit}s+${timeControl.increment}s).`
  );

  try {
    const response = await queuedPost(
      `/api/challenge/${encodeURIComponent(username)}`,
      body
    );
    const data = await response.json().catch(() => ({}));
    const challenge = data.challenge || data;

    if (!challenge?.id) {
      throw new Error('Lichess created no challenge ID.');
    }

    pendingOutgoingChallenge = {
      id: challenge.id,
      username,
      createdAt: Date.now()
    };
    recentOpponents.set(username.toLowerCase(), Date.now());
    console.log(`Auto-match: challenge ${challenge.id} sent to ${username}.`);
    return true;
  } catch (error) {
    const key = username.toLowerCase();

    // If Lichess reports that this bot has reached its daily bot-vs-bot cap,
    // avoid trying the same opponent again for the rest of the day.
    const resetMatch = String(error.message || '').match(/wait until ([0-9T:.\-]+Z)/i);
    if (resetMatch) {
      const resetAt = Date.parse(resetMatch[1]);
      recentOpponents.set(key, Number.isFinite(resetAt) ? resetAt : Date.now() + 12 * 60 * 60_000);
    } else {
      recentOpponents.set(key, Date.now());
    }

    console.log(`Auto-match: ${username} was unavailable or declined the request: ${error.message}`);
    return false;
  }
}

async function autoMatchLoop(username) {
  if (!AUTO_MATCH) return;

  console.log(
    'Auto-match enabled: rotating rated Bullet 1+0, Blitz 3+2, and Rapid 10+0 against online bots.'
  );

  while (true) {
    try {
      if (runningGames.size > 0 || pendingIncomingChallengeId) {
        await sleep(3_000);
        continue;
      }

      if (pendingOutgoingChallenge) {
        if (Date.now() - pendingOutgoingChallenge.createdAt >= AUTO_CHALLENGE_TIMEOUT_MS) {
          await cancelPendingOutgoing('no response');
        } else {
          await sleep(3_000);
          continue;
        }
      }

      const bots = await getOnlineBots();
      const opponent = chooseOpponent(bots, username);

      if (!opponent) {
        console.log('Auto-match: no available online bot found; trying again soon.');
        await sleep(AUTO_MATCH_RETRY_MS);
        continue;
      }

      const timeControl = AUTO_TIME_CONTROLS[autoTimeControlIndex];
      const sent = await sendRatedBotChallenge(opponent, timeControl);

      if (sent) {
        autoTimeControlIndex = (autoTimeControlIndex + 1) % AUTO_TIME_CONTROLS.length;
      }

      await sleep(sent ? 3_000 : AUTO_MATCH_RETRY_MS);
    } catch (error) {
      console.error('Auto-match error:', error.message);
      await sleep(AUTO_MATCH_RETRY_MS);
    }
  }
}

async function run() {
  accountInfo = await getAccount();
  console.log(`StoneFish bridge connected as ${accountInfo.username} using ${MODEL}.`);

  if (AUTO_MATCH) {
    console.log('StoneFish will automatically seek rated bot games to build its Bullet, Blitz, and Rapid ratings.');
    autoMatchLoop(accountInfo.username).catch(error => console.error('Auto-match loop stopped:', error));
  } else {
    console.log('Auto-match disabled. Waiting for Lichess challenges...');
  }

  while (true) {
    try {
      const stream = await openStream('/api/stream/event');

      for await (const event of ndjson(stream)) {
        if (event.type === 'challenge') {
          acceptChallenge(event.challenge).catch(error => console.error('Challenge handling failed:', error));
          continue;
        }

        if (event.type === 'challengeDeclined' || event.type === 'challengeCanceled') {
          const id = event.challenge?.id;
          if (pendingOutgoingChallenge && (!id || pendingOutgoingChallenge.id === id)) {
            console.log(
              `Auto-match: challenge ${pendingOutgoingChallenge.id} to ${pendingOutgoingChallenge.username} was not accepted.`
            );
            pendingOutgoingChallenge = null;
          }
          if (pendingIncomingChallengeId && (!id || pendingIncomingChallengeId === id)) {
            pendingIncomingChallengeId = null;
          }
          continue;
        }

        if (event.type === 'gameStart' && event.game?.id) {
          pendingOutgoingChallenge = null;
          pendingIncomingChallengeId = null;
          playGame(event.game.id, accountInfo.username).catch(error => console.error('Game runner failed:', error));
        }
      }
    } catch (error) {
      console.error('Account event stream disconnected:', error.message);

      if (error.rateLimited || /\b429\b/.test(String(error.message || ''))) {
        console.warn('Lichess rate limit reached; waiting 60 seconds before reconnecting.');
        await sleep(60_000);
      } else {
        await sleep(5_000);
      }
    }
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
