#!/usr/bin/env node
'use strict';

// One Arena identity per process. Keep WebSocket I/O responsive while the
// synchronous StoneFish search runs in an isolated worker thread.

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const WebSocket = require('ws');
const StoneFish = require('./stonefish-node.cjs');

const MODEL = String(process.env.STONEFISH_MODEL || '').trim().toLowerCase();
const TOKEN = process.env.CBA_BOT_TOKEN;
const URL = process.env.CBA_BOT_URL || 'wss://chessbotarena.com/bot/v1/sandbox';
const SAFE_URLS = new Set([
  'wss://chessbotarena.com/bot/v1',
  'wss://chessbotarena.com/bot/v1/sandbox'
]);
const SAFETY_MARGIN_MS = Math.max(200, Number(process.env.CBA_SAFETY_MARGIN_MS || 500));

if (!StoneFish.listModels().some(model => model.id === MODEL)) {
  console.error('[arena] Set STONEFISH_MODEL to one of:', StoneFish.listModels().map(m => m.id).join(', '));
  process.exit(1);
}
if (!TOKEN) {
  console.error('[arena] Missing CBA_BOT_TOKEN. Set the per-bot token locally; never commit it.');
  process.exit(1);
}
if (!SAFE_URLS.has(URL) && process.env.CBA_ALLOW_INSECURE_WS !== '1') {
  console.error('[arena] Refusing an unrecognized WebSocket URL.');
  process.exit(1);
}

let socket = null;
let worker = null;
let job = null;
let stopping = false;
let reconnectTimer = null;
let reconnectAttempt = 0;
let nextRequestId = 1;
const lastPly = new Map();
const sentMoves = new Map();

function log(event, data = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), model: MODEL, event, ...data }));
}
function send(frame) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(frame));
  return true;
}
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(path.join(__dirname, 'chessbot-arena-worker.cjs'));
  worker.on('message', onWorkerResult);
  worker.on('error', error => {
    log('worker_error', { message: error.message });
    worker = null;
    if (job) { clearTimeout(job.timer); job = null; }
    if (!stopping) ensureWorker();
  });
  worker.on('exit', code => {
    if (code !== 0) log('worker_exit', { code });
    worker = null;
    if (!stopping && !job) ensureWorker();
  });
  return worker;
}
function discardWorker() {
  const old = worker;
  worker = null;
  if (old) old.terminate().catch(() => {});
}
function onWorkerResult(result) {
  if (!job || result.requestId !== job.requestId) return;
  const current = job;
  clearTimeout(current.timer);
  job = null;

  if (result.error) {
    log('search_error', { gameId: current.gameId, ply: current.ply, message: result.error });
    return;
  }
  if (lastPly.get(current.gameId) !== current.ply) {
    log('stale_result_discarded', { gameId: current.gameId, ply: current.ply });
    return;
  }
  if (Date.now() >= current.deadlineTs - SAFETY_MARGIN_MS) {
    log('deadline_safety_skip', { gameId: current.gameId, ply: current.ply });
    return;
  }

  const frame = { type: 'move', gameId: current.gameId, ply: current.ply, move: result.move };
  if (send(frame)) {
    sentMoves.set(current.gameId + ':' + current.ply, frame);
    log('move_sent', { gameId: current.gameId, ply: current.ply, move: result.move, elapsedMs: result.elapsedMs });
  }
}
function onMoveRequest(message) {
  if (typeof message.gameId !== 'string' || !Number.isInteger(message.ply) ||
      typeof message.fen !== 'string' || !Array.isArray(message.moves) ||
      !Number.isFinite(message.deadlineTs)) {
    log('bad_move_request');
    return;
  }

  const key = message.gameId + ':' + message.ply;
  if (sentMoves.has(key)) {
    send(sentMoves.get(key));
    return;
  }
  const previous = lastPly.get(message.gameId);
  if (Number.isInteger(previous) && message.ply < previous) return;
  if (job && job.gameId === message.gameId && job.ply === message.ply) return;

  // Arena identities are configured for one active game. If the server sends
  // a newer ply, terminate obsolete search rather than returning an old move.
  if (job) {
    if (message.ply <= job.ply) return;
    clearTimeout(job.timer);
    job = null;
    discardWorker();
  }

  lastPly.set(message.gameId, message.ply);
  const remaining = message.deadlineTs - Date.now() - SAFETY_MARGIN_MS;
  if (remaining <= 0) {
    log('request_too_late', { gameId: message.gameId, ply: message.ply });
    return;
  }

  const requestId = nextRequestId++;
  const current = {
    requestId,
    gameId: message.gameId,
    ply: message.ply,
    deadlineTs: message.deadlineTs,
    timer: null
  };
  current.timer = setTimeout(() => {
    if (!job || job.requestId !== requestId) return;
    log('search_timeout', { gameId: current.gameId, ply: current.ply });
    job = null;
    discardWorker();
    if (!stopping) ensureWorker();
  }, remaining);
  job = current;

  ensureWorker().postMessage({
    requestId,
    modelId: MODEL,
    gameId: message.gameId,
    ply: message.ply,
    fen: message.fen,
    moves: message.moves,
    startedAt: Date.now()
  });
}
function onMessage(raw) {
  let message;
  try { message = JSON.parse(raw.toString()); }
  catch { log('invalid_json'); return; }
  if (!message || typeof message.type !== 'string') return;

  switch (message.type) {
    case 'welcome':
      reconnectAttempt = 0;
      log('authenticated', {
        botHandle: message.botHandle || null,
        resumedGames: Array.isArray(message.resumedGames) ? message.resumedGames.length : 0
      });
      break;
    case 'ping':
      send({ type: 'pong', ts: message.ts });
      break;
    case 'game_start':
      log('game_start', { gameId: message.gameId, color: message.color, rated: Boolean(message.rated), resumed: Boolean(message.resumed) });
      break;
    case 'move_request':
      onMoveRequest(message);
      break;
    case 'move_played':
      log('opponent_move', { gameId: message.gameId, ply: message.ply, move: message.move });
      break;
    case 'game_end':
      log('game_end', { gameId: message.gameId, result: message.result, reason: message.reason });
      lastPly.delete(message.gameId);
      for (const key of sentMoves.keys()) if (key.startsWith(message.gameId + ':')) sentMoves.delete(key);
      break;
    case 'error':
      log('arena_error', { code: message.code, retryable: Boolean(message.retryable), message: message.message || '' });
      break;
    case 'conformance_result':
      log('conformance_result', { suite: message.suite, status: message.status });
      break;
    default:
      break;
  }
}
function scheduleReconnect() {
  if (stopping || reconnectTimer) return;
  const base = Math.min(30000, 1000 * (2 ** Math.min(reconnectAttempt, 5)));
  const delay = Math.round(base * (0.75 + Math.random() * 0.5));
  reconnectAttempt++;
  log('reconnect_scheduled', { delayMs: delay });
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
}
function connect() {
  if (stopping) return;
  log('connecting', { url: URL });
  const ws = new WebSocket(URL, { handshakeTimeout: 7000 });
  socket = ws;
  ws.on('open', () => {
    // The hello frame must be the first application message.
    send({
      type: 'hello',
      token: TOKEN,
      botVersion: 'stonefish-arena/1.0.0-' + MODEL,
      capabilities: {
        maxConcurrentGames: 1,
        variants: ['standard'],
        supportsDrawOffers: false
      }
    });
    log('hello_sent');
  });
  ws.on('message', onMessage);
  ws.on('error', error => log('socket_error', { message: error.message }));
  ws.on('close', (code, reasonBuffer) => {
    log('socket_closed', { code, reason: reasonBuffer.toString() });
    if (socket === ws) socket = null;
    if (code === 4001) {
      log('auth_rejected_check_token');
      stopping = true;
      process.exitCode = 1;
      return;
    }
    if (code === 4002) {
      log('duplicate_identity_socket_stopped');
      stopping = true;
      return;
    }
    scheduleReconnect();
  });
}
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log('shutdown', { signal });
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (job) { clearTimeout(job.timer); job = null; }
  if (socket && socket.readyState === WebSocket.OPEN) {
    send({ type: 'set_status', accepting: false, maxConcurrentGames: 1 });
    socket.close(1000, 'Local shutdown');
  } else if (socket) socket.terminate();
  discardWorker();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
connect();
