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
const MAX_CONCURRENT_GAMES = Math.max(1, Number(process.env.MAX_CONCURRENT_GAMES || 5));

// Auto-matchmaking is ON by default. StoneFish rotates through rated Standard
// Bullet, Blitz, and Rapid games so it can establish all three Lichess ratings.
// Set AUTO_MATCH=false if you only want to accept incoming challenges.
const AUTO_MATCH = !/^(0|false|no)$/i.test(process.env.AUTO_MATCH || 'true');
const AUTO_CHALLENGE_TIMEOUT_MS = Number(process.env.AUTO_CHALLENGE_TIMEOUT_MS || 45_000);
const AUTO_MATCH_RETRY_MS = Number(process.env.AUTO_MATCH_RETRY_MS || 12_000);

// Human auto-challenges are ON by default. We discover public human accounts
// through Lichess TV's official API, keep them in a pool, then use the official
// real-time status API to prefer people who are online and not currently playing.
// Set AUTO_HUMAN_MATCH=false to disable this without disabling bot matchmaking.
const AUTO_HUMAN_MATCH = !/^(0|false|no)$/i.test(process.env.AUTO_HUMAN_MATCH || 'true');
const AUTO_HUMAN_RATED = /^(1|true|yes)$/i.test(process.env.AUTO_HUMAN_RATED || 'false');
const AUTO_HUMAN_COOLDOWN_MS = Number(process.env.AUTO_HUMAN_COOLDOWN_MS || 6 * 60 * 60_000);
const HUMAN_POOL_REFRESH_MS = Number(process.env.HUMAN_POOL_REFRESH_MS || 60_000);
const HUMAN_STATUS_BATCH = Math.max(1, Math.min(100, Number(process.env.HUMAN_STATUS_BATCH || 40)));
const HUMAN_TIME_CONTROL = { name: 'Blitz', limit: 180, increment: 2 };

// Matchmaking activity heuristic. Lichess does not expose the hidden daily
// bot-vs-bot counter before a challenge, so we sample recent public game
// activity and prefer less-active bots. This is only a bias, not a guarantee.
const AUTO_ACTIVITY_LOOKBACK_MS = Number(process.env.AUTO_ACTIVITY_LOOKBACK_MS || 24 * 60 * 60_000);
const AUTO_ACTIVITY_CACHE_MS = Number(process.env.AUTO_ACTIVITY_CACHE_MS || 15 * 60_000);
const AUTO_ACTIVITY_SAMPLE_SIZE = Math.max(1, Number(process.env.AUTO_ACTIVITY_SAMPLE_SIZE || 4));
const AUTO_ACTIVITY_MAX_GAMES = Math.max(1, Number(process.env.AUTO_ACTIVITY_MAX_GAMES || 100));

// This does NOT terminate a long game. It only logs a warning if a game stream
// has produced no events for a long time. Lichess's clocks still decide the game.
// Each live game keeps its own StoneFish game object and ARMX state.
const GAME_INACTIVITY_WARNING_MS = Number(process.env.GAME_INACTIVITY_WARNING_MS || 15 * 60_000);

const AUTO_TIME_CONTROLS = [
  { name: 'Bullet', limit: 60, increment: 0 },
  { name: 'Blitz', limit: 180, increment: 2 },
  { name: 'Rapid', limit: 600, increment: 0 }
];

let autoTimeControlIndex = 0;
let autoTargetKind = AUTO_HUMAN_MATCH ? 'human' : 'bot';

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
const recentActivityCache = new Map();
const knownHumans = new Map();
const recentHumanTargets = new Map();
let humanPoolRefreshedAt = 0;

let pendingOutgoingChallenge = null;
const outgoingChallengeIds = new Set();
const pendingIncomingChallenges = new Set();
let accountInfo = null;
let apiCooldownUntil = 0;

function startApiCooldown(ms = 60_000) {
  apiCooldownUntil = Math.max(apiCooldownUntil, Date.now() + ms);
}

async function waitForApiCooldown() {
  const remaining = apiCooldownUntil - Date.now();
  if (remaining > 0) {
    await sleep(remaining);
  }
}

function occupiedGameSlots() {
  return runningGames.size + pendingIncomingChallenges.size + (pendingOutgoingChallenge ? 1 : 0);
}

function hasGameCapacity() {
  return occupiedGameSlots() < MAX_CONCURRENT_GAMES;
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

async function queuedPost(path, body) {
  const task = async () => {
    await waitForApiCooldown();

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
      console.warn('Lichess rate limit reached; pausing ALL API activity for 60 seconds before retrying.');
      startApiCooldown(60_000);
      await waitForApiCooldown();

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

    if (response.status === 429) {
      startApiCooldown(60_000);
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
  await waitForApiCooldown();

  const response = await fetch(BASE + path, {
    headers: authHeaders({ Accept: 'application/x-ndjson' })
  });
  if (response.status === 429) {
    startApiCooldown(60_000);
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

function challengerName(challenge) {
  return String(
    challenge?.challenger?.id ||
    challenge?.challenger?.name ||
    challenge?.challenger?.username ||
    ''
  ).toLowerCase();
}

function challengeIsOurs(challenge) {
  const me = String(accountInfo?.username || accountInfo?.id || '').toLowerCase();
  return Boolean(me && challengerName(challenge) === me);
}

function challengerIsBot(challenge) {
  return Boolean(
    challenge?.challenger?.title === 'BOT' ||
    challenge?.challenger?.isBot === true
  );
}

function rememberHuman(username, source = 'challenge') {
  const name = String(username || '').trim();
  if (!name) return;
  const key = name.toLowerCase();
  const me = String(accountInfo?.username || accountInfo?.id || '').toLowerCase();
  if (key === me) return;
  knownHumans.set(key, { username: name, source, seenAt: Date.now() });
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
  // Lichess echoes our own outgoing challenge through /api/stream/event.
  // That echo can arrive before the POST response returns, so checking only
  // outgoingChallengeIds is racy. Ignore any challenge whose challenger is us.
  if (
    challengeIsOurs(challenge) ||
    (challenge?.id && outgoingChallengeIds.has(challenge.id))
  ) {
    return;
  }

  if (!challengerIsBot(challenge)) {
    rememberHuman(
      challenge?.challenger?.name ||
      challenge?.challenger?.username ||
      challenge?.challenger?.id,
      'incoming challenge'
    );
  }

  const allowed = challengeAllowed(challenge);
  if (!allowed.ok) {
    console.log(`Declining challenge ${challenge.id}: ${allowed.reason}`);
    await queuedPost(
      `/api/challenge/${challenge.id}/decline`,
      new URLSearchParams({ reason: allowed.reason })
    );
    return;
  }

  if (!hasGameCapacity()) {
    console.log(`Declining challenge ${challenge.id}: already at ${MAX_CONCURRENT_GAMES} games`);
    await queuedPost(
      `/api/challenge/${challenge.id}/decline`,
      new URLSearchParams({ reason: 'later' })
    );
    return;
  }

  pendingIncomingChallenges.add(challenge.id);
  console.log(
    `Accepting ${challenge.rated ? 'rated' : 'casual'} ${challengerIsBot(challenge) ? 'bot' : 'human'} challenge ${challenge.id} ` +
    `(slots ${occupiedGameSlots()}/${MAX_CONCURRENT_GAMES})`
  );
  try {
    await queuedPost(`/api/challenge/${challenge.id}/accept`);
  } catch (error) {
    pendingIncomingChallenges.delete(challenge.id);
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

  runningGames.add(gameId);

  let game = null;
  let syncedMoves = [];
  let ourColor = null;
  let thinkingForPly = -1;
  let lastEventAt = Date.now();

  const watchdog = setInterval(() => {
    const silentFor = Date.now() - lastEventAt;
    if (silentFor >= GAME_INACTIVITY_WARNING_MS) {
      console.warn(
        `Game ${gameId} has had no stream event for ${Math.round(silentFor / 60_000)} minutes. Still waiting; the bot will not start another game while this one is active.`
      );
    }
  }, Math.min(60_000, GAME_INACTIVITY_WARNING_MS));

  try {
    console.log(`Starting Lichess game ${gameId} with StoneFish ${MODEL}`);
    const stream = await openStream(`/api/bot/game/stream/${gameId}`);

    for await (const event of ndjson(stream)) {
      lastEventAt = Date.now();

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
    clearInterval(watchdog);
    runningGames.delete(gameId);
    console.log(`Game ${gameId} stream closed.`);
  }
}

async function getAccount() {
  await waitForApiCooldown();
  const response = await fetch(BASE + '/api/account', { headers: authHeaders() });
  if (!response.ok) throw new Error(`Could not read Lichess account: ${response.status}`);
  return response.json();
}

async function getOnlineBots() {
  await waitForApiCooldown();

  const response = await fetch(BASE + '/api/bot/online', {
    headers: authHeaders({ Accept: 'application/x-ndjson' })
  });

  if (response.status === 429) {
    console.warn('Lichess rate limit reached while listing bots; pausing ALL API activity for 60 seconds.');
    startApiCooldown(60_000);
    await waitForApiCooldown();
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

async function refreshHumanPoolFromTv() {
  const now = Date.now();
  if (now - humanPoolRefreshedAt < HUMAN_POOL_REFRESH_MS && knownHumans.size > 0) {
    return;
  }

  await waitForApiCooldown();

  try {
    const response = await fetch(BASE + '/api/tv/channels', {
      headers: authHeaders({ Accept: 'application/json' })
    });

    if (response.status === 429) {
      console.warn('Lichess rate limit reached while discovering humans; pausing ALL API activity for 60 seconds.');
      startApiCooldown(60_000);
      return;
    }

    if (!response.ok) return;

    const channels = await response.json();
    for (const entry of Object.values(channels || {})) {
      const user = entry?.user;
      const title = String(user?.title || '').toUpperCase();
      const username = String(user?.name || user?.username || user?.id || '').trim();
      if (!username || title === 'BOT') continue;
      rememberHuman(username, 'Lichess TV');
    }

    humanPoolRefreshedAt = now;
  } catch (_) {
    // Best-effort discovery; bot matchmaking continues if this fails.
  }
}

async function getHumanStatuses(usernames) {
  const names = usernames
    .map(name => String(name || '').trim())
    .filter(Boolean)
    .slice(0, HUMAN_STATUS_BATCH);

  if (!names.length) return [];

  await waitForApiCooldown();

  try {
    const params = new URLSearchParams({ ids: names.join(',') });
    const response = await fetch(
      BASE + '/api/users/status?' + params.toString(),
      { headers: authHeaders({ Accept: 'application/json' }) }
    );

    if (response.status === 429) {
      console.warn('Lichess rate limit reached while checking human status; pausing ALL API activity for 60 seconds.');
      startApiCooldown(60_000);
      return [];
    }

    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

async function chooseHumanOpponent() {
  if (!AUTO_HUMAN_MATCH) return null;

  await refreshHumanPoolFromTv();

  const now = Date.now();
  for (const [key, when] of recentHumanTargets) {
    if (now - when >= AUTO_HUMAN_COOLDOWN_MS) {
      recentHumanTargets.delete(key);
    }
  }

  const availablePool = [...knownHumans.values()]
    .filter(item => !recentHumanTargets.has(item.username.toLowerCase()));

  if (!availablePool.length) return null;

  const sample = [...availablePool]
    .sort(() => Math.random() - 0.5)
    .slice(0, HUMAN_STATUS_BATCH);

  const statuses = await getHumanStatuses(sample.map(item => item.username));
  const eligible = statuses.filter(status => {
    const title = String(status?.title || '').toUpperCase();
    const username = String(status?.name || status?.username || status?.id || '').trim();
    if (!username || title === 'BOT') return false;
    if (status?.online !== true) return false;
    if (status?.playing) return false;
    return !recentHumanTargets.has(username.toLowerCase());
  });

  if (!eligible.length) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}

function botUsername(bot) {
  return String(bot?.username || bot?.id || bot?.name || '').trim();
}

function blitzRating(user) {
  const value = Number(user?.perfs?.blitz?.rating);
  return Number.isFinite(value) ? value : null;
}

async function getRecentActivity(username) {
  const key = String(username || '').toLowerCase();
  if (!key) return null;

  const cached = recentActivityCache.get(key);
  if (cached && Date.now() - cached.checkedAt < AUTO_ACTIVITY_CACHE_MS) {
    return cached.count;
  }

  await waitForApiCooldown();

  const since = Date.now() - AUTO_ACTIVITY_LOOKBACK_MS;
  const params = new URLSearchParams({
    since: String(since),
    max: String(AUTO_ACTIVITY_MAX_GAMES),
    moves: 'false',
    clocks: 'false',
    evals: 'false',
    opening: 'false'
  });

  try {
    const response = await fetch(
      `${BASE}/api/games/user/${encodeURIComponent(username)}?${params.toString()}`,
      { headers: authHeaders({ Accept: 'application/x-ndjson' }) }
    );

    if (response.status === 429) {
      console.warn('Lichess rate limit reached while checking bot activity; pausing ALL API activity for 60 seconds.');
      startApiCooldown(60_000);
      return null;
    }

    if (!response.ok) return null;

    const text = await response.text();
    const count = text.trim()
      ? text.split(/\r?\n/).filter(line => line.trim()).length
      : 0;

    recentActivityCache.set(key, { count, checkedAt: Date.now() });
    return count;
  } catch (_) {
    return null;
  }
}

async function chooseOpponent(bots, ownUsername) {
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

    // /api/bot/online is already bot-only, but keep explicit safety checks.
    if (bot.title && bot.title !== 'BOT') return false;
    if (bot.disabled === true) return false;
    if (bot.online === false) return false;
    if (bot.playing === true) return false;

    const blockedUntil = recentOpponents.get(name.toLowerCase());
    if (blockedUntil && (blockedUntil > now || now - blockedUntil <= 30 * 60_000)) return false;

    return true;
  });

  // Do not immediately retry bots we just challenged, and never bypass a
  // future "blocked until" timestamp from Lichess's daily bot-vs-bot cap.
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

    // Check a small sample so we do not hammer the API. Prefer the bot with
    // fewer public games in the recent lookback window. A count of 100 means
    // the export hit our sample ceiling and is treated as very active.
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const sample = shuffled.slice(0, Math.min(AUTO_ACTIVITY_SAMPLE_SIZE, shuffled.length));
    const scored = [];

    for (const bot of sample) {
      const name = botUsername(bot);
      const count = await getRecentActivity(name);
      scored.push({ bot, count });
    }

    const known = scored
      .filter(item => item.count !== null)
      .sort((a, b) => a.count - b.count);

    if (known.length) {
      const best = known[0];
      console.log(
        `Auto-match: activity check prefers ${botUsername(best.bot)} (${best.count} public games in the recent lookback window).`
      );
      return best.bot;
    }

    return sample[0] || pool[0];
  }

  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, Math.min(AUTO_ACTIVITY_SAMPLE_SIZE, shuffled.length));
  const scored = [];

  for (const bot of sample) {
    const name = botUsername(bot);
    const count = await getRecentActivity(name);
    scored.push({ bot, count });
  }

  const known = scored
    .filter(item => item.count !== null)
    .sort((a, b) => a.count - b.count);

  return known[0]?.bot || sample[0] || null;
}

async function cancelPendingOutgoing(reason = 'timeout') {
  if (!pendingOutgoingChallenge) return;
  const pending = pendingOutgoingChallenge;
  pendingOutgoingChallenge = null;
  outgoingChallengeIds.delete(pending.id);

  try {
    console.log(`Cancelling challenge ${pending.id} to ${pending.username}: ${reason}`);
    await queuedPost(`/api/challenge/${pending.id}/cancel`);
  } catch (error) {
    // It may already have been declined/accepted/cancelled, which is harmless.
    console.log(`Challenge ${pending.id} was already resolved.`);
  }
}

async function sendHumanChallenge(opponent) {
  const username = String(
    opponent?.name || opponent?.username || opponent?.id || ''
  ).trim();
  if (!username) return false;

  const body = new URLSearchParams({
    rated: AUTO_HUMAN_RATED ? 'true' : 'false',
    'clock.limit': String(HUMAN_TIME_CONTROL.limit),
    'clock.increment': String(HUMAN_TIME_CONTROL.increment),
    color: 'random',
    variant: 'standard',
    keepAliveStream: 'false'
  });

  console.log(
    'Auto-human: challenging ' + username + ' to ' +
    (AUTO_HUMAN_RATED ? 'rated' : 'casual') + ' ' +
    HUMAN_TIME_CONTROL.name + ' (' + HUMAN_TIME_CONTROL.limit + 's+' +
    HUMAN_TIME_CONTROL.increment + 's).'
  );

  recentHumanTargets.set(username.toLowerCase(), Date.now());

  try {
    const response = await queuedPost(
      '/api/challenge/' + encodeURIComponent(username),
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
      kind: 'human',
      createdAt: Date.now()
    };
    outgoingChallengeIds.add(challenge.id);
    console.log('Auto-human: challenge ' + challenge.id + ' sent to ' + username + '.');
    return true;
  } catch (error) {
    console.log('Auto-human: ' + username + ' was unavailable or declined the request: ' + error.message);
    return false;
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
      kind: 'bot',
      createdAt: Date.now()
    };
    outgoingChallengeIds.add(challenge.id);
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
    AUTO_HUMAN_MATCH
      ? 'Auto-match enabled: alternating online humans with rated bot games; human challenges are casual Blitz 3+2 by default.'
      : 'Auto-match enabled: rotating rated Bullet 1+0, Blitz 3+2, and Rapid 10+0 against online bots, with a low-recent-activity preference.'
  );

  while (true) {
    try {
      await waitForApiCooldown();

      if (!hasGameCapacity()) {
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

      let sent = false;

      if (AUTO_HUMAN_MATCH && autoTargetKind === 'human') {
        const human = await chooseHumanOpponent();
        if (human) {
          sent = await sendHumanChallenge(human);
          if (sent) autoTargetKind = 'bot';
        } else {
          console.log('Auto-human: no known online idle human found right now; falling back to bot matchmaking.');
        }
      }

      if (!sent) {
        const bots = await getOnlineBots();
        const opponent = await chooseOpponent(bots, username);

        if (!opponent) {
          console.log('Auto-match: no available online bot found; trying again soon.');
          await sleep(AUTO_MATCH_RETRY_MS);
          continue;
        }

        const timeControl = AUTO_TIME_CONTROLS[autoTimeControlIndex];
        sent = await sendRatedBotChallenge(opponent, timeControl);

        if (sent) {
          autoTimeControlIndex = (autoTimeControlIndex + 1) % AUTO_TIME_CONTROLS.length;
          autoTargetKind = AUTO_HUMAN_MATCH ? 'human' : 'bot';
        }
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
    console.log(
      'StoneFish will auto-seek rated bot games' +
      (AUTO_HUMAN_MATCH ? ' plus online human opponents' : '') +
      ' and accept rated or casual incoming challenges, up to ' +
      MAX_CONCURRENT_GAMES + ' games at once.'
    );
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

          if (id && outgoingChallengeIds.has(id)) {
            outgoingChallengeIds.delete(id);

            if (pendingOutgoingChallenge && pendingOutgoingChallenge.id === id) {
              console.log(
                `Auto-match: challenge ${pendingOutgoingChallenge.id} to ${pendingOutgoingChallenge.username} was not accepted.`
              );
              pendingOutgoingChallenge = null;
            }
          } else if (id) {
            pendingIncomingChallenges.delete(id);
          }

          continue;
        }

        if (event.type === 'gameStart' && event.game?.id) {
          const wasOutgoing = Boolean(pendingOutgoingChallenge);

          if (wasOutgoing) {
            outgoingChallengeIds.delete(pendingOutgoingChallenge.id);
            pendingOutgoingChallenge = null;
          } else if (pendingIncomingChallenges.size > 0) {
            const firstPending = pendingIncomingChallenges.values().next().value;
            pendingIncomingChallenges.delete(firstPending);
          }

          playGame(event.game.id, accountInfo.username)
            .catch(error => console.error('Game runner failed:', error));
        }
      }
    } catch (error) {
      console.error('Account event stream disconnected:', error.message);

      if (error.rateLimited || /\b429\b/.test(String(error.message || ''))) {
        console.warn('Lichess rate limit reached; pausing ALL API activity for 60 seconds before reconnecting.');
        startApiCooldown(60_000);
        await waitForApiCooldown();
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
