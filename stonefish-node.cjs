// StoneFish Node.js API adapter.
// Loads the exact released browser engine scripts into one VM context so the
// model code and move choices stay shared with the website implementation.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const ROOT = __dirname;
const VERSION = '1.0.0';

const dependencies = [
  'StonefishChess.js',
  'models/v1.js',
  'models/v2.js',
  'models/v3.js',
  'models/v4.js',
  'models/v4_5.js',
  'models/v5.js',
  'models/v5_pro.js',
  'models/v5_5.js',
  'ARMX/ARMX-preview.js',
  'ARMX/ARMX.js'
];

const releasedModels = Object.freeze({
  v1: Object.freeze({ id: 'v1', name: 'Stonefish_v1', functionName: 'getStonefishMove' }),
  v2: Object.freeze({ id: 'v2', name: 'Stonefish_v2', functionName: 'getStonefishV2Move' }),
  v3: Object.freeze({ id: 'v3', name: 'Stonefish_v3', functionName: 'getStonefishV3Move' }),
  v4: Object.freeze({ id: 'v4', name: 'Stonefish_v4', functionName: 'getStonefishV4Move' }),
  v45: Object.freeze({ id: 'v45', name: 'Stonefish_v4.5', functionName: 'getStonefishV45Move' }),
  v5: Object.freeze({ id: 'v5', name: 'Stonefish_v5', functionName: 'getStonefishV5Move' }),
  v5pro: Object.freeze({ id: 'v5pro', name: 'Stonefish_v5 Pro', functionName: 'getStonefishV5ProMove' }),
  v55: Object.freeze({ id: 'v55', name: 'Stonefish_v5.5', functionName: 'getStonefishV55Move' })
});

function buildRuntime() {
  const sandbox = {
    console,
    performance,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    TextEncoder,
    TextDecoder
  };
  const context = vm.createContext(sandbox, { name: 'StoneFishRuntime' });

  for (const relative of dependencies) {
    const filename = path.join(ROOT, relative);
    const source = fs.readFileSync(filename, 'utf8');
    vm.runInContext(source, context, { filename });
  }

  const exportsSource = `
    globalThis.__StonefishNodeExports = {
      Chess,
      getStonefishMove,
      getStonefishV2Move,
      getStonefishV3Move,
      getStonefishV4Move,
      getStonefishV45Move,
      getStonefishV5Move,
      getStonefishV5ProMove,
      getStonefishV55Move
    };
  `;
  vm.runInContext(exportsSource, context, { filename: 'stonefish-node-exports.js' });
  return context.__StonefishNodeExports;
}

const runtime = buildRuntime();

function normalizeModelId(modelId) {
  const key = String(modelId || '').trim().toLowerCase();
  if (!releasedModels[key]) {
    throw new Error(
      `Unknown StoneFish model "${modelId}". Released model IDs: ${Object.keys(releasedModels).join(', ')}`
    );
  }
  return key;
}

function parseUci(uci) {
  const value = String(uci || '').trim().toLowerCase();
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(value)) {
    throw new Error(`Invalid UCI move: ${uci}`);
  }
  return {
    from: value.slice(0, 2),
    to: value.slice(2, 4),
    promotion: value.length === 5 ? value[4] : undefined
  };
}

function normalizeMove(move) {
  if (typeof move === 'string') return parseUci(move);
  if (!move || typeof move !== 'object' || !move.from || !move.to) {
    throw new Error('Moves must be UCI strings or objects with from/to fields.');
  }
  return {
    from: String(move.from).toLowerCase(),
    to: String(move.to).toLowerCase(),
    promotion: move.promotion ? String(move.promotion).toLowerCase() : undefined
  };
}

function moveToUci(move) {
  if (!move) return null;
  return `${move.from}${move.to}${move.promotion || ''}`;
}

function serializeMove(move) {
  if (!move) return null;
  return Object.freeze({
    from: move.from,
    to: move.to,
    promotion: move.promotion || null,
    captured: move.captured || null,
    uci: moveToUci(move)
  });
}

function applyMoveOrThrow(game, input) {
  const move = normalizeMove(input);
  const played = game.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion || 'q'
  });
  if (!played) throw new Error(`Illegal move: ${moveToUci(move)}`);
  return played;
}

function createGame(moves = []) {
  const game = new runtime.Chess();
  for (const move of moves) applyMoveOrThrow(game, move);
  return game;
}

function getMove(modelId, game) {
  const id = normalizeModelId(modelId);
  if (!(game instanceof runtime.Chess)) {
    throw new Error('getMove() expects a game returned by createGame().');
  }
  const model = releasedModels[id];
  const engine = runtime[model.functionName];
  const move = engine(game);
  return Object.freeze({
    model: id,
    name: model.name,
    move: serializeMove(move),
    fen: game.fen(),
    turn: game.turn()
  });
}

function playMove(game, move) {
  if (!(game instanceof runtime.Chess)) {
    throw new Error('playMove() expects a game returned by createGame().');
  }
  const played = applyMoveOrThrow(game, move);
  return Object.freeze({
    move: serializeMove(played),
    fen: game.fen(),
    turn: game.turn(),
    check: game.in_check(),
    gameOver: game.game_over()
  });
}

function listModels() {
  return Object.values(releasedModels).map(({ id, name }) => Object.freeze({ id, name }));
}

module.exports = Object.freeze({
  version: VERSION,
  listModels,
  createGame,
  getMove,
  playMove
});
