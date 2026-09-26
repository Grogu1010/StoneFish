// StoneFish public browser API.
// Load this single file from a browser page; it loads the released engine dependencies
// from the same repository/CDN base and exposes window.StonefishAPI.
//
// Released models only. Developer controls and testunit models are intentionally
// excluded from this API surface.

(function stonefishPublicApi(global) {
  'use strict';

  const VERSION = '1.0.0';
  const script = typeof document !== 'undefined' ? document.currentScript : null;
  const baseURL = new URL('.', script && script.src ? script.src : global.location.href);

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

  function absolute(path) {
    return new URL(path, baseURL).href;
  }

  function scriptAlreadyLoaded(src) {
    if (typeof document === 'undefined') return false;
    const target = new URL(src, document.baseURI).href;
    return Array.from(document.scripts).some(node => {
      try { return node.src && new URL(node.src, document.baseURI).href === target; }
      catch (_) { return false; }
    });
  }

  function loadScript(path) {
    if (typeof document === 'undefined') {
      return Promise.reject(new Error('StoneFish public API currently supports browser pages only.'));
    }
    const src = absolute(path);
    if (scriptAlreadyLoaded(src)) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const node = document.createElement('script');
      node.src = src;
      node.async = false;
      node.dataset.stonefishApiDependency = path;
      node.onload = () => resolve();
      node.onerror = () => reject(new Error(`Failed to load StoneFish dependency: ${path}`));
      document.head.appendChild(node);
    });
  }

  async function loadDependencies() {
    for (const path of dependencies) await loadScript(path);

    if (typeof Chess !== 'function') {
      throw new Error('StoneFish rules engine did not load correctly.');
    }

    for (const model of Object.values(releasedModels)) {
      if (typeof global[model.functionName] !== 'function') {
        throw new Error(`Released model is unavailable: ${model.name}`);
      }
    }
  }

  const ready = loadDependencies();

  function normalizeModelId(modelId) {
    const key = String(modelId || '').trim().toLowerCase();
    if (!releasedModels[key]) {
      throw new Error(
        `Unknown or unavailable StoneFish model "${modelId}". Released model IDs: ${Object.keys(releasedModels).join(', ')}`
      );
    }
    return key;
  }

  function parseUci(uci) {
    if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci.trim().toLowerCase())) {
      throw new Error(`Invalid UCI move: ${uci}`);
    }
    const value = uci.trim().toLowerCase();
    return {
      from: value.slice(0, 2),
      to: value.slice(2, 4),
      promotion: value.length === 5 ? value[4] : undefined
    };
  }

  function normalizeMove(move) {
    if (typeof move === 'string') return parseUci(move);
    if (!move || typeof move !== 'object' || !move.from || !move.to) {
      throw new Error('Moves must be UCI strings such as "e2e4" or objects with from/to fields.');
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

  async function createGame(moves) {
    await ready;
    const game = new Chess();
    if (moves != null) {
      if (!Array.isArray(moves)) throw new Error('createGame(moves) expects an array of moves.');
      for (const move of moves) applyMoveOrThrow(game, move);
    }
    return game;
  }

  async function coerceGame(state) {
    await ready;
    if (state instanceof Chess) return state;
    if (state == null) return new Chess();
    if (Array.isArray(state)) return createGame(state);
    if (state && Array.isArray(state.moves)) return createGame(state.moves);
    throw new Error('State must be a Chess game returned by createGame(), an array of moves, or { moves: [...] }.');
  }

  async function getMove(modelId, state) {
    await ready;
    const id = normalizeModelId(modelId);
    const game = await coerceGame(state);
    const model = releasedModels[id];
    const engine = global[model.functionName];
    const move = engine(game);

    return Object.freeze({
      model: id,
      name: model.name,
      move: serializeMove(move),
      fen: game.fen(),
      turn: game.turn()
    });
  }

  async function playMove(game, move) {
    await ready;
    if (!(game instanceof Chess)) {
      throw new Error('playMove() expects a game returned by StonefishAPI.createGame().');
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

  async function playBestMove(modelId, game) {
    await ready;
    if (!(game instanceof Chess)) {
      throw new Error('playBestMove() expects a game returned by StonefishAPI.createGame().');
    }
    const choice = await getMove(modelId, game);
    if (!choice.move) return Object.freeze({ ...choice, played: false });
    const result = await playMove(game, choice.move);
    return Object.freeze({ ...choice, ...result, played: true });
  }

  function listModels() {
    return Object.values(releasedModels).map(({ id, name }) => Object.freeze({ id, name }));
  }

  global.StonefishAPI = Object.freeze({
    version: VERSION,
    ready,
    listModels,
    createGame,
    getMove,
    playMove,
    playBestMove
  });
})(window);
