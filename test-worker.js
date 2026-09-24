const stonefishWorkerAssetSuffix = self.location && self.location.search ? self.location.search : '';
const stonefishWorkerAsset = path => `${path}${stonefishWorkerAssetSuffix}`;

importScripts(
  stonefishWorkerAsset('./StonefishChess.js'),
  stonefishWorkerAsset('./models/models.js'),
  stonefishWorkerAsset('./ARMX/ARMX.js')
);

const workerModels = {
  v1: getStonefishMove,
  v2: getStonefishV2Move,
  v3: getStonefishV3Move,
  v4: getStonefishV4Move,
  v45: getStonefishV45Move,
  v5: getStonefishV5Move,
  v55noarmx: getStonefishV55NoARMXMove,
  v55: getStonefishV55Move,
  v55athena: getStonefishV55AthenaMove,
  v55ares: getStonefishV55AresMove,
  v55artemis: getStonefishV55ArtemisMove,
  v55athenatestunit: getStonefishV55AthenaMove,
  v55arestestunit: getStonefishV55AresMove,
  v55artemistestunit: getStonefishV55ArtemisMove,
  v5pro: getStonefishV5ProMove
};

function seededRandom(seed) {
  let x = seed >>> 0;
  return function random() {
    x += 0x6D2B79F5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeed(seed, fn) {
  const old = Math.random;
  Math.random = seededRandom(seed);
  try { return fn(); } finally { Math.random = old; }
}

// Match the CI benchmark's varied-opening generator. Each opening index is used
// for a color-swapped pair, so both engines see the exact same starting history
// from opposite colors instead of replaying one deterministic initial-position game.
function applyVariedOpening(game, openingIndex = 0) {
  const index = Math.max(0, Number(openingIndex) || 0);
  const plies = 10;
  const pick = seededRandom((0xA551000 + index * 977) >>> 0);

  withSeed((0xB771000 + index * 131) >>> 0, () => {
    for (let ply = 0; ply < plies && !game.game_over(); ply += 1) {
      const scored = stonefishV5ScoreAllMoves(game);
      if (!scored.length) break;
      const width = Math.min(4, scored.length);
      const r = pick();
      const rank = Math.min(width - 1, r < 0.48 ? 0 : r < 0.76 ? 1 : r < 0.93 ? 2 : 3);
      const entry = scored[rank];
      if (!entry || !entry.raw) break;
      game._applyRaw(entry.raw, true);
    }
  });
  game.armxObservationStartPly = game.historyStack.length;
}

function commitChosenMove(game, move) {
  if (move && move._raw) {
    game._applyRaw(move._raw, true);
    return;
  }

  const played = game.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion || 'q'
  });
  if (!played) throw new Error(`Engine returned illegal move: ${move.from}-${move.to}`);
}

function cheapDrawReached(game) {
  if (game.halfmove >= 100) return true;
  if (game._insufficientMaterial()) return true;
  return (game.positionCounts.get(game.fastPositionKey()) || 0) >= 3;
}

function playTestGame(whiteModelKey, blackModelKey, maxPlies = 360, openingIndex = 0) {
  const game = new Chess();
  applyVariedOpening(game, openingIndex);
  let plies = game.historyStack.length;
  const nativeKernelAvailable = typeof SF55C_KERNEL !== 'undefined' && !!SF55C_KERNEL;
  const metrics = {
    [whiteModelKey]: { moves: 0, thinkMs: 0, nativeKernelAvailable, compiledMoves: 0, fallbackMoves: 0 },
    [blackModelKey]: { moves: 0, thinkMs: 0, nativeKernelAvailable, compiledMoves: 0, fallbackMoves: 0 }
  };

  while (plies < maxPlies) {
    const modelKey = game.turn() === 'w' ? whiteModelKey : blackModelKey;
    const getMove = workerModels[modelKey];
    if (!getMove) throw new Error(`Unknown model: ${modelKey}`);

    const started = performance.now();
    const move = getMove(game);
    const elapsed = performance.now() - started;
    if (!move) {
      return {
        outcome: game.in_check() ? (game.turn() === 'w' ? 'black' : 'white') : 'draw',
        metrics,
        plies,
        openingIndex
      };
    }

    metrics[modelKey].moves += 1;
    metrics[modelKey].thinkMs += elapsed;
    if (modelKey === 'v55') {
      const compiled = !!(globalThis.SF55C_LAST && globalThis.SF55C_LAST.refutationGuard
        && globalThis.SF55C_LAST.refutationGuard.compiledSearch);
      if (compiled) metrics[modelKey].compiledMoves += 1;
      else metrics[modelKey].fallbackMoves += 1;
    }
    commitChosenMove(game, move);
    plies += 1;
    if (game.in_checkmate()) return { outcome: game.side === 1 ? 'black' : 'white', metrics, plies, openingIndex };
    if (cheapDrawReached(game)) return { outcome: 'draw', metrics, plies, openingIndex };
  }

  return { outcome: 'draw', metrics, plies, openingIndex };
}

self.onmessage = event => {
  const { jobId, whiteModelKey, blackModelKey, maxPlies, openingIndex } = event.data;

  try {
    const result = playTestGame(
      whiteModelKey,
      blackModelKey,
      maxPlies || 360,
      Number.isFinite(Number(openingIndex)) ? Number(openingIndex) : 0
    );
    self.postMessage({ jobId, result });
  } catch (error) {
    self.postMessage({
      jobId,
      error: error instanceof Error ? error.stack || error.message : String(error)
    });
  }
};
